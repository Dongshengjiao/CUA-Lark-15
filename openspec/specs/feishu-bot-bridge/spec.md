# feishu-bot-bridge Specification

## Purpose
TBD - created by archiving change m9-feishu-bot-input. Update Purpose after archive.
## Requirements
### Requirement: bot bridge 进程作为飞书 IM 输入入口

仓库 SHALL 提供一个独立的 Node.js 进程 `runners/feishu-bot/`（npm package `@lark-island/feishu-bot`），作为 lark-island 的第三条用户输入入口。该进程：

1. 启动时 spawn `lark-cli --profile <LARK_BOT_PROFILE> event +subscribe --as bot --event-types im.message.receive_v1 --quiet` 子进程，监听 stdout NDJSON。
2. 同时作为 BridgeServer 的 `observer` role client 连接到 `~/Library/Application Support/LarkIsland/bridge.sock`（或 `LARK_ISLAND_SOCKET_PATH` 环境变量指定的路径），完成 v2 hello 握手 + `registerClient(observer)`。
3. 把符合条件的飞书 IM 私聊文本消息翻译成 `runWebAgentTask` 命令，发给 BridgeServer。
4. 监听 BridgeServer 转发回来的任务 lifecycle 事件，把终态结果（或扫码请求）通过 `lark-cli im +messages-send --as bot` 回执给原飞书用户。

bot bridge MUST 是**独立进程**，不嵌入 LarkIslandApp 进程；与 web-agent runner 同等地位，但 m9 阶段不由 RunnerSupervisor 监管（m10 backlog）。

#### Scenario: 启动时连接两端
- **WHEN** `LARK_BOT_PROFILE=challenge` 已设置且 `runners/feishu-bot/` 已构建
- **AND** 用户启动 `LARK_BOT_PROFILE=challenge zsh scripts/dev.sh`
- **THEN** dev.sh 在启动 LarkIslandApp 之后另起 bot bridge 子进程
- **AND** bot bridge 启动后日志含 "lark-cli event +subscribe spawned" 与 "bridge socket connected, observer registered"
- **AND** lark-cli 子进程长连接到飞书事件源
- **AND** bridge socket 在 `BridgeServer` 端可见为 `observer` role 的 client

#### Scenario: 缺环境变量直接退出
- **WHEN** 启动 bot bridge 但 `LARK_BOT_PROFILE` 未设
- **THEN** bot bridge 在 stderr 打印 "LARK_BOT_PROFILE not set; refusing to start" 并 exit 1
- **AND** dev.sh 因为有 `LARK_BOT_PROFILE` 才会 spawn 它，所以正常 dev 流程不会走到这条退出

### Requirement: bot bridge 解析 im.message.receive_v1 事件

bot bridge 的 NDJSON parser MUST 处理飞书官方 `im.message.receive_v1` 事件（schema 2.0），按以下规则抽取：

- 必填字段缺失（`header.event_type` / `event.sender.sender_id.open_id` / `event.message.chat_id` / `event.message.message_id` / `event.message.message_type` / `event.message.content` 任一）→ 返回 null + log warn，**不抛错** 不退出
- `header.event_type !== 'im.message.receive_v1'` → 返回 null（其它事件类型预订阅时也忽略）
- `event.message.message_type !== 'text'` → 返回 null（image / file / post / sticker / audio / video 暂不支持）
- `event.message.content` 不是合法 JSON 字符串或缺 `text` → 返回 null + log warn
- `event.message.chat_type !== 'p2p'`（即群聊）→ m9 阶段 1 返回 null（群聊 `@机器人` 是 m10）

成功解析后返回 `IncomingTextMessage = { chatID, senderOpenID, text, messageID }`，供主循环路由。

NDJSON parser MUST 处理流式输入：lark-cli stdout 是按行写入但 chunk 大小不固定，bot bridge MUST 用 buffer + 按 `\n` 切分，未结尾的部分留作下次 chunk 拼接。

#### Scenario: 标准 text 消息抽取成功
- **WHEN** 一行 NDJSON 是有效的 `im.message.receive_v1` p2p text 消息
- **THEN** parser 返回非 null `IncomingTextMessage`
- **AND** `chatID` / `senderOpenID` / `text` / `messageID` 均非空且匹配 event payload

#### Scenario: 非 text 消息被跳过
- **WHEN** `event.message.message_type === 'image'`
- **THEN** parser 返回 null
- **AND** 主循环不发起任务，**亦不**回执（避免对 stickers / 偶然图片产生噪声）

