# 设计：M11 — bot bridge 联动工作流编排

## 背景（Context）

m10 archive 后立项；5/2 demo 截止剩 ~46 小时（含休息）。m6-m10 已经把"飞书 IM → 单 skill"链路跑通到 ✅，下一步对 demo 价值倍增的关键是"多步任务串联"——用户发**复合指令**（"创建日程 X，并通知 Y"），bot 自动拆解 + 顺序派发 + 上下文传递。

涉及方：钟梓文（master plan §5 主链 + UI）。本 milestone 完后 demo 现场可以演示：

> 在飞书 IM bot 处发："创建一个日程'项目同步会'明天下午3点，并给自己发消息确认日程已建好"
> bot 拆解 → 派 calendar 任务跑完 → 拿 finalAnswer 注入 IM 任务 → 派 IM 任务跑完 → 总结 reply。

是 m6-m10 各项能力的"集大成展示"。

约束：
- 不动 BridgeServer / runner / 协议 / island UI（与 m10 保持一致：bot 是纯 IPC 客户端）。
- LLM plan call 必须 fail-safe：模型挂 / JSON 错 / 步骤超出 → 退化为单 task。
- workflow 跨步骤的 IM 通知必须节制（每步切换 1 条进度 + heartbeat 节流不变），demo 期一个 2-3 步 workflow 总 IM 消息控制在 5-7 条。
- 单 task 路径必须**完全保留**——99% 的 m9 单 task 用例在 m11 必须仍正常工作。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**
- bot bridge 端到端跑通 ≥ 2 步 workflow demo（calendar+IM 串联，base+IM 串联可选）
- workflow 跑期间用户在 IM 端能看到"工作流开始 → 步骤 1 开始 → 步骤 1 完成 → 步骤 2 开始 → 步骤 2 完成 → 工作流总结"清晰链路
- LLM plan call 失败 / JSON 错时退化为 m9 单 task 路径，bot 不卡死
- m9 心跳节流 + m9 inFlightTask 锁 + m9 白名单**全部仍生效**

**非目标：**
- 不做 reflection / replan / branching loop（m12+ 范围）
- 不做 user-in-the-loop confirm
- 不在灵动岛 UI 上展示 workflow 进度（demo 用 IM 信道展示就够）
- 不优化 calendar 步数（m12+）
- 不增加 RunnerSupervisor / mock harness（m12+）

## 关键决策（Decisions）

### D1：splitWorkflow 用 "keyword gate + LLM call" 双层

```ts
function splitWorkflow(text: string): boolean {
  // Cheap pre-filter — only spend an LLM call if we see hints.
  const conj = /([，,]\s*(并|然后|接着|再|另外))|(并通知|顺便)/;
  return conj.test(text);
}
```

```ts
async function callPlanLLM(text: string): Promise<PlanResult> { ... }
```

- 单字符串、单条件 keyword 检测（成本 ~0）。命中才花一次 LLM 钱。
- LLM call 用 OpenAI-compatible JSON mode（响应 ~500ms）。

考虑过：
- **每个 prompt 都先过 LLM**：reject。常见单 task ("hello", "在飞书发消息 X") 不需要拆，LLM 反而可能瞎拆 1 步成 2 步浪费时间。
- **纯 LLM-driven 不要 keyword gate**：reject。同上。
- **纯 keyword-driven 不要 LLM**：reject。keyword 命中后还需要把 prompt 拆成具体的 step prompt + skill 提示，这个映射不写死，需要 LLM 灵活处理。

### D2：plan LLM prompt 固定 1-3 步上限

```
You are a Feishu workflow planner. Given a Chinese / English instruction
that bundles 2-3 actions, output STRICT JSON of the form:

{
  "steps": [
    {"description": "<≤30 char Chinese gerund>", "prompt": "<atomic action>"},
    ...
  ]
}

Rules:
- Output ≤ 3 steps. If you can't cleanly split, output {"steps": []}.
- Each step.prompt is what a Feishu web-agent receives as a single skill
  task. Phrase it so it's actionable in isolation.
- You may use the placeholder $prev_result inside step.prompt[i>0] to
  reference step[i-1] finalAnswer.
- DO NOT include any commentary outside the JSON.
- DO NOT call tools.
```

