# Tasks: m2-bridge-web-agent-events

## 1. Swift side — LarkIslandCore schema

- [ ] 1.1 In [`Sources/LarkIslandCore/AgentEvent.swift`](../../../lark-island/Sources/LarkIslandCore/AgentEvent.swift), add 5 new payload structs (`WebAgentTaskStarted`, `WebAgentStepUpdate`, `WebAgentApprovalRequested`, `WebAgentTaskCompleted`, `WebAgentTaskFailed`) with the exact field set listed in `specs/web-agent-bridge/spec.md` Requirement "AgentEvent supports five web-agent cases"
- [ ] 1.2 Add `WebAgentFailureKind` String enum with cases `vlmTimeout`, `vlmError`, `pageError`, `cancelled`; ensure Codable rawValue matches camelCase
- [ ] 1.3 Add 5 new cases to the `AgentEvent` enum
- [ ] 1.4 Update `AgentEvent.CodingKeys`, `EventType`, manual `init(from:)` and `encode(to:)` to handle the new cases (follow the existing pattern for `sessionStarted` etc.)
- [ ] 1.5 In [`Sources/LarkIslandCore/BridgeTransport.swift`](../../../lark-island/Sources/LarkIslandCore/BridgeTransport.swift), add `case webAgentRunner` to `BridgeClientRole`
- [ ] 1.6 Add `case runWebAgentTask(taskID: String, prompt: String, skill: String?, profileName: String?)` to `BridgeCommand` and update its CodingKeys / CommandType / `init(from:)` / `encode(to:)` (no apiKey field)
- [ ] 1.7 Bump `BridgeHello.protocolVersion` default from `1` to `2`

## 2. Swift side — SessionState reducer

- [ ] 2.1 In [`Sources/LarkIslandCore/SessionState.swift`](../../../lark-island/Sources/LarkIslandCore/SessionState.swift) `apply(_:)`, add reducer paths for the 5 new web-agent events. `webAgentTaskStarted` upserts a new running session; `webAgentStepUpdate` updates summary + updatedAt only; `webAgentApprovalRequested` transitions to `.waitingForApproval`; `webAgentTaskCompleted` transitions to `.completed` with `finalAnswer` as summary; `webAgentTaskFailed` transitions to `.completed` with `kind: message` as summary
- [ ] 2.2 Make sure the existing `removeInvisibleSessions` rule still works for completed web-agent sessions (it will, because `phase == .completed` is the trigger)

## 3. Swift side — BridgeServer routing

- [ ] 3.1 In [`Sources/LarkIslandCore/BridgeServer.swift`](../../../lark-island/Sources/LarkIslandCore/BridgeServer.swift) `handleCommand(_:fromClient:)`, add a switch case for `runWebAgentTask` that calls the registered `commandHandler` (same path as the other commands)
- [ ] 3.2 Confirm `broadcast(_:)` already filters `client.role == .observer` so runners don't echo. Add a unit test if not yet covered.

## 4. Swift side — tests

- [ ] 4.1 Create [`Tests/LarkIslandCoreTests/WebAgentEventTests.swift`](../../../lark-island/Tests/LarkIslandCoreTests/WebAgentEventTests.swift) using swift-testing's `@Test`. Include round-trip tests for each of the 5 new event cases + `runWebAgentTask` command + role hello. Use deterministic `Date(timeIntervalSince1970: 1_730_000_000)` to keep fixtures stable.
- [ ] 4.2 Save canonical encoded JSON for each case to `Tests/LarkIslandCoreTests/Fixtures/web-agent-bridge/<case>.json`. Both Swift tests and TS tests read the same files — this is the schema-drift detector.
- [ ] 4.3 Run `cd lark-island && swift test`; all tests pass

## 5. TypeScript side — runner codec

- [ ] 5.1 Create `runners/web-agent/src/bridge/types.ts` defining TypeScript types for `BridgeHello`, `BridgeClientRole` ('observer' | 'webAgentRunner'), `BridgeCommand` (4 cases incl. `runWebAgentTask`), `BridgeResponse`, `WebAgentFailureKind`, the 5 web-agent payloads, `AgentEvent` (existing 7 cases + 5 new), and `BridgeEnvelope` discriminated union
- [ ] 5.2 Create `runners/web-agent/src/bridge/codec.ts` with `encodeEnvelope(env: BridgeEnvelope): string` (returns newline-suffixed JSON) and `decodeEnvelope(line: string): BridgeEnvelope` (throws on malformed JSON; performs the same `type` field demux that Swift does)
- [ ] 5.3 Re-export from `runners/web-agent/src/bridge/index.ts`

## 6. TypeScript side — tests

- [ ] 6.1 Add vitest as devDep: `npm install --save-dev vitest`
- [ ] 6.2 Add `"test": "vitest run"` to `runners/web-agent/package.json` scripts
- [ ] 6.3 Create `runners/web-agent/test/bridge.test.ts` with the same round-trip cases the Swift side has. Use the **same** fixture files at `lark-island/Tests/LarkIslandCoreTests/Fixtures/web-agent-bridge/` (read via relative path) so byte-level drift between sides triggers a failure
- [ ] 6.4 Run `cd runners/web-agent && npm test`; all tests pass

## 7. Wrap-up

- [ ] 7.1 Run `npx @fission-ai/openspec validate m2-bridge-web-agent-events` — change validates clean
- [ ] 7.2 Commit with conventional message `feat(bridge): web-agent envelope schema (M2)` referencing this change directory
- [ ] 7.3 Run `/opsx-archive m2-bridge-web-agent-events` (or `npx @fission-ai/openspec archive m2-bridge-web-agent-events`) to fold the new spec into `openspec/specs/web-agent-bridge/` and move this change to `openspec/changes/archive/`
