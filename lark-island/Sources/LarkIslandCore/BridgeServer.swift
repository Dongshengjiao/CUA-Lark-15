// Modified by Lark Island contributors, 2026-04-28. Originally from open-vibe-island. See lark-island/NOTICE.md.
// Stripped of all coding-agent specific hook handling (Claude/Codex/Cursor/Gemini/OpenCode).
// Retained: minimal Unix socket IPC server that brokers BridgeEnvelope between AppModel
// and observer/runner clients. New web-agent client roles will be added in M2.

import Dispatch
import Darwin
import Foundation

public final class BridgeServer: @unchecked Sendable {
    public typealias CommandHandler = @Sendable (BridgeCommand) -> Void
    public typealias EventHandler = @Sendable (AgentEvent) -> Void

    /// Reasons a client envelope can be rejected by the server's
    /// role-based routing rule (M4 group 5).
    public enum RoutingViolation: Equatable, Sendable {
        /// `webAgentRunner` clients are not allowed to send commands.
        case runnerSentCommand
        /// `observer` clients are not allowed to be event sources.
        case observerSentEvent
        /// Envelope arrived before the client identified itself with
        /// `BridgeCommand.registerClient(role:)`.
        case envelopeBeforeRegister
    }

    public typealias RoutingViolationHandler = @Sendable (RoutingViolation) -> Void

    private struct ClientConnection {
        let id: UUID
        let fileDescriptor: Int32
        let readSource: DispatchSourceRead
        var role: BridgeClientRole?
        var buffer = Data()
    }

    private struct Listener {
        let fileDescriptor: Int32
        let acceptSource: DispatchSourceRead
        let socketURL: URL
    }

    private let socketURL: URL
    private let queue = DispatchQueue(label: "ai.neolix.lark-island.bridge.server")
    private let queueKey = DispatchSpecificKey<Void>()

    private var listeners: [Listener] = []
    private var clients: [UUID: ClientConnection] = [:]
    private var stateSnapshot = SessionState()

    /// Called on the bridge queue whenever a client sends a command.
    /// Set this from AppModel before calling `start()`.
    public var commandHandler: CommandHandler?

    /// Called on the bridge queue whenever a `webAgentRunner` client
    /// emits an event. AppModel uses this to apply the event to its own
    /// SessionState so SwiftUI re-renders. Set before `start()`.
    public var eventHandler: EventHandler?

    /// Called on the bridge queue whenever a client violates the
    /// runner-vs-observer routing rule (M4 group 5). Used by tests + by
    /// the AppModel to log warnings. Set before `start()`.
    public var routingViolationHandler: RoutingViolationHandler?

    public init(socketURL: URL = BridgeSocketLocation.defaultURL) {
        self.socketURL = socketURL
        queue.setSpecific(key: queueKey, value: ())
    }

    deinit {
        stop()
    }

    public func start() throws {
        guard listeners.isEmpty else {
            return
        }

        let primaryListener = try bindListener(at: socketURL)
        listeners.append(primaryListener)

        // Also listen on the legacy /tmp path for older client binaries that
        // may still be running with the old socket location compiled in.
        let legacyURL = BridgeSocketLocation.legacyURL
        if legacyURL != socketURL {
            if let legacyListener = try? bindListener(at: legacyURL) {
                listeners.append(legacyListener)
            }
        }
    }

    public func stop() {
        if DispatchQueue.getSpecific(key: queueKey) != nil {
            stopLocked()
        } else {
            queue.sync {
                stopLocked()
            }
        }
    }

    /// Pushes the authoritative session state from AppModel.
    public func updateStateSnapshot(_ snapshot: SessionState) {
        queue.async { [self] in
            stateSnapshot = snapshot
        }
    }

    /// Broadcast an event to all connected observer clients.
    public func broadcast(_ event: AgentEvent) {
        queue.async { [self] in
            let envelope = BridgeEnvelope.event(event)
            for client in clients.values where client.role == .observer {
                writeEnvelope(envelope, to: client.fileDescriptor)
            }
        }
    }

    /// Send a command to the registered `webAgentRunner` client.
    /// Returns true (asynchronously) if at least one runner connection
    /// exists; the actual write happens on the bridge queue.
    /// Used by AppModel.startWebAgentTask to dispatch tasks to the
    /// runner subprocess.
    public func sendToRunner(_ command: BridgeCommand) {
        queue.async { [self] in
            let envelope = BridgeEnvelope.command(command)
            for client in clients.values where client.role == .webAgentRunner {
                writeEnvelope(envelope, to: client.fileDescriptor)
            }
        }
    }

    /// Number of currently-connected clients with the given role.
    /// Synchronous + thread-safe; safe to call from any queue. Used by
    /// AppModel + tests to determine whether a runner is connected.
    public func clientCount(role: BridgeClientRole) -> Int {
        queue.sync {
            clients.values.filter { $0.role == role }.count
        }
    }

    // MARK: - Listener

    private func bindListener(at url: URL) throws -> Listener {
        let parentURL = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parentURL, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: url)

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd != -1 else {
            throw BridgeTransportError.systemCallFailed("socket", errno)
        }

