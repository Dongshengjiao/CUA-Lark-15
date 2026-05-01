from __future__ import annotations

from abc import ABC, abstractmethod

from cua_lark.models import Observation, TestCase


class Planner(ABC):
    @abstractmethod
    def plan(self, case: TestCase, observation: Observation) -> TestCase:
        raise NotImplementedError
