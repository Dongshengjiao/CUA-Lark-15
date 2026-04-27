# LarkVision 引用与改造说明

> 本目录 `larkvision/` 基于开源项目 [TurixAI/TuriX-CUA](https://github.com/TurixAI/TuriX-CUA) 二次开发。  
> 对齐 2026 飞书 AI 校园挑战赛 FAQ Q4 要求：「鼓励基于现有开源项目二次开发，需明确标注引用来源，并说明自研创新点」。

## 1. 上游来源

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/TurixAI/TuriX-CUA |
| Vendored commit | `8f80ae656ebb72a86592128c87fde3ef1c49af17`（main 分支，"update QRcode"） |
| 引入时间 | 2026-04-25（克隆调研） / 2026-04-27（vendored 进主仓） |
| License | MIT（保留原 `LICENSE` 文件） |
| 上游性能 | OSWorld 64.2% / OSWorld-style Mac 80% |

## 2. 为什么选 TuriX-CUA

- **架构匹配**：Brain / Actor / Planner / Memory 多 LLM 角色协同，对齐官方课题 §3.1 推荐的「视觉感知 + 规划决策 + 执行 + 验证 + 报告」五层
- **Python + LangChain**：可平滑接入豆包 / Qwen / OpenAI / Claude 任意一个 OpenAI 兼容端点
- **MIT 协议**：最自由的 OSS 协议，允许商用 / 修改 / 闭源衍生
- **可 BYOK**（vs TuriX SuperPower DMG SaaS 积分制无法接私钥）
- **macOS 全套实现就绪**：AX Tree / Quartz 截图 / pyautogui 动作 / AppleScript 都现成

详细调研报告见 [../docs/turix_cua_review.md](../docs/turix_cua_review.md)。

## 3. 我们的改造内容（自研创新点）

| 改造点 | 文件 | 说明 |
|---|---|---|
| LLM Provider 切换 | `examples/config.json` | brain/actor/planner 改用 DashScope `qwen3-vl-plus`，memory 用 `qwen3-vl-flash`；timeout=45 防 hang |
| 飞书任务 prompt | `examples/config.json` agent.task | 显式 step-by-step + AppleScript 激活 + input_text 兜底 |
| 飞书专属 Skills（TODO） | `lark_skills/` | IM / 日历 / Docs / 跨产品联动 SOP |
| 多任务配置预设（TODO） | `configs/` | 不同子产品的 config.json 预设 |

## 4. 与上游差异（精确清单）

```
examples/config.json    # 改 LLM provider/model/base_url/timeout/task
```

其余文件**保持上游原样**，便于后续 `git remote add upstream` + `git fetch upstream` 跟踪上游更新。

## 5. 主仓自研补强模块（不在 larkvision/ 内，作为外挂）

| 模块 | 路径 | 价值 |
|---|---|---|
| 三层视觉验证 | `agent/verifier/` | TuriX 把 verifier 融在 Brain，我们独立做 L1 像素 Diff + L2 OCR + L3 VLM 加权投票，提升判分准确度 |
| FeishuCUA-Bench | `bench/` | 标准用例集 + lark-cli Oracle 校准（TuriX 没有评测体系） |
| 评估报告层 | `agent/reporter/` | Streamlit Dashboard + 操作轨迹回放（TuriX 无可视化） |
| 自愈式执行 | `agent/recovery/` | 弹窗对抗 + 失败反思 + 替代路径 |

## 6. 上游同步策略

短期（决赛前）：**冻结**在 commit `8f80ae6`，避免上游变更引入回归。

长期（决赛后）：可配 git remote 拉 upstream：

```bash
# (可选) 如未来想跟随 upstream 更新
git remote add turix-upstream https://github.com/TurixAI/TuriX-CUA.git
git fetch turix-upstream main
git diff turix-upstream/main -- larkvision/  # 看上游有什么新东西
```

## 7. 致谢

感谢 TurixAI 团队开源出色的 CUA 工作。上游 README 中的核心贡献者：
- Tongyu-Yan
- 项目仓库：https://github.com/TurixAI/TuriX-CUA
- ClawHub Skill：https://clawhub.ai/Tongyu-Yan/turix-cua

如本目录代码引发任何疑问，请优先以 [TurixAI 上游仓库](https://github.com/TurixAI/TuriX-CUA) 的对应 commit 为准。
