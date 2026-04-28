## ADDED Requirements

### Requirement: runner 在 dispatch 前先做 skill resolution

runner 收到 `runWebAgentTask` 命令后 SHALL 先调用 `selectSkill(prompt, registry)`（见 `web-agent-skills` capability），再做 GUIAgent 启动准备：

- 命中 skill：把 skill 实例传给 `runTask(skill?: Skill)`，runner 在 GUIAgent 启动前注入 skill 的 `systemPromptAddendum` 与 `startingURL`，并把 chromium 启动时 `userDataDir` 设为 `~/Library/Application Support/LarkIsland/web-agent/profiles/<skill.userDataDirSegment>/`。
- 未命中：runtime 仍旧创建 GUIAgent，但 `userDataDir` 用 `profiles/generic/`，不注入 startingURL（直接由 prompt 决定第一步），不注入 systemPromptAddendum。

skill resolution MUST 在 `webAgentTaskStarted` envelope 发出**之前**完成；envelope 里可选地携带 `skill: skill?.id ?? null` 字段供 UI 显示当前路由结果（M5 不强制 wire 上加，但 runtime 内部 logger 至少要写一行 `routed task <taskID> to skill <id|generic>`）。

#### Scenario: 飞书任务命中 feishu_im_send 后注入 system prompt 与 startingURL
- **WHEN** runner 收到 `runWebAgentTask{prompt: "给张三发条飞书消息"}`
- **THEN** runner 在日志里写 `routed task <taskID> to skill feishu_im_send`
- **AND** chromium 用 `profiles/feishu/` user-data-dir 启动
- **AND** 第一步 navigate 到 `feishu_im_send.startingURL`
- **AND** GUIAgent system prompt 末尾包含 `feishu_im_send.systemPromptAddendum`

#### Scenario: 通用任务无 skill 命中走 generic
- **WHEN** runner 收到 `runWebAgentTask{prompt: "在 example.com 读 page title"}`
- **THEN** router 返回 null
- **AND** chromium 用 `profiles/generic/` user-data-dir 启动
- **AND** runner 不注入额外的 systemPromptAddendum 或 startingURL

### Requirement: GUIAgent 启动前执行登录预检

如果命中的 skill `loginURL` 非空，runner SHALL 在跳转 `startingURL` 之前先执行登录预检：

1. 用 headless chromium navigate 到 `startingURL`，等待 `networkidle2`。
2. 调用 `skill.detectLoggedIn(page)`；如未提供，使用默认实现：检查 `page.cookies()` 里是否存在 domain 后缀匹配 `skill.cookieDomain` 且 name 包含 "session" 的 cookie（一个就足够）。
3. 默认实现等价 typescript：
   ```ts
   const cookies = await page.cookies()
   return cookies.some(c =>
     c.domain.endsWith(skill.cookieDomain) &&
     c.name.toLowerCase().includes('session')
   )
   ```
4. 已登录：直接进入 GUIAgent 主循环，不弹可见窗口。
5. 未登录：进入"扫码模式"（见下一条 Requirement）。

如果 `loginURL` 为空字符串，跳过预检直接进入 GUIAgent 主循环。

#### Scenario: cookie 已存在直接进 GUIAgent
- **WHEN** runner 跑 feishu 任务且 `profiles/feishu/Cookies` 已经包含 .feishu.cn 的 session cookie
- **THEN** runner 不切换到可见 chromium
- **AND** 直接 navigate 到 startingURL 后启动 GUIAgent

#### Scenario: cookie 不存在触发扫码模式
- **WHEN** runner 跑 feishu 任务且 cookie 检测返回 false
- **THEN** runner 不进入 GUIAgent 主循环
- **AND** 进入扫码模式（见下条）

#### Scenario: skill 未声明 loginURL 跳过预检
- **WHEN** skill 的 `loginURL = ""`
- **THEN** runner 直接 navigate 到 startingURL 启动 GUIAgent，不调 detectLoggedIn

### Requirement: 扫码模式按规范切换 visible chromium 并轮询登录态

进入扫码模式后，runner SHALL 顺序执行：

1. 关闭当前 headless LocalBrowser。
2. 用同一 `userDataDir` 重 launch `LocalBrowser({ headless: false })`。
3. navigate 到 `skill.loginURL`，等待 `domcontentloaded`。
4. 通过 bridge 发 `webAgentApprovalRequested{taskID, kind: "login_qr", message: "请扫码登录<skill 显示名>", timestamp: now}` envelope。
5. 进入轮询循环：每 2 秒调一次 `skill.detectLoggedIn(page)`，命中 true 即结束循环。
6. 总等待时长上限 30 分钟（1800 秒）。超时 SHALL 通过 bridge 发 `webAgentTaskFailed{taskID, kind: cancelled, message: "login timeout (30min)"}` 并：
   - 关闭 visible LocalBrowser。
   - 重 launch headless LocalBrowser（保持 runner 处于 ready 状态，便于下一条任务）。
   - 不发 `webAgentTaskCompleted`。
