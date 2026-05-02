from __future__ import annotations

from datetime import datetime, timezone
import time

from cua_lark.executors.base import ActionExecutor

from cua_lark.models import ActionResult, Observation, RunResult, StepDefinition, TestCase
from cua_lark.perception.base import PerceptionAdapter
from cua_lark.planners.base import Planner
from cua_lark.validators.base import Validator


class AgentService:
    def __init__(
        self,
        perception: PerceptionAdapter,
        planner: Planner,
        executor: ActionExecutor,
        validator: Validator,
        recovery_presets: dict[str, list[dict[str, object]]] | None = None,
    ) -> None:
        self.perception = perception
        self.planner = planner
        self.executor = executor
        self.validator = validator
        self.recovery_presets: dict[str, list[dict[str, object]]] = (
            dict(recovery_presets) if recovery_presets else {}
        )

    def run_case(self, case: TestCase) -> RunResult:
        started_at = datetime.now(timezone.utc)
        observation = self.perception.capture()
        planned_case = self.planner.plan(case, observation)

        action_results, execution_metadata = self._run_steps_with_recovery(planned_case.steps)

        self.executor.prepare_final_observation()
        final_observation = self.perception.capture()
        validation = self.validator.validate(planned_case, final_observation)
        ended_at = datetime.now(timezone.utc)

        execution_success = bool(execution_metadata.get("top_level_success", True))

        return RunResult(
            case_id=planned_case.id,
            case_name=planned_case.name,
            success=execution_success and validation.success,
            product=planned_case.product,
            action_results=action_results,
            validation=validation,
            metadata={
                "goal": planned_case.goal,
                "expected": planned_case.expected,
                "started_at": started_at.isoformat(),
                "ended_at": ended_at.isoformat(),
                "initial_observation": observation.model_dump(mode="json"),
                "final_observation": final_observation.model_dump(mode="json"),
                "execution": execution_metadata,
            },
        )

    def _run_steps_with_recovery(
        self,
        steps: list[StepDefinition],
    ) -> tuple[list[ActionResult], dict[str, object]]:
        action_results: list[ActionResult] = []
        top_level_step_success: list[bool] = []
        recovery_events: list[dict[str, object]] = []

        for step in steps:
            step_results, step_success, recovery_event = self._run_step_with_recovery(step)
            action_results.extend(step_results)
            top_level_step_success.append(step_success or step.continue_on_failure)
            if recovery_event is not None:
                recovery_events.append(recovery_event)
            if not step_success and not step.continue_on_failure:
                break

        return (
            action_results,
            {
                "top_level_success": all(top_level_step_success),
                "recovery_events": recovery_events,
            },
        )

    def _run_step_with_recovery(
        self,
        step: StepDefinition,
    ) -> tuple[list[ActionResult], bool, dict[str, object] | None]:
        precheck_result = self._apply_pre_observation_guard(step)
        if precheck_result is not None:
            return [precheck_result], True, None

        initial_result = self.executor.run_step(step)
        initial_result = self._apply_post_observation_guard(step, initial_result)
        results = [initial_result]
        if initial_result.success:
            return results, True, None

        fallback_payload = step.metadata.get("fallback_steps", [])
        if not isinstance(fallback_payload, list) or not fallback_payload:
            heal_outcome = self._maybe_self_heal(step, results)
            if heal_outcome is not None:
                return heal_outcome
            return results, False, None

        fallback_steps: list[StepDefinition] = []
        for index, item in enumerate(fallback_payload):
            if not isinstance(item, dict):
                continue

            item_metadata = item.get("metadata", {})
            merged_metadata = dict(item_metadata) if isinstance(item_metadata, dict) else {}
            parent_metadata = step.metadata

            # Let recovery steps inherit app resolution hints from the parent
            # step so they can reactivate/refocus Feishu from arbitrary states.
            if "app_name" not in merged_metadata and "app_name" in parent_metadata:
                merged_metadata["app_name"] = parent_metadata["app_name"]
            if "app_names" not in merged_metadata and "app_names" in parent_metadata:
                merged_metadata["app_names"] = parent_metadata["app_names"]

            fallback_steps.append(
                StepDefinition.model_validate(
                    {
                        **item,
                        "metadata": merged_metadata,
                        "id": f"{step.id}__fallback_{index + 1}__{item.get('id', 'step')}",
                    }
                )
            )

        if not fallback_steps:
            return results, False, None

        fallback_results = [self.executor.run_step(fallback_step) for fallback_step in fallback_steps]
        results.extend(fallback_results)
        fallback_success = all(item.success for item in fallback_results)
        recovery_event: dict[str, object] = {
            "step_id": step.id,
            "fallback_triggered": True,
            "fallback_success": fallback_success,
            "retry_after_fallback": False,
        }

        if not fallback_success:
            return results, False, recovery_event

        retry_after_fallback = bool(step.metadata.get("retry_after_fallback"))
        complete_on_fallback = bool(step.metadata.get("complete_on_fallback"))
        recovery_event["retry_after_fallback"] = retry_after_fallback
        recovery_event["complete_on_fallback"] = complete_on_fallback

        if complete_on_fallback and not retry_after_fallback:
            return results, True, recovery_event

        if not retry_after_fallback:
            return results, False, recovery_event

        retry_step = step.model_copy(update={"id": f"{step.id}__retry"})
        retry_result = self.executor.run_step(retry_step)
        retry_result = self._apply_post_observation_guard(step, retry_result)
        results.append(retry_result)
        recovery_event["retry_success"] = retry_result.success
        return results, retry_result.success, recovery_event

    # Built-in self-healing presets. Keyed by signal name; each entry returns
    # the recovery StepDefinition list to fire before retrying the original
    # step. Cases opt in via metadata.auto_heal=true; the runtime detects the
    # signal from observation metadata and runs the matching preset.
    _HEAL_PRESETS: dict[str, list[dict[str, object]]] = {
        "stuck_create_event_modal": [
            {
                "id": "heal_dismiss_modal",
                "action": "hotkey",
                "target": "stuck modal",
                "metadata": {"hotkey_alias": "dismiss_modal"},
            },
            {
                "id": "heal_wait_after_dismiss",
                "action": "wait",
                "target": "after dismiss",
                "value": "0.6",
            },
        ],
        "discard_dialog_visible": [
            {
                "id": "heal_close_discard_dialog",
                "action": "hotkey",
                "target": "discard dialog",
                "metadata": {"hotkey_alias": "dismiss_modal"},
            },
            {
                "id": "heal_wait_after_dismiss",
                "action": "wait",
                "target": "after dismiss",
                "value": "0.6",
            },
        ],
        "feishu_login_required": [
            {
                "id": "heal_wait_for_login",
                "action": "wait",
                "target": "login redirect",
                "value": "2",
            }
        ],
        "browser_renderer_idle": [
            {
                "id": "heal_refocus_app",
                "action": "activate_app",
                "target": "browser",
                "metadata": {},
            },
            {
                "id": "heal_wait_for_refocus",
                "action": "wait",
                "target": "after refocus",
                "value": "1",
            },
        ],
    }

    def _detect_heal_signals(self, observation: Observation) -> list[str]:
        """Inspect observation metadata for known error signatures."""
        meta = observation.metadata or {}
        signals: list[str] = []

        front_title = str(meta.get("front_window_title") or "")
        if "创建日程" in front_title:
            signals.append("stuck_create_event_modal")
        if any(token in front_title for token in ("继续编辑", "丢弃")):
            signals.append("discard_dialog_visible")

        browser_url = str(meta.get("browser_url") or "")
        if "accounts.feishu.cn/accounts/page/login" in browser_url:
            signals.append("feishu_login_required")
        if bool(meta.get("browser_login_required")):
            signals.append("feishu_login_required")

        if meta.get("browser_url") and not meta.get("browser_title"):
            signals.append("browser_renderer_idle")

        return signals

    def _maybe_self_heal(
        self,
        step: StepDefinition,
        results: list[ActionResult],
    ) -> tuple[list[ActionResult], bool, dict[str, object] | None] | None:
        if not bool(step.metadata.get("auto_heal")):
            return None
        observation = self.perception.capture()
        signals = self._detect_heal_signals(observation)
        explicit = step.metadata.get("heal_signals")
        allowed: set[str] | None = None
        if isinstance(explicit, list):
            allowed = {str(item) for item in explicit if str(item)}
        active_signals = [s for s in signals if allowed is None or s in allowed]
        if not active_signals:
            return None
        heal_event: dict[str, object] = {
            "step_id": step.id,
            "auto_heal_triggered": True,
            "signals": active_signals,
        }
        for signal in active_signals:
            preset = self.recovery_presets.get(signal) or self._HEAL_PRESETS.get(signal)
            if not preset:
                continue
            for index, item in enumerate(preset):
                raw_meta = item.get("metadata")
                meta_payload: dict[str, object] = (
                    dict(raw_meta) if isinstance(raw_meta, dict) else {}
                )
                heal_step = StepDefinition.model_validate(
                    {
                        **item,
                        "id": f"{step.id}__heal_{signal}_{index + 1}__{item.get('id', 'step')}",
                        "metadata": meta_payload,
                    }
                )
                results.append(self.executor.run_step(heal_step))
        retry_step = step.model_copy(update={"id": f"{step.id}__heal_retry"})
        retry_result = self.executor.run_step(retry_step)
        retry_result = self._apply_post_observation_guard(step, retry_result)
        results.append(retry_result)
        heal_event["retry_success"] = retry_result.success
        return results, retry_result.success, heal_event

    def _apply_pre_observation_guard(self, step: StepDefinition) -> ActionResult | None:
        spec = step.metadata.get("skip_if_observation")
        if not isinstance(spec, dict):
            spec = None

        only_if_spec = step.metadata.get("only_if_observation")
        if not isinstance(only_if_spec, dict):
            only_if_spec = None

        if spec is None and only_if_spec is None:
            return None

        observation = self.perception.capture()

        if spec is not None:
            matched, detail = _matches_post_observation(spec, observation)
            if matched:
                timestamp = datetime.now(timezone.utc)
                return ActionResult(
                    step_id=step.id,
                    success=True,
                    message=f"Skipped because current state already matches target: {detail}",
                    started_at=timestamp,
                    ended_at=timestamp,
                )

        if only_if_spec is None:
            return None

        matched, detail = _matches_post_observation(only_if_spec, observation)
        if matched:
            return None

        timestamp = datetime.now(timezone.utc)
        return ActionResult(
            step_id=step.id,
            success=True,
            message=f"Skipped because current state does not require this step: {detail}",
            started_at=timestamp,
            ended_at=timestamp,
        )

    def _apply_post_observation_guard(
        self,
        step: StepDefinition,
        result: ActionResult,
    ) -> ActionResult:
        if not result.success:
            return result

        spec = step.metadata.get("post_observation")
        if not isinstance(spec, dict):
            return result

        retries = int(spec.get("retries", 1) or 1)
        delay_seconds = float(spec.get("delay_seconds", 0.4) or 0.4)
        last_message = "post observation check failed"

        for attempt in range(max(retries, 1)):
            observation = self.perception.capture()
            matched, last_message = _matches_post_observation(spec, observation)
            if matched:
                return result
            if attempt < max(retries, 1) - 1:
                time.sleep(delay_seconds)

        return ActionResult(
            step_id=result.step_id,
            success=False,
            message=f"{result.message}; post-observation failed: {last_message}",
            started_at=result.started_at,
            ended_at=result.ended_at,
        )


def _matches_post_observation(spec: dict[str, object], observation: Observation) -> tuple[bool, str]:
    if observation.source == "desktop" and observation.summary.startswith("Mock desktop observation"):
        return True, "post observation skipped for mock perception"

    field_name = str(spec.get("field") or "").strip()
    if not field_name:
        return False, "post_observation.field is required"

    actual_value = observation.metadata.get(field_name)
    if actual_value is None:
        return False, f"observation field missing: {field_name}"

    contains = str(spec.get("contains") or "").strip()
    if contains:
        matched = contains in str(actual_value)
        return matched, f"{field_name} contains '{contains}' => {matched}"

    equals = spec.get("equals")
    if equals is not None:
        matched = str(actual_value) == str(equals)
        return matched, f"{field_name} equals '{equals}' => {matched}"

    matched = bool(actual_value)
    return matched, f"{field_name} truthy => {matched}"
