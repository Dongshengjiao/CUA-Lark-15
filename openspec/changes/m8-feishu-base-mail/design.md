# 设计：M8 — 飞书 Base + Mail skill

## 背景（Context）

team master plan（2026-04-28，§5）把六个飞书子产品分给三个人，钟梓文负责 Base + Mail。仓库已有 IM / Calendar / Doc 三个 skill（M5 引入；M6/M7 加固命中率与 prompt 模板），m8 把 Base + Mail 补上，让钟梓文负责的两个子产品也有可执行的 web-agent skill。

涉及方：
- m8 实施者：你 + AI（钟梓文）
- master plan §6 联动工作流（Docs / Base → Mail）的实施者：m9+ 接手；m8 只交付独立 skill，不做跨 skill 编排

约束：
- **不引入 DOM 模式（path B）**—— 仍走 VLM coordinate-based click，prompt 模板继承 m7 hotfix。
- **不打包**：m8 仍 dev 模式跑。
- **不动 BridgeServer / SessionState / runner 主流程**。
- **阶段 1 minimum demo**：base 仅"建表"、mail 仅"写信 + 发送"。master plan §5 列的"字段 / 录入 / 视图 / 附件 / 回复"留给阶段 2（5/2-5/5 排期）。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**
- `feishu_base_create` skill 跑通"在飞书新建一个多维表格，标题为 xxx" → ≤ 25 step events 完成 + 真飞书账号能在 base.feishu.cn 看到新表。
- `feishu_mail_send` skill 跑通"在飞书邮箱给自己写一封邮件，标题 yyy，内容 zzz" → ≤ 25 step events 完成 + 真账号能收到邮件。
- 两个 skill 的 prompt 用 m7 hotfix 五段模板（ACTION SYNTAX / 强禁止 / OMNI-SEARCH FALLBACK / CONVENTIONAL FLOW / COMPLETION SIGNAL / FEW-SHOT），无早期 m5 那种 prompt 不够强的回归。
- registry 路由能把"多维表格"/"邮件"等关键词正确分发到对应 skill。
- skills.test.ts 加 prompt-keyword 断言防退化。

**非目标：**
- 不做 master plan §5 的"字段 / 录入 / 视图"扩展（base 阶段 2）。
- 不做 master plan §5 的"附件 / 回复"（mail 阶段 2）。
- 不做 master plan §7 的联动工作流（Base → Mail）。
- 不做 DOM 模式（仍 backlog）。
- 不动 IM / Calendar / Doc 三个 skill 的 prompt（m7 archive + m7 hotfix 已经稳定）。
- 不做 demo.mov 录制。

## 关键决策（Decisions）

### D1：startingURL 选 base.feishu.cn / mail.feishu.cn 独立子域

**Base**：`https://base.feishu.cn/` —— 多维表格官方独立子域，登录后是用户的 base 文件列表 + "+ 新建多维表格" 入口。

考虑过 `https://www.feishu.cn/drive/me/`（同 doc）—— reject。Drive 入口虽然也能新建多维表格，但要先点新建下拉、选"多维表格"，多 1-2 步。base.feishu.cn 直接就是 base 列表，更短。

**Mail**：`https://mail.feishu.cn/` —— 飞书邮箱独立子域，登录后是收件箱 + "写信"按钮。

WebFetch 验证：base 200，mail 503（503 是登录前默认行为，登录后可达）。两个 URL 与 IM/Calendar/Doc 一样都是 .feishu.cn 子域，cookie 共享同一 segment。

### D2：matchKeywords 以"产品中文名"为主

**Base** 关键词（按辨识度排序）：
- 高辨识：`多维表格` / `bitable` / `飞书表格` / `lark base` —— 几乎只对应 base
- 中辨识：`表格` / `base` —— 可能跟未来的 `feishu_sheets`（普通电子表格）冲突，但 m8 范围内独占

**Mail** 关键词：
- 高辨识：`邮件` / `邮箱` / `飞书邮件` / `lark mail`
- 中辨识：`mail` / `email` / `发邮件` —— 单独 token 也能命中真实 prompt

m8 不引入"sheet" / "电子表格" / "spreadsheet"——那是后续单独 skill。

### D3：registry 顺序按"关键词更窄优先"

新顺序（首匹配返回）：
1. `feishu_im_send` —— 最常用
2. `feishu_mail_send` —— `邮件` token 几乎专用
3. `feishu_calendar_create` —— `日程/会议` 较专
4. `feishu_doc_create` —— `文档/笔记`
5. `feishu_base_create` —— `表格` token 最广，留最后

考虑过：把 base 放第二位（与 mail 同样 newcomer，对称）—— reject。`表格` token 比 `邮件` 通用得多（用户可能说"在飞书做一个表格记录..."→ 走 sheet/普通表格 → m8 不该抢）。把 base 放最后既符合"窄优先"原则，也给未来 `feishu_sheets` 留路。

### D4：prompt 模板 = m7 hotfix 五段（ACTION SYNTAX / 强禁止 / OMNI-SEARCH FALLBACK / CONVENTIONAL FLOW / COMPLETION SIGNAL / FEW-SHOT）

每个新 skill 的 systemPromptAddendum 按这个模板写，针对 base / mail 的具体 UI 调整 IMPORTANT 段、CONVENTIONAL FLOW 步骤、COMPLETION SIGNAL 视觉特征、FEW-SHOT 路径。