7. 登录成功（detectLoggedIn 返回 true）后：
   - 关闭 visible LocalBrowser。
   - 重 launch headless LocalBrowser（同 userDataDir，cookie 已落盘可继承）。
   - navigate 到 `skill.startingURL`，等待 `networkidle2`。
   - 启动 GUIAgent 主循环，把原 prompt 跑完。
   - 整个登录-切换过程不计入 step 序号；GUIAgent 第一个 stepIndex 仍是 0。

扫码模式期间 runner MUST 不接受其他 `runWebAgentTask` 命令（仍走单任务串行约束，第二条命令立即拒绝为 "runner busy"）。

#### Scenario: 扫码成功后无缝继续主任务
- **WHEN** runner 进入扫码模式且用户在 60 秒内完成扫码
- **THEN** runner 关闭 visible browser
- **AND** relaunch headless browser
- **AND** 发出 `webAgentTaskStarted` 后续的 `webAgentStepUpdate` 序列从 stepIndex 0 开始
- **AND** 任务最终发出 `webAgentTaskCompleted`

#### Scenario: 扫码 30 分钟超时 task 失败
- **WHEN** runner 进入扫码模式且 30 分钟内 detectLoggedIn 一直返回 false
- **THEN** runner 发 `webAgentTaskFailed{kind: cancelled, message: "login timeout (30min)"}`
- **AND** 关闭 visible browser
- **AND** relaunch headless browser 并恢复 ready 状态

#### Scenario: 扫码期间收到第二条 task 立即拒绝
- **WHEN** runner 处于扫码模式（可见 chromium 还在等扫码）
- **AND** 收到 `runWebAgentTask{taskID: "t2", ...}`
- **THEN** runner 不取消 t1 的扫码循环
- **AND** 立即发 `webAgentTaskFailed{taskID: "t2", kind: pageError, message: "runner busy with <t1>"}`

### Requirement: runner 单元/集成测试覆盖 skill resolution 与扫码模式

`runners/web-agent/test/runtime.test.ts` 在 M5 阶段 MUST 新增测试覆盖：

- 命中 skill 时 `runTask` 调用 GUIAgent 前注入了 systemPromptAddendum / startingURL（用 mock GUIAgent 验证 args）。
- 未命中时 `runTask` 不注入额外 prompt。
- 登录预检 mock：page.cookies() 返回非空 → 跳过扫码；返回空 → 进入扫码模式。
- 扫码模式 mock：模拟登录在第 N 次轮询返回 true，验证最终发 `webAgentTaskStarted` + `webAgentTaskCompleted`，期间发了 `webAgentApprovalRequested`。
- 扫码超时 mock：detectLoggedIn 永远 false，30 分钟超时（用 vitest fake timers 加速）后发 `webAgentTaskFailed{kind: cancelled}`。

#### Scenario: vitest 跑通新增测试
- **WHEN** 在 `runners/web-agent/` 执行 `npm test`
- **THEN** runtime.test.ts 中以上五类测试用例全部通过

## MODIFIED Requirements

### Requirement: profile 解析在 M3 阶段仅支持 qwen-default
runner MUST 在收到 `runWebAgentTask` 命令后解析 `profileName` 为 LLM 配置 `{baseURL, apiKey, model}`。本里程碑只支持单一出厂 profile，解析规则：

- `profileName === "qwen-default"` 或 `profileName === null` 或字段缺失：
  - `baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"`
  - `model = "qwen3-vl-plus"`
  - `apiKey = process.env.DASHSCOPE_API_KEY`
- 其他任意值：runner MUST 立即发 `webAgentTaskFailed{kind: vlmError, message: "unknown profile <name>"}`，不进入 GUIAgent。

如果 `apiKey` 解析为 undefined（环境变量未设），runner MUST 发 `webAgentTaskFailed{kind: vlmError, message: "DASHSCOPE_API_KEY not set"}`。

profile 解析 SHALL 在 skill resolution 之后、GUIAgent 启动（含登录预检）之前执行；profile 错误立即拒绝任务，不进入扫码模式（因为没 LLM 也没意义跑后续动作）。

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

#### Scenario: profile 错误优先于扫码预检
- **WHEN** 收到任务命中 `feishu_im_send` 但 `profileName = "claude-opus"`
- **THEN** runner 不进入扫码模式
- **AND** 立即发 `webAgentTaskFailed{kind: vlmError, message: "unknown profile claude-opus"}`
