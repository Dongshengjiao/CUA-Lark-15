# Design: web-agent-bridge protocol

## Context

After M0 the LarkIslandCore Bridge is a thin Unix-socket message bus
(`Sources/LarkIslandCore/BridgeServer.swift`,
`BridgeTransport.swift`). It already speaks newline-delimited JSON
`BridgeEnvelope` frames and routes 4 generic `BridgeCommand` types to a
single `commandHandler` closure. M1 proved a Node runner can drive
UI-TARS BO + Qwen3-VL-Plus to emit useful step-level events. This
change designs the **wire seam between them**.

Constraints:
- License aggregation requires the bridge to remain pure IPC; no
  shared compiled types between Swift and TS sides ([LICENSE.md
  §aggregation rules](../../../LICENSE.md)).
- Local-first: the protocol carries everything the app needs to
  render the island UI without reaching into the runner's process
  (no shared filesystem assumptions beyond a documented screenshot
  directory).
- Wire backwards compatibility: old `BridgeCodec` must keep accepting
  M0c envelopes; new envelope kinds must be additive.

## Goals / Non-Goals

**Goals:**
- Define a stable JSON envelope vocabulary that lets a runner
  (TS/Node) push 5 web-agent-specific events into BridgeServer and
  receive 1 new task-dispatch command back.
- Specify the broadcast routing rules so app observers see
  web-agent events while the originating runner does not (no echo).
- Define error / failure semantics that the SwiftUI UI in M4 can
  render uniformly.
- Ship working Codable round-trip tests on both sides; shared JSON
  fixtures are the single source of truth.
- Bump `BridgeHello.protocolVersion` to 2 so observers/runners can
  detect peer mismatches.

**Non-Goals:**
- M2 does not start the runner subprocess (that is M3
  RunnerSupervisor).
- M2 does not render any of the new events in SwiftUI (that is M4).
- M2 does not encode or transfer screenshot bytes — the runner writes
  screenshots to disk and includes a path; the app reads from disk.
- M2 does not introduce streaming / chunking of large fields. JSON
  envelopes stay newline-bounded and ≤64 KB.
- M2 does not introduce authentication. The Unix socket's POSIX
  permissions (user-only at `~/Library/Application Support/LarkIsland/`)
  are sufficient for a single-user local product.

## Decisions

### D1: 5 web-agent events, not a single generic `webAgentUpdate`
We considered a one-case design (`webAgentUpdate(payload: WebAgentPayload)`)
where `WebAgentPayload` is a tagged union. We chose 5 separate cases so:
- Swift's `apply(_ event:)` reducer can `switch` exhaustively without
  re-decoding inner unions.
- Old observers that don't yet handle `webAgentApprovalRequested` (the
  rarest case) crash visibly during decode rather than silently
  dropping a permission request.

Alternatives considered:
- **Tagged union**: smaller code surface, but loses Swift's exhaustive
  switch ergonomics.
- **Dynamic dictionary**: max flexibility, zero type safety. Rejected.

### D2: Screenshots as file paths, not base64
Step events carry an optional `screenshotURL: String?` (a `file://` URL
or absolute path). The runner writes JPEG screenshots to a documented
directory before emitting the event. Rationale:
- Keeps single-frame event size <5 KB JSON; multi-step traces stay
  comfortably below socket buffer limits.
- The SwiftUI overlay can read the JPEG with `NSImage(byReferencing:)`
  on the main thread without going through Codable.
- A long-running session can be replayed offline by reading the JSON
  log + screenshot directory; nothing is locked in process memory.

The screenshot directory is **specified** as
`~/Library/Application Support/LarkIsland/web-agent/screenshots/<task-id>/<step>.jpg`,
but the field is a free-form string so future runners can write to
shared volumes if we ever go remote.

### D3: `BridgeClientRole.webAgentRunner` excluded from event broadcast
Today `BridgeServer.broadcast(_:)` sends `AgentEvent` envelopes to all
clients with `role == .observer`. M2 keeps that rule; new
`webAgentRunner` clients receive only `BridgeCommand` envelopes
addressed to them. This makes the runner's outbound stream
write-only-to-app and prevents loops if a buggy app re-emits an event
the runner just sent.

