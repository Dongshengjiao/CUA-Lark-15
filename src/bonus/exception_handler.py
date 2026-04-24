from __future__ import annotations

"""Bonus #1: Exception handling — auto-dismiss pop-ups and timeout guards.

Maintained list of known Lark modal signatures ("Update available", "Network
reconnecting...", permission prompts, etc.). Before each planned action the
framework invokes `scan_and_dismiss`; on timeout the framework restarts the
current step with a fresh plan.
"""

from pathlib import Path


def scan_and_dismiss(screenshot_path: Path, *, model: str) -> dict:
    raise NotImplementedError("Bonus #1 — implemented after MVP")
