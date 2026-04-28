# Spec delta: lark-island-app

## ADDED Requirements

### Requirement: app 启动时初始化 BridgeServer 和 RunnerSupervisor
LarkIslandApp 进程在 `applicationDidFinishLaunching` 之后、显示任何窗口或菜单栏之前 MUST 完成两件事：

1. 启动一个 `BridgeServer` 实例，监听 `LARK_ISLAND_SOCKET_PATH` 环境变量指向的路径，否则默认 `~/Library/Application Support/LarkIsland/bridge.sock`。socket 父目录不存在时自动创建。
2. 通过 `WebAgentRunnerSupervisor` spawn 一个 web-agent runner 子进程，并把上一步的 socket 路径与 `DASHSCOPE_API_KEY` 等环境变量传递给子进程。

如果 BridgeServer 启动失败（端口被占、socket 文件不可写），app MUST 弹一个错误对话框说明原因并以 exit code 1 退出。如果 runner spawn 失败但 BridgeServer 启动成功，app **可以**继续启动，灵动岛 overlay 在用户尝试触发任务时显示 "runner unavailable" banner，本 requirement 不规定该 banner 文案。

#### Scenario: 首次启动，环境变量为默认值
- **WHEN** 用户运行 `swift run LarkIslandApp`
- **AND** `~/Library/Application Support/LarkIsland/bridge.sock` 不存在
- **THEN** app 自动创建该目录并 listen
- **AND** spawn runner 子进程并把上述 socket 路径以 env 形式传给子进程

#### Scenario: socket 路径被环境变量覆盖
- **WHEN** 用户用 `LARK_ISLAND_SOCKET_PATH=/tmp/custom.sock swift run LarkIslandApp` 启动
- **THEN** BridgeServer 在 `/tmp/custom.sock` 上 listen
- **AND** runner 子进程的 env 中 `LARK_ISLAND_SOCKET_PATH` 也为 `/tmp/custom.sock`

#### Scenario: runner spawn 失败但 socket 启动成功
- **WHEN** runner 二进制找不到（`LARK_ISLAND_RUNNER_PATH` 指向不存在的文件）
- **THEN** app 仍然启动，灵动岛 overlay 处于 idle 状态
- **AND** AppModel 内部 `runnerOffline = true`
- **AND** 用户提交任务时 UI 拒绝并提示 runner 不可用

### Requirement: 灵动岛 overlay 反映当前 web-agent 任务状态
灵动岛 overlay SHALL 是 SessionState 的实时投影。具体行为：

- 当 SessionState 中**没有**可见 session 时（`isVisibleInIsland == false`），overlay 处于紧凑（idle）形态：仅显示项目品牌标记。
- 当存在恰好一个可见 session 时，overlay 切到展开形态，显示：
  - 任务标题（取 session.title，即 `runWebAgentTask.prompt` 的首行截断到 60 字符）
  - 当前 phase 状态文案（"运行中" / "等待批准" / "等待回答" / "已完成" / "已失败"）
  - 最近一条 step 的 thought（截断到 100 字符）
  - 最近一帧 screenshot 的缩略图（如果 `screenshotURL` 字段非 nil 且文件可读，否则不渲染缩略图）
- 当 session 进入 `phase == .completed` 后，overlay 在 8 秒后自动调用 `SessionState.removeInvisibleSessions()`，进入 idle 形态，**除非**鼠标 hover 在 overlay 上（hover 时暂停 fade 计时器，鼠标移走后重新计时）。

#### Scenario: 任务开始 → 步骤更新 → 任务完成
- **WHEN** AppModel 收到 `webAgentTaskStarted` 事件
- **THEN** overlay 在 100ms 内切换到展开形态显示该任务标题
- **WHEN** 后续收到 `webAgentStepUpdate` 事件
- **THEN** overlay 显示对应 step 的 thought + 缩略图
- **WHEN** 收到 `webAgentTaskCompleted`
- **THEN** overlay 显示 `finalAnswer`，8 秒后 fade 到 idle

#### Scenario: 任务失败显示分类原因
- **WHEN** AppModel 收到 `webAgentTaskFailed{kind: "vlmTimeout", message: "..."}`
- **THEN** overlay 显示"已失败"状态 + 用户可读的失败原因（按 kind 翻译："VLM 超时" / "VLM 错误" / "页面错误" / "已取消"）
- **AND** 8 秒后 fade

#### Scenario: hover 暂停 fade 计时器
- **WHEN** 任务进入 completed 状态
- **AND** 用户鼠标 hover 在 overlay 上
- **THEN** overlay 不在 8 秒后自动 fade
- **WHEN** 鼠标移开
- **THEN** fade 计时器从 0 重新开始

### Requirement: 用户输入入口至少提供菜单栏与灵动岛两条路径
LarkIslandApp MUST 提供以下两条用户输入路径，每条都能触发 `AppModel.startWebAgentTask(prompt:)`：

1. **菜单栏 popover**：菜单栏 NSStatusItem 单击 → 弹 NSPopover → 内嵌 `WebAgentInputPanel` SwiftUI 视图（一个 `TextField` + 提交按钮）。回车提交，Esc 关闭。
2. **灵动岛 hover-expand**：当 overlay 处于 idle 形态时，鼠标 hover 在灵动岛上超过 300 ms 后展开内嵌 mini input field；提交后 panel 收起、overlay 切到 running 形态。

