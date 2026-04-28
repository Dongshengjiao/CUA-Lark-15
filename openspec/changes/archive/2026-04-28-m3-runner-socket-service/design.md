# 设计：web-agent-runner-service 进程模型

## 背景（Context）

M2 已经把 LarkIslandCore 的 Bridge 协议补到位（`web-agent-bridge` spec，6 条 requirement，11 个 JSON fixture）。M2 的实现纯粹是**类型与 Codable 层面**的：Swift 端有 5 个新事件 + 1 个新命令 + 新角色，TS 端有完整镜像 codec，但**两端都还没建立 socket 连接**。

约束：

- 必须复用 `web-agent-bridge` 已经定型的 wire 协议：`BridgeHello v2` → `registerClient(.webAgentRunner)` → 接收 `runWebAgentTask` 命令、回灌 `webAgent*` 事件，全部走 `BridgeCodec` 的 newline-delimited JSON。
- 必须保持 license aggregation 边界：runner 与 lark-island 的唯一耦合是 socket + JSON，不能编译期依赖。
- 必须接住 M1 spike 已经验证过的 GUIAgent 行为（Qwen3-VL-Plus 在 UI-TARS prompt 下输出标准 action 格式）。
- **不**做并发。v0 单 runner 单任务串行就够 demo。
- **不**做发布级守护（崩溃重启、健康检查归 M4 RunnerSupervisor）。

利益相关方：
- 当前对话中的开发者（你 + agent）。
- M4 阶段会消费这套事件流的 LarkIslandApp `commandHandler`。
- M5 阶段会注册新 skill 的 runner 内部模块。
- M6 demo 的最终用户。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**

- runner 一次启动后**长驻**，按需接收任务并执行，期间不退出。
- runner 端的命令处理循环 100% 兼容 M2 spec：所有 `webAgent*` 事件按规范的字段集合发出，所有 timestamp 通过 BridgeCodec 的 ms 精度落到 wire。
- 任务执行期间产生的截图写到 `~/Library/Application Support/LarkIsland/web-agent/screenshots/<taskID>/<stepIndex>.jpg`，事件只带 path。
- vitest 端到端覆盖：mock socket 触发命令、mock GUIAgent 触发 `onData`、断言 envelope 序列符合 spec。
- 失败模式可观察：runner 把异常分类成 `vlmTimeout` / `vlmError` / `pageError` / `cancelled`，对应 `WebAgentFailureKind`。

**非目标：**

- 不在本里程碑动 LarkIslandApp 端代码。M3 用一个手工 dispatcher（M3 验收脚本）模拟 server 派发命令。
- 不实现 LLM Settings UI、Keychain 写入、profile 增删（M4）。
- 不做飞书登录态、cookie 持久化、`webAgentApprovalRequested`（M5；M3 的 runner 永远不发 approval 事件）。
- 不打包二进制（M6）。
- 不在 wire 上传输截图字节（M2 已定，path-only）。
- 不做多任务并发：当 runner 还在跑任务时收到第二个 `runWebAgentTask`，**直接拒绝并发 `webAgentTaskFailed{kind: pageError, message: "runner busy"}`**。

## 关键决策（Decisions）

### D1：Chromium 在 runner 生命周期里**只 launch 一次**，所有任务复用

考虑过两种模型：
- **每任务 launch/close**：每 task 都 `LocalBrowser.launch()` → 跑完 `close()`。任务间环境完全隔离，但每次冷启动 5–10 秒，demo 体验差。
- **整 runner 生命周期复用**：launch 一次，每个新 task 用 `browser.createPage()` 起一个新 page，`page.close()` 收尾。任务间通过新 page 隔离，省掉 Chromium 冷启动。

选**复用方案**。理由：
- 任务隔离用 page 级别足够（每个 page 独立 cookies/storage）。
- M5 飞书登录态需要 cookie 持久化到 user-data-dir，这天然属于 browser 级别 —— 复用 browser 才方便。
- 冷启动开销摊到 runner 启动那一次，而不是每个用户任务 +5–10 秒。

trade-off：runner 长驻意味着 Chromium 内存（约 200–400 MB）也长驻。M6 打包前需要在 README 里告知。

### D2：socket 断线处理 = 退出 + 让 supervisor 重启

收到 socket EOF 或 ECONNRESET 时，runner 不重连。直接：
1. 取消当前进行中的任务（如果有），发 `webAgentTaskFailed{kind: cancelled}` 到 stdout 日志（socket 已断，发不出去）。
2. 关闭 LocalBrowser。
3. 进程 exit code 1，让 M4 的 RunnerSupervisor 触发指数退避重启。

考虑过自重连（runner 内部捕获断线、重连 socket）。但这会让 runner 自己持有重启策略，分割 supervisor 的职责。统一交给 M4 supervisor 处理更干净。

### D3：profile 解析仅支持 `qwen-default`，从 `DASHSCOPE_API_KEY` 读 key

M2 的 `runWebAgentTask` 命令携带 `profileName`，runner 必须把它解析成 `{baseURL, apiKey, model}` 才能传给 GUIAgent。M3 阶段：
- 收到 `profileName === "qwen-default"` 或 `null` → 用 hardcoded `{baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3-vl-plus", apiKey: process.env.DASHSCOPE_API_KEY}`。
- 收到任何其他 `profileName` → 立刻发 `webAgentTaskFailed{kind: vlmError, message: "unknown profile <name>"}`。

M4 加 LLM Settings + Keychain 时再扩展。这样 M3 与 LLM 配置子系统解耦。

### D4：单任务串行 + busy 拒绝

