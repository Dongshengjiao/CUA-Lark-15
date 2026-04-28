# Spec delta: web-agent-bridge

## MODIFIED Requirements

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
