# CUA-Lark-15

飞书AI校园挑战赛 CUA-Lark 赛道 · 第 15 组

A **5-layer Computer-Use Agent testing framework** for the Lark / Feishu desktop
app, driven by natural-language prompts. Powered by Claude (VLM + planner) and
PyAutoGUI (executor).

## The 5 Layers

| # | Layer          | Responsibility                                                 | Tech                          |
|---|----------------|----------------------------------------------------------------|-------------------------------|
| 1 | Visual         | Locate UI elements from screenshots                            | Claude VLM (+ pywinauto bonus)|
| 2 | Planning       | Natural-language goal → ordered step plan via Chain of Thought | Claude                        |
| 3 | Execution      | Perform click / type / drag / scroll / shortcuts               | PyAutoGUI                     |
| 4 | Verification   | Check post-action UI state matches expected                    | Claude VLM (OCR optional)     |
| 5 | Reporting      | Markdown test-run summary with embedded screenshots            | Jinja-style formatter         |

## End-to-end flow

```
NL prompt ─► Planning Layer ─► [Action, Action, ...] ─► for each:
                                                           Visual Layer (resolve target)
                                                           Execution Layer (pyautogui)
                                                           Verification Layer (VLM/OCR check)
                                                           ↳ on fail: Exception handler / Self-heal / Replan
                                                      Reporting Layer (write report.md)
```

## Test coverage (contest required ≥ 2 apps)

- **IM**: search group, send message, verify delivery
- **Calendar**: create meeting, verify appearance on week view
- **Cross-product** (bonus): Calendar → IM meeting reminder

## Bonus features

| # | Bonus                     | Module                         | Status  |
|---|---------------------------|--------------------------------|---------|
| 1 | Exception handling        | `src/bonus/exception_handler.py`| planned |
| 2 | Cross-product flows       | `tests/calendar.py::cross_...` | planned |
| 3 | Self-healing              | `src/bonus/self_healing.py`    | planned |
| 5 | Hybrid locators (VLM+a11y)| `src/accessibility.py`         | planned |
| 6 | Dynamic step adjustment   | `src/layers/planning.py::replan`| planned |
| 7 | Record & playback         | `src/bonus/recorder.py`        | planned |
| 4 | Auto-generate tests from docs |                            | stretch |

## Setup

Requires Python 3.11+, Windows 10/11, and **Lark Desktop installed + logged in**
(the framework drives the real app via pyautogui).

Pick either venv or conda — both work identically.

**Option A — venv:**
```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -e .
```

**Option B — conda:**
```powershell
conda create -n cua-lark python=3.11 -y
conda activate cua-lark
pip install -e .
```

Then (either option):
```powershell
# optional: enable OCR verification fallback
pip install -e .[ocr]

copy .env.example .env
# edit .env and set ANTHROPIC_API_KEY
```

## Run

```powershell
# Contest example
python main.py --task "Search Test Group in IM, send Hello World, and verify success."

# Preset test paths
python main.py --preset im.search_and_send
python main.py --preset calendar.create_quick_meeting
python main.py --preset cross.meeting_reminder "Test Group"
```

## Project layout

```
CUA-Lark-15/
├── main.py                      # CLI entrypoint (--task / --preset)
├── pyproject.toml
├── .env.example
├── tests/                       # Preset test paths per Lark app
│   ├── im.py
│   └── calendar.py
├── reports/                     # Generated markdown reports + screenshots
└── src/
    ├── config.py
    ├── safety.py                # Confirm-before-destructive gate
    ├── framework.py             # Orchestrator — wires the 5 layers
    ├── actions.py               # Action primitives + Chain builder
    ├── accessibility.py         # pywinauto helper (Hybrid Locators)
    ├── layers/
    │   ├── visual.py            # Layer 1
    │   ├── planning.py          # Layer 2
    │   ├── execution.py         # Layer 3
    │   ├── verification.py      # Layer 4
    │   └── reporting.py         # Layer 5
    └── bonus/
        ├── exception_handler.py
        ├── self_healing.py
        └── recorder.py
```

## Status

- [x] Project scaffolded (contest-aligned 5-layer structure)
- [ ] Layer implementations (task #5)
- [ ] MVP: IM search + send + verify (task #6)
- [ ] Calendar create + verify (task #6)
- [ ] Bonus features (tasks #7-#10)

## License

MIT
