# 设计：LarkIslandApp 灵动岛 UI + Runner 接通

## 背景（Context）

M0b 把 LarkIslandApp executable target 从 Package.swift 移除时留下了一份"快照"：[Sources/OpenIslandApp/](../../../lark-island/Sources/OpenIslandApp/) 共 18 个 swift 文件、约 7000 行（含 SwiftUI Views），是 fork 自 open-vibe-island 的 coding agent 监听器 UI。这些代码当前不进 build，但磁盘上完整保留了上游灵动岛 chrome 实现（NSPanel 行为、notch 几何检测、显示器选择、SwiftUI 灵动岛形状）。

M2 / M3 把后端协议跟 runner 都修干净了。M4 的核心选择是：**怎么从这 7000 行废墟里捞出灵动岛 chrome、把 coding agent 烙印剥掉、再装上 web agent 的指挥中枢**。

本次设计涉及的相关方：
- 当前 plan/agent 推进者（你 + AI）。
- M5 飞书 skill 实现者（直接消费 LLMProfileStore + AppModel.startWebAgentTask 接口）。
- M6 demo 录制 / 比赛交付的最终用户（看到的就是 M4 的 UI）。
- 未来潜在的 OSS 用户（如果 lark-island/ 子目录决定单独 fork 出去）。

约束：
- **GPL aggregation 边界**：lark-island/ 仍然 GPL v3，不能 import runners/ 的 TypeScript 类型；唯一耦合路径是 LarkIslandCore 已经定型的 BridgeServer + JSON envelope。
- **License-driven layout**：LarkIslandApp executable **不能**编译时引用任何 runners/ 下的代码。runner 二进制路径只能通过运行时（环境变量 + Bundle.main.resourceURL）解析。
- **Local-first**：不引入新的 macOS 系统级守护、不写 Login Item、不写远程服务。
- **不打包发布**：M0b 已删 Sparkle、M7 backlog 才回引；本次设计假设永远 dev 模式跑。
- **Swift 6.2 + macOS 14+**：保留 M0c Package.swift 决策。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**

