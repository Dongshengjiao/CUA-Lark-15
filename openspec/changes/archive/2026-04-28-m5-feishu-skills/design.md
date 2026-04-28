# 设计：M5 飞书 skill 与扫码登录流程

## 背景（Context）

M2/M3/M4 把"灵动岛 → BridgeServer → runner → headless Chromium"这条管道接通了，但 runner 收到 `runWebAgentTask` 之后只会把 prompt 原样塞给 GUIAgent，缺乏：

- **业务上下文**：飞书 web 是个 React SPA，跟 google.com 完全不是一个量级。GUIAgent 默认 system prompt 是 OpenIsland 通用桌面/网页版，飞书界面里大量自定义 web component（消息列表、搜索弹窗、@mention 选择器）；没有针对性的 prompt 工程会让 click 坐标命中率低、步数膨胀。
- **登录态管理**：飞书 web 必须扫码登录。`headless: true` 的 Chromium 永远进不去任何需要登录的页面。
- **会话隔离**：未来会有 google 搜索、github、Notion 等更多 skill；如果所有 skill 都用同一个 user-data-dir，cookie 会互相污染、登录态被覆盖。

涉及方：
- 当前推进者（M5 实现者）。
- M6 demo 录制者：M5 必须把"飞书发消息" demo 跑通。
- 灵动岛 UI 用户：第一次进入飞书任务时会看到"扫码"提示，需要直观、低延迟。
- M7+ 维护者：skill 框架应当能容纳未来 google search / github / 其它 web app 的 skill 扩展。

约束：
- **GPL aggregation 边界不动**：runners/ 跟 lark-island/ 仍旧只能 IPC，不能 import；skill 实现都放 runners/ 内。
- **不打包发布**：M5 仍然是 dev 模式跑；不引入 macOS 系统级 helper。
- **Browser 单进程双形态**：runner 一个时间点只持有一个 LocalBrowser 实例（要么 headless，要么 visible），不并行；切换通过 close + relaunch。
- **不引 puppeteer-extra-plugin-stealth**：plan 风险 5 留到 M7+；M5 只用 puppeteer-core 默认 + 禁用 `--enable-automation` flag（M3 已经做了）。
- **单任务串行不变**：M3 spec 规定的"忙碌时拒绝第二条 task"在 M5 仍然成立；扫码登录期间任务保持 in-flight 状态。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**

- 在 `runners/web-agent/src/skills/` 实装 3 个内置 skill：`feishu_im_send` / `feishu_calendar_create` / `feishu_doc_create`，每个 skill 至少能成功跑一遍简单场景（单测 + 手动 e2e 各一次）。
- 实装 skill registry 和关键词路由：runner 收到 prompt 后能根据"飞书"/"lark"/"发消息"/"创建文档"等词自动选 skill；非命中走通用模式。
- 实装 headless ↔ visible 切换协议：cookie 缺失时弹可见 Chromium 让用户扫码，登录成功后切回 headless 继续原任务。
- 实装域级 user-data-dir 隔离：飞书的 cookie 落盘到 `profiles/feishu/`，未来 google 等 skill 用 `profiles/<id>/`。
- 灵动岛 opened 态对 `webAgentApprovalRequested(kind: login_qr)` 给出明显提示，扫码完成后自动恢复 running 态。

**非目标：**

- 不实装 cookie 加密 / 上锁。Chromium 自身的 user-data-dir 已经足够安全 for dev 阶段。
- 不实装 cookie 自动续期 / refresh token 流程。飞书 cookie 一般 7 天有效；M5 期间假定一次扫码至少能撑过整场 demo + 后续若干次任务。
- 不做 skill 热加载（运行时 npm install）。所有 skill 在 build 时静态注册。
- 不做多 skill 并发（一个任务用一个 skill；不在同一任务里 chain 飞书+google）。
- 不做"登录失败重试"。30 分钟扫码超时直接 `webAgentTaskFailed{kind: cancelled}`。
- 不实装 path B（DOM 模式）。design 中保留作为风险缓解的备选方案，但代码不写；只在 M1 风险点真正命中时才回头写。
- 不实装审批 UI 的"取消扫码"按钮（M6 polish 时再加）。
- 不实装日志脱敏：runner log 仍然把 cookie domain 等明文写到 `~/Library/Logs/LarkIsland/`，因为 dev 阶段调试需要。

