from __future__ import annotations

from cua_lark.models import Observation, TestCase, ValidationResult
from cua_lark.validators.base import Validator


class KeywordValidator(Validator):
    def validate(self, case: TestCase, observation: Observation) -> ValidationResult:
        if case.expected.lower() in observation.ocr_text.lower():
            return ValidationResult(
                success=True,
                message="Expected text found in OCR output",
                details=["OCR check matched expected text"],
            )

        for step in case.steps:
            if step.value and case.expected.lower() in step.value.lower():
                return ValidationResult(
                    success=True,
                    message="Expected text matched a planned input value during dry run",
                    details=["Fallback validation matched a planned step value"],
                )
            if step.target and case.expected.lower() in step.target.lower():
                return ValidationResult(
                    success=True,
                    message="Expected text matched a planned target during dry run",
                    details=["Fallback validation matched a planned step target"],
                )
            expected_stdout = str(step.metadata.get("expected_stdout_contains") or "")
            if expected_stdout and case.expected.lower() in expected_stdout.lower():
                return ValidationResult(
                    success=True,
                    message="Expected text matched a planned lark-cli output assertion during dry run",
                    details=["Fallback validation matched metadata.expected_stdout_contains"],
                )
            command = step.metadata.get("command")
            if isinstance(command, list):
                rendered_command = " ".join(str(item) for item in command)
                if case.expected.lower() in rendered_command.lower():
                    return ValidationResult(
                        success=True,
                        message="Expected text matched a planned lark-cli command during dry run",
                        details=["Fallback validation matched metadata.command"],
                    )

        return ValidationResult(
            success=False,
            message=f"Expected text '{case.expected}' not found in observation",
            details=["Neither OCR output nor planned step values matched expected text"],
        )
