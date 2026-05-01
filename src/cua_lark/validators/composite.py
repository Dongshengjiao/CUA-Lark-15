from __future__ import annotations

from cua_lark.models import Observation, TestCase, ValidationResult
from cua_lark.validators.base import Validator
from cua_lark.validators.keyword import KeywordValidator
from cua_lark.validators.lark_cli import LarkCliValidator
from cua_lark.validators.observation import ObservationValidator


class CompositeValidator(Validator):
    def __init__(
        self,
        keyword_validator: KeywordValidator | None = None,
        lark_cli_validator: LarkCliValidator | None = None,
        observation_validator: ObservationValidator | None = None,
    ) -> None:
        self.keyword_validator = keyword_validator or KeywordValidator()
        self.lark_cli_validator = lark_cli_validator or LarkCliValidator()
        self.observation_validator = observation_validator or ObservationValidator()

    def validate(self, case: TestCase, observation: Observation) -> ValidationResult:
        keyword_result = self.keyword_validator.validate(case, observation)
        details = list(keyword_result.details)
        metadata = {"keyword": keyword_result.metadata}

        if not case.verifications:
            return ValidationResult(
                success=keyword_result.success,
                message=keyword_result.message,
                details=details,
                metadata=metadata,
            )

        overall_success = keyword_result.success
        external_messages: list[str] = []
        external_metadata: list[dict[str, object]] = []

        for verification in case.verifications:
            if verification.provider != "lark_cli":
                if verification.provider == "observation":
                    result = self.observation_validator.validate(verification, observation)
                else:
                    external_messages.append(
                        f"{verification.id}: unsupported provider {verification.provider}"
                    )
                    external_metadata.append(
                        {"id": verification.id, "provider": verification.provider, "status": "unsupported"}
                    )
                    if not verification.optional:
                        overall_success = False
                    continue
            else:
                result = self.lark_cli_validator.validate(verification)
            external_messages.append(f"{verification.id}: {result.message}")
            details.extend(result.details)
            external_metadata.append(
                {
                    "id": verification.id,
                    "provider": verification.provider,
                    "success": result.success,
                    "metadata": result.metadata,
                }
            )

            if not result.success and not verification.optional:
                overall_success = False

        metadata["external"] = external_metadata
        message = keyword_result.message
        if external_messages:
            message = f"{keyword_result.message}; " + "; ".join(external_messages)

        return ValidationResult(
            success=overall_success,
            message=message,
            details=details,
            metadata=metadata,
        )
