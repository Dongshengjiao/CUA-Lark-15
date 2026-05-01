#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/run_browser_case.sh <case-json-path>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="python3"

cd "$ROOT_DIR"
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src "$PYTHON_BIN" -m cua_lark.cli "$1" --perception browser --executor browser
