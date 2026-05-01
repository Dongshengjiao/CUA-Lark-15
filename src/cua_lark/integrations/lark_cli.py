from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass


@dataclass
class LarkCliPreflight:
    installed: bool
    ready: bool
    summary: str
    details: list[str]


def run_lark_cli_preflight() -> LarkCliPreflight:
    if shutil.which("lark-cli") is None:
        return LarkCliPreflight(
            installed=False,
            ready=False,
            summary="lark-cli is not installed",
            details=["Install the official Lark/Feishu CLI before enabling API-backed checks"],
        )

    doctor = _run(["lark-cli", "doctor"])
    auth = _run(["lark-cli", "auth", "status"])
    config = _run(["lark-cli", "config", "show"])

    details: list[str] = []
    doctor_json = _maybe_json(doctor.stdout)
    auth_json = _maybe_json(auth.stdout)

    if isinstance(doctor_json, dict):
        for check in doctor_json.get("checks", []):
            name = check.get("name", "unknown")
            status = check.get("status", "unknown")
            message = check.get("message", "")
            details.append(f"doctor.{name}: {status} - {message}")

    if isinstance(auth_json, dict):
        error_message = auth_json.get("error", {}).get("message")
        if error_message:
            details.append(f"auth: {error_message}")

    if "keychain entry not found" in " ".join(details).lower():
        details.append(
            "Fix by running `lark-cli config init` with the correct app secret, then `lark-cli auth login`."
        )

    if "(no logged-in users)" in config.stdout:
        details.append("config: no logged-in users")

    ready = doctor.returncode == 0 and auth.returncode == 0
    summary = "lark-cli is ready for verification" if ready else "lark-cli is installed but not ready"

    return LarkCliPreflight(
        installed=True,
        ready=ready,
        summary=summary,
        details=details,
    )


@dataclass
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


def _run(command: list[str]) -> CommandResult:
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    return CommandResult(
        returncode=result.returncode,
        stdout=result.stdout.strip(),
        stderr=result.stderr.strip(),
    )


def _maybe_json(text: str) -> object | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None
