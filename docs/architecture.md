# CUA-Lark Architecture

## Product Positioning

CUA-Lark is not a one-off automation script. It is a test agent platform for the Feishu desktop app that combines visual reasoning, task planning, UI execution, validation, and reporting.

The platform uses a hybrid architecture:

1. Visual CUA drives all primary UI actions and test decisions.
2. Feishu OpenAPI and `lark-cli` provide optional ground-truth checks and test-environment setup.
3. The validation story for judges is "GUI did it, API proved it."

The competition-winning strategy is:

1. Show stable execution on real desktop workflows.
2. Cover at least three Feishu product surfaces.
3. Prove success through validation and metrics.
4. Demonstrate resilience with exception handling and retry paths.

## System Layers

### 1. Perception Layer

Responsibilities:

1. Capture screenshots of the desktop or active Feishu window.
2. Extract OCR text and coarse UI regions.
3. Build a compact observation payload for the planner.

Initial implementation:

1. Screenshot provider interface.
2. Optional OCR adapter.
3. Observation object with screen metadata.
4. macOS screenshot capture adapter based on `screencapture`.
5. macOS preflight for Screen Recording, Accessibility, and window discovery.

### 2. Planning Layer

Responsibilities:

1. Convert a natural-language goal into structured test steps.
2. Select the target product area such as IM, Docs, or Calendar.
3. Produce fallback actions and checkpoints.

Initial implementation:

1. Rule-based demo planner for seed cases.
2. Model planner interface for later multimodal planning.

### 3. Execution Layer

Responsibilities:

1. Run clicks, typing, scrolls, hotkeys, waits, and app focus actions.
2. Keep action logs with timestamps and arguments.
3. Retry transient failures when safe.

Initial implementation:

1. Executor interface.
2. Dry-run executor for local development.
3. Action result model.
4. Native macOS executor for coordinate clicks, typing, hotkeys, scroll, and waits.
5. Window-relative coordinate support for more stable real-desktop actions.

### 4. Validation Layer

Responsibilities:

1. Confirm whether the expected UI state was reached.
2. Use OCR, keyword checks, and visual assertions.
3. Optionally call `lark-cli` or OpenAPI to verify that backend state matches the GUI result.
4. Classify failures by timeout, target missing, blocked UI, or verification mismatch.

Initial implementation:

1. Validation interface.
2. Keyword validator for seed flows.
3. Composite validator that can combine visual checks and `lark-cli` checks.
4. Failure taxonomy.

### 5. Reporting Layer

Responsibilities:

1. Persist step traces, screenshots, and validation outcomes.
2. Summarize success rate, duration, and failure reasons.
3. Generate markdown artifacts for competition demo and review.

Initial implementation:

1. Run summary model.
2. Markdown reporter.

## Demo-First Use Cases

### IM

1. Search a contact and send a text message.
2. Mention a teammate in a group and verify the message appears.

### Docs

1. Create a document with a title and body text.
2. Insert a heading or list and verify content exists.

### Calendar

1. Create an event and invite a participant.
2. Edit an event time and verify the update.

### Cross-Product

1. Open a message about a meeting in IM.
2. Jump into Calendar.
3. Verify the meeting state and return a final result.

## Evaluation Strategy

For each run, the system should record:

1. Test case id and target product.
2. Planned steps and executed steps.
3. Action latency per step.
4. Validation status per step.
5. Final outcome and failure reason.
6. Any API-backed verification outcome that confirms the GUI action.

The first report format is markdown. A later iteration can add HTML dashboards.

## Why `lark-cli` Matters

The official `lark-cli` repository provides 200+ commands and 22 AI Agent skills across Messenger, Docs, Base, Sheets, Calendar, Mail, Tasks, and Meetings. That makes it a strong fit for:

1. Ground-truth verification after desktop execution.
2. Building stable demo fixtures.
3. Cleaning up demo data to keep repeated runs deterministic.

This integration remains auxiliary so the project stays aligned with the competition requirement that core action decisions must be visually driven.

## Delivery Plan

1. M1: Single-step stability and action engine.
2. M2: Multi-step orchestration and GUI validation.
3. M3: `lark-cli`-backed verification plus IM, Docs, Calendar coverage.
4. M4: Structured benchmark runs, dual-path validation, and reports.
5. M5: Recovery, self-healing, and cross-product demo polish.
