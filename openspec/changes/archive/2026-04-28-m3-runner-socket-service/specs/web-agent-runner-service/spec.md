# Spec delta：web-agent-runner-service

## ADDED Requirements

### Requirement: runner 启动时按指定顺序连接 socket
runner 进程启动后必须先建立到 `bridge.sock` 的连接、完成 hello 握手、注册角色，**然后**才能 launch headless Chromium。如果 socket 连接失败或收到的 `BridgeHello.protocolVersion < 2`，runner SHALL 立即写日志并以 exit code 1 退出，**不**启动 Chromium。

socket 路径解析顺序：
1. 优先读环境变量 `LARK_ISLAND_SOCKET_PATH`。
2. 否则使用默认路径 `~/Library/Application Support/LarkIsland/bridge.sock`。

#### Scenario: 默认路径连接成功且收到 v2 hello
- **WHEN** runner 启动且 `LARK_ISLAND_SOCKET_PATH` 未设置
- **AND** `~/Library/Application Support/LarkIsland/bridge.sock` 存在且可连
- **AND** server 发回 `BridgeHello{protocolVersion: 2, serverLabel: "lark-island-bridge"}`
- **THEN** runner 发送 `registerClient(.webAgentRunner)` 命令
- **AND** runner 然后 launch Chromium 并进入命令循环

#### Scenario: socket 路径不存在
- **WHEN** runner 启动且目标 socket 文件不存在
- **THEN** runner 写日志 `socket not available at <path>`
- **AND** runner exit code 1
- **AND** runner **不**启动 Chromium

#### Scenario: server 返回 v1 hello（不兼容）
- **WHEN** runner 收到 `BridgeHello{protocolVersion: 1}`
- **THEN** runner 写日志说明不兼容
- **AND** runner exit code 1

### Requirement: runner 一次只跑一个任务，并发命令立即拒绝
runner SHALL 维护单任务串行约束：当前正在执行任务时收到新的 `runWebAgentTask` 命令，runner MUST 不打断当前任务，并立即向 server 发送 `webAgentTaskFailed` envelope，其中：
- `taskID` 等于**新进来**的命令的 `taskID`（让 UI 能定位被拒绝的那一条）。
- `kind` 等于 `pageError`。
- `message` 至少包含字符串 `"runner busy"` 和当前正在跑的 `taskID`。

#### Scenario: 空闲时收到任务，正常进入执行
- **WHEN** runner 处于空闲状态
- **AND** 收到 `runWebAgentTask{taskID: "t1", prompt: "...", profileName: "qwen-default"}`
- **THEN** runner 发出 `webAgentTaskStarted{taskID: "t1"}` envelope
- **AND** 进入 GUIAgent 执行循环

#### Scenario: 忙碌时第二个命令立即拒绝
- **WHEN** runner 正在执行 taskID = "t1"
- **AND** 收到第二条 `runWebAgentTask{taskID: "t2", ...}`
- **THEN** runner 不打断 t1
- **AND** 立即发出 `webAgentTaskFailed{taskID: "t2", kind: pageError, message: "runner busy with t1"}`

### Requirement: profile 解析在 M3 阶段仅支持 qwen-default
runner MUST 在收到 `runWebAgentTask` 命令后解析 `profileName` 为 LLM 配置 `{baseURL, apiKey, model}`。本里程碑只支持单一出厂 profile，解析规则：

- `profileName === "qwen-default"` 或 `profileName === null` 或字段缺失：
  - `baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"`
  - `model = "qwen3-vl-plus"`
  - `apiKey = process.env.DASHSCOPE_API_KEY`
- 其他任意值：runner MUST 立即发 `webAgentTaskFailed{kind: vlmError, message: "unknown profile <name>"}`，不进入 GUIAgent。

如果 `apiKey` 解析为 undefined（环境变量未设），runner MUST 发 `webAgentTaskFailed{kind: vlmError, message: "DASHSCOPE_API_KEY not set"}`。

#### Scenario: 默认 profile 解析成功
- **WHEN** 收到任务的 `profileName = "qwen-default"`
- **AND** `process.env.DASHSCOPE_API_KEY = "sk-..."`
- **THEN** runner 用上述 baseURL/model/apiKey 构造 GUIAgent 并启动

#### Scenario: 未知 profile 立即拒绝
- **WHEN** 收到任务的 `profileName = "claude-opus"`
- **THEN** runner 不启动 GUIAgent
- **AND** 发出 `webAgentTaskFailed{kind: vlmError, message: "unknown profile claude-opus"}`

#### Scenario: 缺 API key 立即拒绝
- **WHEN** 收到任务的 `profileName = "qwen-default"`
- **AND** `DASHSCOPE_API_KEY` 环境变量为空
- **THEN** runner 不启动 GUIAgent
- **AND** 发出 `webAgentTaskFailed{kind: vlmError, message: "DASHSCOPE_API_KEY not set"}`

### Requirement: GUIAgent 步骤事件按规范回灌
runner 在执行任务期间 MUST 把 `@ui-tars/sdk` 的 `GUIAgent.onData` 回调翻译成 `webAgentStepUpdate` envelope，规则：

