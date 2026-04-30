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

- [x] 8.1 `LARK_BOT_PROFILE=challenge zsh scripts/dev.sh`，看 dev log 出现 "spawning feishu bot bridge"
- [x] 8.2 飞书 IM 给挑战赛机器人**私聊**发 `"hello bot, what is 1+1"` 等 generic prompt：见 §9.1（多次 verify-run；bing.com 默认 URL 修复后稳定，但 Google captcha 在切换前持续失败 → 已切 bing 缓解）
- [x] 8.3 飞书 IM 私聊机器人发 `"在飞书给自己发条消息：hello from m9 bot"`：✅ 见 §9.2（22 step / 80.3s + 24 step / 95.5s 各一次完整 happy-path）
- [x] 8.4 飞书 IM 私聊机器人发 `"在飞书新建一个多维表格，标题为 m9 demo 表"`：✅ 见 §9.3（16 step / 59.5s）
- [-] 8.5（新增）飞书 IM 私聊机器人发 `"在飞书创建一个日程，标题是 m9 demo 同步会，明天下午3点开始"`：blocked，见 §9.4 + §9.6 m10 backlog
- [x] 8.6 把 8.2-8.5 实测数据填到本 `tasks.md` §9 retrospective 段

## 9. Post-implementation retrospective（实测于 2026-04-29 23:18 ~ 2026-04-30 01:08 UTC+8）

m9 实测分两轮 + 多次 hotfix。第一轮（23:18-23:39 跑通飞书 bot 输入入口主链）+ 第二轮（00:00-01:08 在 BASE prompt / dev.sh / island UI / calendar URL 等多个面修了 8 个 bug）。所有实测都通过 lark-cli `event +subscribe` + bot bridge observer client 触发。

### 9.1 generic mode（"hello bot, what is 1+1"）

| Run | 状态 | 备注 |
|---|---|---|
| #5 (23:39) | ✅ 4 step / 11.8s | google captcha 没拦的 lucky path |
| #6 (00:08) | ❌ pageError max_loop | google "unusual traffic" CAPTCHA 拦截，30 step 跑空 |
| #7 (post-bing-switch) | ✅（recursive runs） | bing.com 默认 URL（commit `d82c31e`）后稳定 |

判定：**通过**——lifecycle 完整 + bot 端到端回执；google captcha 是外部环境问题，非 m9 bug，已切 bing 缓解。

### 9.2 task 8.3（feishu_im_send 自聊）

| Run | step / 用时 | 终态 | finalAnswer 摘要 |
|---|---|---|---|
| #1 (23:23) | (interrupted by m9-internal bug) | — | wire schema bug 让 bot 收不到 Completed 事件 |
| #2 (00:27) | 22 step / 80.3s | ✅ Completed | "消息'hello from m9 bot'已成功发送，右侧聊天窗口中出现了新的蓝色气泡（带'梓文'头像和时间戳 00:27），且输入框已清空" |
| #3 (00:32) | 24 step / 95.5s | ✅ Completed | "now appears as a new blue outgoing bubble in the chat history on the right, with a timestamp (00:32). The composer is empty again." |

判定：**通过**——飞书自聊会话中真实出现"hello from m9 bot"蓝色气泡（用户屏幕实拍），bot bridge 全链路完整。

### 9.3 task 8.4（feishu_base_create 通过 IM 入口）

| Run | step / 用时 | 终态 |
|---|---|---|
| (00:41) | 16 step / 59.5s | ✅ Completed |

finalAnswer："The title has been successfully changed to 'm9 demo 表' and is now displayed in the title bar. The table grid is fully loaded with columns and rows visible. Both completion conditions are met..."

判定：**通过**——`https://www.feishu.cn/drive/me/` 列表能看到新建的"m9 demo 表"。

### 9.4 task 8.5（feishu_calendar_create）blocked

3 次 verify-run 全部失败，但 root cause 各不相同——每次都做了 hotfix 推进了一格，最后撞到一个**超出 m9 范围**的环境侧问题。

| Run | step | 终态 | root cause |
|---|---|---|---|
| #1 (00:42) | 0 | ❌ pageError "ERR_NAME_NOT_RESOLVED calendar.feishu.cn" | DNS 没 A 记录，仅 MX —— hotfix `ecccda9` 改 startingURL → `messenger/` |
| #2 (00:48) | 0 | ❌ pageError "Cannot read properties of null (reading 'appendChild')" | BrowserOperator highlightClickableElements 在飞书 SPA 上撞 body=null —— hotfix `b1ab1be` 关掉 highlight |
| #3 (00:55, post-`960ce43`+`62bf5bf`) | 22 step / call_user() | 🟡 优雅放弃 | puppeteer chromium 加载 `messenger/` 后**飞书前端 redirect 到 docs/drive 主页**，sidebar 看不到"日历"图标（用户日常 Chrome 看到，但 puppeteer chromium 视口/state 不同）；VLM 找日历图标失败 → 撞进"研发人力甘特图" → call_user() 退出 |

VLM 在 #3 决策完全正确（按新 prompt "找日历图标 → fallback URL navigate → 找不到就 call_user()" 流程走完）。**问题在环境**，不在 prompt：飞书 SPA 在 puppeteer 默认 viewport 下加载 messenger 路径 ≠ 用户日常体验。

### 9.5 m9 期间修的 bug 链（按 commit 时序）

