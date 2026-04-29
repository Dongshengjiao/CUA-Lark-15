## MODIFIED Requirements

### Requirement: 内置飞书 skill 必须配置正确

仓库 SHALL 包含以下五个内置飞书 skill 的实现，并把其中**四个**注册进 `registry.ts`（`feishu_mail_send` 是 M8 deferred stub，文件 + prompt 模板存在但暂不注册——M8 verify run 实测发现现用挑战赛账号未开通飞书邮箱产品，`mail.feishu.cn` 在用户浏览器返回 ERR_NAME_NOT_RESOLVED，强制路由到该 skill 会让 QR 登录流程死循环；待找到可达的 Mail 入口 URL 后单行恢复 import + array entry 即可解锁）：

**`feishu_im_send`**
- `matchKeywords` 至少包含一个高信号中文 token（如 `消息`、`聊天`、`im`）和一个高信号英文 token（如 `message`、`chat`、`send im`）；不必使用组合词，单个 token 即可命中真实用户 prompt（实测 prompt `"在飞书给自己发条消息：xxx"` 必须能命中本 skill）。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `loginURL = startingURL = "https://www.feishu.cn/messenger/"`（依赖飞书前端 redirect 到登录页）。
- `systemPromptAddendum` 至少包含强禁止段、完成判定段、few-shot 范例（详见下面 Requirement"飞书 skill 的 systemPromptAddendum 必须包含..."）。

**`feishu_mail_send`（M8 deferred stub）**
- `matchKeywords` 至少包含一个高信号中文 token（如 `邮件`、`邮箱`、`发邮件`）和一个高信号英文 token（如 `mail`、`email`、`feishu mail`、`lark mail`）。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `loginURL = startingURL` 当前指向 `"https://mail.feishu.cn/"`（占位；实际入口 URL 待确认）。
- `systemPromptAddendum` 引导写信 → 收件人 → 标题 → 正文 → 发送 → 验证已发送，且包含强禁止段、完成判定段、few-shot 范例、ACTION SYNTAX 段、OMNI-SEARCH FALLBACK 段。
- **不注册到 `registry.ts`**——文件保留 + 测试保留 prompt-keyword 断言，等真实 Mail 入口 URL 确认后单行恢复注册。

**`feishu_calendar_create`**
- `matchKeywords` 至少包含一个高信号中文 token（如 `日程`、`日历`、`会议`）和一个高信号英文 token（如 `calendar`、`schedule`、`meeting`）。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `loginURL = startingURL = "https://calendar.feishu.cn/"`。
- `systemPromptAddendum` 引导填标题/时间/参与人/创建，且包含强禁止段、完成判定段、few-shot 范例、ACTION SYNTAX 段、OMNI-SEARCH FALLBACK 段。

**`feishu_doc_create`**
- `matchKeywords` 至少包含一个高信号中文 token（如 `文档`、`笔记`）和一个高信号英文 token（如 `doc`、`document`、`note`）。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`。
- `systemPromptAddendum` 引导新建 → 输入标题 → 写正文，且包含强禁止段、完成判定段、few-shot 范例、ACTION SYNTAX 段、OMNI-SEARCH FALLBACK 段。

**`feishu_base_create`（M8 新增）**
- `matchKeywords` 至少包含一个高信号中文 token（如 `多维表格`、`表格`、`飞书表格`）和一个高信号英文 token（如 `bitable`、`base`、`lark base`）。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`（与 `feishu_doc_create` 共享 Drive 入口；prompt 通过引导 VLM 在"+ 新建"下拉中选"多维表格"而非"文档"来区分。M8 第一次实测使用 `https://base.feishu.cn/` 失败——那是营销主页而非已认证应用域，VLM 进入后看到 hero section 找不到"+ 新建"按钮，22 step 跑空）。
- `systemPromptAddendum` 引导新建多维表格 → 输入标题 → 验证创建成功，且包含强禁止段、完成判定段、few-shot 范例、ACTION SYNTAX 段、OMNI-SEARCH FALLBACK 段。

#### Scenario: feishu_im_send 命中并配置正确
- **WHEN** runner 跑 prompt `"给张三发条飞书消息：明天下午会议"`
- **THEN** router 返回 `feishu_im_send`
- **AND** runner launch chromium 时 navigate 到 `feishu_im_send.startingURL`
- **AND** 注入 `feishu_im_send.systemPromptAddendum` 到 GUIAgent 的 system prompt

#### Scenario: feishu_doc_create 命中并配置正确
- **WHEN** runner 跑 prompt `"在飞书创建一个文档记录今天的会议纪要"`
- **THEN** router 返回 `feishu_doc_create`
- **AND** runner navigate 到飞书文档入口
- **AND** 注入文档相关的 systemPromptAddendum

#### Scenario: 飞书 IM 单 token 中文 prompt 也能命中
- **WHEN** prompt = `"在飞书给自己发条消息：hello from m5"`
- **THEN** router 返回 `feishu_im_send`（"消息" token 单独命中）