OMNI-SEARCH FALLBACK 在 base / mail 也是"recovery-only"语义（同 doc / calendar，区别于 IM）：模态弹出时 escape 退出，重试 conventional 路径——base / mail 的 omni-search 不能直接创建表 / 写邮件。

### D5：阶段 1 验收 prompt 选最小可执行路径

- **Base**：`"在飞书新建一个多维表格，标题为 m8 base 测试"` —— minimum demo 等价于 doc create 的 minimum（只新建，不填字段、不录入数据、不切视图）。COMPLETION SIGNAL = 列表里出现新表 + 编辑器加载完成 + 标题已设。
- **Mail**：`"在飞书邮箱给自己写一封邮件，标题 'm8 mail 测试'，内容 'hello m8 mail'"` —— 写自己邮箱地址不要求查 IM 联系人那种步骤。COMPLETION SIGNAL = 看到"已发送"toast 或邮件出现在已发送箱。

实测时如果发现 mail "发给自己" 飞书后端不接受（少见），改成 prompt 里直接给一个测试邮箱地址。

### D6：测试覆盖 = 复用 m7 hotfix doc/calendar 的断言模式

`skills.test.ts` 给 base / mail 各加 3 个断言（同 doc/calendar）：
1. ACTION SYNTAX 段存在 + WRONG / CORRECT 标记
2. `hotkey(key='escape')` 全名 + 无 'esc' 缩写
3. OMNI-SEARCH FALLBACK 段存在 + recovery 语义

加 1 个全 registry 断言：`registry.length >= 5` + 包含 `feishu_base_create` / `feishu_mail_send` 的 id。

加 2 个路由断言：`"在飞书新建一个多维表格..."` → `feishu_base_create`；`"在飞书邮箱给自己写一封邮件..."` → `feishu_mail_send`。

### D7：spec 同步把 m7 hotfix 没 sync 的 ACTION SYNTAX 要求一起补

m7 hotfix（commit `890bbfe`）给 doc/calendar 加了 ACTION SYNTAX 段，但因为是直接 commit 没走 OpenSpec change，spec 没更新。m8 顺手把这块 sync 进去：spec 里"飞书 skill 的 systemPromptAddendum 必须包含..."的 Requirement 升级为：`所有 5 个内置飞书 skill 的 systemPromptAddendum SHALL 包含 ACTION SYNTAX 段（IM 已隐含遵循 + doc/calendar/base/mail 显式要求）`。

## 风险 / 取舍（Risks / Trade-offs）

- **Base / Mail 的 VLM 命中率未知** —— m7 hotfix 模板是 IM/doc/calendar 实测验证有效的，但 base / mail 的 React UI 不一定一样布局。如果实测 ≤ 25 step 跑不通，按 m6 retrospective §9.5 的处理路径（继续 prompt 加固或启动 path B）。
- **Mail 自发自收行为** —— 大多数公司邮箱支持。如果飞书企业邮箱有限制，prompt 改成 hardcode 测试邮箱。
- **关键词冲突** —— `表格` 在未来跟 sheet 冲突；m8 用 registry 顺序兜底，base 放最后。
- **Base 多维表格新建路径有"模板选择"弹窗** —— 飞书可能首次新建会问"空白表 / 用模板"。prompt few-shot 演示选"+ 新建空白表"或类似选项，OMNI-SEARCH FALLBACK 段也兜底"如果模板面板出来了就选第一个 + 关闭模态"。

## 迁移计划（Migration Plan）

m8 是 polish 增量，无数据迁移。落地步骤：

1. 写 `feishu_base_create.ts`（按 m7 模板）。
2. 写 `feishu_mail_send.ts`（按 m7 模板）。
3. 改 `registry.ts` 加两个新 skill。
4. 改 `skills.test.ts` 加断言（base/mail 各 3 个 prompt-keyword 断言 + 2 个路由断言 + registry 长度升到 ≥ 5）。
5. `npm run typecheck && npm test` 全过。
6. `swift build && swift test` 全过（保险）。
7. 起 `scripts/dev.sh`，跑 base 任务实测：`npx tsx test/observer-client.ts demo-m8-base "在飞书新建一个多维表格，标题为 m8 base 测试"`。
8. 跑 mail 任务实测：`npx tsx test/observer-client.ts demo-m8-mail "在飞书邮箱给自己写一封邮件，标题 'm8 mail 测试'，内容 'hello m8 mail'"`。
9. 实测数据填 `tasks.md` retrospective 段。
10. archive m8。

回滚：m8 是独立 commit 链；如有阻塞 git revert 到 m7 hotfix commit (`890bbfe`) 即可。

## 待解决问题（Open Questions）

1. **base 新建表入口的实际位置** —— 不知道 base.feishu.cn 默认登录后是直接进列表还是其它视图。实测时根据真实截图调整 prompt 的 few-shot 坐标提示。
2. **mail 写信窗口是模态还是页面** —— 飞书邮箱的"写信"可能是右侧抽屉、底部弹窗或全屏页面。实测时根据真实情况决定 COMPLETION SIGNAL 的视觉锚点。
3. **base 阶段 2 范围如何切** —— 阶段 1 跑通后，"字段 → 录入 → 视图"是不是再开 m9 还是直接补到 m8？m8 archive 后看 step 数余量决定。
4. **mail 自发自收是否限流** —— 实测前不知道。如果触发限流，prompt 改成"发给固定测试邮箱"。
