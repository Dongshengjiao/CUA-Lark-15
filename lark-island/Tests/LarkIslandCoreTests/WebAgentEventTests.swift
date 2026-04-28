// M2: round-trip tests for the web-agent envelope schema.
//
// Each test:
//   1. Constructs an expected Swift struct.
//   2. Encodes via BridgeCodec, decodes the result, and asserts the
//      decoded value `==` the original.
//   3. Loads the matching JSON fixture from disk and decodes it,
//      asserting it `==` the original. The fixture is the contract
//      shared with `runners/web-agent/test/bridge.test.ts`.
//   4. If the fixture file is missing, the test writes the canonical
//      encoding to disk so it can be committed. This is the
//      "snapshot" workflow: first run produces the fixture, every
//      subsequent run validates against it.

import Testing
@testable import LarkIslandCore
import Foundation

@Suite("Web-agent envelope schema (M2)")
struct WebAgentEventTests {
    /// 1730000000000 ms = 2024-10-27 04:53:20 UTC. Stable across runs
    /// because it does not depend on `Date.now`.
    private let canonicalDate = Date(timeIntervalSince1970: 1_730_000_000)

    private static var fixturesDirectory: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("web-agent-bridge")
    }

    /// Round-trip helper. Encodes via BridgeCodec, decodes the line back,
    /// asserts equality, then snapshots to the named fixture.
    private func roundTrip(
        _ envelope: BridgeEnvelope,
        fixture name: String
    ) throws -> Data {
        var line = try BridgeCodec.encodeLine(envelope)
        let decoded = try BridgeCodec.decodeLines(from: &line)
        #expect(line.isEmpty, "BridgeCodec.decodeLines should consume the entire frame")
        #expect(decoded.count == 1, "Expected exactly one envelope round-tripped")
        #expect(decoded.first == envelope, "Round-tripped envelope must equal the original")

        // Snapshot the JSON without the trailing newline so fixtures
        // are valid standalone JSON files.
        var encoded = try BridgeCodec.encodeLine(envelope)
        if encoded.last == 0x0A {
            encoded.removeLast()
        }
        try snapshot(encoded, named: name)
        return encoded
    }

    private func snapshot(_ data: Data, named name: String) throws {
        let dir = Self.fixturesDirectory
        try FileManager.default.createDirectory(
            at: dir,
            withIntermediateDirectories: true
        )
        let url = dir.appendingPathComponent("\(name).json")

        if FileManager.default.fileExists(atPath: url.path) {
            // Validate against the existing snapshot — schema drift detector.
            let onDisk = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .millisecondsSince1970
            let decodedFromFixture = try decoder.decode(BridgeEnvelope.self, from: onDisk)
            let decodedFromInput = try decoder.decode(BridgeEnvelope.self, from: data)
            #expect(
                decodedFromFixture == decodedFromInput,
                "Fixture \(name).json drifted from canonical encoding. Delete it locally and re-run to regenerate."
            )
        } else {
            // First run after schema change: write the snapshot.
            try data.write(to: url)
        }
    }

    // MARK: - BridgeHello

    @Test("BridgeHello v2 round-trips and snapshots")
    func helloV2() throws {
        let env = BridgeEnvelope.hello(BridgeHello())
        // Defaults must produce v2.
        if case let .hello(hello) = env {
            #expect(hello.protocolVersion == 2)
            #expect(hello.serverLabel == "lark-island-bridge")
        } else {
            #expect(Bool(false), "Envelope should be .hello")
        }
        _ = try roundTrip(env, fixture: "hello-v2")
    }

    // MARK: - BridgeCommand

    @Test("registerClient(.webAgentRunner) round-trips")
    func registerWebAgentRunner() throws {
        let env = BridgeEnvelope.command(.registerClient(role: .webAgentRunner))
        _ = try roundTrip(env, fixture: "register-web-agent-runner")
    }

    @Test("registerClient(.observer) round-trips")
    func registerObserver() throws {
        let env = BridgeEnvelope.command(.registerClient(role: .observer))
        _ = try roundTrip(env, fixture: "register-observer")
    }

    @Test("runWebAgentTask round-trips with all fields")
    func runWebAgentTaskFull() throws {
        let env = BridgeEnvelope.command(.runWebAgentTask(
            taskID: "task-001",
            prompt: "give 张三 a Lark message saying hello",
            skill: "feishu_im_send",
            profileName: "qwen-default"
        ))
        _ = try roundTrip(env, fixture: "run-web-agent-task")
    }

    @Test("runWebAgentTask round-trips with optional fields nil")
    func runWebAgentTaskMinimal() throws {
        let env = BridgeEnvelope.command(.runWebAgentTask(
            taskID: "task-002",
            prompt: "search for UI-TARS",
            skill: nil,
            profileName: nil
        ))
        _ = try roundTrip(env, fixture: "run-web-agent-task-minimal")
    }

    // MARK: - AgentEvent web-agent cases

    @Test("webAgentTaskStarted round-trips and snapshots")
    func webAgentTaskStarted() throws {
        let env = BridgeEnvelope.event(.webAgentTaskStarted(WebAgentTaskStarted(
            taskID: "task-001",
            prompt: "give 张三 a Lark message saying hello",
            skill: "feishu_im_send",
            profileName: "qwen-default",
            timestamp: canonicalDate
        )))
        _ = try roundTrip(env, fixture: "web-agent-task-started")
    }

    @Test("webAgentStepUpdate round-trips with all fields")
    func webAgentStepUpdateFull() throws {
        let env = BridgeEnvelope.event(.webAgentStepUpdate(WebAgentStepUpdate(
            taskID: "task-001",
            stepIndex: 3,
            thought: "I see the Feishu home page; I need to click the search box.",
            actionRaw: "click(start_box='[420, 80, 600, 120]')",
            actionType: "click",
            screenshotURL: "/Users/alice/Library/Application Support/LarkIsland/web-agent/screenshots/task-001/3.jpg",
            costMs: 6_955,
            costTokens: 1_424,
            timestamp: canonicalDate
        )))
        _ = try roundTrip(env, fixture: "web-agent-step-update")
    }

    @Test("webAgentStepUpdate round-trips with optional fields nil")
    func webAgentStepUpdateMinimal() throws {
        let env = BridgeEnvelope.event(.webAgentStepUpdate(WebAgentStepUpdate(
            taskID: "task-001",
            stepIndex: 0,
            thought: "Starting.",
            timestamp: canonicalDate
        )))
        _ = try roundTrip(env, fixture: "web-agent-step-update-minimal")
    }

    @Test("webAgentApprovalRequested round-trips (login QR scenario)")
    func webAgentApprovalRequested() throws {
        let env = BridgeEnvelope.event(.webAgentApprovalRequested(WebAgentApprovalRequested(
            taskID: "task-001",
            kind: "login_qr",
            message: "请扫描浏览器中的二维码登录飞书",
            timestamp: canonicalDate
        )))
        _ = try roundTrip(env, fixture: "web-agent-approval-requested")
    }

    @Test("webAgentTaskCompleted round-trips")
    func webAgentTaskCompleted() throws {
        let env = BridgeEnvelope.event(.webAgentTaskCompleted(WebAgentTaskCompleted(
            taskID: "task-001",
            finalAnswer: "Sent message 'hello' to 张三 at 16:45.",
            totalSteps: 8,
            totalTokens: 12_345,
            totalMs: 51_836,
            timestamp: canonicalDate
        )))
        _ = try roundTrip(env, fixture: "web-agent-task-completed")
    }

    @Test("webAgentTaskFailed encodes vlmTimeout kind as camelCase string")
    func webAgentTaskFailedVlmTimeout() throws {
        let env = BridgeEnvelope.event(.webAgentTaskFailed(WebAgentTaskFailed(
            taskID: "task-001",
            kind: .vlmTimeout,
            message: "Request to qwen3-vl-plus timed out after 180000ms",
            timestamp: canonicalDate
        )))
        let data = try roundTrip(env, fixture: "web-agent-task-failed-vlm-timeout")

        // Wire-format check: the kind must serialize to "vlmTimeout".
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let event = json["event"] as? [String: Any],
              let payload = event["webAgentTaskFailed"] as? [String: Any],
              let kind = payload["kind"] as? String else {
            #expect(Bool(false), "Failed to navigate JSON to kind field")
            return
        }
        #expect(kind == "vlmTimeout")
    }

    @Test("WebAgentFailureKind covers all four cases")
    func failureKinds() throws {
        for kind in [
            WebAgentFailureKind.vlmTimeout,
            .vlmError,
            .pageError,
            .cancelled,
        ] {
            let env = BridgeEnvelope.event(.webAgentTaskFailed(WebAgentTaskFailed(
                taskID: "t",
                kind: kind,
                message: "test",
                timestamp: canonicalDate
            )))
            var data = try BridgeCodec.encodeLine(env)
            let decoded = try BridgeCodec.decodeLines(from: &data)
            #expect(decoded.first == env)
        }
    }
}
