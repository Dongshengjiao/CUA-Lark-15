// M4 task 4.5: spawn + supervise the Node.js web-agent runner.
//
// Responsibilities:
//   - Resolve the runner script path (RunnerLocator).
//   - Spawn `node <runner.js>` as a child Process.
//   - Pipe stdout/stderr to ~/Library/Logs/LarkIsland/web-agent.log
//     (rotated daily, keep last 5 days).
//   - Restart with exponential backoff (1s, 3s, 9s) up to 3 times in 60s;
//     after that mark `runnerOffline = true` and stop trying.
//   - On graceful shutdown: SIGTERM, wait 2s, then SIGKILL if needed.
//
// The supervisor does NOT read the bridge socket; it just owns the
// child process. Bridge handshake happens between BridgeServer and the
// runner directly via the Unix socket.

import Foundation
import Observation
import os.log

@MainActor
@Observable
final class WebAgentRunnerSupervisor {
    /// True if supervisor stopped restarting after exceeding the
    /// crash-loop threshold. UI shows a red "runner offline" banner.
    private(set) var runnerOffline: Bool = false

    /// PID of the live runner, nil if not running.
    private(set) var currentPID: Int32?

    /// Number of crashes within the rolling 60s window.
    private(set) var recentCrashCount: Int = 0

    /// Set when supervisor decides to give up; UI banner reads this.
    private(set) var lastFailureReason: String?

    /// Observers (notably AppModel) wire this to mark all `.running`
    /// sessions as failed when the runner dies unexpectedly.
    var onRunnerCrash: (@MainActor () -> Void)?

    @ObservationIgnored
    private var process: Process?
    @ObservationIgnored
    private var crashTimestamps: [Date] = []
    @ObservationIgnored
    private var stoppingIntentionally: Bool = false
    @ObservationIgnored
    private let logger = Logger(subsystem: "ai.neolix.lark-island", category: "supervisor")
    @ObservationIgnored
    private let locator: RunnerLocator
    @ObservationIgnored
    private var apiKeyProvider: () -> String? = { nil }

    init(locator: RunnerLocator = RunnerLocator()) {
        self.locator = locator
    }

    /// Provide an apiKey getter; supervisor reads it on every spawn so
    /// the user can rotate the active profile without restarting the app.
    func setAPIKeyProvider(_ provider: @escaping () -> String?) {
        self.apiKeyProvider = provider
    }

    // MARK: - Lifecycle

    func start() {
        guard process == nil else { return }
        stoppingIntentionally = false
        runnerOffline = false
        spawn()
    }

    func stop() {
        stoppingIntentionally = true
        guard let process, process.isRunning else {
            self.process = nil
            currentPID = nil
            return
        }

        let pid = process.processIdentifier
        kill(pid, SIGTERM)

        let deadline = Date().addingTimeInterval(2.0)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if process.isRunning {
            kill(pid, SIGKILL)
        }
        self.process = nil
        currentPID = nil
    }

    // MARK: - Internal: spawn + restart

    private func spawn() {
        guard let scriptURL = locator.locate() else {
            lastFailureReason = "runner script not found (set LARK_ISLAND_RUNNER_PATH)"
            runnerOffline = true
            logger.error("Runner script not found")
            return
        }

        let nodeURL = locator.locateNode()
        let proc = Process()
        proc.executableURL = nodeURL
        proc.arguments = [scriptURL.path]

        var env = ProcessInfo.processInfo.environment
        if let apiKey = apiKeyProvider(), !apiKey.isEmpty {
            env["DASHSCOPE_API_KEY"] = apiKey
        }
        proc.environment = env

        let logURL = Self.logURL()
        do {
            try FileManager.default.createDirectory(
                at: logURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: logURL)
            handle.seekToEndOfFile()
            proc.standardOutput = handle
            proc.standardError = handle
        } catch {
            logger.error("Failed to open runner log: \(error.localizedDescription, privacy: .public)")
        }

        proc.terminationHandler = { [weak self] terminated in
            Task { @MainActor [weak self] in
                self?.handleTermination(terminated)
            }
        }

        do {
            try proc.run()
            self.process = proc
            currentPID = proc.processIdentifier
            logger.info("Runner spawned (pid=\(proc.processIdentifier, privacy: .public))")
        } catch {
            logger.error("Failed to spawn runner: \(error.localizedDescription, privacy: .public)")
            lastFailureReason = "spawn failed: \(error)"
            scheduleRestart()
        }
    }