3 步上限：
- 大部分有用的复合指令是 2 步（"做 X 并通知 Y"）。3 步 (calendar + IM + Base) 也覆盖。
- 上限避免 model 把 "在飞书发条消息" 拆成 5 步 micro-actions。
- 超 3 步 → fallback single task（保守）。

考虑过：
- **不限制步数 + reflection**：m12+ 范围。
- **预定义模板**（"calendar+IM" / "base+IM"）：reject。让 model 灵活处理意外组合（比如 "创建文档 X 并通知 Y" 也应自动 work）。

### D3：上下文注入用 `$prev_result` 占位符

step 2 prompt 模板示例（LLM 输出）：

```json
{"description": "通知确认", "prompt": "在飞书给自己发条消息确认日程已建好：$prev_result"}
```

执行 step 2 前 `renderTemplate(step.prompt, { prev_result: step1FinalAnswer })`：

```ts
function renderTemplate(prompt: string, ctx: Record<string, string>): string {
  return prompt.replace(/\$prev_result\b/g, ctx.prev_result ?? '');
}
```

考虑过：
- **结构化字段提取**（从 step 1 finalAnswer 抠出 calendar URL）：reject。需要再过一次 LLM，复杂度倍增。占位符全文兜底简单稳定。
- **LLM 自己写好上下文**（不用占位符）：reject。LLM 在 plan 阶段不知道 step 1 真实 finalAnswer，写不出来。占位符是延后绑定的正确方式。

### D4：workflow 状态在 bot bridge 内 multiplex 多个 runWebAgentTask

```ts
interface WorkflowState {
  steps: PlannedStep[];
  currentIndex: number;
  results: string[]; // results[i] = finalAnswer of step i
  startedAt: number;
}

inFlight: { ..., workflow?: WorkflowState }
```

- bot bridge 维护 workflow 状态，runner 仍是单 task / single inFlightTask 的模型。
- runner 视角看不到 workflow 概念（每个 step 是独立的 runWebAgentTask，taskID 包含 step index：`feishu-bot-<msgID>-step<i>`）。
- BridgeServer 视角不需要变更。

考虑过：
- **runner 端实现 workflow**：reject。runner 当前的设计就是单 task GUIAgent loop，加 workflow 会污染单 task 抽象。
- **新增 BridgeServer envelope `runWorkflow`**：reject。协议变更代价高 + island UI 也要相应变更。bot bridge 内 multiplex 是最低代价方案。

### D5：每步切换发 IM reply 节制规则

| 时机 | IM 文案 | nonce |
|---|---|---|
| splitWorkflow 命中 + plan ok | `🔀 工作流开始（共 X 步）：\n1) <desc1>\n2) <desc2>` | `wf-start-<msgID>` |
| 派发 step i 前 | `▶️ 步骤 i/N 开始：<desc>` | `wf-step-start-<msgID>-<i>` |
| 任一步 fail | `❌ 工作流第 i 步失败（<kind>）：<message>` | `wf-step-fail-<msgID>-<i>` |
| 全部完成 | `✅ 工作流完成（共 X 步 / Ys）\n• 步骤 1: <result1>\n• 步骤 2: <result2>` | `wf-done-<msgID>` |
| 单步内 heartbeat | m10 行为不变（5 step + 15s）| `heartbeat-<taskID>-<stepIndex>` |
| 单步 webAgentTaskCompleted | **不**单独发 reply（避免和 wf-step-start 重复刷屏）。结果存入 results[] 等总结 reply 一次性出 | — |

m9 single-task 路径仍然在 step 完成时单独发 finalAnswer reply。workflow 路径下 step 完成不发，由 wf-done 一次出全。

### D6：heartbeat 计数器跨 workflow step 共享 vs 重置

**决定：跨 step 共享**（不重置）。

理由：用户视角看到的是"任务持续多长时间没回应"，跨 step 无差异。如果每 step 重置，2 步 workflow 每步 5-9 step 时连一条 heartbeat 都触发不了，feature 失效。

实现：

```ts
inFlight = {
  ...,
  totalSteps: 0,            // 跨 workflow step 累计
  lastHeartbeatStep: 0,
  lastHeartbeatAt: 0,
}
```

`workflow.currentIndex` 切换时**不**清这三个字段。

