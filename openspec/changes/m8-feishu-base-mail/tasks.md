# 任务：m8-feishu-base-mail

## 1. feishu_base_create skill

- [x] 1.1 新建 [`runners/web-agent/src/skills/feishu_base_create.ts`](../../../runners/web-agent/src/skills/feishu_base_create.ts)。导出 `feishu_base_create: Skill`，配置：
  - `id = 'feishu_base_create'`
  - `displayName = '飞书多维表格'`
  - `matchKeywords` 含中英文 token：`多维表格` / `bitable` / `飞书表格` / `lark base` / `表格` / `base`
  - `cookieDomain = '.feishu.cn'`，`userDataDirSegment = 'feishu'`
  - `loginURL = startingURL = 'https://www.feishu.cn/drive/me/'`（M8 verify 第一次实测发现 `https://base.feishu.cn/` 是营销页非应用域，已切换到 Drive 入口）
- [x] 1.2 `systemPromptAddendum` 按 m7 hotfix 五段模板写：
  - **ACTION SYNTAX 段**：含 `start_box='[x1, y1, x2, y2]'` 单引号约束 + escape 全名约束（无 'esc' 缩写）
  - **IMPORTANT 强禁止段**：禁止点屏幕顶部全局搜索栏；明示新建按钮在 base 文件列表内 + "+ 新建多维表格"图标特征
  - **OMNI-SEARCH FALLBACK 段**：recovery-only 语义（base 的 omni-search 不能直接建表，模态出来 escape 退出再重试）
  - **CONVENTIONAL FLOW 段**：点 Drive 新建按钮 → 在下拉中选"多维表格"（不是"文档"）→ 等编辑器加载 → 输标题 → 看到列表条目更新 → finished()
  - **COMPLETION SIGNAL 段**：base 编辑器加载完成 + 标题渲染 + 列表中出现新条目；明示 finished('已创建飞书多维表格：<标题>')
  - **FEW-SHOT 段**：演示从 Drive → 新建 → 选多维表格 → 模板面板 → 标题输入 → finished 的步骤路径，所有 click 用单引号 start_box

## 2. feishu_mail_send skill（实施完成 → deferred stub）

- [x] 2.1 新建 [`runners/web-agent/src/skills/feishu_mail_send.ts`](../../../runners/web-agent/src/skills/feishu_mail_send.ts)。导出 `feishu_mail_send: Skill`，配置：
  - `id = 'feishu_mail_send'`
  - `displayName = '飞书邮箱'`
  - `matchKeywords` 含中英文 token：`邮件` / `邮箱` / `发邮件` / `mail` / `email` / `飞书邮件` / `lark mail`
  - `cookieDomain = '.feishu.cn'`，`userDataDirSegment = 'feishu'`
  - `loginURL = startingURL = 'https://mail.feishu.cn/'`（占位；待用户提供真实可达 URL 后更新——见 §7 retrospective）
- [x] 2.2 `systemPromptAddendum` 按 m7 hotfix 五段模板写：
  - **ACTION SYNTAX 段**：同上
  - **IMPORTANT 强禁止段**：禁止点顶部全局搜索栏；明示"写信"按钮通常在邮箱左上角（蓝色/亮色按钮，含图标 + "写信" / "Compose" 文字）
  - **OMNI-SEARCH FALLBACK 段**：recovery-only（mail omni-search 不能直接写信）
  - **CONVENTIONAL FLOW 段**：点写信 → 收件人输自己邮箱 → 标题字段 → 正文区 → 发送按钮 → 看到"已发送"toast 或已发送箱新增条目 → finished()
  - **COMPLETION SIGNAL 段**：toast / 已发送箱 / 草稿消失任一视觉信号；明示 finished('已通过飞书邮箱发送：<标题>')
  - **FEW-SHOT 段**：演示从收件箱 → 写信 → 输收件人/标题/正文 → 发送 → 已发送 toast → finished

## 3. registry 注册

- [x] 3.1 [`runners/web-agent/src/skills/registry.ts`](../../../runners/web-agent/src/skills/registry.ts) import 新 skill。M8 verify 后退化：仅 import + register `feishu_base_create`；`feishu_mail_send` 在文件级保留但**不**注册（见 §7 retrospective + 文件顶部 TODO 注释）。
- [x] 3.2 `registry` 数组顺序：`feishu_im_send` > `feishu_calendar_create` > `feishu_doc_create` > `feishu_base_create`（4 个，mail 暂不在内）。

