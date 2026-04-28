// M4 task 5.3: end-to-end coverage for the runner-vs-observer routing
// rule introduced in BridgeServer. Each test spins up a real
// BridgeServer on a temporary Unix domain socket, connects raw-socket
// clients (one or two), exercises the rule, and observes outcomes via
// closures on the server.

import Darwin
import Foundation
import Testing
@testable import LarkIslandCore

@Suite("BridgeServer routing (M4)")
struct BridgeServerRoutingTests {

    @Test("runner-emitted event reaches eventHandler and broadcasts to observer")
    func runnerEventBroadcasts() async throws {
        let harness = try Harness()
        defer { harness.shutdown() }

        let received = ThreadSafeBox<[AgentEvent]>([])
        harness.server.eventHandler = { event in
            received.modify { $0.append(event) }
        }

        let runner = try Harness.connect(role: .webAgentRunner, to: harness.socketURL)
        let observer = try Harness.connect(role: .observer, to: harness.socketURL)
        try await Task.sleep(nanoseconds: 100_000_000)

        let event = AgentEvent.webAgentTaskStarted(
            .init(taskID: "task-1", prompt: "open example.com", profileName: "qwen-default", timestamp: Date())
        )
        try runner.send(.event(event))

        try await Task.sleep(nanoseconds: 250_000_000)

        let handlerEvents = received.value
        #expect(handlerEvents.count == 1)
        if case .webAgentTaskStarted(let payload) = handlerEvents.first {
            #expect(payload.taskID == "task-1")
        } else {
            Issue.record("unexpected event in handler: \(String(describing: handlerEvents.first))")
        }

        let observed = try observer.collectAtLeast(envelopes: 1, timeout: 0.5)
        let eventEnvelope = observed.first(where: {
            if case .event = $0 { return true } else { return false }
        })
        if case .event(.webAgentTaskStarted(let payload)) = eventEnvelope {
            #expect(payload.taskID == "task-1")
        } else {
            Issue.record("observer never received task-started event; got: \(observed)")
        }
    }

    @Test("runner-emitted command is dropped with routing violation")
    func runnerCommandDropped() async throws {
        let harness = try Harness()
        defer { harness.shutdown() }

        let receivedCmds = ThreadSafeBox<[BridgeCommand]>([])
        let violations = ThreadSafeBox<[BridgeServer.RoutingViolation]>([])
        harness.server.commandHandler = { cmd in
            receivedCmds.modify { $0.append(cmd) }
        }
        harness.server.routingViolationHandler = { violation in
            violations.modify { $0.append(violation) }
        }

        let runner = try Harness.connect(role: .webAgentRunner, to: harness.socketURL)
        try await Task.sleep(nanoseconds: 100_000_000)

        let command = BridgeCommand.runWebAgentTask(
            taskID: "task-runner-cmd",
            prompt: "should be rejected",
            skill: nil,
            profileName: nil
        )
        try runner.send(.command(command))

        try await Task.sleep(nanoseconds: 250_000_000)

        #expect(receivedCmds.value.isEmpty)
        #expect(violations.value.contains(.runnerSentCommand))
    }

    @Test("observer-emitted event is dropped with routing violation")
    func observerEventDropped() async throws {
        let harness = try Harness()
        defer { harness.shutdown() }

        let receivedEvents = ThreadSafeBox<[AgentEvent]>([])
        let violations = ThreadSafeBox<[BridgeServer.RoutingViolation]>([])
        harness.server.eventHandler = { event in
            receivedEvents.modify { $0.append(event) }
        }
        harness.server.routingViolationHandler = { violation in
            violations.modify { $0.append(violation) }
        }

        let observer = try Harness.connect(role: .observer, to: harness.socketURL)
        try await Task.sleep(nanoseconds: 100_000_000)

        let event = AgentEvent.webAgentTaskStarted(
            .init(taskID: "task-observer-evt", prompt: "should be rejected", profileName: "qwen-default", timestamp: Date())
        )
        try observer.send(.event(event))

        try await Task.sleep(nanoseconds: 250_000_000)

        #expect(receivedEvents.value.isEmpty)
        #expect(violations.value.contains(.observerSentEvent))
    }

