# M2 IM Send Message

## Goal

This note tracks the first formal M2 workflow for Feishu IM: opening the Messages page, filling a message draft in the active chat, and preparing a final send step.

## Current Strategy

The first stable version targets the currently active chat instead of a search-selected contact.

This keeps the workflow aligned with the current real desktop capability:

1. Activate Feishu.
2. Enter the Messages page.
3. Focus the active chat input box.
4. Replace the existing draft with a controlled message.
5. Optionally click the send button.

## Implemented Cases

1. `cases/m2_real/im_fill_message_draft_active_chat.json`
2. `cases/m2_real/im_send_message_active_chat.json`

## Safety Boundary

The `im_send_message_active_chat` case sends a real message to the currently active conversation in Feishu. It should only be run after explicit action-time confirmation.

## Example Commands

```bash
PYTHONPATH=src python3 -m cua_lark.cli cases/m2_real/im_fill_message_draft_active_chat.json --perception macos --executor macos
PYTHONPATH=src python3 -m cua_lark.cli cases/m2_real/im_send_message_active_chat.json --perception macos --executor macos
```

## Real Calibration Notes

Current calibration assumes:

1. The message input box sits near the bottom-right compose area.
2. `cmd+a` can clear the current draft after the input box is focused.
3. The send button sits at the far-right edge of the compose area.
4. The safe draft flow has already been validated on a real active chat without sending a message.

If the send button or input box drifts, adjust the message-area ratios in the case JSON files.

## Validation Notes

The IM M2 cases now include lightweight observation-based checks:

1. The final Feishu front-window app and title must still be readable from the observation metadata.
2. A final screenshot artifact must exist for each run.
3. This gives the draft and send workflows a stable state-evidence layer even before richer OCR-based message verification is added.
4. The generated run report now surfaces final front-window state and screenshot evidence directly in Markdown for easier review.
