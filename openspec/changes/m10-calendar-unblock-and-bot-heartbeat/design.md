# 设计：M10 — calendar tenant-URL fix + bot 进度心跳

## 背景（Context）

m9 archive 后 24 小时内立项；截止 5/2 demo（约剩 60 小时含休息）。m9 archive §9.4 实测发现 calendar startingURL 是个连环坑：m5 起 `calendar.feishu.cn` 写死 5 milestone，m9 hotfix 改成 messenger sidebar 跳转，puppeteer chromium 加载 messenger 后实际进 docs 主页，sidebar 看不到日历图标 → call_user 优雅放弃。

用户提供了真实可达的飞书日历 URL：`https://jcneyh7qlo8i.feishu.cn/calendar/week`——挑战赛账号 tenant 专属子域，路径 `/calendar/week`。验证可达性 + 直接用作 startingURL 是 calendar unblock 的最直接方案。

bot bridge 第二个体验缺口在 m9 verify-run §9.2 暴露：用户连发同 prompt 时第二条卡 inFlightTask 锁了 30+ 秒只看到一条"上一条还在跑"；正常 80-95s 任务中段用户在 IM 端看不到任何 step 进度信号——只能等终态 reply 或者去 Mac 桌面看灵动岛。Demo 现场观众不在 Mac 桌面前。

涉及方：钟梓文（master plan §5 主链负责 + UI 收口）。本 milestone 完后 calendar/IM/base 三个飞书 skill 通过 IM 入口都可演示，灵动岛 + bot 双视图都能看到任务进度。

约束：
- 不改 BridgeServer / runner / 协议 / island UI。
- 不引入 LLM-driven task plan layer（推 m11+）。
- 单 tenant 账号 demo 期可接受 hardcode（默认值），多 tenant 用 env 覆盖。
- heartbeat 必须节流——绝不让飞书 IM 在 30 step 任务里收到 30 条机器人消息刷屏。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**
- `feishu_calendar_create` skill 端到端可创建一条日程：≤ 25 step events，飞书日历视图能看到带标题的事件块，bot IM 收到 ✅ 回执含 YYYY-MM-DD 时间。
- bot bridge 在长任务（≥ 20 step events）中至少给原 chat 推送 1 条进度 heartbeat；短任务（≤ 16 step events）不推送（保持 m9 干净的 ack/ack-completed 二段语义）。
- calendar / IM / base 三类任务都能通过 m10 后的 dev.sh 配置在飞书 IM 入口端到端跑通。

**非目标：**
- 不做联动工作流 / task chain orchestration（m11）。
- 不做多 tenant 自动发现（demo 期 hardcode 默认值 + env 覆盖足够）。
- 不修飞书 web app 在 puppeteer chromium 下 redirect / sidebar 折叠等环境差异（直接绕过用 tenant URL）。
- 不给 calendar prompt 加更多 visual grounding hint（先看实测命中率，差再补）。

## 关键决策（Decisions）

### D1：calendar startingURL = `https://${LARK_FEISHU_TENANT_DOMAIN}/calendar/week`，env 变量驱动 + 默认值

```ts
const TENANT_DOMAIN = process.env.LARK_FEISHU_TENANT_DOMAIN ?? 'jcneyh7qlo8i.feishu.cn';
const startingURL = `https://${TENANT_DOMAIN}/calendar/week`;
```

考虑过：
- **完全 hardcode `jcneyh7qlo8i.feishu.cn`**：reject。多 tenant 时需要改源码不友好。
- **写到 skill registry 配置文件**：reject。skill 当前是纯 TS 对象 export，加配置文件多一层抽象，m10 时间紧不值。
- **从飞书 OpenAPI 查 tenant_key 自动派生**：reject。m11+ 范围；当前 demo 一个账号够用。
- **路径用 `/calendar` 而非 `/calendar/week`**：reject。`/calendar` 默认重定向到 `/calendar/week`，直接用最终 URL 少一次跳。

### D2：删除 m9 加的 ENTRY (sidebar nav) 段；few-shot 简化

m9 hotfix 加了一段教 VLM 在 messenger sidebar 找日历图标。m10 直接落到 calendar URL 后这段冗余且会让 VLM 困惑（VLM 看到的是 calendar 视图本身，不是 messenger）。删掉。

few-shot 首步从"点 sidebar"改回"直接点'新建日程'"——VLM 能 ground 到日历视图就能看到左上角"创建日程"按钮（已是 m8 / m7 的 prompt 默认形态，回归即可）。

### D3：bot bridge heartbeat 触发条件 = "5 step + 15 秒"双维度节流

```ts
inFlight = {
  ...
  totalSteps: 0,                  // 累计 stepUpdate 数
  lastHeartbeatStep: 0,
  lastHeartbeatAt: 0,
};

