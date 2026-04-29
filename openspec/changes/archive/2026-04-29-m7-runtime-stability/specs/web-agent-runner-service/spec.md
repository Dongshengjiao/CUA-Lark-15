## MODIFIED Requirements

### Requirement: GUIAgent 启动前执行登录预检

如果命中的 skill `loginURL` 非空，runner SHALL 在跳转 `startingURL` 之前先执行登录预检。预检本身分两个 phase：

**Phase 0 — segment 对齐（M7 新增）**：

预检之前 runner MUST 检查当前 LocalBrowser 实例的 `userDataDir` 是否与 `skill.userDataDirSegment` 对应的目录一致。runner 在 `BrowserRef` 上 SHALL 维护一个 `currentSegment: string` 字段记录当前 chromium 实例使用的 user-data-dir segment。

如果 `browserRef.currentSegment !== skill.userDataDirSegment`：
- runner 关闭当前 LocalBrowser（`safeClose`）。
- runner 重新 launch 一个 headless LocalBrowser，`userDataDir` 设为 `userDataDirFor(skill.userDataDirSegment)`。
- runner 更新 `browserRef.current` 与 `browserRef.currentSegment`。

如果两者已经一致，跳过 Phase 0，直接进 Phase 1。

理由：M5 设计 runner 启动时预 launch chromium 用 `'generic'` segment，方便通用 google 任务的 default starting URL 行为。但当 task 路由到 `feishu_im_send`（segment='feishu'）时，Phase 1 的 cookie 探测发生在 generic browser 上，永远查不到 .feishu.cn 的 session cookie——即使 `profiles/feishu/Cookies` 里有有效 cookie，也会强制走 Phase 2 visible 扫码流程。M7 通过 Phase 0 在探测之前先把 browser 切到正确的 user-data-dir，从而让"runner 重启后第一次飞书任务"能利用已有 cookie。

**Phase 1 — 预检本体（同 M5）**：

1. 在已对齐的 chromium 上 navigate 到 `startingURL`，等待 `networkidle2`。
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

如果 `loginURL` 为空字符串，跳过整个预检直接进入 GUIAgent 主循环（Phase 0 也跳过；通用任务保持当前 segment 不切换）。

#### Scenario: cookie 已存在直接进 GUIAgent
- **WHEN** runner 跑 feishu 任务且 `profiles/feishu/Cookies` 已经包含 .feishu.cn 的 session cookie
- **AND** 当前 chromium 已经是 `'feishu'` segment
- **THEN** runner 跳过 Phase 0
- **AND** 不切换到可见 chromium
- **AND** 直接 navigate 到 startingURL 后启动 GUIAgent

#### Scenario: runner 启动后第一次跑飞书任务且 cookie 已存在（M7 新增）
- **WHEN** runner 启动后第一次收到飞书任务，`browserRef.currentSegment === 'generic'`
- **AND** `profiles/feishu/Cookies` 已经包含有效 .feishu.cn session cookie
- **THEN** runner 进入 Phase 0：close 当前 generic browser、launch 新 headless browser 用 `profiles/feishu/`、更新 `browserRef.currentSegment = 'feishu'`
- **AND** Phase 1 在新 browser 上探测 cookie 命中
- **AND** 不进入扫码模式
- **AND** 直接进入 GUIAgent 主循环

#### Scenario: cookie 不存在触发扫码模式
- **WHEN** runner 跑 feishu 任务且 cookie 检测返回 false
- **THEN** runner 不进入 GUIAgent 主循环
- **AND** 进入扫码模式（见下条）

#### Scenario: skill 未声明 loginURL 跳过预检
- **WHEN** skill 的 `loginURL = ""`
- **THEN** runner 直接 navigate 到 startingURL 启动 GUIAgent，不调 detectLoggedIn，不做 segment 对齐

### Requirement: 扫码模式按规范切换 visible chromium 并轮询登录态

进入扫码模式后，runner SHALL 顺序执行：

1. 关闭当前 headless LocalBrowser。
2. 用 `userDataDirFor(skill.userDataDirSegment)` 重 launch `LocalBrowser({ headless: false })`；同时更新 `browserRef.currentSegment = skill.userDataDirSegment`（M7 新增：保持 ref 与实际 user-data-dir 一致）。
3. navigate 到 `skill.loginURL`，等待 `domcontentloaded`。
4. 通过 bridge 发 `webAgentApprovalRequested{taskID, kind: "login_qr", message: "请扫码登录<skill 显示名>", timestamp: now}` envelope。
5. 进入轮询循环：每 2 秒调一次 `skill.detectLoggedIn(page)`，命中 true 即结束循环。
6. 总等待时长上限 30 分钟（1800 秒）。超时 SHALL 通过 bridge 发 `webAgentTaskFailed{taskID, kind: cancelled, message: "login timeout (30min)"}` 并：
   - 关闭 visible LocalBrowser。
   - 重 launch headless LocalBrowser（保持 `currentSegment = skill.userDataDirSegment` 一致——下次同 skill 任务可以复用 cookies；下次不同 skill 任务再走 Phase 0 切换）。
   - 不发 `webAgentTaskCompleted`。
