// M4: rewritten as the minimal owner of web-agent state + island chrome
// forwarders. The pre-M4 1545-line OpenIsland AppModel is gone; this
// version preserves only the property/method surface that
// IslandPanelView, OverlayPanelController, and OverlayUICoordinator
// actually depend on (verified via grep before the rewrite). New
// fields are added for the web-agent product (BridgeServer, runner
// supervisor stub, profile store stub, runnerOffline banner).
//
// Group 4 of m4-island-ui-rewrite replaces the local stub types with
// real LLMProfileStore + WebAgentRunnerSupervisor implementations.

import AppKit
import Foundation
import LarkIslandCore
import Observation
import SwiftUI

@MainActor
@Observable
final class AppModel {
    // MARK: - Static configuration

    static let hoverOpenDelay: TimeInterval = 0.15

    static let defaultStatusColors: [SessionPhase: String] = [
        .running: "#6E9FFF",
        .waitingForApproval: "#FFB547",
        .waitingForAnswer: "#FFD95A",
        .completed: "#42E86B",
    ]

    // MARK: - Persistence keys

    private static let soundMutedDefaultsKey = "overlay.sound.muted"
    private static let showDockIconDefaultsKey = "app.showDockIcon"
    private static let hapticFeedbackEnabledDefaultsKey = "app.hapticFeedbackEnabled"
    private static let islandAppearanceModeDefaultsKey = "appearance.island.mode"
    private static let islandClosedDisplayStyleDefaultsKey = "appearance.island.closedDisplayStyle"
    private static let islandHideIdleToEdgeDefaultsKey = "appearance.island.hideIdleToEdge"
    private static let islandPixelShapeStyleDefaultsKey = "appearance.island.pixelShapeStyle"
    private static let islandStatusColorsDefaultsKey = "appearance.island.statusColors"

    // MARK: - Localization

    let lang = LanguageManager.shared

    // MARK: - Owned subsystems

    /// SessionState reducer holding the state derived from web-agent events.
    var state = SessionState() {
        didSet {
            _cachedSessionBuckets = nil
            bridgeServer.updateStateSnapshot(state)
        }
    }

    @ObservationIgnored
    private var _cachedSessionBuckets: (primary: [AgentSession], overflow: [AgentSession])?

    /// Bridge server: spawns Unix socket listener and routes envelopes
    /// between observer (this app) and webAgentRunner (the Node child).
    let bridgeServer: BridgeServer

    /// Island chrome state forwarder.
    let overlay = OverlayUICoordinator()

    /// Profile + secrets storage (file + Keychain).
    let profileStore: LLMProfileStore

    /// Runner subprocess supervisor (Process spawn + crash backoff).
    let runnerSupervisor = WebAgentRunnerSupervisor()

    // MARK: - Forwarder properties (read by IslandPanelView etc.)

    var notchStatus: NotchStatus {
        get { overlay.notchStatus }
        set { overlay.notchStatus = newValue }
    }

    var notchOpenReason: NotchOpenReason? {
        get { overlay.notchOpenReason }
        set { overlay.notchOpenReason = newValue }
    }

    var islandSurface: IslandSurface {
        get { overlay.islandSurface }
        set { overlay.islandSurface = newValue }
    }

    var isOverlayVisible: Bool { overlay.isOverlayVisible }

    var isOverlayCloseTransitionPending: Bool { overlay.isCloseTransitionPending }

    // MARK: - Simple appearance / behavior toggles

    var hapticFeedbackEnabled: Bool {
        didSet { UserDefaults.standard.set(hapticFeedbackEnabled, forKey: Self.hapticFeedbackEnabledDefaultsKey) }
    }

    var showDockIcon: Bool {
        didSet { UserDefaults.standard.set(showDockIcon, forKey: Self.showDockIconDefaultsKey) }
    }

    var isSoundMuted: Bool {
        didSet { UserDefaults.standard.set(isSoundMuted, forKey: Self.soundMutedDefaultsKey) }
    }

    var showsIdleEdgeWhenCollapsed: Bool {
        didSet { UserDefaults.standard.set(showsIdleEdgeWhenCollapsed, forKey: Self.islandHideIdleToEdgeDefaultsKey) }
    }

