from __future__ import annotations

"""Bonus #3: Self-healing — retry failed actions via alternative locator paths.

When an Execution-Layer action fails verification, this module is invoked to
propose 2-3 alternative strategies (different VLM description, accessibility-
tree locator, keyboard shortcut) and attempt each until one verifies.
"""

from src.actions import Action


def alternatives(failed: Action, goal: str, *, model: str) -> list[Action]:
    raise NotImplementedError("Bonus #3 — implemented after MVP")
