from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    anthropic_api_key: str
    model: str
    max_steps: int
    verify_mode: str
    require_confirm: bool
    report_dir: Path
    screenshot_dir: Path


def load_config(env_file: Path | None = None) -> Config:
    root = Path(__file__).resolve().parent.parent
    if env_file is None:
        env_file = root / ".env"
    load_dotenv(env_file, override=False)

    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY missing. Copy .env.example to .env and fill it in.")

    report_dir = (root / os.getenv("CUA_REPORT_DIR", "reports")).resolve()
    screenshot_dir = (root / os.getenv("CUA_SCREENSHOT_DIR", "reports/screenshots")).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    return Config(
        anthropic_api_key=key,
        model=os.getenv("CUA_MODEL", "claude-opus-4-7"),
        max_steps=int(os.getenv("CUA_MAX_STEPS", "30")),
        verify_mode=os.getenv("CUA_VERIFY_MODE", "vlm").lower(),
        require_confirm=os.getenv("CUA_REQUIRE_CONFIRM", "true").lower() == "true",
        report_dir=report_dir,
        screenshot_dir=screenshot_dir,
    )