- `taskID` 等于当前任务的 ID。
- `stepIndex` 从 0 开始单调递增。
- `thought` = `data.conversations[last].predictionParsed[0].thought`，如果不存在则为空字符串。
- `actionRaw` = `data.conversations[last].rawPrediction`（原始 prediction 字符串），如果不存在则 `null`。
- `actionType` = `data.conversations[last].predictionParsed[0].action_type`，如果不存在则 `null`。
- `screenshotURL` = 截图本地绝对路径（见下一条 Requirement），写盘失败也仍要带 path。
- `costMs` / `costTokens` 来自 `data.conversations[last].costTime` / `costTokens`，缺失时 `null`。
- `timestamp` 取事件触发的 `Date.now()`。

任务正常完成时 runner MUST 发 `webAgentTaskCompleted`，字段：
- `finalAnswer` = `onFinalAnswer` 回调的字符串，否则 fallback 到最后一步 `thought`。
- `totalSteps` = 回灌过的 step 数。
- `totalTokens` / `totalMs` = GUIAgent `data` 末态的累计字段，缺失时为 `0`。

#### Scenario: 一步成功的任务发出完整事件流
- **WHEN** 任务执行恰好 1 步后调用 `onFinalAnswer("Done.")`
- **THEN** runner 按顺序发出：`webAgentTaskStarted`、1 个 `webAgentStepUpdate{stepIndex: 0}`、`webAgentTaskCompleted{finalAnswer: "Done.", totalSteps: 1}`

#### Scenario: 多步任务的 stepIndex 单调递增
- **WHEN** 任务执行 5 步
- **THEN** runner 发出的 5 个 `webAgentStepUpdate` envelope 的 `stepIndex` 依次为 0、1、2、3、4

### Requirement: 截图按规范写盘，事件只携带路径
runner MUST 把每个步骤的截图写到 macOS 用户的 `~/Library/Application Support/LarkIsland/web-agent/screenshots/<taskID>/<stepIndex>.jpg`（必要时递归创建目录）。写盘是异步的且失败不阻断任务，但 `webAgentStepUpdate.screenshotURL` MUST 始终携带这个绝对路径，即使写盘尚未完成或写盘失败。

事件 envelope **不**得在 wire 上携带截图二进制（base64 或其他形式）—— 这是 `web-agent-bridge` spec 已经规定的硬性约束。

#### Scenario: 截图正常写盘且 path 入 envelope
- **WHEN** runner 执行 taskID = "t1" 的 step 3
- **AND** 截图字节解码成功
- **THEN** runner 异步把字节写到 `~/Library/Application Support/LarkIsland/web-agent/screenshots/t1/3.jpg`
- **AND** 发出的 `webAgentStepUpdate.screenshotURL` 等于该绝对路径

#### Scenario: 写盘失败不阻断任务
- **WHEN** 写盘抛错（磁盘满、权限错等）
- **THEN** runner 写日志 `screenshot save failed: <err>`
- **AND** 仍然发出 `webAgentStepUpdate{screenshotURL: <path>}`（消费方按文件不存在处理）
- **AND** 任务继续

### Requirement: 异常按 WebAgentFailureKind 分类回灌
runner 在任务执行期间捕获到任何异常，MUST 翻译成对应的 `webAgentTaskFailed.kind`：

- VLM 调用 timeout（OpenAI SDK 抛 `APIConnectionTimeoutError` 或类似）→ `vlmTimeout`
- VLM 其他错误（auth、quota、模型拒绝、parse 失败）→ `vlmError`
- 浏览器层错误（page navigation 失败、screenshot 抛错、点击坐标越界等）→ `pageError`
- 用户主动取消（M4 接来 cancel 命令；M3 的 socket EOF 也走此分支）→ `cancelled`

无法分类的异常 default 到 `pageError`。`message` 字段必须包含异常类型名 + 原始 message 摘要（最多 256 字符）。

#### Scenario: VLM 超时分类为 vlmTimeout
- **WHEN** GUIAgent 抛 `APIConnectionTimeoutError("Request timed out.")`
- **THEN** runner 发 `webAgentTaskFailed{kind: vlmTimeout, message: "APIConnectionTimeoutError: Request timed out."}`

#### Scenario: 浏览器点击越界分类为 pageError
- **WHEN** BrowserOperator 抛错说点击坐标超出 viewport
- **THEN** runner 发 `webAgentTaskFailed{kind: pageError, message: <异常摘要>}`

#### Scenario: socket 断线时 in-flight 任务标 cancelled
- **WHEN** runner 正在执行任务时 socket 收到 EOF
- **THEN** runner 写日志 `socket EOF, cancelling task <taskID>`
- **AND** runner exit code 1（让 supervisor 重启；事件因 socket 已断无法发送，记录在日志即可）

### Requirement: socket 断线后 runner 退出而非自重连
runner SHALL 不实现自动重连。socket 断线（EOF / ECONNRESET / 写错 EPIPE）后 runner MUST：

1. 取消任何 in-flight 任务的 GUIAgent 循环。
2. 调用 `LocalBrowser.close()` 释放 Chromium。
3. exit code 1。

重启策略归 M4 的 RunnerSupervisor 负责。

#### Scenario: 空闲时 socket 断线
- **WHEN** runner 空闲且 socket 收到 EOF
- **THEN** runner 关闭 LocalBrowser
- **AND** exit code 1

#### Scenario: 任务执行期间 socket 断线
- **WHEN** runner 正在执行任务且 socket 收到 EOF
- **THEN** runner 取消 GUIAgent
- **AND** 关闭 LocalBrowser
- **AND** exit code 1
