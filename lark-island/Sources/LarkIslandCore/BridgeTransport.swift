import Darwin
import Foundation

public enum BridgeSocketLocation {
    /// Stable per-user socket directory under ~/Library/Application Support.
    /// Unlike /tmp, this directory is not subject to periodic system cleanup.
    private static var stableDirectoryURL: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return appSupport.appendingPathComponent("LarkIsland")
    }

    public static var defaultURL: URL {
        stableDirectoryURL.appendingPathComponent("bridge.sock")
    }

    /// Legacy /tmp path retained briefly to ease migration during the
    /// M0c rename window. Removable once no v0.x clients remain on disk.
    public static var legacyURL: URL {
        URL(fileURLWithPath: "/tmp/lark-island-\(getuid()).sock")
    }

    public static func currentURL(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let path = environment["LARK_ISLAND_SOCKET_PATH"], !path.isEmpty {
            return URL(fileURLWithPath: path)
        }
        return defaultURL
    }

    public static func uniqueTestURL() -> URL {
        URL(fileURLWithPath: "/tmp/lark-island-test-\(UUID().uuidString).sock")
    }
}

public enum BridgeTransportError: Error, LocalizedError {
    case alreadyConnected
    case notConnected
    case malformedEnvelope
    case responseTimedOut
    case listenerFailed(String)
    case socketPathTooLong
    case systemCallFailed(String, Int32)

    public var errorDescription: String? {
        switch self {
        case .alreadyConnected:
            "The bridge client is already connected."
        case .notConnected:
            "The bridge client is not connected."
        case .malformedEnvelope:
            "The bridge transport received malformed data."
        case .responseTimedOut:
            "The local bridge timed out while waiting for a response."
        case let .listenerFailed(message):
            "The local bridge listener failed: \(message)"
        case .socketPathTooLong:
            "The Unix socket path is too long for `sockaddr_un`."
        case let .systemCallFailed(name, code):
            "\(name) failed with errno \(code)."
        }
    }
}

public struct BridgeHello: Equatable, Codable, Sendable {
    public var protocolVersion: Int
    public var serverLabel: String

    /// M2: protocolVersion bumped 1 → 2 to advertise web-agent envelope kinds.
    /// Runner clients refuse to send `webAgent*` envelopes if they see version < 2.
    public init(protocolVersion: Int = 2, serverLabel: String = "lark-island-bridge") {
        self.protocolVersion = protocolVersion
        self.serverLabel = serverLabel
    }
}

public enum BridgeClientRole: String, Codable, Sendable {
    case observer
    /// M2: a runner subprocess (e.g. runners/web-agent/) that produces
    /// web-agent events. Excluded from BridgeServer.broadcast() so it
    /// does not receive its own events back.
    case webAgentRunner
}

public enum BridgeCommand: Equatable, Codable, Sendable {
    case registerClient(role: BridgeClientRole)
    case requestQuestion(sessionID: String, prompt: QuestionPrompt)
    case resolvePermission(sessionID: String, resolution: PermissionResolution)
    case answerQuestion(sessionID: String, response: QuestionPromptResponse)
    /// M2: app → runner dispatch. Carries no API keys — the runner
    /// resolves `profileName` to credentials via its own keychain config.
    case runWebAgentTask(taskID: String, prompt: String, skill: String?, profileName: String?)

    private enum CodingKeys: String, CodingKey {
        case type
        case role
        case sessionID
        case prompt
        case resolution
        case response
        case taskID
        case skill
        case profileName
    }

    private enum CommandType: String, Codable {
        case registerClient
        case requestQuestion
        case resolvePermission
        case answerQuestion
        case runWebAgentTask
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(CommandType.self, forKey: .type)

        switch type {
        case .registerClient:
            self = .registerClient(role: try container.decode(BridgeClientRole.self, forKey: .role))
        case .requestQuestion:
            self = .requestQuestion(
                sessionID: try container.decode(String.self, forKey: .sessionID),
                prompt: try container.decode(QuestionPrompt.self, forKey: .prompt)
            )
        case .resolvePermission:
            self = .resolvePermission(
                sessionID: try container.decode(String.self, forKey: .sessionID),
                resolution: try container.decode(PermissionResolution.self, forKey: .resolution)
            )
        case .answerQuestion:
            self = .answerQuestion(
                sessionID: try container.decode(String.self, forKey: .sessionID),
                response: try container.decode(QuestionPromptResponse.self, forKey: .response)
            )
        case .runWebAgentTask:
            self = .runWebAgentTask(
                taskID: try container.decode(String.self, forKey: .taskID),
                prompt: try container.decode(String.self, forKey: .prompt),
                skill: try container.decodeIfPresent(String.self, forKey: .skill),
                profileName: try container.decodeIfPresent(String.self, forKey: .profileName)
            )
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case let .registerClient(role):
            try container.encode(CommandType.registerClient, forKey: .type)
            try container.encode(role, forKey: .role)
        case let .requestQuestion(sessionID, prompt):
            try container.encode(CommandType.requestQuestion, forKey: .type)
            try container.encode(sessionID, forKey: .sessionID)
            try container.encode(prompt, forKey: .prompt)
        case let .resolvePermission(sessionID, resolution):
            try container.encode(CommandType.resolvePermission, forKey: .type)
            try container.encode(sessionID, forKey: .sessionID)
            try container.encode(resolution, forKey: .resolution)
        case let .answerQuestion(sessionID, response):
            try container.encode(CommandType.answerQuestion, forKey: .type)
            try container.encode(sessionID, forKey: .sessionID)
            try container.encode(response, forKey: .response)
        case let .runWebAgentTask(taskID, prompt, skill, profileName):
            try container.encode(CommandType.runWebAgentTask, forKey: .type)
            try container.encode(taskID, forKey: .taskID)
            try container.encode(prompt, forKey: .prompt)
            try container.encodeIfPresent(skill, forKey: .skill)
            try container.encodeIfPresent(profileName, forKey: .profileName)
        }
    }
}