#### Scenario: feishu_base_create 命中并配置正确（M8 新增）
- **WHEN** runner 跑 prompt `"在飞书新建一个多维表格，标题为 m8 base 测试"`
- **THEN** router 返回 `feishu_base_create`
- **AND** runner navigate 到 `https://www.feishu.cn/drive/me/`（Drive 入口，与 doc skill 共享）
- **AND** 注入 base 相关的 systemPromptAddendum，其中明确指引"在'+ 新建'下拉中选'多维表格'而非'文档'"

#### Scenario: feishu_mail_send 暂未注册时邮件 prompt 落到通用模式（M8 deferred）
- **WHEN** runner 跑 prompt `"在飞书邮箱给自己写一封邮件，标题 'm8 mail 测试'，内容 'hello m8 mail'"`
- **AND** `feishu_mail_send` 当前不在 registry 中
- **THEN** router 返回 `null`
- **AND** runner 走通用模式（不注入 mail-specific systemPromptAddendum）
- **AND** 不应错误地路由到 `feishu_im_send` / `feishu_doc_create` 等其它 skill（matchKeywords 应严格按设计区分）

### Requirement: skill registry 单元测试覆盖路由 + 注册完整性

`runners/web-agent/test/skills.test.ts` MUST 包含以下覆盖：

- registry 长度 ≥ 4 且包含四个**已激活**的内置 skill 的 id（`feishu_im_send` / `feishu_calendar_create` / `feishu_doc_create` / `feishu_base_create`）；同时 MUST 显式断言 `feishu_mail_send` **不**出现在 registry 中（M8 deferred stub）。
- 每个**已激活**或文件级存在的 skill 通过 schema check（必填字段都存在），包括 `feishu_mail_send`（即使不注册，文件实现也必须满足 schema）。
- router 测试至少覆盖：飞书 IM 关键词命中、文档关键词命中、英文关键词命中、空 prompt 返回 null、注册顺序 tie-break、**M8 新增**：多维表格关键词命中 / 邮件关键词在 mail deferred 状态下返回 null（不应误路由到别的 skill）。
- detectLoggedIn 默认实现的 mock 测试：模拟 page.cookies() 返回有/无 session cookie 两种情况。
- **prompt-keyword 断言覆盖五个 skill 的 systemPromptAddendum**（含 mail，即使不注册）—— 防止 prompt 模板退化，让未来 unblock mail 时只需改 registry 一行。

#### Scenario: vitest 跑通 skills.test.ts 全部用例
- **WHEN** 在 `runners/web-agent/` 执行 `npm test`
- **THEN** `skills.test.ts` 中所有 `it/test` 通过
- **AND** 测试套件总通过率 100%
- **AND** registry 长度断言 `>= 4`，并显式断言 `'feishu_mail_send'` 不在 registry 中

### Requirement: 飞书 skill 的 systemPromptAddendum 必须包含强禁止段与完成判定段

为缓解 plan 风险 1（Qwen3-VL-Plus 在飞书 React 应用上 click 命中率不稳）+ M5 task 7.3 实测暴露的"两个搜索框打转"问题 + M6 archive §9 实测暴露的"VLM 视觉 grounding 把顶部全局搜索栏当浅色会话搜索框"问题 + M7 hotfix 实测暴露的"VLM 偶尔 emit start_box=[...] 无引号导致 BrowserOperator 解析 startY 为 falsy"问题，**所有五个**内置飞书 skill 的 `systemPromptAddendum` SHALL 至少包含以下五段：

1. **ACTION SYNTAX 段（M7 hotfix 引入，M8 spec sync）**：明确告诉 VLM coordinate box 必须是单引号字符串（`click(start_box='[x1, y1, x2, y2]')`）；hotkey key 必须是全称（`hotkey(key='escape')` 不是 `'esc'`）。段中必须列出 `WRONG` / `CORRECT` 对照例子，让 VLM 看到具体的错形式以避免学样。`feishu_im_send` 隐含遵循（M7 archive 时已经在强禁止段教 escape 全名 + few-shot 示例都用单引号），m8 后**显式要求所有 5 个 skill 都有这段**。
2. **强禁止段（IMPORTANT 级）**：明确告诉 VLM 不要点屏幕顶部"全局搜索栏"（占位符通常含 `搜索全部内容` / `问你想问的问题` / `⌘+K` 等关键字）；并指出该 skill 对应的正确入口（IM 是左侧会话搜索；calendar 是左侧"新建日程"按钮；doc 是 Drive 内容面板"新建"；base 是 base 列表内的"+"按钮；mail 是邮箱左上角"写信"按钮）。误触模态时的恢复指令必须使用 `KEY_MAPPINGS` 接受的合法 key 名（即 `hotkey(key='escape')`，**不是** `'esc'` 缩写）。
3. **完成判定段**：明确告诉 VLM 出现何种**视觉信号**就应当立即调用 `finished()`（IM = 自己消息蓝色气泡；calendar = 模态框关闭 + 日历视图新增条目；doc = 编辑器加载完成 + 标题渲染；base = 编辑器加载 + 列表新增条目；mail = "已发送" toast 或已发送箱新增条目）。这一段必须显式注明"不要为了再确认一遍而做额外操作；多余操作会触发 max_loop 而失败"。
4. **few-shot 范例**：演示该 skill 最常见的成功路径，步骤数 ≤ 8。所有 click action 在 few-shot 中**必须用单引号 start_box 形式**（`click(start_box='[x1,y1,x2,y2]')`），让 VLM 看着 few-shot mirror 正确语法。
5. **OMNI-SEARCH FALLBACK 段**：当 VLM 反复误触顶部全局搜索栏（≥ 2 次）时，prompt 应当**主动**指引 VLM 行为：
   - `feishu_im_send` 的 fallback 是 LEGAL 捷径（直接在模态里 type 联系人名，飞书 omni-search 命中联系人会跳到对应聊天），prompt 同时强调会话搜索是 PREFER 首选路径，omni-search 仅在 stuck 时使用。
   - `feishu_calendar_create` / `feishu_doc_create` / `feishu_base_create` / `feishu_mail_send` 的 fallback 是 recovery-only（这些产品的 omni-search **不能**直接创建对象），prompt 必须说明 fallback 是"escape 退出 + 重试 conventional 路径"，不是替代路径。

