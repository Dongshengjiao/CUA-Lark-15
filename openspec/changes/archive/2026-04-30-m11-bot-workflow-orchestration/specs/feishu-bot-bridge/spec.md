## ADDED Requirements

### Requirement: bot bridge 支持 workflow（多步任务编排）

bot bridge MUST 在收到 IM 文本消息后**先做轻量 workflow 检测**，命中后通过 LLM plan 把单条 prompt 拆成 1-3 个子任务（PlannedStep[]），顺序派给 BridgeServer，并在跨 step 之间维护"上一步 finalAnswer"作为 `$prev_result` 占位符注入下一步 prompt。

任何 workflow 路径下的 plan / dispatch / lifecycle 失败 MUST fail-safe 回退到 m9 的单 task 路径，整体行为对单 task 用例完全保留（m9 单 task 不能因 m11 引入 workflow 改变行为）。

bot bridge 的 `InFlightTask` 类型 MUST 加可选 `workflow: WorkflowState | null` 字段，标识当前 inFlight 任务是否在一个 workflow 上下文内。

`WorkflowState` 必须 include：
- `steps: PlannedStep[]`：≥ 1 ≤ 3 步
- `currentIndex: number`：当前正在执行的 step 0-based
- `results: string[]`：results[i] = step i 的 webAgentTaskCompleted.finalAnswer
- `startedAt: number`：ms timestamp

#### Scenario: 单 task 用例不走 workflow 路径
- **WHEN** 用户在飞书 IM 发 `"在飞书给自己发条消息：hello"` （无 workflow keyword）
- **THEN** bot bridge `splitWorkflow(text)` 返回 false
- **AND** 不调用 LLM plan
- **AND** 直接走 m9 单 task 路径（dispatchSingle）
- **AND** 整个生命周期与 m9 完全一致（ack-reply / heartbeat / completed-reply 三段）

#### Scenario: 复合指令命中 workflow keyword 并成功 plan
- **WHEN** 用户发 `"创建一个日程 X 明天下午3点开始，并给自己发条消息确认"`
- **THEN** `splitWorkflow(text)` 返回 true
- **AND** 调 `callPlanLLM(text)` 返回 `{ ok: true, steps: [{description:'创建日程',prompt:'...'}, {description:'通知确认',prompt:'...$prev_result'}] }`
- **AND** bot reply `🔀 工作流开始（共 2 步）：1) 创建日程  2) 通知确认`
- **AND** 顺序派发 step 0（calendar） → 等 webAgentTaskCompleted → 派发 step 1（IM）
- **AND** step 1 prompt 中的 `$prev_result` 被替换为 step 0 的 finalAnswer
- **AND** 全部 step 成功后 bot reply `✅ 工作流完成（共 2 步 / X.Xs）...`

#### Scenario: LLM plan 失败 fallback 到单 task
- **WHEN** `splitWorkflow(text)` 返回 true
- **AND** `callPlanLLM(text)` 因任意原因返回 `{ ok: false, reason: ... }`（HTTP 错 / JSON parse 错 / steps 为空 / steps > 3）
- **THEN** bot reply `工作流意图识别失败，作为单任务执行` 提示
- **AND** 调用 `dispatchSingle()` 继续按 m9 单 task 路径处理
- **AND** inFlight.workflow 为 null

#### Scenario: workflow 中间某步 fail 整个工作流中止
- **WHEN** workflow 在 step i 派发后收到 `webAgentTaskFailed`
- **THEN** bot reply `❌ 工作流第 (i+1) 步失败（<kind>）：<message>`
- **AND** **不**继续派发后续 step
- **AND** inFlight 清空（包括 workflow 字段）
- **AND** 后续新 IM prompt 可以正常派任务（不被前一个失败阻塞）

#### Scenario: workflow 期间用户连发新 prompt 仍受 inFlightTask 锁约束
- **WHEN** 一个 workflow 正在 step i 跑（inFlight 非空）
- **AND** 同一用户再发一条新 prompt
- **THEN** bot reply `上一条任务（<旧 prompt 截 30 字>...）还在跑（已 X 秒），请稍候`
- **AND** **不**派新任务
- **AND** workflow 继续执行不受影响