## 4. 测试

- [x] 4.1 [`runners/web-agent/test/skills.test.ts`](../../../runners/web-agent/test/skills.test.ts) 把 `registry.length` 断言从 `>= 3` 升到 `>= 4`（M8 退化版：mail 不计入），加 base 到 5-skill 循环（含 mail，因 mail 文件保留），加 `expect(ids).not.toContain('feishu_mail_send')` 显式断言 mail 不在 registry。
- [x] 4.2 加 base / mail 各 4-5 个断言（同 m7 hotfix doc/calendar 的模板）：
  - addendum 含 `ACTION SYNTAX` + `WRONG` / `CORRECT` 标记 + `start_box='[`
  - addendum 含 `hotkey(key='escape')` 全名，**不含** `hotkey(key='esc')` 或 `press Esc`
  - addendum 含 `OMNI-SEARCH FALLBACK` + recovery 语义关键字
  - addendum 含 `finished(` + 视觉完成线索关键字
  - matchKeywords 含中英 token 各至少 1 个
  - base / mail 各自的 `startingURL` 字段断言（base = Drive；mail = mail.feishu.cn 占位）
- [x] 4.3 路由断言：
  - `selectSkill("在飞书新建一个多维表格，标题为 xxx", registry)` 返回 `feishu_base_create` ✓
  - `selectSkill("在飞书邮箱给自己写一封邮件，标题 'xxx'，内容 'yyy'", registry)` 返回 `null`（M8 退化版：mail deferred）

## 5. 编译与单元测试

- [x] 5.1 `cd runners/web-agent && npm run typecheck` 通过。
- [x] 5.2 `cd runners/web-agent && npm test` 全过：**87 tests**（m7 hotfix 时 72 → 第一次 propose +16 = 88 → 退化版 -1 = 87）。
- [x] 5.3 `cd lark-island && swift build && swift test` 全过：**32 tests**（不变；m8 不动 island 端）。

## 6. 端到端实跑

- [x] 6.1 起 `scripts/dev.sh`，runner ready 在 4-15 秒内。
- [x] 6.2 跑 base 任务：见 §7.1 实测数据（第二次跑通过；第一次因 startingURL 错而 22 step 跑空）。
- [-] 6.3 跑 mail 任务：**blocked**——见 §7.2。
- [x] 6.4 实测数据已补到 §7。

## 7. Post-implementation retrospective（实测于 2026-04-29 20:40-20:48 UTC+8）

### 7.1 task 6.2 — `feishu_base_create` 实测

**Run 1（startingURL 错误 → fail）**：
- prompt：`"在飞书新建一个多维表格，标题为 m8 base 测试"` / taskID `demo-m8-base`
- startingURL：`https://base.feishu.cn/`
- 结果：22 step events / 122s 后 `webAgentTaskCompleted` 但 `finalAnswer = ""`（GUIAgent 触发 max-loop 退出，不算真完成）
- thought 链路明示问题："The current view is still the landing hero section" / "we're not authenticated cannot access base dashboard" / "registration/login modal requiring a phone number"
- 根因：`base.feishu.cn` 是飞书多维表格的**对外营销页**，不是已认证的 Base 应用域。VLM 进入后看到 hero section + "免费使用" CTA，找不到"+ 新建"按钮。

**Run 2（startingURL 改为 Drive 入口 → 通过）**：
- 修法：把 startingURL / loginURL 改为 `https://www.feishu.cn/drive/me/`（与 doc skill 共享），prompt 增加引导"在'+ 新建'下拉中选'多维表格'而非'文档'"
- prompt：同 Run 1 / taskID `demo-m8-base-2`
- 结果：✅ **14 step events / 62.9s** 完成
- finalAnswer：`The title has been successfully updated to "m8 base 测试" in the title bar, and the multidimensional table grid is fully rendered with rows and columns visible. Both completion conditions are met...`
- thought 链路完美按 prompt 走：识别 Drive 新建 → 选"多维表格" → 模板面板 → 表格编辑器加载 → 标题输入 → finished()
- 0 次 `webAgentApprovalRequested(login_qr)`（Bug C 修复持续生效，cookie 复用）

**判定**：task 6.2 ✅ 通过（≤ 25 step / 文档真创建）。

