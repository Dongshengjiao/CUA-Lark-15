# 提议：M4 — 灵动岛 UI 重写并接通 web agent runner

## 为什么（Why）

到 M3 结束为止，我们有了：

- 一个干净的 LarkIslandCore 库（M0c 重命名后），定义了完整的 web-agent 协议（M2 archived → `openspec/specs/web-agent-bridge/spec.md`）。
- 一个长驻的 Node runner 子进程，能接 socket 命令、跑 UI-TARS BO + Qwen3-VL-Plus、回灌完整 step/completed/failed 事件流（M3 archived → `openspec/specs/web-agent-runner-service/spec.md`）。
- 但 **没有 macOS app**：M0b 时 LarkIslandApp + LarkIslandAppTests 这两个 target 因为 ~750 个 dangling refs 被临时禁用，源文件原封不动放在 `lark-island/Sources/OpenIslandApp/` 里没编译。

也就是说 M3 验收只能用 `test/manual-dispatch.ts` 这种命令行 helper 模拟 server。**没人能在灵动岛上看到任何东西、没人能从灵动岛输入任务**。这是离 M6 demo 最近、收益最大的一个 chunk。

M4 要把 macOS app 真正起来：

1. 把 LarkIslandApp 重新加回 Package.swift。
2. 重写跟 coding agent 强耦合的 AppModel 和 4 个 View，新写跟 web agent 强相关的 4-5 个 SwiftUI 组件。
3. 给 LarkIslandCore 的 BridgeServer 接上一个真实的 `commandHandler`，让 app 能 dispatch `runWebAgentTask` + 接收 runner 的事件流。
4. 让 app 启动时自动 spawn `runners/web-agent/` 子进程，并能在崩溃时优雅重启。

## 改动内容（What Changes）

### Package.swift / target 结构

- **重启** `LarkIslandApp` executable target：在 `lark-island/Package.swift` 中加回 product + target，引入 `swift-markdown-ui` 依赖（Sparkle 不要回，仍走 M0b 决策的"不打 DMG"路线）。
- **新增** entitlements 文件 `lark-island/config/packaging/LarkIslandApp.entitlements`：声明 `com.apple.security.network.client`（runner 调远端 LLM）+ keychain access group（profile API key）。
- **不重启** `LarkIslandAppTests`：M0b 时禁用的 3 个测试文件（`AgentSessionPresentationTests`、`IslandSurfaceTests`、`OverlayPanelControllerTests`）大量依赖删掉的 coding agent 类型；M4 重写后用一组**新**测试覆盖 web agent UI 的可测部分（详见 tasks.md），不复活旧测试。

### Sources/OpenIslandApp/ → Sources/LarkIslandApp/ 重命名

- 整个目录跟随 LarkIslandCore 的命名约定（M0c 已经把 `OpenIsland` → `LarkIsland` 这一映射定型）。
- 文件本身保留旧名（如 `OpenIslandApp.swift` 改名 `LarkIslandApp.swift`、`OpenIslandBrandMark.swift` 改 `LarkIslandBrandMark.swift`）。

### 灵动岛 chrome 大幅瘦身保留

以下文件**保留并适配**新 AppModel（删 coding agent 字段引用即可，约几十处改动而非几百处，因为这些文件的核心逻辑是几何 + 形状 + 显示器选择）：

- `IslandSurface.swift`、`IslandChromeMetrics.swift`、`IslandPixelGlyph.swift`、`NotchShape.swift`、`OpenIslandBrandMark.swift`、`OverlayDisplayConfiguration.swift`、`OverlayPanelController.swift`、`OverlayUICoordinator.swift`
- `Views/IslandPanelView.swift`：保留壳子，把 coding agent session 列表段全删，预留 web-agent 单 task 渲染槽位。

### 重写的代码

- `AppModel.swift`：从零重写为最小 web-agent app 状态。删掉 1545 行原版的所有 coding agent 协调器（hooks/discovery/monitoring/codexAppServer/updateChecker），只保留：
  - SessionState（M0c 已是 web-agent reducer）的拥有 + apply
  - WebAgentRunnerSupervisor 拥有 + 生命周期联动
  - LLMProfileStore 拥有
  - notchStatus / overlay / surface 的 forwarder（保留原 OverlayUICoordinator 的接口）
  - **新增** `startWebAgentTask(prompt: String)`、`cancelCurrentTask()`、`activeProfile: VLMProfile`
