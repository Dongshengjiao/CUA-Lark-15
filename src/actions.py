from __future__ import annotations

"""Base GUI action primitives and a chainable builder.

Actions are simple dataclasses — the Execution Layer consumes them and dispatches
to PyAutoGUI (or a Hybrid-Locator path). Keeping them as data (not function calls)
means plans can be serialized, recorded, replayed, and mutated by the Self-Healing
and Recorder bonus modules.
"""

from dataclasses import dataclass, field
from typing import Literal


ActionKind = Literal[
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
]


@dataclass
class Action:
    kind: ActionKind
    target_hint: str | None = None
    x: int | None = None
    y: int | None = None
    text: str | None = None
    keys: list[str] = field(default_factory=list)
    to_x: int | None = None
    to_y: int | None = None
    scroll_amount: int | None = None
    seconds: float | None = None
    rationale: str | None = None


class Chain:
    """Fluent builder for action sequences.

    Example:
        plan = (
            Chain()
            .locate("the Search box at the top of the IM list")
            .click()
            .type("Test Group")
            .key("enter")
            .wait(0.5)
            .build()
        )
    """

    def __init__(self) -> None:
        self._actions: list[Action] = []

    def locate(self, target_hint: str) -> "Chain":
        self._actions.append(Action(kind="locate", target_hint=target_hint))
        return self

    def click(self, target_hint: str | None = None) -> "Chain":
        self._actions.append(Action(kind="click", target_hint=target_hint))
        return self

    def double_click(self, target_hint: str | None = None) -> "Chain":
        self._actions.append(Action(kind="double_click", target_hint=target_hint))
        return self

    def right_click(self, target_hint: str | None = None) -> "Chain":
        self._actions.append(Action(kind="right_click", target_hint=target_hint))
        return self

    def type(self, text: str) -> "Chain":
        self._actions.append(Action(kind="type", text=text))
        return self

    def key(self, key: str) -> "Chain":
        self._actions.append(Action(kind="key", keys=[key]))
        return self

    def hotkey(self, *keys: str) -> "Chain":
        self._actions.append(Action(kind="hotkey", keys=list(keys)))
        return self

    def drag(self, target_hint: str) -> "Chain":
        self._actions.append(Action(kind="drag", target_hint=target_hint))
        return self

    def scroll(self, amount: int, target_hint: str | None = None) -> "Chain":
        self._actions.append(Action(kind="scroll", scroll_amount=amount, target_hint=target_hint))
        return self

    def wait(self, seconds: float) -> "Chain":
        self._actions.append(Action(kind="wait", seconds=seconds))
        return self

    def screenshot(self) -> "Chain":
        self._actions.append(Action(kind="screenshot"))
        return self

    def build(self) -> list[Action]:
        return list(self._actions)