    var shouldAutoCollapseOnMouseLeave: Bool = true

    /// M4: completion-reply was a coding-agent feature; web-agent has no
    /// equivalent. Hard-code false so chrome height calculations that
    /// reference this flag default to 0 reply-input height.
    let completionReplyEnabled: Bool = false

    /// Notification-mode height measured by SwiftUI; chrome uses this when
    /// computing notch open height. Defaults to 0; ignored for web-agent
    /// task cards (they auto-size).
    var measuredNotificationContentHeight: CGFloat = 0

    /// Status color overrides for SessionPhase (light/dark theme).
    var statusColorHexes: [SessionPhase: String] = AppModel.defaultStatusColors

    // MARK: - Web-agent state

    /// True when the runner has crashed too many times in succession and
    /// supervisor stopped restarting it. UI displays a red banner.
    var runnerOffline: Bool = false

    /// Errors from BridgeServer / RunnerSupervisor surfaced to the user.
    var lastErrorMessage: String?

    /// Currently-active LLM profile (resolved through profileStore).
    var activeProfile: VLMProfile? { profileStore.defaultProfile }

    var activeProfileName: String {
        activeProfile?.name ?? "qwen-default"
    }

    // MARK: - Init

    init() {
        let defaults = UserDefaults.standard
        self.hapticFeedbackEnabled = defaults.object(forKey: Self.hapticFeedbackEnabledDefaultsKey) as? Bool ?? true
        self.showDockIcon = defaults.object(forKey: Self.showDockIconDefaultsKey) as? Bool ?? false
        self.isSoundMuted = defaults.object(forKey: Self.soundMutedDefaultsKey) as? Bool ?? false
        self.showsIdleEdgeWhenCollapsed = defaults.object(forKey: Self.islandHideIdleToEdgeDefaultsKey) as? Bool ?? true
        self.bridgeServer = BridgeServer()
        self.profileStore = LLMProfileStore()
    }

    // MARK: - Lifecycle

