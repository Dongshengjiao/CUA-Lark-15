# Real Run Guide

## Goal

This guide is for turning the current M1 scaffold into real macOS desktop runs against the Feishu app.

## Dual Track

Current Wangze delivery uses two execution tracks:

1. `browser` as the primary demo path for `IM + Calendar`
2. `macos` as the backup desktop path for validation and recovery analysis

## Current Status

The codebase already supports:

1. Native macOS clicks, typing, hotkeys, scrolling, and app activation.
2. Full-screen screenshot capture.
3. Window-relative click coordinates.
4. Run artifact persistence in `reports/runs/`.

The current blocker was macOS host-process permissions, not project logic. Those permissions are now validated on the user's local host.

## Mandatory Preflight

Run:

```bash
PYTHONPATH=src python3 -m cua_lark.cli --doctor macos
```

Do not start real-case debugging until this prints:

```text
Ready: True
```

## Required macOS Permissions

Grant both permissions to the exact host process that runs the Python command:

1. Accessibility
2. Screen Recording

If you are unsure which host is used, grant both permissions to:

1. Codex
2. Terminal

Then fully restart those apps before retrying the preflight.

## Starter Real Cases

These cases are designed as first-pass calibration templates:

1. `cases/m1_real/click_search_bar_window_relative.json`
2. `cases/m1_real/open_docs_tab_window_relative.json`
3. `cases/m1_real/open_calendar_tab_window_relative.json`
4. `cases/m1_real/dismiss_install_modal_close_button.json`
5. `cases/m1_real/dismiss_install_modal_escape.json`
6. `cases/m1_real/open_docs_tab_and_dismiss_modal_window_relative.json`
7. `cases/m1_real/open_calendar_tab_and_dismiss_modal_window_relative.json`
8. `cases/m1_real/calendar_minimal_multi_step_with_recovery.json`

They use window-relative coordinates so small window movements do not immediately break the run.

## Suggested Execution Order

1. Run the macOS preflight.
2. Run the search click case.
3. Run the Docs tab case.
4. If a recommendation modal appears, run the close-button dismiss case.
5. Run the combined Docs recovery case.
6. Run the combined Calendar recovery case.
7. Use the minimal Calendar multi-step case as today's M2 bridge.
8. Keep `Escape` as a fallback only if close-button dismissal fails.
9. Tune `x_ratio` and `y_ratio` values based on visible click results.

## Example Commands

```bash
PYTHONPATH=src python3 -m cua_lark.cli cases/m1_real/click_search_bar_window_relative.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m1_real/open_docs_tab_window_relative.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m1_real/open_calendar_tab_window_relative.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m1_real/dismiss_install_modal_close_button.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m1_real/dismiss_install_modal_escape.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m1_real/open_docs_tab_and_dismiss_modal_window_relative.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m1_real/open_calendar_tab_and_dismiss_modal_window_relative.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m1_real/calendar_minimal_multi_step_with_recovery.json --perception macos --executor macos
```

For the Codex runtime Python on this machine, prefer:

```bash
bash scripts/run_macos_case.sh cases/m2_real/im_send_message_active_chat.json
bash scripts/run_macos_case.sh cases/m2_real/im_calendar_prepare_meeting_workflow.json
```

For the browser-primary Wangze path:

```bash
bash scripts/run_browser_case.sh cases/m2_browser/im_send_message_active_chat.json
bash scripts/run_browser_case.sh cases/m2_browser/im_calendar_prepare_meeting_workflow.json
```

If the browser lands on the Feishu login page, do not close the run immediately.
The current Wangze browser flow gives a manual-login grace period before failing.
Log in inside the opened browser window first, then let the run continue.

This wrapper disables Python bytecode writes to avoid intermittent import timeouts caused by stale local cache files.

If you still see a `TimeoutError: [Errno 60] Operation timed out` during module import, run:

```bash
bash scripts/clear_python_cache.sh
```

## Current Real Findings

Real runs on the user's machine have already confirmed:

