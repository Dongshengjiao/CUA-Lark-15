# web-agent-skills Specification

## Purpose
TBD - created by archiving change m5-feishu-skills. Update Purpose after archive.
## Requirements
### Requirement: skill 通过静态注册中心暴露给 runner

`runners/web-agent/src/skills/registry.ts` SHALL 暴露一个静态有序数组（or 数组形态的 map），数组项为 `Skill` 接口实现，每个 Skill MUST 至少包含以下字段：

- `id`: kebab-case 唯一标识，例如 `feishu_im_send`。
- `matchKeywords`: 字符串数组，路由器用这些关键词的 `lower-case includes` 在用户 prompt 上匹配；M5 内置 skill MUST 至少各包含一个中文关键词与一个英文关键词。
- `cookieDomain`: chromium cookies 域，例如 `.feishu.cn`；多个 skill 可以共享同一个 cookieDomain（飞书的 IM/calendar/doc 都共享 `.feishu.cn`）。
- `userDataDirSegment`: 隔离的子目录名，例如 `feishu`；同一 cookieDomain 下的 skill 应使用同一 segment。
- `loginURL`: 检测到未登录时打开的可见登录页 URL；空字符串视为"无登录态需求"（不会触发扫码流程）。
- `startingURL`: GUIAgent 启动时第一步跳转目标。
- `systemPromptAddendum`: 注入到 GUIAgent 默认 system prompt 末尾的字符串；通常包含针对该 skill 的引导、坐标范围提示、few-shot 示例。
- `detectLoggedIn`（可选）：异步函数 `(page) => Promise<boolean>`，缺省实现见 `web-agent-runner-service` 的 modified Requirement"GUIAgent 启动前执行登录预检"。

注册表数组的顺序即匹配优先级。M5 起默认顺序：`feishu_im_send` > `feishu_calendar_create` > `feishu_doc_create`，便于关键词更窄的 skill 优先命中。

#### Scenario: registry 暴露 skill 数组
- **WHEN** 任意调用方读取 `registry.ts` 暴露的默认导出
- **THEN** 得到一个数组，其中至少包含 `feishu_im_send` / `feishu_calendar_create` / `feishu_doc_create` 三个 skill
- **AND** 每个 skill 都通过 typescript 的 `Skill` interface 静态校验

#### Scenario: skill 缺必填字段在 build 时报错
- **WHEN** 开发者新增的 skill 缺少 `matchKeywords` / `cookieDomain` / `userDataDirSegment` / `loginURL` / `startingURL` / `systemPromptAddendum` 任一字段
- **THEN** `npm run typecheck` MUST 报 typescript error，runner 不能 build 成功

### Requirement: 关键词路由按注册顺序首命中返回

router 函数 `selectSkill(prompt: string, registry: Skill[]): Skill | null` SHALL 实现：

- 把 `prompt` 通过 `toLowerCase()` 标准化。
- 按 registry 数组顺序遍历，对每个 skill 检查 `matchKeywords.some(k => lowerPrompt.includes(k.toLowerCase()))`。
- 第一个命中的 skill 即返回；遍历完无命中返回 `null`。

router MUST 是纯函数，不调用网络、不调用 chromium、不读文件。

#### Scenario: 飞书 IM 关键词命中 feishu_im_send
- **WHEN** prompt = `"给张三发条飞书消息"`
- **THEN** `selectSkill(prompt, registry)` 返回 `feishu_im_send`

#### Scenario: 没匹配关键词返回 null（fallback 到通用模式）
- **WHEN** prompt = `"在 google 搜索 UI-TARS 并告诉我前 3 个结果"`
- **THEN** `selectSkill(prompt, registry)` 返回 `null`
- **AND** runner 走通用模式（不注入 skill 的 system prompt 或 starting URL）

#### Scenario: 注册顺序决定优先级
- **WHEN** prompt = `"帮我在飞书发条消息"` 同时被 `feishu_im_send` 和 `feishu_doc_create` 的 matchKeywords 命中
- **THEN** 返回 `feishu_im_send`（registry 数组里排在前面）

### Requirement: 用户数据目录按 segment 隔离并共享同源 cookie

