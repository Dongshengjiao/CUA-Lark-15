# 环境配置指南

> CUA-Lark-15 / LarkVision-Tester · 飞书桌面端视觉驱动智能测试 Agent  
> 适用平台：macOS（主）/ Windows（兼容）  
> 适用版本：v0.0.3（基于 TuriX-CUA 二开）

## 1. 系统先决条件

| 工具 | 版本要求 | 说明 |
|---|---|---|
| Python | **3.11+** + 3.12 | 主仓用 3.11; larkvision 子目录用 3.12; 都通过 `uv` 自动管理 |
| Node.js | 18+ | 装 `@larksuite/cli` 用（评测期 Oracle） |
| 飞书桌面客户端 | 与赛方一致版本 | 测试目标，[官方下载](https://www.feishu.cn/download) |
| uv | 最新 | 见下方安装 |

## 2. 装 uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
uv --version
```

## 3. 装两套依赖（主仓 + larkvision）

主仓和 larkvision 是**两个独立的 Python 项目**，依赖不重叠：
- **主仓**：自研补强模块（verifier / bench / reporter），需要 cv2 / scikit-image / RapidOCR / Streamlit
- **larkvision/**：vendored TuriX-CUA 主进程，需要 LangChain 全家桶 + DashScope

### 3.1 主仓依赖（Python 3.11）

```bash
cd /path/to/CUA-Lark-15
uv sync
```

uv 会装 Python 3.11.15 + 主仓 dependencies；产物在 `.venv/`。

验证：

```bash
uv run python -c "import agent; print(agent.__version__)"
# 期望: 0.0.3
```

### 3.2 larkvision 依赖（Python 3.12）

larkvision/ 已加极简 `pyproject.toml`（详见 [`larkvision/UPSTREAM.md` §4.1](../larkvision/UPSTREAM.md)）让 uv 识别它为独立项目. 一次性配置:

```bash
cd /path/to/CUA-Lark-15/larkvision
uv sync                              # 建空 .venv (Python 3.12)
uv pip install -r requirements.txt   # 装上游所有依赖 (pynput / langchain 全家桶 / playwright ...)
```

之后跑 example 直接 `uv run python examples/main.py --config configs/...`, 自动用 larkvision/.venv, 不需要 source activate.

> 上游 TuriX 有更新时, 重跑 `uv pip install -r requirements.txt` 即可 (依赖真相源是 requirements.txt, 不是 pyproject.toml).

## 4. 一次配 key 永久生效

### 4.1 申请 DashScope API Key（v0.0.3 主路径）

1. 登录 [阿里云百炼控制台](https://bailian.console.aliyun.com/)
2. 右上角 → API-KEY 管理 → 新建
3. 复制 `sk-xxx...`

### 4.2 填到本地 `.env`

仓库已为你建好 `.env`（基于 `.env.example`）+ `larkvision/.env`（软链到根 .env）。两个文件本质同一份。

```bash
cd /path/to/CUA-Lark-15

# 编辑根目录的 .env, 把占位符改成真 key
$EDITOR .env
# 或直接 sed:
# sed -i '' 's|sk-your-dashscope-key-here|sk-你的真key|' .env
```

完成后两边都能读到（Python 进程通过 `dotenv` 自动加载，**不需要每次 export**）：

```bash
# 仓库根验证
uv run python -c "from dotenv import load_dotenv,os;load_dotenv();print(os.getenv('OPENAI_API_KEY')[:10] + '...')"

# larkvision 验证
cd larkvision
uv run --project .. python -c "from dotenv import load_dotenv,os;load_dotenv();print(os.getenv('OPENAI_API_KEY')[:10] + '...')"
```

### 4.3 安全说明

- `.env` 已在 `.gitignore` 第 31 行被忽略（`.env` pattern 在子目录递归生效）
- `larkvision/.env` 是软链到 `../.env`，git 也自动忽略
- **永远不要**把真 key 写到 `.env.example` 或 `configs/*.json` 提交
- key 只活在你本地 `.env` 一个地方

## 5. macOS 关键权限（必须）

CUA Agent 需要操作鼠标键盘和截屏。**必须授权 3 项权限**给跑代码的进程：

```
系统设置 → 隐私与安全性 → 以下三项都加上 终端 / Cursor / Python.app:
  · 屏幕录制（截图）
  · 辅助功能（鼠标键盘控制）
  · 输入监控（pynput 兜底）
```

授权后**重启终端 / Cursor** 才生效。

## 6. lark-cli（评测期 Oracle 用，可选）

```bash
npm install -g @larksuite/cli
lark-cli config init
lark-cli auth login --recommend
lark-cli auth status   # 看到 logged in 即成功
```

> 主路径不依赖 lark-cli，仅评测阶段用作 Oracle 校准；开发期可暂跳。

## 7. 跑第一个用例

确保飞书客户端已登录且在运行：

```bash
cd /path/to/CUA-Lark-15/larkvision

# 用例 1: 给联系人发消息（4-26 已通）
uv run python examples/main.py --config configs/lark_im_send.json

# 用例 2: 全局搜索消息
uv run python examples/main.py --config configs/lark_im_search.json

# 用例 3: 群内 @ 提及
uv run python examples/main.py --config configs/lark_im_at_mention.json
```

**急停**：`Cmd+Shift+2`（任意时候按）。

## 8. 跑测试（主仓自研模块）

```bash
cd /path/to/CUA-Lark-15
uv run pytest -q
# 期望: 19/19 passed
uv run ruff check agent/ bench/ tests/
# 期望: All checks passed
```

## 9. 常见问题

### 问：`OPENAI_API_KEY` 报 `not set`
答：`.env` 没填或拼错。检查 `cat .env | grep OPENAI_API_KEY` 是不是真 key 不是占位符。

### 问：截图全黑
答：macOS 屏幕录制权限未授予；去系统设置加上、重启终端。

### 问：`pyautogui.click` 报 `IOError`
答：辅助功能权限未授予；同上。

### 问：DashScope 单次推理 50-60s
答：qwen3-vl-plus 偶发慢，已配 `timeout: 45`，超时后 TuriX 自动重试（max_failures=5）。

### 问：grounding 弱，密集 UI 戳不准
答：v0.0.3 路线已用 imperative + AppleScript + input_text 套路绕开纯坐标 grounding（见 [memory pattern](.cursor/memory/2026-04-26.md)）。

## 10. 关键目录速查

```
CUA-Lark-15/
├── .env                    # 你的真 key（不入库）← 4.2 节配
├── .env.example            # 样例（入库）
├── pyproject.toml          # 主仓 Python 3.11 依赖
├── .venv/                  # 主仓 venv（不入库）
├── agent/                  # 自研补强（verifier / reporter）
├── bench/tasks/            # YAML 用例集
├── larkvision/             # vendored TuriX
│   ├── .env -> ../.env     # 软链, git 忽略
│   ├── .venv/              # larkvision Python 3.12 venv（不入库）
│   ├── examples/main.py    # 入口
│   ├── configs/            # 子产品预设
│   └── lark_skills/        # 飞书 SOP 库
├── plan/                   # 方案演进
├── docs/                   # 课题资料 + 系统设计
└── tests/                  # 自研模块单测
```
