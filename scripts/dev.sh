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
BOT_DIR="$REPO_ROOT/runners/feishu-bot"
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

# M11: source web-agent/.env into the dev.sh process so that env-driven
# settings (DASHSCOPE_API_KEY, LARK_BOT_PLAN_LLM_*, etc.) propagate to
# every child we spawn (LarkIslandApp → runner / bot bridge). Runner
# itself uses dotenv-runtime, but the bot bridge does not, so this
# script-level source is the simplest single-source-of-truth fix.
if [[ -f "$RUNNER_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$RUNNER_DIR/.env"
  set +a
  print_step "loaded env from $RUNNER_DIR/.env"
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
#
# IMPORTANT: rotate the runner log first. M9 verify-run #6 reproduced
# a race condition where dev.sh's grep below would match a
# 'registered as webAgentRunner' line left over from a previous
# dev.sh run (today's log is append-only across runs). dev.sh would
# then think runner is ready and spawn the bot bridge before the new
# LarkIslandApp's BridgeServer had finished binding the Unix socket,
# producing ECONNREFUSED on the bridge connect. Moving the prior log
# aside guarantees grep sees only this run's register line.
mkdir -p "$LOG_DIR"
if [[ -f "$RUNNER_LOG" ]]; then
  mv "$RUNNER_LOG" "$RUNNER_LOG.prev-$(date +%H%M%S)"
fi

print_step "launching LarkIslandApp..."
( cd "$APP_DIR" && swift run LarkIslandApp ) &
APP_PID=$!

# 5) Tail the runner log waiting for the "ready for tasks" line.
print_step "waiting for runner to register..."
DEADLINE=$(( $(date +%s) + 60 ))
RUNNER_READY=0
while (( $(date +%s) < DEADLINE )); do
  if [[ -f "$RUNNER_LOG" ]] && grep -q 'registered as webAgentRunner' "$RUNNER_LOG"; then
    print_step "runner ready ✅"
    RUNNER_READY=1
    break
  fi
  sleep 1
done

if (( RUNNER_READY == 0 )); then
  print_step "❌ runner did not register within 60s — check $RUNNER_LOG"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

# 6) (M9) Optionally spawn the Feishu bot bridge.
#
# Trigger: only when LARK_BOT_PROFILE env var is set. This keeps the
# default `zsh scripts/dev.sh` flow lightweight (only LarkIslandApp +
# runner). When the user wants Feishu IM as an input entry, they run
# `LARK_BOT_PROFILE=challenge zsh scripts/dev.sh`.
#
# Constraint: lark-cli `event +subscribe` has a single-instance lock
# per app/account. If the user is already running a manual subscribe
# elsewhere, the bot bridge will fight it for events. README documents
# this; nothing scripty to do here.
BOT_PID=""
if [[ -n "${LARK_BOT_PROFILE:-}" ]]; then
  if [[ ! -d "$BOT_DIR/node_modules" ]]; then
    print_step "installing feishu-bot dependencies (first run)..."
    ( cd "$BOT_DIR" && npm install --silent )
  fi
  print_step "spawning feishu bot bridge (profile=$LARK_BOT_PROFILE)..."
  # M11: forward plan-LLM env so the bot can split composite prompts
  # into multi-step workflows. Falls back to single-task path if no
  # key is reachable (m11 fail-safe spec). DASHSCOPE_API_KEY is the
  # default, since m5 the runner uses it as well so demos only need
  # one key.
  ( cd "$BOT_DIR" && LARK_BOT_PROFILE="$LARK_BOT_PROFILE" \
      LARK_BOT_ALLOWLIST="${LARK_BOT_ALLOWLIST:-}" \
      LARK_BOT_LLM_PROFILE="${LARK_BOT_LLM_PROFILE:-qwen-default}" \
      DASHSCOPE_API_KEY="${DASHSCOPE_API_KEY:-}" \
      LARK_BOT_PLAN_LLM_BASE_URL="${LARK_BOT_PLAN_LLM_BASE_URL:-}" \
      LARK_BOT_PLAN_LLM_API_KEY="${LARK_BOT_PLAN_LLM_API_KEY:-}" \
      LARK_BOT_PLAN_LLM_MODEL="${LARK_BOT_PLAN_LLM_MODEL:-}" \
      npx tsx src/main.ts ) &
  BOT_PID=$!
  print_step "  bot bridge pid=$BOT_PID"
fi

# 7) Cleanup on Ctrl+C / SIGTERM.
cleanup() {
  if [[ -n "$BOT_PID" ]]; then
    kill "$BOT_PID" 2>/dev/null || true
  fi
  kill $APP_PID 2>/dev/null || true
}
trap cleanup INT TERM EXIT

print_step "👉 Click the menubar globe (🌐) and submit a task."
if [[ -n "$BOT_PID" ]]; then
  print_step "   Or send a message to the Feishu bot under profile=$LARK_BOT_PROFILE."
fi
print_step "   Press Ctrl+C to terminate the app + runner${BOT_PID:+ + bot bridge}."

wait $APP_PID
exit 0
