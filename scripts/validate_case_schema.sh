#!/usr/bin/env bash
# PostToolUse hook: validate cases/**/*.json against the TestCase schema.
#
# Reads the standard hook stdin JSON, extracts the touched file path, and
# only runs when the path looks like a case file under cases/. Validates the
# Pydantic TestCase model. On schema failure, prints a JSON object with
# decision=block + reason so Claude sees the error in its next turn; on
# success the hook is silent.
set -uo pipefail

HOOK_INPUT=$(cat)
FILE=$(echo "${HOOK_INPUT}" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')

if [ -z "${FILE}" ]; then
  exit 0
fi

case "${FILE}" in
  *cases/*.json) ;;
  *) exit 0 ;;
esac

REPO_ROOT="/Users/niny/Documents/GitHub/CUA-Lark-15"
cd "${REPO_ROOT}" 2>/dev/null || exit 0

OUTPUT=$(PYTHONPATH=src python3 - "${FILE}" <<'PY' 2>&1
import json
import sys
from cua_lark.models import TestCase

try:
    TestCase.model_validate(json.load(open(sys.argv[1])))
    print("ok")
except Exception as exc:
    print(f"fail: {exc}")
    sys.exit(1)
PY
)
RC=$?

if [ "${RC}" -ne 0 ]; then
  jq -n --arg msg "TestCase schema validation failed for ${FILE}: ${OUTPUT}" \
    '{decision:"block", reason:$msg}'
fi

exit 0