public enum BridgeResponse: Equatable, Codable, Sendable {
    case acknowledged
}

public enum BridgeEnvelope: Equatable, Codable, Sendable {
    case hello(BridgeHello)
    case event(AgentEvent)
    case command(BridgeCommand)
    case response(BridgeResponse)

    private enum CodingKeys: String, CodingKey {
        case type
        case hello
        case event
        case command
        case response
    }

    private enum EnvelopeType: String, Codable {
        case hello
        case event
        case command
        case response
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(EnvelopeType.self, forKey: .type)

        switch type {
        case .hello:
            self = .hello(try container.decode(BridgeHello.self, forKey: .hello))
        case .event:
            self = .event(try container.decode(AgentEvent.self, forKey: .event))
        case .command:
            self = .command(try container.decode(BridgeCommand.self, forKey: .command))
        case .response:
            self = .response(try container.decode(BridgeResponse.self, forKey: .response))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case let .hello(payload):
            try container.encode(EnvelopeType.hello, forKey: .type)
            try container.encode(payload, forKey: .hello)
        case let .event(payload):
            try container.encode(EnvelopeType.event, forKey: .type)
            try container.encode(payload, forKey: .event)
        case let .command(payload):
            try container.encode(EnvelopeType.command, forKey: .type)
            try container.encode(payload, forKey: .command)
        case let .response(payload):
            try container.encode(EnvelopeType.response, forKey: .type)
            try container.encode(payload, forKey: .response)
        }
    }
}

public enum BridgeCodec {
    private static let newline = UInt8(ascii: "\n")

    public static func encodeLine(_ envelope: BridgeEnvelope) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970

        var data = try encoder.encode(envelope)
        data.append(newline)
        return data
    }

    public static func decodeLines(from buffer: inout Data) throws -> [BridgeEnvelope] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970

        var messages: [BridgeEnvelope] = []

        while let newlineIndex = buffer.firstIndex(of: newline) {
            let line = buffer.prefix(upTo: newlineIndex)
            buffer.removeSubrange(...newlineIndex)

            guard !line.isEmpty else {
                continue
            }

            do {
                let message = try decoder.decode(BridgeEnvelope.self, from: Data(line))
                messages.append(message)
            } catch {
                throw BridgeTransportError.malformedEnvelope
            }
        }

        return messages
    }
}

func withUnixSocketAddress<T>(
    path: String,
    _ body: (UnsafePointer<sockaddr>, socklen_t) throws -> T
) throws -> T {
    var address = sockaddr_un()
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    address.sun_family = sa_family_t(AF_UNIX)

    let pathBytes = Array(path.utf8)
    let maxPathLength = MemoryLayout.size(ofValue: address.sun_path)

    guard pathBytes.count < maxPathLength else {
        throw BridgeTransportError.socketPathTooLong
    }

    withUnsafeMutableBytes(of: &address.sun_path) { rawBuffer in
        rawBuffer.initializeMemory(as: UInt8.self, repeating: 0)

        for (index, byte) in pathBytes.enumerated() {
            rawBuffer[index] = byte
        }
    }

    let length = socklen_t(
        MemoryLayout.size(ofValue: address.sun_len) +
        MemoryLayout.size(ofValue: address.sun_family) +
        pathBytes.count + 1
    )

    return try withUnsafePointer(to: &address) { pointer in
        try pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
            try body(sockaddrPointer, length)
        }
    }
}

func makeSocketNonBlocking(_ fileDescriptor: Int32) throws {
    let currentFlags = fcntl(fileDescriptor, F_GETFL)
    guard currentFlags != -1 else {
        throw BridgeTransportError.systemCallFailed("fcntl(F_GETFL)", errno)
    }

    guard fcntl(fileDescriptor, F_SETFL, currentFlags | O_NONBLOCK) != -1 else {
        throw BridgeTransportError.systemCallFailed("fcntl(F_SETFL)", errno)
    }
}

func disableSocketSigPipe(_ fileDescriptor: Int32) throws {
    var enabled: Int32 = 1
    guard setsockopt(
        fileDescriptor,
        SOL_SOCKET,
        SO_NOSIGPIPE,
        &enabled,
        socklen_t(MemoryLayout<Int32>.size)
    ) != -1 else {
        throw BridgeTransportError.systemCallFailed("setsockopt(SO_NOSIGPIPE)", errno)
    }
}

func writeAll(_ data: Data, to fileDescriptor: Int32) throws {
    var remaining = data[...]

    while !remaining.isEmpty {
        let bytesWritten = remaining.withUnsafeBytes { rawBuffer -> Int in
            let baseAddress = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self)
            return write(fileDescriptor, baseAddress, rawBuffer.count)
        }

        if bytesWritten > 0 {
            remaining.removeFirst(bytesWritten)
            continue
        }

        if bytesWritten == -1 && (errno == EAGAIN || errno == EWOULDBLOCK) {
            usleep(1_000)
            continue
        }

        throw BridgeTransportError.systemCallFailed("write", errno)
    }
}
