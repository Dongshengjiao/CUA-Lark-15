# CUA-Lark

CUA-Lark is a visual computer-use agent for the Feishu desktop app. It is designed for the Feishu AI Campus Competition track on quality engineering and intelligent testing.

The project goal is to let a multimodal model operate the Feishu desktop client like a human user, then verify outcomes and generate structured evaluation reports.

## Product Goal

CUA-Lark aims to win on four dimensions:

1. Reliable end-to-end execution on real desktop UI flows.
2. Coverage across multiple Feishu products such as IM, Docs, and Calendar.
3. Result verification rather than action-only demos.
4. Reproducible evaluation artifacts, including logs, screenshots, and reports.

## Product Strategy

The project follows a hybrid testing strategy:

1. Visual CUA is the primary execution engine for desktop actions and decision making.
2. `lark-cli` and Feishu OpenAPI act as auxiliary layers for verification, fixture setup, and future product expansion.
3. Competition demos should first prove that the desktop workflow itself succeeded.

## M1 Status

The repository now supports three execution modes:

1. `dry-run`: safe local development without desktop side effects.
2. `macos`: real screenshot capture plus native desktop actions on macOS.
3. `browser`: Selenium-driven Feishu Web execution for sandbox-friendly demo flows.
3. `lark-cli`: optional Feishu CLI / OpenAPI execution for auxiliary verification and exploration.

The current real macOS executor supports:

1. Coordinate-based click, double click, and right click.
2. Text input through AppleScript.
3. Hotkeys such as `enter`, `cmd+k`, and arrow keys.
4. Scroll and wait steps.
5. Full-screen screenshot capture into `reports/screenshots/`.
6. Run artifact persistence into `reports/runs/` and `reports/latest/`.
7. Window-relative coordinates for more stable desktop clicks.
8. A first-pass real recovery path for the Feishu install recommendation modal.

## Current Scope

Phase 1 focuses on the core agent loop:

1. Capture desktop state.
2. Turn a natural-language test goal into structured steps.
3. Execute mouse and keyboard actions.
4. Verify expected outcomes.
5. Save a run report.

## Planned Milestones

1. M1: Single-step actions and desktop control stability.
2. M2: Multi-step workflows and validation.
3. M3: API-backed verification and stable coverage for IM, Docs, and Calendar.
4. M4: Benchmark runner, dual-path validation, and report generation.
5. M5: Recovery, self-healing, and cross-product scenarios.

## M2 Progress

The next formal workflow is now centered on Calendar event creation:

1. Open Calendar.
2. Open the `创建日程` window.
3. Fill a draft title.
4. Extend draft coverage with attendee and description inputs before any save.
5. Replay a fuller draft that combines title, attendee input, and description in one flow.
6. Validate the create-window state through front-window metadata and screenshot artifacts.
7. Confirm before executing the final save step that creates a real event.

The first formal IM workflow is now centered on active-chat messaging:

1. Enter the Messages page.
2. Focus the active chat input.
3. Replace the current draft with a controlled message.
4. Validate the final page state through front-window metadata and screenshot artifacts.
5. Confirm before executing the final send step that delivers a real message.

## Repository Layout

```text
src/cua_lark/
  agent/          agent orchestration
  models/         shared data structures
  planners/       natural language to step plan
  perception/     screenshot and UI understanding interfaces
  executors/      mouse, keyboard, and desktop actions
  validators/     post-action validation logic
  reporting/      run artifacts and report generation
  config.py       settings loader
  cli.py          local entrypoint
cases/
  im/
  docs/
  calendar/
docs/
  architecture.md
  roadmap.md
```

## Quick Start

1. Create and activate a Python virtual environment.
2. Install project dependencies.
3. Configure `.claude/settings.json` for model access.
4. Add local runtime settings for Feishu desktop testing.
5. Run the sample CLI with a test case JSON file.

Safe dry-run example:

```bash
PYTHONPATH=src python3 -m cua_lark.cli cases/im/send_message.json
```

Real screenshot capture without desktop actions:

```bash
PYTHONPATH=src python3 -m cua_lark.cli cases/im/send_message.json --perception macos
```

Real macOS execution:

```bash
PYTHONPATH=src python3 -m cua_lark.cli cases/im/click_search_bar.json --perception macos --executor macos
```

Before desktop execution, grant Accessibility and Screen Recording permissions to the terminal or Python host process in macOS System Settings.

Browser execution:

```bash
bash scripts/run_browser_case.sh cases/m2_browser/im_send_message_active_chat.json
bash scripts/run_browser_case.sh cases/m2_browser/im_calendar_prepare_meeting_workflow.json
```