7. 登录成功（detectLoggedIn 返回 true）后：
   - 关闭 visible LocalBrowser。
   - 重 launch headless LocalBrowser（同 userDataDir，cookie 已落盘可继承；同步更新 `browserRef.currentSegment`）。
   - navigate 到 `skill.startingURL`，等待 `networkidle2`。
   - 启动 GUIAgent 主循环，把原 prompt 跑完。
   - 整个登录-切换过程不计入 step 序号；GUIAgent 第一个 stepIndex 仍是 0。

扫码模式期间 runner MUST 不接受其他 `runWebAgentTask` 命令（仍走单任务串行约束，第二条命令立即拒绝为 "runner busy"）。

#### Scenario: 扫码成功后无缝继续主任务
- **WHEN** runner 进入扫码模式且用户在 60 秒内完成扫码
- **THEN** runner 关闭 visible browser
- **AND** relaunch headless browser，`browserRef.currentSegment` 同步更新
- **AND** 发出 `webAgentTaskStarted` 后续的 `webAgentStepUpdate` 序列从 stepIndex 0 开始
- **AND** 任务最终发出 `webAgentTaskCompleted`

#### Scenario: 扫码 30 分钟超时 task 失败
- **WHEN** runner 进入扫码模式且 30 分钟内 detectLoggedIn 一直返回 false
- **THEN** runner 发 `webAgentTaskFailed{kind: cancelled, message: "login timeout (30min)"}`
- **AND** 关闭 visible browser
- **AND** relaunch headless browser，`browserRef.currentSegment` 保持为该 skill 的 segment（避免下次同 skill 任务又走一次 Phase 0）

#### Scenario: 扫码期间收到第二条 task 立即拒绝
- **WHEN** runner 处于扫码模式（可见 chromium 还在等扫码）
- **AND** 收到 `runWebAgentTask{taskID: "t2", ...}`
- **THEN** runner 不取消 t1 的扫码循环
- **AND** 立即发 `webAgentTaskFailed{taskID: "t2", kind: pageError, message: "runner busy with <t1>"}`

### Requirement: runner 单元/集成测试覆盖 skill resolution 与扫码模式

`runners/web-agent/test/runtime.test.ts` 与 `runners/web-agent/test/login.test.ts`（M7 新增）合计 MUST 覆盖：

- 命中 skill 时 `runTask` 调用 GUIAgent 前注入了 systemPromptAddendum / startingURL（用 mock GUIAgent 验证 args）。
- 未命中时 `runTask` 不注入额外 prompt。
- 登录预检 mock：page.cookies() 返回非空 → 跳过扫码；返回空 → 进入扫码模式。
- 扫码模式 mock：模拟登录在第 N 次轮询返回 true，验证最终发 `webAgentTaskStarted` + `webAgentTaskCompleted`，期间发了 `webAgentApprovalRequested`。
- 扫码超时 mock：detectLoggedIn 永远 false，30 分钟超时（用 vitest fake timers 加速）后发 `webAgentTaskFailed{kind: cancelled}`。
- **M7 新增 Phase 0 segment 对齐覆盖**（`login.test.ts`）：
  - case A: `currentSegment === 'generic'`，调 ensureLoggedIn 一个 segment='feishu' 的 skill + detectLoggedIn 返回 true → safeClose 调用一次、新 launch 一次、`browserRef.currentSegment === 'feishu'`、Phase 2 visible 流程**不**触发。
  - case B: `currentSegment === 'feishu'`，detectLoggedIn 返回 true → 不触发 close+relaunch（保持 ref 不变）。
  - case C: `currentSegment === 'generic'`，detectLoggedIn 返回 false → 走 Phase 2 visible 流程→ Phase 3 relaunch headless，最终 `currentSegment === 'feishu'`。

#### Scenario: vitest 跑通新增测试
- **WHEN** 在 `runners/web-agent/` 执行 `npm test`
- **THEN** runtime.test.ts + login.test.ts 中以上测试用例全部通过
- **AND** login.test.ts 至少包含上述 3 个 Phase 0 case
