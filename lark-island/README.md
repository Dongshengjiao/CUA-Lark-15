# Lark Island (lark-island/)

灵动岛 macOS 应用 + `LarkIslandCore` 共享库 + `BridgeServer`（Unix socket NDJSON）+ runner supervisor。CUA-Lark-15 仓里的 Swift 子模块。

> 完整产品介绍 + 一键启动见 [仓库根 README](../README.md)。本文件聚焦 lark-island 子模块的开发细节。

---

## Origin & License

`lark-island/` fork 自 [Octane0411/open-vibe-island](https://github.com/Octane0411/open-vibe-island) commit `0fb4830`，整体 GPL v3 许可。M0 阶段做了大量裁剪（删除 Claude/Codex/Cursor coding-agent 监控，改名 OpenIsland → LarkIsland，Sparkle 自动更新依赖删除）。详见 [`NOTICE.md`](NOTICE.md) 完整文件清单。

CUA-Lark-15 的整体仓采用 license aggregation 策略：lark-island GPL v3 + runners/web-agent Apache-2.0 + larkvision MIT + 顶层 `LICENSE.md` 作为 license map。各子目录之间只通过 IPC（Unix socket）通信，不形成静态链接，license 不互染。

## 目标

- **可视化**：每个 web-agent 任务从启动到完成全程在屏幕顶端的灵动岛上有进度展示（step 文字 + 实时缩略图 + 完成态 markdown 答复）。
- **多入口**：菜单栏 NSStatusItem 点击弹 popover 输入；灵动岛 hover-expand 内嵌 mini input 字段（M4 spec 已写，UI polish 留 M7）；M5.5+ 计划接入飞书机器人作为远程触发入口。
- **本地优先**：BridgeServer 监听 `~/Library/Application Support/LarkIsland/bridge.sock`；runner subprocess 由 `WebAgentRunnerSupervisor` 自动 spawn + 保活；不打远程 API；LLM API key 通过 macOS Keychain 落盘。
- **GPL aggregation 边界守护**：`lark-island/` **不**编译时引用 `runners/` 任何代码；runner 二进制路径只在运行时通过 env override + dev 反推 + prod Bundle 三路解析。

## 子目录

```
lark-island/
├─ Package.swift                 ← Swift 6.2 / macOS 14+
├─ Sources/
│  ├─ LarkIslandApp/             ← @main + AppDelegate + AppModel +
│  │                                IslandPanelView + WebAgentInputPanel +
│  │                                LLMSettingsView + RunnerSupervisor
│  └─ LarkIslandCore/            ← BridgeServer + AgentSession +
│                                   SessionState + AgentEvent + BridgeCodec
├─ Tests/
│  └─ LarkIslandCoreTests/       ← reducer + bridge routing + JSON fixtures
└─ docs/
   ├─ architecture.md
   ├─ product.md
   └─ m6-demo.mov                ← M6 录屏（≤30MB 入仓；超过外链）
```

## 演示路径

`zsh ../scripts/dev.sh` 跑起来后两条用户输入路径：

### 1. 菜单栏 popover

- 点屏幕顶端右侧的 🌐 globe（NSStatusItem）→ 弹出 NSPopover 带 `WebAgentInputPanel` SwiftUI 视图
- 输入 prompt → 按 Enter 或点 Run → popover 自动关闭
- 灵动岛实时跟随状态变化（橙色=审批/扫码，蓝色=running，绿色=completed）
- 鼠标 hover 灵动岛可展开看 step + 缩略图

### 2. 灵动岛 hover-expand（M4 spec 已写、UI polish 留 M7）

- idle 形态显示左 brand mark + 右状态点
- 鼠标 hover 时灵动岛缩放 1.028× 提示可点
- 点击触发 `notchOpen(reason: .click)`；hover 300ms 触发 `notchOpen(reason: .hover)`

### 3. 远程触发（M5.5+ planned）

`feat/lark-bot-channel` 计划新增 `runners/lark-bot/` 子项目，通过现有 `lark-event` skill 长连接订阅飞书消息事件，把 prompt 通过 BridgeServer 的 `runWebAgentTask` 命令派发；任务完成后用 `lark-im +send` 发回原会话。当前未实施。

## 常用维护命令

### 重置飞书登录态

```bash
rm -rf "$HOME/Library/Application Support/LarkIsland/web-agent/profiles/feishu"
```

下次跑飞书任务会重新弹可见 Chromium 让用户扫码。

### 重置通用模式

```bash
rm -rf "$HOME/Library/Application Support/LarkIsland/web-agent/profiles/generic"
```

### 切换 LLM profile（默认 `qwen-default` → `doubao-fallback`）

UI 路径：菜单栏 🌐 → Cmd+, 打开 Settings → LLM tab → 新建 `doubao-fallback` profile：

| 字段 | 值 |
|---|---|
| Name | `doubao-fallback` |
| Base URL | `https://ark.cn-beijing.volces.com/api/v3` |
| Model | `doubao-1.5-ui-tars` 或 [Volcano 控制台](https://console.volcengine.com/ark/)推送的最新 |
| API Key | 从 Volcano Engine 控制台取，存 macOS Keychain |
| Family | `doubao` |

保存后点 ⭐ 设为默认；下条 task 自动用新 profile（无需重启 app/runner）。

### 改 runner 默认起始页（demo 需要 bing 而非 google）

编辑 [`../runners/web-agent/src/runner.ts`](../runners/web-agent/src/runner.ts) 的 `DEFAULT_STARTING_URL` 常量，或者启动时设环境变量：

```bash
LARK_ISLAND_RUNNER_DEFAULT_URL=https://www.bing.com zsh ../scripts/dev.sh
```

### 看 runner 日志

```bash
tail -f "$HOME/Library/Logs/LarkIsland/web-agent-$(date +%Y-%m-%d).log"
```

## 开发

```bash
swift build                       # 编译整个 package
swift test                        # 跑 LarkIslandCoreTests（含 BridgeServerRoutingTests）
swift run LarkIslandApp           # 直接跑 dev 模式
```

`Package.swift` 在 Xcode 里打开能直接调试 SwiftUI 视图。

## 历史 milestone

按时间从早到晚：

| 改动 | 范围 | Archive 路径 |
|---|---|---|
| **M0a/b/c** | fork 上游、删 coding-agent 监控、Sparkle 删除、改名 OpenIsland → LarkIsland | git history（commit `4235cbc` 等） |
| **M2** | bridge 协议扩展（5 个 web-agent envelope 事件 + webAgentRunner role） | [`../openspec/changes/archive/2026-04-28-m2-bridge-web-agent-events/`](../openspec/changes/archive/2026-04-28-m2-bridge-web-agent-events/) |
| **M3** | runner socket 服务化（v2 handshake、profile 解析、step 事件回灌） | [`../openspec/changes/archive/2026-04-28-m3-runner-socket-service/`](../openspec/changes/archive/2026-04-28-m3-runner-socket-service/) |
| **M4** | 灵动岛 UI 重写（AppModel 重写、closed/opened state、菜单栏 popover、LLMSettingsView、RunnerSupervisor） | [`../openspec/changes/archive/2026-04-28-m4-island-ui-rewrite/`](../openspec/changes/archive/2026-04-28-m4-island-ui-rewrite/) |
| **M5** | 飞书 skill registry + headless ↔ visible 切换协议 + cookie 持久化 + login_qr UI | [`../openspec/changes/archive/2026-04-28-m5-feishu-skills/`](../openspec/changes/archive/2026-04-28-m5-feishu-skills/) |
| **M6** | demo polish: VLM prompt 强化 + 缩略图 + finalAnswer markdown + dev.sh + README + demo.mov | 当前里程碑 |
