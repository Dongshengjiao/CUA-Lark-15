// Modified by Lark Island contributors, 2026-04-28. Originally from open-vibe-island. See lark-island/NOTICE.md.
// Stripped of all coding-agent specific metadata (codex/claude/gemini/openCode/cursor),
// retains only the generic shell types reusable for the web-agent product.

import Foundation

public enum AgentTool: String, CaseIterable, Codable, Sendable {
    case webAgent

    public var displayName: String {
        switch self {
        case .webAgent:
            "Web Agent"
        }
    }

    public var shortName: String {
        switch self {
        case .webAgent:
            "WEB"
        }
    }
}

public enum SessionOrigin: String, Codable, Sendable {
    case live
    case demo
}

public enum SessionAttachmentState: String, Codable, Sendable {
    case attached
    case stale
    case detached

    public var isLive: Bool {
        self == .attached
    }
}

public enum SessionPhase: String, Codable, Sendable, CaseIterable {
    case running
    case waitingForApproval
    case waitingForAnswer
    case completed

    public var displayName: String {
        switch self {
        case .running:
            "Running"
        case .waitingForApproval:
            "Needs approval"
        case .waitingForAnswer:
            "Needs answer"
        case .completed:
            "Completed"
        }
    }

    public var requiresAttention: Bool {
        switch self {
        case .waitingForApproval, .waitingForAnswer:
            true
        case .running, .completed:
            false
        }
    }
}

/// Generic jump-back target. Retained from the original Open Island design but
/// simplified — the web-agent product mainly cares about `terminalApp` /
/// `workspaceName` for breadcrumb display.
public struct JumpTarget: Equatable, Codable, Sendable {
    public var terminalApp: String
    public var workspaceName: String
    public var paneTitle: String
    public var workingDirectory: String?

    public init(
        terminalApp: String,
        workspaceName: String,
        paneTitle: String,
        workingDirectory: String? = nil
    ) {
        self.terminalApp = terminalApp
        self.workspaceName = workspaceName
        self.paneTitle = paneTitle
        self.workingDirectory = workingDirectory
    }
}

public struct PermissionRequest: Equatable, Identifiable, Codable, Sendable {
    public var id: UUID
    public var title: String
    public var summary: String
    public var affectedPath: String
    public var primaryActionTitle: String
    public var secondaryActionTitle: String
    public var toolName: String?
    public var toolUseID: String?
    public var requiresTerminalApproval: Bool

    public init(
        id: UUID = UUID(),
        title: String,
        summary: String,
        affectedPath: String,
        primaryActionTitle: String = "Allow",
        secondaryActionTitle: String = "Deny",
        toolName: String? = nil,
        toolUseID: String? = nil,
        requiresTerminalApproval: Bool = false
    ) {
        self.id = id
        self.title = title
        self.summary = summary
        self.affectedPath = affectedPath
        self.primaryActionTitle = primaryActionTitle
        self.secondaryActionTitle = secondaryActionTitle
        self.toolName = toolName
        self.toolUseID = toolUseID
        self.requiresTerminalApproval = requiresTerminalApproval
    }
}

/// A single selectable option within a structured question prompt.
public struct QuestionOption: Equatable, Identifiable, Codable, Sendable {
    public var id: UUID
    public var label: String
    public var description: String
    /// When true, the submitted answer is the user's typed text, not the label.
    public var allowsFreeform: Bool

    public init(
        id: UUID = UUID(),
        label: String,
        description: String = "",
        allowsFreeform: Bool = false
    ) {
        self.id = id
        self.label = label
        self.description = description
        self.allowsFreeform = allowsFreeform
    }
}

public struct QuestionPromptItem: Equatable, Codable, Sendable {
    public var question: String
    public var header: String
    public var options: [QuestionOption]
    public var multiSelect: Bool

    public init(
        question: String,
        header: String,
        options: [QuestionOption],
        multiSelect: Bool = false
    ) {
        self.question = question
        self.header = header
        self.options = options
        self.multiSelect = multiSelect
    }
}

public struct QuestionPrompt: Equatable, Identifiable, Codable, Sendable {
    public var id: UUID
    public var title: String
    public var options: [String]
    public var questions: [QuestionPromptItem]

