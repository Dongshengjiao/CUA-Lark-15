# web-agent-bridge Specification

## Purpose

Defines the wire-level contract that lets a web-agent runner process
(the Node subprocess at `runners/web-agent/`) stream task progress
into the LarkIsland macOS app over the existing local Unix socket
(`~/Library/Application Support/LarkIsland/bridge.sock`), and lets
the app dispatch task commands back. The protocol covers:

- New `AgentEvent` cases for web-agent task lifecycle:
  `webAgentTaskStarted`, `webAgentStepUpdate`,
  `webAgentApprovalRequested`, `webAgentTaskCompleted`,
  `webAgentTaskFailed`.
- New `BridgeClientRole.webAgentRunner` so BridgeServer can
  selectively exclude runners from event broadcast loops.
- New `BridgeCommand.runWebAgentTask(taskID, prompt, skill,
  profileName)` for app → runner dispatch. **Carries no secret
  material** — credentials are resolved by the runner from
  `profileName` against its own keychain-backed config.
- Bumped `BridgeHello.protocolVersion` from 1 to 2 so peers can
  detect mismatches.
- Screenshot transfer policy: file paths on disk, never base64 on
  the wire.
- Hand-written TypeScript codec mirror at
  `runners/web-agent/src/bridge/`, kept in lockstep with the Swift
  side via the shared JSON fixtures at
  `lark-island/Tests/LarkIslandCoreTests/Fixtures/web-agent-bridge/`.

History: introduced by change `m2-bridge-web-agent-events` (archived
2026-04-28). The runner-side wiring (M3) and app-side UI consumption
(M4) build directly on this spec.
## Requirements
### Requirement: Runner identifies itself with the webAgentRunner role
A web-agent runner client connecting to `bridge.sock` MUST send a
`BridgeCommand.registerClient(role: .webAgentRunner)` envelope as its
first message after receiving the server's `BridgeHello`. BridgeServer
MUST record this role on the client connection and MUST NOT broadcast
`AgentEvent` envelopes back to clients with this role.

#### Scenario: Runner registers role
- **WHEN** a runner connects to `bridge.sock` and sends a
  `registerClient` command with `role = webAgentRunner`
- **THEN** BridgeServer stores `webAgentRunner` on that connection's
  `ClientConnection.role` and continues accepting envelopes from it

#### Scenario: Runner does not receive its own broadcast
- **WHEN** a runner emits any `AgentEvent` envelope
- **AND** the broadcast loop in `BridgeServer.broadcast(_:)` runs
- **THEN** the runner's own connection is skipped because its role
  is `webAgentRunner`, not `observer`

### Requirement: BridgeHello advertises protocol version 2
The system SHALL advertise `protocolVersion = 2` on every server-sent
`BridgeHello` envelope. Runner clients MUST refuse to send web-agent
envelopes if the received `protocolVersion < 2`.

#### Scenario: Runner sees v2 server
- **WHEN** the runner connects and receives `BridgeHello{protocolVersion: 2}`
- **THEN** the runner proceeds with `registerClient(.webAgentRunner)`
  and accepts subsequent `runWebAgentTask` commands

#### Scenario: Runner sees v1 server (defensive)
- **WHEN** the runner connects and receives `BridgeHello{protocolVersion: 1}`
- **THEN** the runner logs an incompatibility warning and exits with
  non-zero status; no envelopes are sent

### Requirement: AgentEvent supports five web-agent cases
`AgentEvent` MUST include the following cases, each with a struct
payload, and each MUST round-trip cleanly through Swift Codable and
the TypeScript codec mirror.

- `webAgentTaskStarted(WebAgentTaskStarted)` — fields: `taskID:
  String`, `prompt: String`, `skill: String?`, `profileName: String`,
  `timestamp: Date`.
- `webAgentStepUpdate(WebAgentStepUpdate)` — fields: `taskID: String`,
  `stepIndex: Int`, `thought: String`, `actionRaw: String?`,
  `actionType: String?`, `screenshotURL: String?`, `costMs: Int?`,
  `costTokens: Int?`, `timestamp: Date`.
- `webAgentApprovalRequested(WebAgentApprovalRequested)` — fields:
  `taskID: String`, `kind: String` (e.g. `"login_qr"`), `message:
  String`, `timestamp: Date`.
- `webAgentTaskCompleted(WebAgentTaskCompleted)` — fields: `taskID:
  String`, `finalAnswer: String`, `totalSteps: Int`, `totalTokens:
  Int`, `totalMs: Int`, `timestamp: Date`.
- `webAgentTaskFailed(WebAgentTaskFailed)` — fields: `taskID:
  String`, `kind: WebAgentFailureKind` (one of `vlmTimeout`,
  `vlmError`, `pageError`, `cancelled`), `message: String`,
  `timestamp: Date`.

#### Scenario: webAgentStepUpdate round-trips through Codable
- **WHEN** a `webAgentStepUpdate` event is encoded with `JSONEncoder`
  and decoded back with `JSONDecoder`
- **THEN** the decoded value MUST be `==` to the original

#### Scenario: webAgentTaskCompleted round-trips through TS codec
- **WHEN** a `webAgentTaskCompleted` event is JSON-stringified by the
  TS codec and parsed back
- **THEN** all fields (`taskID`, `finalAnswer`, `totalSteps`,
  `totalTokens`, `totalMs`, `timestamp`) MUST match the input

