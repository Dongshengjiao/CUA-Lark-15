from __future__ import annotations

from cua_lark.models import Observation, TestCase
from cua_lark.planners.base import Planner


class RuleBasedPlanner(Planner):
    def plan(self, case: TestCase, observation: Observation) -> TestCase:
        return case
