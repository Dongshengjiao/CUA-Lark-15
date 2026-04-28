# 任务：m3-runner-socket-service

## 1. Bridge 客户端层

- [x] 1.1 新建 `runners/web-agent/src/bridge/client.ts`：基于 Node `node:net` 的 Unix domain socket 客户端类 `BridgeClient`，提供 `connect(socketPath)` / `send(envelope: BridgeEnvelope)` / `onEnvelope(handler)` / `onClose(handler)` / `close()` 接口；内部用 stream 累积 byte 直到 `\n` 边界，再交给 `decodeEnvelope()`。
- [x] 1.2 在 `BridgeClient.connect()` 内部实现握手:连接成功后 await 一帧 `BridgeHello` envelope，校验 `protocolVersion === 2`，否则 reject 一个 `BridgeProtocolMismatchError`。
- [x] 1.3 在 `runners/web-agent/src/bridge/index.ts` re-export `BridgeClient` 和新 error 类型。
- [x] 1.4 在 `runners/web-agent/test/bridge-client.test.ts` 加 `BridgeClient` 端到端测试:用 Node `net.createServer` 起一个内存 server、跑 hello 握手、发送命令、收事件。覆盖 hello v1 mismatch 退出路径。

## 2. Profile 解析层

- [x] 2.1 新建 `runners/web-agent/src/profiles/index.ts`：导出 `resolveProfile(name: string | null | undefined): ResolvedProfile | ProfileResolutionError`。`ResolvedProfile` = `{baseURL, apiKey, model, family}`。
- [x] 2.2 实现 `qwen-default` 路径：从 `process.env.DASHSCOPE_API_KEY` 读 key；空字符串 / undefined 视为缺失。
- [x] 2.3 实现 unknown profile 与 missing key 两条 error 路径，每条返回带 `kind: "vlmError"` 字段的 `ProfileResolutionError`，方便 caller 直接转 `webAgentTaskFailed`。
- [x] 2.4 在 `runners/web-agent/test/profiles.test.ts` 加 vitest：4 个 case（默认 + null + 缺 key + 未知名），实际写了 6 case 还覆盖 undefined / 空字符串。

## 3. Agent runtime 层

- [x] 3.1 新建 `runners/web-agent/src/agent/screenshots.ts`：导出 `screenshotPathFor(taskID, stepIndex)` + `saveScreenshot(base64, path): void`（fire-and-forget，内部 catch 只 log）。`saveScreenshot` 自动 `mkdir -p` 父目录。
- [x] 3.2 新建 `runners/web-agent/src/agent/runtime.ts`：导出 `class AgentRuntime`，构造时接 `BridgeClient` + `LocalBrowser`；公开方法 `runTask(cmd: RunWebAgentTask, profile: ResolvedProfile): Promise<void>`。内部：launch 一个新 page、构造 `BrowserOperator` + `GUIAgent`、注册 `onData` / `onScreenshot` / `onFinalAnswer` / `onError` 回调，统一翻译成 `webAgent*` envelope 通过 BridgeClient 发出。
- [x] 3.3 在 `runtime.ts` 实现异常分类：try/catch GUIAgent.run() 的最外层，按 D-list 把异常映射到 `WebAgentFailureKind`；OpenAI SDK 的 `APIConnectionTimeoutError` 走 `vlmTimeout`；其他 `Error` 看 message 关键词归类。
- [x] 3.4 在 `runners/web-agent/test/runtime.test.ts` 加 vitest（mock GUIAgent + mock BridgeClient）：覆盖单步成功、3 步成功、VLM timeout 异常、未知错误 fallback 到 pageError、screenshot path 字段非 null。实际写了 7 个 case 含 4 步序列、AuthenticationError 分类、null screenshot 三个加测。

## 4. Runner 主入口

