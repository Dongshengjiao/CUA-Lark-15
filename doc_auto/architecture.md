# 代码架构同步文档 (doc_auto)

> 按 workspace rule 维护。每次代码变更需同步更新对应模块说明并追加修改时间戳。

最近更新：2026-04-27 19:42（IM 子产品扩展到 3 用例: send_text + search + at_mention, M2 标杆达标）

## 1. 架构总览 (v0.3)

主仓 = **TuriX-CUA 二开 (larkvision/) + 自研补强模块 (agent/) + FeishuCUA-Bench (bench/)**.

```
CUA-Lark-15/
├── larkvision/                      # vendored TuriX-CUA (主 Agent 进程)
│   ├── UPSTREAM.md                  # 引用合规 (FAQ Q4)
│   ├── src/                         # TuriX 源码 (commit 8f80ae6)
│   │   ├── agent/                   # Brain + Actor + Planner + Memory
│   │   ├── controller/              # Action Registry + dispatch
│   │   └── mac/                     # macOS 原生 API (Quartz / AppleScript / pyautogui)
│   ├── examples/                    # main.py + config.json
│   ├── configs/                     # 子产品预设 (lark_im_send.json 等)
│   ├── lark_skills/                 # 飞书专属 SOP (Markdown)
│   │   ├── im/                      # 即时通讯 (im_send_text.md)
│   │   ├── calendar/                # 日历 (M3)
│   │   └── docs/                    # 云文档 (M3)
│   └── skills/                      # 上游样例 (保留)
│
├── agent/                           # 【自研】TuriX 外挂式补强
│   ├── verifier/                    # ⭐ 三层视觉验证
│   │   ├── types.py                 #   公共 dataclass: VerdictLevel / VerificationResult / VoteOutcome
│   │   ├── pixel_diff.py            #   L1: SSIM 像素相似度
│   │   ├── ocr_check.py             #   L2: RapidOCR 关键词校验
│   │   └── vote.py                  #   加权投票 (L3 高置信独立决策)
│   ├── reporter/
│   │   └── metrics.py               #   RunMetrics + summarize
│   ├── recovery/                    # M5
│   └── planner/                     # M2 (高层编排, 调 TuriX Brain 输出)
│
├── bench/                           # 【自研】FeishuCUA-Bench
│   ├── tasks/                       # YAML 用例
│   │   └── im/                      # M2 标杆 (≥ 3 E2E 用例) 已达标
│   │       ├── im_send_text.yaml         # 4-26 跑通: 给联系人发文本
│   │       ├── im_search_messages.yaml   # 4-27 创建: 全局搜索消息
│   │       └── im_at_mention.yaml        # 4-27 创建: 群内 @ 提及发消息
│   ├── runner.py                    # M4: 调 TuriX agent + verifier
│   └── oracle.py                    # M4: lark-cli 后端校准
└── tests/                           # 自研模块单测 (M2 起补)
```

## 2. 关键模块接口

### 2.1 `agent.verifier`

| 类型 | 职责 |
|---|---|
| `VerdictLevel` | StrEnum: pass / fail / uncertain / skipped |
| `VerificationResult` | 单层结果: layer / verdict / confidence / evidence / elapsed_ms |
| `VoteOutcome` | 投票结果: final / score / layers / reason |
| `pixel_diff_score(b, a) -> float` | SSIM (0-1) |
| `verify_changed(b, a, expect_change, threshold) -> VerificationResult` | L1 验证 |
| `extract_text(path) -> str` | RapidOCR 全文 |
| `verify_text(path, expect, forbid) -> VerificationResult` | L2 验证 |
| `vote(results, weights, high_conf_threshold) -> VoteOutcome` | 加权投票 |

权重默认: L1=0.2 / L2=0.3 / L3=0.5; L3 confidence ≥ 0.9 时独立决策.

### 2.2 `agent.reporter.metrics`

| 类型 | 职责 |
|---|---|
| `RunMetrics` | 单次 run 指标快照: success/elapsed/step_count/llm_calls/tokens |
| `summarize(runs) -> dict` | Bench 聚合: success_rate, avg_elapsed, total_tokens 等 |

### 2.3 `bench/tasks/*/yaml`

