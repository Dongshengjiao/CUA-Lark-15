// Modified by Lark Island contributors, 2026-04-28. Originally from open-vibe-island. See lark-island/NOTICE.md.
// Stripped of all coding-agent metadata events (codex/claude/gemini/openCode/cursor),
// retains only the generic session lifecycle events reusable for the web-agent product.

import Foundation

public struct SessionStarted: Equatable, Codable, Sendable {
    public var sessionID: String
    public var title: String
    public var tool: AgentTool
    public var origin: SessionOrigin?
    public var initialPhase: SessionPhase
    public var summary: String
    public var timestamp: Date
    public var jumpTarget: JumpTarget?
    public var isRemote: Bool

    public init(
        sessionID: String,
        title: String,
        tool: AgentTool,
        origin: SessionOrigin? = nil,
        initialPhase: SessionPhase = .running,
        summary: String,
        timestamp: Date,
        jumpTarget: JumpTarget? = nil,
        isRemote: Bool = false
    ) {
        self.sessionID = sessionID
        self.title = title
        self.tool = tool
        self.origin = origin
        self.initialPhase = initialPhase
        self.summary = summary
        self.timestamp = timestamp
        self.jumpTarget = jumpTarget
        self.isRemote = isRemote
    }
}

public struct SessionActivityUpdated: Equatable, Codable, Sendable {
    public var sessionID: String
    public var summary: String
    public var phase: SessionPhase
    public var timestamp: Date

    public init(
        sessionID: String,
        summary: String,
        phase: SessionPhase,
        timestamp: Date
    ) {
        self.sessionID = sessionID
        self.summary = summary
        self.phase = phase
        self.timestamp = timestamp
    }
}

public struct PermissionRequested: Equatable, Codable, Sendable {
    public var sessionID: String
    public var request: PermissionRequest
    public var timestamp: Date

    public init(
        sessionID: String,
        request: PermissionRequest,
        timestamp: Date
    ) {
        self.sessionID = sessionID
        self.request = request
        self.timestamp = timestamp
    }
}

public struct QuestionAsked: Equatable, Codable, Sendable {
    public var sessionID: String
    public var prompt: QuestionPrompt
    public var timestamp: Date

    public init(
        sessionID: String,
        prompt: QuestionPrompt,
        timestamp: Date
    ) {
        self.sessionID = sessionID
        self.prompt = prompt
        self.timestamp = timestamp
    }
}

public struct SessionCompleted: Equatable, Codable, Sendable {
    public var sessionID: String
    public var summary: String
    public var timestamp: Date
    public var isInterrupt: Bool?

    public init(
        sessionID: String,
        summary: String,
        timestamp: Date,
        isInterrupt: Bool? = nil
    ) {
        self.sessionID = sessionID
        self.summary = summary
        self.timestamp = timestamp
        self.isInterrupt = isInterrupt
    }
}

public struct JumpTargetUpdated: Equatable, Codable, Sendable {
    public var sessionID: String
    public var jumpTarget: JumpTarget
    public var timestamp: Date

    public init(
        sessionID: String,
        jumpTarget: JumpTarget,
        timestamp: Date
    ) {
        self.sessionID = sessionID
        self.jumpTarget = jumpTarget
        self.timestamp = timestamp
    }
}

public struct ActionableStateResolved: Equatable, Codable, Sendable {
    public var sessionID: String
    public var summary: String
    public var timestamp: Date

    public init(
        sessionID: String,
        summary: String,
        timestamp: Date
    ) {
        self.sessionID = sessionID
        self.summary = summary
        self.timestamp = timestamp
    }
}

// MARK: - Web Agent events (M2)

/// Closed taxonomy of web-agent task failures. The M4 island UI branches
/// on this to decide whether to offer "Retry" (vlm*), "Restart browser"
/// (pageError), or just dismiss (cancelled).
public enum WebAgentFailureKind: String, Codable, Sendable, Equatable {
    case vlmTimeout
    case vlmError
    case pageError
    case cancelled
}

public struct WebAgentTaskStarted: Equatable, Codable, Sendable {
    public var taskID: String
    public var prompt: String
    public var skill: String?
    public var profileName: String
    public var timestamp: Date

    public init(taskID: String, prompt: String, skill: String? = nil, profileName: String, timestamp: Date) {
        self.taskID = taskID
        self.prompt = prompt
        self.skill = skill
        self.profileName = profileName
        self.timestamp = timestamp
    }
}

