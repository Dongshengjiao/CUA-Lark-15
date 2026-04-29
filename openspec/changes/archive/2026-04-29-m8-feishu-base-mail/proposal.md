## Why

team master plan（2026-04-28，钟梓文负责）要求 5/7 前出 `Base`（多维表格）+ `Mail`（邮箱）的最小 demo，验收线分别是：

- **Base**：跑通 `建表 → 字段 → 录入 → 视图`
- **Mail**：跑通 `写信 → 附件 → 发送 / 回复`

仓库当前的飞书 skill 只有 IM / Calendar / Doc 三个（M5 引入，M6/M7 hotfix 加固），漏了 Base 和 Mail。本 milestone 把这两个 skill 补上，至少打通"最小验收"路径（不必一次做到 master plan 全验收线，留 m9 / 真实 demo 时按需扩展）。

m8 的 prompt 写法**直接复用 m7 hotfix 的成熟五段模板**（ACTION SYNTAX / 强禁止 / OMNI-SEARCH FALLBACK / CONVENTIONAL FLOW / COMPLETION SIGNAL / FEW-SHOT），不再走 m5 时"prompt 不够强"再 m6 / m7 反复加固的弯路。

不收：
- master plan §3.3 进阶能力（异常恢复 / 自愈 / 多轮对话编排）—— 那是 5/5 后 polish。
- master plan §7 联动工作流（Base → Mail / IM → Calendar → Docs）—— 跨 skill 编排是 m9+ 的事。
- DOM-mode path B（m6 §8.1）—— 仍 backlog。
- demo.mov 录制（m6 task 6.6）—— agent 做不了。

## What Changes

- **新增 `feishu_base_create` skill**
  - `startingURL = loginURL = https://base.feishu.cn/`
  - `matchKeywords` 含中英 `多维表格` / `表格` / `bitable` / `base` / `飞书表格` / `lark base` 等
  - `systemPromptAddendum` 按 m7 hotfix 五段模板：ACTION SYNTAX（含坐标格式 + escape 全名约束）、IMPORTANT 强禁止段、OMNI-SEARCH FALLBACK（recovery-only）、CONVENTIONAL FLOW（点新建 → 选多维表格 → 输入名称 → 看到列表新增条目）、COMPLETION SIGNAL（新表出现在列表 + 编辑器加载）、FEW-SHOT
  - 阶段 1 最小验收：跑 `"在飞书新建一个多维表格，标题为 m8 base 测试"` → ≤ 25 step 完成 + 实际可见新表
- **新增 `feishu_mail_send` skill**
  - `startingURL = loginURL = https://mail.feishu.cn/`
  - `matchKeywords` 含中英 `邮件` / `邮箱` / `发邮件` / `mail` / `email` / `飞书邮件` / `lark mail`
  - `systemPromptAddendum` 按 m7 hotfix 五段模板，针对邮箱场景：CONVENTIONAL FLOW = 点写信 → 收件人输自己 → 输标题 → 输正文 → 发送；COMPLETION SIGNAL = 看到"已发送"toast 或邮件出现在已发送箱
  - 阶段 1 最小验收：跑 `"在飞书邮箱给自己写一封邮件，标题 'm8 mail 测试'，内容 'hello m8 mail'"` → ≤ 25 step 完成 + 真账号收到邮件
- **registry.ts 把两个新 skill 注册进去**
  - 排序按"关键词更窄优先"：`feishu_im_send` > `feishu_mail_send` > `feishu_calendar_create` > `feishu_doc_create` > `feishu_base_create`（mail 有专用 `邮件` token，calendar/doc 关键词较通用，base 关键词最广 `表格`）
- **skills.test.ts 加新 skill 的 prompt-keyword 断言** + **registry 长度断言从 ≥ 3 升到 ≥ 5**

## Capabilities

### New Capabilities

无。m8 是对现有 capability 的扩展。

### Modified Capabilities

- `web-agent-skills`: 把"3 个内置飞书 skill"扩到 "5 个"；ADDED 两个 skill 配置；MODIFY 现有 prompt 段落要求（把 m7 hotfix 引入的 ACTION SYNTAX 要求 retroactively sync 进 spec，覆盖所有 5 个 skill）；MODIFY skills.test.ts 覆盖要求（registry 长度 ≥ 5 + 新 skill 的关键词命中场景）

## Impact

- **代码**：
  - skills: 新增 `feishu_base_create.ts` + `feishu_mail_send.ts`（每个约 130 行，包含五段 prompt 模板）；registry.ts +2 行 import + 2 行数组项
  - tests: skills.test.ts 加 2 组 describe（每组同 m7 hotfix 的 doc/calendar 模板，3 个 prompt-keyword 断言）+ 把现有 registry 长度断言改成 `>= 5`
  - 无 runner / island 端代码变化
- **协议**：bridge schema 不变。
- **依赖**：无新增。
- **风险**：
  - **Bug A 在 base / mail 上是否复现未知**——飞书 base / mail 的 React UI 也有 .feishu.cn 顶部全局栏，理论上同样的视觉 grounding 风险。m8 prompt 用 m7 hotfix 模板预防性加 OMNI-SEARCH FALLBACK + 强禁止段。
  - **Mail "发送给自己"** 实际行为依赖飞书邮箱后端是否支持自发自收（IM 自聊就是飞书自带功能；mail 一般也支持把自己邮箱地址作收件人）。如果不行，验收 prompt 可以改成"发给某个固定测试地址"。
  - **Base 多维表格的"建表入口"** —— `https://base.feishu.cn/` 进去后是文件列表 + "+ 新建多维表格" 按钮；prompt 走"列表页 → 新建按钮"路径。可能因为飞书 base 偶尔提示"模板选择"弹窗，需要 OMNI-SEARCH FALLBACK 兜底。
  - **关键词路由冲突**：`表格` 可能跟未来的 `feishu_sheets`（普通电子表格，不在 m8 范围）冲突。m8 路由顺序把 base 放最后，让更专的 token 优先命中。
- **数据**：每个 skill 共享 `feishu` user-data-dir segment，可复用现有飞书登录 cookie。
- **运维**：用户首次跑 base / mail 任务时，如果 cookie 过期（飞书 cookie 7 天 TTL）需要重新扫码——这是 m7 Phase 0 修复后的正常流程，不是新风险。
