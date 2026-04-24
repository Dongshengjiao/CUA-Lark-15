from __future__ import annotations

"""Layer 2: Planning Layer — NL task → ordered step plan via LLM Chain-of-Thought.

The LLM is asked to respond with a strict JSON plan of Action records so the
Execution Layer can run them directly without further parsing.
"""

import base64
import json
import re
from pathlib import Path

import anthropic

from src.actions import Action

_ALLOWED_KINDS = {
    "click",
    "double_click",
    "right_click",
    "type",
    "key",
    "hotkey",
    "drag",
    "scroll",
    "move",
    "screenshot",
    "wait",
    "locate",
}

_SYSTEM = """You are a GUI test-automation planner for the Lark (Feishu) desktop app.
Given a natural-language goal and a screenshot of the current Lark state, produce
an ordered plan as a JSON object of EXACTLY this shape:

{
  "steps": [
    {
      "kind": "click"|"double_click"|"right_click"|"type"|"key"|"hotkey"|"drag"|"scroll"|"wait"|"screenshot",
      "target_hint": string | null,
      "text": string | null,
      "keys": [string, ...] | null,
      "scroll_amount": int | null,
      "seconds": number | null,
      "rationale": string
    }
  ],
  "expected_end_state": string
}

Rules:
- Keep plans SHORT and LITERAL. Each step is a single user action.
- Use target_hint for click/drag/scroll to describe the element visually
  (e.g. "the Search box at the top of the IM sidebar").
- For text entry: one click on the input, then one type step.
- To press Enter to send: a separate key step with keys: ["enter"].
- Use wait sparingly — only after actions that need UI to settle (0.5-1.5s).
- expected_end_state: a short natural-language description of what the SCREEN
  should show once the whole plan has run (for the Verification Layer).
- Respond with ONLY the JSON object. No prose, no code fences, no trailing text.
"""


def _encode_png(path: Path) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _to_action(step: dict) -> Action:
    kind = step.get("kind", "")
    if kind not in _ALLOWED_KINDS:
        raise ValueError(f"planner returned unknown action kind: {kind!r}")
    return Action(
        kind=kind,  # type: ignore[arg-type]
        target_hint=step.get("target_hint"),
        text=step.get("text"),
        keys=list(step.get("keys") or []),
        scroll_amount=step.get("scroll_amount"),
        seconds=step.get("seconds"),
        rationale=step.get("rationale"),
    )


def plan(goal: str, screenshot_path: Path, *, model: str) -> tuple[list[Action], str]:
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=model,
        max_tokens=2500,
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
                    {"type": "text", "text": f"Goal: {goal}"},
                ],
            }
        ],
    )
    raw = resp.content[0].text if resp.content else ""
    text = _strip_fences(raw)
    data = json.loads(text)
    actions = [_to_action(s) for s in data.get("steps", [])]
    expected = str(data.get("expected_end_state", "")).strip()
    return actions, expected


def replan(
    goal: str, executed: list[Action], failure_reason: str, screenshot_path: Path, *, model: str
) -> list[Action]:
    raise NotImplementedError("Replan is Bonus #6 — implemented later")
