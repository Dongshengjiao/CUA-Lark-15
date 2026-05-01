from __future__ import annotations

import time

from cua_lark.browser import get_browser_session
from cua_lark.config import BrowserConfig
from cua_lark.executors.base import ActionExecutor
from cua_lark.models import ActionResult, ActionType, StepDefinition


def _resolve_browser_hotkey_value(
    step: StepDefinition,
    metadata: dict[str, object],
    browser_config: BrowserConfig,
) -> str | None:
    alias = str(metadata.get("hotkey_alias") or "").strip()
    if alias:
        configured = browser_config.hotkeys.get(alias)
        if configured is not None:
            configured = configured.strip()
            if not configured and bool(metadata.get("skip_if_unconfigured")):
                return None
            if configured:
                return configured
        if bool(metadata.get("skip_if_unconfigured")) and not step.value:
            return None
        return step.value
    if step.value and step.value in browser_config.hotkeys:
        configured = browser_config.hotkeys[step.value].strip()
        if not configured and bool(metadata.get("skip_if_unconfigured")):
            return None
        return configured
    return step.value


class BrowserExecutor(ActionExecutor):
    def __init__(self, browser_config: BrowserConfig | None = None) -> None:
        self.browser_config = browser_config or BrowserConfig()
        self.session = get_browser_session(self.browser_config)

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

    def _run(self, step: StepDefinition) -> str:
        metadata = dict(step.metadata)

        if step.action == ActionType.ACTIVATE_APP:
            url = str(metadata.get("url") or self.browser_config.start_url or "").strip()
            manual_login_wait_seconds = float(
                metadata.get("manual_login_wait_seconds", 0) or 0
            )
            raw_candidate_urls = metadata.get("candidate_urls")
            if isinstance(raw_candidate_urls, list) and raw_candidate_urls:
                expected_url_contains = metadata.get("expected_url_contains")
                expected_page_contains = metadata.get("expected_page_contains")
                resolved_url = self.session.open_candidate_urls(
                    [str(item).strip() for item in raw_candidate_urls if str(item).strip()],
                    expected_url_contains=(
                        [str(item).strip() for item in expected_url_contains if str(item).strip()]
                        if isinstance(expected_url_contains, list)
                        else ([str(expected_url_contains).strip()] if expected_url_contains else None)
                    ),
                    expected_page_contains=(
                        [str(item).strip() for item in expected_page_contains if str(item).strip()]
                        if isinstance(expected_page_contains, list)
                        else ([str(expected_page_contains).strip()] if expected_page_contains else None)
                    ),
                    manual_login_wait_seconds=manual_login_wait_seconds,
                )
                return resolved_url
            self.session.ensure_url(
                url or None,
                manual_login_wait_seconds=manual_login_wait_seconds,
            )
            return self.session.current_metadata().get("browser_url", "")

        if step.action == ActionType.CLICK:
            confirmation_alias = str(metadata.get("confirmation_alias") or "").strip()
            if confirmation_alias and not self.browser_config.confirmed_actions.get(
                confirmation_alias, False
            ):
                return f"click skipped until confirmation alias '{confirmation_alias}' is enabled"
            try:
                label = self.session.click(metadata)
                return f"browser click matched {label}"
            except Exception:
                if any(key in metadata for key in ("x", "y", "x_ratio", "y_ratio")):
                    label = self.session.click_point(metadata)
                    return f"browser point click matched {label}"
                raise

        if step.action == ActionType.TYPE:
            if not step.value:
                raise ValueError("browser type requires value")
            try:
                self.session.type(metadata, step.value)
                return "typed into browser field"
            except Exception:
                if any(key in metadata for key in ("x", "y", "x_ratio", "y_ratio")):
                    self.session.type_via_active_element(metadata, step.value)
                    return "typed via active browser element"
                raise

        if step.action == ActionType.HOTKEY:
            confirmation_alias = str(metadata.get("confirmation_alias") or "").strip()
            if confirmation_alias and not self.browser_config.confirmed_actions.get(
                confirmation_alias, False
            ):
                return f"hotkey skipped until confirmation alias '{confirmation_alias}' is enabled"
            resolved_hotkey = _resolve_browser_hotkey_value(
                step, metadata, self.browser_config
            )
            if resolved_hotkey is None:
                return "hotkey skipped because it is unconfigured"
            hotkey = str(resolved_hotkey or metadata.get("hotkey") or "").strip()
            if not hotkey:
                raise ValueError("browser hotkey requires value")
            self.session.send_hotkey(hotkey, metadata)
            return f"sent browser hotkey {hotkey}"

        if step.action == ActionType.WAIT:
            seconds = float(metadata.get("seconds", step.value or 1))
            time.sleep(seconds)
            return f"waited {seconds:.2f}s"

        if step.action == ActionType.SCROLL:
            amount = int(metadata.get("amount", step.value or 0))
            if amount == 0:
                raise ValueError("browser scroll requires non-zero amount")
            self.session.driver.execute_script("window.scrollBy(0, arguments[0]);", amount)
            return f"scrolled {amount}px"

        raise ValueError(f"Unsupported browser action: {step.action.value}")
