from __future__ import annotations

import time

from cua_lark.config import DesktopConfig
from cua_lark.executors.base import ActionExecutor
from cua_lark.macos import (
    activate_application,
    activate_application_candidates,
    click,
    click_element_by_label_candidates,
    element_exists_by_label_candidates,
    close_front_window_if_title_matches,
    drag,
    get_frontmost_window_title,
    press_hotkey,
    resolve_point,
    scroll,
    type_text,
    type_text_via_paste,
)
from cua_lark.models import ActionResult, ActionType, StepDefinition


class MacOSExecutor(ActionExecutor):
    def __init__(self, desktop_config: DesktopConfig | None = None) -> None:
        self.desktop_config = desktop_config or DesktopConfig()

    def run_step(self, step: StepDefinition) -> ActionResult:
        started = time.time()

        try:
            detail = self._run(step)
            duration = time.time() - started
            suffix = f" | {detail}" if detail else ""
            return ActionResult(
                step_id=step.id,
                success=True,
                message=f"Executed {step.action.value} in {duration:.2f}s{suffix}",
            )
        except Exception as exc:
            return ActionResult(
                step_id=step.id,
                success=False,
                message=f"{step.action.value} failed: {exc}",
            )

    def prepare_final_observation(self) -> None:
        try:
            process_name, _window_title = get_frontmost_window_title()
        except Exception:
            activate_application_candidates(["飞书", "Lark", "com.bytedance.macos.feishu"])
            time.sleep(0.3)
            return

        if process_name not in {"飞书", "Lark", "com.bytedance.macos.feishu"}:
            activate_application_candidates(["飞书", "Lark", "com.bytedance.macos.feishu"])
            time.sleep(0.3)

    def _run(self, step: StepDefinition) -> str:
        metadata = _resolved_metadata(step, self.desktop_config)

        if step.action == ActionType.CLICK:
            labels = metadata.get("accessibility_labels")
            if bool(metadata.get("prefer_point_click")):
                _assert_pre_labels(metadata)
                x, y = _require_point(metadata)
                click(x, y)
                _assert_post_labels(metadata)
                return f"point click at ({x:.1f}, {y:.1f})"
            if isinstance(labels, list) and labels:
                _assert_pre_labels(metadata)
                app_names = metadata.get("app_names")
                hint = str(metadata.get("accessibility_hint") or "").strip() or None
                candidates = (
                    [str(item).strip() for item in app_names if str(item).strip()]
                    if isinstance(app_names, list)
                    else ["飞书", "Lark", "com.bytedance.macos.feishu"]
                )
                try:
                    matched_app, matched_label = click_element_by_label_candidates(
                        candidates,
                        [str(item).strip() for item in labels if str(item).strip()],
                        hint=hint,
                    )
                    _assert_post_labels(metadata)
                    return f"accessibility click matched {matched_label} in {matched_app}"
                except Exception:
                    if bool(metadata.get("skip_if_accessibility_missing")):
                        return "accessibility click skipped because target labels were unavailable"
                    if bool(metadata.get("require_accessibility_click")):
                        raise
            x, y = _require_point(metadata)
            click(x, y)
            _assert_post_labels(metadata)
            return f"point click at ({x:.1f}, {y:.1f})"

        if step.action == ActionType.DOUBLE_CLICK:
            x, y = _require_point(metadata)
            click(x, y, click_count=2)
            return f"double click at ({x:.1f}, {y:.1f})"

        if step.action == ActionType.RIGHT_CLICK:
            x, y = _require_point(metadata)
            click(x, y, button="right")
            return f"right click at ({x:.1f}, {y:.1f})"

        if step.action == ActionType.TYPE:
            if not step.value:
                raise ValueError("type action requires a value")
            _assert_context_labels(metadata, "pre_accessibility_labels")
            if str(metadata.get("type_mode") or "").strip().lower() == "paste":
                type_text_via_paste(step.value)
                return "typed via paste"
            else:
                type_text(step.value)
                return "typed via keystrokes"

        if step.action == ActionType.HOTKEY:
            confirmation_alias = str(metadata.get("confirmation_alias") or "").strip()
            if confirmation_alias and not self.desktop_config.confirmed_actions.get(
                confirmation_alias, False
            ):
                return f"hotkey skipped until confirmation alias '{confirmation_alias}' is enabled"
            resolved_hotkey = _resolve_hotkey_value(step, metadata, self.desktop_config)
            if resolved_hotkey is None:
                return "hotkey skipped because it is unconfigured"
            if not resolved_hotkey:
                raise ValueError("hotkey action requires a value")
            title_keywords = metadata.get("only_if_front_window_title_contains")
            app_names = metadata.get("app_names")
            if isinstance(title_keywords, list) and title_keywords:
                candidates = (
                    [str(item).strip() for item in app_names if str(item).strip()]
                    if isinstance(app_names, list)
                    else ["飞书", "Lark", "com.bytedance.macos.feishu"]
                )
                matched = close_front_window_if_title_matches(
                    candidates,
                    [str(item).strip() for item in title_keywords if str(item).strip()],
                    close_hotkey=resolved_hotkey,
                )
                if matched:
                    return f"conditional hotkey {resolved_hotkey} executed"
                return f"conditional hotkey {resolved_hotkey} skipped"
            press_hotkey(resolved_hotkey)
            return f"hotkey {resolved_hotkey}"

        if step.action == ActionType.SCROLL:
            amount = int(metadata.get("amount", step.value or 0))
            if amount == 0:
                raise ValueError("scroll action requires a non-zero amount")
            scroll(amount)
            return f"scrolled {amount}"

        if step.action == ActionType.WAIT:
            seconds = float(metadata.get("seconds", step.value or 1))
            time.sleep(seconds)
            return f"waited {seconds:.2f}s"

        if step.action == ActionType.ASSERT_TEXT:
            return "assert_text is a no-op in macOS executor"

        if step.action == ActionType.DRAG:
            from_x = float(metadata["from_x"])
            from_y = float(metadata["from_y"])
            to_x = float(metadata["to_x"])
            to_y = float(metadata["to_y"])
            drag(from_x, from_y, to_x, to_y)
            return f"dragged from ({from_x:.1f}, {from_y:.1f}) to ({to_x:.1f}, {to_y:.1f})"

        if step.action == ActionType.ACTIVATE_APP:
            app_names = metadata.get("app_names")
            if isinstance(app_names, list) and app_names:
                candidates = [str(item).strip() for item in app_names if str(item).strip()]
                if not candidates:
                    raise ValueError("activate_app app_names must not be empty")
                activate_application_candidates(candidates)
                return f"activated app candidates {candidates}"

            app_name = str(metadata.get("app_name") or step.value or "").strip()
            if not app_name:
                raise ValueError("activate_app requires app_name metadata, app_names, or value")
            activate_application(app_name)
            return f"activated {app_name}"

        raise ValueError(f"Unsupported macOS action: {step.action.value}")


