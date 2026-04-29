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

### Requirement: skill registry 单元测试覆盖路由 + 注册完整性

`runners/web-agent/test/skills.test.ts` MUST 包含以下覆盖：

- registry 长度 ≥ 3 且包含三个内置 skill 的 id。
- 每个 skill 通过 schema check（必填字段都存在）。
- router 测试至少覆盖：飞书 IM 关键词命中、文档关键词命中、英文关键词命中、空 prompt 返回 null、注册顺序 tie-break。
- detectLoggedIn 默认实现的 mock 测试：模拟 page.cookies() 返回有/无 session cookie 两种情况。

#### Scenario: vitest 跑通 skills.test.ts 全部用例
- **WHEN** 在 `runners/web-agent/` 执行 `npm test`
- **THEN** `skills.test.ts` 中所有 `it/test` 通过
- **AND** 测试套件总通过率 100%

### Requirement: 飞书 skill 的 systemPromptAddendum 必须包含强禁止段与完成判定段

为缓解 plan 风险 1（Qwen3-VL-Plus 在飞书 React 应用上 click 命中率不稳）+ M5 task 7.3 实测暴露的"两个搜索框打转"问题 + M6 archive §9 实测暴露的"VLM 视觉 grounding 把顶部全局搜索栏当浅色会话搜索框"问题，三个内置飞书 skill 的 `systemPromptAddendum` SHALL 至少包含以下四段：

1. **强禁止段（IMPORTANT 级）**：明确告诉 VLM 不要点屏幕顶部"全局搜索栏"（占位符通常含 `搜索全部内容` / `问你想问的问题` / `⌘+K` 等关键字）；并指出正确入口（左侧消息列表上方的会话搜索框 / 该 skill 的对应专用入口）。误触模态时的恢复指令必须使用 `KEY_MAPPINGS` 接受的合法 key 名（即 `hotkey(key='escape')`，**不是** `'esc'` 缩写——M6 archive §9 实测显示后者会被 BrowserOperator 抛 `Unsupported key: esc`）。
2. **完成判定段**：明确告诉 VLM 出现何种**视觉信号**就应当立即调用 `finished()`（例：IM 看到自己消息以蓝色气泡发送方一侧出现；calendar 看到模态框关闭并日历视图新增条目；doc 看到新文档已经出现在 drive 列表或编辑器已加载）。这一段必须显式注明"不要为了再确认一遍而做额外操作；多余操作会触发 max_loop 而失败"。
3. **few-shot 范例**：演示该 skill 最常见的成功路径，步骤数 ≤ 8。M5 时的 few-shot 步骤过多 / 没强调完成判定，M6 全部重写。
4. **OMNI-SEARCH FALLBACK 段（M7 新增，仅 `feishu_im_send` 必需）**：当 VLM 反复误触顶部全局搜索栏（≥ 2 次）时，prompt 应当**主动**指引 VLM 把全局 omni-search 模态当成合法捷径——直接在弹出的模态里 type 联系人名字、点击搜索结果，飞书 omni-search 命中联系人会跳到对应聊天。M6 archive §9 实测显示 VLM 自己在 step 31 想到了这条路径，但走了 30 步弯路才找到；m7 prompt 显式教这条 fallback，预期把"消息能发出"的步数从 21 LLM iteration 降到 ≤ 13。fallback 必须标记为 fallback（`use when stuck`），而不是替代会话搜索的首选路径——后者仍是更快路径（1 click + 1 type vs 2 click + 1 type）。

#### Scenario: feishu_im_send 包含强禁止全局搜索栏
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 字符串包含 "全局搜索" / "顶部" 等关键字至少一个
- **AND** 字符串包含 "不要" 或 "禁止" 等否定词与上述关键字共现
- **AND** 字符串包含 "⌘+K" 描述消息会话搜索入口

#### Scenario: feishu_im_send 包含合法 escape key 名（M7 新增）
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 任何提到键盘 escape 的位置都使用 `escape` 全名（不是 `esc` 缩写）
- **AND** 字符串包含 `hotkey(key='escape')` 至少一次

#### Scenario: feishu_im_send 包含 omni-search fallback 段（M7 新增）
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 字符串包含 `OMNI-SEARCH FALLBACK` 关键字（标题段）
- **AND** 字符串包含 `use when stuck` 或语义等价的 fallback 触发条件
- **AND** 字符串明确说明 fallback 是合法路径（"LEGAL" 或"飞书设计支持"等）
- **AND** 字符串明确把会话搜索标为 preferred 首选路径，omni-search 标为 fallback

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

