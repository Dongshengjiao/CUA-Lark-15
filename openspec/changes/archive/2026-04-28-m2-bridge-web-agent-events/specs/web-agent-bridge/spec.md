# Spec delta: web-agent-bridge

## ADDED Requirements

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
BridgeServer's existing `commandHandler` closure MUST receive
`runWebAgentTask` commands sent from observer clients (the app) and
MUST forward `webAgent*` events emitted by runner clients to all
observer clients via `broadcast(_:)`.

The server MUST NOT misroute: an event from a runner MUST NOT be
re-sent to that same runner; a `runWebAgentTask` from an observer
MUST NOT be looped back to other observers.

#### Scenario: app emits command, runner receives it
- **WHEN** an observer client (the app) sends `runWebAgentTask`
- **THEN** the server delivers it to the `commandHandler`, which
  delivers it to the connected runner only

#### Scenario: runner emits step event, only observer receives it
- **WHEN** a runner emits `webAgentStepUpdate`
- **THEN** the server forwards the envelope to every observer client
- **AND** the server does NOT echo it back to the runner that sent it
