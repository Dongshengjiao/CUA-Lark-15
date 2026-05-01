from __future__ import annotations

from pathlib import Path

from cua_lark.models import ExternalVerification, Observation, ValidationResult


class ObservationValidator:
    def validate(self, verification: ExternalVerification, observation: Observation) -> ValidationResult:
        if observation.source == "desktop" and observation.summary.startswith("Mock desktop observation"):
            return ValidationResult(
                success=True,
                message="observation verification skipped for mock perception",
                details=["Mock perception does not provide window-state or screenshot metadata"],
                metadata={"provider": verification.provider, "status": "skipped_mock"},
            )

        metadata = verification.metadata
        field_name = str(metadata.get("field") or "").strip()
        if not field_name:
            return ValidationResult(
                success=False,
                message="observation verification missing metadata.field",
                details=["Set provider=observation and metadata.field to a valid observation metadata key"],
                metadata={"provider": verification.provider, "status": "invalid_config"},
            )

        if field_name == "screenshot_path_exists":
            screenshot_path = observation.metadata.get("screenshot_path")
            exists = bool(screenshot_path and Path(str(screenshot_path)).exists())
            return ValidationResult(
                success=exists,
                message="observation screenshot existence check completed",
                details=[f"screenshot_path_exists={exists}"],
                metadata={"provider": verification.provider, "field": field_name},
            )

        actual_value = observation.metadata.get(field_name)
        if actual_value is None:
            return ValidationResult(
                success=False,
                message=f"observation metadata field not found: {field_name}",
                details=[f"Available keys: {sorted(observation.metadata.keys())}"],
                metadata={"provider": verification.provider, "field": field_name},
            )

        expected_contains = str(
            metadata.get("contains") or verification.expected_contains or ""
        ).strip()
        if expected_contains:
            matched = expected_contains in str(actual_value)
            return ValidationResult(
                success=matched,
                message="observation metadata contains check completed",
                details=[f"{field_name} contains '{expected_contains}' => {matched}"],
                metadata={"provider": verification.provider, "field": field_name, "value": actual_value},
            )

        not_contains = str(metadata.get("not_contains") or "").strip()
        if not_contains:
            matched = not_contains not in str(actual_value)
            return ValidationResult(
                success=matched,
                message="observation metadata negative contains check completed",
                details=[f"{field_name} not contains '{not_contains}' => {matched}"],
                metadata={"provider": verification.provider, "field": field_name, "value": actual_value},
            )

        return ValidationResult(
            success=bool(actual_value),
            message="observation metadata truthy check completed",
            details=[f"{field_name} => {actual_value}"],
            metadata={"provider": verification.provider, "field": field_name, "value": actual_value},
        )
