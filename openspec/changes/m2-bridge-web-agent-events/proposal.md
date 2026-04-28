# Proposal: M2 — Bridge protocol extension for web-agent events

## Why

After M0 the LarkIslandCore Bridge has been pruned down to a generic
session-event reducer (sessionStarted / activityUpdated / permission /
question / completed / jump / actionableStateResolved) plus an empty
`BridgeClientRole.observer`. M1 then proved a Node web-agent runner
(`runners/web-agent/`) can drive headless Chromium with UI-TARS BO and
emit fine-grained step events.

We now need a **wire-level contract** that lets the runner stream those
step events into LarkIslandCore over the Unix socket and lets the (yet
to-be-rewritten in M4) LarkIslandApp dispatch task commands back. The
existing event/role enums don't model web-agent semantics — there is no
"step" concept (with thought + action + screenshot path), no runner
role, no `RunWebAgentTask` command. Building this contract before M3
runner service work and M4 UI work means both sides can develop
independently against a shared schema.

## What Changes

- **Add 5 new `AgentEvent` cases** in
  [`Sources/LarkIslandCore/AgentEvent.swift`](../../../lark-island/Sources/LarkIslandCore/AgentEvent.swift):
  - `webAgentTaskStarted(WebAgentTaskStarted)`
  - `webAgentStepUpdate(WebAgentStepUpdate)` — carries step index,
    thought, parsed action JSON string, optional screenshot file path
  - `webAgentApprovalRequested(WebAgentApprovalRequested)` — runner
    asks user via island for permission (e.g. first-time scan login)
  - `webAgentTaskCompleted(WebAgentTaskCompleted)` — final answer
    string + total tokens / elapsed time
  - `webAgentTaskFailed(WebAgentTaskFailed)` — error category +
    message (timeout / VLM error / page error / cancelled)
  Each case gets its own struct + Codable round-trip wired into
  `AgentEvent`'s manual `init(from:)` / `encode(to:)`.

- **Add 1 new `BridgeClientRole` case** in
  [`Sources/LarkIslandCore/BridgeTransport.swift`](../../../lark-island/Sources/LarkIslandCore/BridgeTransport.swift):
  - `.webAgentRunner` — the runner subprocess identifies itself with
    this role on its first envelope after connecting; BridgeServer's
    broadcaster routes web-agent events to clients registered as
    `.observer` (the app), not back to runners.

- **Add 1 new `BridgeCommand` case** for app→runner dispatch:
  - `runWebAgentTask(taskID: String, prompt: String, skill: String?, profileName: String?)`
  - The default `commandHandler` closure path is reused; runner-side
    commands are demuxed by the runner client by inspecting which case
    arrives.

- **Mirror schema in TypeScript** under
  [`runners/web-agent/src/bridge/`](../../../runners/web-agent/src/bridge/)
  (~1 file, 80–120 lines): hand-written codec with the same JSON shape
  + a typed `BridgeEnvelope` union. No code generation — round-trip
  tests on both sides keep them in sync.

- **Tests**:
  - `Tests/LarkIslandCoreTests/WebAgentEventTests.swift` — 5 new
    `@Test` cases covering Codable round-trips for each new event +
    `runWebAgentTask` command + `webAgentRunner` role hello.
  - `runners/web-agent/test/bridge.test.ts` (vitest) — same
    round-trips, bytes-for-bytes against the same JSON fixtures.

- **NOT in this change** (deferred to M3 / M4):
  - Wiring runner to actually open the socket and stream events
    (M3 RunnerService).
  - Subscribing the SwiftUI overlay to the event stream
    (M4 UI rewrite).
  - Persisting screenshots; this proposal only contracts the path
    string, M3 will define where the runner writes them.

## Capabilities

### New Capabilities
- `web-agent-bridge`: the wire protocol that lets a web-agent runner
  process stream task progress (start / step / approval / completed /
  failed) into the LarkIsland app over the existing `bridge.sock`, and
  receive task dispatch commands back. Covers event schemas, the
  runner client role, the `runWebAgentTask` command, and the
  broadcast/routing rules BridgeServer applies to envelopes.

### Modified Capabilities
<!-- None: there is no prior `openspec/specs/` capability to amend.
     The generic Bridge envelope/codec/role enums in LarkIslandCore are
     code, not a spec captured in OpenSpec yet. The web-agent-bridge
     spec stands alone. -->

## Impact

- **Code**:
  - `lark-island/Sources/LarkIslandCore/AgentEvent.swift` — 5 new
    structs + 5 new enum cases + Codable plumbing.
  - `lark-island/Sources/LarkIslandCore/BridgeTransport.swift` —
    `BridgeClientRole.webAgentRunner`, `BridgeCommand.runWebAgentTask`.
  - `lark-island/Sources/LarkIslandCore/SessionState.swift` — new
    reducer paths for the 5 web-agent events (mostly map onto existing
    activity/completed semantics with extra metadata recorded on
    `AgentSession`).
  - `lark-island/Tests/LarkIslandCoreTests/WebAgentEventTests.swift` —
    new test file.
  - `runners/web-agent/src/bridge/{envelope,codec,types}.ts` — new
    files implementing the TS mirror.
  - `runners/web-agent/test/bridge.test.ts` — new test file.
- **APIs**: backwards compatible. Old envelope kinds keep working; old
  observer clients ignore unknown event kinds gracefully (the JSON
  decoder throws and the offending frame is dropped, by current
  BridgeServer behaviour). Future-proofing: bumping
  `BridgeHello.protocolVersion` from 1 to 2 to flag the new schema; an
  observer that sees `version > 1` from an old runner can decline.
- **Dependencies**: none new. No npm or SwiftPM additions.
- **License**: all changes stay within the GPL-aggregation boundary
  ([../../../LICENSE.md](../../../LICENSE.md)). lark-island stays GPL-v3,
  runners/ stays Apache-2.0; the wire protocol is the IPC seam that
  keeps the two sides un-linked.
- **Performance**: negligible. Step events are 1–5 KB JSON (excluding
  screenshot bytes — those go to disk, not the wire). At ≤1 step/sec
  (typical Qwen3-VL-Plus pace) the socket is idle 99% of the time.
- **Risk**: schema drift between Swift and TS sides. Mitigated by
  shared JSON fixtures used by both test suites — if either side
  changes the encoding, the other side's test breaks.