// on webAgentStepUpdate:
inFlight.totalSteps += 1;
const stepsSinceLast = inFlight.totalSteps - inFlight.lastHeartbeatStep;
const msSinceLast = Date.now() - inFlight.lastHeartbeatAt;
if (stepsSinceLast >= 5 && msSinceLast >= 15_000) {
  fireHeartbeat();
  inFlight.lastHeartbeatStep = inFlight.totalSteps;
  inFlight.lastHeartbeatAt = Date.now();
}
```

效果：
- 任务 ≤ 4 step：0 条 heartbeat（仍是 ack + 终态二段语义）
- 任务 5-16 step：可能 0-1 条 heartbeat（取决于步速）
- 任务 ≥ 20 step：至少 2-3 条 heartbeat
- 飞速任务（5 step / 5s）不会因为 step 多就连发 heartbeat（受 15s 间隔门控）

考虑过：
- **每个 step 都发**：reject，30 step 任务直接刷屏。
- **基于固定时间（每 30s）**：reject，快任务节奏太松，慢任务（步间长 wait）漏推送。
- **每 N step（N=3 / 7 / 10）**：5 是 m9 实测里"用户开始失去耐心"的 step 数甜区。

### D4：heartbeat reply 文案 = thought 摘要前 60 字 + step 数

```
⏳ 已执行 X 步：<thought 截 60 字>...
```

如果 thought 为空字符串（截图 step），fallback 为：

```
⏳ 已执行 X 步…
```

考虑过：
- **完整 thought**：reject，可能几百字，飞书 IM 阅读体验差。
- **截图 inline**：reject，飞书机器人发图要走文件上传 + image_key 流程，复杂度过高。
- **markdown 表格**：reject，纯文本简单稳。

### D5：reply nonce 加 stepIndex 防幂等去重

```ts
nonce: `heartbeat-${taskID}-${stepIndex}`,
```

每条 heartbeat 的 nonce 唯一（不同 stepIndex），跟 m9 的 ack/busy/completed/failed 同款 idempotency 处理。

## 风险 / 取舍（Risks / Trade-offs）

- tenant URL hardcode 一个挑战赛账号 ——5/2 demo 期可接受，README 加一行 env 说明，m11+ 通过 OpenAPI tenant 信息自动派生。
- heartbeat 文案是 thought 摘要——thought 内容由 VLM 输出，可能含中英混合 / 格式怪。截 60 字按 unicode code point 处理（不按字节）。
- heartbeat 失败时只 log warn 不影响主链路（同 ack-reply 失败处理）。
- m9 实测 IM 任务 22-24 step / base 16 step → IM 任务会触发 ≥ 1 条 heartbeat，base 临界。验证：实测如果 base 没 heartbeat 也算正常（D3 阈值就是这么设的）。

## 迁移计划（Migration Plan）

1. 改 `feishu_calendar_create.ts` startingURL + 删 ENTRY 段 + few-shot 简化。
2. 改 `runners/feishu-bot/src/main.ts`：inFlight 类型 + heartbeat 触发逻辑。
3. 加 `runners/feishu-bot/test/heartbeat.test.ts`：节流逻辑单测。
4. 改 `skills.test.ts` 加 calendar URL pattern 断言。
5. typecheck + npm test 全过。
6. swift build / swift test 不变（island 不动）。
7. 起 dev.sh 配 `LARK_FEISHU_TENANT_DOMAIN=jcneyh7qlo8i.feishu.cn`；实测 calendar 任务 + 实测一条长任务（如 IM 自聊或 base）看 heartbeat。
8. retrospective + archive。

回滚：m10 是独立 commit 链；revert 到 m9 archive commit (`b27e866`) 即可。

## 待解决问题（Open Questions）

1. tenant 子域 `jcneyh7qlo8i.feishu.cn` 是否对所有 sub-route（messenger / drive / base / mail）都用相同 host？如果是，IM/Drive 等 skill 也可统一 tenant routing。m10 不动，m11 调研。
2. heartbeat thought 摘要规则——VLM thought 可能含 think-tag / markdown / emoji，要不要 sanitize？m10 暂不处理，看实测体验。
3. heartbeat 在 step 0 / 1 那种"刚截图还没 thought"的 envelope 上要不要发？D3 阈值"5 step"已经天然规避（前 4 步不会发 heartbeat），不用单独逻辑。
