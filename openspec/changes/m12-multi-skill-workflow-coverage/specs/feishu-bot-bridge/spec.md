## ADDED Requirements

### Requirement: workflow 编排在四种 skill 组合形态下经实测验证

m11 引入的 workflow 编排能力 MUST 在以下四种 skill 组合形态都有实测数据点支撑（不一定全部成功，但都必须有明确的"通过 / 失败 + 原因"记录）：

- **2-step 跨 surface 标准型**：calendar + IM（m11 已实测 ✅）
- **2-step 跨 surface docs 型**：docs + IM（m12 实测）
- **2-step 同 surface 连串型**：IM + IM（m12 实测，验证 plan-LLM 是否愿意把同 skill 拆步 + runner 同 surface 多步 chromium 状态稳定性）
- **3-step 跨三 surface 型**：calendar + docs + IM（m12 实测，验证 m11 plan-LLM `MAX_STEPS=3` 边界是否准确）

#### Scenario: 四种 workflow 形态都在 m12 archive 时有实测记录
- **WHEN** 阅读 `openspec/changes/archive/2026-04-30-m12-multi-skill-workflow-coverage/tasks.md` §6
- **THEN** 四个小节（6.A / 6.B / 6.D / 6.C）都填了 prompt、路径、step 数、时长、飞书侧视觉验证、✅/❌ 判定
- **AND** §6.E 整体结论给出 m14 demo 录屏建议主推的 1-2 条最稳工作流

### Requirement: workflow 路径下 step 间 finalAnswer 上下文注入跨 surface 仍工作

m11 已经规定 `$prev_result` 占位符在 step i 的 prompt 内被 step i-1 的 finalAnswer 替换。m12 在跨 surface（docs → IM、calendar → docs → IM）实测中 MUST 验证这个机制不因 surface 切换而失效。

#### Scenario: docs+IM workflow step 1 prompt 含 step 0 finalAnswer
- **WHEN** docs+IM workflow（m12 B 任务）跑通
- **THEN** bot log `dispatched runWebAgentTask{...-step1}` 那行 emitted prompt 中包含 step 0 finalAnswer 中的关键 token（如文档标题、日程标题等）
- **AND** runner 在 step 1 跑 IM 时，VLM 在自聊气泡里输入的文本含 step 0 文档信息

#### Scenario: 3-step workflow step 2 prompt 含 step 1 finalAnswer
- **WHEN** 3-step calendar+docs+IM workflow（m12 C 任务）跑通且 plan-LLM 真的拆 3 步
- **THEN** bot log `dispatched runWebAgentTask{...-step2}` 那行 emitted prompt 中可能包含 step 1（docs）的 finalAnswer
- **AND** 注：跨多 step 的 prev_result 链只反映"step i-1 的 finalAnswer"，**不**累计前面所有 step（这是 m11 设计；m12 不改）

## MODIFIED Requirements

### Requirement: bot bridge 的任务派发与生命周期

bot bridge MUST 维护一个全局 `inFlightTask: { taskID, chatID, senderOpenID, prompt, startedAt, totalSteps, lastHeartbeatStep, lastHeartbeatAt, workflow } | null` 状态（M11 引入 workflow 字段；M12 不改字段，扩展 workflow 形态覆盖范围）。

m12 修订点：把 m11 的"workflow 当前主要在 calendar+IM 这种 2-step 跨 surface 场景验证"扩展为"已在 docs+IM、IM+IM、3-step 三种额外形态实测验证"。具体生命周期/nonce/上下文注入规则**保持 m11 原文不变**。

#### Scenario: 单 task 用例不走 workflow 路径（M12 保持不变）
- **WHEN** 用户发 `"在飞书新建一个文档，标题是 m12 docs 测试"`（无 workflow keyword）
- **THEN** `splitWorkflow(text)` 返回 false
- **AND** 不调用 LLM plan
- **AND** 直接走 m9 单 task 路径（dispatchSingle）
- **AND** runner 路由到 `feishu_doc_create` skill 并跑完任务
- **AND** bot 单 task ack/heartbeat/completed 三段语义生效（与 m9 一致）