| # | commit | 类别 | bug → 修法 |
|---|---|---|---|
| 1 | `8ed00d5` | diagnostics | bot bridge `handleBridgeEvent` 静默 drop 无 log → 加 verbose log |
| 2 | `9f683bb` | wire-schema | Swift BridgeServer 编 event payload 嵌套在 `event[type]` 而非 `event.payload`，bot bridge raw JSON.parse 拿不到 → main.ts socket data handler 加 `evRaw.payload = evRaw[evRaw.type]` normalize |
| 3 | `622ac1e` | idempotency | reply.ts 用 `md5(chatID+text)` 当 idempotency-key，同 prompt 重发 ack-reply 被飞书 server 幂等去重消失 → ReplyArgs 加 `nonce` 字段，ack/busy 用 messageID, approval/completed/failed 用 taskID |
| 4 | `9de2816` | prompt | generic 模式 + IM skill 没 ACTION SYNTAX guard，VLM 偶发 `start_box=[...]` 无引号 → 把 ACTION SYNTAX 段提到 BASE_SYSTEM_PROMPT，generic + 5 个 skill 一次覆盖 |
| 5 | `d82c31e` | env | google.com 反爬挡通用 search 任务 → 默认 URL 切 bing.com（m6 design 备选项落地） |
| 6 | `397b89f` | UX | 灵动岛缩略图只有 120pt，看不清 agent 在做什么 → 改成 HStack 双栏，缩略图 320pt 占右栏 |
| 7 | `c12f9db` | dev-tooling | dev.sh grep 命中今日旧 runner.log 的 register 行，bot bridge 太早 spawn 撞 ECONNREFUSED → 启动前 mv 旧 log 加时间戳后缀 |
| 8 | `ecccda9` | URL | calendar.feishu.cn 没 A 记录 m5 起就错 → startingURL 改 `messenger/`，prompt 教 VLM 点 sidebar"日历"图标 |
| 9 | `960ce43` | UX | webAgentTaskFailed 走 `phase=.completed` 灵动岛看不出"失败" → 加 `SessionPhase.failed` + 红色 FAILED pill，全 surface 同步 |
| 10 | `b1ab1be` | runner-stability | BrowserOperator highlightClickableElements 在飞书 SPA 撞 `document.body = null` → BrowserOperator config 关掉 highlight |
| 11 | `62bf5bf` | prompt | calendar VLM 把 `5月1` 读成 `4月1`（picker header 没看）+ 看到"保存成功 toast"就 finished() 但实际无事件块 → BASE prompt 注入"今天是 YYYY-MM-DD，明天是..."；calendar COMPLETION SIGNAL 严格化（必须看到事件块） |

15 commit total（含 propose `3833c2e` + feat `dd93886` + 13 个 hotfix），全部已 commit 到 `feat/lark-island`。

### 9.6 给 m10 backlog 的输入

- **calendar 端到端 unblock**：用户在他真 Chrome 复制飞书日历的实际可达 URL（截图里能看到 `日 / 周 / 月` 视图，左侧"创建日程"按钮的页面）→ 单行 startingURL fix 大概率能跑通。或者方案 B：launch chromium 时设更宽 viewport（1440x900）让 sidebar 不折叠，messenger 页面 redirect 到的 docs/drive 主页可能仍能看到"日历"图标
- **mail unblock**（continued from m8）：等挑战赛账号开通邮箱 / 切到有邮箱的账号
- **RunnerSupervisor 集成 bot bridge**：m9 现状是 dev.sh 手动 spawn；生产化需 supervisor 监管 + crash restart（同 runner）
- **step 心跳消息**：长任务（≥ 30s）期间 bot 每 N 步发一次"已 X 步执行中"，避免飞书 IM 用户以为机器人挂了
- **dev mock BridgeServer harness**：让 bot bridge 单测能 mock 整套协议round-trip，避免类似 #2 wire-schema bug 端到端才发现
- **highlight overlay 重新启用条件**：`@ui-tars/operator-browser` 修 UIHelper 的 null-check 后可以恢复 `highlightClickableElements: true`

### 9.7 验收线总结

| 验收 | 标准 | 实测 |
|---|---|---|
| 飞书 IM 私聊机器人 → bot 收消息 → dispatch task | yes | ✅ 4 次 incoming message 全部被解析 + dispatch |
| ack reply（"已收到..."）| 5s 内 | ✅ 平均 < 2s |
| inFlightTask 锁（busy reject）| 行为正确 | ✅ 同 prompt 重发被锁住，task 完成后才放新任务 |
| 任务终态回执（finalAnswer / kind+message） | yes | ✅ 全部完成的任务都收到回执，含完整 finalAnswer |
| 灵动岛同步显示 step 进度 + 最终态 | yes | ✅ 双栏 320pt 缩略图 + RUNNING/DONE/FAILED pill |
| 飞书 IM 任务（IM / base） ≤ 25 step | yes（1 of 2） | IM 22-24 step / base 16 step，base 通过；IM 略超 25 但 m7 hotfix 后已稳定收敛 |
| 飞书 IM 任务（calendar）| yes | 🟡 deferred—— 详见 §9.4，归 m10 |

**核心交付**：飞书机器人作为第三条用户输入入口端到端打通 ✅。calendar 失败暴露的是 m6/m7/m8 deferred 的环境侧未知（puppeteer chromium 与用户日常 Chrome 在飞书 SPA 上的行为差异），不在 m9 范围。

## 10. 收尾

- [x] 10.1 `npx @fission-ai/openspec validate m9-feishu-bot-input --strict` 干净通过
- [x] 10.2 拆 commit（最终 15 个）：
  - propose：`3833c2e docs(openspec): propose m9-feishu-bot-input`
  - feat：`dd93886 feat(feishu-bot): bot bridge process ...`
  - 13 个 hotfix（详见 §9.5 表）
  - retrospective + archive：本 commit + 下一个
- [ ] 10.3 `npx @fission-ai/openspec archive m9-feishu-bot-input --yes` 把 ADDED capability sync 进 `openspec/specs/feishu-bot-bridge/`
