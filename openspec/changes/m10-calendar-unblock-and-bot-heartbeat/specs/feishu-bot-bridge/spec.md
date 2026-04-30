## MODIFIED Requirements

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
