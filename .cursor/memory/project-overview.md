# Project Overview

**Name**: CUA-Lark-15 — 多路线探索：(1) LarkVision-Tester 视觉驱动测试 agent；(2) lark-island 飞书内部协作 AI 中枢（OPC mode）
**Tech Stack**:
- 主路线 lark-island（**目前的 active 主线**）：TypeScript/Node 20+ runner（@ui-tars/sdk + Qwen3-VL-Plus + LocalBrowser）+ Swift 6.2 灵动岛 macOS app + Unix socket bridge + lark-cli WebSocket 事件订阅
- 旧路线 LarkVision-Tester：Python ≥3.11 (uv) + TuriX-CUA vendored + opencv-python/Pillow/mss/pytest（评估期，本月未推进）
**Last Updated**: 2026-04-30

## Architecture

### 主路线：lark-island（M1-M9 已落地，2026-04-28 ~ 2026-04-30）

```
runners/web-agent/    # Node runner：UI-TARS + Qwen3-VL-Plus 驱动 chromium 跑飞书 web agent
runners/feishu-bot/   # M9 加：lark-cli event +subscribe → BridgeServer observer → 回执
lark-island/          # Swift 灵动岛 app + BridgeServer (Unix socket) + RunnerSupervisor
openspec/             # OpenSpec change 流程：proposal/design/tasks/specs delta + archive
scripts/dev.sh        # 一键启动 swift build + LarkIslandApp + 选择性 spawn bot bridge
```

5 个内置飞书 skill（IM / mail / calendar / doc / base）共享 `feishu` user-data-dir segment。Mail 实施完成但 deferred stub（挑战赛账号未开通邮箱产品）。每个 skill 的 systemPromptAddendum 走 m7-hotfix 五段模板：ACTION SYNTAX / IMPORTANT / OMNI-SEARCH FALLBACK / CONVENTIONAL FLOW / COMPLETION SIGNAL / FEW-SHOT。M9 起 BASE_SYSTEM_PROMPT 也内置 ACTION SYNTAX 段（generic 模式 + 所有 skill 共享）。

三条用户输入入口：(1) 菜单栏 🌐 popover；(2) `runners/web-agent/test/observer-client.ts` CLI；(3) M9 飞书 IM 私聊机器人（lark-cli WebSocket 长连接 + bot bridge observer client + lark-cli im +messages-send 回执）。

### 旧路线：LarkVision-Tester v0.0.3 (2026-04-27 决策定稿，本月未推进)

基于 TuriX-CUA 二开 + 自研补强模块. 不再完全自研 CUA 框架.

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

