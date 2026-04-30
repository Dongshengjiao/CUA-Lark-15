# 任务：m11-bot-workflow-orchestration

## 1. workflow 模块基础设施

- [ ] 1.1 新建 [`runners/feishu-bot/src/workflow.ts`](../../../runners/feishu-bot/src/workflow.ts)：
  - `interface PlannedStep { description: string; prompt: string; skill?: string }`
  - `interface WorkflowState { steps: PlannedStep[]; currentIndex: number; results: string[]; startedAt: number }`
  - `interface WorkflowPlanResult { ok: boolean; steps: PlannedStep[]; reason?: string }`
  - `export function splitWorkflow(text: string): boolean`：keyword 门控（"，并 / 并通知 / 然后 / 接着 / 再 / 另外 / 顺便"，正则 `(?:[，,]\s*(?:并|然后|接着|再|另外))|(?:并通知|顺便)`）
  - `export async function callPlanLLM(text: string, cfg: PlanLLMConfig): Promise<WorkflowPlanResult>`：fetch POST OpenAI-compatible chat/completions，超时 15s，JSON parse fail / steps==0 / steps>3 都返回 `{ ok: false, reason }`
  - `export function renderTemplate(prompt: string, ctx: { prev_result?: string }): string`：替换 `$prev_result` 占位符
- [ ] 1.2 新建 [`runners/feishu-bot/src/plan-llm-config.ts`](../../../runners/feishu-bot/src/plan-llm-config.ts)：从 env 读 `LARK_BOT_PLAN_LLM_BASE_URL` / `LARK_BOT_PLAN_LLM_API_KEY` / `LARK_BOT_PLAN_LLM_MODEL`（默认值与 runner 火山方舟兼容 endpoint 一致）。
- [ ] 1.3 [`runners/feishu-bot/.env.example`](../../../runners/feishu-bot/.env.example) 加 3 个新 env + 注释。

## 2. main.ts 集成 workflow

- [ ] 2.1 [`runners/feishu-bot/src/main.ts`](../../../runners/feishu-bot/src/main.ts) `InFlightTask` 接口加 `workflow?: WorkflowState | null` 字段；初始 null。
- [ ] 2.2 把现有 `dispatch()` 重命名为 `dispatchSingle()`（行为不变）。
- [ ] 2.3 新增顶层 `dispatch(msg, sock, cfg)` 路径分流：
  - `splitWorkflow(msg.text) === false` → `return dispatchSingle(msg, sock, cfg)`
  - 调 `callPlanLLM(msg.text, planLLMCfg)` 拿 `WorkflowPlanResult`
  - `result.ok === false || result.steps.length === 0 || > 3` → 发 fallback IM reply + `dispatchSingle`
  - 否则调 `dispatchWorkflow(msg, plan.steps, sock, cfg)`
- [ ] 2.4 新增 `dispatchWorkflow(msg, steps, sock, cfg)`：
  - 设 `inFlight = { ...common, workflow: { steps, currentIndex: 0, results: [], startedAt: Date.now() }, totalSteps: 0, lastHeartbeatStep: 0, lastHeartbeatAt: 0 }`
  - 发"工作流开始"reply（nonce `wf-start-${msgID}`）
  - 调 `dispatchWorkflowStep(0, sock, cfg)`：
    - 当前 step = `inFlight.workflow!.steps[i]`
    - prevResult = i > 0 ? `inFlight.workflow!.results[i-1]` : ''
    - renderedPrompt = `renderTemplate(step.prompt, { prev_result: prevResult })`
    - 派 `runWebAgentTask{ taskID: msgID-step<i>, prompt: renderedPrompt, skill: step.skill ?? null, profileName }`
    - 发"步骤 i/N 开始"reply（nonce `wf-step-start-${msgID}-${i}`）
- [ ] 2.5 改 `handleBridgeEvent.webAgentTaskCompleted` 分支：
  - 若 `inFlight.workflow == null` → m9 单 task 行为（发 finalAnswer reply）
  - 若 `inFlight.workflow != null`：把 finalAnswer 存 `results[currentIndex]`，
    - `currentIndex+1 < steps.length` → `currentIndex++`，调 `dispatchWorkflowStep(currentIndex)`，**不**发 single-task 终态 reply
    - 否则发"工作流完成"总结 reply（nonce `wf-done-${msgID}`）+ `inFlight=null`
- [ ] 2.6 改 `handleBridgeEvent.webAgentTaskFailed` 分支：
  - 若 `inFlight.workflow == null` → m9 单 task fail 行为
  - 若 `inFlight.workflow != null` → 发"工作流第 i 步失败"reply（nonce `wf-step-fail-${msgID}-${i}`），workflow abort，`inFlight=null`