#### Scenario: schema 不规范但不崩溃
- **WHEN** lark-cli 输出一行字段缺失或 JSON 残缺的事件
- **THEN** parser 返回 null
- **AND** bot bridge 进程继续监听后续事件，不退出

### Requirement: bot bridge 的任务派发与生命周期

bot bridge MUST 维护一个全局 `inFlightTask: { taskID, chatID, senderOpenID, prompt, startedAt, totalSteps, lastHeartbeatStep, lastHeartbeatAt } | null` 状态（M10 修订：加 heartbeat 三字段）：

- 收到合法 `IncomingTextMessage` 时：
  - 若 `LARK_BOT_ALLOWLIST` 非空且 `senderOpenID` 不在其中 → log warn 后丢弃。
  - 若 `inFlightTask !== null` → 用 `lark-cli im +messages-send --as bot` 回执 "上一条任务（<prev prompt 截 30 字>...）还在跑（已 X 秒），请稍候"，**不**派新 task。
  - 否则：
    1. 立即 reply "已收到：<text>，正在执行..."。
    2. 生成 `taskID = "feishu-bot-<messageID>"`。
    3. 通过 BridgeServer 发 `runWebAgentTask{ taskID, prompt: text, skill: null, profileName: 'qwen-default' }`。
    4. 设置 `inFlightTask`，三个 heartbeat 字段初值都为 0（M10 新增）。
- 收到 `webAgentTaskStarted` → log only。
- 收到 `webAgentStepUpdate{ taskID == inFlight.taskID }`（M10 修订：从 silent log 改为节流 heartbeat）：
  - `inFlight.totalSteps += 1`。
  - 计算 `stepsSinceLast = totalSteps - lastHeartbeatStep` 与 `msSinceLast = now - lastHeartbeatAt`。
  - 若 `stepsSinceLast >= 5 && msSinceLast >= 15000`：
    - 调 lark-cli reply 文案：`⏳ 已执行 ${totalSteps} 步：${truncateThought(payload.thought, 60)}`（thought 为空时省略冒号后半段）。
    - reply nonce: `heartbeat-${taskID}-${stepIndex}`（每条 heartbeat nonce 唯一，避免飞书 server idempotency 去重）。
    - 更新 `lastHeartbeatStep = totalSteps; lastHeartbeatAt = now`。
- 收到 `webAgentTaskCompleted{ taskID == inFlight.taskID }` → reply finalAnswer（≤ 3500 字截断）+ 清 inFlightTask（包括 heartbeat 字段）。
- 收到 `webAgentTaskFailed{ taskID == inFlight.taskID }` → reply "任务失败（<kind>）：<message>" + 清 inFlightTask。
- 收到 `webAgentApprovalRequested{ taskID == inFlight.taskID, kind: 'login_qr' }` → reply "请去 Mac 上的灵动岛或浏览器扫码登录 <skill displayName>" + **不**清 inFlightTask。

#### Scenario: 短任务（≤ 4 step）不触发 heartbeat（M10 新增）
- **WHEN** 任务在 5 个 webAgentStepUpdate envelope 之前就 emit webAgentTaskCompleted
- **THEN** 整个任务期间 bot 只发 ack + 终态共 2 条飞书 IM 消息
- **AND** 没有 `⏳ 已执行` 文字开头的 reply

#### Scenario: 长任务触发节流 heartbeat（M10 新增）
- **WHEN** 任务有 ≥ 20 个 webAgentStepUpdate envelope，每步间隔 ≥ 4 秒
- **THEN** bot 在该任务期间至少发出 1 条 `⏳ 已执行 X 步：...` heartbeat
- **AND** heartbeat 频率不超过每 5 step / 15 秒一次（满足两个条件才触发）
- **AND** 每条 heartbeat 的 idempotency-key nonce 形如 `heartbeat-<taskID>-<stepIndex>` 保证不被飞书 server 幂等去重

#### Scenario: heartbeat thought 截断（M10 新增）
- **WHEN** `webAgentStepUpdate.payload.thought` 长度超过 60 字符
- **THEN** heartbeat 文案中只显示前 60 字符 + `...`

