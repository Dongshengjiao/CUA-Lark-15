# 任务：m6-demo-polish

## 1. VLM 任务完成率提升（M5 实测暴露的真问题）

- [x] 1.1 在 [`runners/web-agent/src/runner.ts`](../../../runners/web-agent/src/runner.ts) 把 `AgentRuntime` 构造时的 `maxLoopCount` 从 12 改为 30。
- [x] 1.2 重写 [`runners/web-agent/src/skills/feishu_im_send.ts`](../../../runners/web-agent/src/skills/feishu_im_send.ts) 的 `systemPromptAddendum`：
  - 强禁止段：明确禁止点屏幕顶部黑色全局搜索栏，并标注其占位符特征（"⌘+K"、"问你想问的问题"等）。
  - 完成判定段：看到自己消息以蓝色气泡发送方一侧出现 → 立即调 `finished('已通过飞书向 <收件人> 发送：<内容>')`。
  - few-shot 改写：聚焦"自聊"场景（搜索 → 选自己 → 点底部输入框 → type → Cmd+Enter → 看气泡 → finished()），步数 ≤ 8。
- [x] 1.3 同样的强禁止+完成判定+few-shot 重写应用到 [`feishu_calendar_create.ts`](../../../runners/web-agent/src/skills/feishu_calendar_create.ts)：完成判定 = 模态框关闭且日历视图新增条目；few-shot = 点新建 → 填标题 → 选时间 → 保存 → 看新条目 → finished()。
- [x] 1.4 同样应用到 [`feishu_doc_create.ts`](../../../runners/web-agent/src/skills/feishu_doc_create.ts)：完成判定 = 编辑器加载完整且文档标题已写入；few-shot = 点新建 → 选文档 → 输标题 → 进编辑器 → finished()。
- [x] 1.5 在 `runners/web-agent/test/skills.test.ts` 加一组测试断言新 `systemPromptAddendum` 包含关键字符串（"全局搜索"/"finished"/各 skill 完成信号关键词），失败说明 prompt 退化。

## 2. 通用模式默认起始页

- [x] 2.1 [`runners/web-agent/src/runner.ts`](../../../runners/web-agent/src/runner.ts) 在 `LocalBrowser.launch()` 完成后、`registerClient` 之前增加 `await page.goto(DEFAULT_STARTING_URL)` 步骤。
- [x] 2.2 `DEFAULT_STARTING_URL` 常量值 `'https://www.google.com'`；增加注释说明国内用户可改为 `'https://www.bing.com'` 或其它访问稳定的搜索入口。
- [x] 2.3 navigate 失败（超时 / 网络错）时仅 logger.warn 不 throw，page 保留 about:blank，registerClient 仍正常发送。

## 3. 灵动岛 UI 进度可视化

- [x] 3.1 [`lark-island/Sources/LarkIslandCore/AgentSession.swift`](../../../lark-island/Sources/LarkIslandCore/AgentSession.swift) 新增 `latestScreenshotURL: String?` 字段（默认 nil）。
- [x] 3.2 [`lark-island/Sources/LarkIslandCore/SessionState.swift`](../../../lark-island/Sources/LarkIslandCore/SessionState.swift) 在 `webAgentStepUpdate` 分支中把 `payload.screenshotURL` 写到 `session.latestScreenshotURL`。
- [x] 3.3 [`lark-island/Sources/LarkIslandApp/Views/IslandPanelView.swift`](../../../lark-island/Sources/LarkIslandApp/Views/IslandPanelView.swift) 的 `OpenedTaskBody`：当 `session.latestScreenshotURL` 非 nil 且 FileManager 存在时，渲染一个 ≤120pt 宽的 `Image(nsImage:)` 缩略图，圆角 8，描边 white.opacity(0.18)。
- [x] 3.4 同上 view：当 `session.phase == .completed` 时把 finalAnswer (`session.summary`) 用 `MarkdownUI.Markdown(session.summary)` 渲染，替换原 `Text(session.summary)`。
- [x] 3.5 `LarkIslandCoreTests/SessionStateTests.swift` 加测试 case：`webAgentStepUpdate` 后 `session.latestScreenshotURL == payload.screenshotURL`。

## 4. dev 启动一键化 + 文档

