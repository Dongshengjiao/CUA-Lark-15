## MODIFIED Requirements

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
