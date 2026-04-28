## ADDED Requirements

### Requirement: AppModel 把 webAgentApprovalRequested 投影为 SessionPhase.waitingForApproval

AppModel SHALL 在收到 `webAgentApprovalRequested` 事件时通过 SessionState reducer 把对应 session 切到 `phase = .waitingForApproval`，并把 `permissionRequest` 字段填为：

- `summary` = 事件中的 `message` 字段（runner 已经本地化好的中文文案，例如 `"请扫码登录飞书"`）。
- `affectedPath` = 空字符串。
- `kind` = 事件中的 `kind`（M5 内置仅 `"login_qr"`）。

灵动岛 chrome 现有的 closed-state 颜色映射（`scoutTint` / 右侧 dot tint）SHALL 把 `.waitingForApproval` 视作"需要用户注意"分类，渲染为橙色（与 `attentionSession` 保持一致），并保持闪烁动画与 hover-open 行为。

收到后续 `webAgentTaskStarted` 或 `webAgentStepUpdate` 事件，phase MUST 自动还原到 `.running`，permissionRequest 字段 MUST 清空，UI 颜色还原。

#### Scenario: 收到 login_qr 后灵动岛变橙
- **WHEN** AppModel 收到 `webAgentApprovalRequested{taskID: "t1", kind: "login_qr", message: "请扫码登录飞书"}`
- **THEN** session t1 的 `phase = .waitingForApproval`
- **AND** session t1 的 `permissionRequest.summary = "请扫码登录飞书"`
- **AND** 灵动岛 closed 态的 BrandMark + 右侧 dot 在 ≤ 200ms 内变为橙色

#### Scenario: 登录完成后回到 running
- **WHEN** 任务 t1 处于 `.waitingForApproval`
- **AND** runner 完成扫码切回 headless 后发出 `webAgentStepUpdate{taskID: "t1", stepIndex: 0, ...}`
- **THEN** session t1 的 `phase` 自动还原为 `.running`
- **AND** 灵动岛颜色还原为蓝色 / running 状态指示

### Requirement: 灵动岛 opened 态对 login_qr 显示提示文案

当任意 session 处于 `.waitingForApproval` 且 `permissionRequest.kind == "login_qr"` 时，灵动岛 opened 态 MUST 在 task body 区域显示一条独立的提示行，包含：

- 一个 SF Symbol（`qrcode` 或 `viewfinder`）。
- `permissionRequest.summary`（如 `"请扫码登录飞书"`）。
- 一行小字辅助说明：`"已在浏览器中打开登录页面，扫码后会自动继续"`，固定文案，不来自 runner。

文案颜色与图标颜色 MUST 与橙色橙色橙色（`.orange`）保持一致，与 phase pill 区分开。

收到 `.running` 切回后，提示行 MUST 立即消失。

#### Scenario: 扫码模式 opened 态有清晰提示
- **WHEN** 灵动岛 hover-expand 进入 opened 态
- **AND** 当前 session phase 是 `.waitingForApproval` 且 kind 为 `login_qr`
- **THEN** task body 顶部一行显示橙色二维码图标 + "请扫码登录飞书"
- **AND** 紧邻一行小字 "已在浏览器中打开登录页面，扫码后会自动继续"

#### Scenario: 扫码完成后提示行立刻消失
- **WHEN** 任务 phase 由 `.waitingForApproval` 切到 `.running`
- **THEN** opened 态的扫码提示行在 ≤ 100ms 内移除
- **AND** task body 恢复显示常规的 step / summary

### Requirement: 收到非 login_qr 的 approval kind 仍走通用渲染

为给未来其它 skill 留扩展空间（如 OAuth 同意、敏感操作确认），AppModel SHALL 对任何 `webAgentApprovalRequested.kind` 都把 phase 切到 `.waitingForApproval`，但 UI 仅对**已知**的 `kind` 做特化渲染：

- M5 已知 kind：`"login_qr"`（按上一条 Requirement 渲染二维码图标 + 文案）。
- 未来未识别的 kind：fallback 为通用 approval 显示，使用 `lock.shield` 图标 + `permissionRequest.summary` 文案，不显示二维码图标。

UI 不得因为遇到未识别 kind 而崩溃或忽略事件。

#### Scenario: 未识别 kind 用通用 approval 渲染
- **WHEN** AppModel 收到 `webAgentApprovalRequested{kind: "future_oauth_consent", message: "请在浏览器中同意授权"}`
- **THEN** session phase = `.waitingForApproval`
- **AND** opened 态显示 `lock.shield` 图标 + `"请在浏览器中同意授权"`
- **AND** 不显示二维码图标
