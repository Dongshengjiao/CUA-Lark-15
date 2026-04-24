from __future__ import annotations

"""Windows UIAutomation helper — used by the Hybrid Locators bonus feature.

The Visual Layer asks the VLM for element coordinates; this module lets the
framework cross-check the answer against the OS accessibility tree (pywinauto).
If the VLM and the a11y tree agree on a region, confidence is high; if they
disagree, Self-Healing can fall back to the accessibility-tree coordinate.

Stub — implemented during bonus work, not required for MVP.
"""

from typing import Any


def find_window(title_regex: str) -> Any:
    raise NotImplementedError("Hybrid Locators bonus — implemented later")


def find_element_by_name(window: Any, name: str) -> Any:
    raise NotImplementedError("Hybrid Locators bonus — implemented later")


def rect_center(element: Any) -> tuple[int, int]:
    raise NotImplementedError("Hybrid Locators bonus — implemented later")