    @Test("observer-emitted command reaches commandHandler")
    func observerCommandRouted() async throws {
        let harness = try Harness()
        defer { harness.shutdown() }

        let receivedCmds = ThreadSafeBox<[BridgeCommand]>([])
        harness.server.commandHandler = { cmd in
            receivedCmds.modify { $0.append(cmd) }
        }

        let observer = try Harness.connect(role: .observer, to: harness.socketURL)
        try await Task.sleep(nanoseconds: 100_000_000)

        let command = BridgeCommand.runWebAgentTask(
            taskID: "task-from-observer",
            prompt: "go",
            skill: nil,
            profileName: "qwen-default"
        )
        try observer.send(.command(command))

        try await Task.sleep(nanoseconds: 250_000_000)

        let cmds = receivedCmds.value
        #expect(cmds.count == 1)
        if case .runWebAgentTask(let taskID, _, _, _) = cmds.first {
            #expect(taskID == "task-from-observer")
        } else {
            Issue.record("commandHandler did not receive runWebAgentTask")
        }
    }
}

// MARK: - Test harness

private final class Harness {
    let server: BridgeServer
    let socketURL: URL

    init() throws {
        // sockaddr_un.sun_path is capped at 104 bytes on macOS, so we
        // place test sockets under /tmp with a short, unique name.
        let shortID = String(UUID().uuidString.prefix(8))
        self.socketURL = URL(fileURLWithPath: "/tmp/li-\(shortID).sock")
        try? FileManager.default.removeItem(at: socketURL)
        self.server = BridgeServer(socketURL: socketURL)
        try server.start()
    }

    func shutdown() {
        server.stop()
    }

    static func connect(role: BridgeClientRole, to socketURL: URL) throws -> RawClient {
        let client = try RawClient(socketURL: socketURL)
        try client.send(.command(.registerClient(role: role)))
        return client
    }
}

private final class RawClient: @unchecked Sendable {
    private let fd: Int32
    private var readBuffer: Data = Data()

    init(socketURL: URL) throws {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd != -1 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        do {
            try withUnixSocketAddress(path: socketURL.path) { addr, len in
                guard connect(fd, addr, len) != -1 else {
                    throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
                }
            }
        } catch {
            close(fd)
            throw error
        }

        var flags = fcntl(fd, F_GETFL, 0)
        flags |= O_NONBLOCK
        _ = fcntl(fd, F_SETFL, flags)

        self.fd = fd
    }

    deinit {
        close(fd)
    }

    func send(_ envelope: BridgeEnvelope) throws {
        let line = try BridgeCodec.encodeLine(envelope)
        line.withUnsafeBytes { buf in
            guard let base = buf.baseAddress else { return }
            var remaining = line.count
            var ptr = base
            while remaining > 0 {
                let n = write(fd, ptr, remaining)
                if n < 0 {
                    if errno == EINTR { continue }
                    return
                }
                remaining -= n
                ptr = ptr.advanced(by: n)
            }
        }
    }

    /// Block until at least `count` envelopes are received, or `timeout` seconds elapse.
    func collectAtLeast(envelopes count: Int, timeout: TimeInterval) throws -> [BridgeEnvelope] {
        let deadline = Date().addingTimeInterval(timeout)
        var collected: [BridgeEnvelope] = []
        var buffer: [UInt8] = Array(repeating: 0, count: 4096)
        while Date() < deadline && collected.count < count {
            let n = read(fd, &buffer, buffer.count)
            if n > 0 {
                readBuffer.append(buffer, count: n)
                var remaining = readBuffer
                let envs = try BridgeCodec.decodeLines(from: &remaining)
                collected.append(contentsOf: envs)
                readBuffer = remaining
            } else if n == 0 {
                break
            } else if errno == EAGAIN || errno == EWOULDBLOCK {
                Thread.sleep(forTimeInterval: 0.03)
            } else {
                break
            }
        }
        return collected
    }
}

private final class ThreadSafeBox<T>: @unchecked Sendable {
    private var _value: T
    private let lock = NSLock()

    init(_ initial: T) {
        self._value = initial
    }

    var value: T {
        lock.lock(); defer { lock.unlock() }
        return _value
    }

    func modify(_ block: (inout T) -> Void) {
        lock.lock(); defer { lock.unlock() }
        block(&_value)
    }
}
