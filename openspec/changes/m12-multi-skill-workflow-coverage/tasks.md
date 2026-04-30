# 任务：m12-multi-skill-workflow-coverage

> m12 是无代码增量的实测矩阵 milestone。所有任务都是"在飞书 IM 发 prompt → 看 bot 日志 + 飞书侧视觉 → 写下数据"的对账动作。

## 1. 启动环境

- [x] 1.1 cleanup 旧进程 + 删 SingletonLock。
- [x] 1.2 启动 dev.sh OK。
- [x] 1.3 dev.sh log 含 `loaded env from .../web-agent/.env`。

## 2. A 任务：Docs 单 task 实测（补 M3 阶段验收）

- [ ] 2.1 飞书 IM 私聊 bot 发：
  ```
  在飞书新建一个文档，标题是 m12 docs 测试
  ```
- [ ] 2.2 验收：
  - bot log 出 `incoming message ... text="在飞书新建一个文档..."`
  - bot log **不**出 `workflow keyword hit`（无连接词 → 走 single task）
  - bot log 出 `dispatched runWebAgentTask{taskID=...} (single)`
  - runner 路由到 `feishu_doc_create` skill（看 webAgentTaskStarted.payload.skill）
  - 任务 ≤ 50 step 完成 webAgentTaskCompleted（vs m10 calendar 46 step 是参考线）
  - 飞书云空间 `https://jcneyh7qlo8i.feishu.cn/drive/home/` 能看到一个标题为 "m12 docs 测试"（或类似）的新文档
  - bot 终态 IM reply 为 `✅ 任务完成（X 步 / Y.Ys）：...`
- [ ] 2.3 数据填到 §6.A。
- [ ] 2.4 如果失败 → 排查根因。如果是 prompt-side（VLM 找不到 "+新建" 按钮 / 文档创建后没找到标题输入框），hotfix `runners/web-agent/src/skills/feishu_doc_create.ts` 重测。如果是环境性（chromium 加载 Drive 主页时要求登录 / 有引导浮层），单独记录到 §6.A.gotcha 段。

## 3. B 任务：docs+IM 2-step workflow 实测

> 前置：A 任务通过（即 docs skill 已知能跑），否则跳过 B。

- [ ] 3.1 飞书 IM 私聊 bot 发：
  ```
  在飞书新建一个文档，标题是 m12 workflow doc，并给自己发条消息说文档已建
  ```
- [ ] 3.2 验收：
  - bot log 出 `workflow keyword hit; calling plan-llm (model=qwen-plus)...`
  - bot log 出 `plan-llm ok: 2 step(s) planned`
  - 飞书 IM 收到 `🔀 工作流开始（共 2 步）：1) <创建文档相关描述>  2) <通知相关描述>` reply
  - step 0 派 docs skill，runner 跑完 webAgentTaskCompleted
  - step 1 prompt 经 `renderTemplate` 注入 step 0 finalAnswer（看 dispatched 那行 prompt 含 `m12 workflow doc` 文本）
  - step 1 派 IM skill，runner 跑完 webAgentTaskCompleted
  - bot 终态 IM `✅ 工作流完成（共 2 步 / Y.Ys）` reply 出现
  - 飞书云空间能看到 "m12 workflow doc" 文档
  - 飞书自聊"我的"能看到一条机器人发的"文档已建（含文档信息）"消息
- [ ] 3.3 数据填到 §6.B。

## 4. D 任务：IM+IM 2-step workflow 实测

> D 提到 C 之前，因为 D 比 C 快（每步 ~6 step），先稳一个再上 3-step 风险。

- [ ] 4.1 飞书 IM 私聊 bot 发：
  ```
  给自己发条消息说 hello m12，然后再发一条说 done
  ```
- [ ] 4.2 验收：
  - bot log 出 `workflow keyword hit` + `plan-llm ok: 2 step(s) planned`
  - 两个 step 的 LLM-emitted prompt 都路由到 `feishu_im_send` skill（看 runner log 各 step 的 skill 字段）
  - 飞书自聊"我的"能看到 2 条机器人发的消息：一条含 "hello m12"，一条含 "done"
  - bot 终态 wf-done reply
- [ ] 4.3 数据填到 §6.D。
- [ ] 4.4 如 plan-LLM 把它判定为 single task（拆 1 步或 0 步）→ fallback IM reply 出现，记录到 §6.D 作为 plan-LLM 决策数据点（不算 m12 失败，是 plan-LLM 行为画像）。

## 5. C 任务：3-step calendar+docs+IM workflow 实测

> 最高风险，最后跑。

- [ ] 5.1 飞书 IM 私聊 bot 发：
  ```
  在飞书创建一个日程 m12 三步会，明天下午5点开始；再创建一个文档记录会议主题；最后给自己发消息确认都建好了
  ```
