## ADDED Requirements

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

bot bridge MUST 维护一个全局 `inFlightTask: { taskID, chatID, senderOpenID, prompt, startedAt } | null` 状态：

- 收到合法 `IncomingTextMessage` 时：
  - 若 `LARK_BOT_ALLOWLIST` 非空且 `senderOpenID` 不在其中 → log warn 后丢弃（不回执，避免对未授权用户暴露 bot 存在）
  - 若 `inFlightTask !== null` → 用 `lark-cli im +messages-send --as bot` 回执 "上一条任务（<prev prompt 截 30 字>...）还在跑，请稍候"，**不**派新 task
  - 否则：
    1. 立即 reply "已收到：<text>，正在执行..."
    2. 生成 `taskID = "feishu-bot-<messageID>"`
    3. 通过 BridgeServer 发 `runWebAgentTask{ taskID, prompt: text, skill: null, profileName: 'qwen-default' }`
    4. 设置 `inFlightTask`
- 收到 BridgeServer 转发的 `webAgentTaskCompleted{ taskID == inFlightTask.taskID }` → reply finalAnswer（≤ 3500 字符，超长截断 + "..."）+ 清 `inFlightTask`
- 收到 `webAgentTaskFailed{ taskID == inFlightTask.taskID }` → reply "任务失败（<kind>）：<message>" + 清 `inFlightTask`
- 收到 `webAgentApprovalRequested{ taskID == inFlightTask.taskID, kind: 'login_qr' }` → reply "请去 Mac 上的灵动岛或浏览器扫码登录 <skill displayName>" + **不**清 `inFlightTask`（任务还在 visible browser 等扫码）
- 收到 `webAgentStepUpdate` / `webAgentTaskStarted` → log only，不打扰用户（避免飞书 IM 刷屏）

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

#### Scenario: vitest 跑通新增测试
- **WHEN** 在 `runners/feishu-bot/` 执行 `npm test`
- **THEN** 所有 it/test 通过，总数 ≥ 8

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
