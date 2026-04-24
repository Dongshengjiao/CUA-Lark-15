# CUA-Lark-15 初版方案（Initial Plan）

> 2026 飞书 AI 校园挑战赛 · CUA-Lark 赛道 · 第 15 组  
> 创建日期：2026-04-24  
> 文档版本：v0.1（初版，待讨论细化）

---

## 0. 赛事信息速览

| 项 | 内容 |
|---|---|
| 赛事 | 2026 飞书 AI 校园挑战赛 |
| 赛道 | CUA-Lark（Computer Use Agent × 飞书） |
| 组别 | 第 15 组 |
| 报名截止 | 2026-04-17（已报名） |
| 决赛答辩 | 2026-05-14 |
| 总奖池 | 8 万元现金 + 字节实习/Offer 机会 |
| 开发资源 | 火山方舟 Coding 套餐 + 飞书 API 无限调用额度 |
| 距决赛 | ~3 周（20 天） |

---

## 1. 赛道理解

### 1.1 CUA-Lark 的本质

`CUA-Lark = Computer Use Agent + Lark/飞书生态`

飞书提供了三层自动化接口，每层都有其不可替代的价值：

| 层级 | 接口 | 特点 | 适用场景 |
|---|---|---|---|
| L1 | `lark-cli` | 结构化、Token 省、可脚本化、确定性高 | 已覆盖的标准业务操作 |
| L2 | 飞书开放 API（HTTP/SDK） | 覆盖 2500+ 端点 | CLI 未封装的细粒度能力 |
| L3 | 飞书桌面/网页端 UI | 视觉泛化、支持长尾场景 | CLI/API 无法触达的界面操作 |

### 1.2 赛道的核心矛盾

> **何时用 CLI/API（高效、确定），何时用 UI 操作（灵活、泛化）？**

多数参赛队伍会选择**单一路径**——要么只做 Chatbot/纯 API 调用，要么只做纯 CUA。  
我们的**差异化定位**是构建"**混合智能体**"，让 Agent 自主在三层间切换。

---

## 2. 项目定位：LarkAgent-X

### 2.1 作品名称（暂定）

**LarkAgent-X：一个会自我进化的飞书双轨智能体**

### 2.2 一句话定位

让 AI 以"CLI 优先、UI 兜底、经验沉淀"三原则，端到端完成任意飞书办公任务；用得越多、跑得越快。

### 2.3 核心创新点（三板斧）

| # | 创新点 | 对应技术 | 评委看点 |
|---|---|---|---|
| 1 | **双轨协同规划**（Hybrid Planning） | LLM Planner 判断任务→路由 CLI / API / CUA | 工程深度 + `lark-cli` 生态亲和 |
| 2 | **UI 经验自动 → CLI Skill**（Self-Evolving） | CUA 轨迹 → LLM 归纳 → 自动生成 Skill YAML | 技术新颖性（Tool Forging） |
| 3 | **FeishuCUA-Bench 自建评测集** | `lark-cli` 作为 Oracle 自动验证 | 学术背书 + 可发 arxiv |

---

## 3. 技术方案

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                       用户自然语言指令                        │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
           ┌───────────────────────────────────────┐
           │          Planner (LLM)                │
           │   任务拆解 + 工具路由决策             │
           └───────┬─────────────┬─────────────┬───┘
                   ▼             ▼             ▼
          ┌────────────┐  ┌────────────┐  ┌────────────┐
          │  L1: CLI   │  │  L2: API   │  │  L3: CUA   │
          │ lark-cli   │  │ lark-oapi  │  │ UI-TARS +  │
          │ (首选)     │  │ (兜底)     │  │ 截图点击   │
          └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
                │               │               │
                └───────┬───────┴───────┬───────┘
                        ▼               ▼
              ┌────────────────┐  ┌──────────────────┐
              │  执行结果回路  │  │ Skill 沉淀引擎   │
              │  (观测+反思)   │  │ 高频 UI→CLI Skill│
              └────────────────┘  └──────────────────┘
