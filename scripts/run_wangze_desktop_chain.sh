#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[Wangze] Running calendar draft case..."
bash scripts/run_macos_case.sh cases/m2_real/calendar_fill_event_details_draft.json

echo
echo "[Wangze] Running IM -> Calendar workflow case..."
bash scripts/run_macos_case.sh cases/m2_real/im_calendar_prepare_meeting_workflow.json
