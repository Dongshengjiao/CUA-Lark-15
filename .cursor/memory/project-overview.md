# Project Overview

**Name**: CUA-Lark-15 (LarkVision-Tester) — 飞书桌面端视觉驱动智能测试 Agent
**Tech Stack**: Python ≥3.11 (uv-managed), 火山方舟 doubao SDK, opencv-python, Pillow, mss, pytest. 评估中：TuriX-CUA (Python 源码) + DashScope qwen3-vl-plus
**Last Updated**: 2026-04-27

## Architecture

主仓本身是飞书 Lark 桌面端的视觉测试 Agent 项目（pyproject.toml 标注，依赖 volcengine-python-sdk + opencv + mss）。`references/turix-cua/` 内嵌 TuriX-CUA 源码作为 CUA 选型对照实验，独立 venv 在 `references/turix-cua/.venv`（Python 3.12.13，via uv）。

CUA 实验栈：
- `references/turix-cua/.venv` — Python 3.12 隔离环境（uv 管理）
- DashScope OpenAI 兼容端点 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `examples/config.json`：brain/actor/planner = `qwen3-vl-plus`，memory = `qwen3-vl-flash`，全部 `timeout: 45`
- API key 通过 env `OPENAI_API_KEY` 注入，**不落 JSON**
- `~/.agents/skills/` 是 skill 真实存储，`~/.claude/skills/` 与 `~/.cursor/skills/` 是软链入口

## Key Decisions

- 选 TuriX-CUA Python 源码而非 SuperPower DMG App — 2026-04-26（DMG 是 SaaS 积分制不能 BYOK）
- 选 DashScope qwen3-vl-plus 作为 brain/actor — 2026-04-26（替代 turix-actor 收费 / Doubao-1.5-UI-TARS 需审核 / 本地 Ollama 7B 内存紧）
- 所有 LLM 配 `timeout: 45` — 2026-04-26（DashScope 偶发 hang）
- 飞书 lark-* skills 走 `~/.agents/skills/` 真实存储 + `.claude/.cursor` 软链 — 2026-04-26（统一管理，一份实体多消费者）

## Known Issues

- DashScope qwen3-vl-plus 单次推理偶尔 50-60 秒（超长 prompt + 截图），timeout=45 可能 false positive；待观察是否需调到 60+
- qwen3-vl-plus grounding 偏弱，密集 UI（Lark 联系人列表、网页表单）点击精度不可靠

## Resolved Patterns

- **CUA prompt 风格**：通用 VLM 必须用 imperative step-by-step + 显式 action 名 + 显式参数；不能用 "open Calculator" 这种意图描述 — 学到 2026-04-26 [[2026-04-26#pattern-imperative-step-by-step-prompts-for-generic-vlm-cua-agents]]
- **App 激活靠 AppleScript 不靠 open_app**：`run_apple_script` 跑 `tell application X to activate` 比 `open_app` 抢焦点更可靠 — 学到 2026-04-26 [[2026-04-26#fix-use-run-apple-script-to-forcefully-activate-lark-replace-hotkeys-with-input-text]]
- **能用 AppleScript 干的事不用 GUI 戳**：CUA 的最优组合 = AppleScript 处理"启动/激活/Safari 控制/系统调用"，纯 GUI 只用于真做不到的事 — 学到 2026-04-26
- **DashScope 调用必须设 timeout**：默认无超时会无限挂死 — 学到 2026-04-26 [[2026-04-26#fix-configure-timeout-45-on-all-llm-clients]]
