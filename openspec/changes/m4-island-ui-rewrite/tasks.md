# 任务：m4-island-ui-rewrite

## 1. Package.swift 重启 + 目录改名

- [x] 1.1 在 [`lark-island/Package.swift`](../../../lark-island/Package.swift) 加回 `LarkIslandApp` executable product 与 target；引入 `swift-markdown-ui` package dependency；**不**回引 Sparkle。
- [x] 1.2 `Sources/OpenIslandApp/` → `Sources/LarkIslandApp/`（git mv）；同步改名 `OpenIslandApp.swift` → `LarkIslandApp.swift`、`OpenIslandBrandMark.swift` → `LarkIslandBrandMark.swift`。
- [x] 1.3 用 ripgrep + sed 把改名后目录内所有 `OpenIsland`(类名常量) 替换为 `LarkIsland`；`OpenIslandApp` （class 名）替换为 `LarkIslandApp`；`open-island` 替换为 `lark-island`；校验剩余无 OpenIsland 字面量（除注释中说明历史的）。同时删了 `Resources/open-island-opencode.js`（OpenCode plugin 客户端代码，coding-agent collateral）。
- [x] 1.4 新增 [`lark-island/config/packaging/LarkIslandApp.entitlements`](../../../lark-island/config/packaging/LarkIslandApp.entitlements) 声明 `com.apple.security.network.client` + `keychain-access-groups`；entitlements 文件路径在 Package.swift 暂不引用（M7 打包时再 wire），但本里程碑就位避免后续遗忘。同时删了上游残留的 `config/packaging/OpenIslandApp.entitlements`。

## 2. 删除 collateral + 重写 AppModel

- [x] 2.1 git rm `Sources/LarkIslandApp/AvatarImageStore.swift` + `Sources/LarkIslandApp/ControlCenterWindowController.swift`。
- [ ] 2.2 grep `IslandPanelView` / `OverlayPanelController` / `OverlayUICoordinator` / `IslandSurface` 用到的 AppModel 接口，列到 design.md 附录或本任务下方注释，作为新 AppModel 必须保留的 forwarder 列表。
- [ ] 2.3 完全重写 `Sources/LarkIslandApp/AppModel.swift` 为约 250 行最小版本：拥有 `BridgeServer` + `WebAgentRunnerSupervisor` + `LLMProfileStore` + `OverlayUICoordinator` + `SessionState`；暴露 `notchStatus` / `islandSurface` / `state` 等 forwarder；新增 `startWebAgentTask(prompt:)` / `cancelCurrentTask()` / `activeProfile` / `runnerOffline`。
- [ ] 2.4 删 `Sources/LarkIslandApp/AppModelTypes.swift` 中跟 coding agent 强耦合的部分（hooks 安装意图等），保留通用类型如 `OverlayDisplayConfiguration` 引用的常量。

## 3. 适配保留下来的灵动岛 chrome 文件

- [ ] 3.1 `IslandSurface.swift`：删除 coding agent session 数量驱动的颜色/形状分支，统一为单任务 web agent 的两态（idle / busy）。
- [ ] 3.2 `OverlayPanelController.swift`：保留 NSPanel 行为，删除引用已删 `*HookCoordinator` 的 onboarding 入口。
- [ ] 3.3 `OverlayUICoordinator.swift`：保留 notchStatus / islandSurface 两个状态字段，删除 codex session 选中态等字段。
- [ ] 3.4 `Views/IslandPanelView.swift`：保留壳子布局 + 两态展示；coding agent session 列表段落整段删除，预留一个 `WebAgentOverlayView` 嵌入位（M4.5 实现）。
- [ ] 3.5 `Views/AppearanceSettingsPane.swift`：删除 coding agent 配色字段，仅保留 light / dark / accent color 等通用项。
- [ ] 3.6 `Views/ControlCenterView.swift`：删除 usage dashboard，重写为简洁的 "当前任务" 状态列表（用 SessionState）。
- [ ] 3.7 `Views/SettingsView.swift`：保留 tab 切换骨架，删除 hooks installer / about-update 段；新增空白的 `LLM` tab（实际渲染由 4.4 的 LLMSettingsView 承接）。
- [ ] 3.8 `AgentSession+Presentation.swift`：删除 codex / claude metadata 渲染扩展；保留通用的 `summary` / `phase` 显示 helpers。
- [ ] 3.9 跑一次 `swift build`，逐个修编译错（预期 ~50 处），错误数应单调递减。

## 4. 新增 5 个 Web Agent UI 模块

- [ ] 4.1 `Sources/LarkIslandApp/Settings/LLMProfileStore.swift`（约 150 行）：`@Observable` final class；`profiles: [VLMProfile]` + `defaultProfileName: String`；`save(profile:)` / `delete(name:)` / `setDefault(name:)`；JSON 文件读写在 `~/Library/Application Support/LarkIsland/llm-profiles.json`；apiKey 通过私有 `KeychainBackend` protocol 调 `Security.framework`，mock 注入便于测试。
- [ ] 4.2 `Sources/LarkIslandApp/WebAgentInputPanel.swift`（约 200 行）：SwiftUI View，含一个多行 `TextField` + 提交按钮 + 显示 `activeProfile.name` 的小标签；提交时调 `model.startWebAgentTask(prompt:)`，按 Esc / 失焦时关闭。
- [ ] 4.3 `Sources/LarkIslandApp/WebAgentOverlayView.swift`（约 250 行）：嵌入到 `IslandPanelView` 的展开形态内；订阅 `model.state.activeActionableSession`；渲染 task title + step 列表 + 缩略图（用 `NSImage(byReferencing:)` 读 screenshotURL）+ 完成时 fade 计时器。markdown 渲染用 `swift-markdown-ui` 处理 `finalAnswer`。
- [ ] 4.4 `Sources/LarkIslandApp/Settings/LLMSettingsView.swift`（约 250 行）：表格 + 工具栏 + 编辑表单（Name / Base URL / Model / SecureField apiKey / Family Picker）；新建/删除/设默认按钮；变更通过 `LLMProfileStore` 持久化。
- [ ] 4.5 `Sources/LarkIslandApp/WebAgentRunnerSupervisor.swift`（约 200 行）：拥有一个 `Process` 实例 + 重启计数器 + `RunnerLocator`（dev/prod 路径解析）。`start()` / `stop()` / `currentPID` / `runnerOffline`（@Observable）。stderr/stdout 重定向到 `~/Library/Logs/LarkIsland/web-agent.log`。崩溃 60s 内 ≥3 次后停止。

