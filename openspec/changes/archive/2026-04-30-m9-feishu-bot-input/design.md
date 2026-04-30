# 设计：M9 — 飞书 IM 机器人作为第三条用户输入入口

## 背景（Context）

m1-m8 已经把 lark-island 的执行底座做完整了：BridgeServer / runner / per-skill profile / 灵动岛 UI / 5 个飞书 skill（mail deferred）。当前用户输入入口仅有"菜单栏 popover"和"observer-client CLI"两种。

team master plan 把产品定位为 **OPC mode 飞书内部协作 AI 中枢**——用户已经在飞书办公，再要他切回 Mac 桌面用菜单栏体验割裂。m9 加飞书机器人作为第三条入口，**不动现有协议 / runner / 岛 UI**，纯加一个 bot bridge 进程当 observer client。

涉及方：
- 钟梓文（master plan §3 主链负责人 + UI 负责人）：m9 是他的"灵动岛 / 主 UI 收口"+ "六子产品联动测试"工作的入口基础设施
- 王泽 / 董圣娇：他们做的 IM / Calendar / Docs / VC 任务，m9 之后都能从飞书 IM 触发，不再要求他们桌面操作

约束：
- **零公网部署**：全程 lark-cli WebSocket 长连接，不开 webhook server / 不需要公网 IP / 不需要 IP 白名单
- **零协议改动**：bot bridge 只是个 observer client，bridge schema 不变
- **零 runner 改动**：runner 看到的是普通 `runWebAgentTask` 命令
- **零岛 UI 改动**：岛仍然只接 BridgeServer 事件，不知道指令是从菜单栏还是 bot 来的——这是好事（解耦干净）
- **m9 不做 supervisor 集成**：bot bridge 由 `dev.sh` 手动 spawn，supervisor 集成留 m10
- **lark-cli 单例锁**：用户的手动 `event +subscribe` 长连接 和 m9 bot bridge 不能同时跑

## 目标 / 非目标（Goals / Non-Goals）

**目标：**
- 用户在飞书 IM **私聊机器人**发文本消息 → bot bridge 拿到 message text → 转发到 BridgeServer → runner 跑任务 → bot bridge 拿到 finalAnswer → bot 回执给原用户
- 端到端路径在 demo 现场可复现：3 个验收 prompt（"hello m9 bot test"通用 / "在飞书给自己发消息 xxx" 飞书 IM / "新建多维表格 xxx" 飞书 base）至少有 1 条 ≤ 25 step 完成 + 用户在飞书 IM 收到回执
- 现有菜单栏 popover / observer-client CLI 输入入口**继续可用**，跟 bot 入口并存

**非目标：**
- 不做群聊 `@机器人` 路由——m9 只支持私聊，群聊留 m10+
- 不做 markdown 富文本 / 飞书 message card 回执——m9 只发纯文本（finalAnswer 直接发）；富文本 / 卡片留 polish 阶段
- 不做 step 心跳（"已 X 步执行中"中间消息）——只发 task 起 + 终态两条；如果 demo 反馈不够好再加
- 不做用户白名单 GUI / 持久化——只支持 `LARK_BOT_ALLOWLIST` 环境变量逗号分隔
- 不做 RunnerSupervisor 集成（bot bridge 与 runner 同等地位 spawn）—— m10
- 不做 attachment / image / file 类型消息——只解析 `message_type === 'text'`，其它消息回执"暂不支持，请发文本指令"

## 关键决策（Decisions）

### D1：bot bridge 是独立 npm package `runners/feishu-bot/`

仿 `runners/web-agent/` 的布局：

```
runners/feishu-bot/
├── package.json          # name: @lark-island/feishu-bot, type: module
├── tsconfig.json         # extends ../web-agent/tsconfig.json
├── src/
│   ├── main.ts           # entry: spawn lark-cli + bridge connect + dispatch loop
│   ├── lark-event.ts     # parse NDJSON → SimpleMessage{chatID, senderOpenID, text, messageID}
│   ├── reply.ts          # spawn lark-cli im +messages-send 回执
│   └── allowlist.ts      # env LARK_BOT_ALLOWLIST 逗号分隔 open_id 校验
└── test/
    └── lark-event.test.ts
```

考虑过：
- **写在 `runners/web-agent/` 里当个新 entry**：reject。bot bridge 跟 runner 职责正交（一个驱动 chromium 跑 web agent，一个监听飞书事件）；耦合代价高。
- **写成 LarkIslandApp Swift 端**：reject。Node ecosystem 跟 lark-cli 协作天然好（`child_process.spawn` + stdout NDJSON）；Swift 跑 lark-cli 等于额外抽象层。
- **bot bridge 写在 lark-cli 里当 plugin**：reject。lark-cli 跟 lark-island 是两个独立项目，不应单向耦合。

