# 任务：m4-island-ui-rewrite

## 1. Package.swift 重启 + 目录改名

- [x] 1.1 在 [`lark-island/Package.swift`](../../../lark-island/Package.swift) 加回 `LarkIslandApp` executable product 与 target；引入 `swift-markdown-ui` package dependency；**不**回引 Sparkle。
- [x] 1.2 `Sources/OpenIslandApp/` → `Sources/LarkIslandApp/`（git mv）；同步改名 `OpenIslandApp.swift` → `LarkIslandApp.swift`、`OpenIslandBrandMark.swift` → `LarkIslandBrandMark.swift`。
- [x] 1.3 用 ripgrep + sed 把改名后目录内所有 `OpenIsland`(类名常量) 替换为 `LarkIsland`；`OpenIslandApp` （class 名）替换为 `LarkIslandApp`；`open-island` 替换为 `lark-island`；校验剩余无 OpenIsland 字面量（除注释中说明历史的）。同时删了 `Resources/open-island-opencode.js`（OpenCode plugin 客户端代码，coding-agent collateral）。
- [x] 1.4 新增 [`lark-island/config/packaging/LarkIslandApp.entitlements`](../../../lark-island/config/packaging/LarkIslandApp.entitlements) 声明 `com.apple.security.network.client` + `keychain-access-groups`；entitlements 文件路径在 Package.swift 暂不引用（M7 打包时再 wire），但本里程碑就位避免后续遗忘。同时删了上游残留的 `config/packaging/OpenIslandApp.entitlements`。

## 2. 删除 collateral + 重写 AppModel

- [x] 2.1 git rm `Sources/LarkIslandApp/AvatarImageStore.swift` + `Sources/LarkIslandApp/ControlCenterWindowController.swift`。
- [x] 2.2 grep `IslandPanelView` / `OverlayPanelController` / `OverlayUICoordinator` / `IslandSurface` 用到的 AppModel 接口，列到 design.md 附录或本任务下方注释，作为新 AppModel 必须保留的 forwarder 列表。**完成**：grep 出 `notchStatus` / `notchOpenReason` / `islandSurface` / `notchOpen(reason:)` / `notchClose()` / `notePointerInsideIslandSurface()` / `handlePointerExitedIslandSurface()` / `shouldAutoCollapseOnMouseLeave` / `showsIdleEdgeWhenCollapsed` / `hapticFeedbackEnabled` / `surfacedSessions` / `liveSessionCount` / `islandListSessions` / `measuredNotificationContentHeight` / `state.session(id:)` / `completionReplyEnabled` / `activeIslandCardSession` / `AppModel.hoverOpenDelay`(static) / `AppModel.defaultStatusColors`(static) / `statusColorHexes`，已全部在新 AppModel 实现。
- [x] 2.3 完全重写 `Sources/LarkIslandApp/AppModel.swift` 为约 220 行最小版本：拥有 `BridgeServer` + `OverlayUICoordinator` + `state: SessionState`，加 `StubProfileStore` / `StubRunnerSupervisor`（4.1/4.5 替换为真实实现）；暴露所有 chrome forwarder；新增 `startWebAgentTask(prompt:)` / `cancelCurrentTask()` / `activeProfileName` / `runnerOffline`。
- [x] 2.4 删 `Sources/LarkIslandApp/AppModelTypes.swift` 中跟 coding agent 强耦合的部分。**确认无残留**：M0c 时该文件已经只剩通用 enum（NotchStatus / NotchOpenReason / IslandAppearanceMode / IslandClosedDisplayStyle / IslandPixelShapeStyle / TrackedEventIngress），无需再删。

## 3. 适配保留下来的灵动岛 chrome 文件

- [x] 3.1 `IslandSurface.swift`：保留原 chrome（pixelStyle 等），未触发编译错；不需要修改（design D1 决定不动 chrome）。
- [x] 3.2 `OverlayPanelController.swift`：删 `TerminalTextSender.canReply` 引用（已删类）+ `session.completionAssistantMessageText ?? session.summary` 改为直接 `session.summary`。
- [x] 3.3 `OverlayUICoordinator.swift`：删 `HarnessRuntimeMonitor` field + `applyOverlayState(from: IslandDebugSnapshot ...)` 整段。
- [x] 3.4 `Views/IslandPanelView.swift`：2375 → 207 行，重写为 closed pill + opened task card 两态。预留 `WebAgentOverlayView` 嵌入位（4.3 时进一步抽离）。
- [x] 3.5 `Views/AppearanceSettingsPane.swift`：432 → 38 行，仅保留 `showsIdleEdgeWhenCollapsed` + `shouldAutoCollapseOnMouseLeave` toggle；状态色配色 / pixelShapeStyle / customAvatarImage 全删。
- [x] 3.6 `Views/ControlCenterView.swift`：639 → 113 行，重写为 "当前任务" + active profile 简洁面板。usage dashboard 删除。
- [x] 3.7 `Views/SettingsView.swift`：1251 → 102 行，TabView 骨架（General / Appearance / LLM placeholder / About）。LLM tab 实际渲染由 4.4 的 `LLMSettingsView` 承接。
- [x] 3.8 `AgentSession+Presentation.swift`：350 → 165 行，删 codex/claude metadata 渲染。保留 spotlightPrimaryText / spotlightActivityLineText / spotlightAgeBadge / islandPresence / estimatedIslandRowHeight。
- [x] 3.9 跑 `swift build` 通过 0 errors；从 612 errors 单调递减到 324 → 86 → 4 → 0。

