from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from cua_lark.macos import (
    activate_application_candidates,
    capture_screenshot,
    get_window_bounds_candidates,
    is_accessibility_trusted,
)


@dataclass
class MacOSPreflight:
    ready: bool
    summary: str
    details: list[str]


def run_macos_preflight(
    app_name: str = "飞书",
    artifacts_dir: Path | None = None,
    app_names: list[str] | None = None,
) -> MacOSPreflight:
    details: list[str] = []
    ready = True
    candidates = app_names or [app_name, "Lark", "com.bytedance.macos.feishu"]

    accessibility = is_accessibility_trusted()
    details.append(f"Accessibility trusted: {accessibility}")
    if not accessibility:
        ready = False

    try:
        activated = activate_application_candidates(candidates)
        details.append(f"Activated app candidate: {activated}")
    except Exception as exc:
        details.append(f"App activation fallback failed: {exc}")

    try:
        resolved_name, bounds = get_window_bounds_candidates(candidates)
        details.append(
            f"Window bounds for {resolved_name}: x={bounds['x']} y={bounds['y']} w={bounds['width']} h={bounds['height']}"
        )
    except Exception as exc:
        ready = False
        details.append(f"Window lookup failed for {candidates}: {exc}")

    if artifacts_dir is not None:
        try:
            screenshot_path = capture_screenshot(artifacts_dir / "screenshots" / "preflight-check.png")
            details.append(f"Screen Recording OK: {screenshot_path}")
        except Exception as exc:
            ready = False
            details.append(f"Screen Recording check failed: {exc}")

    summary = "macOS desktop automation is ready" if ready else "macOS desktop automation is not ready"
    return MacOSPreflight(ready=ready, summary=summary, details=details)