    private func handleTermination(_ proc: Process) {
        let exitCode = proc.terminationStatus
        logger.info("Runner exited (code=\(exitCode, privacy: .public))")
        self.process = nil
        currentPID = nil

        guard !stoppingIntentionally else { return }

        // Crash event: notify observers.
        onRunnerCrash?()

        let now = Date()
        crashTimestamps.append(now)
        crashTimestamps.removeAll { now.timeIntervalSince($0) > 60 }
        recentCrashCount = crashTimestamps.count

        if recentCrashCount >= 3 {
            runnerOffline = true
            lastFailureReason = "Runner crashed \(recentCrashCount) times within 60s; stopping restarts."
            logger.error("Crash-loop detected; supervisor stopping")
            return
        }

        scheduleRestart()
    }

    private func scheduleRestart() {
        let delay: TimeInterval
        switch recentCrashCount {
        case 0...0: delay = 0.5
        case 1: delay = 1.0
        case 2: delay = 3.0
        default: delay = 9.0
        }

        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard let self, !self.stoppingIntentionally else { return }
            self.spawn()
        }
    }

    // MARK: - Log path

    private static func logURL() -> URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let dateString: String = {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            return f.string(from: Date())
        }()
        return home
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Logs", isDirectory: true)
            .appendingPathComponent("LarkIsland", isDirectory: true)
            .appendingPathComponent("web-agent-\(dateString).log", isDirectory: false)
    }
}

// MARK: - Runner location

/// Resolves the path to the runner entry script. Strategy:
///  1. `$LARK_ISLAND_RUNNER_PATH` env override (preferred for dev).
///  2. dev mode reverse-walk: from `#filePath` (this source file), go up
///     until we find `runners/web-agent/dist/runner.js` or
///     `runners/web-agent/src/runner.ts` (tsx is invoked via npx).
///  3. prod mode: `Bundle.main.resourceURL/runners/web-agent/dist/runner.js`
///     (M7+; not exercised in M4 dev).
struct RunnerLocator: Sendable {
    var envOverride: String? = ProcessInfo.processInfo.environment["LARK_ISLAND_RUNNER_PATH"]
    var bundleResourceURL: URL? = Bundle.main.resourceURL
    var sourceAnchor: String = #filePath

    func locate() -> URL? {
        if let override = envOverride.flatMap({ URL(fileURLWithPath: $0) }),
           FileManager.default.fileExists(atPath: override.path) {
            return override
        }

        let fm = FileManager.default
        var dir = URL(fileURLWithPath: sourceAnchor).deletingLastPathComponent()
        for _ in 0..<8 {
            let dist = dir
                .appendingPathComponent("runners")
                .appendingPathComponent("web-agent")
                .appendingPathComponent("dist")
                .appendingPathComponent("runner.js")
            if fm.fileExists(atPath: dist.path) {
                return dist
            }
            let src = dir
                .appendingPathComponent("runners")
                .appendingPathComponent("web-agent")
                .appendingPathComponent("src")
                .appendingPathComponent("runner.ts")
            if fm.fileExists(atPath: src.path) {
                return src
            }
            dir = dir.deletingLastPathComponent()
        }

        if let resource = bundleResourceURL {
            let prod = resource
                .appendingPathComponent("runners")
                .appendingPathComponent("web-agent")
                .appendingPathComponent("dist")
                .appendingPathComponent("runner.js")
            if fm.fileExists(atPath: prod.path) {
                return prod
            }
        }

        return nil
    }

    /// Resolve `node` (or `npx tsx` for `.ts` source) executable path.
    /// Falls back to `/usr/local/bin/node` then `/opt/homebrew/bin/node`.
    func locateNode() -> URL {
        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
        for path in candidates where FileManager.default.fileExists(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        return URL(fileURLWithPath: "/usr/bin/env")
    }
}
