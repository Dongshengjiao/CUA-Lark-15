# 设计：M6 demo 验收 + VLM 引导强化 + 灵动岛 UI 进度可视化

## 背景（Context）

M5 task 7.3 实测把"扫码登录 + skill 路由 + 切换 headless"这些产品级集成跑通了，但同时**实锤暴露**了三个问题，是 M6 必须先解决的：

1. **maxLoopCount = 12 不够**：M5 demo 跑到 step 23（loop 12）才点中正确目标，下一步本应输入消息，但已被 abort。@ui-tars/sdk 默认是 25；飞书这种多步任务（搜索 → 点结果 → 等会话页加载 → 在输入框 type → 发送 → 验证发送）需要至少 25 step 才有完成预算。
2. **systemPromptAddendum 不够强**：log 里 VLM 反复在"屏幕顶部黑色全局搜索栏"和"消息会话搜索框"之间打转——这两个搜索框视觉上很像，VLM 没有强先验区分；few-shot 范例当时也没演示"全局搜索是错路"。
3. **通用模式 about:blank 起点废**：M5 task 7.5 测通用任务时 VLM 在空白屏说"用 Cmd+Space 启动 Spotlight"，因为它**根本不知道自己在浏览器里**。生产 demo 只要给个浏览器有内容的起点就能解决。

加上 plan 原本就要交付的 M6 demo polish（录屏 + README + 灵动岛 UI 进度可视化），所有工作收敛到一个 milestone 里。

涉及方：
- M6 实施者（你 + AI）。
- M7+ 后续 backlog 实施者：缩略图 + markdown 渲染会被复用。
- demo 受众：评审 / 用户 / 公开分享。

约束：
- **不打包**：M6 仍然 dev 模式跑；不引入 DMG / 代码签名 / 公证 / Sparkle（推 M7 backlog）。
- **不重写架构**：所有改动是 polish + 补全，不动 BridgeServer / SessionState / runner 主流程。
- **VLM 命中率**：plan 风险 1 没法彻底消除；M6 通过 prompt 工程 + maxLoopCount 提升做到"飞书 IM 任务有 ≥50% 一次跑成功率"。再低则启动 plan 备选 path B（DOM 模式），属于 M5 task 9 留的退路。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**
- 飞书 IM 任务"给自己发消息"在 system prompt + maxLoopCount 30 + 调过一遍 few-shot 之后，能在 ≥1 次试运行内成功完成（消息真的发出去）。
- 通用任务"在 google 搜索 ... 并报告前 N 条结果"能在 default starting URL = `google.com` 之后稳定跑通。
- 灵动岛 opened 态显示当前任务的最近一帧 screenshot 缩略图 + step thought + finalAnswer markdown 渲染。
- 项目根 README + lark-island/README 文字到位，三步本地启动指引清楚。
- 录到一段 demo.mov（剪辑后 ≤2 分钟），含通用任务 + 飞书任务两段。

**非目标：**
- 不做"复杂多步任务计划生成"或"VLM 自己写 plan + 检查"——M6 只调 prompt 不改架构。
- 不做缩略图 zoom-in / 全屏查看 UI——M6 只显示一张缩略图。
- 不做 finalAnswer 复制 / 分享按钮——M7 polish。
- 不做 DOM 模式（M5 task 9 path B）——只在 M6 实测命中率 < 30% 才启动作为兜底。
- 不重写 systemPrompt 的 base 部分（保留 @ui-tars/sdk 默认）。
- 不引入新的 npm / SwiftPackage 依赖。

## 关键决策（Decisions）

### D1：maxLoopCount 默认值从 12 拉回 25-30

实测一次飞书 IM 自聊任务用了 12 个 loop（每个 loop = VLM 一次推理 + BrowserOperator 一次 action 执行）才点中正确入口；输入消息 + 发送 + 验证还需 5-8 步。把默认值放到 30 就是让"完成预算"留有余量。

考虑过：
- **默认改成 50**：reject。50 step 的飞书任务大概率是 VLM 卡住在死循环（M5 实测的那种"两个搜索框互相打转"）；让它早死早超生比硬撑更省 token。
- **写到 LLM Profile 配置**：reject。M6 polish 不开新配置面板；30 是产品默认，自定义留 M7。

### D2：飞书 IM systemPromptAddendum 重写——强禁止 + 强演示

新版 prompt 大纲（以 IM 为例）：

