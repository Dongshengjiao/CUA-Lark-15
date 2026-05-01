from __future__ import annotations

from abc import ABC, abstractmethod

from cua_lark.models import ActionResult, StepDefinition


class ActionExecutor(ABC):
    @abstractmethod
    def run_step(self, step: StepDefinition) -> ActionResult:
        raise NotImplementedError

    def prepare_final_observation(self) -> None:
        return None
