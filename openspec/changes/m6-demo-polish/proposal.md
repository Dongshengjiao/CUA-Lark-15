## Why

M5 task 7.3 真实跑通后暴露三类问题：

1. **VLM 在飞书界面"迷路"**：实测 Qwen3-VL-Plus 把 12 个 loop 全花在"顶部黑色全局搜索栏"和"会话列表搜索框"之间反复打转。最后第 12 步终于点中"钟梓文-北邮"自聊入口，但 maxLoopCount 已经触底——任务被强制中止，没机会输入消息+发送。flag 是 plan 风险 1 的实测体现：**默认 system prompt + skill addendum 不够强，引导不到位**。
2. **runner.ts 把 maxLoopCount 写死为 12** 太严：上游 `@ui-tars/sdk` 默认 25。飞书这种多步任务至少需要 ≥30 步预算才有完成空间。
3. **通用任务（无 skill 命中）落在 about:blank 页**：M5 task 7.5 实测时 VLM 看到空白屏 + Clickable Elements 提示框，**完全不知道自己在浏览器里**，第一反应是"用 Cmd+Space 唤起 Spotlight"，跟"在 Chromium 里跑网页任务"的产品定位完全相反。

同时 M6 是 plan 划好的 demo polish 收尾里程碑，原本就要交付：录屏 demo.mov、写最小化 README、把灵动岛 UI 接通缩略图与 markdown 渲染。

## What Changes

- **VLM 任务完成率提升**（M5 实战暴露的真问题）
  - `runner.ts` 把 `maxLoopCount` 从 12 提升到 30，飞书这种多步任务才有完成预算。
  - 飞书三个 skill 的 `systemPromptAddendum` 重写：明确禁止点屏幕顶部黑色全局搜索栏；详细解释 ⌘+K 是飞书消息会话搜索的入口；演示"搜索自己 → 选第一个搜索结果 → 在底部消息输入框 type → Cmd+Enter"的精确步骤；最后 finished() 触发条件写死（看到对话气泡 = 完成）。
  - 通用模式新增默认起始页：runner.ts 启动 LocalBrowser 时不再停在 about:blank，而是 navigate 到 `https://www.google.com`（或可配置的默认入口）；VLM 看到搜索框就知道"我在浏览器里、可以输 URL/搜索词"。
- **灵动岛 UI 真正展示进度**（M4 时遗留的 task 4.3 扩展）
  - `IslandPanelView.OpenedTaskBody` 接入 `webAgentStepUpdate.screenshotURL`：用 `NSImage(byReferencing:)` 读截图，渲染缩略图（≤120pt 宽，圆角 8）。
  - finalAnswer 用 `swift-markdown-ui` 的 `Markdown(_:)` 渲染（M4 已经引依赖，没真用上）。
- **dev 启动一键化**
  - 新增顶层 `scripts/dev.sh`：一行命令完成 `npm install` / 起 LarkIslandApp / 检测 runner 启动成功 / 输出可点的下一步指引。
  - 顶层 `README.md`：项目简介一段 + 三步本地启动 + 已知问题清单。
  - `lark-island/README.md`：补"如何手敲菜单栏 + 灵动岛 hover 各跑一次任务"的演示路径。
- **demo.mov 录制 + 项目展示资产**
  - 录两段端到端 demo（约 2 分钟剪辑成 1 段）：通用 Google 搜索 + 飞书 IM 发消息（自聊场景）。
  - 存到 `lark-island/docs/m6-demo.mov`（git LFS 不引入；超 50MB 则只在 README 里给云端链接）。

## Capabilities

### New Capabilities

无。M6 全部是对现有 capability 的 polish + 补全。

### Modified Capabilities

- `web-agent-skills`: 三个内置飞书 skill 的 `systemPromptAddendum` 重写为更强引导；每个 skill 新增"完成判定信号"小节
- `web-agent-runner-service`: `maxLoopCount` 默认值从 12 调到 30；通用模式新增默认起始页策略（runner spawn 时 navigate 到 startup URL 而非停在 about:blank）
- `lark-island-app`: 灵动岛 opened 态接入 step screenshot 缩略图 + finalAnswer markdown 渲染；菜单栏 popover 输入框补 Esc 关闭 + 历史 prompt 上下方向键调取（可选，非阻塞）

## Impact

- **代码**：
  - runner: 改 `runner.ts`（maxLoopCount + 启动 navigate）；改 3 个 skill 的 systemPromptAddendum；测试微调
  - lark-island: 改 `IslandPanelView.swift`（缩略图 + markdown 渲染，约 60 行）；可选补 `WebAgentInputPanel.swift` 历史 prompt 功能
  - 新增 `scripts/dev.sh`、顶层 `README.md`、`lark-island/README.md`
  - 新增 `lark-island/docs/m6-demo.mov`（视频资产，可能 git lfs / 外链）
- **协议**：bridge schema 不变
- **依赖**：无新增；swift-markdown-ui 已在 Package.swift（M4 引入未使用）
- **风险**：
  - VLM 调强 prompt 后第二次跑飞书 IM 仍可能失败（plan 风险 1 残余）；M6 demo 录制时按 `take` 模式录 N 次取最佳一次，不强求 demo 100% 一次过
  - 缩略图渲染可能因为 NSImage 缓存读盘抖动出现 latency；先以"最近一帧 + 200ms 延迟更新"做兜底
- **数据**：无
- **运维**：用户首次跑 demo 时仍需扫码飞书；README 写明"首次会弹可见 Chromium 让你扫码"
