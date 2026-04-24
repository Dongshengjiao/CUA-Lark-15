from __future__ import annotations

"""Layer 1: Visual Layer — VLM-backed UI element locator.

Uses Claude as the VLM: the screenshot is sent as an image + the element
description as text, and Claude returns centroid pixel coords in JSON.
"""

import base64
import json
import re
from dataclasses import dataclass
from pathlib import Path

import anthropic
import pyautogui


@dataclass
class Locate:
    x: int
    y: int
    box: tuple[int, int, int, int] | None
    confidence: float
    source: str


_SYSTEM = """You are a precise GUI element locator for the Lark desktop app.
Given a screenshot and a description of a UI element, respond with ONLY a JSON
object of this exact shape:

{"x": int, "y": int, "box": [x1, y1, x2, y2] | null, "confidence": 0.0-1.0}

Coordinates are in pixels from the top-left of the image. (x, y) is the CENTROID
of the target element. `box` is the tight bounding rect in the same coord system
(omit as null if unsure). If you cannot find the element with reasonable
confidence, return confidence: 0.0.

Do NOT wrap the JSON in code fences. Do NOT include any text before or after
the JSON object.
"""


def take_screenshot(save_to: Path) -> Path:
    save_to.parent.mkdir(parents=True, exist_ok=True)
    img = pyautogui.screenshot()
    img.save(str(save_to))
    return save_to


def _encode_png(path: Path) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def locate(screenshot_path: Path, description: str, *, model: str) -> Locate:
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=model,
        max_tokens=400,
        system=_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": _encode_png(screenshot_path),
                        },
                    },
                    {"type": "text", "text": f"Locate: {description}"},
                ],
            }
        ],
    )
    raw = resp.content[0].text if resp.content else ""
    text = _strip_fences(raw)
    data = json.loads(text)
    box = data.get("box")
    return Locate(
        x=int(data["x"]),
        y=int(data["y"]),
        box=tuple(int(v) for v in box) if box else None,
        confidence=float(data.get("confidence", 0.0)),
        source="vlm",
    )