- `OpenIslandApp.swift`（→ `LarkIslandApp.swift`）：保留 NSApplicationDelegate 骨架，删除 hooks 安装 onboarding；启动时初始化 RunnerSupervisor + BridgeServer。
- `Views/SettingsView.swift`：保留 tab 导航壳子，删除所有 hook installer / claude usage / about-update UI；新增 `LLMSettings` tab。
- `Views/ControlCenterView.swift`：删除 usage dashboard，改为简洁的"当前 web agent 任务"面板。
- `AppearanceSettingsPane.swift`：基本保留，仅删除跟 coding agent 配色相关的字段。
- 删除的文件（在 M0b 已经删了独立 coding agent 模块；M4 这次再删 2 个 collateral）：
  - `AvatarImageStore.swift`：曾用来存 Claude/Codex 的 agent 头像；web agent 单 profile，UI 用一个静态 SF Symbol 即可。
  - `ControlCenterWindowController.swift`：原作为单独窗口管理 control center；M4 简化成 menu bar extra 直接展开 popover，不需要独立窗口。

### 新增的 Web Agent UI

- `WebAgentInputPanel.swift`（约 200 行）：菜单栏点击或灵动岛 hover 唤出的小 prompt 输入框。回车提交触发 `AppModel.startWebAgentTask`。Esc 关闭。
- `WebAgentOverlayView.swift`（约 250 行）：在灵动岛 overlay 内渲染当前任务：标题（首行 prompt）、滚动 step 列表（thought + action + 缩略图）、完成时弹最终答案。
- `WebAgentRunnerSupervisor.swift`（约 200 行）：负责 spawn `node runners/web-agent/dist/server.js`（dev 走 tsx + repo path，prod 走 bundle 内 path）、捕获 stderr 重定向到 `~/Library/Logs/LarkIsland/web-agent.log`、socket 断线时收 SIGCHLD 后指数退避重启（最多 3 次）。
- `Settings/LLMSettingsView.swift`（约 250 行）：表格列出已配置 profile，支持新建 / 编辑 / 删除 / 设为默认。`apiKey` 用 `SecureField` 输入并通过 `Security.framework.SecItem*` 存到 macOS Keychain。
- `LLMProfileStore.swift`（约 150 行）：profile metadata 存 `~/Library/Application Support/LarkIsland/llm-profiles.json`，apiKey 存 Keychain；提供 `@Observable` 的 profile 列表给 SettingsView。

### BridgeServer 接通

- `LarkIslandCore` 已经在 M3 给 BridgeServer 暴露了 `commandHandler` closure。M4 在 AppModel.init 内：
  ```swift
  bridgeServer.commandHandler = { [weak self] command in
      // 当前 v0 只产生 runWebAgentTask；server 自己接收 webAgentTask* 事件
      // 通过 broadcast() 把 SessionState 的状态变更广播给 observer 客户端
      self?.handleRunnerCommand(command)
  }
  bridgeServer.start()
  ```
- BridgeServer 需要一个新职责：当 runner 客户端连入并 `registerClient(.webAgentRunner)` 后，server 把 *从** runner 收到的 webAgent* 事件**喂给 AppModel 的 SessionState reducer**，而不是 broadcast 给其他 observer（runner 是事件源，不是事件消费者）。这条 dispatch 规则需要在 spec 里明确，并在 BridgeServer 加测试覆盖。

### 不在本里程碑实现

- **DMG 打包 / 代码签名 / 公证**：留给 M7 release backlog。M4 只保证 `swift run LarkIslandApp` dev 模式能启。
- **全局快捷键唤出**：plan 已决定推迟到 M7 backlog；M4 只做菜单栏 + 灵动岛 hover。
- **飞书 skill 接入**：M5 工作。M4 演示用通用 web agent 任务（"在 example.com 读 page title"等）。
- **Sparkle 自动更新**：M0b 已删除依赖；M7 决定是否回引。
- **任务历史 / 重放**：M5+ 范畴。M4 只展示当前任务，完成后 fade out。
- **Anthropic / Claude profile**：M3 spec 已定走 LiteLLM proxy 这条路；LLMSettingsView 只支持 OpenAI 兼容 endpoint。

## Capabilities

### New Capabilities