### 7.2 task 6.3 — `feishu_mail_send` 实测：BLOCKED

- prompt：`"在飞书邮箱给自己写一封邮件，标题 'm8 mail 测试'，内容 'hello m8 mail'"` / taskID `demo-m8-mail`
- startingURL：`https://mail.feishu.cn/`
- 结果：**触发 `webAgentApprovalRequested(login_qr)` 一次** → 进入 visible chromium 扫码流程 → 用户截图显示 chrome 报 `ERR_NAME_NOT_RESOLVED`（"找不到 mail.feishu.cn 的服务器 IP 地址"）→ 用户中断
- 根因：**用户当前的飞书挑战赛账号未开通飞书企业邮箱产品**。系统层 `nslookup mail.feishu.cn` 解析得到 IP，但用户网络/账号在浏览器层无法访问到任何 Mail 应用界面（产品未启用）。这是**账号/产品**层面的硬阻断，不是 prompt / 视觉 grounding / 模板的问题。

**处理**：mail skill 退化为 deferred stub——
- 文件 `feishu_mail_send.ts` 顶部加大段 TODO 注释，明示 unblock 条件 + 操作。
- `registry.ts` 不导入 / 不注册 mail skill；保留四个 active skill。
- `skills.test.ts` 把 mail 路由测试改为 `expect(...).toBeNull()`，registry 长度断言降到 `>= 4`，并显式断言 `expect(ids).not.toContain('feishu_mail_send')`。
- mail 的 prompt-keyword 模板断言（ACTION SYNTAX / escape / OMNI-SEARCH FALLBACK / finished / matchKeywords / startingURL）**保留**——文件级测试，防 prompt bit-rot。
- 等真实 Mail 入口 URL 确认后，仅需在 registry.ts 加回一行 import + 一行数组项即可激活。

**判定**：task 6.3 `[-]` blocked。不算 m8 失败——base 是钟梓文 master plan §5 验收线的"建表"主路径，已交付。Mail 等账号侧具备产品能力后再回来收。

### 7.3 给下一回合（unblock mail）的输入

1. 切到一个**已开通飞书邮箱**的账号（个人 / 公司 / 试用），或者从产品团队拿到挑战赛账号开通邮箱产品的资源。
2. 登录飞书后，在浏览器地址栏复制实际可达的 Mail 入口 URL。
3. 更新 `feishu_mail_send.ts` 的 `loginURL = startingURL` 为该 URL。
4. 在 `registry.ts` 恢复 import + 数组项（`feishu_mail_send` 按 §D3 顺序放在 `feishu_im_send` 之后）。
5. 把 `skills.test.ts` 里的 mail-deferred 断言反转回去（registry 长度 `>= 5`、ids 包含 mail、`selectSkill(...)` 返回 `feishu_mail_send`、startingURL 断言改成新 URL）。
6. 跑 `npx tsx test/observer-client.ts demo-mail "..."` 验证 ≤ 25 step + 真账号收到邮件。
7. 在本 retrospective 后补一段 §7.4 实测记录或单独开 m9 / hotfix。

### 7.4 给 master plan §5 钟梓文负责子产品的进度

| 子产品 | master plan 验收线 | 当前 m8 状态 |
|---|---|---|
| **Base** | 建表 → 字段 → 录入 → 视图 | ✅ **建表已通**（14 step / 62s）；字段 / 录入 / 视图是 stage 2，5/2-5/5 排期 |
| **Mail** | 写信 → 附件 → 发送 / 回复 | 🟡 实施完成、单测覆盖、暂未注册；blocked 在账号未开通邮箱，等用户切账号或拿真实 URL 解锁 |

## 8. 收尾

- [ ] 8.1 `npx @fission-ai/openspec validate m8-feishu-base-mail --strict` 干净通过。
- [ ] 8.2 拆 commit（4 个）：
  - `feat(skills): add feishu_base_create skill (m8)`（task 1.x）
  - `feat(skills): add feishu_mail_send skill (m8)`（task 2.x）
  - `test(skills): cover feishu_base_create + feishu_mail_send routing & prompts (m8)`（task 3.x / 4.x）
  - `chore(openspec): archive m8-feishu-base-mail`（task 8.3 之后做的）
- [ ] 8.3 `/opsx-archive m8-feishu-base-mail` 把 modified delta sync 进 `openspec/specs/`。