```

### 3.2 技术选型

| 模块 | 推荐方案 | 备选 | 理由 |
|---|---|---|---|
| 主 LLM（Planner） | 豆包 Pro / 火山方舟 | Claude Sonnet 4.5 | 主办方送额度 + 政治正确 |
| CUA 视觉执行 | UI-TARS-72B | Claude Computer Use | 字节开源、与飞书天然亲和 |
| 虚拟桌面 | Docker + XVFB + noVNC | E2B Desktop / Scrapybara | 成本低、可自建、易部署 |
| 飞书交互 L1 | `@larksuite/cli` | — | 赛事主办方自家工具 |
| 飞书交互 L2 | `lark-oapi` SDK | — | 覆盖 CLI 未封装场景 |
| Agent 框架 | LangGraph | OpenAI Agents SDK | 多轨编排、状态机清晰 |
| 评测框架 | 自研 FeishuCUA-Bench | — | 无可用现成方案 |
| 开发语言 | Python 3.11+ | Go（CLI 层） | 生态成熟 |

### 3.3 三个创新模块详解

#### 模块 A：Hybrid Planner（混合规划器）

**输入**：用户自然语言任务  
**输出**：执行轨迹 `[(tool_level, command, expected_output), ...]`

**路由决策逻辑**：
1. 先查 `lark-cli` 的 Skills 索引（22 个内置 + 自沉淀的）→ 匹配则走 L1
2. 匹配不到，查 API schema（`lark-cli schema <method>`）→ 匹配则走 L2
3. 都不行 → 启动 CUA（L3），截图 + 视觉定位 + 鼠标键盘动作

#### 模块 B：Self-Evolving Skill 合成器

**触发条件**：同类 CUA 轨迹重复执行 ≥ 3 次

**流程**：
```
CUA 成功轨迹（截图序列 + 动作序列）
    ↓
LLM 归纳（抽取可变参数、识别幂等性）
    ↓
生成 Skill YAML（遵循 lark-cli skill-template）
    ↓
自动注入本地 Skills 目录
    ↓
