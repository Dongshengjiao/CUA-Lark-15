# 任务：m5-feishu-skills

## 1. Skill 框架（runners/web-agent/src/skills/）

- [x] 1.1 新建 [`runners/web-agent/src/skills/types.ts`](../../../runners/web-agent/src/skills/types.ts)：定义 `Skill` interface（含 `id` / `matchKeywords` / `cookieDomain` / `userDataDirSegment` / `loginURL` / `startingURL` / `systemPromptAddendum` / 可选 `detectLoggedIn`）。配套 `LoggedInDetector` 类型别名。
- [x] 1.2 新建 [`runners/web-agent/src/skills/router.ts`](../../../runners/web-agent/src/skills/router.ts)：导出 `selectSkill(prompt: string, registry: Skill[]): Skill | null` 纯函数；按 registry 顺序首命中返回。
- [x] 1.3 新建 [`runners/web-agent/src/skills/registry.ts`](../../../runners/web-agent/src/skills/registry.ts)：导出默认数组 `[feishu_im_send, feishu_calendar_create, feishu_doc_create]`（顺序即优先级）。
- [x] 1.4 新建三个 skill 实现文件：
  - [`runners/web-agent/src/skills/feishu_im_send.ts`](../../../runners/web-agent/src/skills/feishu_im_send.ts)
  - [`runners/web-agent/src/skills/feishu_calendar_create.ts`](../../../runners/web-agent/src/skills/feishu_calendar_create.ts)
  - [`runners/web-agent/src/skills/feishu_doc_create.ts`](../../../runners/web-agent/src/skills/feishu_doc_create.ts)
  
  每个文件至少 30 行：matchKeywords（中英各一组）、cookieDomain `.feishu.cn`、userDataDirSegment `feishu`、loginURL `https://passport.feishu.cn/`、startingURL（飞书 IM/calendar/drive 入口）、systemPromptAddendum（含针对 React 应用的坐标提示 + 1-2 条 few-shot）。
- [x] 1.5 实现共享 detectLoggedIn 默认函数：检查 `page.cookies()` 命中 `.feishu.cn` 域且 name 包含 `session`。放在 `runners/web-agent/src/skills/cookies.ts`。

## 2. Runtime 接入 skill resolution

- [x] 2.1 修改 [`runners/web-agent/src/agent/runtime.ts`](../../../runners/web-agent/src/agent/runtime.ts) 让 `runTask` 接受 `skill?: Skill` 参数；命中 skill 时把 `systemPromptAddendum` 拼到 GUIAgent system prompt、把 `startingURL` 作为第一步 navigate 目标。
- [x] 2.2 增加 `userDataDir` 解析逻辑：命中 skill 用 `~/Library/Application Support/LarkIsland/web-agent/profiles/<segment>/`，未命中用 `profiles/generic/`。每次 LocalBrowser launch 之前确保目录存在（递归 mkdir）。
- [x] 2.3 在 `runTask` 入口增加 logger.info `routed task <taskID> to skill <id|generic>`。

## 3. 登录预检与扫码模式

- [x] 3.1 在 runtime 增加 `runLoginPrecheck(skill, page)` helper：navigate 到 startingURL 后调 `skill.detectLoggedIn ?? defaultDetect`；返回布尔值。
- [x] 3.2 实现扫码模式状态机 `runLoginQRFlow(skill, taskID, bridge)`：
  - close 当前 LocalBrowser
  - launch `LocalBrowser({ headless: false, userDataDir })`
  - navigate `skill.loginURL`
  - 通过 bridge 发 `webAgentApprovalRequested{kind: "login_qr", message: "请扫码登录<skill displayName>"}`（displayName 是 skill 上新加的可选字段或者沿用 id 转中文 dictionary）
  - 启动 polling：`setInterval(2000)` 调 detectLoggedIn；命中即 resolve
  - 30 分钟超时：reject
- [x] 3.3 把扫码流程嵌进 `runTask` 流程：profile 错误优先拒绝；profile 正常 → skill 命中 → 登录预检 → 不通过则跑 runLoginQRFlow → 通过则 close visible browser → relaunch headless → navigate startingURL → 进入 GUIAgent 主循环。
- [x] 3.4 单任务串行约束：扫码模式期间 `currentTaskID` 仍非空，runner 接到第二条 `runWebAgentTask` 仍走 M3 已有的 "runner busy" 拒绝路径。
- [x] 3.5 扫码超时 / runner exit / socket EOF 等异常：cleanup visible browser、relaunch headless、回灌 `webAgentTaskFailed{kind: cancelled, message: "login timeout (30min)"}`。

## 4. Runner 入口接通

- [x] 4.1 修改 [`runners/web-agent/src/runner.ts`](../../../runners/web-agent/src/runner.ts) 在 dispatch 前 `import { selectSkill } from './skills/router'` + `import { registry } from './skills/registry'`，调 `selectSkill(prompt, registry)` 得到 `skill`，传给 `runTask({ ..., skill })`。
- [x] 4.2 logger 写一行 `dispatching <taskID> via skill=<id|generic>`，便于日志诊断。

## 5. Vitest 测试

- [x] 5.1 新建 [`runners/web-agent/test/skills.test.ts`](../../../runners/web-agent/test/skills.test.ts) 覆盖：
  - registry 含 3 个内置 skill。
  - 每 skill 必填字段非空（id / matchKeywords / cookieDomain / userDataDirSegment / loginURL / startingURL / systemPromptAddendum）。
  - router 命中：飞书 IM 中文 prompt → `feishu_im_send`；飞书文档英文 prompt → `feishu_doc_create`；google 搜索 prompt → null；空 prompt → null；多 skill keyword tie-break 时按数组顺序。
  - 默认 detectLoggedIn：mock `page.cookies()` 返回 `.feishu.cn / session=abc` → true；返回 `[]` → false。