Optional API-side execution example:

```bash
PYTHONPATH=src python3 -m cua_lark.cli cases/api_first/calendar_create_event_bot.json --executor lark-cli --perception mock
```

Batch M1 acceptance run:

```bash
PYTHONPATH=src python3 -m cua_lark.batch cases/m1
```

Batch across multiple folders / explicit files (M3+):

```bash
# any mix of dirs and *.json paths is fine — duplicates dedup on resolved path
PYTHONPATH=src python3 -m cua_lark.batch cases/m1 cases/m2_browser cases/m2_real --paths macos browser
PYTHONPATH=src python3 -m cua_lark.batch cases/m2_real/docs_create_new_doc.json --executor macos
```

## Lark CLI Integration

`lark-cli` is an official Feishu/Lark tool maintained by the `larksuite` team. In this project it is an auxiliary capability, not the primary execution path for the competition build.

Recommended uses:

1. Verify that a calendar event, document, or message really exists after desktop execution.
2. Prepare or clean up fixtures around a demo run.
3. Explore future productization paths after the desktop CUA baseline is stable.

The current codebase now includes a `lark-cli` executor backend and API-side exploration assets. The current competition strategy is dual-track:

1. `browser` is the primary Wangze demo path before `2026-05-05`.
2. `macos` remains the backup and recovery path for desktop validation.

Preflight example:

```bash
PYTHONPATH=src python3 -m cua_lark.cli --doctor lark-cli
```

macOS desktop preflight:

```bash
PYTHONPATH=src python3 -m cua_lark.cli --doctor macos
```

Real-run playbook:

- [Real Run Guide](/Users/niny/Documents/GitHub/CUA-Lark-15/docs/real_run.md)
- [Daily Report 2026-04-25](/Users/niny/Documents/GitHub/CUA-Lark-15/docs/daily_report_20260425.md)
- [M2 Calendar Create Event](/Users/niny/Documents/GitHub/CUA-Lark-15/docs/m2_calendar_create_event.md)
- [M2 IM Send Message](/Users/niny/Documents/GitHub/CUA-Lark-15/docs/m2_im_send_message.md)
- [API-First Execution](/Users/niny/Documents/GitHub/CUA-Lark-15/docs/api_first_execution.md)

Current M2 closeout:

1. Three real single-step actions have already succeeded on the user's machine: search, Docs, and Calendar.
2. The install recommendation modal has been verified and can be dismissed through the top-right close button.
3. A minimal Calendar multi-step workflow has been validated through real desktop interaction.
4. An IM active-chat draft workflow has also been validated through real desktop interaction.
5. The main M2 cases now include lightweight observation-based validation for front-window state and screenshot artifacts.
6. Markdown reports and batch summaries now surface final front-window state and screenshot evidence for easier demo review.
7. Calendar M2 now also includes a safe attendee-draft template that expands form coverage without saving a real event.
8. Calendar M2 now also includes a full-draft template that replays title + attendee input + description in one non-saving workflow.

## M3–M5 progress (Wangze branch)

1. **Docs product coverage** — both `m2_browser/docs_create_new_doc.json` (Web,
   pasted Chinese body, wiki URL verified) and `m2_real/docs_create_new_doc.json`
   (Desktop, point click on the 新建文档 recommendation tile + paste-mode title)
   pass end-to-end. `cmd+n` is unreliable on Lark Desktop — use the tile click.
2. **Paste-mode CJK input** — every type step on Chinese text uses
   `metadata.type_mode: "paste"`, which routes through `pbcopy` + `cmd+v` so the
   macOS IME can't corrupt the input. Browser executor mirrors the same path
   via clipboard injection.
3. **Self-healing presets** — `AgentService` ships built-in heals keyed by
   observation signal (`stuck_create_event_modal`, `discard_dialog_visible`,
   `feishu_login_required`, `browser_renderer_idle`). Cases opt in with
   `metadata.auto_heal: true`.
4. **User-defined `recovery_presets`** — `.claude/settings.json` →
   `desktop.recovery_presets` (or `browser.recovery_presets`) overrides the
   built-in map by signal name. The chosen slice is selected by the active
   executor (browser vs desktop).
5. **Largest-window resolver** — `macos.get_window_bounds` picks the largest
   visible window of the candidate apps instead of `front window`, so transient
   overlays (NotificationCenter widgets, OS modals) can't poison the click
   target ratios.

## Status

This repository currently contains:

1. The initial architecture and roadmap.
2. A first-pass Python scaffold for the agent system.
3. Seed test cases for the competition demo path.
4. Five M1 single-step cases plus a batch runner for acceptance checks.