## 5. BridgeServer 接通 + 路由规则修改

- [ ] 5.1 在 [`lark-island/Sources/LarkIslandCore/BridgeServer.swift`](../../../lark-island/Sources/LarkIslandCore/BridgeServer.swift) `handleEnvelope` 中加新分支：来自 `webAgentRunner` 角色的客户端发的 `event` envelope 调 `stateSnapshot.apply(event)` + `broadcast(event)`；来自 `observer` 角色发的 `event` envelope 记录 warning 后丢弃。
- [ ] 5.2 同样在 `handleCommand` 中：来自 runner 角色的客户端发的 command 记录 warning 后丢弃，**不**调 commandHandler。
- [ ] 5.3 在 [`lark-island/Tests/LarkIslandCoreTests/`](../../../lark-island/Tests/LarkIslandCoreTests/) 加新测试 `BridgeServerRoutingTests.swift`：用一对内存 socket pair（runner + observer 各一个）跑端到端覆盖以下场景：
  - runner 发 webAgentTaskStarted → observer 收到 broadcast + server SessionState 更新
  - runner 发 runWebAgentTask 命令 → 被丢弃
  - observer 发 webAgentTaskStarted → 被丢弃
  - observer 发 runWebAgentTask → commandHandler 被调用
- [ ] 5.4 跑 `cd lark-island && swift test`，新增 4 个 test 通过；现有 36 测试不破坏。

## 6. AppModel 接通 BridgeServer + RunnerSupervisor

- [ ] 6.1 在 `AppModel.init` 中：构造 BridgeServer（用默认 socket 路径或 env override），注册 `commandHandler` 把 observer 命令分发给本 AppModel 的处理逻辑（M4 的 commandHandler 主要处理 `runWebAgentTask` —— 但 v0 单进程下 app 是 server 也是事件源头，所以 runWebAgentTask 实际是 server 主动 send 给 runner 而不是被 commandHandler 收到）。
- [ ] 6.2 启动 BridgeServer，再 spawn RunnerSupervisor。
- [ ] 6.3 在 `startWebAgentTask(prompt:)` 中：构造 `BridgeCommand.runWebAgentTask`，调 BridgeServer 内部 `sendToRunner(command:)`（在 BridgeServer 上加一个新 public 方法，遍历 clients 找 webAgentRunner 角色的连接 send envelope）。
- [ ] 6.4 supervisor 检测 runner 异常退出后通知 AppModel：把所有 `phase == .running` 的 session apply `webAgentTaskFailed{kind: cancelled, message: "runner crashed"}`。
- [ ] 6.5 在 LarkIslandCore 加 `BridgeServer.sendToRunner(_ command: BridgeCommand)` 方法 + 单元测试。

## 7. 端到端验收

- [ ] 7.1 `cd lark-island && swift build` 完整通过。
- [ ] 7.2 `cd lark-island && swift test` 全绿（新加的 BridgeServerRoutingTests + LLMProfileStore round-trip test）。
- [ ] 7.3 启动 `LARK_ISLAND_RUNNER_PATH=$(pwd)/../runners/web-agent/dist/server.js DASHSCOPE_API_KEY=$(grep DASHSCOPE_API_KEY ../runners/web-agent/.env | cut -d= -f2) swift run LarkIslandApp`：菜单栏 LarkIsland 图标出现、灵动岛 overlay 在屏幕顶部出现（idle 形态）、runner 子进程 spawn 成功（看 `~/Library/Logs/LarkIsland/web-agent.log`）。
- [ ] 7.4 从菜单栏点开 input panel 输入"在 example.com 读 page title"，提交后灵动岛展开显示进度（task title + step thought + 缩略图，最后显示 finalAnswer 或 failure）。
- [ ] 7.5 打开 LLM Settings tab，新建一个 `doubao-fallback` profile（apiKey 留空也行）；保存后看 `~/Library/Application Support/LarkIsland/llm-profiles.json` 多一条；setDefault 切换 active profile，下条任务的 `runWebAgentTask.profileName` 变成新值。
- [ ] 7.6 录一段 demo.mov（约 1 分钟）作为本里程碑的视觉证据，存到 `lark-island/docs/m4-demo.mov`（gitignored if too large；否则入库）。

## 8. 收尾

- [ ] 8.1 `npx @fission-ai/openspec validate m4-island-ui-rewrite` 干净通过。
- [ ] 8.2 提交 commit（建议拆 4 个：`feat(app): re-enable LarkIslandApp + rename`、`refactor(app): rewrite AppModel + adapt island chrome`、`feat(app): add web-agent UI modules`、`feat(bridge): runner-vs-observer routing rule + tests`）。
- [ ] 8.3 跑 `/opsx-archive m4-island-ui-rewrite` 把 `lark-island-app` 新 capability + `web-agent-bridge` modified delta 一起 sync 到 `openspec/specs/`，归档 change。
