# 任务：m10-calendar-unblock-and-bot-heartbeat

## 1. calendar startingURL → tenant 子域

- [ ] 1.1 改 [`runners/web-agent/src/skills/feishu_calendar_create.ts`](../../../runners/web-agent/src/skills/feishu_calendar_create.ts)：startingURL / loginURL 改成 `https://${LARK_FEISHU_TENANT_DOMAIN ?? 'jcneyh7qlo8i.feishu.cn'}/calendar/week` 计算式。
- [ ] 1.2 删除 m9 加的 `## ENTRY: switch from messenger to calendar surface FIRST` 段（约 25 行）。
- [ ] 1.3 few-shot 首步从"点 sidebar 日历图标"改回"直接点'新建日程'"按钮。
- [ ] 1.4 头部注释加 m10 hotfix 说明：m9 走 messenger sidebar 失败原因 + tenant URL 直达。

## 2. bot bridge step heartbeat

- [ ] 2.1 [`runners/feishu-bot/src/main.ts`](../../../runners/feishu-bot/src/main.ts) `InFlightTask` 接口加：
  - `totalSteps: number`（累计 webAgentStepUpdate 计数）
  - `lastHeartbeatStep: number`
  - `lastHeartbeatAt: number`（ms timestamp，0 表示未发过）
- [ ] 2.2 `dispatch()` 初始化新字段为 `totalSteps=0, lastHeartbeatStep=0, lastHeartbeatAt=0`。
- [ ] 2.3 `handleBridgeEvent` 的 `webAgentStepUpdate` 分支：
  - `inFlight.totalSteps += 1`
  - 抽 `payload.thought` / `actionType`（防御 undefined）
  - 检查 `stepsSinceLast = totalSteps - lastHeartbeatStep` 与 `msSinceLast = now - lastHeartbeatAt`
  - 触发条件：`stepsSinceLast >= 5 && msSinceLast >= 15_000`
  - 触发时调 `replyText({ ..., text: heartbeatText, nonce: heartbeat-${taskID}-${stepIndex} })`，更新 `lastHeartbeatStep` / `lastHeartbeatAt`
- [ ] 2.4 heartbeat 文案：`⏳ 已执行 ${totalSteps} 步：${truncateThought(thought, 60)}`；thought 为空时省略冒号后部分。
- [ ] 2.5 在 `webAgentTaskCompleted` / `webAgentTaskFailed` / `webAgentApprovalRequested` 都不要再 fire heartbeat（终态 reply 已经覆盖；inFlight=null 后下次 step 自然不会进 heartbeat 路径）。
- [ ] 2.6 `BridgeEvent.webAgentStepUpdate` 类型加 `thought?: string` 与 `actionType?: string` 字段（已存在则 noop）。

## 3. 测试

- [ ] 3.1 新建 [`runners/feishu-bot/test/heartbeat.test.ts`](../../../runners/feishu-bot/test/heartbeat.test.ts)：
  - case A：3 step 任务（每步间隔 1s）→ 0 条 heartbeat
  - case B：5 step 任务（每步间隔 5s）→ 1 条 heartbeat（满足 5 step 但首次 lastHeartbeatAt=0 触发）
  - case C：10 step 任务（每步间隔 1s，总 10s < 15s）→ 0 条 heartbeat（被时间门控）
  - case D：10 step 任务（每步间隔 4s，总 40s）→ 2 条 heartbeat（5/10 step 各一次，时间门均满足）
  - case E：thought 字段空字符串 → fallback 文案不带冒号
  - case F：thought 长度 > 60 char → 截断 + " ..."
  - 实现：抽 `decideHeartbeatTrigger(state, stepIndex, thought, now)` 纯函数 + 文案 helper，单测直接覆盖（不需 mock socket / lark-cli）
- [ ] 3.2 [`runners/feishu-bot/test/lark-event.test.ts`](../../../runners/feishu-bot/test/lark-event.test.ts) 不需要改（parser 不动）。
- [ ] 3.3 [`runners/web-agent/test/skills.test.ts`](../../../runners/web-agent/test/skills.test.ts) 改 calendar URL 断言：
  - 移除/调整旧的"messenger 入口"断言（如果有）
  - 新增：`feishu_calendar_create.startingURL` 包含 `/calendar/week` 路径
  - 新增：含 `feishu.cn` 域（不限定具体 tenant，env 覆盖时也通）
  - addendum 不再含 "ENTRY: switch from messenger to calendar surface FIRST" 字面（防 m9 段死灰复燃）

## 4. 编译与单元测试

- [ ] 4.1 `cd runners/feishu-bot && npm run typecheck` 通过。
- [ ] 4.2 `cd runners/feishu-bot && npm test` 全过：18（m9）→ ≥ 24（m10 +6 case heartbeat）。
- [ ] 4.3 `cd runners/web-agent && npm run typecheck` 通过；`npm test` 仍 87+ 条全过。
- [ ] 4.4 `cd lark-island && swift build && swift test` 不变（island 不动）。

## 5. 端到端实跑

- [ ] 5.1 `LARK_FEISHU_TENANT_DOMAIN=jcneyh7qlo8i.feishu.cn LARK_BOT_PROFILE=challenge zsh scripts/dev.sh`，看 dev log 出现 spawning bot bridge。
- [ ] 5.2 飞书 IM 私聊 Lark-island 发 `"在飞书创建一个日程，标题是 m10 demo 同步会，明天下午3点开始"`：
  - 验收 1：≤ 25 step events 内 ✅ Completed
  - 验收 2：飞书日历 (`https://jcneyh7qlo8i.feishu.cn/calendar/week`) 能看到带"m10 demo 同步会"标题的事件块在 5月1日 15:00-16:00
  - 验收 3：bot IM 终态回执含 `2026-05-01` YYYY-MM-DD 格式（不要"明天"）
  - 验收 4：任务跑期间 IM 至少收到 1 条 `⏳ 已执行 X 步：...` heartbeat
- [ ] 5.3 飞书 IM 发 `"在飞书给自己发条消息：m10 心跳验证"`（IM 任务 m9 实测 22-24 step）：
  - 验收 1：bot 在任务跑期间发 ≥ 2 条 heartbeat
  - 验收 2：终态 ✅ + 自聊看到蓝色气泡
- [ ] 5.4 把 5.2/5.3 实测数据填到本 `tasks.md` §6。

## 6. Post-implementation retrospective

> 实测后填表 + 写 3-5 句结论。M9 §9 是模板。

## 7. 收尾

- [ ] 7.1 `npx @fission-ai/openspec validate m10-calendar-unblock-and-bot-heartbeat --strict` 干净通过。
- [ ] 7.2 拆 commit（建议 4 个）：
  - `docs(openspec): propose m10-calendar-unblock-and-bot-heartbeat`
  - `fix(skills): feishu_calendar_create startingURL → tenant /calendar/week (m10)`
  - `feat(feishu-bot): step-progress heartbeat reply (m10)`
  - `chore(openspec): archive m10-...`（最后做）
- [ ] 7.3 `npx @fission-ai/openspec archive m10-calendar-unblock-and-bot-heartbeat --yes` 把 MODIFIED delta sync 进 specs/。