        do {
            var reuseAddress: Int32 = 1
            guard setsockopt(
                fd, SOL_SOCKET, SO_REUSEADDR,
                &reuseAddress, socklen_t(MemoryLayout<Int32>.size)
            ) != -1 else {
                throw BridgeTransportError.systemCallFailed("setsockopt", errno)
            }

            try withUnixSocketAddress(path: url.path) { address, length in
                guard bind(fd, address, length) != -1 else {
                    throw BridgeTransportError.systemCallFailed("bind", errno)
                }
            }

            guard listen(fd, 16) != -1 else {
                throw BridgeTransportError.systemCallFailed("listen", errno)
            }

            try makeSocketNonBlocking(fd)
        } catch {
            close(fd)
            try? FileManager.default.removeItem(at: url)
            throw error
        }

        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in
            self?.acceptPendingClients(on: fd)
        }
        source.setCancelHandler {
            close(fd)
        }
        source.resume()

        return Listener(fileDescriptor: fd, acceptSource: source, socketURL: url)
    }

    private func stopLocked() {
        for listener in listeners {
            listener.acceptSource.cancel()
            try? FileManager.default.removeItem(at: listener.socketURL)
        }
        listeners.removeAll()

        for client in clients.values {
            client.readSource.cancel()
        }
        clients.removeAll()
    }

    private func acceptPendingClients(on listenerFd: Int32) {
        while true {
            let clientFD = accept(listenerFd, nil, nil)
            if clientFD == -1 {
                if errno == EAGAIN || errno == EWOULDBLOCK {
                    return
                }
                if errno == EINTR {
                    continue
                }
                return
            }

            do {
                try makeSocketNonBlocking(clientFD)
            } catch {
                close(clientFD)
                continue
            }

            let id = UUID()
            let source = DispatchSource.makeReadSource(fileDescriptor: clientFD, queue: queue)
            source.setEventHandler { [weak self] in
                self?.readFromClient(id: id)
            }
            source.setCancelHandler {
                close(clientFD)
            }
            clients[id] = ClientConnection(
                id: id,
                fileDescriptor: clientFD,
                readSource: source
            )
            source.resume()

            // Send hello so the client knows it is connected to a real server.
            let hello = BridgeEnvelope.hello(BridgeHello(serverLabel: "lark-island-bridge"))
            writeEnvelope(hello, to: clientFD)
        }
    }

    private func readFromClient(id: UUID) {
        guard var client = clients[id] else { return }

        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = read(client.fileDescriptor, &buffer, buffer.count)
            if n > 0 {
                client.buffer.append(buffer, count: n)
                continue
            }
            if n == 0 {
                disconnectClient(id: id)
                return
            }
            if errno == EAGAIN || errno == EWOULDBLOCK {
                break
            }
            if errno == EINTR {
                continue
            }
            disconnectClient(id: id)
            return
        }

        clients[id] = client
        drainEnvelopes(forClient: id)
    }

    private func drainEnvelopes(forClient id: UUID) {
        guard let client = clients[id] else { return }
        var remaining = client.buffer

        do {
            let envelopes = try BridgeCodec.decodeLines(from: &remaining)
            for envelope in envelopes {
                handleEnvelope(envelope, fromClient: id)
            }
        } catch {
            // Drop malformed frames silently — this is a best-effort
            // local IPC, not a security boundary.
        }

        clients[id]?.buffer = remaining
    }

    private func handleEnvelope(_ envelope: BridgeEnvelope, fromClient id: UUID) {
        switch envelope {
        case .hello:
            return  // Server-only message; ignore from clients.
        case let .command(command):
            handleCommand(command, fromClient: id)
        case let .event(event):
            handleEvent(event, fromClient: id)
        case .response:
            return
        }
    }

    private func handleCommand(_ command: BridgeCommand, fromClient id: UUID) {
        // M4 group 5 routing rule: only `observer` clients may issue
        // commands. `webAgentRunner` clients should never send commands;
        // they only emit events. Warn + drop. `registerClient` is the
        // one exception (every client must register).
        let role = clients[id]?.role
        if case .registerClient(let newRole) = command {
            clients[id]?.role = newRole
            return
        }

        guard let role else {
            routingViolationHandler?(.envelopeBeforeRegister)
            return
        }

        switch role {
        case .observer:
            commandHandler?(command)
        case .webAgentRunner:
            routingViolationHandler?(.runnerSentCommand)
            return
        }
    }

    private func handleEvent(_ event: AgentEvent, fromClient id: UUID) {
        // M4 group 5 routing rule: only `webAgentRunner` clients may
        // emit events. Events from observers (or unregistered clients)
        // are dropped with a warning.
        guard let role = clients[id]?.role else {
            routingViolationHandler?(.envelopeBeforeRegister)
            return
        }
        switch role {
        case .webAgentRunner:
            // Maintain server-side reducer snapshot (used by future
            // multi-observer scenarios + tests).
            stateSnapshot.apply(event)

            // Fan out to AppModel's own state.
            eventHandler?(event)

            // Fan out to every observer client.
            let envelope = BridgeEnvelope.event(event)
            for client in clients.values where client.role == .observer {
                writeEnvelope(envelope, to: client.fileDescriptor)
            }
        case .observer:
            routingViolationHandler?(.observerSentEvent)
            return
        }
    }

    private func writeEnvelope(_ envelope: BridgeEnvelope, to fileDescriptor: Int32) {
        do {
            // Use BridgeCodec so encoding stays in lockstep with
            // BridgeCodec.decodeLines (millisecondsSince1970 dates,
            // newline-terminated).
            let data = try BridgeCodec.encodeLine(envelope)

            data.withUnsafeBytes { rawBuffer in
                guard let baseAddress = rawBuffer.baseAddress else { return }
                var bytesRemaining = data.count
                var pointer = baseAddress
                while bytesRemaining > 0 {
                    let written = write(fileDescriptor, pointer, bytesRemaining)
                    if written < 0 {
                        if errno == EINTR { continue }
                        if errno == EAGAIN || errno == EWOULDBLOCK { return }
                        return
                    }
                    bytesRemaining -= written
                    pointer = pointer.advanced(by: written)
                }
            }
        } catch {
            return
        }
    }

    private func disconnectClient(id: UUID) {
        guard let client = clients.removeValue(forKey: id) else { return }
        client.readSource.cancel()
    }
}