## 关键决策（Decisions）

### D1：skill = 静态描述对象 + 可选 hook 函数，不是类继承体系

每个 skill 是个 `Skill` 接口的具名常量：

```ts
export interface Skill {
  id: string                    // "feishu_im_send"
  matchKeywords: string[]       // ["飞书", "lark", "发消息", "im", ...]
  cookieDomain: string          // ".feishu.cn"
  loginURL: string              // "https://passport.feishu.cn"
  startingURL: string           // "https://feishu.cn"
  systemPromptAddendum: string  // 注入到 GUIAgent system prompt 末尾
  detectLoggedIn?: (page: Page) => Promise<boolean>  // 可选自定义检测
  fewShotExamples?: string      // 可选 prompt few-shot
}
```

不用 class / abstract method，因为 skill 之间共享逻辑很少（最多就是 cookie 检测）；用纯对象 + 可选 hook 即可。registry 是一个 `const registry: Record<string, Skill>` 静态 map，启动时一次性注册。

考虑过 OO 继承（FeishuSkill extends BaseSkill）：reject。继承层级会把"通用 skill 该长什么样"过早固化；M6 加 google skill 时大概率发现接口要扩。先纯对象 + 后期接口自然演进。

### D2：关键词路由用简单 includes + 优先级数组，不引入 NLP

routing 在 `runners/web-agent/src/skills/router.ts`：

```ts
export function selectSkill(prompt: string, registry: Skill[]): Skill | null {
  const lower = prompt.toLowerCase()
  for (const skill of registry) {
    if (skill.matchKeywords.some(k => lower.includes(k.toLowerCase()))) {
      return skill
    }
  }
  return null
}
```

registry 内部按 `matchKeywords` 长度（即特异性）从大到小排，feishu_im_send 应当排在 feishu_doc_create 之前——因为 IM 关键词更具体（"发消息"/"send message"）。

考虑过：
- **embedding 相似度**：reject，引入 OpenAI embedding API 调用 = 第二个外部依赖 + 延迟 + 成本；M5 阶段过度设计。
- **VLM 自己分类**：让 GUIAgent 跑一个 0 步 dispatcher 任务先选 skill。reject：成本翻倍 + 引入 deadlock（没 skill 就没 system prompt）。
- **正则匹配**：reject，关键词维护成本比 includes 高。

### D3：headless ↔ visible 切换通过 close + relaunch，不通过 page.goto

切换流程：

```
[runner.ts dispatch task]
  └→ [runtime.runTask 准备阶段]
        ├→ skill.cookieDomain 不存在 cookie / login 检测失败
        │     ├→ browser.close()  // 关掉 headless
        │     ├→ browser = LocalBrowser.launch({headless: false, userDataDir})
        │     ├→ page = browser.createPage()
        │     ├→ page.goto(skill.loginURL)
        │     ├→ bridge.send(webAgentApprovalRequested{kind: "login_qr", ...})
        │     ├→ 轮询 page.evaluate(() => document.cookie 含目标 cookie) 每 2s
        │     ├→ 30 分钟超时 → webAgentTaskFailed{kind: cancelled}
        │     ├→ 检测到登录 → browser.close() → relaunch headless
        │     └→ 把 phase 由 .waitingForApproval 推回 running（通过事件流）
        └→ [GUIAgent 主循环：原 M3 逻辑]
```

为什么不复用同一个 browser instance + 切 page.headless：puppeteer-core 不支持运行时切 headless。用 `--remote-debugging-port` 然后 launch 第二个 visible browser 复用同一 user-data-dir 也可以，但调试复杂度更高；close + relaunch 是最直白的做法（多消耗 1-2s 启动时间，可以接受）。

### D4：每个 skill 独立 user-data-dir，cookie 在 chromium 层落盘

路径布局：

```
~/Library/Application Support/LarkIsland/web-agent/profiles/
  ├─ feishu/         # cookieDomain ".feishu.cn"
  │  ├─ Default/
  │  ├─ Cookies      # SQLite，chromium 自管
  │  └─ ...
  ├─ google/         # 未来 google skill
  └─ generic/        # 通用模式（不指定 skill 时）也用一份独立目录
```