### D7：fallback 路径 fail-safe

```ts
async function dispatch(msg, sock, cfg) {
  if (!splitWorkflow(msg.text)) return dispatchSingle(msg, sock, cfg);
  const plan = await callPlanLLM(msg.text);
  if (!plan.ok || plan.steps.length === 0 || plan.steps.length > 3) {
    log('warn', `workflow plan fallback: ${plan.reason ?? 'empty/oversize'}`);
    await replyText({ ..., text: '工作流意图识别失败，作为单任务执行', nonce: ... });
    return dispatchSingle(msg, sock, cfg);
  }
  return dispatchWorkflow(msg, plan.steps, sock, cfg);
}
```

任何阶段 fail 就退到单 task。最大原则：m11 的功能扩展不能破坏 m9 已经稳的单 task 路径。

## 风险 / 取舍（Risks / Trade-offs）

- **LLM plan call 增加 ~500ms 首次响应延迟**：keyword gate 命中时才付出，一般用例无影响。
- **跨 step 上下文用 `$prev_result` 全文注入** 而非结构化字段，会让 step 2 prompt 包含较长背景文本（如"已创建日程 项目同步会..."整段）。这对 web-agent runner 跑 step 2 来说仍可解析（`feishu_im_send` skill 的 prompt 容忍长文本）；但 IM 任务的 maxLoopCount 不变，长上下文偶尔可能让 VLM 多绕 1-2 step。可接受。
- **2 步 workflow 总时长 3-5 分钟**：体验上 heartbeat 节流帮一些，但仍需 demo 期反复测试节奏。如果实测发现"沉默太久"还可以加 `▶️ 步骤 X 中` 的细粒度变化（m11 不做，留 hotfix）。
- **workflow 期间用户连发新 prompt** 仍走 m9 inFlightTask 锁逻辑（busy reply）。workflow.currentIndex == steps.length 后 inFlight=null 重置。
- **plan LLM 的 cost** 每个 workflow 命中触发 ~500 tokens × 一次 call，demo 期整夜 0.01 USD 量级，可忽略。

## 迁移计划（Migration Plan）

1. 新建 `runners/feishu-bot/src/workflow.ts`：`splitWorkflow`、`callPlanLLM`、`renderTemplate`、`WorkflowState` 类型。
2. 改 `runners/feishu-bot/src/main.ts`：`InFlightTask.workflow` 字段；`dispatch` 路径分流；`handleBridgeEvent.webAgentTaskCompleted` 加 workflow next-step 派发分支；`handleBridgeEvent.webAgentTaskFailed` 加 workflow abort 分支。
3. 新建 `runners/feishu-bot/test/workflow.test.ts`：覆盖 keyword detection（5 case）、plan parser fallback（3 case）、template render（4 case）、executor state transitions（5 case）、跨 step heartbeat（2 case）。
4. typecheck + npm test 全过；m9 既有 27 case + m11 新 ~19 case。
5. swift build 不变。
6. dev.sh 加 plan LLM env 透传（如需）；README 加 m11 段。
7. 实跑 2 个 workflow demo prompt（calendar+IM、base+IM），验收每步落地 + 上下文注入生效。
8. 失败回滚：revert m11 commit 链 → m10 archive 状态。

## 待解决问题（Open Questions）

1. **plan LLM 走哪个 endpoint**：runner 当前走 OpenAI-compatible 火山方舟接口（qwen3-vl-plus）。bot bridge 复用同样 base_url 还是单独配？目前倾向复用 env `LARK_BOT_PLAN_LLM_*` 但默认值与 runner profile 一致（避免重复配置）。
2. **plan LLM 用 reasoning model 还是普通 chat model**：m11 用普通 chat model（qwen3 chat 或 deepseek-chat），latency ~500ms。reasoning model 太慢（10+ s）破坏 IM 体验。
3. **workflow 期间 calendar step 跑 46 step 是否触发 maxLoopCount 兜底**：m9/m10 的 maxLoopCount 是 30/run，46 step 实际是 step events 数（含截图 step），VLM action step 大约一半。runner 的 maxLoopCount 是 action step 数。**待 m11 实测**确认 workflow 跑 calendar+IM 时 calendar step 不超时。
