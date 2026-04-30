## MODIFIED Requirements

### Requirement: 三个飞书 skill 的 loginURL 必须直接复用 startingURL

每个内置飞书 skill MUST 把 `loginURL` 设置为与 `startingURL` 完全相等的值（M8 修订：原 header 保留 "三个"，实际现覆盖五个 skill；M10 修订：calendar 由静态 URL 改为 tenant 子域 + env override）：

- `feishu_im_send`: `loginURL = startingURL = "https://www.feishu.cn/messenger/"`
- `feishu_mail_send`: `loginURL = startingURL = "https://mail.feishu.cn/"`（M8 deferred stub，账号未开通邮箱）
- `feishu_calendar_create`: `loginURL = startingURL = \`https://${LARK_FEISHU_TENANT_DOMAIN ?? 'jcneyh7qlo8i.feishu.cn'}/calendar/week\``（M10 修订）
- `feishu_doc_create`: `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`
- `feishu_base_create`: `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`

理由：M5 实测发现 `https://passport.feishu.cn/` 直接访问返回 404；飞书的扫码登录页（`accounts.feishu.cn/...`）只有从需要登录态的页面被自动 redirect 时才能拿到带 `redirect_uri` 参数的正确 URL。让 visible chromium 在扫码模式 navigate 到 loginURL（= 业务入口页）时，飞书前端自身负责把未登录用户 redirect 到带二维码的登录页。

M10 修订：`feishu_calendar_create` 之前用 `https://calendar.feishu.cn/`（M5 起写死）和后来 m9 hotfix 用 `https://www.feishu.cn/messenger/`+sidebar 跳转都验证不通。前者 DNS 没 A 记录直接 ERR_NAME_NOT_RESOLVED；后者 puppeteer chromium 加载 messenger 后被前端 redirect 到 docs 主页，sidebar 看不到日历图标，VLM call_user 退出。M10 改用 tenant-routed URL `https://<tenant>.feishu.cn/calendar/week` 直达日历视图，由 `LARK_FEISHU_TENANT_DOMAIN` env 变量配置（默认值为挑战赛账号 `jcneyh7qlo8i.feishu.cn` 便于 demo），需要切其它 tenant 时通过 env 覆盖。

#### Scenario: 五个飞书 skill 的 loginURL 等于 startingURL（M8 扩展为五个，M10 calendar URL 切到 tenant 路径）
- **WHEN** 读取任意飞书 skill
- **THEN** `skill.loginURL === skill.startingURL`
- **AND** `skill.loginURL` 指向 `feishu.cn` 子域

#### Scenario: feishu_calendar_create startingURL 包含 /calendar/week 路径（M10 新增）
- **WHEN** 读取 `feishu_calendar_create.startingURL`
- **THEN** 字符串 endsWith `/calendar/week`
- **AND** 字符串包含 `.feishu.cn`
- **AND** 字符串以 `https://` 开头

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
