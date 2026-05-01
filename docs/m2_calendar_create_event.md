# M2 Calendar Create Event

## Goal

This note tracks the first formal M2 workflow for Feishu Calendar: opening the create-event window, filling a title, and preparing a minimal save path.

## Current Real Findings

Real inspection of the Feishu desktop app confirmed:

1. The Calendar main page exposes a visible `创建日程` button.
2. Clicking that button opens a dedicated `创建日程` window.
3. The title field is focused by default after the create window loads.
4. The save button is visible at the bottom of the create window.
5. A stale `创建日程` window can interfere with replay, so the M2 cases now close that window first when it is already frontmost.
6. Final observations now capture the front-window title and screenshot path, so the workflow can validate window state instead of relying only on action success.
7. The attendee field is visible near the top of the create window and can be targeted as a safe draft-only interaction before any real save.

## Implemented Cases

1. `cases/m2_real/calendar_open_create_event_window.json`
2. `cases/m2_real/calendar_fill_event_draft.json`
3. `cases/m2_real/calendar_create_event_minimal.json`
4. `cases/m2_real/calendar_fill_event_details_draft.json`
5. `cases/m2_real/calendar_fill_event_attendee_draft.json`
6. `cases/m2_real/calendar_fill_full_draft.json`

## Suggested Validation Order

1. Run the create-window case.
2. Run the draft-title case.
3. Run the attendee-draft case to exercise the participant-input path without saving.
4. Run the detailed-draft case to exercise the description flow.
5. Run the full-draft case to cover title + attendee input + description in one replay.
6. Confirm before running the final save case, because it will create a real event in the user's Feishu calendar.

## Example Commands

```bash
PYTHONPATH=src python3 -m cua_lark.cli cases/m2_real/calendar_open_create_event_window.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m2_real/calendar_fill_event_draft.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m2_real/calendar_fill_event_attendee_draft.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m2_real/calendar_fill_event_details_draft.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m2_real/calendar_fill_full_draft.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m2_real/calendar_create_event_minimal.json --perception macos --executor macos
```

## Safety Boundary

The final `calendar_create_event_minimal` case clicks `保存`, which creates a real event. Only run it after explicit user confirmation at action-time.

## Robustness Notes

The M2 cases now include two stabilizers:

1. If the front window title already contains `创建日程`, the workflow first sends `cmd+w` to close that stale draft window.
2. Window-relative click resolution retries a few times before failing, so the workflow is less sensitive to slow Feishu rendering.
3. Final observations capture the front-window title and screenshot path, so the create-window state can be validated more explicitly.

## Validation Notes

The current Calendar M2 cases now use a lightweight observation-based validation layer:

1. `calendar_open_create_event_window` and `calendar_fill_event_draft` verify that the final front-window title contains `创建日程`.
2. `calendar_create_event_minimal` verifies that Feishu remains the active front-window app after save and that a final screenshot artifact exists.
3. This does not replace richer OCR or semantic checks, but it gives the competition build stronger replay evidence than action success alone.
4. The generated run report now surfaces final front-window state and screenshot evidence directly in Markdown for easier review.
5. The attendee-draft case intentionally stops before any save, so it can safely extend M2 form coverage without creating or updating a real event.
6. The full-draft case combines title, attendee input, and description into one replay so the team can demonstrate a richer M2 form workflow before moving to saved events.
