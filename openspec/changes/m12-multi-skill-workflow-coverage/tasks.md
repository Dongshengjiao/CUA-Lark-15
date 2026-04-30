# 任务：m12-multi-skill-workflow-coverage

> m12 是无代码增量的实测矩阵 milestone。所有任务都是"在飞书 IM 发 prompt → 看 bot 日志 + 飞书侧视觉 → 写下数据"的对账动作。

## 1. 启动环境

- [ ] 1.1 cleanup 旧进程：`pkill -9 -f "LarkIslandApp|feishu-bot|node.*runner|lark-cli event"`，删 SingletonLock。
- [ ] 1.2 启动 dev.sh：`LARK_BOT_PROFILE=challenge zsh scripts/dev.sh`，等到 `bot bridge pid=` + `bridge hello v2` 都出现。
- [ ] 1.3 确认 dev.sh log 含 `loaded env from .../web-agent/.env`（m11 hotfix 后必出）。

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

## 6. Post-implementation retrospective

> 4 条实测后填表，每条独立小节。最后写 5-7 句话整体结论。

### 6.A Docs 单 task 实测
> prompt: "..." | 路径: single | step: ... | 时长: ... | 飞书侧验证: ... | ✅/❌

### 6.B docs+IM workflow 实测
> 同上模板

### 6.D IM+IM workflow 实测
> 同上模板

### 6.C 3-step workflow 实测
> 同上模板 + plan-LLM 拆解 step 数实际值

### 6.E m12 整体结论 + 可作为 m14 demo 素材的 N 条 workflow

> 5-7 句话写：哪些用例稳定、哪些 known issue / 边界、demo 推荐主推哪 1-2 条最稳的。

## 7. 收尾

- [ ] 7.1 `npx @fission-ai/openspec validate m12-multi-skill-workflow-coverage --strict` 干净通过。
- [ ] 7.2 commit：
  - `docs(openspec): propose m12-multi-skill-workflow-coverage`（开 milestone）
  - 如有 hotfix → 单独 commit，例如 `fix(skills): feishu_doc_create prompt hardening from m12 docs run (m12)`
  - `chore(openspec): archive m12-multi-skill-workflow-coverage`（结束 milestone）
- [ ] 7.3 `npx @fission-ai/openspec archive m12-multi-skill-workflow-coverage --yes` 同步 specs/。
