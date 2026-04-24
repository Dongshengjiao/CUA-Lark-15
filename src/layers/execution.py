from __future__ import annotations

"""Layer 3: Execution Layer — PyAutoGUI action dispatcher.

Takes src.actions.Action values and performs the OS-level mouse/keyboard event.
Resolves positional hints by calling back into the provided locator (Layer 1).
"""

import time
from pathlib import Path
from typing import Callable

import pyautogui

from src.actions import Action

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05


Locator = Callable[[str], "object"]  # callable(description) -> Locate from visual layer


def screen_size() -> tuple[int, int]:
    size = pyautogui.size()
    return int(size.width), int(size.height)


def screenshot_to(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = pyautogui.screenshot()
    img.save(str(path))
    return path


def _coords(action: Action, locator: Locator) -> tuple[int, int] | None:
    if action.x is not None and action.y is not None:
        return action.x, action.y
    if action.target_hint:
        loc = locator(action.target_hint)
        return int(getattr(loc, "x")), int(getattr(loc, "y"))
    return None


def execute(action: Action, locator: Locator) -> dict:
    kind = action.kind

    if kind == "wait":
        time.sleep(float(action.seconds or 0.0))
        return {"ok": True}

    if kind == "screenshot":
        return {"ok": True}

    if kind == "type":
        pyautogui.write(action.text or "", interval=0.02)
        return {"ok": True}

    if kind == "key":
        for k in action.keys:
            pyautogui.press(k)
        return {"ok": True}

    if kind == "hotkey":
        if not action.keys:
            return {"ok": False, "error": "hotkey requires keys"}
        pyautogui.hotkey(*action.keys)
        return {"ok": True}

    if kind == "locate":
        if not action.target_hint:
            return {"ok": False, "error": "locate requires target_hint"}
        loc = locator(action.target_hint)
        return {"ok": True, "locate": loc}

    target = _coords(action, locator)
    if kind in ("click", "double_click", "right_click", "move", "drag"):
        if target is None:
            return {"ok": False, "error": f"{kind} has no target"}
        x, y = target
        if kind == "click":
            pyautogui.click(x, y)
        elif kind == "double_click":
            pyautogui.doubleClick(x, y)
        elif kind == "right_click":
            pyautogui.rightClick(x, y)
        elif kind == "move":
            pyautogui.moveTo(x, y)
        elif kind == "drag":
            pyautogui.dragTo(x, y, duration=0.5)
        return {"ok": True, "coords": [x, y]}

    if kind == "scroll":
        if target is not None:
            pyautogui.moveTo(*target)
        pyautogui.scroll(int(action.scroll_amount or 0))
        return {"ok": True}

    return {"ok": False, "error": f"unknown action kind: {kind}"}


def focus_lark_window() -> str | None:
    """Bring the Lark/Feishu desktop window to the foreground.

    Returns the matched window title on success, None otherwise.
    Handles minimized state and uses SetForegroundWindow as a fallback to
    defeat focus-stealing from the terminal.
    """
    try:
        from pywinauto import Desktop
    except ImportError:
        return None

    def _keyword_match(title: str) -> bool:
        t = title.lower()
        return "lark" in t or "feishu" in t or "飞书" in title

    try:
        candidates = []
        for w in Desktop(backend="uia").windows():
            try:
                title = w.window_text() or ""
            except Exception:
                continue
            if _keyword_match(title):
                candidates.append((title, w))

        if not candidates:
            return None

        candidates.sort(key=lambda tw: (len(tw[0]), tw[0].lower()))
        title, win = candidates[0]

        try:
            if win.is_minimized():
                win.restore()
        except Exception:
            pass
        try:
            win.set_focus()
        except Exception:
            pass

        try:
            import ctypes
            hwnd = win.handle
            if hwnd:
                ctypes.windll.user32.ShowWindow(hwnd, 9)
                ctypes.windll.user32.SetForegroundWindow(hwnd)
        except Exception:
            pass

        return title
    except Exception:
        return None
