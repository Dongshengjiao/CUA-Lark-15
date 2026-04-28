## ADDED Requirements

### Requirement: 飞书 skill 的 systemPromptAddendum 必须包含强禁止段与完成判定段

为缓解 plan 风险 1 （Qwen3-VL-Plus 在飞书 React 应用上 click 命中率不稳）+ M5 task 7.3 实测暴露的"两个搜索框打转"问题，三个内置飞书 skill 的 `systemPromptAddendum` SHALL 至少包含以下三段：

1. **强禁止段（IMPORTANT 级）**：明确告诉 VLM 不要点屏幕顶部"全局搜索栏"（占位符通常含 `搜索全部内容` / `问你想问的问题` / `⌘+K` 等关键字）；并指出正确入口（左侧消息列表上方的会话搜索框 / 该 skill 的对应专用入口）。
2. **完成判定段**：明确告诉 VLM 出现何种**视觉信号**就应当立即调用 `finished()`（例：IM 看到自己消息以蓝色气泡发送方一侧出现；calendar 看到模态框关闭并日历视图新增条目；doc 看到新文档已经出现在 drive 列表或编辑器已加载）。这一段必须显式注明"不要为了再确认一遍而做额外操作；多余操作会触发 max_loop 而失败"。
3. **few-shot 范例**：演示该 skill 最常见的成功路径，步骤数 ≤ 8。M5 时的 few-shot 步骤过多 / 没强调完成判定，本里程碑全部重写。

#### Scenario: feishu_im_send 包含强禁止全局搜索栏
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 字符串包含 "全局搜索" / "顶部" 等关键字至少一个
- **AND** 字符串包含 "不要" 或 "禁止" 等否定词与上述关键字共现
- **AND** 字符串包含 "⌘+K" 描述消息会话搜索入口

#### Scenario: 三个飞书 skill 都包含完成判定段
- **WHEN** 读取任意飞书 skill 的 `systemPromptAddendum`
- **THEN** 字符串包含 "finished" 关键字
- **AND** 字符串包含至少一种**视觉**完成信号描述（关键字示例: "气泡" / "模态" / "编辑器" / "出现"）

### Requirement: 三个飞书 skill 的 loginURL 必须直接复用 startingURL

每个内置飞书 skill MUST 把 `loginURL` 设置为与 `startingURL` 完全相等的值：

- `feishu_im_send`: `loginURL = startingURL = "https://www.feishu.cn/messenger/"`
- `feishu_calendar_create`: `loginURL = startingURL = "https://calendar.feishu.cn/"`
- `feishu_doc_create`: `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`

理由：M5 实测发现 `https://passport.feishu.cn/` 直接访问返回 404；飞书的扫码登录页（`accounts.feishu.cn/...`）只有从需要登录态的页面被自动 redirect 时才能拿到带 `redirect_uri` 参数的正确 URL。让 visible chromium 在扫码模式 navigate 到 loginURL（= 业务入口页）时，飞书前端自身负责把未登录用户 redirect 到带二维码的登录页。

#### Scenario: 三个飞书 skill 的 loginURL 等于 startingURL
- **WHEN** 读取任意飞书 skill
- **THEN** `skill.loginURL === skill.startingURL`
- **AND** `skill.loginURL` 指向 `feishu.cn` 子域

## MODIFIED Requirements

### Requirement: 三个内置飞书 skill 必须配置正确

仓库 SHALL 包含以下三个 skill 的实现，每个 skill 至少需要：

**`feishu_im_send`**
- `matchKeywords` 至少包含一个高信号中文 token（如 `消息`、`聊天`、`im`）和一个高信号英文 token（如 `message`、`chat`、`send im`）；不必使用组合词，单个 token 即可命中真实用户 prompt（实测 prompt `"在飞书给自己发条消息：xxx"` 必须能命中本 skill）。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `loginURL = startingURL = "https://www.feishu.cn/messenger/"`（依赖飞书前端 redirect 到登录页）。
- `systemPromptAddendum` 至少包含强禁止段、完成判定段、few-shot 范例（详见上面 ADDED Requirements）。

**`feishu_calendar_create`**
- `matchKeywords` 至少包含一个高信号中文 token（如 `日程`、`日历`、`会议`）和一个高信号英文 token（如 `calendar`、`schedule`、`meeting`）。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `loginURL = startingURL = "https://calendar.feishu.cn/"`。
- `systemPromptAddendum` 引导填标题/时间/参与人/创建，且包含强禁止段、完成判定段、few-shot 范例。

**`feishu_doc_create`**
- `matchKeywords` 至少包含一个高信号中文 token（如 `文档`、`笔记`）和一个高信号英文 token（如 `doc`、`document`、`note`）。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `loginURL = startingURL = "https://www.feishu.cn/drive/me/"`。
- `systemPromptAddendum` 引导新建 → 输入标题 → 写正文，且包含强禁止段、完成判定段、few-shot 范例。

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