### Requirement: workflow 期间 heartbeat 计数器跨 step 共享

m10 引入的 step heartbeat（5 step + 15s 双门控）MUST 在 workflow 路径下**跨 step 共享计数器**，即 step 切换时**不**重置 `totalSteps` / `lastHeartbeatStep` / `lastHeartbeatAt`。

理由：用户视角看到的是"任务持续多长时间没有进度反馈"，跨 step 的 step events 累计才是真实的反馈延迟。每 step 重置计数器会让 2 步 workflow 每步只跑 5-10 step 时一条 heartbeat 都触发不了。

#### Scenario: workflow 跨 step 累计触发 heartbeat
- **WHEN** workflow 跑 2 个 step
- **AND** step 0 经历 4 个 webAgentStepUpdate（不触发 heartbeat）
- **AND** step 1 在 1 个 webAgentStepUpdate 后即满足 `totalSteps=5`
- **AND** 距离 startedAt ≥ 15 秒
- **THEN** 在 step 1 内触发 1 条 heartbeat（基于跨 step 累计 totalSteps=5）

### Requirement: workflow 生命周期 IM 通知文案

bot bridge 在 workflow 路径下 MUST 在以下时机各发**一条**节制的 IM reply（不与 step 内 heartbeat 重叠）：

| 时机 | reply 模板 | nonce 模式 |
|---|---|---|
| splitWorkflow 命中 + plan ok | `🔀 工作流开始（共 N 步）：\n1) <desc1>\n2) <desc2>` | `wf-start-<msgID>` |
| 派发每个 step 前 | `▶️ 步骤 (i+1)/N 开始：<desc>` | `wf-step-start-<msgID>-<i>` |
| 任一 step fail | `❌ 工作流第 (i+1) 步失败（<kind>）：<message>` | `wf-step-fail-<msgID>-<i>` |
| 全部 step 成功 | `✅ 工作流完成（共 N 步 / X.Xs）\n• 步骤 1: <result1>\n• 步骤 2: <result2>` | `wf-done-<msgID>` |
| LLM plan fallback | `工作流意图识别失败，作为单任务执行` | `wf-fallback-<msgID>` |
| 单 step 内 webAgentStepUpdate heartbeat | m10 行为不变 | `heartbeat-<taskID>-<stepIndex>`（注意 taskID 含 step index） |

workflow 路径下 step 完成 MUST **不**发独立的"step finalAnswer reply"——所有 step finalAnswer 由 wf-done reply 一次合并发出。

#### Scenario: workflow 全程 IM 消息节制（2 步 workflow 总 IM 消息 5 条）
- **WHEN** 一个 2 步 workflow 跑通且每步 ≥ 5 step events / ≥ 20 秒
- **THEN** bot 在该 workflow 期间发出的 IM reply 数量恰好 ≥ 5：
  - 1× `🔀 工作流开始`
  - 1× `▶️ 步骤 1/2 开始`
  - ≥ 1× heartbeat（跨 step 累计触发）
  - 1× `▶️ 步骤 2/2 开始`
  - 1× `✅ 工作流完成`
- **AND** 每个 reply 的 nonce 互不重复（避免飞书 server 幂等去重）

### Requirement: bot bridge workflow 模块单元测试

`runners/feishu-bot/test/workflow.test.ts` MUST 覆盖：
- `splitWorkflow`：≥ 5 case（1 个负例 + 3 个中文 keyword 正例 + 1 个英文 known limitation）
- `renderTemplate`：≥ 4 case（含占位符替换 / 不含 / 空字符串 / 多次出现）
- `callPlanLLM` mock fetch：≥ 5 case（success / empty / oversize / non-JSON / HTTP 5xx）
- workflow 状态转换：≥ 5 case（dispatch step 0 / step 1 with prev_result / step fail abort / all steps complete / fallback path）

#### Scenario: vitest 跑通 workflow 单测
- **WHEN** 在 `runners/feishu-bot/` 执行 `npm test`
- **THEN** 总测试数 ≥ 46（m10 时 27 + m11 +19）
- **AND** 全部通过
