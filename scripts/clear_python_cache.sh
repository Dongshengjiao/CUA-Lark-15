#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

find src -type d -name '__pycache__' -prune -exec rm -rf {} +

echo "Cleared Python __pycache__ directories under src/"