def _resolved_metadata(step: StepDefinition, desktop_config: DesktopConfig) -> dict[str, object]:
    metadata = dict(step.metadata)
    override = desktop_config.step_overrides.get(step.id)
    if override is None and "__" in step.id:
        override = desktop_config.step_overrides.get(step.id.split("__", 1)[0])
    if override is None:
        return metadata

    payload = override.model_dump(exclude_none=True)
    for key, value in payload.items():
        if isinstance(value, list) and value:
            metadata[key] = value
        else:
            metadata[key] = value
    return metadata


def _resolve_hotkey_value(
    step: StepDefinition, metadata: dict[str, object], desktop_config: DesktopConfig
) -> str | None:
    alias = str(metadata.get("hotkey_alias") or "").strip()
    if alias:
        configured = desktop_config.hotkeys.get(alias)
        if configured is not None:
            configured = configured.strip()
            if not configured and bool(metadata.get("skip_if_unconfigured")):
                return None
            if configured:
                return configured
        if bool(metadata.get("skip_if_unconfigured")) and not step.value:
            return None
        return step.value
    if step.value and step.value in desktop_config.hotkeys:
        configured = desktop_config.hotkeys[step.value].strip()
        if not configured and bool(metadata.get("skip_if_unconfigured")):
            return None
        return configured
    return step.value


