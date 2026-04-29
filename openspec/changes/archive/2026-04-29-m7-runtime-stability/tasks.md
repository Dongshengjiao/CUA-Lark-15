# 任务：m7-runtime-stability

## 1. Bug C 修复：runner profile 与 skill profile 对齐

- [x] 1.1 在 [`runners/web-agent/src/agent/login.ts`](../../../runners/web-agent/src/agent/login.ts) 把 `BrowserRef` 接口从 `{ current: LocalBrowser }` 扩成 `{ current: LocalBrowser; currentSegment: string }`。
- [x] 1.2 在 `ensureLoggedIn` 函数最前面（Phase 1 之前）加 Phase 0 segment 对齐逻辑：若 `browserRef.currentSegment !== skill.userDataDirSegment`，则 `safeClose` 当前 browser、launch 新 headless browser 用 `userDataDirFor(skill.userDataDirSegment)`、更新 `browserRef.current` 与 `currentSegment`。
- [x] 1.3 Phase 2/3（visible 扫码 → headless relaunch）的 mutate 处也要同步写 `browserRef.currentSegment`。
- [x] 1.4 [`runners/web-agent/src/runner.ts`](../../../runners/web-agent/src/runner.ts) 启动初始化 `browserRef = { current: browser, currentSegment: 'generic' }`。
- [x] 1.5 [`runners/web-agent/src/agent/runtime.ts`](../../../runners/web-agent/src/agent/runtime.ts) 的 `BrowserRef` 类型 import / 引用同步（runtime 通过 `import type { BrowserRef } from './login.js'` 自动跟随）。

## 2. Bug C 单元测试

- [x] 2.1 新建 [`runners/web-agent/test/login.test.ts`](../../../runners/web-agent/test/login.test.ts)，用 mock `LocalBrowser`（不真起 chromium）覆盖：
  - case A: `currentSegment === 'generic'`，调 ensureLoggedIn 一个 segment='feishu' 的 skill + detectLoggedIn 返回 true → `safeClose` 调用一次、新 launch 一次、`browserRef.currentSegment === 'feishu'`、Phase 2 visible 流程**不**触发。
  - case B: `currentSegment === 'feishu'`，detectLoggedIn 返回 true → 不触发 close+relaunch（保持 ref 不变）。
  - case C: `currentSegment === 'generic'`，detectLoggedIn 返回 false → 走 Phase 2 visible 流程（mock 在 detect 第 1 次 poll 时返回 true）→ Phase 3 relaunch headless，最终 `currentSegment === 'feishu'`。
  - case D（额外补的）：`skill.loginURL = ''` → 跳过整个预检 + 不切换 segment。
- [x] 2.2 暴露 ensureLoggedIn 的 LocalBrowser 工厂为可注入参数：在 `PrecheckArgs` 上增加 `browserFactory?: LocalBrowserFactory` 字段，默认 `(logger) => new LocalBrowser({ logger })`。
- [x] 2.3 `npm test -- --run login` 通过，4 个 case。

## 3. Bug A 缓解：feishu_im_send omni-search fallback

- [x] 3.1 在 [`runners/web-agent/src/skills/feishu_im_send.ts`](../../../runners/web-agent/src/skills/feishu_im_send.ts) 的 `systemPromptAddendum` 中新增 `## OMNI-SEARCH FALLBACK (use when stuck)` 段（按 design.md D2 范本写）；强调 fallback 是 LEGAL 路径、保留 conventional 会话搜索为 PREFER 首选。
- [x] 3.2 在 `## FEW-SHOT (self-chat)` 段后追加 `## FEW-SHOT (omni-search fallback after 2 mis-clicks)` 演示路径。
- [x] 3.3 [`runners/web-agent/test/skills.test.ts`](../../../runners/web-agent/test/skills.test.ts) 加 2 个断言：包含 `OMNI-SEARCH FALLBACK` / `LEGAL` / `PREFER` / 触发条件关键字 + 用 `hotkey(key='escape')` 全名（防 esc 缩写回归）。

## 4. 编译与单元测试

- [x] 4.1 `cd runners/web-agent && npm run typecheck` 通过。
- [x] 4.2 `cd runners/web-agent && npm test` 全过：**66 个** test，archive 时基线 56 → m6 hotfix +0（同 prompt 修复但不加测试）→ m7 +10（login.test 4 个 + skills.test omni-search 2 个 + 旧 m6 增加的 4 个）。
- [x] 4.3 `cd lark-island && swift build && swift test` 全过：**32 个** test 通过（与 m6 archive 时同；m7 不动 island 端代码）。

## 5. 端到端实跑（手工 smoke test）

- [x] 5.1 起 `scripts/dev.sh`，runner ready 在 **15 秒**内输出（含 swift build + LarkIslandApp launch + runner subprocess register）。
- [x] 5.2 跑通用 google 任务（task 6.4 收尾）：见 §6.1 实测数据。
- [x] 5.3 跑飞书 IM 任务（task 6.5 重测）：见 §6.2 实测数据。
- [x] 5.4 实测数据已补入 §6。

## 6. Post-implementation retrospective（实测于 2026-04-29 20:03–20:06 UTC+8）

### 6.1 task 6.4 通用 google 任务

- 命令：`npx tsx test/observer-client.ts demo-m7-google "在 google 搜索 UI-TARS 报告前 3 条结果"`

