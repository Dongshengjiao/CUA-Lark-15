from __future__ import annotations

import json
import shutil
import subprocess

from cua_lark.models import ExternalVerification, ValidationResult


class LarkCliValidator:
    def validate(self, verification: ExternalVerification) -> ValidationResult:
        if shutil.which("lark-cli") is None:
            return ValidationResult(
                success=False,
                message="lark-cli is not installed",
                details=["Install @larksuite/cli before enabling OpenAPI-backed verification"],
                metadata={"provider": verification.provider, "status": "unavailable"},
            )

        command = ["lark-cli", *verification.command]
        if "--format" not in verification.command:
            command.extend(["--format", "json"])

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        metadata = {
            "provider": verification.provider,
            "status": "ok" if result.returncode == 0 else "command_failed",
            "command": command,
        }

        if result.returncode != 0:
            parsed_error = _maybe_parse_json(stdout)
            detail = stderr or stdout or "Command returned a non-zero exit code"
            if isinstance(parsed_error, dict):
                error_message = parsed_error.get("error", {}).get("message")
                if error_message:
                    detail = str(error_message)
            if "keychain entry not found" in detail.lower():
                detail = (
                    "lark-cli is installed but not configured. Run `lark-cli config init` "
                    "and `lark-cli auth login` before enabling OpenAPI-backed verification."
                )
            return ValidationResult(
                success=False,
                message="lark-cli command failed",
                details=[detail],
                metadata=metadata,
            )

        parsed_output = _maybe_parse_json(stdout)
        metadata["parsed"] = parsed_output is not None

        if verification.expected_contains:
            haystacks = [stdout]
            if parsed_output is not None:
                haystacks.append(json.dumps(parsed_output, ensure_ascii=False))
            if any(verification.expected_contains in item for item in haystacks):
                return ValidationResult(
                    success=True,
                    message="lark-cli verification matched expected content",
                    details=[f"Matched expected text: {verification.expected_contains}"],
                    metadata=metadata,
                )

            return ValidationResult(
                success=False,
                message="lark-cli verification did not match expected content",
                details=[f"Expected to find: {verification.expected_contains}"],
                metadata=metadata,
            )

        return ValidationResult(
            success=True,
            message="lark-cli command completed successfully",
            details=["No content assertion configured; command exit status used as success signal"],
            metadata=metadata,
        )


def _maybe_parse_json(text: str) -> object | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None