1. **强禁止段**：
   ```
   IMPORTANT: 屏幕顶部那条横跨整个 Chromium 标签栏下方的深色搜索栏（占位符
   "搜索全部内容..." 或 "问你想问的问题..." 等）是飞书的 ⌘+K 全局搜索面板，
   会展示应用 / 文档 / 邮件等结果，**不是发消息的入口**。绝对不要点这个。
   要找联系人或自己，请使用 **左侧消息列表上方** 的会话搜索框（占位符通常
   是 "搜索 (⌘+K)"，颜色更浅，紧贴左侧导航栏顶部）。
   ```
2. **完成判定段**：
   ```
   任务完成判定：当你看到自己刚输入的消息文本以**蓝色（或品牌色）气泡**
   出现在会话窗口右侧（也就是发送方一侧），且气泡上有时间戳，说明消息已
   送达，立即调 finished() 报告"已通过飞书向 <收件人> 发送：<消息内容>"。
   不要为了"再确认一遍"而做额外操作；多余操作会触发 max_loop。
   ```
3. **few-shot 重写**：
   - 演示"自聊"场景（最常见，M5 实测就是这个）。
   - 用 `(180, 265)` 这种实测过的真实坐标作为示意。
   - 步骤减少到 6-8 步：搜索 → 选自己 → 点消息输入框 → type → Cmd+Enter → 看气泡 → finished()。

calendar / doc 各自类似，但 few-shot 内容不同。

考虑过：
- **每个 skill 单独写一份完整 system prompt 不依赖 base**：reject，跟 @ui-tars/sdk 解耦成本太高且失去 base 自带的 action 格式约束。
- **prompt 用 prompt-templates 库做模板**：reject，过度设计。

### D3：通用模式默认起始页 = `https://www.google.com`

runner.ts 启动 LocalBrowser 后立即 navigate 到一个 visible content URL。M5 task 7.5 失败的根因就是 about:blank 没给 VLM 任何上下文。

为什么是 google.com 而不是别的：
- 国内可访问性：google.com 在国内不稳；备选是 bing.com。M6 默认 google.com，文档注明"国内 demo 可改 BING_FIRST=true 切到 bing"或硬编码 bing 都行。
- 隐私：google.com 本身不需要登录、cookie 干净。
- 通用性：搜索任务、网页阅读、跳 URL 任务都可以从 google.com 起步（VLM 看到搜索框就能开始）。

实现：runner.ts 在 launch chromium 后、`registerClient` 之前 navigate 到 default URL。如果 navigate 失败（断网等），落到 about:blank，记 warning 不阻断启动。

考虑过：
- **chrome://newtab**：reject，VLM 在 chrome internal 页面行为不确定。
- **每次 task 起始 navigate**：reject，task 复用同一 page 时会被覆盖之前任务的状态；让"启动一次 navigate 一次"更清晰。
- **可配置 starting URL**：M6 不开配置面板；硬编码常量，留 M7 polish。

### D4：灵动岛缩略图 = 直接 `NSImage(byReferencing:)` + 200ms throttle

每次收到 `webAgentStepUpdate{screenshotURL}` 后：
- AppModel.handleRunnerEvent 把 path 存入 `session.latestScreenshotURL`（新字段，可选）。
- IslandPanelView.OpenedTaskBody 用 `Image(nsImage:)` 渲染最大宽 120pt 缩略图。
- 用 `.id(screenshotURL)` 触发 SwiftUI 重渲，配合 `.transition(.opacity)` 200ms 渐入。
- NSImage(byReferencing:) 是惰性读盘——SwiftUI 真正绘制时才走 IO，不会阻塞 reducer。

考虑过：
- **base64 直接传 wire**：reject，M2 spec 已经规定不传 base64（plan 总成本风险）。
- **预解码到 thumbnail size**：reject，M6 不优化，120pt 缩略图随便绘。

### D5：finalAnswer markdown 用 swift-markdown-ui 的 Markdown view

`MarkdownUI.Markdown(_:)` 接 String → 渲染。M4 已引依赖未使用。

唯一注意点：飞书任务的 finalAnswer 通常是中文 + 标点；markdown 引擎要正确处理中英混排。`swift-markdown-ui` 默认行为已经对了。

### D6：dev.sh 一键启动用 zsh + heredoc 不引入新工具

`scripts/dev.sh`：

```sh
#!/usr/bin/env zsh
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) ensure runner deps
( cd runners/web-agent && npm install --silent )

# 2) ensure swift toolchain
export PATH="/opt/homebrew/opt/swift/bin:$PATH"

# 3) start LarkIslandApp; runner spawns automatically via supervisor
( cd lark-island && swift build )
( cd lark-island && swift run LarkIslandApp ) &
APP_PID=$!

# 4) wait for runner ready signal in log
echo "[dev] waiting for runner..."
for i in $(seq 1 20); do
  if grep -q 'registered as webAgentRunner' "$HOME/Library/Logs/LarkIsland/web-agent-$(date +%Y-%m-%d).log" 2>/dev/null; then
    echo "[dev] runner ready"
    break
  fi
  sleep 1
done

echo "[dev] open http://localhost (no), instead: click the menubar 🌐 to start a task"
wait $APP_PID
```

