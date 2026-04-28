## ADDED Requirements

### Requirement: 灵动岛 opened 态显示当前任务的最近一帧 screenshot 缩略图

当 `activeIslandCardSession` 非 nil 且 `latestScreenshotURL` 字段存在指向**已写盘的 .jpg 文件**时，灵动岛 opened 态 SHALL 在 task body 区域渲染一张缩略图：

- 用 `NSImage(byReferencingFile: path)` 惰性读盘 + SwiftUI `Image(nsImage:)`。
- 缩略图最大宽度 120pt，高度按原比例自适应（`.scaledToFit()`），最大高度 90pt 防止超长截图把岛撑坏。
- `RoundedRectangle(cornerRadius: 8)` clip，留 1pt `.white.opacity(0.18)` 描边以增加视觉边界。
- 当 `screenshotURL` 改变时，SwiftUI 用 `.id(url)` 触发重渲，配合 `.transition(.opacity)` 0.2s 渐入。
- 文件不存在或读盘失败时不渲染缩略图（不报错；step 文字仍正常显示）。

`AgentSession` 新增 `latestScreenshotURL: String?` 字段；SessionState reducer 在 `webAgentStepUpdate` 时把 `payload.screenshotURL` 写入这个字段。

#### Scenario: 收到 step screenshot 后岛上显示缩略图
- **WHEN** AppModel 收到 `webAgentStepUpdate{screenshotURL: "/path/to/3.jpg"}` 且文件可读
- **THEN** session.latestScreenshotURL = "/path/to/3.jpg"
- **AND** 灵动岛 opened 态 task body 中出现一张 ≤120pt 宽的缩略图

#### Scenario: 截图文件缺失时不渲染缩略图但不崩溃
- **WHEN** session.latestScreenshotURL 指向一个不存在的路径
- **THEN** 灵动岛 opened 态不渲染缩略图区域
- **AND** UI 不抛错，step 文字正常显示

### Requirement: 灵动岛 opened 态用 swift-markdown-ui 渲染 finalAnswer

当 session.phase == `.completed` 且 `session.summary`（即 finalAnswer）非空时，灵动岛 opened 态 SHALL 用 `MarkdownUI.Markdown(_:)` 渲染 summary 字符串，而非 plain `Text`。

`swift-markdown-ui` 已在 M4 时引入到 Package.swift（`Sources/LarkIslandApp` target dep），M4 / M5 没有真正使用。本里程碑首次接通。

支持的 markdown 子集 = `swift-markdown-ui` 默认（CommonMark + 部分 GFM 扩展，含 inline code / bold / italic / list / link / blockquote）。任务的 finalAnswer 来自 GUIAgent 的 `onFinalAnswer`，文本为中英混排，需正确处理。

#### Scenario: completed 任务以 markdown 渲染 finalAnswer
- **WHEN** session.phase == .completed
- **AND** session.summary 含 markdown 语法（例：`"已发送 **3 条** 消息"`）
- **THEN** 灵动岛 opened 态 task body 中出现渲染后的富文本（"3 条" 加粗）
- **AND** 不再以原始 `**3 条**` 字面量显示

## MODIFIED Requirements

### Requirement: 灵动岛 overlay 反映当前 web-agent 任务状态

灵动岛 overlay SHALL 是 SessionState 的实时投影。具体行为：

- 当 SessionState 中**没有**可见 session 时（`isVisibleInIsland == false`），overlay 处于紧凑（idle）形态：仅显示项目品牌标记。
- 当存在恰好一个可见 session 时，overlay 切到展开形态，显示：
  - 任务标题（取 session.title，即 `runWebAgentTask.prompt` 的首行截断到 60 字符）
  - 当前 phase 状态文案（"运行中" / "等待批准" / "等待回答" / "已完成" / "已失败"）
  - 最近一条 step 的 thought（截断到 100 字符）
  - **最近一帧 screenshot 的缩略图**（如果 `latestScreenshotURL` 字段非 nil 且文件可读，否则不渲染缩略图；详见 ADDED Requirement"灵动岛 opened 态显示当前任务的最近一帧 screenshot 缩略图"）
  - **完成时**：finalAnswer 用 `swift-markdown-ui` 渲染（详见 ADDED Requirement"灵动岛 opened 态用 swift-markdown-ui 渲染 finalAnswer"）。失败时仍以纯文本显示 `webAgentTaskFailed.message`。
- 当 session 进入 `phase == .completed` 后，overlay 在 8 秒后自动调用 `SessionState.removeInvisibleSessions()`，进入 idle 形态，**除非**鼠标 hover 在 overlay 上（hover 时暂停 fade 计时器，鼠标移走后重新计时）。

#### Scenario: 任务开始 → 步骤更新 → 任务完成
- **WHEN** AppModel 收到 `webAgentTaskStarted` 事件
- **THEN** overlay 在 100ms 内切换到展开形态显示该任务标题
- **WHEN** 后续收到 `webAgentStepUpdate` 事件
- **THEN** overlay 显示对应 step 的 thought + 缩略图
- **WHEN** 收到 `webAgentTaskCompleted`
- **THEN** overlay 显示 `finalAnswer`（markdown 渲染），8 秒后 fade 到 idle

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
