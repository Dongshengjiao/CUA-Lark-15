# Project Overview

**Name**: CUA-Lark-15 (LarkVision-Tester) — 飞书桌面端视觉驱动智能测试 Agent
**Tech Stack**: Python ≥3.11 (uv-managed), 火山方舟 doubao SDK, opencv-python, Pillow, mss, pytest. 评估中：TuriX-CUA (Python 源码) + DashScope qwen3-vl-plus
**Last Updated**: 2026-04-27

## Architecture

**v0.0.3 路线 (2026-04-27)**: 基于 TuriX-CUA 二开 + 自研补强模块. 不再完全自研 CUA 框架.

```
larkvision/         # vendored TuriX-CUA (commit 8f80ae6, MIT)
├── src/            #   上游源码不动
├── examples/       #   入口 + 我们改的 config.json
├── configs/        #   【自研】子产品预设
├── lark_skills/    #   【自研】飞书专属 SOP
└── UPSTREAM.md     #   FAQ Q4 引用合规

agent/              # 【自研】外挂式补强 (Python 3.11, uv)
├── verifier/       #   ⭐ 三层视觉验证 (TuriX 没做)
├── reporter/       #   评测报告
└── recovery/       #   M5 自愈

bench/tasks/        # 【自研】FeishuCUA-Bench YAML 用例
```

**主仓 venv**: Python 3.11 (uv) 只装 verifier/bench 依赖 (cv2 + scikit-image + RapidOCR + streamlit). ruff 排除 `larkvision/`.

**larkvision venv**: Python 3.12 独立 (uv)，跑 TuriX 主进程 (LangChain 全家桶 + DashScope OpenAI 兼容端点).

API key 通过进程 env `OPENAI_API_KEY` 注入，**不落 JSON**. 所有 LLM 配 `timeout: 45` 防 hang.

## Key Decisions

- **路线变更 v0.0.3 = 基于 TuriX-CUA 二开** — 2026-04-27 [[2026-04-27#decision]]（剩 17 天自研 SOTA 不现实；4-26 已实测 TuriX + qwen 飞书可用；FAQ Q4 鼓励借鉴）
- **vendor 子目录 + 外挂补强**而非 fork/submodule — 2026-04-27（评委一眼看到代码 + 自研边界清晰）
- 选 TuriX-CUA Python 源码而非 SuperPower DMG App — 2026-04-26（DMG 是 SaaS 积分制不能 BYOK）
- 选 DashScope qwen3-vl-plus 作为 brain/actor — 2026-04-26（替代 turix-actor 收费 / Doubao-1.5-UI-TARS 需审核 / 本地 Ollama 7B 内存紧）
- 所有 LLM 配 `timeout: 45` — 2026-04-26（DashScope 偶发 hang）
- 飞书 lark-* skills 走 `~/.agents/skills/` 真实存储 + `.claude/.cursor` 软链 — 2026-04-26（统一管理，一份实体多消费者）

## Known Issues

- DashScope qwen3-vl-plus 单次推理偶尔 50-60 秒（超长 prompt + 截图），timeout=45 可能 false positive；待观察是否需调到 60+
- qwen3-vl-plus grounding 偏弱，密集 UI（Lark 联系人列表、网页表单）点击精度不可靠

## Resolved Patterns

- **版本号是产品决策，不是工程清理副作用**：重构/删除/加模块/重写架构等技术变更默认不动 `pyproject.toml` 的 `version` 和 `__version__`；只有用户明确说"升版本到 X"才改 — 学到 2026-04-27 [[2026-04-27#correction-不要在用户没明确指示时擅自升语义化版本号]]
- **vendor 子目录 + 外挂式补强 = 二开开源项目最优工程结构**：物理复制 + 锁 commit + UPSTREAM.md + 主仓只装补强依赖 + ruff exclude 上游 — 学到 2026-04-27 [[2026-04-27#pattern-vendor-外挂式补强]]
- **多 venv 项目共享 .env**：仓库根放实体 `.env` + 子目录 `.env -> ../.env` 软链；`.gitignore` 的 `.env` pattern 递归生效自动忽略子目录；Python 进程靠 dotenv 自动加载不用 export — 学到 2026-04-27 [[2026-04-27#solution-一份-env-实体-仓库根-larkvision-双入口可见-软链方案]]
- **CUA agent "max_steps 失败" 第一查 done action**: 模型判 complete 不等于 agent 收到 done; 看 controller 是否报 `unexpected keyword argument` schema/handler 脱节 — 学到 2026-04-27 [[2026-04-27#solution-pattern-turix-上游-bug-fix-done-action-schema-handler-脱节]]
- **flash vs pro/plus 输出差异**: flash 严格按 schema 全字段输出, pro/plus 宽松会省略可选字段; 设计 schema 时假设最严格的模型会全字段输出, handler 必须接受所有声明的字段 — 学到 2026-04-27
- **CUA prompt 风格**：通用 VLM 必须用 imperative step-by-step + 显式 action 名 + 显式参数；不能用 "open Calculator" 这种意图描述 — 学到 2026-04-26 [[2026-04-26#pattern-imperative-step-by-step-prompts-for-generic-vlm-cua-agents]]
- **App 激活靠 AppleScript 不靠 open_app**：`run_apple_script` 跑 `tell application X to activate` 比 `open_app` 抢焦点更可靠 — 学到 2026-04-26 [[2026-04-26#fix-use-run-apple-script-to-forcefully-activate-lark-replace-hotkeys-with-input-text]]
- **能用 AppleScript 干的事不用 GUI 戳**：CUA 的最优组合 = AppleScript 处理"启动/激活/Safari 控制/系统调用"，纯 GUI 只用于真做不到的事 — 学到 2026-04-26
- **DashScope 调用必须设 timeout**：默认无超时会无限挂死 — 学到 2026-04-26 [[2026-04-26#fix-configure-timeout-45-on-all-llm-clients]]
