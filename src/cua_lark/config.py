from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field


class ClaudeEnvConfig(BaseModel):
    anthropic_base_url: str | None = Field(default=None, alias="ANTHROPIC_BASE_URL")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    anthropic_default_opus_model: str | None = Field(
        default=None, alias="ANTHROPIC_DEFAULT_OPUS_MODEL"
    )
    disable_experimental_betas: str | None = Field(
        default=None, alias="CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"
    )


class ClaudeSettings(BaseModel):
    env: ClaudeEnvConfig = Field(default_factory=ClaudeEnvConfig)
    model: str | None = None
    desktop: "DesktopConfig" = Field(default_factory=lambda: DesktopConfig())
    browser: "BrowserConfig" = Field(default_factory=lambda: BrowserConfig())


class DesktopStepOverride(BaseModel):
    x: float | None = None
    y: float | None = None
    x_ratio: float | None = None
    y_ratio: float | None = None
    x_offset: float | None = None
    y_offset: float | None = None
    accessibility_labels: list[str] = Field(default_factory=list)
    app_names: list[str] = Field(default_factory=list)


class DesktopConfig(BaseModel):
    hotkeys: dict[str, str] = Field(
        default_factory=lambda: {
            "select_all": "cmd+a",
            "close_window": "cmd+w",
            "dismiss_modal": "escape",
            "send_message": "return",
        }
    )
    confirmed_actions: dict[str, bool] = Field(
        default_factory=lambda: {
            "send_message": False,
            "save_calendar_event": False,
        }
    )
    step_overrides: dict[str, DesktopStepOverride] = Field(default_factory=dict)


class BrowserStepOverride(BaseModel):
    selector: str | None = None
    selector_type: str | None = None
    url: str | None = None


class BrowserConfig(BaseModel):
    browser_name: str = "chrome"
    start_url: str = "https://feishu.feishu.cn/"
    headless: bool = False
    binary_location: str | None = None
    user_data_dir: str | None = None
    profile_directory: str | None = None
    persistent_user_data_dir: str | None = None
    bootstrap_user_data_dir: str | None = None
    bootstrap_profile_directory: str | None = None
    clone_user_data_dir: bool = True
    implicit_wait_seconds: float = 3.0
    page_load_timeout_seconds: float = 30.0
    debugger_address: str | None = None
    remote_debugging_port: int | None = None
    detach: bool = False
    hotkeys: dict[str, str] = Field(
        default_factory=lambda: {
            "select_all": "cmd+a",
            "dismiss_modal": "escape",
            "send_message": "return",
        }
    )
    confirmed_actions: dict[str, bool] = Field(
        default_factory=lambda: {
            "send_message": False,
            "save_calendar_event": False,
        }
    )
    step_overrides: dict[str, BrowserStepOverride] = Field(default_factory=dict)


def load_claude_settings(root: Path) -> ClaudeSettings:
    settings_path = root / ".claude" / "settings.json"
    if not settings_path.exists():
        return ClaudeSettings()

    payload = json.loads(settings_path.read_text(encoding="utf-8"))
    return ClaudeSettings.model_validate(payload)
