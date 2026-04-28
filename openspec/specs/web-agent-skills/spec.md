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
- `matchKeywords` 至少包含：`["飞书", "lark", "发消息", "im", "send message"]` 中各取一组关键词。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `loginURL = "https://passport.feishu.cn/"`，`startingURL = "https://www.feishu.cn/messenger/"` 或同等飞书 web IM 入口。
- `systemPromptAddendum` 至少包含一段 few-shot：明示该 skill 主要在飞书 web IM 内"找联系人/群"→"输入消息"→"按 Cmd+Enter / 点发送"。

**`feishu_calendar_create`**
- `matchKeywords` 至少包含：`["创建日程", "calendar", "日程", "schedule meeting"]` 中各取一组关键词。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `startingURL` 指向飞书日历 web 入口（如 `https://calendar.feishu.cn/`）。
- `systemPromptAddendum` 引导填标题/时间/参与人/创建。

**`feishu_doc_create`**
- `matchKeywords` 至少包含：`["创建文档", "create doc", "新建文档"]` 中各取一组关键词。
- `cookieDomain = ".feishu.cn"`，`userDataDirSegment = "feishu"`。
- `startingURL` 指向 `https://www.feishu.cn/drive/me/`（或更稳定的"新建文档"入口）。
- `systemPromptAddendum` 引导新建 → 输入标题 → 写正文。

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

