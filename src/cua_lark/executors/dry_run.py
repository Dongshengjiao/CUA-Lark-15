from __future__ import annotations

from cua_lark.models import ActionResult, StepDefinition
from cua_lark.executors.base import ActionExecutor


class DryRunExecutor(ActionExecutor):
    def run_step(self, step: StepDefinition) -> ActionResult:
        target = step.target or "screen"
        value = f" value={step.value}" if step.value else ""
        return ActionResult(
            step_id=step.id,
            success=True,
            message=f"Dry run executed {step.action.value} on {target}{value}",
        )