- `lark-island-app`：macOS app 进程的整体行为契约。涵盖：
  - app 启动后 BridgeServer 的初始化时机、socket 路径、shutdown 顺序。
  - 灵动岛 overlay 的显示规则（notch Mac vs 非 notch fallback、显示器选择策略）。
  - 用户输入入口：菜单栏 popover + 灵动岛 hover-expand 两条路径。
  - WebAgent 任务在 overlay 内的渲染契约（task title / step list / final answer）。
  - LLM Profile 设置 UI 与 Keychain 持久化。
  - Runner 子进程的 spawn / path resolution / 重启策略。

### Modified Capabilities

- `web-agent-bridge`（M2 已 archive）：**追加**一条规则——BridgeServer 把从 `webAgentRunner` 角色客户端收到的 `webAgent*` 事件**直接路由给 server 端的 SessionState reducer**，不通过 broadcast() 派发给其他 observer。这是事实上 M2 spec 的隐含意图，但当时没显式写；M4 实际接通后必须 spec 化，否则 BridgeServer 实现可能歧义（事件源也是 observer 时会自我回环或丢失）。delta spec 在 `specs/web-agent-bridge/spec.md` 给出。

## 影响（Impact）

- **代码量**：
  - 新增约 1050 行 Swift（`WebAgentInputPanel` 200 + `WebAgentOverlayView` 250 + `WebAgentRunnerSupervisor` 200 + `LLMSettingsView` 250 + `LLMProfileStore` 150）。
  - 大幅瘦身约 2500 行（重写 AppModel + 删 collateral + 改 4 个 View 中的 coding agent 字段）。
  - LarkIslandCore.BridgeServer 增加约 40 行（runner 角色路由分支 + 单元测试）。
- **依赖**：`lark-island/Package.swift` 重新引入 `swift-markdown-ui`（最终答案可能含 markdown）。**不**回引 Sparkle。
- **License**：新增代码全部在 lark-island/ 子目录内，沿用 GPL v3。aggregation 边界与 M2/M3 一致，不动。
- **运行时**：M4 完成后，单一命令 `swift run LarkIslandApp`（额外把 `LARK_ISLAND_RUNNER_PATH=$(pwd)/../runners/web-agent/dist/server.js` 设到 env）即可：
  1. 启动 macOS 菜单栏 extra + 灵动岛 overlay。
  2. AppModel 初始化 BridgeServer（监听 `~/Library/Application Support/LarkIsland/bridge.sock`）。
  3. RunnerSupervisor spawn runner 子进程（runner 自己连 socket、register、launch Chromium）。
  4. 用户从菜单栏点开 input panel 输入"在 example.com 读 title"，提交后灵动岛展开显示进度。
- **风险**：
  - **AppModel 重写覆盖大**：1545 行删到 ~300 行的过程容易把 island chrome 用到的接口（`notchStatus` 等）误删。需要先列出 IslandPanelView 等保留视图的依赖，然后再写新 AppModel 兼容这些接口。
  - **Keychain 在 dev 模式可能要 ad-hoc 签名**：未签名的 `swift run LarkIslandApp` 写 Keychain 会被 macOS 弹"允许访问"对话框；可接受但 first-run UX 卡顿。M5 时可以加 onboarding。
  - **dev / prod runner 路径解析**：`LARK_ISLAND_RUNNER_PATH` env override 在文档里要写清楚；M6 打 DMG 之前都用 dev 模式，prod 路径分支留 stub。
  - **BridgeServer 的 runner-vs-observer 路由**：M2 spec 没把这条约定显式化，M4 加 modified delta；现有测试 fixtures 不涉及 server 端的事件流方向，新加测试需要 mock 一对客户端（一个 runner role、一个 observer role）跑端到端。
- **测试**：
  - LarkIslandCore 端：扩 `BridgeServer` 测试，加 2-3 个 case 覆盖 runner 事件路由 + observer 收到广播。
  - LarkIslandApp 端：写最小可测的 `LLMProfileStore` round-trip + `WebAgentRunnerSupervisor` 的 path resolution 单元测试（不真 spawn 进程，只验路径解析逻辑）。SwiftUI View 不写自动化测试，靠 M4 的 demo 跑通即视为验收。
- **手动验收**：M3 用 manual-dispatch 验收的所有事件流，在 M4 完成后改成"打开 LarkIslandApp、菜单栏点击输入框、敲一条任务"。dispatcher 退役。
