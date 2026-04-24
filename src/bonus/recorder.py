from __future__ import annotations

"""Bonus #7: Record & Playback — capture manual actions into a reusable plan.

`start_recording` installs OS-level mouse/keyboard hooks; each event is
translated into an Action and appended to a plan file. `playback` replays a
saved plan through the Execution Layer.
"""

from pathlib import Path


def start_recording(output: Path) -> None:
    raise NotImplementedError("Bonus #7 — implemented later")


def playback(plan_file: Path) -> None:
    raise NotImplementedError("Bonus #7 — implemented later")