## 4. 新增 5 个 Web Agent UI 模块

- [x] 4.1 `Sources/LarkIslandApp/Settings/LLMProfileStore.swift`（300 行）：`@MainActor @Observable final class`；`profiles: [VLMProfile]` + `defaultProfileName: String`；`save(profile:apiKey:)` / `delete(name:)` / `setDefault(name:)` / `apiKey(for:)`；JSON 文件读写在 `~/Library/Application Support/LarkIsland/llm-profiles.json`；apiKey 通过 `KeychainBackend` protocol 调 `Security.framework` 的 `SecItemAdd`/`SecItemCopyMatching`/`SecItemUpdate`/`SecItemDelete`；提供 `SystemKeychainBackend` + `InMemoryKeychainBackend`（测试用）。首次启动 seed `qwen-default`。
- [x] 4.2 `Sources/LarkIslandApp/WebAgent/WebAgentInputPanel.swift`（80 行）：SwiftUI View，多行 `TextEditor` + Run/Cancel 按钮 + active profile 标签 + runner-offline 红色提示；提交时调 `model.startWebAgentTask(prompt:)`，Esc/Cancel 关闭。
- [x] 4.3 WebAgentOverlayView（在 IslandPanelView 内联实现）：M4 取舍是把 task card 直接放在重写的 `Views/IslandPanelView.swift` 的 `OpenedIslandView`，不抽出独立文件；已渲染 phase pill / 标题 / 摘要 / 审批+提问行 + runner-offline banner。M5 接 finalAnswer markdown / 缩略图时再抽离为独立模块。
- [x] 4.4 `Sources/LarkIslandApp/Settings/LLMSettingsView.swift`（180 行）：左侧 sidebar List + 右侧 detail Form；Name / Base URL / Model / Family / SecureField apiKey；+/- 工具栏按钮、设默认 toggle；变更走 `LLMProfileStore` 持久化。
- [x] 4.5 `Sources/LarkIslandApp/WebAgent/WebAgentRunnerSupervisor.swift`（240 行）：`@MainActor @Observable final class`；持有 `Process` + 崩溃时间戳列表 + `RunnerLocator`；`start()` / `stop()` / `currentPID` / `runnerOffline` / `setAPIKeyProvider` / `onRunnerCrash`；spawn 用 `Foundation.Process`，stdout+stderr 输出到 `~/Library/Logs/LarkIsland/web-agent-{date}.log`；崩溃 60s 内 ≥3 次后停止重启；优雅 shutdown SIGTERM → 2s → SIGKILL。`RunnerLocator` 支持 env override + dev 反推 + prod bundle 三路解析。

## 5. BridgeServer 接通 + 路由规则修改

- [x] 5.1 在 `BridgeServer.swift` 加新分支：来自 `webAgentRunner` 客户端的 `event` 调 `stateSnapshot.apply(event)` + 触发 `eventHandler` + 推到所有 observer；来自 `observer` 的 `event` → `routingViolationHandler(.observerSentEvent)` 后丢弃。
- [x] 5.2 在 `handleCommand` 中：runner 发 command（除 registerClient）→ `routingViolationHandler(.runnerSentCommand)` 后丢弃；observer 发 command → 走 `commandHandler`。
- [x] 5.3 新增 `BridgeServerRoutingTests.swift`，4 个测试用真实 Unix socket pair 覆盖：
  - runner 发 webAgentTaskStarted → eventHandler 调用 + observer 收到 broadcast ✅
  - runner 发 runWebAgentTask 命令 → routingViolation + commandHandler 不调 ✅
  - observer 发 webAgentTaskStarted → routingViolation + eventHandler 不调 ✅
  - observer 发 runWebAgentTask → commandHandler 被调用 ✅
- [x] 5.4 跑 `swift test`：28/28 全绿（M2/M3/M4 的 24 + M4 group 5 的 4）。

## 6. AppModel 接通 BridgeServer + RunnerSupervisor

- [x] 6.1 AppModel.init 构造 BridgeServer 实例；startIfNeeded() 配置 `eventHandler`/`routingViolationHandler`/`commandHandler` 在 start() 之前。
- [x] 6.2 startIfNeeded 启动 BridgeServer + 配 supervisor 的 apiKeyProvider/onRunnerCrash + 启动 supervisor。shutdown() 反序释放。
- [x] 6.3 `startWebAgentTask(prompt:)` 检查 runner 在线、当前无 .running session、构造 `BridgeCommand.runWebAgentTask{taskID, prompt, profileName=defaultProfileName}` 调 `bridgeServer.sendToRunner(command)`。
- [x] 6.4 supervisor 检测 runner 异常退出 → onRunnerCrash → handleRunnerCrash() 把所有 `.running` session 投递 `webAgentTaskFailed{kind: cancelled, message: "Runner exited unexpectedly"}`，避免 UI 永久 spinner。
- [x] 6.5 BridgeServer 新增 `sendToRunner(_ command: BridgeCommand)` 方法 + `clientCount(role:)` synchronous 查询；单元测试间接覆盖（observer-routed test 验证 sendToRunner 路径反向）。

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