### D2：用 `child_process.spawn` 拉 lark-cli 子进程获取事件

```ts
const proc = spawn('lark-cli', [
  '--profile', LARK_BOT_PROFILE,
  'event', '+subscribe',
  '--as', 'bot',
  '--event-types', 'im.message.receive_v1',
  '--quiet',
]);
proc.stdout.on('data', (chunk) => buffer += chunk; tryParseLines());
```

每一条 NDJSON 是一个事件。`im.message.receive_v1` schema（飞书官方）：

```json
{
  "schema": "2.0",
  "header": {
    "event_id": "...",
    "event_type": "im.message.receive_v1",
    "create_time": "...",
    "tenant_key": "...",
    "app_id": "cli_..."
  },
  "event": {
    "sender": {
      "sender_id": { "open_id": "ou_xxx", "user_id": "...", "union_id": "..." },
      "sender_type": "user",
      "tenant_key": "..."
    },
    "message": {
      "message_id": "om_xxx",
      "chat_id": "oc_xxx",
      "chat_type": "p2p",
      "message_type": "text",
      "create_time": "...",
      "content": "{\"text\":\"hello bot\"}",
      "mentions": [...]
    }
  }
}
```

parser 关心：
- `header.event_type === 'im.message.receive_v1'`
- `event.sender.sender_id.open_id` → 白名单校验
- `event.message.chat_id` → 回执 chat
- `event.message.message_id` → 用作 taskID 后缀（`feishu-bot-<message_id>`）
- `event.message.message_type === 'text'`（其它类型回执"暂不支持"）
- `JSON.parse(event.message.content).text` → prompt

### D3：bot bridge 是 BridgeServer observer role 的复用

bot bridge 启动后：

```ts
const sock = net.connect(socketPath);
// 收 hello (protocolVersion: 2)
sock.write(encodeEnvelope({ type: 'command', command: { type: 'registerClient', role: 'observer' } }));
// 维护 inFlightTask: { taskID, chatID, senderOpenID } | null
// 每次新消息：
//   if inFlightTask: 给原用户回执 "上一条任务还在跑：<prev prompt>，请稍候..." + 不发新 task
//   else: dispatch runWebAgentTask(taskID, prompt) + set inFlightTask
// 监听 webAgentTaskCompleted/Failed/ApprovalRequested:
//   匹配 taskID 后调 lark-cli 回执 + 清 inFlightTask
```

注意：
- bot bridge **自己**维护 inFlightTask（避免 BridgeServer 转发"runner busy"事件之前抢着发新 task）。这样能在 lark-cli 层面给原用户友好回执，而不是让 runner 直接 `webAgentTaskFailed{kind:pageError, message:"runner busy"}`。
- BridgeServer 单线程；observer client 多发 runWebAgentTask 时由 BridgeServer 发给 runner，runner busy 时 emit failed 回 observer。bot bridge 也能正确处理这个 fallback 路径。

### D4：回执时机 = 任务起 + 任务终态

- 收到合法 prompt → bot bridge 立即用 lark-cli 给用户回执 "已收到：<prompt>，正在执行..."（纯文本，不阻塞）
- 收到 `webAgentTaskStarted` → log（不打扰用户）
- 收到 `webAgentStepUpdate` → log（不打扰用户，避免 30 条消息刷屏）
- 收到 `webAgentApprovalRequested(login_qr)` → 给用户回执"请扫码登录 <skill 显示名>"+ 提示去 Mac 看灵动岛 / 浏览器扫码（**重要**：m9 阶段 1 这条很难做，扫码必须在 Mac 浏览器扫，bot 通知用户即可）
- 收到 `webAgentTaskCompleted` → 给用户回执 finalAnswer（纯文本；如果 finalAnswer > 4000 字截断 + "..."）
- 收到 `webAgentTaskFailed` → 给用户回执"任务失败（<kind>）：<message>"

考虑过：
- **每个 step 都回执一条**：reject。30 step 任务会在飞书消息流里刷屏。
- **聚合 step thought 成进度条**：reject。lark-cli 没"编辑消息"接口（飞书 API 有但 lark-cli 没暴露），等于发新消息，仍然刷屏。
- **m10 加 step 心跳**：每 5 step 发一条"已执行 5 步：<最近 thought 摘要>"——m9 阶段 1 不做，验收只看终态体验。

### D5：白名单 = 简单环境变量

```ts
const allowlist = (process.env.LARK_BOT_ALLOWLIST ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);
const isAllowed = (openID: string) => allowlist.length === 0 || allowlist.includes(openID);
```