runner 内部维护一个布尔 `isBusy`。
- `false` 时收到 `runWebAgentTask`：进入任务循环、置 `true`。
- `true` 时收到 `runWebAgentTask`：立刻发 `webAgentTaskFailed{taskID: <new>, kind: pageError, message: "runner busy with <currentTaskID>"}`，**不**触碰当前任务。

考虑过 queue。但 v0 demo 不需要 queue —— 一个用户一次只发一条任务。queue 留给 M5+。

### D5：截图写盘是 fire-and-forget

GUIAgent 的 `onScreenshot` 回调能拿到 base64 + scaleFactor。runner 把 base64 解码 + 写到目标 path 时**不 await**：用 Node 的 `fs.promises.writeFile().catch(logErr)`。这样：
- 高频步骤（每秒一次截图）不会阻塞事件循环。
- 写盘失败不会让任务整体 fail，只在 logger 里留痕；下游 `webAgentStepUpdate` 的 `screenshotURL` 仍然指向那个（可能尚未写完的）path —— 由消费方（M4 UI）按文件不存在 graceful 处理。

trade-off：极端情况下 step event 到达比文件落盘早。M4 UI 加个"loading 缩略图"占位即可。

### D6：vitest mock 取代真 socket / 真 Chromium

M3 的测试不开 Chromium 也不连真 socket：
- 用 `unix-stream-pair` 或自写 `Duplex` 双工流模拟 server ↔ runner 双向 IO。
- 用 vitest 的 `vi.mock` 把 `@ui-tars/sdk` 的 `GUIAgent` 替换成发出预设 `onData` 序列的桩对象。
- 用 `vi.useFakeTimers()` 让 timeout 测试不要真 wait 180 秒。

这样测试本机 < 1 秒跑完，CI 也跑得动。**真实端到端**留给 M6 demo（手动跑一次飞书任务）。

### D7：runner 启动时**先连 socket 再 launch Chromium**

启动顺序：
1. 解析 env 变量（`DASHSCOPE_API_KEY`、`LARK_ISLAND_SOCKET_PATH` 可选 override）。
2. 连 `bridge.sock`，等 `BridgeHello`。如果失败 / 收到 `protocolVersion < 2` → exit 1。
3. 发 `registerClient(.webAgentRunner)`。
4. **然后**才 `LocalBrowser.launch({ headless: true })`。
5. 进入命令循环。

考虑过反过来（先 Chromium 再 socket），但启动失败模式更糟：socket 没连上时 Chromium 已经占了几百 MB 内存。先连 socket 是廉价 fail-fast。

## 风险 / 取舍（Risks / Trade-offs）

- **Chromium 长驻内存** → M6 在 README 标注；如果用户机器吃紧可以加 `--each-task-cold-start` 启动开关（不在 M3 内）。
- **截图写盘惰性** → M4 UI 必须容忍文件不存在；写一个 1 行 graceful guard。
- **profile 解析锁定 qwen-default** → 文档明确这是 M3 临时约束，M4 的第一件事是扩展 ProfileResolver 接受 LLM Settings 写入的 JSON。
- **socket 断线丢失任务** → v0 接受。生产化要 M4 的 supervisor 在 spawn 时记录"上次未完成任务"并提示用户。
- **vitest 不测真 Chromium** → 测试覆盖不到 GUIAgent 实际 prompt 鲁棒性。这部分由 M1 spike 已经验证 + M6 demo 复测把关。

## 迁移计划（Migration Plan）

M3 不需要数据迁移。落地步骤：

1. 写 `src/bridge/client.ts` + 单元测试（mock socket pair）。
2. 写 `src/agent/runtime.ts` + `src/agent/screenshots.ts` + 单元测试（mock GUIAgent）。
3. 写 `src/profiles/index.ts` + 单元测试（环境变量 + profileName 分支）。
4. 写 `src/runner.ts` 把上面三块拼起来 + 一个端到端 vitest（mock socket + mock GUIAgent + 真 timer）。
5. 手动验收：起一个 `npx tsx test/manual-dispatch.ts` 模拟 LarkIslandApp 派发一个任务，runner 在另一个 shell `npm start`，看完整事件流走通。
6. 更新 `runners/web-agent/README.md`（如果存在；不存在就先跳过，M6 重写顶层 README 时一起做）。

回滚：runner 改造文件全集中在 `runners/web-agent/src/` 下；删除 `src/runner.ts` + `src/bridge/client.ts` + `src/agent/` 目录就回到 M1 spike 状态。M2 协议层不动，回滚不影响 LarkIslandCore。

## 待解决问题（Open Questions）

1. **Chromium 任务间 page 复用还是 createPage** —— D1 倾向"每任务新 page"，但是否 close 上一个 task 的 page 还是留着供失败时调试，spec 写完后再决定。**暂定**：每任务起新 page，任务结束 page.close()，browser 不动。
2. **runner 拒绝 busy 时 task ID 用谁** —— spec 应明确：busy 拒绝消息里 `taskID` 是新进来的 task 的 ID（让 LarkIslandApp 能在 UI 上定位到被拒绝的那条），不是当前在跑的 task ID。**已在 D4 里写明**。
3. **截图压缩等级** —— M2 spec 里没硬性规定 jpeg quality。M1 spike 用的 75。M3 沿用 75，给 spec 加一条"建议 60–80"，留给后续 polish。
4. **runner 的 stderr 是否也 envelope 化** —— 目前未决。M3 内 runner 自身 log 直写 `~/Library/Logs/LarkIsland/web-agent.log`（普通文本），不通过 socket。M4 supervisor 会接管 stderr 重定向。