每个 skill 的 chromium 实例 SHALL 用 `~/Library/Application Support/LarkIsland/web-agent/profiles/<userDataDirSegment>/` 作为 puppeteer-core 的 `userDataDir`。共享同一 `userDataDirSegment` 的多个 skill 共享 cookies / localStorage / IndexedDB（即"登录一次，全套飞书 skill 都能用"）。

通用模式（路由返回 null）SHALL 用单独的 segment `generic`，不污染任何 skill 登录态。

runner 在 launch 任何 LocalBrowser 之前 MUST 确保该 segment 目录存在（递归创建）。

#### Scenario: 三个飞书 skill 共享同一 user-data-dir
- **WHEN** 三个 feishu skill 都把 `userDataDirSegment` 设为 `feishu`
- **THEN** runner launch chromium 时所有飞书任务都用 `~/Library/Application Support/LarkIsland/web-agent/profiles/feishu/`
- **AND** 一次扫码后 IM / 日历 / 文档任务都识别为已登录

#### Scenario: 通用模式与 skill 完全隔离
- **WHEN** runner 跑一个无 skill 命中的通用任务
- **THEN** chromium 用 `profiles/generic/`，不读取 `profiles/feishu/` 的任何 cookie / 状态

### Requirement: 三个内置飞书 skill 必须配置正确

仓库 SHALL 包含以下五个内置飞书 skill 的实现（M8 修订：原 header 文字保留以维持 spec sync 兼容；本 requirement 实际覆盖五个 skill），并把其中**四个**注册进 `registry.ts`（`feishu_mail_send` 是 M8 deferred stub，文件 + prompt 模板存在但暂不注册——M8 verify run 实测发现现用挑战赛账号未开通飞书邮箱产品，`mail.feishu.cn` 在用户浏览器返回 ERR_NAME_NOT_RESOLVED，强制路由到该 skill 会让 QR 登录流程死循环；待找到可达的 Mail 入口 URL 后单行恢复 import + array entry 即可解锁）：

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

为缓解 plan 风险 1（Qwen3-VL-Plus 在飞书 React 应用上 click 命中率不稳）+ M5 task 7.3 实测暴露的"两个搜索框打转"问题 + M6 archive §9 实测暴露的"VLM 视觉 grounding 把顶部全局搜索栏当浅色会话搜索框"问题 + M7 hotfix 实测暴露的"VLM 偶尔 emit start_box=[...] 无引号导致 BrowserOperator 解析 startY 为 falsy"问题，**所有五个**内置飞书 skill 的 `systemPromptAddendum` SHALL 至少包含以下五段（M10 修订：calendar 不再要求 messenger sidebar 跳转段）：

1. **ACTION SYNTAX 段**（M7 hotfix 引入；M9 hotfix 进一步提到 BASE_SYSTEM_PROMPT 共享层；M10 维持 skill 级冗余强化）：明确告诉 VLM coordinate box 必须是单引号字符串、hotkey 必须是全词，列举 WRONG/CORRECT 对照例子。
2. **强禁止段（IMPORTANT 级）**：禁止点屏幕顶部"全局搜索栏"，并指出该 skill 对应的正确入口（IM 是左侧会话搜索；calendar 是直达 calendar 视图后的"新建日程"按钮；doc/base 是 Drive "+新建" 下拉；mail 是邮箱左上角"写信"按钮）。误触模态时的恢复指令必须用 `hotkey(key='escape')`。
3. **完成判定段**：明确告诉 VLM 出现何种**视觉信号**就应当立即调用 `finished()`。calendar 自 M9 起额外要求 STRICT 双条件（modal 关闭 AND 日历 grid 上看到带标题的事件块）+ finished() 字符串用 YYYY-MM-DD 不要"明天"。
4. **few-shot 范例**：演示该 skill 最常见的成功路径，步骤数 ≤ 8。所有 click 用单引号 start_box。
5. **OMNI-SEARCH FALLBACK 段**：M7 引入。`feishu_im_send` 是 LEGAL 捷径；其它 skill（calendar / doc / base / mail）是 recovery-only 语义。

**M10 删除项**：m9 hotfix 在 `feishu_calendar_create.systemPromptAddendum` 加的 "ENTRY: switch from messenger to calendar surface FIRST" 段被删除。M10 切到 tenant 直达 URL 后 calendar 启动落点就是日历视图，不需要先在 messenger sidebar 找日历图标。