考虑过：用 Make / npm scripts —— reject，引入额外抽象层；shell 50 行解决。

### D7：demo.mov 用 macOS 自带 Cmd+Shift+5 录制；剪辑用 iMovie / QuickTime trim

不引入第三方录屏工具。

录制顺序：
1. 起 dev.sh，等 runner ready
2. 第一段（通用）：菜单栏 🌐 → 输 "在 google 搜 UI-TARS 报告前 3 条" → Run，让灵动岛展开显示步骤
3. 第二段（飞书）：菜单栏 🌐 → 输 "在飞书给自己发消息：hello demo" → Run；扫码（剪掉这段，加字幕"扫码登录"）；继续；任务完成
4. 把两段合并为一个 ≤2 分钟视频
5. 存 `lark-island/docs/m6-demo.mov`，git lfs 不引入（如果 ≥ 50MB，只在 README 给 BCS / 飞书云盘外链）

## 风险 / 取舍（Risks / Trade-offs）

- **VLM 命中率提升不到 50%** → 触发 plan 备选 path B（DOM 模式）。这是 0.5-1 天工作量，把 GUIAgent 的 click 路径接 puppeteer `page.getByRole/getByText`。本 milestone 内不做，但 design 在 D2 留了"再不行就走 path B"的开口。
- **demo 录到一半飞书 cookie 过期** → 重新扫码会打断 demo。建议录前 1 天先手动跑一次让 cookie 落盘新鲜，cookie TTL 7 天足够。
- **swift-markdown-ui 渲染中文断行问题** → 实测发现再修；fallback 用 `Text(...)` 不渲 markdown。
- **缩略图读盘 IO 抖动导致 SwiftUI 重绘卡顿** → fallback 不显示缩略图，只显 step 文字。
- **default starting URL 在国内访问 google.com 失败** → README 增加"如果国内访问不到 google，把 `runner.ts` 的 DEFAULT_STARTING_URL 改成 `https://www.bing.com`"段。
- **maxLoopCount 30 但 VLM 仍卡 max_loop** → 日志里看 thought 链路；如果是同样的"两个搜索框打转"模式，强化 D2 的 prompt；如果是新模式，分类记录留 M7 backlog。

## 迁移计划（Migration Plan）

M6 是 polish 增量，无数据迁移。落地步骤：

1. 改 `runner.ts`：maxLoopCount 12 → 30；启动后 navigate 到 default URL。
2. 改三个 skill 的 systemPromptAddendum（按 D2 重写）。
3. 改 `IslandPanelView.OpenedTaskBody`：加缩略图渲染 + finalAnswer markdown 渲染。
4. 加 `AppModel`/`AgentSession` 上的 `latestScreenshotURL` 字段（reducer 在 step update 时写入）。
5. 写 `scripts/dev.sh`、顶层 `README.md`、`lark-island/README.md`。
6. 跑一次飞书 IM smoke test（用 observer-client.ts），验证 maxLoopCount 30 + 新 prompt 能在 ≤25 step 内完成 + 灵动岛能显示缩略图。
7. 录两段 demo + 剪辑。
8. archive M6。

回滚：M6 是独立 commit 链；如有阻塞，git revert 到 M5 archive commit (`b49603d`) 即可——所有改动是 additive。

## 待解决问题（Open Questions）

1. **default starting URL 国内 vs 国际版**：默认 google 还是 bing 还是 baidu？**暂定**：default = google，README 文档化"国内改 bing"。如果 demo 现场国内网络访问 google 慢，改成 bing。
2. **缩略图缓存策略**：每帧都 NSImage(byReferencing:) 会不会重复读盘？**暂定**：先不优化，SwiftUI Image cache 已经够用；后续抖动再上 cache。
3. **maxLoopCount 30 是否要每个 skill 单独配**：飞书 IM ≤ 25 步够，写文档可能要 50 步？**暂定**：M6 一刀切 30；M7+ 加 `Skill.maxLoopHint?: number` 字段允许 per-skill 覆盖。
4. **demo.mov 是不是入仓**：MP4 体积大；git lfs 没在仓里启用。**暂定**：先压到 ≤30MB 入仓试试；超 30MB 改外链 + README 说明。
5. **dev.sh 跨 Mac 兼容性**：未在 zsh 之外测试。**暂定**：M6 只支持 zsh（macOS 默认 shell），bash 用户自己 source；M7 不优化。
