# 提议：M3 — runner 从 oneshot 改为常驻 socket 服务

## 为什么（Why）

M1 的 spike (`runners/web-agent/examples/hello.ts`) 证明 UI-TARS BO + Qwen3-VL-Plus 跑 headless Chromium 能稳定输出 action 格式，但它是**一次性脚本**：跑完任务直接退出。M2 给 LarkIslandCore 加了完整的 web-agent 协议（5 个事件 + `runWebAgentTask` 命令 + `webAgentRunner` 角色 + Hello v2），并通过共享 JSON fixture 在 Swift 与 TS 之间双向 round-trip 验证通过。

但**协议两端还没接通**：

- runner 不会主动连 `bridge.sock`，也不会监听 `runWebAgentTask` 命令；它依然只接受命令行参数。
- 每跑一个任务都要重新 `npm install` cold-start 一次 Chromium（M1 实测每次启动 5–10 秒），用户体验完全不可接受。
- M4 灵动岛 UI 也没有可订阅的 runner 事件源。

M3 要把 runner 改成**长驻 socket 服务进程**，由 LarkIslandApp（M4 实现）spawn 一次后常驻，监听 LarkIsland Bridge 派发的任务，把执行进度通过 M2 定义好的事件 envelope 流式回灌。这是把 M2 的纸面协议落地的唯一一步。

## 改动内容（What Changes）

- **新增** `runners/web-agent/src/runner.ts`：runner 服务主入口。负责连 socket、发 `BridgeHello` 客户端版本、`registerClient(.webAgentRunner)`，进入命令处理循环。
- **新增** `runners/web-agent/src/bridge/client.ts`：基于 Node `net.Socket` 的 Unix domain socket 客户端，复用 M2 的 `encodeEnvelope` / `decodeEnvelope`，提供逐帧（newline-delimited）读写、自动重连、关闭语义。
- **新增** `runners/web-agent/src/agent/runtime.ts`：把 M1 的"裸跑 GUIAgent"代码沉淀为可复用的 `runTask(prompt, profile)` 接口；负责 launch/close LocalBrowser、把 `onData` 回调翻译成 `WebAgentStepUpdate` envelope、把最终 answer 翻译成 `WebAgentTaskCompleted`、把异常翻译成 `WebAgentTaskFailed`（带 4 种 `WebAgentFailureKind` 之一）。
- **新增** `runners/web-agent/src/agent/screenshots.ts`：截图落盘（`~/Library/Application Support/LarkIsland/web-agent/screenshots/<taskID>/<stepIndex>.jpg`）+ 路径返回，对应 M2 spec 中的 `WebAgentStepUpdate.screenshotURL` 约定。
- **新增** `runners/web-agent/src/profiles/index.ts`：`profileName → { baseURL, apiKey, model }` 的最小解析。本里程碑只支持出厂内置的 `qwen-default` 一档（从 `process.env.DASHSCOPE_API_KEY` 读 key）。M4 加 LLM Settings UI 时再扩展。
- **改造** `runners/web-agent/package.json`：新增 `"start": "tsx src/runner.ts"` 脚本；`runners/web-agent/dist/` 由 `npm run build` 输出，便于 M4 RunnerSupervisor spawn。
- **新增** `runners/web-agent/test/runtime.test.ts`：用 vitest + mock socket 测试 runner 的命令循环（hello → registerClient → 收到 `runWebAgentTask` → 发 started → step → completed → 等下一个）。不真起 Chromium、不真调 VLM —— 只验证协议消息流。
- **保留** `runners/web-agent/examples/hello.ts`：作为不依赖 LarkIslandCore 的本地 spike 入口，方便未来调试 GUIAgent 行为。
- **不在本里程碑实现**：
  - LarkIslandApp 端的 `BridgeServer` 启动与 `commandHandler` 接线（属于 M4，先空着；M3 的 runner 在没有 server 时 fail-open 退出）。
  - 飞书 skill / cookie 持久化（M5）。
  - 灵动岛 UI 渲染 step 截图（M4）。
  - 多任务并发（v0 单 runner 单 task 串行）。
  - Doubao / 自部署 UI-TARS profile（先固定 qwen-default）。

## Capabilities

### New Capabilities

- `web-agent-runner-service`：runner 进程的生命周期与协议处理契约。涵盖 socket 连接管理、hello/握手、任务派发循环、事件回灌、单任务串行约束、screenshots 写盘约定、与 `web-agent-bridge` spec 的协同关系。

### Modified Capabilities

<!-- 不修改任何已有 capability。M2 的 web-agent-bridge spec 是本里程碑的"前置契约"，
     不在这里改 —— 任何想改协议形状的事都必须先反过来 propose 一个 web-agent-bridge 的 delta。 -->

## 影响（Impact）

- **代码**：
  - 新增 `runners/web-agent/src/runner.ts`（约 80 行）、`src/bridge/client.ts`（约 120 行）、`src/agent/runtime.ts`（约 200 行）、`src/agent/screenshots.ts`（约 50 行）、`src/profiles/index.ts`（约 50 行）。
  - 改动 `runners/web-agent/package.json` 加 `start` 脚本、`runners/web-agent/src/bridge/index.ts` re-export client。
  - 测试：`test/runtime.test.ts`（约 250 行 vitest）。
- **依赖**：可能新增 `node:net`（标准库，免装）。不引入新 npm dep。
- **协议层**：**不**改 M2 的 spec。M3 是 web-agent-bridge 的第一个真实 consumer。
- **License**：所有新增文件在 `runners/` 下，Apache-2.0；通过 Unix socket IPC 与 lark-island/ (GPL v3) 通信，aggregation 边界不破。
- **运行时**：M3 完成后，`cd runners/web-agent && npm start` 应能：
  1. 连上现存的 `bridge.sock`（如果 LarkIslandApp 没起就连接失败、写日志、退出 1）。
  2. 接收一条手工 `runWebAgentTask` 命令（用 `runners/web-agent/test/manual-dispatch.ts` 之类的 helper 触发）后，跑通整套 `started → step* → completed` 事件流。
  3. 截图按规范写到磁盘，事件 envelope 里只带 path。
- **风险**：
  - **runner 单点常驻**：进程崩溃整个 web-agent 不可用。M3 内只确保自身不崩；M4 RunnerSupervisor 负责 spawn 时的崩溃重启。
  - **Chromium 复用**：M3 决定一个 LocalBrowser 是"贯穿 runner 生命周期"还是"每任务 launch/close"。前者快、后者干净 —— design.md 会拍板。
  - **socket 断线**：LarkIslandApp 重启 / Bridge 路径权限变更时 socket 会断。runner 必须能感知断线、清理当前任务、退出（让 supervisor 重启）。
- **测试覆盖**：M3 的核心是协议流转，**不**测 Chromium 真实点击 / VLM 真调用 —— 那两条已在 M1 spike 验证过。M3 测试用 mock socket + mock GUIAgent 验证消息流转的正确性。
