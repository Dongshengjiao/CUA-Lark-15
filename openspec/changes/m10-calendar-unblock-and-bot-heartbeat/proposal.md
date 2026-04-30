## Why

m9 archive §9.4 / §9.6 留了两个对 demo 体验有显著影响的事，5/2 截止（剩约 60 小时含休息），m10 用一次最小 milestone 把它们清掉：

1. **calendar skill 的 startingURL 错了 5 个 milestone**（m5→m9）。calendar.feishu.cn 没 A 记录，飞书日历的真实可达 URL 是 **tenant 子域路径**（如 `https://jcneyh7qlo8i.feishu.cn/calendar/week`，挑战赛账号实测）。m9 hotfix 让 calendar 走 messenger sidebar 跳转，但 puppeteer chromium 加载 messenger 后被前端 redirect 到 docs 主页，sidebar 上看不到日历图标——绕路失败。直接用 tenant URL 一步到位，不用 sidebar 跳。
2. **bot bridge 任务执行期间用户在飞书 IM 端看不到任何进度信号**。m9 决策"bot 只发起 + 终态两条 reply"——`webAgentStepUpdate` 全部 silent 避免刷屏。但实测 80-95s 任务中段用户会怀疑机器人挂了。每 N step 发一条节流 heartbeat 是好折衷。

非范围（推 m11+）：联动工作流（IM→Calendar→Docs 任务串）、RunnerSupervisor 集成 bot bridge、in-memory BridgeServer mock harness、mail 账号开通等。

## What Changes

- **calendar startingURL 改 tenant 子域**
  - `feishu_calendar_create.ts`：`startingURL` / `loginURL` 从 `https://www.feishu.cn/messenger/`（m9 hotfix）→ env 变量 + 默认值方式：默认读 `LARK_FEISHU_TENANT_DOMAIN` 环境变量（带 fallback），路径固定 `/calendar/week`。挑战赛账号 demo 时 `LARK_FEISHU_TENANT_DOMAIN=jcneyh7qlo8i.feishu.cn`。开发其它 tenant 可以临时覆盖。
  - 删除 m9 加的 "ENTRY: switch from messenger to calendar surface FIRST" 段（不再需要 sidebar 跳）。
  - few-shot 第一步从"点击 sidebar 日历图标"改回"直接点'新建日程'"。
- **bot bridge step heartbeat**
  - bot bridge 维护 `inFlight.heartbeatStepCount` 计数。
  - 收到 `webAgentStepUpdate` 时计数 +1；每 5 步且距上次 heartbeat ≥ 15 秒就调 lark-cli 发一条 reply：`⏳ 已执行 X 步：<最近 thought 摘要 ≤ 60 字>`。
  - 节流：固定 5-step 周期 + 至少 15 秒间隔（避免 stepUpdate 乱序集中触发刷屏）。
  - taskCompleted / failed / approval 时清 heartbeat 状态。
  - reply nonce 用 `heartbeat-<taskID>-<stepIndex>` 保证不会被飞书 server 幂等去重。
- **测试**：feishu-bot 加 heartbeat 节流单测；skills 加 calendar URL 断言（startingURL 包含 `/calendar/week` 或 env override 字段）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-agent-skills`：calendar URL 改 tenant-routed pattern；删除 messenger sidebar 引导段。
- `feishu-bot-bridge`：任务派发生命周期加 heartbeat 行为段（同步给 spec MODIFY）。

## Impact

- **代码**：
  - `runners/web-agent/src/skills/feishu_calendar_create.ts`：startingURL 改 env-driven 默认值；prompt 删 ENTRY 段 + few-shot 简化（约 -30 行 +20 行）
  - `runners/feishu-bot/src/main.ts`：inFlight 类型加 `heartbeatStepCount` / `lastHeartbeatAt`；handleBridgeEvent webAgentStepUpdate case 加 heartbeat 触发逻辑（约 +40 行）
  - `runners/feishu-bot/test/`：新增 `heartbeat.test.ts` 覆盖节流逻辑（约 80 行）；`skills.test.ts` 加 calendar URL 检查
- **协议**：bridge schema 不变；envelope 仅消费方变化。
- **依赖**：无新增。
- **风险**：
  - tenant URL hardcode 一个挑战赛账号——其他账号跑 calendar 需要改 env。这是单 tenant demo 期可接受的妥协；m11+ 加 sidebar 自动发现做泛化。
  - heartbeat 在飞书 IM 群聊里可能仍刷屏（虽然 m9 限定 P2P，未来开群聊时要重新评估节流）。
  - heartbeat 频率与 idempotency-key nonce 配合错可能造成两条 heartbeat 同 key 被去重——nonce 含 stepIndex 已经规避。
- **数据**：无。
- **运维**：dev.sh 启动时 demo 期间 set `LARK_FEISHU_TENANT_DOMAIN=jcneyh7qlo8i.feishu.cn`；README 加一行说明。