#### Scenario: feishu_calendar_create 不再含 ENTRY sidebar 跳转段（M10 新增）
- **WHEN** 读取 `feishu_calendar_create.systemPromptAddendum`
- **THEN** 字符串**不**含 `ENTRY: switch from messenger to calendar` 段标题
- **AND** 字符串**不**含 `点击 sidebar` / `左侧导航栏的"日历"图标` 等引导

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
- **AND** 字符串包含至少一种**视觉**完成信号描述（关键字示例: "气泡" / "模态" / "编辑器" / "列表" / "toast" / "已发送" / "出现" / "事件块"）

#### Scenario: doc / calendar / base / mail 包含 ACTION SYNTAX 段（M7 hotfix + M8 spec sync）
- **WHEN** 读取 `feishu_doc_create` / `feishu_calendar_create` / `feishu_base_create` / `feishu_mail_send` 任一 skill 的 `systemPromptAddendum`
- **THEN** 字符串包含 `ACTION SYNTAX` 段标题
- **AND** 字符串包含 `WRONG` 或 `CORRECT` 标记
- **AND** 字符串包含 `start_box='[` 单引号开始模式

#### Scenario: 五个飞书 skill 都不教 'esc' 缩写
- **WHEN** 读取任意飞书 skill 的 `systemPromptAddendum`
- **THEN** 字符串**不**包含 `hotkey(key='esc')`
- **AND** 字符串**不**包含 `press Esc` 类指令

### Requirement: 三个飞书 skill 的 loginURL 必须直接复用 startingURL

每个内置飞书 skill MUST 把 `loginURL` 设置为与 `startingURL` 完全相等的值。M12 修订：`feishu_im_send` 的 startingURL 由主域 `https://www.feishu.cn/messenger/` 改为 tenant 子域 `https://${LARK_FEISHU_TENANT_DOMAIN ?? 'jcneyh7qlo8i.feishu.cn'}/messenger/`，与 m10 calendar 保持同样的 tenant 子域路由模式。

- `feishu_im_send`: `loginURL = startingURL = \`https://${LARK_FEISHU_TENANT_DOMAIN ?? 'jcneyh7qlo8i.feishu.cn'}/messenger/\``（M12 修订）
- `feishu_mail_send`: `loginURL = startingURL = "https://mail.feishu.cn/"`（M8 deferred stub，账号未开通邮箱）
- `feishu_calendar_create`: `loginURL = startingURL = \`https://${LARK_FEISHU_TENANT_DOMAIN ?? 'jcneyh7qlo8i.feishu.cn'}/calendar/week\``（M10 修订）
- `feishu_doc_create`: `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`
- `feishu_base_create`: `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`

理由（M12 修订）：m12 verify-runs #5–#8 实测发现，runner 在 tenant 子域（calendar）建立 cookie state 之后再 navigate 到主域 messenger（任意路径），puppeteer chromium 中 messenger SPA 都会 hang 在初始化阶段（SPA mount probe ≥ 100 elements 在 15s 内永不通过）。这是飞书 messenger SPA 跨域 cookie/Origin 校验的硬约束，runtime 端无法绕过。把 IM startingURL 也固定到 tenant 子域可以让 m13+ 的"per-skill chromium isolation"工作首先在 URL 层就预防同源问题；跨子域问题虽然依然存在，但 m12 v8 实测确认 tenant 子域 messenger 与 calendar 共享 cookie state 后 mount 行为更接近 m10 calendar 已知工作的路径（即"tenant 子域内"是相对一致的）。

#### Scenario: 五个飞书 skill 的 loginURL 等于 startingURL（M12 全部走 tenant 子域 / 主域两类，约束不变）
- **WHEN** 读取任意飞书 skill
- **THEN** `skill.loginURL === skill.startingURL`
- **AND** `skill.loginURL` 指向 `feishu.cn` 子域

#### Scenario: feishu_im_send startingURL 含 /messenger/ 路径且使用 tenant 子域（M12 新增）
- **WHEN** 读取 `feishu_im_send.startingURL`
- **THEN** 字符串 endsWith `/messenger/`
- **AND** 字符串包含 `.feishu.cn`
- **AND** 字符串以 `https://` 开头
- **AND** 默认 tenant domain 为 `jcneyh7qlo8i.feishu.cn`（挑战赛 demo 默认值，可由 LARK_FEISHU_TENANT_DOMAIN env 覆盖）