def _require_point(metadata: dict[str, object]) -> tuple[float, float]:
    try:
        return resolve_point(metadata)
    except Exception as exc:
        raise ValueError(
            f"click actions require metadata.x/y or metadata.x_ratio/y_ratio; resolve failed: {exc}"
        ) from exc


def _assert_post_labels(metadata: dict[str, object]) -> None:
    labels = metadata.get("post_accessibility_labels")
    if not isinstance(labels, list) or not labels:
        return

    app_names = metadata.get("app_names")
    hint = str(metadata.get("accessibility_hint") or "").strip() or None
    candidates = (
        [str(item).strip() for item in app_names if str(item).strip()]
        if isinstance(app_names, list)
        else ["飞书", "Lark", "com.bytedance.macos.feishu"]
    )
    normalized = [str(item).strip() for item in labels if str(item).strip()]
    if not normalized:
        return

    retries = int(metadata.get("post_accessibility_retries", 1) or 1)
    delay_seconds = float(metadata.get("post_accessibility_delay_seconds", 0.4) or 0.4)

    for attempt in range(max(retries, 1)):
        matched, _matched_label = element_exists_by_label_candidates(
            candidates, normalized, hint=hint
        )
        if matched:
            return
        if attempt < max(retries, 1) - 1:
            time.sleep(delay_seconds)

    raise ValueError(f"post accessibility labels not found: {normalized}")


def _assert_pre_labels(metadata: dict[str, object]) -> None:
    if not bool(metadata.get("recognition_first")):
        return

    labels = metadata.get("accessibility_labels")
    if not isinstance(labels, list) or not labels:
        return

    app_names = metadata.get("app_names")
    hint = str(metadata.get("accessibility_hint") or "").strip() or None
    candidates = (
        [str(item).strip() for item in app_names if str(item).strip()]
        if isinstance(app_names, list)
        else ["飞书", "Lark", "com.bytedance.macos.feishu"]
    )
    normalized = [str(item).strip() for item in labels if str(item).strip()]
    if not normalized:
        return

    retries = int(metadata.get("pre_accessibility_retries", 1) or 1)
    delay_seconds = float(metadata.get("pre_accessibility_delay_seconds", 0.4) or 0.4)

    for attempt in range(max(retries, 1)):
        matched, _matched_label = element_exists_by_label_candidates(
            candidates, normalized, hint=hint
        )
        if matched:
            return
        if attempt < max(retries, 1) - 1:
            time.sleep(delay_seconds)

    if bool(metadata.get("skip_if_accessibility_missing")):
        return
    raise ValueError(f"pre accessibility labels not found: {normalized}")


def _assert_context_labels(metadata: dict[str, object], key: str) -> None:
    labels = metadata.get(key)
    if not isinstance(labels, list) or not labels:
        return

    app_names = metadata.get("app_names")
    hint = str(metadata.get("pre_accessibility_hint") or metadata.get("accessibility_hint") or "").strip() or None
    candidates = (
        [str(item).strip() for item in app_names if str(item).strip()]
        if isinstance(app_names, list)
        else ["飞书", "Lark", "com.bytedance.macos.feishu"]
    )
    normalized = [str(item).strip() for item in labels if str(item).strip()]
    if not normalized:
        return

    retries = int(metadata.get("pre_accessibility_retries", 1) or 1)
    delay_seconds = float(metadata.get("pre_accessibility_delay_seconds", 0.4) or 0.4)

    for attempt in range(max(retries, 1)):
        matched, _matched_label = element_exists_by_label_candidates(
            candidates, normalized, hint=hint
        )
        if matched:
            return
        if attempt < max(retries, 1) - 1:
            time.sleep(delay_seconds)

    raise ValueError(f"context accessibility labels not found: {normalized}")