#### Scenario: feishu_im_send 包含强禁止全局搜索栏
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 字符串包含 "全局搜索" / "顶部" 等关键字至少一个
- **AND** 字符串包含 "不要" 或 "禁止" 等否定词与上述关键字共现
- **AND** 字符串包含 "⌘+K" 描述消息会话搜索入口

#### Scenario: feishu_im_send 包含合法 escape key 名
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 任何提到键盘 escape 的位置都使用 `escape` 全名（不是 `esc` 缩写）
- **AND** 字符串包含 `hotkey(key='escape')` 至少一次

#### Scenario: feishu_im_send 包含 omni-search fallback 段
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 字符串包含 `OMNI-SEARCH FALLBACK` 关键字（标题段）
- **AND** 字符串包含 `use when stuck` 或语义等价的 fallback 触发条件
- **AND** 字符串明确说明 fallback 是合法路径（"LEGAL" 或"飞书设计支持"等）
- **AND** 字符串明确把会话搜索标为 preferred 首选路径，omni-search 标为 fallback

#### Scenario: 五个飞书 skill 都包含完成判定段（M8 修订）
- **WHEN** 读取任意飞书 skill 的 `systemPromptAddendum`
- **THEN** 字符串包含 "finished" 关键字
- **AND** 字符串包含至少一种**视觉**完成信号描述（关键字示例: "气泡" / "模态" / "编辑器" / "列表" / "toast" / "已发送" / "出现"）

#### Scenario: doc / calendar / base / mail 包含 ACTION SYNTAX 段（M7 hotfix + M8 spec sync）
- **WHEN** 读取 `feishu_doc_create` / `feishu_calendar_create` / `feishu_base_create` / `feishu_mail_send` 任一 skill 的 `systemPromptAddendum`
- **THEN** 字符串包含 `ACTION SYNTAX` 段标题
- **AND** 字符串包含 `WRONG` 或 `CORRECT` 标记
- **AND** 字符串包含 `start_box='[` 单引号开始模式

#### Scenario: 五个飞书 skill 都不教 'esc' 缩写
- **WHEN** 读取任意飞书 skill 的 `systemPromptAddendum`
- **THEN** 字符串**不**包含 `hotkey(key='esc')`
- **AND** 字符串**不**包含 `press Esc` 类指令

### Requirement: 五个飞书 skill 的 loginURL 必须直接复用 startingURL

每个内置飞书 skill MUST 把 `loginURL` 设置为与 `startingURL` 完全相等的值：

- `feishu_im_send`: `loginURL = startingURL = "https://www.feishu.cn/messenger/"`
- `feishu_mail_send`: `loginURL = startingURL = "https://mail.feishu.cn/"`
- `feishu_calendar_create`: `loginURL = startingURL = "https://calendar.feishu.cn/"`
- `feishu_doc_create`: `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`
- `feishu_base_create`: `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`（共享 Drive 入口；M8 第一次实测发现 `https://base.feishu.cn/` 是营销页非应用域，已切换）

理由：M5 实测发现 `https://passport.feishu.cn/` 直接访问返回 404；飞书的扫码登录页（`accounts.feishu.cn/...`）只有从需要登录态的页面被自动 redirect 时才能拿到带 `redirect_uri` 参数的正确 URL。让 visible chromium 在扫码模式 navigate 到 loginURL（= 业务入口页）时，飞书前端自身负责把未登录用户 redirect 到带二维码的登录页。

#### Scenario: 五个飞书 skill 的 loginURL 等于 startingURL（M8 修订）
- **WHEN** 读取任意飞书 skill
- **THEN** `skill.loginURL === skill.startingURL`
- **AND** `skill.loginURL` 指向 `feishu.cn` 子域
