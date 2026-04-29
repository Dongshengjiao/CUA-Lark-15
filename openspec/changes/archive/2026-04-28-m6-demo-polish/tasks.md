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

## 9. Post-archive retrospective（实测于 2026-04-28 23:55–24:02 UTC+8）

> M6 archive 当时 task 6.3-6.6 均为 `[-]`（未实测）。本节是用真飞书账号跑一次 `hello m6` demo
> 后的复盘，与上文 task 表的预期对照。**不修改上文复选框** —— 留下"archive 时
> 状态" vs "post-archive 实测状态"的双层证据。

### 9.1 实测条件

- 命令：`npx tsx test/observer-client.ts demo-m6-im-v2 "在飞书给自己发条消息：hello m6"`
- 触发路径：observer-client → BridgeServer.handleCommand → runner.runWebAgentTask
- 飞书账号：用户当场扫码登录（`profiles/feishu/` 当时是空目录）
- 模型：Qwen3-VL-Plus（dashscope，profile=`qwen-default`）

### 9.2 实测结果

| 项目 | M6 archive 预期 | 实测 |
|---|---|---|
| `dev.sh` runner ready 时间 | 一键内出现 ✅ | 10s（首次）/ 7s（增量） |
| 飞书 IM 任务最终状态 | `webAgentTaskCompleted` | ✅ `webAgentTaskCompleted` —— 蓝色气泡 + 时间戳 00:01 在自聊会话中可见（屏幕实拍验证）|
| 总 step events | ≤ 25 | **42**（约 21 次 LLM iteration） |
| 用时 | 〜60s 录制级 | **175 秒** |
| 在 `maxLoopCount=30` 内 | ✅ | ✅（21 < 30，cap 没截断） |
| 灵动岛缩略图 | 每 step fade-in | ✅ 每 step 都有 `screenshotURL` 字段 |
| `finalAnswer` markdown | SwiftUI 渲染 | 未在此次跑中肉眼对比（observer-client 不渲染 UI） |

**判定**：
- task 6.3 dev.sh ready：实测通过，可标 `[x]`（本节不改上文，仅在此声明）
- task 6.5 飞书 IM ≤ 25 step：**消息确实发出但步数超出验收**，且完成路径依赖 VLM 自找 workaround
  （见 §9.4），**不是 prompt 设计的预期路径**。仍判 `[-]`。

### 9.3 实测暴露的 3 个 bug

**Bug B — M6 自引回归（已 hotfix）**
- 现象：task 第一次跑 step 5 报 `Error: Too many action execute failures: Unsupported key: esc`
- 根因：`feishu_im_send.ts` `systemPromptAddendum` 第 28 行写了 `or press Esc to dismiss`，
  VLM 照写 `hotkey(key='esc')`；但 `@ui-tars/operator-browser` 的
  `KEY_MAPPINGS`（`node_modules/@ui-tars/operator-browser/dist/key-map.mjs`）只接受
  `escape`，无 `esc` alias → throw → async-retry 三次后 task failed。
- 修复：把 prompt 改成显式 `hotkey(key='escape')` + 加"绝不要写 'esc'"指令 + 给"点击模态外
  空白处"作为退路。M6 archive 后的 hotfix commit。

**Bug A — VLM 视觉 grounding 偏差（plan 风险 1 实现，未修）**
- 现象：第二次跑（修了 Bug B 后）step 1/5/9/13/17/21/25/29 共 8 次点击都落在 `[14, 122]`
  附近，每次都误中飞书顶部深色全局搜索栏（弹出 Cmd+K omni-search 模态）。VLM 每次 thought
  都正确说"避免再点到顶部"但坐标完全没变。
- 根因：Qwen3-VL-Plus 在飞书 React UI 上把顶部全局搜索栏视觉识别为"消息标题下方的浅色会话
  搜索框"。prompt 文字层面已经强禁止（详细描述了两个搜索框区别），但模型层视觉 grounding
  错位 —— prompt 力所不及。
- 缓解：见 §8.1 的备选 path B（DOM 模式）。本回合未启动。

**Bug C — runner 启动 profile 与 skill profile 不对齐（M5 设计盲点，未修）**
- 现象：runner 重启后第一次跑飞书任务一定要重扫码，即使 `profiles/feishu/` 已经有 cookie。
- 根因：[`runner.ts`](../../../runners/web-agent/src/runner.ts) L70 启动时 launch headless
  用 `userDataDirFor('generic')`；[`login.ts`](../../../runners/web-agent/src/agent/login.ts)
  Phase 1 `isLoggedIn` 在**当前 browserRef.current**（即 generic profile）上探测 feishu
  cookie，永远查不到 → 必走 Phase 2 visible 扫码流程。Phase 2 之后 browserRef.current 才
  切到 feishu profile，但 runner 重启后又回 generic。
- 修复方向：runner 启动时不预 launch chromium，等第一个 task 来了根据 `skill.userDataDirSegment`
  lazy launch；或者保持 generic 默认 + ensureLoggedIn 内部用 skill 的 user-data-dir 启
  fresh headless 做 Phase 1 探测。属于下一回合（m7）范围。

### 9.4 VLM 自适应（正面信号）

step 31 VLM 自己想到 workaround：

> "全局搜索模态框中若出现目标联系人，点击它仍能打开对应聊天（Feishu 实际支持此行为）。
> 因此，下一步应点击'搜索历史'下的'梓文'标签。"

—— 既然每次点会话搜索框都触发顶部 omni-search，那就**直接在 omni-search 模态里搜联系人**
（飞书设计上 omni-search 也能跳到聊天）。这是 prompt 里**完全没教**的策略，VLM 自己适应了
环境约束。这一行为提示：未来 prompt 可以**主动**把 omni-search 也写成合法路径之一，
即使不修 Bug A，也能把完成步数压到 ≤ 25。

### 9.5 给下一回合的输入

- 必修：Bug C（profile 启动不对齐）—— 用户体验问题，每次重启都重扫太烦。
- 推荐：Bug A 走 §8.1 的 path B（DOM `getByRole/getByText`）；或者更轻量地把 omni-search
  写成"合法捷径"路径以绕过视觉 grounding 误差。
- 可选：把 6.4 通用 google 任务和 demo.mov 录制（task 6.6）合并到下一回合的"demo 收尾"。
