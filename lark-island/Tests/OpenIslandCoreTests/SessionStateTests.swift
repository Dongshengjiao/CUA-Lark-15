// Modified by Lark Island contributors, 2026-04-28. Originally from open-vibe-island. See lark-island/NOTICE.md.
// Stripped of all coding-agent specific reducer tests (claude/codex/gemini hook flows,
// process-liveness polling, codex.app classification). Retains the generic event lifecycle
// coverage that the new SessionState reducer still supports.

import Testing
@testable import OpenIslandCore
import Foundation

@Suite("SessionState reducer")
struct SessionStateTests {
    private let now = Date(timeIntervalSince1970: 1_730_000_000)

    @Test("apply sessionStarted creates a new attached session")
    func sessionStartedCreatesSession() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1",
            title: "Sample web task",
            tool: .webAgent,
            origin: .live,
            initialPhase: .running,
            summary: "Looking up something",
            timestamp: now
        )))

        #expect(state.sessions.count == 1)
        let session = try? #require(state.session(id: "s1"))
        #expect(session?.title == "Sample web task")
        #expect(session?.tool == .webAgent)
        #expect(session?.attachmentState == .attached)
        #expect(session?.phase == .running)
    }

    @Test("activityUpdated changes phase and summary")
    func activityUpdated() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1",
            title: "t",
            tool: .webAgent,
            summary: "initial",
            timestamp: now
        )))
        state.apply(.activityUpdated(SessionActivityUpdated(
            sessionID: "s1",
            summary: "phase 2",
            phase: .completed,
            timestamp: now.addingTimeInterval(1)
        )))

        #expect(state.session(id: "s1")?.summary == "phase 2")
        #expect(state.session(id: "s1")?.phase == .completed)
    }

    @Test("permissionRequested transitions to waitingForApproval and stores request")
    func permissionRequested() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1", title: "t", tool: .webAgent, summary: "s", timestamp: now
        )))
        let request = PermissionRequest(
            title: "Allow click?",
            summary: "click submit button",
            affectedPath: "/login"
        )
        state.apply(.permissionRequested(PermissionRequested(
            sessionID: "s1", request: request, timestamp: now.addingTimeInterval(1)
        )))

        let session = state.session(id: "s1")
        #expect(session?.phase == .waitingForApproval)
        #expect(session?.permissionRequest == request)
    }

    @Test("questionAsked transitions to waitingForAnswer and stores prompt")
    func questionAsked() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1", title: "t", tool: .webAgent, summary: "s", timestamp: now
        )))
        let prompt = QuestionPrompt(title: "Pick one", options: ["a", "b"])
        state.apply(.questionAsked(QuestionAsked(
            sessionID: "s1", prompt: prompt, timestamp: now.addingTimeInterval(1)
        )))

        let session = state.session(id: "s1")
        #expect(session?.phase == .waitingForAnswer)
        #expect(session?.questionPrompt == prompt)
    }

    @Test("sessionCompleted clears pending interactions")
    func sessionCompleted() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1", title: "t", tool: .webAgent, summary: "s", timestamp: now
        )))
        state.apply(.permissionRequested(PermissionRequested(
            sessionID: "s1",
            request: PermissionRequest(title: "x", summary: "y", affectedPath: "/"),
            timestamp: now.addingTimeInterval(1)
        )))
        state.apply(.sessionCompleted(SessionCompleted(
            sessionID: "s1", summary: "all done", timestamp: now.addingTimeInterval(2)
        )))

        let session = state.session(id: "s1")
        #expect(session?.phase == .completed)
        #expect(session?.permissionRequest == nil)
        #expect(session?.questionPrompt == nil)
    }

    @Test("jumpTargetUpdated updates jump metadata")
    func jumpTargetUpdated() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1", title: "t", tool: .webAgent, summary: "s", timestamp: now
        )))
        let target = JumpTarget(
            terminalApp: "Chromium",
            workspaceName: "feishu",
            paneTitle: "IM"
        )
        state.apply(.jumpTargetUpdated(JumpTargetUpdated(
            sessionID: "s1", jumpTarget: target, timestamp: now.addingTimeInterval(1)
        )))

        #expect(state.session(id: "s1")?.jumpTarget == target)
    }

    @Test("actionableStateResolved returns to running")
    func actionableStateResolved() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1", title: "t", tool: .webAgent, summary: "s", timestamp: now
        )))
        state.apply(.permissionRequested(PermissionRequested(
            sessionID: "s1",
            request: PermissionRequest(title: "x", summary: "y", affectedPath: "/"),
            timestamp: now.addingTimeInterval(1)
        )))
        state.apply(.actionableStateResolved(ActionableStateResolved(
            sessionID: "s1",
            summary: "answered upstream",
            timestamp: now.addingTimeInterval(2)
        )))

        let session = state.session(id: "s1")
        #expect(session?.phase == .running)
        #expect(session?.permissionRequest == nil)
    }

    @Test("resolvePermission(allowOnce) sets running with success summary")
    func resolvePermissionApprove() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1", title: "t", tool: .webAgent, summary: "s", timestamp: now
        )))
        state.apply(.permissionRequested(PermissionRequested(
            sessionID: "s1",
            request: PermissionRequest(title: "x", summary: "y", affectedPath: "/"),
            timestamp: now.addingTimeInterval(1)
        )))
        state.resolvePermission(sessionID: "s1", resolution: .allowOnce, at: now.addingTimeInterval(2))

        let session = state.session(id: "s1")
        #expect(session?.phase == .running)
        #expect(session?.permissionRequest == nil)
    }

    @Test("answerQuestion clears prompt and runs")
    func answerQuestionFlow() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1", title: "t", tool: .webAgent, summary: "s", timestamp: now
        )))
        state.apply(.questionAsked(QuestionAsked(
            sessionID: "s1",
            prompt: QuestionPrompt(title: "Pick", options: ["a"]),
            timestamp: now.addingTimeInterval(1)
        )))
        state.answerQuestion(
            sessionID: "s1",
            response: QuestionPromptResponse(answer: "a"),
            at: now.addingTimeInterval(2)
        )

        let session = state.session(id: "s1")
        #expect(session?.phase == .running)
        #expect(session?.questionPrompt == nil)
        #expect(session?.summary.contains("a") == true)
    }

    @Test("removeInvisibleSessions drops completed sessions")
    func removeInvisibleSessions() {
        var state = SessionState()
        state.apply(.sessionStarted(SessionStarted(
            sessionID: "s1", title: "t", tool: .webAgent, summary: "s", timestamp: now
        )))
        state.apply(.sessionCompleted(SessionCompleted(
            sessionID: "s1", summary: "done", timestamp: now.addingTimeInterval(1)
        )))

        let removed = state.removeInvisibleSessions()
        #expect(removed)
        #expect(state.sessions.isEmpty)
    }

    @Test("AgentEvent codable round-trip preserves payload")
    func agentEventRoundTrip() throws {
        let original = AgentEvent.sessionStarted(SessionStarted(
            sessionID: "s1",
            title: "t",
            tool: .webAgent,
            summary: "running",
            timestamp: now,
            jumpTarget: JumpTarget(terminalApp: "Chromium", workspaceName: "feishu", paneTitle: "IM"),
            isRemote: false
        ))

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AgentEvent.self, from: data)
        #expect(decoded == original)
    }

    @Test("BridgeCommand codable round-trip")
    func bridgeCommandRoundTrip() throws {
        let original = BridgeCommand.registerClient(role: .observer)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(BridgeCommand.self, from: data)
        #expect(decoded == original)
    }
}