    public init(
        id: UUID = UUID(),
        title: String,
        options: [String],
        questions: [QuestionPromptItem] = []
    ) {
        self.id = id
        self.title = title
        self.options = options
        self.questions = questions
    }

    public init(
        id: UUID = UUID(),
        title: String,
        questions: [QuestionPromptItem]
    ) {
        self.id = id
        self.title = title
        self.questions = questions
        self.options = questions.first?.options.map(\.label) ?? []
    }
}

public struct QuestionAnswerAnnotation: Equatable, Codable, Sendable {
    public var preview: String?
    public var notes: String?

    public init(preview: String? = nil, notes: String? = nil) {
        self.preview = preview
        self.notes = notes
    }
}

public struct QuestionPromptResponse: Equatable, Codable, Sendable {
    public var rawAnswer: String?
    public var answers: [String: String]
    public var annotations: [String: QuestionAnswerAnnotation]

    public init(
        rawAnswer: String? = nil,
        answers: [String: String] = [:],
        annotations: [String: QuestionAnswerAnnotation] = [:]
    ) {
        self.rawAnswer = rawAnswer
        self.answers = answers
        self.annotations = annotations
    }

    public init(answer: String) {
        self.init(rawAnswer: answer)
    }

    public var displaySummary: String {
        if let rawAnswer, !rawAnswer.isEmpty {
            return rawAnswer
        }

        let renderedAnswers = answers
            .keys
            .sorted()
            .compactMap { key -> String? in
                guard let value = answers[key], !value.isEmpty else {
                    return nil
                }

                return "\(key): \(value)"
            }

        return renderedAnswers.joined(separator: " · ")
    }
}

/// User-facing approval action shown in the island notification card.
public enum ApprovalAction: Sendable {
    case deny
    case allowOnce
}

public enum PermissionResolution: Equatable, Codable, Sendable {
    case allowOnce
    case deny(message: String? = nil, interrupt: Bool = false)

    public var isApproved: Bool {
        switch self {
        case .allowOnce:
            true
        case .deny:
            false
        }
    }
}

public struct AgentSession: Equatable, Identifiable, Codable, Sendable {
    public var id: String
    public var title: String
    public var tool: AgentTool
    public var origin: SessionOrigin?
    public var attachmentState: SessionAttachmentState
    public var phase: SessionPhase
    public var summary: String
    public var updatedAt: Date
    public var permissionRequest: PermissionRequest?
    public var questionPrompt: QuestionPrompt?
    public var jumpTarget: JumpTarget?

    /// M6: absolute file path of the most recent webAgentStepUpdate
    /// screenshot for this session. The island UI renders it as a
    /// small live thumbnail in the opened state. nil for sessions that
    /// haven't reported a screenshot yet.
    public var latestScreenshotURL: String?

    /// Whether this session originates from a remote (SSH) connection.
    public var isRemote: Bool = false

    public init(
        id: String,
        title: String,
        tool: AgentTool,
        origin: SessionOrigin? = nil,
        attachmentState: SessionAttachmentState = .stale,
        phase: SessionPhase,
        summary: String,
        updatedAt: Date,
        permissionRequest: PermissionRequest? = nil,
        questionPrompt: QuestionPrompt? = nil,
        jumpTarget: JumpTarget? = nil,
        latestScreenshotURL: String? = nil,
        isRemote: Bool = false
    ) {
        self.id = id
        self.title = title
        self.tool = tool
        self.origin = origin
        self.attachmentState = attachmentState
        self.phase = phase
        self.summary = summary
        self.updatedAt = updatedAt
        self.permissionRequest = permissionRequest
        self.questionPrompt = questionPrompt
        self.jumpTarget = jumpTarget
        self.latestScreenshotURL = latestScreenshotURL
        self.isRemote = isRemote
    }
}

public extension AgentSession {
    var isDemoSession: Bool {
        origin == .demo
    }

    var isAttachedToTerminal: Bool {
        attachmentState.isLive
    }

    /// Visibility rule for the island UI.
    /// In the web-agent product, sessions are always either running, asking
    /// for approval, asking a question, or completed — all visible until
    /// dismissed. Demo sessions are always shown.
    var isVisibleInIsland: Bool {
        if isDemoSession { return true }
        if phase.requiresAttention { return true }
        // Running web-agent tasks stay visible.
        return phase != .completed
    }
}
