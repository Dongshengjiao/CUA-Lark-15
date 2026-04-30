## Why

m11 archive 后第一次完整对照 [`docs/官方课题信息.md`](../../../docs/官方课题信息.md) — 发现两个 demo 评分硬空缺：

1. **官方 M3 阶段验收：在 IM / Calendar / Docs 三个子产品上各有 2+ 可运行用例**。我们当前 IM ✅ 实测过 m9（"hello m9 from bot" / "m10 心跳验证"两轮）+ m11（workflow step 1）；Calendar ✅ 实测过 m10 + m11 step 0；**Docs 0 次实测**（m7 仅有 skill 文件 + prompt 单测，从未端到端跑过）。Docs 单 task 实测必须立刻补上才符合官方 M3 阶段验收。
2. **官方加分项：跨产品联动测试**（"IM 收到日历邀请 → 跳转日历确认 → 返回 IM 验证状态"）。m11 已经搭好 workflow 编排框架，calendar+IM 联动跑通了。**docs+IM 联动 / IM+IM 同 surface 连串 / 3-step calendar+docs+IM 联动**这三种 workflow 变体一直没实测，正是 demo 录屏的素材库。

5/2 demo 截止前 ~36 小时，m12 是 demo 价值最大化的 milestone：把已经搭好的 m11 工作流框架在更多 skill 组合上跑一遍，每条都是 demo 可用素材。

非范围（推 m13+）：
- 评估报告 / 评测框架（成功率 / 步骤数 / 耗时统计自动化输出）— 推 m13 单独一个 milestone
- Demo 视频录制 + 答辩 PPT — 推 m14（实际录屏前置依赖 m12 的 workflow 矩阵就绪）
- Mail skill unblock — 账号未开通邮箱，留 m15+
- Base 多步 workflow — Base 单 task 在 m8 实测时 step 较多易超 maxLoopCount，先稳着用 IM/Calendar/Docs 三件套
- 灵动岛 UI 加 workflow 进度树 — 推后

## What Changes

m12 不写新代码，**只用现有 m11 工作流框架跑实测矩阵**：

- **A. Docs 单 task 实测（补 M3 阶段验收）**
  - 飞书 IM 私聊 bot 发：`"在飞书新建一个文档，标题是 m12 docs 测试"`
  - 验收：bot 走单 task 路径（无 workflow keyword）→ runner 路由到 `feishu_doc_create` skill → ≤ 50 step 完成 → 飞书云空间能看到带标题的新文档。
- **B. docs+IM 2-step workflow 实测（跨 surface workflow）**
  - 飞书 IM 私聊 bot 发：`"在飞书新建一个文档，标题是 m12 workflow doc，并给自己发条消息说文档已建"`
  - 验收：keyword 命中 → plan-llm 拆 2 步（创建文档 + 通知）→ step 0 跑 docs → step 1 prompt 含 step 0 finalAnswer → step 1 跑 IM → wf-done。验证 `$prev_result` 注入跨 surface 仍工作。
- **C. 3-step workflow 实测（验证 m11 max=3 封顶）**
  - 飞书 IM 私聊 bot 发：`"在飞书创建一个日程 m12 三步会，明天下午5点开始；再创建一个文档记录会议主题；最后给自己发消息确认都建好了"`
  - 验收：plan-llm 拆出恰好 3 步（不能 4 步）→ 顺序跑 calendar → docs → IM → wf-done。验证 m11 MAX_STEPS=3 卡 plan 边界正确。
- **D. IM+IM 2-step workflow 实测（同 skill 连串）**
  - 飞书 IM 私聊 bot 发：`"给自己发条消息说 hello m12，然后再发一条说 done"`
  - 验收：plan-llm 拆 2 步都路由到 `feishu_im_send`，runner 在同一个 IM 会话内连发两条消息。验证 workflow 不限制 skill 类型相同。

每条实测后整理出"prompt + 时间线 + step 数 + heartbeat 数 + 飞书侧用户视觉验证截图"，作为 m14 demo 录屏的脚本来源。

## Capabilities

### New Capabilities

无（继续复用 m9-m11 已有能力）。

### Modified Capabilities

- `feishu-bot-bridge`：spec 增加跨 surface workflow 的具体 scenario（docs+IM、3-step、IM+IM），把 m11 留下的"workflow 适用场景"具体化。
- `web-agent-skills`：spec 增加 `feishu_doc_create` 的实测验收（m7 时只是 prompt 准备态，m12 转为已验证态），并且根据 docs 实测结果决定是否 hotfix prompt。

## Impact

- **代码**：
  - 不新建 skill / 模块。
  - 视实测情况可能 hotfix `runners/web-agent/src/skills/feishu_doc_create.ts` prompt（如 docs 单 task 步数超预算 / VLM 找不到"+新建"按钮等）。如需 hotfix 也限定在 prompt body，不动 startingURL / loginURL。
- **协议**：bridge envelope 不变。
- **依赖**：无。
- **风险**：
  - **Docs surface 的 chromium 渲染差异**：m7 设计的 startingURL `https://www.feishu.cn/drive/me/` 在挑战赛账号 chromium 里能否落到 Drive 主页？m10 验证 calendar 时遇到过 messenger redirect 到 docs 主页的怪现象，docs 自己的入口可能反而 OK，但需要实测确认。
  - **3-step plan 拆分稳定性**：m11 max=3 没真测过。如果 LLM 拆出 4+ 步会被 plan parser 拒绝并 fallback 到 single task — 这正是 m12 想验证的边界。
  - **docs 步数预期**："新建空白文档 + 输入标题"理论 ≤ 6 step。如果 m12 docs 实测 > 50 step 会被 maxLoopCount 截断 — 需要 hotfix prompt（但 hotfix 也不算 m12 范围外，因为 m12 本身就有"docs 实测验收"目标）。
  - **m12 运行总时长**：4 个用例顺序跑 ≥ 12 分钟（每个 ~2-3 分钟）+ dev.sh 启停 + lark-cli lock 等 ≈ 30-45 分钟实测窗口。在 5/2 截止前剩 ~36 小时窗口里非常可控。
- **数据**：每条实测产生 IM 消息 + 飞书侧资源（日程 / 文档 / 多条 IM 消息）— 对账号清洁度无害。
- **运维**：dev.sh / bot bridge / runner 三件套与 m11 archive 状态完全一致，无新增配置。

## Demo 价值映射

把 m12 输出的 4 条实测线索映射到 demo 视频脚本（m14 用）：

| m12 实测 | demo 视频章节用途 |
|---|---|
| A Docs 单 task | 展示"自然语言驱动单产品测试"基本能力 — 课题 3.2.C |
| B docs+IM workflow | 展示"跨产品联动测试"加分项 — 课题 3.3 |
| C 3-step workflow | 展示"多轮对话编排" / "自然语言拆解" 加分项 — 课题 3.3 |
| D IM+IM workflow | 展示"多步操作串联执行" — 课题 3.2.A |

四条素材覆盖官方加分项的 50%（3/6），覆盖必做项的 100%（4/4）。
