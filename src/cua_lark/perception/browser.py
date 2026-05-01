from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from cua_lark.browser import get_browser_session
from cua_lark.config import BrowserConfig
from cua_lark.models import Observation
from cua_lark.perception.base import PerceptionAdapter


class BrowserPerceptionAdapter(PerceptionAdapter):
    def __init__(self, artifacts_dir: Path, browser_config: BrowserConfig | None = None) -> None:
        self.artifacts_dir = artifacts_dir
        self.browser_config = browser_config or BrowserConfig()
        self.session = get_browser_session(self.browser_config)

    def capture(self) -> Observation:
        timestamp = datetime.now(timezone.utc)
        filename = timestamp.strftime("browser-%Y%m%d-%H%M%S-%f.png")
        screenshot_path = self.session.screenshot(self.artifacts_dir / "screenshots" / filename)
        metadata = {"screenshot_path": str(screenshot_path)}
        metadata.update(self.session.current_metadata())
        return Observation(
            source="browser_selenium",
            summary="Captured browser screenshot from Selenium session",
            metadata=metadata,
        )