public struct WebAgentStepUpdate: Equatable, Codable, Sendable {
    public var taskID: String
    public var stepIndex: Int
    public var thought: String
    public var actionRaw: String?
    public var actionType: String?
    /// Absolute path or `file://` URL to a JPEG screenshot on disk. The
    /// canonical write location is
    /// `~/Library/Application Support/LarkIsland/web-agent/screenshots/<taskID>/<stepIndex>.jpg`,
    /// but any user-readable path is accepted.
    public var screenshotURL: String?
    public var costMs: Int?
    public var costTokens: Int?
    public var timestamp: Date

    public init(
        taskID: String,
        stepIndex: Int,
        thought: String,
        actionRaw: String? = nil,
        actionType: String? = nil,
        screenshotURL: String? = nil,
        costMs: Int? = nil,
        costTokens: Int? = nil,
        timestamp: Date
    ) {
        self.taskID = taskID
        self.stepIndex = stepIndex
        self.thought = thought
        self.actionRaw = actionRaw
        self.actionType = actionType
        self.screenshotURL = screenshotURL
        self.costMs = costMs
        self.costTokens = costTokens
        self.timestamp = timestamp
    }
}

public struct WebAgentApprovalRequested: Equatable, Codable, Sendable {
    public var taskID: String
    /// Free-form discriminator. M5 will use `"login_qr"` for the
    /// first-time Feishu scan; future skills can introduce others.
    public var kind: String
    public var message: String
    public var timestamp: Date

    public init(taskID: String, kind: String, message: String, timestamp: Date) {
        self.taskID = taskID
        self.kind = kind
        self.message = message
        self.timestamp = timestamp
    }
}

public struct WebAgentTaskCompleted: Equatable, Codable, Sendable {
    public var taskID: String
    public var finalAnswer: String
    public var totalSteps: Int
    public var totalTokens: Int
    public var totalMs: Int
    public var timestamp: Date

    public init(
        taskID: String,
        finalAnswer: String,
        totalSteps: Int,
        totalTokens: Int,
        totalMs: Int,
        timestamp: Date
    ) {
        self.taskID = taskID
        self.finalAnswer = finalAnswer
        self.totalSteps = totalSteps
        self.totalTokens = totalTokens
        self.totalMs = totalMs
        self.timestamp = timestamp
    }
}

public struct WebAgentTaskFailed: Equatable, Codable, Sendable {
    public var taskID: String
    public var kind: WebAgentFailureKind
    public var message: String
    public var timestamp: Date

    public init(taskID: String, kind: WebAgentFailureKind, message: String, timestamp: Date) {
        self.taskID = taskID
        self.kind = kind
        self.message = message
        self.timestamp = timestamp
    }
}

public enum AgentEvent: Equatable, Codable, Sendable {
    case sessionStarted(SessionStarted)
    case activityUpdated(SessionActivityUpdated)
    case permissionRequested(PermissionRequested)
    case questionAsked(QuestionAsked)
    case sessionCompleted(SessionCompleted)
    case jumpTargetUpdated(JumpTargetUpdated)
    case actionableStateResolved(ActionableStateResolved)
    // M2 web-agent additions:
    case webAgentTaskStarted(WebAgentTaskStarted)
    case webAgentStepUpdate(WebAgentStepUpdate)
    case webAgentApprovalRequested(WebAgentApprovalRequested)
    case webAgentTaskCompleted(WebAgentTaskCompleted)
    case webAgentTaskFailed(WebAgentTaskFailed)

    private enum CodingKeys: String, CodingKey {
        case type
        case sessionStarted
        case activityUpdated
        case permissionRequested
        case questionAsked
        case sessionCompleted
        case jumpTargetUpdated
        case actionableStateResolved
        case webAgentTaskStarted
        case webAgentStepUpdate
        case webAgentApprovalRequested
        case webAgentTaskCompleted
        case webAgentTaskFailed
    }

    private enum EventType: String, Codable {
        case sessionStarted
        case activityUpdated
        case permissionRequested
        case questionAsked
        case sessionCompleted
        case jumpTargetUpdated
        case actionableStateResolved
        case webAgentTaskStarted
        case webAgentStepUpdate
        case webAgentApprovalRequested
        case webAgentTaskCompleted
        case webAgentTaskFailed
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(EventType.self, forKey: .type)