- [x] 4.1 新建 [`scripts/dev.sh`](../../../scripts/dev.sh)（zsh）：cd 到仓库根 → `npm install --silent` → `swift build` → `swift run LarkIslandApp` 后台 → grep runner log 等待 `registered as webAgentRunner` → 输出"runner ready, click menubar to start"。
- [x] 4.2 新建顶层 [`README.md`](../../../README.md)：项目 1 段简介（"灵动岛 + 浏览器沙箱 web agent"）、三步本地启动（git clone / scripts/dev.sh / 点菜单栏）、已知问题清单（首次飞书需扫码 / Qwen3-VL-Plus 在飞书 React 上偶尔迷路 / 国内 google 访问慢可改 bing）、license map 链接。
- [x] 4.3 更新 [`lark-island/README.md`](../../../lark-island/README.md)：补"两条输入路径（菜单栏 popover / 灵动岛 hover）实测演示"段、补"如何重置飞书登录态"指引（rm -rf profiles/feishu/）、补"如何切到 Doubao profile"指引。
- [x] 4.4 在 [`runners/web-agent/.env.example`](../../../runners/web-agent/.env.example) 末尾增加 "M6 demo notes" 段：列出 demo 命令示例 + maxLoopCount 30 默认值说明。

## 5. demo 录制

- [-] 5.1 录前准备：手动跑一次飞书 IM 任务让 cookie 落盘新鲜（M6 实施完后第一次 e2e）。验证 task 1.x / 2.x / 3.x 改动都生效。
- [-] 5.2 录第一段（通用任务）：起 dev.sh → 菜单栏 🌐 弹出 popover → 输 `"在 google 搜索 UI-TARS 报告前 3 条结果"` → Run → 灵动岛展开 → 实时缩略图刷新 → 完成态 markdown 渲染最终答案。约 60 秒。
- [-] 5.3 录第二段（飞书 IM）：菜单栏 → 输 `"在飞书给自己发条消息：hello demo"` → Run → 灵动岛变橙提示扫码（M5 已验证通过；如果 cookie 还没过期可跳过这段录制） → 扫码 → headless relaunch → 步骤流 → 完成。约 60 秒。如扫码段已录过可裁剪。
- [-] 5.4 用 macOS Cmd+Shift+5 录制；用 QuickTime / iMovie trim 拼接成单段 ≤2 分钟视频。
- [-] 5.5 存到 [`lark-island/docs/m6-demo.mov`](../../../lark-island/docs/m6-demo.mov)：≤30MB 入仓；超过则用云存储外链替代，README 给链接。

## 6. 端到端验收

- [x] 6.1 `cd runners/web-agent && npm run typecheck && npm test`：56 → ≥ 57 通过。
- [x] 6.2 `cd lark-island && swift build && swift test`：30 → ≥ 31 通过。
- [-] 6.3 起 `scripts/dev.sh`，runner ready 消息出现。
- [-] 6.4 跑通用 google 任务一次：≤ 15 step 内完成，灵动岛缩略图刷新过 ≥ 3 次，finalAnswer markdown 渲染。
- [-] 6.5 跑飞书 IM 自聊任务一次：≤ 25 step 内完成，消息真的发出（在飞书 app 看到自己收到），灵动岛缩略图刷新过 ≥ 5 次。
- [-] 6.6 demo.mov 录制完成入仓（或外链可访问）。

## 7. 收尾

- [x] 7.1 `npx @fission-ai/openspec validate m6-demo-polish --strict` 干净通过。
- [x] 7.2 拆 commit（建议 4 个）：
  - `feat(runner): bump maxLoopCount + default starting URL`（task 1.1 / 2.x / 1.5）
  - `feat(skills): rewrite feishu systemPromptAddendum with strong guards + completion signals`（task 1.2-1.4）
  - `feat(island): show step screenshot thumbnail + render finalAnswer markdown`（task 3.x）
  - `chore(repo): add scripts/dev.sh + README + demo.mov`（task 4.x / 5.x）
- [x] 7.3 `/opsx-archive m6-demo-polish` 把 modified delta sync 进 `openspec/specs/`。

## 8. 备选 path B（仅在 task 6.5 飞书 IM 任务连续 3 次失败时启动）

- [-] 8.1 给 `feishu_im_send` 加 `mode: 'dom'` 字段，runtime 在 mode === 'dom' 时把 GUIAgent 的 click 路径替换为：让 LLM 输出 `{element_text, role}` JSON，由 puppeteer `page.getByRole/getByText` 在 DOM 里精确定位执行。本任务不在默认 milestone 范围内。