- 让 `swift run LarkIslandApp` 能跑出一个**完整且端到端可用**的 macOS app：菜单栏 extra + 灵动岛 overlay + 设置面板 + 后台 runner 子进程。
- AppModel 重写为最小、可测、强类型的 web-agent 状态拥有者；不再 carry coding agent 残留。
- BridgeServer 真正在 app 进程内启动，runner 启动后能成功握手 + 注册 + 收任务 + 回灌事件。
- 灵动岛 overlay 实时反映 runner 推过来的 step 事件（包括缩略图）。
- LLM Settings UI 能 CRUD profile、API key 走 Keychain、编辑后无需重启 app 即对下一条任务生效。
- M5 飞书 skill 接入只需扩展 `runners/web-agent/skills/`，**不需要再动 lark-island/**。

**非目标：**

- 不复活 `LarkIslandAppTests`（M0b 时禁用的 3 个 test 文件继续 disable，新写极少量针对性测试取代）。
- 不做 SwiftUI Preview / `.xib`。
- 不实现"任务取消"按钮（spec `web-agent-runner-service` 提到 `cancelled` failure kind 是预留给 M5+ 的 cancel 命令，本次只在 socket 断线场景使用）。
- 不实现 onboarding / 引导流程。
- 不做 dock icon / About 页 polish。
- 不在 macOS sandbox 模式下跑（dev 期 `swift run` 默认不 sandbox；entitlements 文件预留给 M7 打包用）。
- 不实现 `webAgentApprovalRequested` 的 UI 渲染（M5 飞书登录扫码需要时再加；M3 spec 已定义事件结构，M4 收到这种 envelope 暂时只 log）。

## 关键决策（Decisions）

### D1：保留灵动岛 chrome 整套，AppModel 大改 — 不动 chrome

把"chrome 几何代码"和"app 状态机"分开看：

- **保留并 minimal-patch**（约 9 个文件、~3000 行）：`IslandSurface`、`IslandChromeMetrics`、`IslandPixelGlyph`、`NotchShape`、`OverlayDisplayConfiguration`、`OverlayPanelController`、`OverlayUICoordinator`、`OpenIslandBrandMark`、`Views/IslandPanelView`。这堆代码核心是 NSPanel + 自定义 SwiftUI Shape + 显示器选择。它们引用 AppModel 的字段不多（典型只用 `notchStatus`、`islandSurface` 这两个 property forwarder），适配新 AppModel 即可。
- **完全重写**（1 个文件）：`AppModel.swift`。1545 行从零写成约 250 行最小版本，所有 coding agent 协调器 / sessions 列表管理 / hook UI 联动全部不要了。
- **完全删除**（2 个文件）：`AvatarImageStore`（agent 头像）、`ControlCenterWindowController`（独立窗口）。

考虑过的替代方案：
- **整个 OpenIslandApp 重写**：要写约 7000 行新代码，工作量爆炸；不能复用上游精心打磨过的 notch 检测 + 显示器选择逻辑。**否决**。
- **AppModel 也保留 + minimal-patch**：原 AppModel 1545 行里 ~80% 都是 coding agent 协调器；删完剩骨架还不如重写。**否决**。

### D2：BridgeServer 在 AppModel 进程内启动，runner 路由到 reducer 而非 broadcast

M2 spec 没显式说"server 收到 webAgentRunner 客户端发的事件后该怎么 route"。M4 必须明确：

- 收到 `BridgeCommand`（注：runner 不会发 command，发 command 的是 observer 客户端）：路由给注册的 `commandHandler` closure。
- 收到 `BridgeEnvelope.event(...)` 且 source 是 `webAgentRunner` role：**直接 apply 到 server 持有的 SessionState reducer**，并把 reducer 后的 SessionState 通过 `broadcast()` 推给所有 `observer` 客户端。
- 收到 `BridgeEnvelope.event(...)` 且 source 是 `observer` role：忽略（observer 不应该是事件源）。

也就是说 v0 架构下 LarkIslandApp **既是 server 又是 observer**：
- AppModel 持有 BridgeServer 实例（server 角色）。
- AppModel 自己内部直接订阅 `BridgeServer.stateSnapshot`（不开第二个 socket 连接当 observer），把状态变更触发 SwiftUI re-render。
- 未来如果有第二个 observer（比如 Apple Watch app、CLI 工具），它们才会真正订阅 `broadcast()`。

这样的好处：单进程内不需要 self-loopback socket。

考虑过的替代方案：
- **AppModel 单独连一条 socket 当 observer**：清晰但浪费一对 fd + 一份 JSON 序列化开销。**否决**。
- **runner 事件直接广播给所有 observer + AppModel 也连 socket**：等价方案 1 的 over-engineering 版本。**否决**。

### D3：RunnerSupervisor 用 `Process` API spawn，stderr 重定向到 log 文件

Swift 标准库的 `Foundation.Process`（macOS 上即 NSTask）足够。spawn 流程：
1. 解析 runner 路径：dev 看 `LARK_ISLAND_RUNNER_PATH` env，否则从 `Bundle.main.bundleURL` + 兼容 dev 模式的"反推 repo root"（用 `#filePath`）取相对路径；prod 看 `Bundle.main.resourceURL`。
2. 设置 env：传递 `DASHSCOPE_API_KEY` + `LARK_ISLAND_SOCKET_PATH`（如果用了非默认路径）。
3. `process.standardOutput` 和 `standardError` 重定向到 `~/Library/Logs/LarkIsland/web-agent.log`（按日期分文件，rotate 留 5 天）。
4. 注册 termination handler：runner exit 时如果 exit code != 0 且距上次 spawn < 60s 累计 ≥ 3 次，停止重启并把任务标 failed；否则按 1s/3s/9s 指数退避重启。
5. App 退出时优雅关闭：发 SIGTERM、wait 2s、超时则 SIGKILL。

为什么不用 `launchd` / Login Item：
- 没必要：runner 只在 app 跑期间存在。
- 复杂：launchd plist 是 app sandbox 之外的状态，dev 模式下会污染用户系统。
- M0b 已经决定不打包，prod 路径不存在，没必要现在配 launchd。

### D4：LLM Profile metadata 走 JSON 文件，secret 走 Keychain，**通过 `JSONStorage` + `Security.framework` 直调，不引入第三方依赖**

profile 数据有两半：
- 非敏感（name / baseURL / model / family）：JSON 文件 `~/Library/Application Support/LarkIsland/llm-profiles.json`。
- 敏感（apiKey）：macOS Keychain，service = `ai.neolix.lark-island`、account = profile name。

用 `Security.framework` 的 `SecItemAdd` / `SecItemCopyMatching` / `SecItemUpdate` / `SecItemDelete` 直调，不用 KeychainAccess 第三方库。理由：
- 4 个 API 调用 200 行 swift 写完。
- 减一个依赖减一份 supply-chain 风险（夹带 GPL aggregation 边界考虑）。
- 测试可以注入一个 mock `KeychainBackend` protocol。

考虑过 `UserDefaults`：rejected，apiKey 明文写到 plist 不安全。

### D5：UI 输入入口先做菜单栏点击 + 灵动岛 hover-expand，**不做全局快捷键**

按 plan 决议，全局快捷键留 M7 backlog（涉及 Accessibility 权限引导）。M4 实现两条入口：
- 菜单栏 NSStatusItem 点击 → 弹出 NSPopover 内嵌 `WebAgentInputPanel` SwiftUI 视图。
- 灵动岛 overlay 鼠标 hover 时从紧凑态展开 → 暴露一个内嵌的 mini input field（直接复用 InputPanel SwiftUI body，autosize 适配灵动岛宽度）。

两条路径走同一个 `AppModel.startWebAgentTask(prompt:)`，无歧义。

### D6：当前任务"完成后保留几秒"再 fade，不立刻消失

灵动岛 overlay 显示当前 task 的策略：
- 任务进行中（`SessionPhase.running`）：永远显示。
- 任务完成 / 失败（`SessionPhase.completed`）：保留 8 秒，最终答案 / 失败信息可见，然后 SessionState 调 `removeInvisibleSessions()` 让 reducer 清掉，UI 跟着 fade。
- 用户点击 overlay → 暂停 fade 计时器（鼠标 hover 期间）。

8 秒是 plan 没硬性规定的取舍：太短看不清结果、太长挤住下一个任务。Demo 期间可以从 8 秒做起，M5 用真飞书任务时再调。

### D7：不在 LarkIslandApp 编译时反向 import runners 的任何东西

GPL aggregation 边界要求：lark-island 与 runners/ 之间只能 IPC。这条约束在 M4 技术上意味着：

- LarkIslandApp **不**能 `import` runners/ 下的 .ts 文件、`Resources/` 也不嵌入 runner 源码（M7 打 DMG 时再 copy `dist/` 到 `Contents/Resources/runners/`，那是部署边界）。
- runner 路径的 fallback 解析**只**在运行时通过文件系统 path 查找。
- 协议的"两端类型"靠 M2 已有的 JSON fixture round-trip 测试（已经在 36 个 vitest + 24 个 swift test 里）保护，不靠静态类型耦合。

考虑过用 codegen 工具一份 IDL 生成 swift + ts 双侧类型：reject。aggregation 边界要求"软"耦合，codegen 引入构建时依赖，相当于隐式打破边界。

## 风险 / 取舍（Risks / Trade-offs）

- **AppModel 重写漏改 island chrome 接口** → 写新 AppModel 前先 grep `IslandPanelView` / `OverlayPanelController` / `OverlayUICoordinator` 用到的 AppModel property 列表（约 5-10 个），写到 design 附录后再开工。
- **Keychain dev 模式弹窗** → first-run 接受弹窗即可；dev README 加一句说明。
- **Runner spawn 路径解析在 dev/prod 双模式都能跑** → 写一个 `RunnerLocator` 静态工具 + 单元测试覆盖三种解析路径。
- **BridgeServer runner-vs-observer 路由的 modified spec delta** → 必须在 archive 时回灌到 `openspec/specs/web-agent-bridge/spec.md`；写测试覆盖。
- **`webAgentApprovalRequested` 暂时只 log，不渲染** → M5 飞书登录扫码会触发；M5 时再写 UI。M4 测试不覆盖这条路径。
- **任务进行中崩溃** → AppModel 持有 SessionState 是进程内的，runner 崩溃会触发 supervisor 重启，但 SessionState 里的"running"任务会被孤立。M4 加一条逻辑：supervisor 检测到 runner 异常退出时把所有 `phase == .running` 的 session 标 `cancelled` failure。

## 迁移计划（Migration Plan）

M4 是从"无 app"到"有 app"，没数据要迁。落地步骤：

1. **重启 build**：lark-island/Package.swift 加回 LarkIslandApp executable target + swift-markdown-ui dep。`swift build` 会因 OpenIslandApp/ 下原代码 ~750 dangling refs 立刻一片红，**符合预期**。
2. **目录改名**：`Sources/OpenIslandApp/` → `Sources/LarkIslandApp/`，文件 `OpenIslandApp.swift` → `LarkIslandApp.swift`、`OpenIslandBrandMark.swift` → `LarkIslandBrandMark.swift`，更新 Package.swift target name。
3. **删 collateral**：`AvatarImageStore.swift` + `ControlCenterWindowController.swift` git rm；`Views/ControlCenterView.swift` 改写为简洁 web agent 状态显示。
4. **重写 AppModel.swift**：先列出 island chrome 文件依赖的 property，再写新 AppModel 兼容这些接口 + 加 web agent 状态字段。
5. **挑文件修引用**：在保留的 island chrome 9 个文件 + 4 个 Views 里逐个删 coding agent 字段引用，每修一个跑一次 `swift build` 看错误数下降。这是 M0b 那条修编译错路径的重演，但 scope 小（~750 → 0）。
6. **新增 5 个 UI 组件**：WebAgentInputPanel / WebAgentOverlayView / WebAgentRunnerSupervisor / LLMSettingsView / LLMProfileStore。
7. **AppModel 接通 BridgeServer + RunnerSupervisor**：在 init 内启动两者；deinit 关闭。
8. **更新 LarkIslandCore.BridgeServer**：加 runner-event-routing 分支 + 单元测试 + delta spec。
9. **dev 模式跑通**：手敲 `LARK_ISLAND_RUNNER_PATH=... DASHSCOPE_API_KEY=... swift run LarkIslandApp`，从菜单栏触发"在 example.com 读 title"，看灵动岛展开 + step 流。
10. **archive M4**：把 lark-island-app spec + web-agent-bridge delta 都 sync 到主 specs/。

回滚：M4 是个独立 feature branch + 一组 commit。如有崩溃严重需要回滚，git revert 到 M3 archive commit 即可，runner 仍然能用 manual-dispatch 验证。

## 待解决问题（Open Questions）

1. **Keychain entitlement 在 dev 模式具体怎样体现** —— `swift run` 跑出的 unsigned binary 写 Keychain 时 macOS 会要求用户在弹窗输入登录密码并选"始终允许"。这是一次性配置，README 加一段即可。是否需要 onboarding 引导？**暂定**：M5 时再考虑，M4 内不写引导。
2. **菜单栏 NSPopover vs 自绘窗口** —— Popover 是 macOS 标配，但默认有箭头、靠菜单栏 anchor。如果用户希望"按快捷键唤出在屏幕中央" Spotlight 风格，得自绘 NSPanel。M4 先用 NSPopover，UI polish 留到 M6+。
3. **AppModel 是否暴露 publishedTasks: [AgentSession]** —— 直接 `var sessions: [AgentSession]` 还是 `let state: SessionState`？SwiftUI `@Observable` 时直接暴露 SessionState 让 view 自己 derive 简单些。**暂定**：暴露 `var state: SessionState`，view 用 `model.state.activeActionableSession` 这种现成 helper。
4. **runner spawn 失败后是否提示用户** —— supervisor 3 次崩溃停止重启后，是不是要在灵动岛上标红 "runner unavailable"？**暂定**：是，加一个 SessionPhase 之外的 banner 状态 `runnerOffline: Bool` 在 AppModel 里，灵动岛显示一个红点。M4 时实现。
5. **LarkIslandApp executable 的 `defaultLocalization`** —— Package.swift M0c 时设为 `"en"`。要不要 M4 起就支持中文？plan 倾向中文优先（项目大量中文 doc），但本次先保持 en，UI 文案在源码里写中文（违反 i18n 但 demo 期 OK）。M5 onboarding 时再做正式 i18n。
