# CUA-Lark-15 · LarkVision-Tester

> 2026 飞书 AI 校园挑战赛 · **质量工程与智能测试方向** · 第 15 组  
> 一个**视觉驱动**的飞书桌面端智能测试 Agent

像真实用户一样"看屏幕、想策略、做操作、判结果、写报告"，端到端完成飞书桌面客户端的功能测试与质量评估。

## 站在巨人的肩膀上 (FAQ Q4)

本项目基于开源 [TurixAI/TuriX-CUA](https://github.com/TurixAI/TuriX-CUA) 二次开发 (MIT License, OSWorld 64.2%)，核心 Agent 主流程沿用上游，**自研创新点为飞书专属适配 + 三层视觉验证 + Oracle 评测体系**。详见 [larkvision/UPSTREAM.md](larkvision/UPSTREAM.md) 和 [docs/turix_cua_review.md](docs/turix_cua_review.md)。

## 工程结构

```
CUA-Lark-15/
├── larkvision/         # vendored TuriX-CUA + 飞书定制
│   ├── UPSTREAM.md     # 引用与改造说明
│   ├── src/            # TuriX 源码 (commit 8f80ae6)
│   ├── examples/       # 入口 main.py + 示例 config
│   ├── configs/        # 飞书子产品预设 (IM/日历/Docs)
│   ├── lark_skills/    # 飞书专属 SOP (im / calendar / docs)
│   └── ...
│
├── agent/              # 【自研补强模块】
│   ├── verifier/       # ⭐ 三层视觉验证 (L1 像素 Diff + L2 OCR + L3 VLM)
│   ├── recovery/       # M5 自愈式执行
│   └── reporter/       # 评测报告 + Streamlit Dashboard
│
├── bench/              # 【自研】FeishuCUA-Bench
│   ├── tasks/          # YAML 用例集 (IM/日历/Docs)
│   ├── runner.py       # 调 TuriX agent + 三层验证 (M4)
│   └── oracle.py       # lark-cli 后端校准 (M4)
│
├── plan/               # 方案演进 (v0.1 → v0.3)
├── docs/               # 课题资料 + 系统设计文档 + TuriX 调研
├── doc_auto/           # 代码同步文档 (workspace rule)
├── infra/              # 环境配置文档
└── tests/              # 自研模块单测
```

## 核心创新点

| # | 创新点 | 实现 |
|---|---|---|
| 1 | 三层视觉验证 + 加权投票 | `agent/verifier/{pixel_diff,ocr_check,vote}.py` |
| 2 | lark-cli Oracle 评测期校准 | `bench/oracle.py` (M4) |
| 3 | FeishuCUA-Bench 标准用例集 | `bench/tasks/{im,calendar,docs}/*.yaml` |
| 4 | 飞书专属 Skills 库 | `larkvision/lark_skills/` |
| 5 | 跨产品联动 E2E (M5) | `bench/tasks/cross/*.yaml` |
| 6 | Streamlit 评测 Dashboard | `agent/reporter/dashboard.py` (M4) |

## 快速开始

### 1. 主仓自研模块

```bash
# 主仓只用于跑 verifier / bench / reporter (Python 3.11+, uv 管理)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync
uv run pytest -q
```

### 2. larkvision (TuriX 主进程, Python 3.12 独立 venv)

```bash
cd larkvision
uv venv -p 3.12
uv pip install -r requirements.txt

# 配 DashScope key
export OPENAI_API_KEY="sk-..."

# 跑飞书发消息预设
uv run python examples/main.py --config configs/lark_im_send.json
```

详细环境配置见 [infra/env_setup.md](infra/env_setup.md)。

## 已验证用例

| 用例 | 子产品 | 状态 | 耗时 | LLM |
|---|---|---|---|---|
| 给指定联系人发文本消息 | IM | ✅ 4-26 跑通 | ~65s, 3 步 | qwen3-vl-plus |
| 创建日程 | Calendar | M3 待开发 | — | — |
| 新建文档 | Docs | M3 待开发 | — | — |

## 里程碑 (剩 17 天)

| 里程碑 | 日期 | 状态 |
|---|---|---|
| ✅ M1 单步操作 | -04-28 | 完成 (4-26) |
| M2 流程串联 | 04-28 ~ 05-01 | 进行中 |
| M3 多产品覆盖 | 05-02 ~ 05-05 | 待开始 |
| M4 评估体系 | 05-06 ~ 05-09 | 待开始 |
| M5 进阶优化 | 05-10 ~ 05-13 | 待开始 |
| **决赛答辩** | **05-14** | — |

## 决赛 5 项交付

- [x] ① 系统设计文档 (起草中: `docs/system_design.md`, M3 完稿)
- [x] ② 源代码仓库 (本仓库)
- [ ] ③ 3-5 分钟 Demo 视频 (M5)
- [ ] ④ 评测报告 (M4 起)
- [ ] ⑤ 答辩 PPT (M5)

## 文档导航

- 当前方案 (v0.3): [plan/2026-04-27-v0.3-plan.md](plan/2026-04-27-v0.3-plan.md)
- 上游引用合规: [larkvision/UPSTREAM.md](larkvision/UPSTREAM.md)
- TuriX 调研报告: [docs/turix_cua_review.md](docs/turix_cua_review.md)
- 环境配置: [infra/env_setup.md](infra/env_setup.md)
- 课题原文: [docs/官方课题信息.md](docs/官方课题信息.md)

## 许可证

MIT License (与 TuriX-CUA 上游一致).