全局键盘快捷键**不**在本里程碑要求；预留给 M7 backlog。

#### Scenario: 菜单栏触发任务
- **WHEN** 用户点击菜单栏 LarkIsland 图标
- **THEN** NSPopover 弹出含 input field
- **WHEN** 用户输入 "在 example.com 读 page title" 并按 Enter
- **THEN** AppModel.startWebAgentTask 被调用
- **AND** Popover 关闭

#### Scenario: 灵动岛 hover 触发任务
- **WHEN** overlay 处于 idle 形态
- **AND** 鼠标 hover 灵动岛超过 300 ms
- **THEN** overlay 展开显示 input field
- **WHEN** 用户输入并提交
- **THEN** AppModel.startWebAgentTask 被调用
- **AND** overlay 切到 running 形态显示新任务

### Requirement: LLMProfileStore 在文件系统与 Keychain 之间分离 metadata 与 secret
LLMProfileStore SHALL 把 LLM profile 拆成两块持久化：

- **Metadata**（name / baseURL / model / family / 是否默认）：序列化为 JSON，存到 `~/Library/Application Support/LarkIsland/llm-profiles.json`，权限 `0600`。
- **Secret**（apiKey）：通过 macOS Keychain 存储。Keychain item attribute：`kSecAttrService = "ai.neolix.lark-island"`，`kSecAttrAccount = <profile name>`。

`LLMSettingsView` MUST 使用 `SecureField` 收集 apiKey；保存时 store 直调 `Security.framework` 的 `SecItemAdd` / `SecItemUpdate` / `SecItemCopyMatching`，不依赖第三方库。

profile 名 MUST 唯一；试图用同名创建第二条时 store 报错。

新建或更新 profile 后，AppModel.activeProfile MUST 立即反映变更，下一条 `runWebAgentTask` 命令携带新 profileName。无需重启 app 或 runner。

#### Scenario: 创建新 profile 写两处持久化
- **WHEN** 用户在 LLMSettingsView 输入 name="doubao-fallback", baseURL=..., apiKey="sk-xxx", 点保存
- **THEN** llm-profiles.json 新增一条 metadata 记录（不含 apiKey 字段）
- **AND** Keychain 增加一条 service=ai.neolix.lark-island, account=doubao-fallback 的 generic password item，密码 = "sk-xxx"

#### Scenario: 启动时从两处读出
- **WHEN** app 启动且 llm-profiles.json 已存在 2 条记录
- **THEN** LLMProfileStore 加载 metadata
- **AND** 对每条 metadata 查 Keychain 取 apiKey 拼回完整 ResolvedProfile
- **AND** 任意一条 Keychain 缺失时把该 profile 标 unhealthy（UI 显示警告 icon）

#### Scenario: 切换默认 profile 即时生效
- **WHEN** 用户把默认 profile 从 qwen-default 改成 doubao-fallback
- **THEN** AppModel.activeProfile 立即指向 doubao-fallback
- **AND** 之后用户提交的任务 `runWebAgentTask.profileName = "doubao-fallback"`
- **AND** 不需要重启 app

### Requirement: WebAgentRunnerSupervisor 提供 dev/prod 双路径解析与崩溃重启
RunnerSupervisor 启动时 MUST 按以下顺序解析 runner 二进制路径：

1. 如果 `LARK_ISLAND_RUNNER_PATH` 环境变量非空，使用其值。
2. 否则，如果 `Bundle.main.resourceURL` 下存在 `runners/server.js`（prod 模式 DMG 内嵌），使用该路径。
3. 否则，从 `#filePath` 推出仓库根目录，组合 `runners/web-agent/dist/server.js`（dev 模式 monorepo）。
4. 以上都失败时报错。

supervisor SHALL 监控 runner 子进程的退出事件并按以下规则重启：

- 距上次 spawn 超过 60 秒：重启次数计数器清零。
- 距上次 spawn 60 秒内连续异常退出（exit code != 0）累计 ≥ 3 次：停止重启，AppModel.runnerOffline = true，**不再**自动 spawn。
- 否则按指数退避重启：第 1 次 1 秒、第 2 次 3 秒、第 3 次 9 秒。

App 退出时 supervisor MUST 发 SIGTERM 给 runner，等待最多 2 秒，超时则发 SIGKILL。

#### Scenario: dev 模式找到 runner
- **WHEN** 没有 `LARK_ISLAND_RUNNER_PATH` 环境变量
- **AND** `Bundle.main.resourceURL/runners/server.js` 不存在
- **AND** 从 `#filePath` 反推出 `<repo>/runners/web-agent/dist/server.js` 存在
- **THEN** supervisor 用此路径 spawn

#### Scenario: 三次连续崩溃后停止重启
- **WHEN** runner 在 60 秒内连续 3 次 exit 1
- **THEN** supervisor 不再 spawn 新实例
- **AND** AppModel.runnerOffline 置 true
- **AND** UI 显示 runner 不可用 banner

#### Scenario: app 退出时优雅终止 runner
- **WHEN** 用户从菜单栏选 Quit
- **THEN** supervisor 发 SIGTERM 给 runner
- **AND** 最多 2 秒后未退出则发 SIGKILL
- **AND** app 进程退出

