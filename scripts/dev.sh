#!/usr/bin/env zsh
# M6 task 4.1: one-shot dev launcher.
#
# Cd into the repo root → npm install runner deps → swift build →
# spawn LarkIslandApp → wait for the runner subprocess to register
# → tell the user to click the menubar globe.
#
# This script is for the M6 demo / smoke-test workflow. Production
# packaging (DMG, codesign, notarisation) is M7 backlog.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER_DIR="$REPO_ROOT/runners/web-agent"
APP_DIR="$REPO_ROOT/lark-island"
LOG_DIR="$HOME/Library/Logs/LarkIsland"
TODAY="$(date +%Y-%m-%d)"
RUNNER_LOG="$LOG_DIR/web-agent-${TODAY}.log"

print_step() {
  printf "\n[dev] %s\n" "$1"
}

# 1) Install runner deps if needed.
if [[ ! -d "$RUNNER_DIR/node_modules" ]]; then
  print_step "installing runner dependencies (first run)..."
  ( cd "$RUNNER_DIR" && npm install --silent )
fi

# 2) Make sure swift toolchain is on PATH (Homebrew keg-only on macOS).
if [[ -d /opt/homebrew/opt/swift/bin ]]; then
  export PATH="/opt/homebrew/opt/swift/bin:$PATH"
fi

# 3) Pre-build LarkIslandApp so the spawn step doesn't time out.
print_step "swift build..."
( cd "$APP_DIR" && swift build )

# 4) Launch LarkIslandApp in the background. The supervisor inside
# the app spawns the runner subprocess automatically.
print_step "launching LarkIslandApp..."
( cd "$APP_DIR" && swift run LarkIslandApp ) &
APP_PID=$!

# 5) Tail the runner log waiting for the "ready for tasks" line.
print_step "waiting for runner to register..."
mkdir -p "$LOG_DIR"
DEADLINE=$(( $(date +%s) + 60 ))
while (( $(date +%s) < DEADLINE )); do
  if [[ -f "$RUNNER_LOG" ]] && grep -q 'registered as webAgentRunner' "$RUNNER_LOG"; then
    print_step "runner ready ✅"
    print_step "👉 Click the menubar globe (🌐) and submit a task."
    print_step "   Press Ctrl+C to terminate the app + runner."
    wait $APP_PID
    exit 0
  fi
  sleep 1
done

print_step "❌ runner did not register within 60s — check $RUNNER_LOG"
kill $APP_PID 2>/dev/null || true
exit 1