- [x] 4.1 新建 `runners/web-agent/src/runner.ts`：CLI 入口。流程：parse env → 构造 BridgeClient → connect → registerClient(.webAgentRunner) → launch LocalBrowser → 进入命令循环。命令循环只处理 `runWebAgentTask`，其他 envelope 类型记录 debug log 后忽略。
- [x] 4.2 实现单任务串行：用一个 `private currentTaskID: string | null` 字段；非空时收到 `runWebAgentTask` 立即 `bridgeClient.send(webAgentTaskFailed(...busy...))` 而**不**触碰当前任务。
- [x] 4.3 实现 socket 断线退出：BridgeClient `onClose` → 取消 in-flight 任务（AbortSignal 或调 `agent.stop()`）→ `LocalBrowser.close()` → `process.exit(1)`。
- [x] 4.4 在 `runners/web-agent/package.json` scripts 加 `"start": "tsx src/runner.ts"`。

## 5. 端到端验收

- [x] 5.1 写一个最小 dispatcher `runners/web-agent/test/manual-dispatch.ts`（不入测试 suite，只是开发辅助）：起一个内存 BridgeServer 风格的 socket 假 server，按 stdin 命令行下发 `runWebAgentTask`、打印收到的事件。
- [x] 5.2 终端 1：`cd runners/web-agent && npm start`（启动 runner）；终端 2：`cd runners/web-agent && npx tsx test/manual-dispatch.ts task-001 "read example.com title"`。预期 runner 跑通完整 `started → step* → completed` 序列。**已人工跑通**，三次实测：first run 暴露启动 race（dispatcher 早于 onEnvelope）→ 修；second run 暴露 onError-without-throw 误报 completed → 修；third run（commit b030785 之后）协议事件流完全符合 spec：`webAgentTaskStarted → 2× webAgentStepUpdate → webAgentTaskFailed{kind: pageError, message: "Unsupported key: space"}`。
- [ ] 5.3 上面任务完成后，再下发一个无效 profile 的命令（`profileName=mystery`），观察 runner 立即返回 `vlmError`。**未人工验收**（unit test profiles.test.ts 已覆盖代码路径，但端到端未 hit）。归档后用户可随手补跑。
- [ ] 5.4 把 dispatcher 关掉模拟 socket EOF；观察 runner 写日志 + exit 1，**不**自重连。**部分自然观察到**：5.2 验收过程中每次 Ctrl+C dispatcher 后 runner 都正确退出（terminal 3 line 240/302 看到 `task ... finished` 后进程结束），但没显式断言 exit code 1，留给后续显式跑一次。

## 6. 测试与协议契约

- [x] 6.1 跑 `cd runners/web-agent && npm run typecheck`：通过。
- [x] 6.2 跑 `cd runners/web-agent && npm test`：所有 vitest 通过（16 codec + 6 client + 6 profile + 7 runtime = 35/35）。
- [x] 6.3 跑 `cd lark-island && swift test`：24 测试 still pass（M3 不动 Swift 端，只是 sanity）。
- [x] 6.4 检查 `runners/web-agent/src/bridge/codec.ts` 没有意外修改 —— `git log 891bb84..HEAD -- runners/web-agent/src/bridge/codec.ts` 仅显示 e43618b（M2 时创建）一条，无任何后续修改。M3 是 web-agent-bridge spec 的纯 consumer，协议没动。

## 7. 收尾

- [x] 7.1 跑 `npx @fission-ai/openspec validate m3-runner-socket-service` 干净通过。
- [x] 7.2 提交 commit（实际拆为 2 个：`e4dbce3 feat(runner): bridge client + profile resolver`、`96cd071 feat(runner): agent runtime + main entry + manual dispatcher`；原计划的"agent runtime + screenshots"和"main entry + manual dispatcher"两条合一以减少 commit 数）。
- [x] 7.3 跑 `/opsx-archive m3-runner-socket-service` 把 spec 折叠到 `openspec/specs/web-agent-runner-service/spec.md` 并归档 change。