skill 接口里 `cookieDomain` 字段当作"这个 skill 共用同一份 user-data-dir 的 key"。多个飞书 skill（IM/calendar/doc）共享 `profiles/feishu/`——因为它们共用同一份登录态。

考虑过把 cookie 单独导出存自家加密文件 + 任务前注入：reject，chromium 自管 cookie + IndexedDB + localStorage 是最稳的方案，自己复刻一遍 IndexedDB 太重。

### D5：审批事件 UI 用 `phase = .waitingForApproval`，复用现有 chrome

`AgentSession.permissionRequest` 这个字段当前在 SessionState 已经存在（M2 时定义），但只有 coding-agent 时代用过。M5 让 runner 触发 `webAgentApprovalRequested` 时 SessionState reducer 把：

- `session.phase = .waitingForApproval`
- `session.permissionRequest = .init(summary: message, affectedPath: "")`（复用结构）

灵动岛 `OpenedIslandView.taskBody` 已经渲染了 permission row（"Approval needed: <summary>"），M5 不用大改 UI；只需在 `IslandPanelView` 的 hasClosedActivity / scoutTint 计算里把 `.waitingForApproval` 也算成"高亮"颜色（橙色），让 closed 态左侧 BrandMark 跟右侧 dot 都变橙。

考虑过新增 SessionPhase（如 `.waitingForLogin`）：reject。phase 已经够多了，新增一个就要在所有 reducer / UI 颜色映射里加分支；复用 `.waitingForApproval` 语义恰好一致（"等待用户在外部完成动作"）。

### D6：登录检测策略——document.cookie 优先，DOM 探测兜底

`detectLoggedIn(page)` 默认实现：

```ts
async function defaultDetectLoggedIn(page, cookieDomain): Promise<boolean> {
  const cookies = await page.cookies()
  return cookies.some(c => c.domain.endsWith(cookieDomain) && c.name.includes('session'))
}
```

飞书的 session cookie 命名 `session` / `session_list` 等；不同 skill 在自己 `detectLoggedIn` 里可以覆写以处理特殊 case。

考虑过纯 DOM 检测（page.$('selector')）：reject，DOM 选择器随飞书前端发版变化太敏感；cookie 名稳定得多。

### D7：30 分钟扫码超时硬编码，不暴露成 profile 配置

login 等待超时 = 30 分钟。这个值不放进 LLMProfile 也不放进 skill 配置——它跟产品体验强绑定（没人愿意等 30 分钟以上扫码），不需要用户级定制。M7+ 想做"自定义扫码超时" UI 时再开放。

### D8：skill 路由失败时报告原因，不静默 fallback 到通用模式

如果 prompt 里出现"飞书"但所有飞书 skill 都不命中具体子关键词（如只说"飞书"），router 返回 null → runner 走通用模式，但要在 step 0 的 thought 里声明"未匹配到具体 skill, 走通用模式"。这样 demo 时调试方便。

考虑过强制返回最相似 skill：reject，错配比无配更糟（用户说"飞书帮我看看"结果跑去发消息）。

## 风险 / 取舍（Risks / Trade-offs）

