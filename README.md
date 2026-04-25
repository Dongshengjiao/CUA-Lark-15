# CUA-Lark-15 · LarkVision-Tester

> 2026 飞书 AI 校园挑战赛 · **质量工程与智能测试方向** · 第 15 组  
> 一个**视觉驱动**的飞书桌面端智能测试 Agent

像真实用户一样"看屏幕、想策略、做操作、判结果、写报告"，端到端完成飞书桌面客户端的功能测试与质量评估。

## 核心创新

| # | 创新点 | 内核 |
|---|---|---|
| 1 | 三智能体协同（Planner / Executor / Verifier） | LangGraph 编排，规划与执行解耦、自愈反馈闭环 |
| 2 | 三层视觉验证 + Oracle 交叉校准 | 像素 Diff + OCR + VLM 加权投票；CLI 仅作评测期 Oracle |
| 3 | 自愈式执行 + 跨产品联动 E2E | 弹窗对抗、失败反思、IM ↔ 日历 ↔ Docs 联动用例 |

## 技术栈

| 层 | 技术 |
|---|---|
| 主 VLM | **豆包 2.0 Pro**（doubao-seed-2.0-pro，4 档 reasoning 路由）； 备选豆包 1.6 |
| 视觉感知 | mss 截图 + OmniParser v2（M2 接入）+ 豆包 2.0 Pro grounding |
| 执行 | PyAutoGUI + pynput（macOS 信任） |
| 验证 | OpenCV/SSIM + RapidOCR + 豆包 2.0 Pro 语义判断 |
| 编排 | LangGraph + Pydantic |
| 评估 | Streamlit Dashboard + Markdown 报告 |
| Oracle | `@larksuite/cli`（评测期交叉校准） |

详细架构见 [plan/2026-04-25-v0.2-plan.md](plan/2026-04-25-v0.2-plan.md)。

## 快速开始

```bash
# 1. 装 uv (Python 管理器)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. 同步依赖
uv sync

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 ARK_API_KEY

# 4. 跑测试
uv run pytest -q

# 5. 跑 M1 Demo（先打开飞书桌面客户端）
uv run python demo/m1_grounding_demo.py "飞书登录按钮"

# 或用统一 CLI
uv run lvt shot
uv run lvt ground "飞书设置图标"
```

完整环境配置见 [infra/env_setup.md](infra/env_setup.md)。

## 项目结构

```
CUA-Lark-15/
├── agent/             # 核心 Agent 代码
│   ├── llm/           # LLM 抽象 (base / doubao / router)
│   ├── perception/    # 截图 + grounding
│   ├── planner/       # 规划决策（M2 起）
│   ├── executor/      # 鼠标键盘
│   ├── verifier/      # 三层验证（M2 起）
│   ├── recovery/      # 自愈（M5）
│   ├── reporter/      # 评估报告（M4）
│   └── cli.py         # lvt 命令入口
├── bench/             # 标准用例集 + 评测
│   └── tasks/{im,calendar,docs}/
├── demo/              # 答辩 Demo + M1 demo 脚本
├── docs/              # 课题资料 + 系统设计文档
├── doc_auto/          # 同步代码架构（按 workspace rule）
├── infra/             # 环境配置文档
├── plan/              # 方案演进
└── tests/             # 单元 + 集成测试
```

## 里程碑（对齐官方 M1-M5）

| 里程碑 | 日期 | 状态 |
|---|---|---|
| M1 单步操作 | 04-25 ~ 04-28 | 进行中（脚手架完成） |
| M2 流程串联 | 04-29 ~ 05-02 | 待开始 |
| M3 多产品覆盖 | 05-03 ~ 05-06 | 待开始 |
| M4 评估体系 | 05-07 ~ 05-10 | 待开始 |
| M5 进阶优化 | 05-11 ~ 05-13 | 待开始 |
| **决赛答辩** | **05-14** | — |

## 飞书子产品覆盖目标

| 子产品 | 用例数 | 状态 |
|---|---|---|
| IM 即时通讯 | 6+ | 待开发 |
| 日历 Calendar | 4+ | 待开发 |
| 云文档 Docs | 4+ | 待开发 |
| 跨产品联动 | 1-2 | 加分项 |

## 决赛交付物

- [ ] ① 系统设计文档（`docs/system_design.md`）
- [ ] ② 源代码仓库（GitHub 完整代码 + README + 安装指南）
- [ ] ③ 3-5 分钟 Demo 视频
- [ ] ④ 评测报告（标准用例集完整数据 + 分析）
- [ ] ⑤ 答辩 PPT（15 分钟演讲 + 5 分钟 Q&A）

## 许可证

MIT License