- **lark-island 路线 = OPC mode 飞书内部协作 AI 中枢 + 灵动岛 UI** — 2026-04-28 起（master plan §2 把产品定位写成 "OPC = One-Person Company 超级个体的飞书内部 AI 中枢"，5/7 前必须出六子产品 demo + 一条整合工作流 + 灵动岛 UI 壳）
- **OpenSpec change 流程**作为每个 milestone 的工程纪律 — 2026-04-28（每个 milestone 走 propose / 实施 / retrospective / archive 四段；hotfix 不再开新 change，单 commit 修后 retrospective 追加到原 archive tasks.md）
- **bot bridge 走 BridgeServer observer role 而非新协议** — 2026-04-29 [[2026-04-29#21:57]]（不动 BridgeServer / runner / 岛 UI，纯加观察者客户端；lark-cli WebSocket 零公网部署）
- **路线变更 v0.0.3 = 基于 TuriX-CUA 二开** — 2026-04-27 [[2026-04-27#decision]]（剩 17 天自研 SOTA 不现实；4-26 已实测 TuriX + qwen 飞书可用；FAQ Q4 鼓励借鉴）
- **vendor 子目录 + 外挂补强**而非 fork/submodule — 2026-04-27（评委一眼看到代码 + 自研边界清晰）
- 选 TuriX-CUA Python 源码而非 SuperPower DMG App — 2026-04-26（DMG 是 SaaS 积分制不能 BYOK）
- 选 DashScope qwen3-vl-plus 作为 brain/actor — 2026-04-26（替代 turix-actor 收费 / Doubao-1.5-UI-TARS 需审核 / 本地 Ollama 7B 内存紧）
- 所有 LLM 配 `timeout: 45` — 2026-04-26（DashScope 偶发 hang）
- 飞书 lark-* skills 走 `~/.agents/skills/` 真实存储 + `.claude/.cursor` 软链 — 2026-04-26（统一管理，一份实体多消费者）

## Known Issues

- **lark-island**: Qwen3-VL-Plus 在飞书 React UI 上的视觉 grounding 偏弱——把顶部全局栏当浅色会话搜索，用 OMNI-SEARCH FALLBACK prompt 缓解但首 2 步必然浪费；真正根治需 path B（DOM `getByRole/getByText`，m6 §8.1 backlog）
- **lark-island**: 飞书挑战赛账号 `cli_a978b87cf6b9dbd8` 未开通邮箱产品 → `feishu_mail_send` skill deferred stub；切到有邮箱账号后单行 registry 复活
- **lark-island**: lark-cli `event +subscribe` 单例锁——bot bridge 跟手动 subscribe 不能共存；启动前要 pkill 现有手动 subscribe
- **larkvision/旧路线**: DashScope qwen3-vl-plus 单次推理偶尔 50-60 秒（超长 prompt + 截图），timeout=45 可能 false positive；待观察是否需调到 60+
- **larkvision/旧路线**: qwen3-vl-plus grounding 偏弱，密集 UI（Lark 联系人列表、网页表单）点击精度不可靠

## Resolved Patterns

- **VLM 坐标 / key 名漂移要在 BASE prompt 层修，而不是 leaf skill 层**：m6/m7/m8/m9 累计踩到三次同款 prompt drift（IM `'esc'` / doc `start_box=[...]` 无引号 / generic `start_box=[...]` 无引号），每次只修 leaf skill 都 sub-optimal；最终把 ACTION SYNTAX WRONG/CORRECT 段提到 `runtime.ts` BASE_SYSTEM_PROMPT 一次覆盖 generic + 5 个 skill；WRONG/CORRECT 对照例子比单展示 CORRECT 强得多 — 学到 2026-04-30 [[2026-04-30#00:03]]
- **跨语言 IPC schema 假设错位是经典坑**：Swift `BridgeServer` 编码 `AgentEvent` 时 payload 嵌套在跟 type 同名的 key 下（`{type: "X", X: {...}}`），TS `BridgeCodec` decode 时重命名为 `payload`；m9 bot bridge 直接 raw `JSON.parse` 没经过 codec，结果取 `payload.taskID` 全部为 undefined → 静默 drop 所有事件；修法是收到 event 立即 normalize `evRaw.payload = evRaw[evRaw.type]`；下次同类 IPC 必须先看现有 codec 决定要不要 reuse — 学到 2026-04-29 [[2026-04-29#23:37]]
- **飞书 IM idempotency-key 必须含 nonce**：`md5(chatID + text)` 当 key 在重发同 prompt 时被 server 幂等去重，对应 reply 直接消失；正确做法是把 messageID/taskID 拼进 hash，让"同任务重试"幂等去重而"同文本不同任务"真发 — 学到 2026-04-29 [[2026-04-29#23:41]]
- **OpenSpec spec sync MODIFIED 必须 header 字面匹配**：`### Requirement: <header>` 改 header 文字会让 archive 命令报 `header not found`；即使语义已变（"三个" → "五个"）也保留原 header + 在 body 描述变化是最稳的做法 — 学到 2026-04-29（M8 spec sync 踩过）
- **lark-cli 多 profile 共存用 `--name`**：`lark-cli config init --name <profile>` 追加新 profile 不动现有；切换用 `--profile <name>`；`event +subscribe` 必须 `--as bot`，`im +messages-send` 用 `--as bot` 让消息以机器人名义发出 — 学到 2026-04-29 [[2026-04-29#22:03]]
- **版本号是产品决策，不是工程清理副作用**：重构/删除/加模块/重写架构等技术变更默认不动 `pyproject.toml` 的 `version` 和 `__version__`；只有用户明确说"升版本到 X"才改 — 学到 2026-04-27 [[2026-04-27#correction-不要在用户没明确指示时擅自升语义化版本号]]
- **vendor 子目录 + 外挂式补强 = 二开开源项目最优工程结构**：物理复制 + 锁 commit + UPSTREAM.md + 主仓只装补强依赖 + ruff exclude 上游 — 学到 2026-04-27 [[2026-04-27#pattern-vendor-外挂式补强]]
- **多 venv 项目共享 .env**：仓库根放实体 `.env` + 子目录 `.env -> ../.env` 软链；`.gitignore` 的 `.env` pattern 递归生效自动忽略子目录；Python 进程靠 dotenv 自动加载不用 export — 学到 2026-04-27 [[2026-04-27#solution-一份-env-实体-仓库根-larkvision-双入口可见-软链方案]]
- **CUA prompt 风格**：通用 VLM 必须用 imperative step-by-step + 显式 action 名 + 显式参数；不能用 "open Calculator" 这种意图描述 — 学到 2026-04-26 [[2026-04-26#pattern-imperative-step-by-step-prompts-for-generic-vlm-cua-agents]]
- **App 激活靠 AppleScript 不靠 open_app**：`run_apple_script` 跑 `tell application X to activate` 比 `open_app` 抢焦点更可靠 — 学到 2026-04-26 [[2026-04-26#fix-use-run-apple-script-to-forcefully-activate-lark-replace-hotkeys-with-input-text]]
- **能用 AppleScript 干的事不用 GUI 戳**：CUA 的最优组合 = AppleScript 处理"启动/激活/Safari 控制/系统调用"，纯 GUI 只用于真做不到的事 — 学到 2026-04-26
- **DashScope 调用必须设 timeout**：默认无超时会无限挂死 — 学到 2026-04-26 [[2026-04-26#fix-configure-timeout-45-on-all-llm-clients]]