- **Qwen3-VL-Plus 在飞书 React app 上 click 坐标不稳** → 缓解 1：feishu skill 系统 prompt 里写明"飞书界面元素坐标 box 通常 W×H 在 [40,400]×[30,80] 之间，避免点击 0,0 区域"；缓解 2：增加 few-shot 示例（M5 写至少 3 条飞书操作的范例）；缓解 3：降级 Doubao（profile 切换）；缓解 4：极端情况下 demo 时人工录屏裁剪掉失败片段。最坏 case 写 path B DOM 模式，留 backlog。
- **扫码期间任务被 supervisor 当 hung 任务超时杀掉** → 缓解：M3 spec 没硬性 task timeout（runner 自己保留 in-flight），supervisor 只在进程异常退出时 kill；扫码不会触发。
- **多 skill 共享 user-data-dir 竞争** → v0 单任务串行，无竞争；多任务并行（M7+）才需要解决。M5 不优化。
- **首次扫码 visible Chromium 失焦后 user-data-dir 写盘冲突** → puppeteer-core 默认 user-data-dir 排他锁；如果两个 chromium 同时打开同一 dir 第二个会启动失败。我们这里 close 完旧 browser 才 launch 新的，OS file system close 后 lock 立即释放，理论无问题；如果实测有 race，加 200ms sleep。
- **飞书前端改版导致 detectLoggedIn 失效** → 缓解：写两层（cookie 名 + DOM `[data-test-id="user-avatar"]`）；任一命中即视作已登录；M5 demo 期前实测一次。
- **AppModel 收到 `webAgentApprovalRequested` 时 SessionState reducer 还没把 session phase 切到 `.waitingForApproval`** → 缓解：M2 已经在 reducer 加了对应 case（archive 时验证过），M5 实测一次；如果没生效，bridgeServer 路由完后 AppModel 自己强制 set phase 兜底。
- **M5 写完后 demo 跑不动** → 缓解：M5 任务清单里包含"3 类任务各跑一次手动 e2e"作为验收；如果其中一类反复失败，写明在 archive 后让 M6 知道哪条 demo 不该录。

## 迁移计划（Migration Plan）

M5 是纯增加：没有现有用户数据 / 配置文件需要迁。落地步骤：

1. 在 `runners/web-agent/src/skills/` 建子目录与 `Skill` interface（`types.ts`）。
2. 实装 3 个 feishu skill 文件 + 1 个 router 文件 + 1 个 registry 入口。
3. 修改 `runtime.ts` 的 `runTask` 签名增加 `skill?: Skill` 参数；增加"login precheck"路径。
4. 修改 `runner.ts` 在 dispatch 之前调 `selectSkill(prompt, registry)`。
5. 增加 vitest 单测：router 关键词覆盖、skill registry 完整性、headless 切换 mock。
6. lark-island/ 端在 SessionState reducer 验证 `webAgentApprovalRequested` 已经走通；增加 IslandPanelView 颜色映射让 `.waitingForApproval` 显示橙色。
7. 手动 e2e：先跑通 IM 发消息（最简单），再跑日历/文档。
8. archive：把 `web-agent-skills` 新 capability + `web-agent-runner-service` modified 部分 sync 到 specs/。

回滚：M5 是独立 commit 链。如有阻塞性 bug，git revert 到 M4 archive commit (`deebb0f`) 即可，runner 会回到"通用模式 only"状态，不影响 M3 archive 的 demo 路径。

## 待解决问题（Open Questions）

1. **path B（DOM 模式）写不写**：design 倾向不写。但如果 M1 spike 时已知 Qwen3-VL-Plus 在飞书上不稳，应当提前写。**暂定**：M5 task 清单里包含"先跑一次 IM 任务实测命中率"作为 gate；命中率 < 50% 时立刻补 path B（额外 0.5 天工作量），> 50% 跳过。
2. **Login QR UI 是不是在 popover 里也展示一份**：用户切到 popover 后看不到灵动岛展开态。但灵动岛的"扫码中橙色提示"已经很明显，popover 里再加一份属于过度设计。**暂定**：popover 不加；M6 polish 阶段再说。
3. **skill 关键词冲突解决**：万一未来 google skill 加 "搜索" 关键词，跟飞书"搜索消息"冲突。**暂定**：skill 注册顺序定义优先级（飞书 > google），并且 router 第一命中即返回；后续真出现争议时再用更精细的策略（如"必须命中 ≥2 个关键词"）。
4. **是否暴露 cookie 路径给用户**：在 LarkIslandApp Settings 里加一个"清除飞书登录"按钮？**暂定**：M5 不加。用户想清除手动 `rm -rf ~/Library/Application\ Support/LarkIsland/web-agent/profiles/feishu` 即可。M7+ Settings 可以加。
5. **CookieDomain 字段在 BridgeCommand 上加吗**：proposal 提到了，但 design 里如果 runner 内部能解析 skill cookieDomain 就不需要 bridge 传。**暂定**：不加，runner 自己用 skill 配置即可，bridge schema 不变。