### D4: `runWebAgentTask` is a `BridgeCommand`, not an event
Direction matters. App → runner is `command`; runner → app is `event`.
This mirrors the M0c topology where `requestQuestion` /
`resolvePermission` / `answerQuestion` flow as commands from observers
to the bridge. A future `cancelWebAgentTask` command slots in the same
direction.

### D5: TS codec is hand-written, not generated
A schema generator (json-schema-to-typescript, etc.) would add a build
step and a third source of truth (the schema file). With ≤6 envelope
shapes and ≤200 lines of TS, hand-writing the codec is cheaper. Both
sides are protected by:
- Swift `WebAgentEventTests` round-trip cases.
- Vitest test in `runners/web-agent/test/bridge.test.ts` decoding the
  same JSON fixtures.
A drift in either side immediately fails the matching fixture. We
revisit code-gen if the protocol grows past ~15 envelope kinds.

### D6: Failure taxonomy
`WebAgentTaskFailed.kind` is a closed enum with 4 values:
- `vlmTimeout` — DashScope/Doubao API call exceeded 180s.
- `vlmError` — non-timeout VLM failure (auth, quota, model rejected).
- `pageError` — Chromium navigation, screenshot, or click failure.
- `cancelled` — user pressed cancel in the island UI.

Rationale: the M4 UI needs to decide whether to offer "Retry" (vlm*) or
"Restart browser" (pageError) or just dismiss (cancelled). A free-form
string would push that branching to the app layer.

## Risks / Trade-offs

- **Schema drift between Swift and TS** → fixed JSON fixtures shared
  by both test suites; CI in M6 runs both. Mitigation: the very first
  unit test of M2 is exactly this round-trip.
- **Screenshot disk usage** → at 50 KB JPEG × 25 max steps × 1
  task/min × 8h = ~600 MB/day worst case. Mitigation: M5 will add a
  `webAgentTaskCompleted` cleanup hook that prunes step screenshots
  older than 7 days. Out of scope for M2.
- **`protocolVersion` bump = 2 breaks v1 hooks** → M0a/b/c removed all
  v1 hook clients; only the new runner is left, which can declare
  v2. Hooks/* binaries that referenced bridge.sock have been deleted
  from `Sources/`. Risk realized only if a third party ships a
  v0.x-style client; mitigation: server still accepts a v1 hello and
  serves the strict subset of envelopes it can encode.
- **5 new `AgentEvent` cases break exhaustive switches in app code** →
  *no app code currently consumes AgentEvent post-M0c* (the App target
  is disabled). The only consumer is `SessionState.apply`, which we
  update in this change. Risk realized when M4 adds new view models —
  caught by Swift's exhaustive-switch warning, not silent.

## Migration Plan

1. **Land M2** (this change): adds enum cases + 5 event structs +
   1 command + tests. `swift build && swift test` keeps passing
   because `SessionState.apply` is updated atomically. Runner side
   types compile but are not wired to any socket yet — `npm run
   typecheck` keeps passing.

2. **M3 RunnerService picks up the protocol**: runner connects on
   start, sends `registerClient(.webAgentRunner)`, then a `bridgeHello`
   v2 reply confirms compatibility. Runner emits real
   `webAgentTaskStarted` ... `webAgentTaskCompleted` for every job it
   processes.

3. **M4 UI subscribes**: AppModel observes the same
   `BridgeServer.commandHandler` (now demuxing both legacy and
   web-agent envelopes), and the new `WebAgentOverlayView` renders
   step events.

Rollback: deleting this change's files plus reverting `SessionState.apply`
restores M0c behavior. No persisted state on disk needs migrating.

## Open Questions

1. Should `WebAgentStepUpdate.action` carry the parsed `ParsedPrediction`
   shape (with `actionType`, `actionInputs`, `thought` separated) or just
   the raw `prediction: string` from UI-TARS SDK? **Tentative**:
   raw string + thought separately. Final structure decided when
   writing the spec — see [specs/web-agent-bridge/spec.md].
2. Do we need a `webAgentStepDelta` for incremental token streaming
   inside one VLM call (to show typewriter-style progress)? Out of
   scope for M2; the answer would add ~3 events. Note for M4 backlog.
3. Should `runWebAgentTask` carry the LLM profile inline (apiKey,
   baseURL, model) or just a profile name that the runner looks up in
   its own keychain-loaded config? **Tentative**: profile *name*
   only — the runner is responsible for key resolution, the app never
   sends the key over the socket. Locked in the spec.