        switch type {
        case .sessionStarted:
            self = .sessionStarted(try container.decode(SessionStarted.self, forKey: .sessionStarted))
        case .activityUpdated:
            self = .activityUpdated(try container.decode(SessionActivityUpdated.self, forKey: .activityUpdated))
        case .permissionRequested:
            self = .permissionRequested(try container.decode(PermissionRequested.self, forKey: .permissionRequested))
        case .questionAsked:
            self = .questionAsked(try container.decode(QuestionAsked.self, forKey: .questionAsked))
        case .sessionCompleted:
            self = .sessionCompleted(try container.decode(SessionCompleted.self, forKey: .sessionCompleted))
        case .jumpTargetUpdated:
            self = .jumpTargetUpdated(try container.decode(JumpTargetUpdated.self, forKey: .jumpTargetUpdated))
        case .actionableStateResolved:
            self = .actionableStateResolved(
                try container.decode(ActionableStateResolved.self, forKey: .actionableStateResolved)
            )
        case .webAgentTaskStarted:
            self = .webAgentTaskStarted(
                try container.decode(WebAgentTaskStarted.self, forKey: .webAgentTaskStarted)
            )
        case .webAgentStepUpdate:
            self = .webAgentStepUpdate(
                try container.decode(WebAgentStepUpdate.self, forKey: .webAgentStepUpdate)
            )
        case .webAgentApprovalRequested:
            self = .webAgentApprovalRequested(
                try container.decode(WebAgentApprovalRequested.self, forKey: .webAgentApprovalRequested)
            )
        case .webAgentTaskCompleted:
            self = .webAgentTaskCompleted(
                try container.decode(WebAgentTaskCompleted.self, forKey: .webAgentTaskCompleted)
            )
        case .webAgentTaskFailed:
            self = .webAgentTaskFailed(
                try container.decode(WebAgentTaskFailed.self, forKey: .webAgentTaskFailed)
            )
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case let .sessionStarted(payload):
            try container.encode(EventType.sessionStarted, forKey: .type)
            try container.encode(payload, forKey: .sessionStarted)
        case let .activityUpdated(payload):
            try container.encode(EventType.activityUpdated, forKey: .type)
            try container.encode(payload, forKey: .activityUpdated)
        case let .permissionRequested(payload):
            try container.encode(EventType.permissionRequested, forKey: .type)
            try container.encode(payload, forKey: .permissionRequested)
        case let .questionAsked(payload):
            try container.encode(EventType.questionAsked, forKey: .type)
            try container.encode(payload, forKey: .questionAsked)
        case let .sessionCompleted(payload):
            try container.encode(EventType.sessionCompleted, forKey: .type)
            try container.encode(payload, forKey: .sessionCompleted)
        case let .jumpTargetUpdated(payload):
            try container.encode(EventType.jumpTargetUpdated, forKey: .type)
            try container.encode(payload, forKey: .jumpTargetUpdated)
        case let .actionableStateResolved(payload):
            try container.encode(EventType.actionableStateResolved, forKey: .type)
            try container.encode(payload, forKey: .actionableStateResolved)
        case let .webAgentTaskStarted(payload):
            try container.encode(EventType.webAgentTaskStarted, forKey: .type)
            try container.encode(payload, forKey: .webAgentTaskStarted)
        case let .webAgentStepUpdate(payload):
            try container.encode(EventType.webAgentStepUpdate, forKey: .type)
            try container.encode(payload, forKey: .webAgentStepUpdate)
        case let .webAgentApprovalRequested(payload):
            try container.encode(EventType.webAgentApprovalRequested, forKey: .type)
            try container.encode(payload, forKey: .webAgentApprovalRequested)
        case let .webAgentTaskCompleted(payload):
            try container.encode(EventType.webAgentTaskCompleted, forKey: .type)
            try container.encode(payload, forKey: .webAgentTaskCompleted)
        case let .webAgentTaskFailed(payload):
            try container.encode(EventType.webAgentTaskFailed, forKey: .type)
            try container.encode(payload, forKey: .webAgentTaskFailed)
        }
    }
}

public struct ScheduledAgentEvent: Equatable, Sendable {
    public var delay: TimeInterval
    public var event: AgentEvent

    public init(delay: TimeInterval, event: AgentEvent) {
        self.delay = delay
        self.event = event
    }
}
