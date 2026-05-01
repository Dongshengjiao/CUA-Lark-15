from __future__ import annotations

from abc import ABC, abstractmethod

from cua_lark.models import Observation, TestCase, ValidationResult


class Validator(ABC):
    @abstractmethod
    def validate(self, case: TestCase, observation: Observation) -> ValidationResult:
        raise NotImplementedError