- [ ] 2.7 `handleBridgeEvent.webAgentApprovalRequested` workflow 期间也支持，行为同 m9（reply 提示扫码 + 不清 inFlight）。
- [ ] 2.8 改 `handleBridgeEvent.webAgentStepUpdate`：heartbeat 计数器**不**因 workflow step 切换而重置（D6）。

## 3. 测试

- [ ] 3.1 新建 [`runners/feishu-bot/test/workflow.test.ts`](../../../runners/feishu-bot/test/workflow.test.ts)：
  - `splitWorkflow`：
    - "在飞书给自己发个消息" → false
    - "创建日程 X，并通知 Y" → true
    - "做 A 然后做 B" → true
    - "做 A，再做 B" → true
    - "Schedule meeting and notify Y" → false（英语 keyword 暂不支持，记 known limitation）
  - `renderTemplate`：
    - 含 `$prev_result` → 替换
    - 不含占位符 → 返回原文
    - prevResult 为空字符串 → 占位符替换为空
    - 多次出现 `$prev_result` → 全部替换
  - `callPlanLLM` mock fetch 测：
    - HTTP 200 + JSON `{steps:[...]}` 合规 → ok: true
    - HTTP 200 + JSON 但 steps 为空 → ok: false
    - HTTP 200 + JSON 但 steps > 3 → ok: false
    - HTTP 200 + 非 JSON → ok: false
    - HTTP 5xx → ok: false
- [ ] 3.2 加 workflow 状态机测试（不调用真 fetch）：
  - executor mock：模拟收 webAgentTaskCompleted 后 `currentIndex` +1，第二个 step prompt 含上一步 finalAnswer
  - executor mock：第二步 fail 后 inFlight cleared，no further dispatch

## 4. 编译与单元测试

- [ ] 4.1 `cd runners/feishu-bot && npm run typecheck` 通过。
- [ ] 4.2 `cd runners/feishu-bot && npm test` 全过：m10 27 → m11 ≥ 46（+19 case workflow）。
- [ ] 4.3 `cd runners/web-agent && npm run typecheck && npm test` 仍 89 case 全过（不动）。
- [ ] 4.4 `cd lark-island && swift build` 干净。

## 5. 端到端实跑

- [ ] 5.1 `LARK_BOT_PROFILE=challenge LARK_FEISHU_TENANT_DOMAIN=jcneyh7qlo8i.feishu.cn zsh scripts/dev.sh` 启动 OK。
- [ ] 5.2 飞书 IM 私聊 bot 发 workflow demo prompt #1（calendar+IM）：
  ```
  在飞书创建一个日程，标题是 m11 workflow demo，明天下午4点开始；并给自己发个消息说"日程已建"
  ```
  - 验收 1：bot 发 "🔀 工作流开始（共 2 步）" reply
  - 验收 2：step 1 / step 2 的 "▶️ 步骤 X/2 开始" reply 各 1 条
  - 验收 3：每步内部触发 ≥ 1 条 m10 heartbeat（计数器跨 step 共享）
  - 验收 4：飞书日历能看到 5月1日 16:00-17:00 "m11 workflow demo" 事件块
  - 验收 5：飞书自聊蓝色气泡里看到机器人发的 "日程已建（含日程信息）" 文本
  - 验收 6：bot 终态 "✅ 工作流完成（共 2 步 / X.Xs）  • 步骤 1: ...  • 步骤 2: ..." reply
- [ ] 5.3 飞书 IM 发 workflow demo prompt #2（base + IM 通知）：
  ```
  在飞书新建一个多维表格，标题为 m11 workflow base 测试，并给自己发个消息通知表已建好
  ```
  - 验收同 5.2 思路；step 1 创建 base + step 2 IM 通知。
- [ ] 5.4 飞书 IM 发 single-task fallback prompt（无 keyword 命中）：
  ```
  在飞书给自己发条消息：m11 fallback 验证
  ```
  - 验收：bot 不发 "🔀 工作流开始" reply，走 m9 单 task 路径；终态 reply 是 m9 风格 ✅。
- [ ] 5.5 实测数据填到本 tasks.md §6。

## 6. Post-implementation retrospective

> 实测后填表 + 写 3-5 句结论。

## 7. 收尾

- [ ] 7.1 `npx @fission-ai/openspec validate m11-bot-workflow-orchestration --strict` 干净通过。
- [ ] 7.2 拆 5 commit：
  - `docs(openspec): propose m11-bot-workflow-orchestration`
  - `feat(feishu-bot): workflow.ts splitWorkflow / callPlanLLM / renderTemplate (m11)`
  - `feat(feishu-bot): WorkflowExecutor multi-step dispatch + IM lifecycle replies (m11)`
  - `test(feishu-bot): workflow integration coverage (m11)`
  - `chore(openspec): archive m11-bot-workflow-orchestration`
- [ ] 7.3 `npx @fission-ai/openspec archive m11-bot-workflow-orchestration --yes` 同步 specs/。
