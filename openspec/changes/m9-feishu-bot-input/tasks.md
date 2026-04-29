# 任务：m9-feishu-bot-input

## 1. `runners/feishu-bot/` package 骨架

- [ ] 1.1 新建 [`runners/feishu-bot/package.json`](../../../runners/feishu-bot/package.json)：
  - `name = "@lark-island/feishu-bot"`，`version = "0.1.0-spike"`，`type = "module"`，`private = true`
  - `scripts.start = "tsx src/main.ts"`，`scripts.typecheck`，`scripts.test = "vitest run"`
  - dev deps：tsx / typescript / vitest（与 `runners/web-agent` 同版本）
- [ ] 1.2 新建 [`runners/feishu-bot/tsconfig.json`](../../../runners/feishu-bot/tsconfig.json)：extend 或 mirror `runners/web-agent/tsconfig.json`（ES2022 / nodenext / strict）
- [ ] 1.3 新建 [`runners/feishu-bot/.env.example`](../../../runners/feishu-bot/.env.example)：列 `LARK_BOT_PROFILE` / `LARK_BOT_ALLOWLIST` / `LARK_ISLAND_SOCKET_PATH` 的用法说明
- [ ] 1.4 跑 `npm install --workspaces` 或在 `runners/feishu-bot` 内 `npm install`，落 `node_modules`

## 2. NDJSON parser + 单测（最小骨架先过测试）

- [ ] 2.1 新建 [`runners/feishu-bot/src/lark-event.ts`](../../../runners/feishu-bot/src/lark-event.ts)：
  - 导出 type `IncomingTextMessage = { chatID: string; senderOpenID: string; text: string; messageID: string }`
  - 导出 `parseImMessageReceiveV1(line: string): IncomingTextMessage | null` —— 容错 schema 缺失字段（除必填字段全 null/empty 时返回 null + log），仅处理 `message_type === 'text'`，其它（image/post/file/audio/video/sticker）返回 null
  - 导出 `chunkNdjsonBuffer(buf: string): { lines: string[]; rest: string }` —— stdout 流中逐行切；NDJSON 无嵌套 `\n` 假设
- [ ] 2.2 新建 [`runners/feishu-bot/test/lark-event.test.ts`](../../../runners/feishu-bot/test/lark-event.test.ts)：
  - case A：标准 `im.message.receive_v1` text 消息 → 抽到正确 chatID/senderOpenID/text/messageID
  - case B：`message_type === 'image'` → 返回 null
  - case C：缺 `event.message.content` → 返回 null
  - case D：`content` 不是合法 JSON → 返回 null + log warn
  - case E：`event_type` 不匹配（例如 `contact.user.created_v3`）→ 返回 null
  - case F：流式切 buffer：两条事件粘在一起 + 末尾不完整 → 切出两条 + rest 含半条
- [ ] 2.3 `cd runners/feishu-bot && npm test` 通过

## 3. lark-cli 回执 + 白名单

- [ ] 3.1 新建 [`runners/feishu-bot/src/reply.ts`](../../../runners/feishu-bot/src/reply.ts)：
  - 导出 `replyText(args: { profile: string; chatID: string; text: string }): Promise<{ ok: boolean; messageID?: string; error?: string }>`
  - 内部 spawn `lark-cli --profile <profile> im +messages-send --as bot --chat-id <chatID> --text <text> --idempotency-key <md5(chatID+text)>`，stdout 收 JSON 解析 ok/data.message_id
  - text 长度 > 3500 时尾巴截断 + " ..."
- [ ] 3.2 新建 [`runners/feishu-bot/src/allowlist.ts`](../../../runners/feishu-bot/src/allowlist.ts)：
  - 导出 `isAllowed(openID: string, allowlistEnv: string | undefined): boolean`：env 空 → true；env 非空 → split逗号 trim → includes 检查
  - test/allowlist.test.ts：覆盖 env 空 / 单个 / 多个 / 空白容错

## 4. 主循环 `src/main.ts`

- [ ] 4.1 新建 [`runners/feishu-bot/src/main.ts`](../../../runners/feishu-bot/src/main.ts)：
  - 读 env：`LARK_BOT_PROFILE`（必，不设直接 exit 1 + 提示）、`LARK_BOT_ALLOWLIST`（可空）、`LARK_ISLAND_SOCKET_PATH`（默认 `~/Library/Application Support/LarkIsland/bridge.sock`）
  - spawn `lark-cli --profile $LARK_BOT_PROFILE event +subscribe --as bot --event-types im.message.receive_v1 --quiet`
  - 监听 stdout → buffer → chunkNdjsonBuffer → 每行 parseImMessageReceiveV1
  - 同时连 BridgeServer Unix socket，收 hello v2 → registerClient(observer)
  - 维护 `inFlightTask: { taskID; chatID; senderOpenID; prompt; startedAt } | null`
  - 收到合法 text message：
    - !isAllowed → log warn 跳过（不回执，避免被 dos）
    - inFlightTask 非空 → `replyText({ chatID, text: '上一条任务（' + inFlightTask.prompt.slice(0,30) + '...）还在跑，请稍候。' })`
    - 否则：生成 taskID = `feishu-bot-<messageID>`，先 replyText "已收到：<text>，正在执行..."，再 send `runWebAgentTask{taskID, prompt: text, profileName: 'qwen-default'}`，set inFlightTask
  - 收到 webAgentTaskCompleted（match taskID）→ replyText finalAnswer（截断 3500 字符）+ 清 inFlightTask
  - 收到 webAgentTaskFailed（match taskID）→ replyText "任务失败（<kind>）：<message>" + 清 inFlightTask
  - 收到 webAgentApprovalRequested(login_qr)（match taskID）→ replyText "请去 Mac 上的灵动岛 / 浏览器扫码登录 <skill displayName>" + 不清 inFlightTask（继续等终态）
  - lark-cli 子进程 exit / socket 断 → log error + process.exit(1)，让外部 supervisor 重启
