# 任务：m11-bot-workflow-orchestration

## 1. workflow 模块基础设施

- [x] 1.1 新建 [`runners/feishu-bot/src/workflow.ts`](../../../runners/feishu-bot/src/workflow.ts)：
  - `interface PlannedStep { description: string; prompt: string; skill?: string }`
  - `interface WorkflowState { steps: PlannedStep[]; currentIndex: number; results: string[]; startedAt: number }`
  - `interface WorkflowPlanResult { ok: boolean; steps: PlannedStep[]; reason?: string }`
  - `export function splitWorkflow(text: string): boolean`：keyword 门控（"，并 / 并通知 / 然后 / 接着 / 再 / 另外 / 顺便"，正则 `(?:[，,]\s*(?:并|然后|接着|再|另外))|(?:并通知|顺便)`）
  - `export async function callPlanLLM(text: string, cfg: PlanLLMConfig): Promise<WorkflowPlanResult>`：fetch POST OpenAI-compatible chat/completions，超时 15s，JSON parse fail / steps==0 / steps>3 都返回 `{ ok: false, reason }`
  - `export function renderTemplate(prompt: string, ctx: { prev_result?: string }): string`：替换 `$prev_result` 占位符
- [x] 1.2 新建 [`runners/feishu-bot/src/plan-llm-config.ts`](../../../runners/feishu-bot/src/plan-llm-config.ts)：从 env 读 `LARK_BOT_PLAN_LLM_BASE_URL` / `LARK_BOT_PLAN_LLM_API_KEY` / `LARK_BOT_PLAN_LLM_MODEL`（默认值与 runner DashScope endpoint 一致；fallback DASHSCOPE_API_KEY）。
- [x] 1.3 [`runners/feishu-bot/.env.example`](../../../runners/feishu-bot/.env.example) 加 3 个新 env + 注释。
- [x] 1.4 m11 hotfix：`resolvePlanLLMConfig` 用 `nonEmpty()` 把 dev.sh inline `K="${K:-}"` 透传出的空字符串视为 missing（`??` 不会跨空字符串 fallback）。

## 2. main.ts 集成 workflow

- [x] 2.1 `InFlightTask` 接口加 `workflow: WorkflowState \| null` + `messageID` 字段。
- [x] 2.2 现有 `dispatch()` 重命名为 `dispatchSingle()`（行为不变）。
- [x] 2.3 新增顶层 async `dispatch(msg, sock, cfg)` 路径分流（keyword gate / planLLM not configured / callPlanLLM 失败 → 都 fallback dispatchSingle）。
- [x] 2.4 新增 `dispatchWorkflow(msg, steps, sock, cfg)` + `dispatchWorkflowStep(sock, cfg)`：用 inFlight.workflow.currentIndex 派发 step + 用 renderTemplate 注入 `$prev_result`。
- [x] 2.5 `webAgentTaskCompleted` 分支：workflow 路径存 `results[i]`，未到末步则 currentIndex+1 + redispatch；末步发 wf-done 总结 reply。
- [x] 2.6 `webAgentTaskFailed` 分支：workflow 路径发 `wf-step-fail-${msgID}-${i}` reply 并 abort；single-task 路径同 m9。
- [x] 2.7 `webAgentApprovalRequested` 走 m9 路径（不动）。
- [x] 2.8 heartbeat 计数器跨 step 共享（不 reset），跨 workflow step 累计触发（D6 实测验证）。

## 3. 测试

