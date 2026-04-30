## Why

m6-m10 已经把"飞书 IM 入口 → 单 skill 任务"链路打通：用户给 bot 发一条 prompt，runner 跑一个 skill（IM/Calendar/Doc/Base），bot heartbeat + 终态回执。

下一步的 demo 价值断崖式提升的关键，是**多步任务编排**：用户给 bot 发**复合指令**（"创建日程 X，并通知钟梓文-北邮"），bot 自动拆解为 N 个子任务（calendar create + IM send），顺序派给 runner，**带上下文**（步骤 2 的 prompt 引用步骤 1 的 finalAnswer），任一步失败整个工作流就停下并报告。

m11 是 5/2 demo 截止前最后一个有 demo 价值倍增空间的 milestone。其余 backlog（calendar step 压缩、SingletonLock 自动清理、--force 加固）对 demo 加分有限，可以推 m12+。

非范围（推 m12+）：
- 真正的 LLM-driven 通用 plan layer（m11 用 LLM call 但限制在 plan-only，不做 reflection / replan / branching）
- workflow 中间步骤的 user-in-the-loop confirm（"创建日程对吗？" → 确认才发通知）
- Multi-tenant 通用 routing（m10 留 hardcode default，本次不动）
- LarkIslandApp 灵动岛端展示 workflow 进度树（仍走 single-task list 视图）

## What Changes

- **bot bridge 加 `WorkflowExecutor`**
  - 收到 IM 文本消息后先跑 `splitWorkflow(text)` 轻量分析：keyword 门控（"，并 / 并通知 / 然后 / 接着 / 再" 等连接词）。命中 → 走 workflow 路径；不命中 → 走 m9 单 task 路径（保守）。
  - workflow 路径里调一次 LLM plan call（用 runner 的 qwen-default 直连飞书云火山方舟兼容 OpenAI endpoint），prompt 是固定的 system prompt + user prompt，要求 model emit `WorkflowPlan` JSON：`{steps: [{description, prompt, skill?}]}`，1-3 步为限。
  - LLM JSON parse 失败 / steps 为空 / steps 超过 3 步 → 退化为 single task（fail-safe）。
- **顺序派发 + 上下文注入**
  - WorkflowExecutor 对 steps 做顺序派发：派 step 1 → 等 webAgentTaskCompleted（or Failed）→ 把 finalAnswer 存为 `prevResult` → 派 step 2 prompt 用 `${prev_result}` 占位符替换为 step 1 finalAnswer → 等完成 → 派 step 3。
  - 任一步 webAgentTaskFailed → workflow abort + IM reply `❌ 工作流第 X 步失败（<kind>）：<message>`。
- **每步切换发 IM 通知**
  - workflow 起步发 IM `🔀 工作流开始（共 X 步）：1) 描述1  2) 描述2 …`
  - 每步派发前发 `▶️ 步骤 X/Y 开始：<描述>`
  - 终态：所有步骤完成后发 `✅ 工作流完成（X 步 / 共 Ys）  step 1: <finalAnswer>  step 2: <finalAnswer>`
  - heartbeat（m10）继续工作：单 step 内仍然 5-step+15s 节流，**不**因 workflow step 切换重置（计数器跨 step 共享，避免 step 切换瞬间发出多条 heartbeat）。
- **bridge schema 不变**
  - workflow 在 bot bridge 内部完成；BridgeServer / runner / lark-island 三个组件无变更。

## Capabilities

### New Capabilities

无（workflow 是 bot bridge 的能力扩展，复用现有 BridgeServer / runner 协议）。

### Modified Capabilities

- `feishu-bot-bridge`：从单 task 派发扩展到 workflow（多 step 序列）派发；heartbeat 计数器跨 step 共享；新增"workflow 起步 / 步骤切换 / 工作流终态"三类 IM reply 文案。

## Impact

- **代码**：
  - `runners/feishu-bot/src/workflow.ts`（新建，~200 行）：`splitWorkflow`、`callPlanLLM`、`WorkflowExecutor` 类、`renderTemplate` 上下文注入。
  - `runners/feishu-bot/src/main.ts`（约 +80 行）：`InFlightTask` 加 `workflow?: WorkflowState` 字段；`dispatch()` 改为 workflow-aware；`handleBridgeEvent.webAgentTaskCompleted` / `Failed` 增加"还有 next step 就继续派发，没有就 workflow 终态"分支。
  - `runners/feishu-bot/test/workflow.test.ts`（新建，~150 行）：keyword detection / plan JSON parser / executor state transitions / template substitution / fail-abort scenarios。
  - `runners/feishu-bot/.env.example`（约 +5 行）：`LARK_BOT_PLAN_LLM_BASE_URL` / `LARK_BOT_PLAN_LLM_API_KEY` / `LARK_BOT_PLAN_LLM_MODEL` 三个 env。
- **协议**：bridge envelope 不变。bot 在内部 multiplex 多个 `runWebAgentTask` envelope。
- **依赖**：`runners/feishu-bot` 加一个 `node-fetch` 或直接用 Node 内置 `fetch`（Node 18+ 已稳定，feishu-bot 用 Node 25 不需新装）。
- **风险**：
  - **LLM plan 输出不稳**：模型可能 emit 非 JSON 文本 / steps 描述歧义 / skill 字段瞎填。`callPlanLLM` 返回 `{ ok: false, reason }` 时 fallback 到单 task，IM 发一条"工作流意图识别失败，作为单任务执行"提示。
  - **跨步骤上下文 mismatch**：step 2 期望"日程链接"但 step 1 finalAnswer 没含。处理：`renderTemplate` 找不到占位符值 → 用 step 1 finalAnswer 全文兜底，并 IM 提醒"上下文未明确捕获，传递完整结果"。
  - **m9 IM 任务 / m10 calendar 任务都是 22-46 step 的长任务**——workflow 跑 2 步意味着 60-90 秒 × 2 ≈ 3 分钟总时长。heartbeat 仍工作；但 IM 信道 nonce 必须含 stepIndex × workflowStepIndex 防止跨 workflow step 同 stepIndex 撞包。
  - **inFlightTask 锁与 workflow 协调**：workflow 跑期间 bot 仍持 inFlightTask 锁，第二条 IM prompt 会得到 "上一条任务还在跑（已 X 秒）" busy reply（m9 行为不变）。
- **数据**：无。
- **运维**：dev.sh 启动 bot 时多一个 plan LLM endpoint env；README 加 m11 段说明 workflow 触发 keyword 与最小 demo prompt 列表。