- [x] 5.2 修改 [`runners/web-agent/test/runtime.test.ts`](../../../runners/web-agent/test/runtime.test.ts)，新增 4 个测试：
  - 命中 skill 时 mock GUIAgent 验证 system prompt 末尾含 systemPromptAddendum。
  - 未命中 skill 时 GUIAgent system prompt 不含任何 skill addendum。
  - 登录预检：mock detectLoggedIn 返回 true → 直接进 GUIAgent；返回 false → 进入扫码流程（mock LocalBrowser.launch headless:false 被调用）。
  - 扫码超时：用 vitest fake timers 推 30 分钟，mock detectLoggedIn 永远 false → `webAgentTaskFailed{kind: cancelled, message 含 "login timeout"}`。
- [x] 5.3 跑 `cd runners/web-agent && npm test`：所有用例（含已有的 36 + 新加的 ≥ 9）通过。

## 6. LarkIslandApp 端 UI 适配

- [x] 6.1 在 [`lark-island/Sources/LarkIslandCore/SessionState.swift`](../../../lark-island/Sources/LarkIslandCore/SessionState.swift) 验证 `webAgentApprovalRequested` 事件 reducer 已经正确 set `phase = .waitingForApproval` + `permissionRequest = .init(summary: kind, ...)`。如果还没把 kind 写进 `permissionRequest`，本里程碑加一个可选 `kind: String?` 字段。
- [x] 6.2 在 [`lark-island/Sources/LarkIslandApp/Views/IslandPanelView.swift`](../../../lark-island/Sources/LarkIslandApp/Views/IslandPanelView.swift) 的 `OpenedTaskBody`：当 `session.permissionRequest != nil && permissionRequest.kind == "login_qr"` 时，渲染独立的橙色提示行（`Image(systemName: "qrcode")` + summary + 小字 "已在浏览器中打开登录页面..."）。
- [x] 6.3 验证 closed-state `attentionSession` 计算逻辑已经把 `.waitingForApproval` 当作 attention（M4 应当已经如此），让 BrandMark + 右侧 dot 显示橙色。如果未生效，本里程碑修。
- [x] 6.4 增加 SwiftUI 单测（或在现有 `LarkIslandCoreTests` 里加 reducer 测试）：`webAgentApprovalRequested(kind: "login_qr")` 触发后 SessionState 反映正确 phase + permissionRequest 字段。
- [x] 6.5 跑 `cd lark-island && swift test`：≥ 28 个用例（M4 base）+ 新增 ≥ 1 个 全绿。

## 7. 端到端验收

- [x] 7.1 `cd runners/web-agent && npm run typecheck && npm test` 全绿（typecheck 0 错；vitest 56/56 pass — M3 36 + M5 新增 15 skills + 5 runtime）。
- [x] 7.2 `cd lark-island && swift build && swift test` 全绿（build 0 错；30/30 pass — M4 28 + M5 新增 2 reducer 测试）。
- [-] 7.3 手动 e2e：先在 LarkIslandApp 跑一次 IM 任务（"给自己发条飞书消息: hello from m5"）：
  - 第一次：触发扫码；灵动岛 closed 变橙；opened 显示二维码 + "请扫码登录飞书"；用户在 visible chrome 扫码；扫码后灵动岛恢复蓝色 running 态；任务完成后进 .completed。
  - 第二次：cookie 已存在；不弹可见 chrome；直接 headless 跑完发消息。
- [-] 7.4 手动 e2e：跑一次"创建飞书文档: M5 demo notes"任务。验证 router 命中 `feishu_doc_create`、user-data-dir 共用 `feishu/`、不再扫码。**留 demo 期实测**。
- [-] 7.5 手动 e2e：跑一次非飞书任务（"在 example.com 读 page title"）。验证 router 返回 null、user-data-dir 用 `generic/`、不进入登录预检。**留 demo 期实测**。
- [x] 7.6 在 [`runners/web-agent/.env.example`](../../../runners/web-agent/.env.example) 增加注释：`# 飞书首次登录会在 ~/Library/Application Support/LarkIsland/web-agent/profiles/feishu/ 下落盘大量 chromium 数据；如需重置请删除该目录`。

## 8. 收尾

- [x] 8.1 `npx @fission-ai/openspec validate m5-feishu-skills --strict` 干净通过。
- [x] 8.2 拆 commit：
  - `feat(runner): add skill framework + 3 feishu skills`（task 1+5.1）
  - `feat(runner): wire skill resolution into runtime + login precheck`（task 2-4 + 5.2）
  - `feat(island): render login_qr approval in opened state`（task 6）
- [x] 8.3 `/opsx-archive m5-feishu-skills` 把 `web-agent-skills` 新 capability + `web-agent-runner-service` modified + `lark-island-app` modified 一起 sync 到 `openspec/specs/`。

## 9. （视情况）path B 备选——只在 7.3 IM 任务命中率明显偏低时启动

- [ ] 9.1 如果 IM 任务连续 3 次失败（GUIAgent 抛错 / 步数 ≥ 30 仍未发出消息），新增 `feishu_im_send_dom` 平行 skill（或在原 skill 上加 mode 字段），让 systemPromptAddendum 引导 LLM 输出 `{element_text, action}` JSON 而非 click 坐标，runtime 用 puppeteer `page.getByRole/getByText` 精确定位执行。本任务不在默认 milestone 范围内，命中率达标可直接跳过。