- [ ] 4.2 处理 lark-cli child 信号：父进程收到 SIGTERM/SIGINT 时 kill child + safeClose socket

## 5. dev.sh 选择性 spawn

- [ ] 5.1 在 [`scripts/dev.sh`](../../../scripts/dev.sh) 末尾、wait $APP_PID 之前加：
  ```sh
  BOT_DIR="$REPO_ROOT/runners/feishu-bot"
  if [[ -n "${LARK_BOT_PROFILE:-}" && -d "$BOT_DIR" ]]; then
    print_step "spawning feishu bot bridge (profile=$LARK_BOT_PROFILE)..."
    ( cd "$BOT_DIR" && npx tsx src/main.ts ) &
    BOT_PID=$!
    trap "kill $APP_PID $BOT_PID 2>/dev/null" EXIT INT TERM
  fi
  ```

## 6. 文档

- [ ] 6.1 顶层 [`README.md`](../../../README.md) 新增 "飞书 bot 输入入口" 段：
  - 前置：lark-cli 已 install、`challenge` profile 已配 + auth login 完成（`im` / `event` / `contact` 域）
  - 启动：`LARK_BOT_PROFILE=challenge zsh scripts/dev.sh`
  - 验证：飞书 IM 给机器人发条消息 → 应该收到"已收到..."回执 + 任务跑完后的结果
  - 已知限制：lark-cli 单例锁 + 私聊 only + 纯文本 only

## 7. 编译与单元测试

- [ ] 7.1 `cd runners/feishu-bot && npm run typecheck` 通过
- [ ] 7.2 `cd runners/feishu-bot && npm test` 全过：≥ 8 个 case（lark-event 6 + allowlist 2+）
- [ ] 7.3 `cd runners/web-agent && npm test` 仍 87/87（确认 m9 没动 web-agent）
- [ ] 7.4 `cd lark-island && swift build && swift test` 仍 32/32

## 8. 端到端实跑

- [ ] 8.1 `LARK_BOT_PROFILE=challenge zsh scripts/dev.sh`，看 dev log 出现 "spawning feishu bot bridge"
- [ ] 8.2 飞书 IM 给挑战赛机器人**私聊**发 `"hello m9 bot test"`：
  - 验收 1：bot 在 5 秒内回执 "已收到：hello m9 bot test，正在执行..."
  - 验收 2：runner 用通用模式（无 skill 命中）跑完，bot 在 60 秒内发 finalAnswer 或 call_user 回执
- [ ] 8.3 飞书 IM 私聊机器人发 `"在飞书给自己发条消息：hello m9 from bot"`：
  - 验收 1：路由到 feishu_im_send（runner log 验证）
  - 验收 2：bot 发"已收到..."回执
  - 验收 3：≤ 25 step 内任务完成，挑战赛账号自聊里能看到 "hello m9 from bot" 蓝色气泡
  - 验收 4：bot 发 finalAnswer 回执
- [ ] 8.4 飞书 IM 私聊机器人发 `"新建多维表格 m9 bot test"`：
  - 验收 1：路由到 feishu_base_create
  - 验收 2：表格创建成功 + bot 发 finalAnswer 回执
- [ ] 8.5 把 8.2/8.3/8.4 实测数据填到本 `tasks.md` §9 retrospective 段

## 9. Post-implementation retrospective

> 实测后填表 + 写 3-5 句结论，证据齐全。M6 §9 / m7 §6 / m8 §7 是模板。

## 10. 收尾

- [ ] 10.1 `npx @fission-ai/openspec validate m9-feishu-bot-input --strict` 干净通过
- [ ] 10.2 拆 commit（4 个）：
  - `docs(openspec): propose m9-feishu-bot-input`（task 0：propose 文档）
  - `feat(feishu-bot): bot bridge process consuming lark-cli event +subscribe → BridgeServer observer (m9)`（task 1-5：代码）
  - `docs(openspec): m9 task tracking + post-implementation retrospective`（task 9：实测填空）
  - `chore(openspec): archive m9-feishu-bot-input`（task 10.3 之后）
- [ ] 10.3 `npx @fission-ai/openspec archive m9-feishu-bot-input --yes` 把 ADDED capability sync 进 `openspec/specs/feishu-bot-bridge/`