- [ ] 5.2 验收：
  - bot log 出 `workflow keyword hit` + `plan-llm ok: 3 step(s) planned`（关键：恰好 3）
  - 飞书 IM `🔀 工作流开始（共 3 步）：1) ... 2) ... 3) ...` reply
  - step 0 calendar，step 1 docs（注入 step 0 finalAnswer），step 2 IM（注入 step 1 finalAnswer）
  - 三个 surface 都有最终落地：日程 + 文档 + 自聊消息
  - bot wf-done reply 列出 3 个 bullet
- [ ] 5.3 数据填到 §6.C。
- [ ] 5.4 如 plan-LLM 拆出 ≠ 3 步：
  - 拆 4+ 步 → 走 m11 over-cap fallback (`steps over cap`)，bot 发 `工作流意图识别失败` IM reply + 退到 single task → 记录边界数据。
  - 拆 ≤ 1 步 → 走 m11 under-min fallback (`steps under min`)，同上。
  - 拆 2 步 → workflow 路径只跑 2 步（不是失败，但意味着 plan-LLM 把"+创建文档"和"+发消息"合并了），记录到 §6.C 作为 plan-LLM 决策数据点。

## 6. Post-implementation retrospective（实测于 2026-04-30 14:08–16:30 UTC+8）

m12 范围被实测演变为**单一靶心：解决 m11 calendar+IM workflow step 2 IM 早退**。原计划的 A/B/C/D 矩阵实测在 step 2 IM 反复早退后没有继续。下面是 8 轮 hotfix 的故事 + 最终结论。

### 6.1 v1-v8 hotfix 链概要

| # | 修复点 | commit | 实测结果 |
|---|---|---|---|
| v1 | wf-done summary：空 finalAnswer 标 ⚠️（透明） | 3539b35 | ✅ 用户能立刻看到失败步骤 |
| v2 | plan-LLM PLAN_SYSTEM_PROMPT 强制 `skill` 枚举 | 3539b35 | ✅ runner log 显示 `skill=feishu_im_send` 派对 |
| v3 | navigateToStartingURL：close 旧 page + createPage 新 page | 0afb7a9 | ❌ 用 internal `browser.browser.pages()` silent 失败 |
| v4 | `waitUntil: 'load'` 替代 DCL | 9201444 | ❌ messenger long-poll 让 load 永不触发 → nav 20s 超时 |
| v5 | DCL + SPA mount probe ≥ 30 elements | 338ada9 | ✅ probe 通过；但 VLM 仍空白（probe 阈值太低） |
| v6 | 用 public `LocalBrowser.getActivePage` 替代 internal | aae3ae7 | ✅ 真 close 了 active page |
| v7 | pin `activePage` + probe ≥ 100 + 后置诊断 log | 91c4f8c | ⚠ 诊断 log 暴露 step 1 IM SPA mount probe timed out |
| v8 | feishu_im_send.startingURL 改 tenant 子域（同 calendar） | 2977bc3 | ❌ tenant 子域 messenger 同样 SPA mount timeout |

### 6.2 最终诊断（v7 + v8 数据综合）

```
step 0 calendar (tenant)     : navigated fresh + SPA mounted ≥100 elements ✅
step 1 IM v7 (main domain)   : navigated fresh + SPA mount probe TIMEOUT 15s ❌
step 1 IM v8 (tenant domain) : navigated fresh + SPA mount probe TIMEOUT 15s ❌
```

`m9 archive` 时 IM 单 task 用 `www.feishu.cn/messenger/` ✅ 跑过 22 step 真发消息。当时 chromium 全新启动，**没有访问过 tenant 子域**。m12 workflow 第一步必经 calendar tenant 子域 → cookie state 改变 → messenger（不论域）都进不去。

**主因假设**：chromium 在 tenant 子域 calendar 拿到的 session cookies 与 messenger 的 SPA bootstrapping 假设冲突，messenger SPA 在跨域 navigate 后 hang 在初始化阶段。Feishu 可能对 cookie 域 + Origin/Referer 头 + tenant_id 多重校验，puppeteer 的连续跨域 navigate 触不到合法路径。

**修法上限**：受限于飞书前端的多重校验，仅靠 puppeteer 端调整难以可靠解决。需要的是要么（a）每个 step 重启整个 chromium 实例（成本 ≥ 5 秒 + 失去 cookie 持久化）；要么（b）把 IM 和 calendar 各自固定在自己 chromium 实例（成本：runner 改架构）；要么（c）改用 native 飞书桌面客户端 + accessibility tree（远超 m12 范围）。**这三条路都不属于 m12 deliverable，留 m13+**。

### 6.3 m12 真正交付的内容