YAML 用例 schema:
```yaml
id: <unique>
domain: im | calendar | docs | cross
task: <imperative step-by-step prompt 模板, 含 {param} 占位>
parameters: { ... }
verifier:
  l1_expect_change: bool
  l2_expect_keywords: [str]
  l2_forbid_keywords: [str]
  l3_question: str
oracle:
  command: str  # lark-cli 命令
  expect_min_results: int
constraints:
  max_steps: int
  timeout_seconds: int
```

### 2.4 `larkvision/` (vendored, 不在我们维护)

- 上游入口: `examples/main.py`
- 上游 Agent: `src/agent/service.py`, `src/controller/service.py`
- 我们改造: `examples/config.json` + 新增 `configs/` + `lark_skills/`
- 详见 [larkvision/UPSTREAM.md](../larkvision/UPSTREAM.md)

## 3. 依赖关系

主仓 `pyproject.toml` 只装自研模块需要的依赖 (cv2 / scikit-image / RapidOCR / streamlit).
larkvision 用自带 venv (Python 3.12 + LangChain 全家桶), 见 `larkvision/requirements.txt`.

## 4. 数据流 (M4 Bench Runner)

```
bench/tasks/im/*.yaml   → bench/runner.py 渲染 task 模板
       ↓
larkvision/examples/main.py --task <rendered>
       ↓
TuriX Agent 主循环 (Brain → Actor → Controller → Memory)
       ↓
截图序列 + 操作轨迹 → agent/verifier/{pixel_diff, ocr_check, vote}
       ↓                        ↑ (L3 调用 TuriX 同款 LLM)
       ↓
bench/oracle.py (lark-cli 校准)
       ↓
agent/reporter/metrics.py (RunMetrics) → Markdown 报告 + Streamlit Dashboard
```

## 5. 修改时间戳记录

| 时间 | 改动 |
|---|---|
| 2026-04-25 19:50 | M1 脚手架落盘 (LLM 抽象 + 视觉感知 + 执行 + 18 单测) |
| 2026-04-25 20:55 | TuriX-CUA 调研报告 (`docs/turix_cua_review.md`); references/ 临时仓 |
| 2026-04-26 19:54 | TuriX + qwen3-vl-plus 飞书发消息打通 (3 步 65s) |
| 2026-04-26 commit b76e878 | 双 Provider 路由 + plan v0.3 (后被回滚) |
| 2026-04-27 18:08 | **v0.3 路线变更**: vendor TuriX → `larkvision/`; 删自研 llm/perception/executor; 写 verifier 3 层 / lark_skills / bench yaml / plan v0.3 |
| 2026-04-27 19:42 | **IM 子产品扩展**: 加 `im_search_messages` + `im_at_mention` 两套 (skill MD + config JSON + bench YAML), IM 用例数 1→3, M2 标杆 (IM ≥ 3 E2E) 达标 |
| 2026-04-27 19:53 | **本地 .env 实体 + larkvision 软链**: 一份 .env, 主仓和 larkvision 双入口 (cwd) 都能 dotenv 加载, 不用每次 export |
| 2026-04-27 20:24 | **larkvision/pyproject.toml 工程化补丁**: 让 `cd larkvision && uv run` 自动用 larkvision/.venv (Python 3.12, 含 pynput/langchain), 修复 ModuleNotFoundError; 首次需 `uv sync && uv pip install -r requirements.txt` |
| 2026-04-27 20:30 | **examples/configs 软链补丁**: `examples/configs -> ../configs`, 修复 main.py L294 把相对 config 路径强制 join 到 `__file__.parent` 导致 FileNotFoundError; .gitignore 改 globstar 兼容副作用 |
| 2026-04-27 20:48 | **Actor 切 qwen3-vl-flash**: 3 份 configs (im_send/search/at_mention) 的 actor_llm 从 plus 切 flash, 解决 DashScope 偶发慢导致单步 actor 51s 问题; Brain 保持 plus 不动. ✅ 实测 actor 单步稳定 1-2s |
| 2026-04-27 20:55 | **TuriX 上游 bug fix**: `controller/service.py` done handler 改用 `DoneAction` 接受可选 `text`, 修复 schema/handler 脱节导致 flash 输出 `{"done":{"text":"..."}}` 时 controller 拒收 + agent 死循环到 max_steps. UPSTREAM.md §4.3 登记 |
