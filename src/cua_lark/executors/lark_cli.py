from __future__ import annotations

import json
import subprocess
import time

from cua_lark.executors.base import ActionExecutor
from cua_lark.models import ActionResult, ActionType, StepDefinition


class LarkCliExecutor(ActionExecutor):
    def run_step(self, step: StepDefinition) -> ActionResult:
        started = time.time()

        if step.action != ActionType.LARK_CLI:
            return ActionResult(
                step_id=step.id,
                success=False,
                message=f"lark-cli executor only supports {ActionType.LARK_CLI.value}",
            )

        command = _build_command(step)
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        duration = time.time() - started

        expected = str(step.metadata.get("expected_stdout_contains") or "").strip()
        if result.returncode != 0:
            detail = _extract_error_detail(stdout, stderr)
            return ActionResult(
                step_id=step.id,
                success=False,
                message=f"lark-cli failed in {duration:.2f}s: {detail}",
            )

        if expected and expected not in stdout:
            return ActionResult(
                step_id=step.id,
                success=False,
                message=(
                    f"lark-cli completed in {duration:.2f}s but did not match expected text: {expected}"
                ),
            )

        summary = stdout or stderr or "command completed successfully"
        summary = summary.replace("\n", " ")
        if len(summary) > 240:
            summary = summary[:237] + "..."
        return ActionResult(
            step_id=step.id,
            success=True,
            message=f"Executed lark-cli in {duration:.2f}s | {summary}",
        )


def _build_command(step: StepDefinition) -> list[str]:
    raw_command = step.metadata.get("command")
    if not isinstance(raw_command, list) or not raw_command:
        raise ValueError("lark_cli action requires metadata.command as a non-empty list")

    command = ["lark-cli", *[str(item) for item in raw_command]]

    if step.metadata.get("as_identity") and "--as" not in command:
        command.extend(["--as", str(step.metadata["as_identity"])])

    if step.metadata.get("dry_run") and "--dry-run" not in command:
        command.append("--dry-run")

    if step.metadata.get("append_format_json", True):
        if "--format" not in command:
            command.extend(["--format", "json"])

    return command


def _extract_error_detail(stdout: str, stderr: str) -> str:
    detail = stderr or stdout or "command returned a non-zero exit code"
    try:
        parsed = json.loads(stdout) if stdout else None
    except json.JSONDecodeError:
        parsed = None

    if isinstance(parsed, dict):
        error = parsed.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])

    return detail
