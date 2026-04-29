## Why

到目前为止 lark-island 只有两条用户输入入口：

1. **菜单栏 🌐 popover**（M4 引入）—— 桌面用户友好，但要求用户切回 Mac 主屏并点菜单栏图标
2. **observer-client.ts CLI**（M5 hotfix）—— 适合 e2e smoke / 自动化触发，不是给真实用户的

team master plan 把 Mail / IM / Calendar / Docs / Base / VC 都框定为"飞书内部子产品"，并把整个产品定位写成 **"OPC Mode = 面向 OPC 超级个体的飞书内部协作 AI 中枢"**。这意味着用户**已经在飞书里办公**——再给他一个"必须切回 Mac 桌面用菜单栏"的输入入口体验割裂。

**M9 加第三条入口：飞书机器人 IM 对话**。用户在飞书 IM 里给挑战赛账号机器人发消息（手机 / 桌面 / Web 都行），bot 桥进程消费事件、转发到 BridgeServer 当 observer client、runner 跑任务、bot 桥拿到 finalAnswer 后用 lark-cli 发回执给原用户。灵动岛**继续作为**任务监控中心 + 卡点提醒，职责清晰。

实施基础已经就位：
- ✅ M3 BridgeServer observer role 协议（observer-client.ts 是参考实现）
- ✅ M7 Phase 0 per-skill profile alignment（runner 多账号 cookie 管理）
- ✅ lark-cli `event +subscribe` WebSocket 长连接（**零公网部署 / 零 webhook**）—— 用户已配 `challenge` profile 并实测长连接成功
- ✅ lark-cli `im +messages-send` 单条命令发消息

## What Changes

- **新增 bot-bridge 进程**（`runners/feishu-bot/`，新 npm package）
  - spawn `lark-cli --profile challenge event +subscribe --as bot --event-types im.message.receive_v1` 子进程
  - 监听 stdout NDJSON，解析 `im.message.receive_v1` 事件
  - 抽 `event.message.content`（JSON 字符串，含 `text`）+ `event.sender.sender_id.open_id` + `event.message.chat_id`
  - 作为 observer role 连 `~/Library/Application Support/LarkIsland/bridge.sock`，发 `runWebAgentTask{taskID, prompt: <message text>}`
  - 监听 `webAgentTaskStarted` / `webAgentStepUpdate` / `webAgentTaskCompleted` / `webAgentTaskFailed` / `webAgentApprovalRequested`
  - 任务终态时调用 `lark-cli --profile challenge im +messages-send --as bot --chat-id <chat_id> --markdown <finalAnswer | 错误码>` 给原用户回执
- **新增极简白名单**：默认环境变量 `LARK_BOT_ALLOWLIST`（逗号分隔 open_id），未设则放行所有 sender；m9 demo 期可以默认全开
- **不集成到 RunnerSupervisor**（留 m10）：m9 期间 bot bridge 由 `scripts/dev.sh` 手动 spawn，配合现有 LarkIslandApp 一起跑
- **不动 BridgeServer 协议 / runner / island UI**：bot bridge 是纯 observer client，复用所有现有协议
- **task ID 命名约定**：bot bridge 触发的 task 用 `feishu-bot-<message_id>`，便于跟原飞书消息关联

## Capabilities

### New Capabilities

- **`feishu-bot-bridge`**: 独立的 capability，描述 bot bridge 进程的职责、协议、事件解析、回执规则、白名单策略。

### Modified Capabilities

无。m9 只是新增一种 observer client，BridgeServer / runner / island 都不动。

## Impact

- **代码**：
  - 新增 `runners/feishu-bot/`（新 npm package）：
    - `package.json` + `tsconfig.json`（继承 monorepo 共享配置）
    - `src/main.ts`（约 250 行）：spawn + parse + bridge connect + reply
    - `src/lark-event.ts`（约 60 行）：NDJSON parser + sender/chat/text 抽取
    - `src/reply.ts`（约 50 行）：`spawn lark-cli im +messages-send` 回执
    - `test/lark-event.test.ts`（约 80 行）：parser unit test，用 schema fixture
  - `scripts/dev.sh` +5 行 spawn bot bridge（如 `LARK_BOT_PROFILE` 设了才起）
  - 顶层 `README.md` 加飞书 bot 输入入口的"3 步设置"段落
- **协议**：bridge schema 不变。
- **依赖**：`runners/feishu-bot/` 新加 `vitest` / `tsx` / `typescript` 等（同 runner 监督版本）；不引入运行时新依赖（lark-cli 是已有的全局 binary）。
- **风险**：
  - **lark-cli `event +subscribe` 单例锁**：当前不能两个 process 同时 subscribe（server 会随机切分事件）。dev 期间用户的长连接和 m9 bot bridge 不能同时跑——必须只起其中一个。
  - **lark-cli 输出 schema 演变**：未来 lark-cli 升级可能改 NDJSON 字段；m9 parser 写得宽松（容错缺字段），但 schema 大改时要跟。
  - **回执延迟**：runner 跑 ≥ 25 step 任务 + bot bridge 写回 lark-cli 可能 1-2 分钟。需要 bot bridge 在任务跑期间发 "正在执行（已 X 步）..." 中间回执（轮询或事件驱动），不然用户会以为机器人没收到。**m9 简化版**只发"开始"+"终态"两条，中间 step 不打扰；如果 demo 反馈不够好再加 step 心跳到 m10。
  - **多用户并发**：同一用户连发两条消息 → runner busy reject 第二条 → bot bridge 回执"上一条还在跑"。这是 M3 设计的 single-task-serial 自然结果。
- **数据**：无。
- **运维**：用户 `dev.sh` 启动时若设了 `LARK_BOT_PROFILE=challenge` 环境变量则一并起 bot bridge；不设则跟 m8 一样只起 LarkIslandApp。
