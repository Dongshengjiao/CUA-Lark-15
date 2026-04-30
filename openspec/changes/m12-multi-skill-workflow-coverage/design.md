# 设计：M12 — 多 skill workflow 覆盖矩阵

## 背景（Context）

m11 archive 后立项；5/2 demo 截止剩 ~36 小时（含休息）。第一次完整对照 [`docs/官方课题信息.md`](../../../docs/官方课题信息.md) 三、3.2 和 3.3 节，发现：

- 课题"M3 多产品覆盖"阶段验收要求 IM / Calendar / Docs **三**子产品各 2+ 可运行用例。当前 IM 已 2 用例（m9 hello + m11 workflow step 1）✅，Calendar 已 2 用例（m10 单 task + m11 workflow step 0）✅，Docs **0 用例**（m7 写了 skill + 单测，从未端到端跑过）❌。
- 课题加分项"跨产品联动测试"在 m11 calendar+IM 跑通后已经 50% 完成，但只有 1 种 workflow 变体。docs+IM、IM+IM、3-step 这三种变体能直接复用 m11 的 LLM plan + WorkflowExecutor 机制不写新代码就跑出来。

m12 是在 5/2 demo 前**最大化 demo 素材库**而不是新增技术能力的 milestone。

涉及方：钟梓文（master plan §5 主链 + UI），m14 demo 录屏 / m13 评测体系都依赖 m12 跑出的实测数据。

约束：
- 不写新代码（除非实测中必须 hotfix）。
- 不动 BridgeServer / runner 协议 / island UI。
- 总实测窗口 ≤ 60 分钟（4 用例 × ~10-15 分钟每个，含 lark-cli lock 等）。
- 每条实测必须有"飞书侧视觉验证"作为最终判定。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**
- Docs 子产品端到端实测 ≥ 1 用例（A 任务）+ 跨 surface workflow ≥ 1 用例（B 任务）→ Docs 在 IM / Calendar / Docs 三件套里达到课题 M3 阶段的 2+ 用例验收线。
- 跨产品联动 workflow 变体覆盖：calendar+IM（m11 已有）+ docs+IM（B）+ IM+IM（D）+ 3-step calendar+docs+IM（C）= **共 4 种 workflow 形态**实测。
- 暴露任何 docs skill / plan parser 边界问题，hotfix prompt 或者明确记录 known issue。

**非目标：**
- 不写新 skill / 新模块代码。
- 不做评测框架（m13）/ 不录 demo 视频（m14）/ 不做答辩 PPT（m14）。
- 不优化 m11 plan parser 的 step 上限（max=3 vs max=5）— 验证现状即可。
- 不改善 IM/Calendar/Docs 任何已有 prompt（除非实测时必须）。
- 不解锁 Mail / Base / VC（账号或 maxLoopCount 限制）。

## 关键决策（Decisions）

### D1：实测顺序由"风险递增"决定

```
A Docs 单 task        ← 风险最低（单 skill，类似 m10/m11 calendar 流程）
B docs+IM workflow    ← 风险中（验证 docs 在 workflow 路径下能否跑通）
D IM+IM workflow      ← 风险中（同 skill 多 step 是否会冲突）
C 3-step workflow     ← 风险最高（plan parser max=3 真实边界）
```

A 失败 → 立刻 hotfix doc skill prompt 后再继续。  
B 失败 → 单独考虑 docs vs IM step 间的 cookie 共享 / userDataDirSegment 冲突，可能要回到 m7 hotfix。  
D 失败 → 极少数情况，可能 plan-LLM 拒绝拆同 skill。  
C 失败 → 落到 plan parser size > 3 fallback，依然算 m11 fail-safe 设计正常工作。

按这个顺序，前面的失败不影响后面的实测，每个用例都有"独立验收"语义。

### D2：每个实测都用一致的"prompt 模板 → 验收三件套"

```
prompt:        <用户在飞书 IM 发的原话>
路径:          <single | workflow keyword hit | workflow keyword miss>
step 时间线:   <log 摘要>
飞书侧验证:    <视觉证据 — 截图 / IM 消息内容>
通过/失败:     ✅/❌
```

把每条 m12 实测都按这个模板填进 tasks.md §6 retrospective，直接作为 m14 demo 录屏脚本的"分镜 + 旁白"来源。

### D3：m12 不引入新单测

m11 已有 54 case 覆盖 plan parser 的所有失败模式（包括 size > 3 边界）。m12 是实测验收，不是逻辑增量。**唯一例外**：如果 docs 实测发现 prompt 必须 hotfix，那个 hotfix 必须带 1-2 个对应的单测断言（参照 m10 / m11 hotfix 的 spec 同步约定）。