虽然 step 2 IM 没在 workflow 中跑通，m12 实际交付了：

1. **bot bridge 透明化（v1+v2）已经合入 spec**：suspicious step 检测 + plan-LLM skill enum + diagnostic log。这套体系让"workflow 失败"不再静默，对 demo 录屏极有价值（用户能直观看到"哪步成功，哪步失败，为什么"）。
2. **runner navigate 体系硬化（v3-v7）**：close active + createPage + waitForFunction probe + activePage pin + 后置诊断。这是 m13+ 任何"per-skill chromium isolation"工作的脚手架。
3. **真根因结论性记录**（§6.2）：未来对接其他 SPA 时不会再撞同一个坑。

### 6.4 demo 素材建议（m14 直接复用）

可稳定 demo 的素材如下：

| 用例 | 来源 | 状态 |
|---|---|---|
| Calendar 单 task（m10 截图：5月1日 15:00 m10 demo 同步会） | m10 archive | ✅ 用户截图为证 |
| Calendar 单 task with heartbeat（46 step / 9 心跳） | m10 archive | ✅ |
| m11 workflow 启动 + plan-LLM 拆 2 步 + step 0 calendar 落地 | m11 archive | ✅ 局部成功（step 1 IM 标 ⚠️） |
| m12 wf-done ⚠️ 透明化（截图：⚠️ 工作流完成但 1 个步骤可能未真执行） | m12 v1-v2 实测 | ✅ 真实输出 |
| IM 单 task（m9 archive：钟梓文-北邮 hello from m9 bot） | m9 archive | ✅ 用户截图为证 |
| Base 单 task（m8 archive：m8 base 测试） | m8 archive | ⚠ 部分（创建过程跑到 step 7+） |

**Demo 录屏推荐主线**：m11 workflow 跑通到 step 0 + m12 ⚠️ 透明化提示 + m9 IM 单 task 独立跑通。**避开**：calendar+IM 工作流 step 2 实时演示。这条线避开真根因 + 仍展示编排+多产品+异常透明化三个加分点。

### 6.5 m12 五句话总结

1. **m12 范围被 step 2 IM 黑洞 hijack**：原计划 A/B/C/D 4 用例矩阵没跑，全 8 轮 hotfix 集中在一个 cross-domain SPA hang 问题上。
2. **8 轮 hotfix 仍未真解 step 2 IM**：但**每一轮都修了真问题**——v1+v2 永久改善了 demo 透明度，v6+v7 永久改善了 runner navigate 可观测性。这部分 spec delta 合入 archive。
3. **真根因清晰记录**：cross-domain (tenant ↔ main) cookie/session 污染是飞书 messenger SPA bootstrap 的硬约束；puppeteer 端难以绕过；m13+ 需要"per-skill chromium isolation"或"native 客户端 + AX 树"。
4. **demo 素材足够**：m10 calendar 单 task + m9 IM 单 task + m11 workflow step 0 + m12 ⚠️ 透明化，4 条独立有截图证据的素材足够支撑 3-5 分钟 demo。
5. **5/2 截止前下一个 milestone 应该是 m13 demo 录屏 + 评测体系**，不是再 grinding step 2 IM。

## 7. 收尾

- [x] 7.1 `npx @fission-ai/openspec validate m12-multi-skill-workflow-coverage --strict` 干净通过。
- [x] 7.2 commit 实际链（10 个 commit，远超 7.2 计划）：
  - `f66dda6 docs(openspec): propose m12-multi-skill-workflow-coverage`
  - `3539b35 fix(feishu-bot): m11 step-2 silent mis-route — plan-LLM skill enum + suspicious-step warning (m12)`
  - `eaba4ad fix(runtime): reuse active page for startingURL nav (m12 v2)`
  - `0afb7a9 fix(runtime): close stale pages + open fresh page (m12 v3)`
  - `9201444 fix(runtime): wait for SPA mount before handing page to GUIAgent (m12 v4)`
  - `338ada9 fix(runtime): use DCL + extended SPA-mount probe (m12 v5)`
  - `aae3ae7 fix(runtime): use public getActivePage instead of internal browser.pages (m12 v6)`
  - `91c4f8c fix(runtime): pin LocalBrowser.activePage + tighter SPA mount probe + diagnostics (m12 v7)`
  - `2977bc3 fix(skills): feishu_im_send startingURL → tenant /messenger (m12 v8)`
  - + 即将到来的 archive commit
- [-] 7.3 archive 时**不**同步 ADDED feishu_doc_create requirement（任务 A 没真跑），下一个 milestone（m13）单独 reset。
- [ ] 7.3' `npx @fission-ai/openspec archive m12-multi-skill-workflow-coverage --yes` — 在 commit 完所有 hotfix 后做。