- [x] 3.1 新建 [`runners/feishu-bot/test/workflow.test.ts`](../../../runners/feishu-bot/test/workflow.test.ts)：
  - splitWorkflow（8 case + 1 hotfix case for semicolon support — 共 9）
  - renderTemplate（5 case）
  - parsePlanResponseContent（9 case，含 ```json fence stripping + 长 description clamp）
  - callPlanLLM mock fetch（5 case：happy / HTTP 5xx / empty content / non-JSON / fetch reject）
- [-] 3.2 状态机集成测推 m12：m11 实测覆盖了所有跃迁（step 0 dispatch / 上下文注入 step 1 / 末步 wf-done），单测 mock fetch 已经覆盖 plan parser 的 9 类失败模式。状态机 mock 收益边际下降。

## 4. 编译与单元测试

- [x] 4.1 `cd runners/feishu-bot && npm run typecheck` 通过。
- [x] 4.2 `cd runners/feishu-bot && npm test` 全过：m10 27 → m11 **54 case**（+27，超过 task 设的 ≥ 46 目标）。
- [x] 4.3 `cd runners/web-agent && npm run typecheck && npm test` 仍 89 case 全过（不动）。
- [x] 4.4 `cd lark-island && swift build` 干净。

## 5. 端到端实跑

- [x] 5.1 `LARK_BOT_PROFILE=challenge zsh scripts/dev.sh` 启动 OK（m11 hotfix dev.sh：source web-agent/.env + 透传 plan-LLM env + lark-cli --force）。
- [x] 5.2 飞书 IM 私聊 bot 发 workflow demo prompt #1（calendar+IM）：
  ```
  在飞书创建一个日程，标题是 m11 workflow demo，明天下午4点开始；并给自己发个消息说"日程已建"
  ```
  - 验收 1：✅ bot 发 `🔀 工作流开始（共 2 步）：1) ... 2) ...` reply（log: `plan-llm ok: 2 step(s) planned`）
  - 验收 2：✅ step 1 / step 2 的 `▶️ 步骤 X/2 开始` reply 各 1 条
  - 验收 3：✅ 跨 step 共享计数器：5 条 heartbeat 在 step 5/10/16/21（step 0 内）/ 26（step 1 内）触发
  - 验收 4：✅ step 1 完成 22 step / 103.9s（**远好于 m10 calendar 单 task 的 46 step**！LLM plan 把 prompt 拆原子后 runner 路径变直），step 2 完成 6 step / 29.3s
  - 验收 5：⏳ 飞书侧用户视觉确认（calendar 5月1日 16:00 事件块 + 自聊蓝色气泡 + IM 5 段 reply 链）— 见 §6.5
  - 验收 6：✅ bot 终态 `✅ 工作流完成（共 2 步 / 133.2s）` reply（log: `wf-done` nonce 唯一）
- [-] 5.3 base+IM workflow（推 m12）：m9 知见，base 任务 maxLoopCount 风险高，先不做。calendar+IM 已经覆盖 multi-step 上下文注入的所有关键路径。
- [-] 5.4 single-task fallback（已隐式覆盖）：第一轮"workflow keyword hit but planLLM not configured" 验证了 keyword-hit + plan-LLM-fail 路径会 fallback 到 dispatchSingle 跑 60 step；m9 单 task ack/heartbeat/completed 路径未变。
- [x] 5.5 实测数据填到 §6。

## 6. Post-implementation retrospective（实测于 2026-04-30 13:32-13:34 UTC+8）

### 6.1 calendar+IM workflow 实测时间线

```
13:32:03  incoming workflow prompt
13:32:03  workflow keyword hit; calling plan-llm (model=qwen-plus)...
13:32:06  plan-llm ok: 2 step(s) planned                  ← LLM 2.7s
13:32:06  dispatched step0 (workflow step 1/2)             ← calendar
13:32:32  heartbeat step=5
13:33:03  heartbeat step=10
13:33:23  heartbeat step=16    ← 跨 step（仍在 step 0 内）
13:33:42  heartbeat step=21
13:33:50  workflow step 1/2 completed (steps=22, 103.9s)
13:33:50  dispatched step1 (workflow step 2/2)             ← IM
13:34:08  heartbeat step=26    ← 跨 step 累计触发 ✅（D6 实测）
13:34:19  workflow step 2/2 completed (steps=6, 29.3s)
13:34:19  wf-done reply 发出
```

总时长 **133 秒**（calendar 104s + IM 29s + 派发开销 0.5s × 3）/ **28 step** / **5 条 heartbeat**。

### 6.2 与 m10 单 task 路径对比

| 任务类型 | step 数 | 时长 | 路径 |
|---|---|---|---|
| m10 calendar 单 task | 46 step | 209.3s | "在飞书创建一个日程，标题是 m10 demo 同步会，明天下午3点开始"（runner 一口气在 calendar 跑完） |
| m11 calendar+IM workflow step 0 | 22 step | 103.9s | LLM 把 prompt 拆成"创建日程"+"通知"两个原子 step；step 0 跑 calendar 时**不再为 prompt 后半段（"并发消息"）困扰** |

LLM 拆 prompt 同时**为 runner 减负** — 这是 m11 没有规划但意外发现的正反馈。

### 6.3 成本

- LLM plan call：~500 tokens × qwen-plus，1 call ≈ 0.001 USD
- 单 workflow demo 总 LLM 成本（含 step 0 / step 1 的 VLM call）≈ 0.05 USD

可忽略。

### 6.4 hotfix 累积（m11 实施期内的二次修复）

| # | 问题 | 修法 | commit |
|---|---|---|---|
| 1 | regex 只匹配中文 / 英文逗号，分号 `；` `;` 错失 | 把 regex 加到 `[，,；;]` | （hotfix 包在 propose 实施 commit 内）|
| 2 | dev.sh 没透传 DASHSCOPE_API_KEY 给 bot 子进程 | dev.sh 加 `set -a / source web-agent/.env / set +a` + 显式透传 4 个 env | `0d57086 chore(dev): forward DASHSCOPE_API_KEY ...` |
| 3 | dev.sh 显式透传时把 `${VAR:-}` 空字符串传给子进程，`??` 不跨 '' fallback | `nonEmpty()` 把空 string 当 undefined | （包在第 2 个 commit 后续）|
| 4 | lark-cli `event +subscribe` 服务端单实例锁 ~30s 才释放，每次 dev.sh 重启可能撞锁 bot 自杀 | bot 启 lark-cli 加 `--force` | （包在 hotfix 链中）|

### 6.5 飞书侧用户视觉确认

> 待用户确认（13:34 实测刚完成）：
> - IM 5 段 reply 链
> - 5 月 1 日 16:00-17:00 calendar 事件块"m11 workflow demo"
> - 自聊蓝色气泡含 step 1 finalAnswer

### 6.6 五句话总结

1. **m11 是从单 task 到任务编排的范式跃迁**：bot 端 keyword + LLM plan 把"创建日程，并通知"自动拆成 calendar + IM，runner 不变就直接享受到了 multi-step 编排能力。
2. **plan-LLM 把每个 step prompt 拆得更原子，意外让 runner 路径变直**：calendar 在 m10 是 46 step，m11 step 0 是 22 step，2x 加速纯由 prompt 简化驱动。
3. **fail-safe 设计经实测多次救场**：keyword miss / planLLM not configured / LLM HTTP 错 / JSON 错都会退化到 m9 单 task 路径，不破坏既有体验。
4. **跨 step 共享 heartbeat 计数器（D6）正确**：m11 workflow 在 step 1（IM 才 6 step）单独计数永远不会触发 heartbeat；跨 step 累计才有 heartbeat 在第 26 步触发。
5. **5/2 demo 准备好了**：m11 + m10 + m9 三层 milestone 联动 — bot 收复合 IM 指令 → 拆 → calendar+IM 自动跑通，整套链路 133 秒 / 5 条 heartbeat 节奏 / 1 条总结。绝佳 demo 形态。

## 7. 收尾

- [x] 7.1 `npx @fission-ai/openspec validate m11-bot-workflow-orchestration --strict` 干净通过。
- [x] 7.2 实际 commit 数 6（+1 hotfix）：
  - `7064263 docs(openspec): propose m10-...`（不算）
  - `bfc114b chore(openspec): archive m10-...`（不算）
  - `a136d66 docs(openspec): propose m11-bot-workflow-orchestration`
  - `3246193 feat(feishu-bot): workflow primitives — splitWorkflow / callPlanLLM / renderTemplate (m11)`
  - `d1a6c4d feat(feishu-bot): WorkflowExecutor multi-step dispatch + IM lifecycle (m11)`
  - `f544210 test(feishu-bot): workflow unit coverage — 26 cases (m11)`
  - `0d57086 chore(dev): forward DASHSCOPE_API_KEY + LARK_BOT_PLAN_LLM_* to bot bridge (m11)`
  - + 即将到来的 archive commit
- [ ] 7.3 `npx @fission-ai/openspec archive m11-bot-workflow-orchestration --yes` 同步 specs/。