- 不设：放行所有 sender（demo 期默认）
- 设：只放行命中的 open_id

考虑过：
- **GUI 配置**：reject。m9 不开任何配置面板。
- **持久化到 BridgeServer / island state**：reject。m9 bot bridge 是独立进程，不要给 BridgeServer 加白名单概念。
- **群聊 `@机器人` 解析**：reject（m9 非目标）。

### D6：dev.sh 选择性 spawn bot bridge

```sh
# scripts/dev.sh 末尾追加
if [[ -n "${LARK_BOT_PROFILE:-}" ]]; then
  print_step "spawning feishu bot bridge (profile=$LARK_BOT_PROFILE)..."
  ( cd "$BOT_DIR" && npx tsx src/main.ts ) &
  BOT_PID=$!
fi

# wait $APP_PID 已经在; 加个 cleanup trap kill BOT_PID
```

需要 `LARK_BOT_PROFILE=challenge` 环境变量才起 bot bridge。这样不影响仅跑菜单栏 popover 的开发流程。

考虑过：
- **默认 spawn**：reject。Demo 时用户手动设置 `LARK_BOT_PROFILE` 显式开启。
- **bot bridge 独立 supervisor**：m10 backlog。

## 风险 / 取舍（Risks / Trade-offs）

- **lark-cli 单例锁** —— 用户原先手动跑的 `event +subscribe` 不能跟 m9 bot bridge 共存。需要在 README 明示"启动 bot bridge 前必须 kill 现有手动 subscribe"。
- **lark-cli 升级 schema 漂移** —— m9 parser 写 defensive：缺字段就 skip 该事件 + log，不 throw。但飞书官方 schema 较稳，短期内无大改。
- **回执延迟 1-3 分钟** —— 飞书 IM 用户可能误以为 bot 没收到。m9 用"已收到，正在执行"先回执缓解感知；polish 阶段加 step 心跳。
- **scan QR 请求** —— bot bridge 收到 `webAgentApprovalRequested(login_qr)` 时通知用户"请去 Mac 浏览器扫码"。用户当时可能不在 Mac 旁边——这是 cookie 已过期场景的固有限制。m7 Phase 0 做的 cookie 复用让这种场景已经很少见。
- **finalAnswer 超长** —— 飞书 IM 单消息有 4000 字符限制（粗略）；m9 截断到 3500 字符 + "..."。
- **多并发用户** —— 两个不同用户同时发指令，第二个走 runner busy reject + bot bridge 回执"另一个任务在跑"。这是预期行为；m9 不做并发任务排队。

## 迁移计划（Migration Plan）

1. 创建 `runners/feishu-bot/` package 骨架（package.json + tsconfig + src/ + test/）
2. 写 `src/lark-event.ts` parser + unit test
3. 写 `src/reply.ts` lark-cli 回执
4. 写 `src/allowlist.ts` 白名单校验
5. 写 `src/main.ts` 主循环：spawn lark-cli child + connect bridge + dispatch + reply
6. 在 `scripts/dev.sh` 末尾加 `LARK_BOT_PROFILE` 选择性 spawn
7. 顶层 `README.md` 加"飞书 bot 入口的 3 步设置"段
8. typecheck + npm test 全过
9. 实测 3 条验收 prompt
10. archive m9

回滚：m9 是独立 commit 链 + 新增独立 package；如有阻塞 git revert 到 m8 archive commit (`2771532`) 即可。

## 待解决问题（Open Questions）

1. **lark-cli child process 异常退出怎么办？** m9 简化版：让父进程 (`scripts/dev.sh`)感知，退出 bot bridge process；用户重启 dev.sh 即可。生产化时由 supervisor 接管（m10）。
2. **bot bridge 如何知道 chat_id / sender 之外的元数据？** event payload 已经够了；如果需要更多（用户名 / 群名）调 lark-cli `contact +get-user` 即可——m9 阶段 1 用不到。
3. **同一用户在不同 chat 下发的指令怎么处理？** taskID 用 `feishu-bot-<message_id>` 唯一，不会冲突；inFlightTask 是全局锁（同一 bot bridge 进程只能跑一个），跨 chat / 跨用户都共享这把锁。这是 single-task-serial 的飞书入口体现。
4. **挑战赛账号 cookie / 飞书 bot 账号是不是同一个？** 同一个（`challenge` profile = 挑战赛账号）。bot 用 bot 身份发回执（机器人名义），但事件订阅用 user-installed app 的能力。挑战赛账号在浏览器 cookie 也是 `profiles/feishu/`——所以"用户给机器人发指令"+ "agent 在挑战赛账号浏览器执行"+ "机器人回执"全闭环都在挑战赛账号下，是 A==B 模式而非代理人模式。
