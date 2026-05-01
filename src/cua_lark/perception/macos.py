from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from cua_lark.macos import capture_screenshot, get_front_window_title_candidates
from cua_lark.models import Observation
from cua_lark.perception.base import PerceptionAdapter


class MacOSScreenCaptureAdapter(PerceptionAdapter):
    def __init__(self, artifacts_dir: Path) -> None:
        self.artifacts_dir = artifacts_dir
        self.app_candidates = ["飞书", "Lark", "com.bytedance.macos.feishu"]

    def capture(self) -> Observation:
        timestamp = datetime.now(timezone.utc)
        filename = timestamp.strftime("screen-%Y%m%d-%H%M%S-%f.png")
        screenshot_path = capture_screenshot(self.artifacts_dir / "screenshots" / filename)
        metadata = {"screenshot_path": str(screenshot_path)}
        try:
            app_name, front_window_title = get_front_window_title_candidates(self.app_candidates)
            metadata["front_window_app"] = app_name
            metadata["front_window_title"] = front_window_title
        except Exception as exc:
            metadata["front_window_lookup_error"] = str(exc)
        return Observation(
            source="macos_screencapture",
            summary="Captured desktop screenshot from macOS",
            metadata=metadata,
        )
