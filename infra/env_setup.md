# 环境配置指南

> LarkVision-Tester · 飞书桌面端视觉驱动智能测试 Agent  
> 适用平台：macOS（主）/ Windows（兼容）

## 1. 系统先决条件

| 工具 | 版本要求 | 说明 |
|---|---|---|
| Python | **3.11+** | 通过 `uv` 自动管理，无需手装 |
| Node.js | 18+ | 装 `@larksuite/cli` 用 |
| 飞书桌面客户端 | 与赛方一致版本 | 测试目标，[官方下载](https://www.feishu.cn/download) |
| uv | 最新 | 见下方安装 |

## 2. 三步装好开发环境

### 2.1 装 uv（Python 包管理器）

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env  # 使 uv / uvx 加入 PATH
uv --version
```

### 2.2 同步项目依赖

```bash
cd /path/to/CUA-Lark-15
uv sync
```

uv 会自动完成：
- 装 Python 3.11.15（独立于系统 Python）
- 装所有 `pyproject.toml` 中的依赖
- 在 `.venv/` 下生成虚拟环境

验证：

```bash
uv run python -c "import agent; print(agent.__version__)"
# 输出 0.1.0
```

### 2.3 配置 `.env`

```bash
cp .env.example .env
# 然后编辑 .env，至少填入 ARK_API_KEY
```

## 3. 火山方舟豆包 API 配置

### 3.1 申请 API Key

1. 登录 [火山引擎控制台](https://console.volcengine.com/ark)
2. 进入"方舟"→"API Key 管理"，新建 Key
3. 进入"在线推理"→开通 `doubao-seed-2-0-pro` 与 `doubao-seed-1-6-251015`
4. 把 Key 填入 `.env` 的 `ARK_API_KEY`

### 3.2 验证连通

```bash
uv run python -c "
from agent.llm.doubao import DoubaoClient
from agent.llm.base import LLMMessage, ReasoningLevel
c = DoubaoClient()
r = c.chat([LLMMessage(role='user', text='1+1=?')], reasoning=ReasoningLevel.MINIMAL)
print(r.content, '|', r.latency_ms, 'ms')
"
```

## 4. macOS 关键权限（必须）

CUA Agent 需要操作鼠标键盘和截屏，**必须授权 3 项权限**：

```
系统设置 → 隐私与安全性 → 以下都加上 终端 / Cursor / Python.app:
  · 屏幕录制（截图）
  · 辅助功能（鼠标键盘控制）
  · 输入监控（pynput 兜底）
```

授权后**重启终端 / Cursor**才生效。

验证截图权限：

```bash
uv run lvt shot
# 看到 ./screenshots/shot_*.png 即成功
```

验证鼠标权限：

```bash
uv run python -c "import pyautogui; print(pyautogui.position())"
# 输出当前鼠标坐标即可
```

## 5. 飞书 lark-cli 配置（评测期 Oracle 用）

```bash
npm install -g @larksuite/cli
lark-cli config init
lark-cli auth login --recommend
lark-cli auth status   # 看到 logged in 即成功
```

> 主路径不依赖 lark-cli，**仅评测阶段用作 Oracle 交叉校准**，开发期可暂跳过本步。

## 6. 跑通 M1 Demo

确保飞书桌面客户端已打开（建议停在登录页或主界面）：

```bash
# 仅 grounding，不真点击
uv run python demo/m1_grounding_demo.py "飞书登录按钮"

# 找到后真点击（注意：故障保护是把鼠标拖到屏幕角落立即停止）
uv run python demo/m1_grounding_demo.py "飞书登录按钮" --click

# Retina 屏建议带 scale
uv run python demo/m1_grounding_demo.py "邮箱输入框" --click --scale 2.0
```

或用统一 CLI：

```bash
uv run lvt shot
uv run lvt ground "飞书设置图标" --reasoning minimal
```

## 7. 跑测试

```bash
uv run pytest -q
# 期望：所有测试通过
```

## 8. 常见问题

### 问：报错 `ARK_API_KEY not set`
答：`.env` 没建或没填，请回到 §2.3。`load_dotenv()` 已在 CLI 自动调用。

### 问：截图全黑
答：macOS 屏幕录制权限未授予，去系统设置加上、重启终端。

### 问：`pyautogui.click` 报 `IOError`
答：辅助功能权限未授予；同上处理。

### 问：grounding 坐标看似正确但点偏了
答：Retina 屏物理像素 ≠ 逻辑像素，加 `--scale 2.0` 试试。

### 问：豆包 2.0 Pro 调用很慢
答：检查 reasoning 档位，普通 grounding 应使用 `minimal`，跨产品规划才用 `medium`。

## 9. 关键目录

```
CUA-Lark-15/
├── .env                    # 你的密钥（不入库）
├── pyproject.toml          # 依赖声明
├── uv.lock                 # 依赖锁（不入库，可重新生成）
├── .venv/                  # uv 创建的虚拟环境（不入库）
├── agent/                  # 核心代码
├── bench/                  # 评测用例 + Oracle
├── demo/                   # M1 demo 脚本 + 答辩 Demo
├── infra/                  # 本文 + 部署脚本
├── plan/                   # 方案演进
├── tests/                  # 单测
└── screenshots/            # 截图临时输出（不入库）
```