#### Scenario: 端到端 happy path（飞书 IM → web agent → 回执）
- **WHEN** 用户在飞书 IM 给挑战赛机器人**私聊**发 `"在飞书给自己发条消息：hello m9 from bot"`
- **THEN** bot bridge 在 5 秒内 reply "已收到..."
- **AND** bot bridge 通过 bridge socket 发 `runWebAgentTask{ taskID: feishu-bot-om_xxx, prompt, profileName: qwen-default }`
- **AND** runner 路由到 `feishu_im_send` 并跑完任务
- **AND** runner emit `webAgentTaskCompleted{ taskID }` 通过 BridgeServer 转发给 bot bridge
- **AND** bot bridge 在收到该事件后调 `lark-cli im +messages-send --as bot --chat-id <chatID> --text <finalAnswer>`，挑战赛账号 IM 收到 finalAnswer 回执

#### Scenario: 任务期间用户连发第二条
- **WHEN** `inFlightTask` 非空（已经有任务跑）
- **AND** 同一或不同用户再发一条 prompt
- **THEN** bot bridge **不**派新任务
- **AND** reply "上一条任务（<prev prompt 截 30 字>...）还在跑，请稍候"
- **AND** `inFlightTask` 状态不变

#### Scenario: 扫码请求传递给用户
- **WHEN** 任务路由到飞书 skill 但 cookie 已过期，runner emit `webAgentApprovalRequested(login_qr)`
- **THEN** bot bridge reply "请去 Mac 上的灵动岛或浏览器扫码登录 <skill displayName>"
- **AND** `inFlightTask` 仍非空（继续等终态）
- **AND** 用户扫码完成后 runner 继续走任务并最终 emit `webAgentTaskCompleted` → bot bridge 正常发 finalAnswer

#### Scenario: 白名单未命中静默丢弃
- **WHEN** `LARK_BOT_ALLOWLIST=ou_aaa,ou_bbb` 且消息 sender open_id 是 `ou_ccc`
- **THEN** bot bridge log warn `"sender ou_ccc not in allowlist; dropped"`
- **AND** **不** reply（避免对未授权用户暴露 bot 存在）
- **AND** **不**发 runWebAgentTask

### Requirement: bot bridge 单元测试覆盖 NDJSON parser 与白名单

`runners/feishu-bot/test/` MUST 包含：

- `lark-event.test.ts`：parser 至少覆盖 6 个 case：标准 text、image 消息跳过、缺 content 字段、content 非 JSON、event_type 不匹配、流式 buffer 切分
- `allowlist.test.ts`：env 空 → 全放、env 单 open_id → 命中/不命中、env 多 open_id 含空白容错
- `heartbeat.test.ts`（M10 新增）：节流逻辑至少覆盖 6 个 case：3 step 不触发；5 step + lastHeartbeatAt=0 触发首条；时间门控（< 15s）抑制；时间门控满足时多条 heartbeat；thought 空字符串 fallback 文案；thought > 60 字符截断

#### Scenario: vitest 跑通新增测试
- **WHEN** 在 `runners/feishu-bot/` 执行 `npm test`
- **THEN** 所有 it/test 通过，总数 ≥ 24（M9 时 18 + M10 +6 heartbeat case）

### Requirement: dev.sh 支持选择性 spawn bot bridge

`scripts/dev.sh` MUST 支持通过 `LARK_BOT_PROFILE` 环境变量选择性启动 bot bridge：

- 未设置该变量：dev.sh 走 m6 既有流程，只起 LarkIslandApp + runner
- 设置为非空字符串（如 `challenge`）：dev.sh 在 LarkIslandApp / runner ready 之后**额外**起 `runners/feishu-bot/`，传该 profile 名给子进程
- dev.sh 收到 SIGINT / SIGTERM 时同时 kill `APP_PID` 和 `BOT_PID`

#### Scenario: 不设环境变量时 dev.sh 不启动 bot bridge
- **WHEN** 用户运行 `zsh scripts/dev.sh`（无 LARK_BOT_PROFILE）
- **THEN** dev.sh 不 spawn bot bridge 子进程
- **AND** dev.sh 输出仅含 m6 既有的 "swift build" / "launching LarkIslandApp" / "runner ready ✅" 步骤

#### Scenario: 设置环境变量时启动 bot bridge
- **WHEN** 用户运行 `LARK_BOT_PROFILE=challenge zsh scripts/dev.sh`
- **THEN** dev.sh 在 runner ready ✅ 之后输出 "spawning feishu bot bridge (profile=challenge)..."
- **AND** bot bridge 子进程被启动
- **AND** Ctrl+C 时 dev.sh 同时 kill 两个子进程

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

