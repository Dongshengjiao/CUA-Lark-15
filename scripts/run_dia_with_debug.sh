#!/usr/bin/env bash
# Relaunch Dia with --remote-debugging-port so the browser executor can attach
# to the running browser via BrowserConfig.debugger_address instead of spawning
# a competing instance with its own user-data-dir.
#
# Usage: scripts/run_dia_with_debug.sh [port]
#
# After this script returns, Dia is running with CDP exposed on the chosen port
# and you can run cases with the BrowserExecutor in attach mode. Set the port
# in .claude/settings.json under browser.debugger_address (e.g. "localhost:9222").
set -euo pipefail

PORT="${1:-9222}"
DIA_BIN="/Applications/Dia.app/Contents/MacOS/Dia"
USER_DATA_DIR="${HOME}/Library/Application Support/Dia/User Data"

if [ ! -x "${DIA_BIN}" ]; then
  echo "Dia binary not found at ${DIA_BIN}"
  exit 1
fi

if pgrep -f "${DIA_BIN}" > /dev/null 2>&1; then
  echo "Dia is currently running. Quitting it cleanly before relaunch..."
  osascript -e 'tell application "Dia" to quit' || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! pgrep -f "${DIA_BIN}" > /dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  if pgrep -f "${DIA_BIN}" > /dev/null 2>&1; then
    echo "Dia did not quit gracefully within 5s; force-killing"
    pkill -f "${DIA_BIN}" || true
    sleep 1
  fi
fi

echo "Launching Dia with --remote-debugging-port=${PORT}"
"${DIA_BIN}" \
  --remote-debugging-port="${PORT}" \
  --user-data-dir="${USER_DATA_DIR}" \
  > /dev/null 2>&1 &

echo "Waiting for CDP to come up on localhost:${PORT}..."
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -s --max-time 1 "http://localhost:${PORT}/json/version" > /dev/null 2>&1; then
    echo "CDP is up. BrowserExecutor can now attach via debugger_address=localhost:${PORT}"
    exit 0
  fi
  sleep 0.5
done

echo "CDP did not come up on localhost:${PORT} within 10s"
exit 1
