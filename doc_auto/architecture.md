# 代码架构同步文档（doc_auto）

> 按 workspace rule 维护。每次代码变更，需同步更新对应模块说明并追加修改时间戳。

最近更新：2026-04-25 19:50（M1 脚手架落盘）

## 1. 模块总览

```
agent/
├── llm/                LLM 抽象层（Provider 解耦 + 路由）
│   ├── base.py         LLMClient ABC + LLMMessage + LLMResponse + ReasoningLevel
│   ├── doubao.py       豆包 Provider（火山方舟 OpenAI 兼容协议）
│   └── router.py       LLMRouter：按 TaskType 选 reasoning 档；fallback 链路
├── perception/         视觉感知层
│   ├── screenshot.py   ScreenCapture：mss 截屏（全屏 / 区域）
│   └── grounder.py     VisionGrounder：截图 + 意图 → (x, y) 结构化输出
├── executor/           执行层
│   ├── mouse.py        Mouse：click / double / right / drag / scroll
│   └── keyboard.py     Keyboard：type_text（中文剪贴板）/ press / hotkey
├── planner/            规划层（M2 占位）
├── verifier/           验证层（M2 占位）
├── recovery/           自愈层（M5 占位）
├── reporter/           报告层（M4 占位）
└── cli.py              `lvt` Typer 命令行入口
```

## 2. 关键类与接口

### 2.1 `agent.llm.base`

| 类型 | 说明 |
|---|---|
| `ReasoningLevel` | 枚举 minimal / low / medium / high；语义统一，由 Provider 适配字段 |
| `LLMMessage` | role + text + image_paths + image_urls；`has_images()` |
| `LLMResponse` | content + raw + token 用量 + reasoning + latency_ms |
| `LLMClient(ABC)` | `chat()` / `chat_with_image()` 必须实现 |

### 2.2 `agent.llm.doubao.DoubaoClient`

- 通过 OpenAI 兼容 SDK 调用 `https://ark.cn-beijing.volces.com/api/v3`
- `is_pro=True` → reasoning 字段映射到豆包 2.0 Pro 的 `thinking={"type": minimal/low/medium/high}`
- `is_pro=False` → 映射到豆包 1.6 的 `off / auto / on`
- 内置 tenacity 重试（3 次指数退避）
- 多模态：`image_paths` 自动 base64 编码为 data URL

### 2.3 `agent.llm.router.LLMRouter`

| 任务类型 (TaskType) | 默认 reasoning |
|---|---|
| `GROUNDING` | minimal |
| `SIMPLE_VERIFY` | minimal |
| `PLANNING` | low |
| `CROSS_PRODUCT` | medium |
| `SELF_HEAL` | medium |

- primary 失败自动切 fallback（默认豆包 1.6）
- `summary()` 输出 by_task / by_reasoning / 总延迟 / token / fallback_count

### 2.4 `agent.perception`

- `ScreenCapture.capture(monitor_index=1)` → `ScreenshotResult(path, w, h, scale, ms)`
- `ScreenCapture.capture_region(left, top, w, h)` → 区域截图
- `VisionGrounder.locate(path, target_desc, reasoning)` → `GroundingResult(found, x, y, confidence, ...)`
  - 通过 system prompt 强制返回结构化 JSON
  - 解析支持纯 JSON / Markdown 代码块 / 含散文的 JSON

### 2.5 `agent.executor`

- `Mouse(scale_factor)` 自动处理 Retina 物理→逻辑坐标
- `Mouse.click / double_click / right_click / drag / scroll`
- `Keyboard.type_text(s)` 中文走 pyperclip 剪贴板，英文走 pyautogui.write
- `Keyboard.hotkey('cmd+a')` 自动跨平台映射 cmd ↔ ctrl

## 3. 数据流（M1 单步操作）

```
[用户] 自然语言意图
    ↓
ScreenCapture.capture()  → ScreenshotResult(path)
    ↓
VisionGrounder.locate(path, target)  → 调用 LLMRouter（TaskType.GROUNDING / minimal）
    ↓
GroundingResult(found, x, y, confidence)
    ↓
Mouse.click(x, y)  / Keyboard.type_text(...)
```

## 4. 测试覆盖

| 文件 | 用例 |
|---|---|
| `tests/test_llm_base.py` | ReasoningLevel 值；LLMMessage 多模态；OpenAI 协议转换 |
| `tests/test_router.py` | 任务→reasoning 路由；primary 失败 fallback；统计正确 |
| `tests/test_grounder.py` | 纯/代码块/散文中提取 JSON；解析有效/缺失/异常路径 |

当前：18/18 全过。

## 5. 待补模块（按里程碑）

| 模块 | 里程碑 | 关键文件 |
|---|---|---|
| Planner | M2 | `agent/planner/agent.py`、`prompts.py` |
| Verifier L1/L2/L3 + 投票 | M2 | `agent/verifier/{pixel_diff,ocr_check,semantic_check,vote}.py` |
| Bench Runner + Oracle | M4 | `bench/runner.py`、`bench/oracle.py` |
| Self-Heal | M5 | `agent/recovery/self_heal.py` |
| Reporter Dashboard | M4 | `agent/reporter/dashboard.py`（Streamlit） |

## 6. 修改时间戳记录

| 时间 | 改动 |
|---|---|
| 2026-04-25 19:50 | M1 脚手架落盘：LLM 抽象 + 视觉感知 + 执行 + 18 单测 + Demo 脚本 |
| 2026-04-25 20:55 | 调研 TuriX-CUA（references/turix-cua/）；产出 docs/turix_cua_review.md；规划 6 处可落地小改动（归一化坐标 / Action Pydantic / 双截图 / 急停热键 / 结构化校验 / Skills 目录） |
