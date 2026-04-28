// Modified by Lark Island contributors, 2026-04-28. Originally from open-vibe-island. See lark-island/NOTICE.md.
// Stripped of all coding-agent specific reducer paths (codex/claude/gemini metadata, hook lifecycle,
// process liveness polling, codex.app classification). Retains the generic session lifecycle:
// session started/updated/permission/question/completed/jump.

import Foundation

public struct SessionState: Equatable, Sendable {
    public private(set) var sessionsByID: [String: AgentSession]

    public init(sessions: [AgentSession] = []) {
        self.sessionsByID = Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) })
    }

    public var sessions: [AgentSession] {
        sessionsByID.values.sorted { lhs, rhs in
            if lhs.updatedAt == rhs.updatedAt {
                return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
            }
            return lhs.updatedAt > rhs.updatedAt
        }
    }

    public var activeActionableSession: AgentSession? {
        sessions.first(where: { $0.phase.requiresAttention })
    }

    public var runningCount: Int {
        sessionsByID.values.filter { $0.phase == .running }.count
    }

    public var attentionCount: Int {
        sessionsByID.values.filter { $0.phase.requiresAttention }.count
    }

    public var liveSessionCount: Int {
        sessionsByID.values.filter(\.isVisibleInIsland).count
    }

    public var liveAttentionCount: Int {
        sessionsByID.values.filter { $0.isVisibleInIsland && $0.phase.requiresAttention }.count
    }

    public var liveRunningCount: Int {
        sessionsByID.values.filter { $0.isVisibleInIsland && $0.phase == .running }.count
    }

    public var completedCount: Int {
        sessionsByID.values.filter { $0.phase == .completed }.count
    }

    public func session(id: String?) -> AgentSession? {
        guard let id else {
            return nil
        }
        return sessionsByID[id]
    }

    public mutating func apply(_ event: AgentEvent) {
        switch event {
        case let .sessionStarted(payload):
            let session = AgentSession(
                id: payload.sessionID,
                title: payload.title,
                tool: payload.tool,
                origin: payload.origin,
                attachmentState: .attached,
                phase: payload.initialPhase,
                summary: payload.summary,
                updatedAt: payload.timestamp,
                jumpTarget: payload.jumpTarget,
                isRemote: payload.isRemote
            )
            upsert(session)

        case let .activityUpdated(payload):
            guard var session = sessionsByID[payload.sessionID] else {
                return
            }

            let keepsPendingApproval = payload.phase == .running
                && session.phase == .waitingForApproval
                && session.permissionRequest != nil
            let keepsPendingQuestion = payload.phase == .running
                && session.phase == .waitingForAnswer
                && session.questionPrompt != nil
            let preservesActionableState = keepsPendingApproval || keepsPendingQuestion

            if !preservesActionableState {
                session.phase = payload.phase
                session.summary = payload.summary
                if payload.phase != .waitingForApproval {
                    session.permissionRequest = nil
                }
                if payload.phase != .waitingForAnswer {
                    session.questionPrompt = nil
                }
            }

            session.updatedAt = payload.timestamp
            upsert(session)

        case let .permissionRequested(payload):
            guard var session = sessionsByID[payload.sessionID] else {
                return
            }

            session.phase = .waitingForApproval
            session.summary = payload.request.summary
            session.permissionRequest = payload.request
            session.questionPrompt = nil
            session.updatedAt = payload.timestamp
            upsert(session)

        case let .questionAsked(payload):
            guard var session = sessionsByID[payload.sessionID] else {
                return
            }

            session.phase = .waitingForAnswer
            session.summary = payload.prompt.title
            session.questionPrompt = payload.prompt
            session.permissionRequest = nil
            session.updatedAt = payload.timestamp
            upsert(session)

        case let .sessionCompleted(payload):
            guard var session = sessionsByID[payload.sessionID] else {
                return
            }

            session.phase = .completed
            session.summary = payload.summary
            session.permissionRequest = nil
            session.questionPrompt = nil
            session.updatedAt = payload.timestamp
            upsert(session)

        case let .jumpTargetUpdated(payload):
            guard var session = sessionsByID[payload.sessionID] else {
                return
            }

            session.jumpTarget = payload.jumpTarget
            session.updatedAt = payload.timestamp
            upsert(session)

        case let .actionableStateResolved(payload):
            guard var session = sessionsByID[payload.sessionID] else {
                return
            }

            guard session.phase == .waitingForApproval || session.phase == .waitingForAnswer else {
                return
            }

            session.phase = .running
            session.summary = payload.summary
            session.permissionRequest = nil
            session.questionPrompt = nil
            session.updatedAt = payload.timestamp
            upsert(session)

        // MARK: - Web Agent (M2)

        case let .webAgentTaskStarted(payload):
            // taskID becomes the sessionID for this web-agent run.
            let session = AgentSession(
                id: payload.taskID,
                title: payload.prompt,
                tool: .webAgent,
                origin: .live,
                attachmentState: .attached,
                phase: .running,
                summary: payload.skill.map { "skill=\($0)" } ?? "general task",
                updatedAt: payload.timestamp
            )
            upsert(session)

        case let .webAgentStepUpdate(payload):
            guard var session = sessionsByID[payload.taskID] else {
                return
            }
            // Build a one-line summary the island UI can render: "step N · <action> · <thought head>".
            let head = payload.thought.split(separator: "\n").first.map(String.init) ?? payload.thought
            let trimmed = head.count > 80 ? String(head.prefix(77)) + "…" : head
            let actionLabel = payload.actionType ?? "thinking"
            session.summary = "step \(payload.stepIndex) · \(actionLabel) · \(trimmed)"
            session.updatedAt = payload.timestamp
            // M6: track the latest step's screenshot path so the island
            // UI can render a live thumbnail. screenshotURL is the
            // absolute on-disk path of the just-saved jpg (the wire
            // protocol forbids inline base64).
            if let screenshotPath = payload.screenshotURL,
               !screenshotPath.isEmpty {
                session.latestScreenshotURL = screenshotPath
            }
            // M5: any forward progress event clears prior approval/question
            // gates and snaps the session back to running. Without this the
            // QR-scan UI would be stuck on .waitingForApproval forever even
            // after the runner resumed GUIAgent steps.
            if session.phase == .waitingForApproval || session.phase == .waitingForAnswer {
                session.phase = .running
                session.permissionRequest = nil
                session.questionPrompt = nil
            }
            upsert(session)

        case let .webAgentApprovalRequested(payload):
            guard var session = sessionsByID[payload.taskID] else {
                return
            }
            session.phase = .waitingForApproval
            session.summary = payload.message
            session.permissionRequest = PermissionRequest(
                title: payload.kind,
                summary: payload.message,
                affectedPath: ""
            )
            session.updatedAt = payload.timestamp
            upsert(session)

        case let .webAgentTaskCompleted(payload):
            guard var session = sessionsByID[payload.taskID] else {
                return
            }
            session.phase = .completed
            session.summary = payload.finalAnswer
            session.permissionRequest = nil
            session.questionPrompt = nil
            session.updatedAt = payload.timestamp
            upsert(session)

        case let .webAgentTaskFailed(payload):
            guard var session = sessionsByID[payload.taskID] else {
                return
            }
            session.phase = .completed
            session.summary = "\(payload.kind.rawValue): \(payload.message)"
            session.permissionRequest = nil
            session.questionPrompt = nil
            session.updatedAt = payload.timestamp
            upsert(session)
        }
    }

    public mutating func resolvePermission(
        sessionID: String,
        resolution: PermissionResolution,
        at timestamp: Date = .now
    ) {
        guard var session = sessionsByID[sessionID] else {
            return
        }

        session.permissionRequest = nil
        session.updatedAt = timestamp

        if resolution.isApproved {
            session.phase = .running
            session.summary = "Permission approved. Agent resumed work."
        } else {
            session.phase = .completed
            session.summary = "Permission denied."
        }

        upsert(session)
    }

    public mutating func answerQuestion(
        sessionID: String,
        response: QuestionPromptResponse,
        at timestamp: Date = .now
    ) {
        guard var session = sessionsByID[sessionID] else {
            return
        }

        session.questionPrompt = nil
        session.phase = .running
        let summary = response.displaySummary
        session.summary = summary.isEmpty ? "Answered the question." : "Answered: \(summary)"
        session.updatedAt = timestamp
        upsert(session)
    }

    @discardableResult
    public mutating func reconcileAttachmentStates(_ updates: [String: SessionAttachmentState]) -> Bool {
        var changed = false

        for (sessionID, attachmentState) in updates {
            guard var session = sessionsByID[sessionID],
                  session.attachmentState != attachmentState else {
                continue
            }

            session.attachmentState = attachmentState
            upsert(session)
            changed = true
        }

        return changed
    }

    @discardableResult
    public mutating func reconcileJumpTargets(_ updates: [String: JumpTarget]) -> Bool {
        var changed = false

        for (sessionID, jumpTarget) in updates {
            guard var session = sessionsByID[sessionID],
                  session.jumpTarget != jumpTarget else {
                continue
            }

            session.jumpTarget = jumpTarget
            upsert(session)
            changed = true
        }

        return changed
    }

    /// Manually mark a session as completed.
    public mutating func dismissSession(id: String) {
        guard var session = sessionsByID[id] else { return }
        session.phase = .completed
        session.updatedAt = .now
        upsert(session)
    }

    /// Remove sessions that are no longer visible in the island.
    /// Returns `true` if any sessions were removed.
    @discardableResult
    public mutating func removeInvisibleSessions() -> Bool {
        let before = sessionsByID.count
        sessionsByID = sessionsByID.filter { _, session in
            session.isVisibleInIsland
        }
        return sessionsByID.count != before
    }

    private mutating func upsert(_ session: AgentSession) {
        sessionsByID[session.id] = session
    }
}