    /// Start BridgeServer + spawn runner. Called from the AppDelegate
    /// after applicationDidFinishLaunching.
    func startIfNeeded() {
        // Wire BridgeServer event/command/violation handlers BEFORE
        // start() so we don't miss the runner's first envelope.
        bridgeServer.eventHandler = { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleRunnerEvent(event)
            }
        }
        // Observer-issued runWebAgentTask commands (used by automation
        // tests, the lark-bot input channel, and any future remote
        // dispatchers) are routed back into AppModel.startWebAgentTask
        // so the same single-task-serial guard, profile resolution, and
        // SessionState bookkeeping that the GUI uses is applied here.
        bridgeServer.commandHandler = { [weak self] cmd in
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch cmd {
                case let .runWebAgentTask(taskID, prompt, _, profileName):
                    self.startWebAgentTask(prompt: prompt, taskID: taskID, profileName: profileName)
                default:
                    break
                }
            }
        }
        bridgeServer.routingViolationHandler = { violation in
            print("[bridge] routing violation: \(violation)")
        }

        do {
            try bridgeServer.start()
        } catch {
            lastErrorMessage = "BridgeServer start failed: \(error)"
            return
        }

        // Inject profile-aware secrets into runner spawn env so the
        // user can rotate the active profile without restarting the app.
        runnerSupervisor.setAPIKeyProvider { [weak self] in
            guard let self, let name = self.profileStore.defaultProfileName else { return nil }
            return self.profileStore.apiKey(for: name)
        }
        runnerSupervisor.onRunnerCrash = { [weak self] in
            self?.handleRunnerCrash()
        }
        runnerSupervisor.start()
        overlay.appModel = self
        overlay.restoreDisplayPreference()
        // Without this, the NSPanel that hosts IslandPanelView is never
        // created, so nothing is drawn on the screen even though the
        // app is running. ensureOverlayPanel() creates the panel,
        // positions it on the resolved screen, and orderFrontRegardless()
        // makes it visible in its closed (idle pill) state.
        overlay.ensureOverlayPanel()
    }

    func shutdown() {
        runnerSupervisor.stop()
        bridgeServer.stop()
    }

    /// Called by RunnerSupervisor whenever the runner Process exits
    /// unexpectedly. Marks any in-flight `.running` session as failed
    /// so the UI doesn't show a permanent spinner.
    private func handleRunnerCrash() {
        runnerOffline = runnerSupervisor.runnerOffline
        for session in state.sessions where session.phase == .running {
            let event = AgentEvent.webAgentTaskFailed(
                .init(
                    taskID: session.id,
                    kind: .cancelled,
                    message: "Runner exited unexpectedly",
                    timestamp: Date()
                )
            )
            state.apply(event)
        }
    }

    // MARK: - Web-agent commands (group 6 fully wires these)

    /// Dispatch a new web-agent task. Both the GUI input panel and the
    /// observer commandHandler wire into this single entry point so
    /// the single-task-serial guard, runner-availability check, and
    /// profile resolution stay consistent across input sources.
    ///
    /// - Parameter taskID: Optional caller-provided ID. Used by
    ///   automation tests and remote input channels (e.g. M5.5
    ///   lark-bot) so they can correlate event envelopes back to the
    ///   originating request. Defaults to a fresh UUID for the GUI.
    /// - Parameter profileName: Optional profile override; defaults to
    ///   the active profile from LLMProfileStore.
    func startWebAgentTask(
        prompt: String,
        taskID: String? = nil,
        profileName: String? = nil
    ) {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // v0 single-task serial guard: refuse to dispatch when one is
        // already running. UI can offer a cancel later (M5).
        if let active = state.sessions.first(where: { $0.phase == .running }) {
            lastErrorMessage = "Task '\(active.title)' is still running."
            return
        }

        guard bridgeServer.clientCount(role: .webAgentRunner) > 0 else {
            lastErrorMessage = "Runner not connected. Check ~/Library/Logs/LarkIsland."
            return
        }

        let resolvedTaskID = taskID ?? UUID().uuidString
        let resolvedProfile = profileName ?? profileStore.defaultProfileName
        let command = BridgeCommand.runWebAgentTask(
            taskID: resolvedTaskID,
            prompt: trimmed,
            skill: nil,
            profileName: resolvedProfile
        )
        bridgeServer.sendToRunner(command)
        lastErrorMessage = nil
    }

    func cancelCurrentTask() {
        // M5+ cancel command. v0 leaves runner to finish or crash.
    }

    /// Apply a runner-emitted event to our SessionState reducer so the
    /// UI re-renders. Called from BridgeServer.eventHandler on the
    /// MainActor.
    private func handleRunnerEvent(_ event: AgentEvent) {
        state.apply(event)
        // Drop completed sessions after a fade window (D6: 8 seconds).
        if case .webAgentTaskCompleted = event {
            scheduleSessionCleanup()
        }
        if case .webAgentTaskFailed = event {
            scheduleSessionCleanup()
        }
    }

    private func scheduleSessionCleanup() {
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 8 * 1_000_000_000)
            _ = self?.state.removeInvisibleSessions()
        }
    }

    // MARK: - Island chrome forwarders (called by OverlayPanelController)

    func notchOpen(reason: NotchOpenReason) {
        overlay.notchOpen(reason: reason)
    }

    func notchClose() {
        overlay.notchClose()
    }

    func notePointerInsideIslandSurface() {
        overlay.notePointerInsideIslandSurface()
    }

    func handlePointerExitedIslandSurface() {
        overlay.handlePointerExitedIslandSurface()
    }

    // MARK: - Derived session views (used by IslandPanelView + OverlayPanelController)

    /// Sessions that should appear on the island, ordered by priority.
    /// For web-agent v0 (single-task serial) this is at most one session.
    var surfacedSessions: [AgentSession] {
        state.sessions.filter(\.isVisibleInIsland)
    }

    var liveSessionCount: Int { state.liveSessionCount }

    var islandListSessions: [AgentSession] { surfacedSessions }

    var activeIslandCardSession: AgentSession? {
        state.activeActionableSession ?? surfacedSessions.first
    }

    // MARK: - Harness-mode flags (kept as simple bools; harness was deleted in M0b)

    var ignoresPointerExitDuringHarness: Bool = false
    var disablesOverlayEventMonitoringDuringHarness: Bool = false
}