#### Scenario: webAgentTaskFailed encodes a known kind
- **WHEN** a `webAgentTaskFailed` event with `kind = vlmTimeout` is
  encoded
- **THEN** the JSON MUST contain `"kind":"vlmTimeout"` (camelCase
  string), not an integer or other representation

### Requirement: BridgeCommand supports runWebAgentTask
`BridgeCommand` MUST include a `runWebAgentTask` case with fields
`taskID: String`, `prompt: String`, `skill: String?`, `profileName:
String?`. The command MUST round-trip through Codable and the TS
codec.

The command MUST NOT carry secret material (API keys, tokens,
cookies). The runner is responsible for resolving `profileName` to
real credentials from its own configuration.

#### Scenario: app dispatches a task
- **WHEN** the app constructs and sends `runWebAgentTask{ taskID:
  "t1", prompt: "send hello", skill: "feishu_im_send", profileName:
  "qwen-default" }`
- **THEN** BridgeServer MUST forward the command to the registered
  `commandHandler` closure, which routes it to the connected runner

#### Scenario: command refuses to encode an apiKey field
- **WHEN** code attempts to construct `runWebAgentTask` with an extra
  `apiKey` field
- **THEN** the Swift compiler MUST reject the construction (the
  struct does not declare `apiKey`)

### Requirement: Screenshot path is a file URL or absolute path
`WebAgentStepUpdate.screenshotURL`, when non-nil, MUST be either:
- a `file://` URL pointing to an existing JPEG on the local disk, or
- an absolute file path string starting with `/`.

The path MUST be readable by the macOS user that runs the app. The
canonical location written by the M3 runner is
`~/Library/Application Support/LarkIsland/web-agent/screenshots/<taskID>/<stepIndex>.jpg`,
but other locations are accepted as long as the file is readable by
the same user.

#### Scenario: app reads a step screenshot
- **WHEN** the app receives a `webAgentStepUpdate` with
  `screenshotURL: "/Users/alice/Library/Application Support/LarkIsland/web-agent/screenshots/t1/3.jpg"`
- **THEN** the app MUST be able to load that file with
  `NSImage(byReferencing:)` and display it in the overlay

#### Scenario: missing screenshot does not break the event
- **WHEN** a step event arrives with `screenshotURL = nil`
- **THEN** the app MUST process all other fields normally and skip
  rendering the thumbnail

### Requirement: BridgeServer demuxes web-agent envelopes correctly
BridgeServer 的 `commandHandler` closure MUST 接收 observer 客户端（app）发送的所有 `BridgeCommand`，并把 runner 客户端（webAgentRunner 角色）发出的 `webAgent*` 事件分发出去。

事件流的具体路由规则（M4 明确化）：

- **observer → server**：发送的 `BridgeCommand`（registerClient / requestQuestion / resolvePermission / answerQuestion / runWebAgentTask）SHALL 路由给 `commandHandler` closure。
- **runner → server**：发送的 `BridgeEnvelope.event(AgentEvent)`（任意 webAgent* 类型，或其他通用事件）由 server MUST 应用到内部 SessionState reducer，并把同一 envelope 继续 `broadcast()` 到所有 `observer` 角色的客户端。这样 server 既是 reducer 的拥有者，也是事件分发器。
- **runner → server**：runner **不应该**发 `BridgeCommand`；如果 server 收到来自 runner 角色的 command envelope，MUST 记录 warning 后丢弃，**不**路由给 commandHandler。
- **observer → server**：observer **不应该**发 `BridgeEnvelope.event`；如果 server 收到来自 observer 角色的 event envelope，MUST 记录 warning 后丢弃，**不**应用到 SessionState。
- **server → runner**：server 通过 commandHandler 决定何时给 runner 客户端发 `runWebAgentTask` 命令；**不**通过 broadcast。
- **server → observer**：server 把 SessionState 派生的事件通过 `broadcast()` 推给所有 observer 客户端，但**不**回推给 runner（避免事件源回环）。

server MUST 不误路由：源自 runner 的事件 MUST NOT 被 echo 回该 runner；源自 observer 的命令 MUST NOT 被广播给其他 observer。

#### Scenario: app emits command, runner receives it
- **WHEN** an observer client (the app) sends `runWebAgentTask`
- **THEN** the server delivers it to the `commandHandler`, which
  delivers it to the connected runner only

#### Scenario: runner emits step event, only observer receives it
- **WHEN** a runner emits `webAgentStepUpdate`
- **THEN** the server forwards the envelope to every observer client
- **AND** the server does NOT echo it back to the runner that sent it

#### Scenario: runner 事件应用到 server 内部 SessionState
- **WHEN** 来自 webAgentRunner 角色的客户端发出 `webAgentTaskStarted`
- **THEN** BridgeServer 调 `SessionState.apply(.webAgentTaskStarted(...))`
- **AND** SessionState 反映该新任务为 running

#### Scenario: runner 不应发命令时被忽略
- **WHEN** 一个 webAgentRunner 客户端误发 `runWebAgentTask` 命令
- **THEN** BridgeServer 记录 warning 日志
- **AND** commandHandler 不被触发

#### Scenario: observer 不应发事件时被忽略
- **WHEN** 一个 observer 客户端误发 `webAgentTaskStarted` 事件
- **THEN** BridgeServer 记录 warning 日志
- **AND** SessionState reducer 不被调用

