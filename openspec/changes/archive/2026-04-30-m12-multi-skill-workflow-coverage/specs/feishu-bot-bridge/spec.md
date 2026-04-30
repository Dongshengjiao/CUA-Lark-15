## ADDED Requirements

### Requirement: workflow plan-LLM 必须 emit skill 枚举字段

`callPlanLLM` MUST 在 plan-LLM 的 system prompt 内强制要求 model emit 每个 step 的 `skill` 字段，且 `skill` 取值 MUST 是以下四个枚举值之一：`feishu_im_send` / `feishu_calendar_create` / `feishu_doc_create` / `feishu_base_create`。`parsePlanResponseContent` MUST 校验 step.skill 是否在已知枚举集（`KNOWN_SKILLS`）内；不在则丢弃该字段（让 runner 退化到 keyword routing）。

理由：m11 实测时 plan-LLM 不强制 emit skill，runner 用 prompt-based selectSkill 路由。当 step i>0 prompt 经 `$prev_result` 注入了 step i-1 的 finalAnswer（含大量"日历""日程"等关键词）时，selectSkill 把 step 1 IM 错路由回 calendar skill，导致 step 1 在 calendar 视图下 6 step 早退。强制 skill enum + bot 显式传 skill 给 runner 才能从根上解决跨 step 路由污染。

#### Scenario: plan-LLM system prompt 要求 skill 字段
- **WHEN** 读取 `PLAN_SYSTEM_PROMPT` 字符串
- **THEN** 字符串包含 "skill" 关键字 + "REQUIRED"（或语义等价标识）
- **AND** 字符串列出四个枚举值：feishu_im_send / feishu_calendar_create / feishu_doc_create / feishu_base_create

#### Scenario: parsePlanResponseContent 接受合法 skill 枚举
- **WHEN** plan-LLM 返回 `{steps:[{description,prompt,skill:"feishu_calendar_create"},...]}`
- **THEN** `parsePlanResponseContent` 返回 `{ok:true,steps}`，且 `steps[0].skill === "feishu_calendar_create"`

#### Scenario: parsePlanResponseContent 丢弃未知 skill 名（fail-safe）
- **WHEN** plan-LLM 返回 `{steps:[{description,prompt,skill:"feishu_unknown"}]}`
- **THEN** `parsePlanResponseContent` 返回 `{ok:true,steps}`（不 reject）
- **AND** `steps[0].skill` 为 `undefined`（runner 收到 null，走自己的 selectSkill 关键字路由作为 fallback）

#### Scenario: KNOWN_SKILLS 集合只含四个 m11 active skill（mail 仍 deferred）
- **WHEN** 读取 `runners/feishu-bot/src/workflow.ts` 的 `KNOWN_SKILLS`
- **THEN** Set 内含 4 元素：feishu_im_send / feishu_calendar_create / feishu_doc_create / feishu_base_create
- **AND** 不含 `feishu_mail_send`

### Requirement: workflow wf-done 必须显式标注可疑步骤

bot bridge 的 `wf-done` IM reply MUST 检查每个 step 的 finalAnswer：当 finalAnswer 为空字符串、纯空白、或等于 m9 占位符 `(任务完成，但未生成最终回复)` 时，该 step 被判定为"可疑"。wf-done summary MUST：

- 该 step 的 bullet 前缀使用 `⚠️` 而非 `•`
- 若 ≥ 1 个 step 可疑，wf-done headline 改为 `⚠️ 工作流完成但 N 个步骤可能未真执行` 而非 `✅ 工作流完成`
- 总 step 数 / 时长信息保留

理由：m11 verify-run #1 把 step 2 IM 早退（6 step / 25.8s + 空 finalAnswer）silent 标为 ✅，用户以为发了消息但实际没发。透明化 ⚠️ 让用户立刻知道哪一步可能失败，避免信任错位。

#### Scenario: 短任务（≤4 step）单 task 不触发 ⚠️
- **WHEN** 单 task 路径任务在 4 step 内 emit webAgentTaskCompleted 且 finalAnswer 非空
- **THEN** 单 task 路径走 m9 成功 reply（`✅ 任务完成（X 步 / Y.Ys）：...`），与 m12 透明化无关

#### Scenario: workflow 任一步空 finalAnswer 触发 wf-done ⚠️
- **WHEN** workflow 跑 2 步，step 1 finalAnswer = `''`
- **THEN** wf-done IM reply headline 含 `⚠️ 工作流完成但 1 个步骤可能未真执行`
- **AND** step 1 bullet 前缀为 `⚠️`，step 0 bullet 前缀为 `•`

#### Scenario: workflow 占位符 finalAnswer 同样触发 ⚠️
- **WHEN** step finalAnswer 等于 `(任务完成，但未生成最终回复)`
- **THEN** 该 step 视为可疑

### Requirement: workflow dispatch 必须 log 每步的 emitted prompt 与 skill

`dispatchWorkflowStep` MUST 在派发每个 step 前 log 一行 `info` 级别消息，包含：
- taskID
- step 编号 / 总数
- resolved skill（来自 plan-LLM emit 或 fallback null）
- emitted prompt（经 `renderTemplate` 注入 prev_result 后的最终文本，必要时截断到 240 字符）

理由：m11 verify-run #1 调试 step 2 早退时，无法直接看到 emit 给 runner 的 prompt 内容（log 只显示 taskID）。诊断盲区。m12 加上后，verify-run 立即能看到 plan-LLM 拆出的 prompt + skill 是否正确，省一轮调试 round trip。

#### Scenario: dispatchWorkflowStep 派发时 log 含完整诊断信息
- **WHEN** workflow step i 被派发
- **THEN** runner stderr / bot bridge log 出现一行：
  - `dispatched runWebAgentTask{taskID=...} (workflow step ${i+1}/${N}, skill=${step.skill ?? 'auto-route'}) prompt=...`
- **AND** prompt 字段包含 step.prompt 经 renderTemplate 替换 $prev_result 后的最终值（240 字符截断）
