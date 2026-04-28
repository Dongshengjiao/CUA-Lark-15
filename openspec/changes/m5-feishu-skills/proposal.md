## Why

M4 把灵动岛 UI、BridgeServer 路由和 runner supervisor 全部接通了，但 runner 收到 `runWebAgentTask` 后只能跑"通用模式"——没有 skill 概念，没法引导 GUIAgent 在飞书 web 应用里完成「发消息 / 创日程 / 建文档」这种业务任务。比赛 demo 必须能至少演示一条飞书任务（plan 里 M6 Demo B 强依赖），现在零基础。

同时，飞书 web 第一次访问时一定要扫码登录——但 v0 runner 是 `headless: true`，用户根本看不到二维码。我们需要在 M5 里把"检测未登录 → 切 headless:false → 推送 `webAgentApprovalRequested(kind: login_qr)` → 等扫码 → 切回 headless 继续任务"这一整套链路落地，否则飞书 demo 跑不起来。

## What Changes

- 在 `runners/web-agent/` 新增 **skill 框架**：定义 `Skill` interface（system prompt / starting URL / cookie domain 列表 / 任务关键词），三个内置 skill 实现（`feishu_im_send` / `feishu_calendar_create` / `feishu_doc_create`），以及一个**关键词路由器**根据 prompt 自动选 skill；非飞书 prompt 走通用模式（不指定 skill）。
- 在 runner 里新增 **headless 切换协议**：当 skill 声明的 cookie domain 缺少有效 cookie 时，销毁当前 LocalBrowser、用同一 `userDataDir` 重 launch `headless: false` 的 visible Chromium，导航到 skill 指定的登录入口，发 `webAgentApprovalRequested(kind: "login_qr", message: "请扫码登录飞书")` envelope，每 2s 检查登录态，30 分钟超时；登录成功后切回 headless 并继续原任务。
- 在 runner 里新增 **持久化 user-data-dir**：每个 skill 域名一份独立的 `~/Library/Application Support/LarkIsland/web-agent/profiles/<skill-id>/`，cookies / localStorage / IndexedDB 全部落盘，下次任务直接命中已登录态。
- 在 LarkIslandApp 端新增 **审批请求 UI**：灵动岛收到 `webAgentApprovalRequested` 时把 phase 切到 `.waitingForApproval` 并展示"请扫码登录飞书"提示；用户在 visible Chromium 里完成扫码后 phase 自动回 `.running`。
- 在 BridgeCommand 上新增可选字段 `cookieDomain`（runner 上报当前任务正在用的域）让 LarkIslandApp 在跨任务复用同一登录态时知道是否需要再次审批；这个字段可选、对 v0 通用模式无影响。
- 关键词路由命中阈值放在 skill registry 里，便于后续扩展（如 google search / github 等其它 skill）。

## Capabilities

### New Capabilities
- `web-agent-skills`: skill 注册中心、关键词路由、内置 skill（飞书 IM/日历/文档）、headless ↔ visible 切换协议、user-data-dir 隔离与 cookie 持久化策略

### Modified Capabilities
- `web-agent-runner-service`: runner 任务调度路径增加 skill resolution 阶段；GUIAgent 启动前注入 skill 的 system prompt 与 starting URL；登录态丢失时进入"扫码模式"挂起当前任务直到登录回复；不再只支持单一 LocalBrowser 实例
- `lark-island-app`: AppModel 处理 `webAgentApprovalRequested` 事件，灵动岛 opened 态新增"扫码中"渲染分支；审批结束后把 phase 还原回 running

## Impact

- **代码**：
  - 新增 `runners/web-agent/src/skills/` 目录（约 4-6 个新 .ts 文件 + 测试）；
  - 修改 `runners/web-agent/src/agent/runtime.ts` 让 `runTask` 接受 skill 参数并在 GUIAgent 之前先做"登录预检"；
  - 修改 `runners/web-agent/src/runner.ts` 让 router 在 dispatch 之前调；
  - LarkIslandApp 端 `Views/IslandPanelView.swift` opened 态新增 approval 渲染（约 30 行），`AppModel.swift` 加 approval 事件订阅；
- **协议**：bridge schema 不破坏（M2 时已定义 `webAgentApprovalRequested`，本里程碑首次实际产出+消费）
- **依赖**：runner 仍旧 puppeteer-core via `@agent-infra/browser` 0.1.1；不引入 puppeteer-extra-plugin-stealth 等额外 npm 包（plan 风险 5 留 M7+ 处理）
- **数据**：用户首次扫码登录会在 `~/Library/Application Support/LarkIsland/web-agent/profiles/feishu/` 写大量 chromium profile 数据；M7 打 DMG 时记得列入"清理用户数据"指引
- **风险**：飞书 React 应用在 Qwen3-VL-Plus 提示下 click 坐标可能不稳；本里程碑保留 fallback path（在 design.md 中讨论），如 demo 期间真撞墙就降级 DOM 模式