| 项目 | 验收线 | 实测 |
|---|---|---|
| `webAgentTaskCompleted` 是否 emit | 是 | ✅ emit |
| step events 数 | ≤ 15 | **8** |
| 总用时 | — | 33.6 秒 |
| 含 screenshotURL 的 step | ≥ 3 | ✅ 4 个（step 0/2/4/6） |
| finalAnswer 非空 | 是 | ⚠️ **空字符串** —— VLM 走到 `call_user()` 而非 `finished(...)` |
| runner 启动起始页是 google.com | 是 | ✅（VLM 第一步看到 google 输入框直接 type "UI-TARS\n"） |

**结论**：m7 不影响通用 google 路径。**finalAnswer 空**的原因是 Google 把 runner IP 标为"unusual traffic"返回了验证码页（实测 thought："系统检测到异常流量，显示了验证码页面"），VLM 走 `wait()` → `hotkey('f5')` 刷新仍然不行，最后 `call_user()` 优雅交还任务。这是**外部环境问题**（IP 反爬），不是 m7 引入的回归。BrowserOperator 的 `case 'call_user'` 分支只 cleanup 不抛错，所以 task lifecycle 仍 emit `webAgentTaskCompleted`，只是 finalAnswer 没传。task 6.4 的 lifecycle / 缩略图 / starting URL 三项验收通过；finalAnswer 验收待 demo 时换网络环境复测。

### 6.2 task 6.5 飞书 IM 任务

- 命令：`npx tsx test/observer-client.ts demo-m7-im "在飞书给自己发条消息：hello m7"`

| 项目 | 验收线 | M6 first run | M6 fix run（archive） | **M7 实测** |
|---|---|---|---|---|
| 是否触发 `webAgentApprovalRequested(login_qr)` | 否（Bug C 修复证据） | ✅ 触发（重扫码） | ✅ 触发（重扫码） | ✅ **不触发** —— Bug C 修复彻底通过 |
| step events 数 | ≤ 25（Bug A 缓解证据） | 5（fail） | 42 | ✅ **16** —— 比 M6 砍 62% |
| 总用时 | — | 34s（fail） | 175s | ✅ **52s** —— 比 M6 砍 70% |
| `webAgentTaskCompleted` | 是 | ❌ failed | ✅ | ✅ |
| 飞书自聊蓝色气泡 | 是（屏幕实拍） | ❌ | ✅ | ✅ —— `hello m7` + 时间戳 00:05 |
| finalAnswer 含完成信号描述 | 是 | — | ✅ | ✅ "右侧聊天窗口中出现了新的蓝色气泡（内容为'hello m7'），且时间戳为'00:05'，与历史消息'hello m6'并列" |
| Phase 0 swap 触发 | 是（来自 'generic' 切到 'feishu'） | N/A | N/A | ✅ runner 先跑 google 任务 currentSegment='generic'，飞书任务进 Phase 0 close+relaunch 切到 'feishu' |

### 6.3 VLM thought 链路（关键观察）

m7 的 thought 链路证明 prompt 的 OMNI-SEARCH FALLBACK 段**主动**起效，VLM 不再像 M6 那样需要 30 步反复试错才自己想到 fallback：

1. step 1：尝试点会话搜索框 `[14, 122]` —— Bug A 视觉 grounding 仍误导，弹出 omni-search 模态
2. step 3：识别误触，按新 prompt 调 `hotkey(key='escape')` 退出（Bug B 修复证据）
3. step 5：第二次尝试，仍然误触（Bug A 视觉 grounding 是模型层问题，prompt 解决不了）
4. step 7：**关键 thought**：`已连续两次误触全局搜索...切换到 omni-search fallback` —— 这是 m7 prompt §OMNI-SEARCH FALLBACK 直接驱动的决策（M6 first/fix run 中 VLM 用了 30 步反复试错才自己摸索到这条路径）
5. step 9 起：在 omni-search 模态里 type "梓文" → 点击第一项搜索结果 → 进入聊天 → type "hello m7" → Cmd+Enter
6. step 15：看到蓝色气泡，调 `finished('已通过飞书...')`

### 6.4 给下一回合（m8 候选）的输入

- ✅ Bug C 关闭。
- 🟡 Bug A 缓解但**未根治**：VLM 视觉 grounding 仍把会话搜索栏当全局栏。当前缓解依赖"误触 2 次后切 fallback"——首两步必然浪费。如果要把 step 数降到 ≤ 8，需要 path B（DOM `getByRole/getByText`），m6 archive §8.1 留的备选。
- ⏳ task 6.6（demo.mov 录制）—— 仍 backlog，agent 做不了。
- ⏳ task 6.4 在国内反爬环境下 finalAnswer 验收 —— 换网络/换搜索引擎再测。

## 7. 收尾

- [ ] 7.1 `npx @fission-ai/openspec validate m7-runtime-stability --strict` 干净通过。
- [ ] 7.2 拆 commit（4 个）：
  - `feat(runner): per-skill profile switching in ensureLoggedIn (m7 bug C)`（task 1.x）
  - `test(runner): cover ensureLoggedIn Phase 0 segment alignment (m7 task 2)`（task 2.x）
  - `feat(skills): add omni-search fallback path to feishu_im_send prompt (m7 bug A)`（task 3.x）
  - `chore(openspec): archive m7-runtime-stability`（task 7.3 之后做的）
- [ ] 7.3 `/opsx-archive m7-runtime-stability` 把 modified delta sync 进 `openspec/specs/`。