### D4：实测期间 dev.sh / bot bridge 不重启除非必要

m11 实测发现 dev.sh 重启 = lark-cli lock 等 30s + chromium SingletonLock 风险。m12 4 个实测尽量**单次 dev.sh 启动内串跑**，每个 task 跑完等 inFlight=null 再发下一个 prompt。如果中途 bot 自杀只能重启，记录到 retrospective 的 Gotcha 段。

### D5：3-step workflow（C 任务）的 prompt 必须明确 3 个动作

```
"在飞书创建一个日程 m12 三步会，明天下午5点开始；再创建一个文档记录会议主题；最后给自己发消息确认都建好了"
```

3 个动作用 `；` 分隔（m11 hotfix 已支持），每段都有动词 + surface 标识。这是 plan-LLM 最容易拆对的形式。如果 LLM 把它拆成 ≤ 2 步或 ≥ 4 步，分别落到 fallback 路径或 over-cap 拒绝路径，都算明确数据点。

## 风险 / 取舍（Risks / Trade-offs）

- **Docs 实测可能反复**：m7 的 doc skill prompt 写时没有挑战赛账号 chromium 的实操数据。挑战赛账号在 docs 主页可能有引导浮层 / 模态广告 / 不一样的"+新建"按钮位置。任何一项偏离都需要 hotfix prompt。但 m12 设了 budget：A 任务允许 2 轮 hotfix，超出第 3 轮就放弃 docs 实测、只跑 B/C/D 里不依赖 docs 的部分（B/C 都依赖 docs，D 不依赖）。
- **3-step 总时长**：calendar 22 step / 100s + docs ~30 step / 100s + IM 6 step / 30s ≈ 230s。超出 m11 单 workflow 133s 的实测纪录，但 maxLoopCount 是 per-step 的（30 step），所以总时长不影响成功率，**只**影响 demo 视频里 C 任务的播放时长（4 分钟）。可考虑录屏时倍速。
- **plan-LLM 不稳定**：qwen-plus 同样 prompt 在不同时刻可能给出不同拆解。如果 C 任务测 1 次 plan-LLM 拆出 2 步而非 3 步，m12 retrospective 仍然记录这次结果（fallback 到单 task 或者只跑 calendar+IM），并标注"qwen-plus 输出不稳"作为 m13+ 优化课题。
- **D 任务（IM+IM）的 plan 偏好**：plan-LLM 可能对"给自己发两条消息"判定为 "可以拆 2 步" 也可能判定为"一个动作分两次发，应该 single task"。m12 不改 prompt，按实测结果记录 — 这是 plan-LLM 自身决策的真实数据点。

## 迁移计划（Migration Plan）

1. 不动代码（除非 hotfix）。
2. 启动 dev.sh（m11 配置）。
3. 在飞书 IM 顺序发 4 条 prompt（A → B → D → C），每条等终态 reply 再发下一条。
4. 每条 prompt 跑完后，在 tasks.md §6 立刻记录 prompt + log 摘要 + 飞书侧视觉验证（截图描述）+ ✅/❌。
5. 如 A/B/C 期间 docs hotfix：commit 单独 hotfix commit，retrospective 单独标注。
6. 全部 4 条实测后做 §7 收尾 + archive m12。
7. 失败回滚：m12 是无代码变更的 milestone，archive commit 内容也是纯 OpenSpec 文档变更，revert 风险极低。

## 待解决问题（Open Questions）

1. **Docs surface 在 chromium 里加载后是不是 Drive 主页**：m11 时遇到过 messenger redirect 到 docs 主页的现象，所以可能 docs 主页才是"自然落地"的位置。如果是，m7 写的 startingURL 对，但要看"+新建"按钮在 chromium 里实际坐标。
2. **plan-LLM 对 C 任务（3 个明显动作 + 2 个分号）能否稳定拆 3 步**：依赖 qwen-plus 的指令理解能力。系统 prompt 里已经强调 "ACTIONS ≤ 3"，但模型也可能把"创建日程 + 创建文档"判定为 1 步。
3. **D 任务的 IM 同 skill 连发是否被 runner 接受**：runner 内 inFlightTask 锁是 per-task 的，bot 派 step 0 完成后才派 step 1 — 不会冲突。但 chromium 里同一个聊天连发两条消息，第二次时光标 / 输入框状态可能与第一次不同，VLM 需要重新定位。