1. The search button click works.
2. The Docs tab click works.
3. The Calendar tab click works.
4. The recommendation modal can be dismissed by clicking the top-right close button.
5. `Escape` alone is not sufficient as the primary dismissal strategy for this modal.
6. Combined tab-open plus modal-recovery templates are now prepared for Docs and Calendar.
7. A minimal real multi-step Calendar case is now available as the M2 bridge.

## Tuning Notes

If a click lands near but not exactly on the target, adjust only one coordinate at a time:

1. Increase `x_ratio` to move right.
2. Decrease `x_ratio` to move left.
3. Increase `y_ratio` to move down.
4. Decrease `y_ratio` to move up.

Keep each adjustment small, usually `0.005` to `0.02`.

## User-Specific Shortcut And Click Calibration

Do not assume every macOS host uses the default shortcuts.

Project-level overrides now live in `.claude/settings.json` under `desktop`:

```json
{
  "desktop": {
    "hotkeys": {
      "select_all": "cmd+a",
      "close_window": "cmd+w",
      "dismiss_modal": "escape",
      "send_message": "return"
    },
    "confirmed_actions": {
      "send_message": false,
      "save_calendar_event": false
    },
    "step_overrides": {
      "open_messages_tab": { "x_offset": 0, "y_offset": 0 },
      "focus_active_chat_input": { "x_offset": 0, "y_offset": 0 },
      "click_send_button": { "x_offset": 0, "y_offset": 0 },
      "open_calendar_tab": { "x_offset": 0, "y_offset": 0 },
      "open_create_event_window": { "x_offset": 0, "y_offset": 0 },
      "open_description_editor": { "x_offset": 0, "y_offset": 0 }
    }
  }
}
```

Recommended usage:

1. Change `desktop.hotkeys.select_all` if your machine does not use the default select-all shortcut.
   The project now leaves `select_all` blank by default to avoid accidentally triggering a user-specific system shortcut.
2. Tune only the specific failing `step_id` in `desktop.step_overrides`.
3. Prefer small `x_offset` / `y_offset` changes before editing the case JSON directly.
4. Keep `desktop.confirmed_actions.send_message` as `false` until you are ready to let the IM send case actually send a real message.

Browser session defaults can also live in `.claude/settings.json` under `browser`:

```json
{
  "browser": {
    "browser_name": "chrome",
    "start_url": "https://feishu.feishu.cn/",
    "headless": false,
    "user_data_dir": null,
    "profile_directory": null,
    "persistent_user_data_dir": null,
    "bootstrap_user_data_dir": null,
    "bootstrap_profile_directory": "Default"
  }
}
```

If Feishu Web needs a re-usable logged-in session:

1. Set `browser.persistent_user_data_dir` to a project-local path.
2. Set `browser.bootstrap_user_data_dir` to an existing logged-in Chromium profile source such as Dia.
3. Log in once during the manual-login grace window.
4. Reuse the project-local persistent profile for later browser runs.

## State-Aware Execution

Real users do not always start from a clean Feishu home screen.

The current IM and Calendar flows now support state-aware skipping:

1. If the current front window already matches `创建日程`, the runner can skip `open_calendar_tab` and `open_create_event_window`.
2. Calendar draft flows no longer force-close the create-event window before every run.
3. The runner prefers continuing from the current valid state instead of always resetting the app to a fixed entry point.

## Acceptance Criteria for M1 Real Runs

M1 should be considered real-run ready when:

1. macOS preflight passes.
2. At least three single-step actions run on the real Feishu window.
3. Each run writes screenshots and reports into `reports/runs/`.
4. At least one common interference modal can be dismissed reliably.
5. The team can record a short demo showing real clicks and resulting UI changes.

## Today's Closeout Scope

For the April 25 closeout, the project should be considered on track when:

1. Search click, Docs click, and Calendar click all succeed on the real Feishu desktop.
2. The install recommendation modal can be cleared with the close-button case.
3. At least one combined real case writes a multi-step run artifact into `reports/runs/`.
4. The daily report can cite both single-step success and first-pass recovery handling.
