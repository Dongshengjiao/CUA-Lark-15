# 任务：m3-runner-socket-service

## 1. Bridge 客户端层

- [ ] 1.1 新建 `runners/web-agent/src/bridge/client.ts`：基于 Node `node:net` 的 Unix domain socket 客户端类 `BridgeClient`，提供 `connect(socketPath)` / `send(envelope: BridgeEnvelope)` / `onEnvelope(handler)` / `onClose(handler)` / `close()` 接口；内部用 stream 累积 byte 直到 `\n` 边界，再交给 `decodeEnvelope()`。
- [ ] 1.2 在 `BridgeClient.connect()` 内部实现握手：连接成功后 await 一帧 `BridgeHello` envelope，校验 `protocolVersion === 2`，否则 reject 一个 `BridgeProtocolMismatchError`。
- [ ] 1.3 在 `runners/web-agent/src/bridge/index.ts` re-export `BridgeClient` 和新 error 类型。
- [ ] 1.4 在 `runners/web-agent/test/bridge.test.ts` 加 `BridgeClient` 端到端测试：用 Node `net.createServer` 起一个内存 server、跑 hello 握手、发送命令、收事件。覆盖 hello v1 mismatch 退出路径。

## 2. Profile 解析层

- [ ] 2.1 新建 `runners/web-agent/src/profiles/index.ts`：导出 `resolveProfile(name: string | null | undefined): ResolvedProfile | ProfileResolutionError`。`ResolvedProfile` = `{baseURL, apiKey, model, family}`。
- [ ] 2.2 实现 `qwen-default` 路径：从 `process.env.DASHSCOPE_API_KEY` 读 key；空字符串 / undefined 视为缺失。
- [ ] 2.3 实现 unknown profile 与 missing key 两条 error 路径，每条返回带 `kind: "vlmError"` 字段的 `ProfileResolutionError`，方便 caller 直接转 `webAgentTaskFailed`。
- [ ] 2.4 在 `runners/web-agent/test/profiles.test.ts` 加 vitest：4 个 case（默认 + null + 缺 key + 未知名）。

## 3. Agent runtime 层

- [ ] 3.1 新建 `runners/web-agent/src/agent/screenshots.ts`：导出 `screenshotPathFor(taskID, stepIndex)` + `saveScreenshot(base64, path): void`（fire-and-forget，内部 catch 只 log）。`saveScreenshot` 自动 `mkdir -p` 父目录。
- [ ] 3.2 新建 `runners/web-agent/src/agent/runtime.ts`：导出 `class AgentRuntime`，构造时接 `BridgeClient` + `LocalBrowser`；公开方法 `runTask(cmd: RunWebAgentTask, profile: ResolvedProfile): Promise<void>`。内部：launch 一个新 page、构造 `BrowserOperator` + `GUIAgent`、注册 `onData` / `onScreenshot` / `onFinalAnswer` / `onError` 回调，统一翻译成 `webAgent*` envelope 通过 BridgeClient 发出。
- [ ] 3.3 在 `runtime.ts` 实现异常分类：try/catch GUIAgent.run() 的最外层，按 D-list 把异常映射到 `WebAgentFailureKind`；OpenAI SDK 的 `APIConnectionTimeoutError` 走 `vlmTimeout`；其他 `Error` 看 message 关键词归类。
- [ ] 3.4 在 `runners/web-agent/test/runtime.test.ts` 加 vitest（mock GUIAgent + mock BridgeClient）：覆盖单步成功、3 步成功、VLM timeout 异常、未知错误 fallback 到 pageError、screenshot path 字段非 null。

## 4. Runner 主入口

- [ ] 4.1 新建 `runners/web-agent/src/runner.ts`：CLI 入口。流程：parse env → 构造 BridgeClient → connect → registerClient(.webAgentRunner) → launch LocalBrowser → 进入命令循环。命令循环只处理 `runWebAgentTask`，其他 envelope 类型记录 debug log 后忽略。
- [ ] 4.2 实现单任务串行：用一个 `private currentTaskID: string | null` 字段；非空时收到 `runWebAgentTask` 立即 `bridgeClient.send(webAgentTaskFailed(...busy...))` 而**不**触碰当前任务。
- [ ] 4.3 实现 socket 断线退出：BridgeClient `onClose` → 取消 in-flight 任务（AbortSignal 或调 `agent.stop()`）→ `LocalBrowser.close()` → `process.exit(1)`。
- [ ] 4.4 在 `runners/web-agent/package.json` scripts 加 `"start": "tsx src/runner.ts"`。

## 5. 端到端验收

- [ ] 5.1 写一个最小 dispatcher `runners/web-agent/test/manual-dispatch.ts`（不入测试 suite，只是开发辅助）：起一个内存 BridgeServer 风格的 socket 假 server，按 stdin 命令行下发 `runWebAgentTask`、打印收到的事件。
- [ ] 5.2 终端 1：`cd runners/web-agent && npm start`（启动 runner）；终端 2：`cd runners/web-agent && npx tsx test/manual-dispatch.ts task-001 "read example.com title"`。预期 runner 跑通完整 `started → step* → completed` 序列。
- [ ] 5.3 上面任务完成后，再下发一个无效 profile 的命令（`profileName=mystery`），观察 runner 立即返回 `vlmError`。
- [ ] 5.4 把 dispatcher 关掉模拟 socket EOF；观察 runner 写日志 + exit 1，**不**自重连。

## 6. 测试与协议契约

- [ ] 6.1 跑 `cd runners/web-agent && npm run typecheck`：通过。
- [ ] 6.2 跑 `cd runners/web-agent && npm test`：所有 vitest（既有 16 + 新加约 12）通过。
- [ ] 6.3 跑 `cd lark-island && swift test`：24 测试 still pass（M3 不动 Swift 端，只是 sanity）。
- [ ] 6.4 检查 `runners/web-agent/src/bridge/codec.ts` 没有意外修改 —— M3 是 web-agent-bridge spec 的纯 consumer，不能改协议。

## 7. 收尾

- [ ] 7.1 跑 `npx @fission-ai/openspec validate m3-runner-socket-service` 干净通过。
- [ ] 7.2 提交 commit（建议拆 3 个：`feat(runner): bridge client + profile resolver`、`feat(runner): agent runtime + screenshots`、`feat(runner): main entry + manual dispatcher`）。
- [ ] 7.3 跑 `/opsx-archive m3-runner-socket-service` 把 spec 折叠到 `openspec/specs/web-agent-runner-service/spec.md` 并归档 change。