下次同类任务直接走 L1（提速 10-100 倍）
```

**Demo 戏剧性**：首次执行 90 秒 → 第 4 次执行 5 秒，视觉冲击力拉满。

#### 模块 C：FeishuCUA-Bench 评测集

**任务来源**：
- 覆盖 `lark-cli` 14 个业务域 × 常见操作
- 初版目标：30 个任务（决赛前完成），长期扩展到 100+

**Oracle 自动判分**：
- 任务执行后调 `lark-cli` 查询状态 → 与期望对比
- 例如：任务"在日历建一个明天 10 点的会议"→ 执行后 `lark-cli calendar +agenda --date tomorrow` 验证

**评测指标**：
- 任务成功率（Success Rate）
- 平均耗时（Latency）
- Token 消耗（Cost）
- L1/L2/L3 调用占比（反映双轨效果）

---

## 4. 里程碑计划（3 周冲刺）

### Week 1（04-24 ~ 04-30）：地基搭建

| Day | 目标 | 产出 |
|---|---|---|
| D1 (04-24) | 确定方案、搭仓库结构 | ✅ Plan 文档、项目骨架 |
| D2-3 | `lark-cli` 封装层 + API 兜底层 | `agent/tools/lark_cli.py` |
| D4-5 | CUA 环境（Docker 桌面 + UI-TARS 接入） | 能跑通"打开飞书→发一条消息" |
| D6-7 | LangGraph Planner 框架 | 能端到端跑通 3 个任务 |

### Week 2（05-01 ~ 05-07）：核心能力

| Day | 目标 | 产出 |
|---|---|---|
| D8-9 | Skill 自动合成引擎 | UI 轨迹 → CLI Skill 的 PoC |
| D10-11 | Benchmark 任务库（20 个） | `bench/tasks/*.yaml` |
| D12-13 | Oracle 验证器 | 自动判分 pipeline |
| D14 | 中期验收：跑通完整评测 | 首份评测报告 |

### Week 3（05-08 ~ 05-14）：打磨 & 答辩

| Day | 目标 | 产出 |
|---|---|---|
| D15-16 | Demo 场景精心设计（3 个） | 答辩演示脚本 |
| D17 | 录制 Demo 视频 | mp4 + 字幕 |
| D18-19 | 答辩 PPT + 讲稿 | pptx + 讲稿 |
| D20 (05-14) | **决赛答辩** | 🎯 |

---

## 5. 项目目录规划（提议）

```
CUA-Lark-15/
├── README.md
├── plan/                           # 本目录
│   └── 2026-04-24-initial-plan.md  # ← 当前文档
├── doc_auto/                       # 按 workspace rule 维护的代码文档
├── agent/                          # 核心 Agent 代码
│   ├── __init__.py
│   ├── planner/                    # Hybrid Planner
│   │   ├── router.py
│   │   └── prompts.py
│   ├── tools/                      # 三层工具封装
│   │   ├── lark_cli.py             # L1: CLI 封装
│   │   ├── lark_api.py             # L2: API 兜底
│   │   └── cua.py                  # L3: CUA 控制器
│   ├── skills/                     # 自合成的 Skill
│   │   └── generated/
│   └── evolve/                     # Skill 合成引擎
│       └── synthesizer.py
├── bench/                          # FeishuCUA-Bench
│   ├── tasks/                      # 任务定义（YAML）
│   ├── oracle.py                   # 自动判分器
│   └── runner.py                   # 评测主程序
├── infra/                          # 基础设施
│   ├── docker/                     # CUA 桌面镜像
│   └── scripts/
├── demo/                           # 决赛 Demo 资源
│   ├── scenarios/
│   └── video/
├── docs/                           # 用户文档
├── tests/                          # 单元 + 集成测试（workspace rule 要求）
├── requirements.txt
└── pyproject.toml
```

---

## 6. 三个决赛 Demo 场景（初步构思）

### 场景 1：**"开完会了，剩下交给我"**（现场展示混合规划）

用户一句话：  
> "刚才的需求评审会，整理纪要、建 TODO 清单发给每个 owner、更新多维表格的项目状态"

Agent 行为：
- L1 CLI：拉消息、建任务、写多维表（展示 CLI 精准高效）
- L3 CUA：在飞书文档里插入一张手绘时间线图（CLI 没覆盖的长尾）

### 场景 2：**"同样的活儿，第二次快 20 倍"**（展示 Self-Evolving）

任务：定期把舆情监控平台的数据整理到飞书多维表。

- 第 1 次执行（UI 模式）：耗时 90s
- 执行后 Agent 自动合成新 Skill `monitor-to-base`
- 第 2 次执行：耗时 5s，**全 CLI 路径**
- 实时播放两次执行对比视频 → 视觉冲击

### 场景 3：**"我们造了个飞书版的 OSWorld"**（展示 Benchmark）

现场展示 FeishuCUA-Bench：
- 30 个任务自动跑完
- 对比：纯 CUA 基线 vs LarkAgent-X
- 成功率提升 X%、成本降低 Y%、耗时降低 Z%

---

## 7. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| `lark-cli` 权限不足，部分 API 调不通 | 中 | 高 | 申请主办方给的"无限额度"测试账号 |
| CUA 视觉模型在飞书界面识别率低 | 中 | 高 | 准备 OmniParser / SoM 作为定位兜底 |
| 开发时间不足 | 高 | 高 | 严格按里程碑砍需求；Benchmark 任务从 30 降到 15 也能答辩 |
| 火山方舟 Token 超限 | 低 | 中 | 本地跑小模型兜底；关键路径上缓存 |
| 答辩翻车（现场跑不起来） | 中 | 致命 | **录好备播视频 + 本地离线 Demo**，双保险 |

---

## 8. 分工建议（待组内确认）

| 角色 | 负责模块 | 建议人数 |
|---|---|---|
| 架构 & Planner | LangGraph 编排 + Prompt 工程 | 1 |
| CLI/API 集成 | `lark-cli` 封装 + Skill 合成 | 1 |
| CUA 执行 | 虚拟桌面 + UI-TARS 调用 + 视觉定位 | 1-2 |
| Benchmark & 答辩 | 任务设计 + Oracle + PPT + 视频 | 1 |

> 注：小组实际人数待填入；以上为建议占比。

---

## 9. 下一步立即动作（今日 D1）

- [x] 确认方案方向 & 写初版 Plan
- [ ] 建项目骨架目录（按 §5 规划）
- [ ] 初始化 Python 环境（`pyproject.toml` + `uv`/`poetry`）
- [ ] 装 `@larksuite/cli` 并跑通 `auth login`、`calendar +agenda`
- [ ] 组内同步本 Plan，收集反馈后出 v0.2

---

## 附录 A：关键参考资料

- `larksuite/cli` GitHub：<https://github.com/larksuite/cli>
- OpenClaw 飞书集成：<https://openclawlaunch.com/zh/feishu>
- UI-TARS 论文 & 开源：字节跳动 2025
- CUARewardBench（评测方法论参考）：arxiv 2510.18596

## 附录 B：待确认事项（Open Questions）

1. 小组成员名单 & 分工是否已定？
2. 是否已拿到主办方的飞书 API 额度和火山方舟账号？
3. 决赛答辩形式（线上/线下，时长）？
4. 本仓库是否需要保持完全公开？是否涉及敏感凭证处理？
5. 是否要同时投"AI 大模型安全赛道"（见初版 Idea 5，复用双轨架构即可）？

---

*本文档为 v0.1 初版，组内讨论后持续迭代，后续版本命名：`2026-MM-DD-<revision>-plan.md`*
