from __future__ import annotations

import ctypes
import subprocess
import time
from ctypes import c_bool, c_double, c_int32, c_uint16, c_uint32, c_void_p
from pathlib import Path


class CGPoint(ctypes.Structure):
    _fields_ = [("x", c_double), ("y", c_double)]


_APPLICATION_SERVICES = ctypes.CDLL(
    "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
)

_kCGHIDEventTap = 0

_kCGEventMouseMoved = 5
_kCGEventLeftMouseDown = 1
_kCGEventLeftMouseUp = 2
_kCGEventRightMouseDown = 3
_kCGEventRightMouseUp = 4
_kCGEventLeftMouseDragged = 6
_kCGEventRightMouseDragged = 7

_kCGMouseButtonLeft = 0
_kCGMouseButtonRight = 1

_kCGScrollEventUnitLine = 1

_CGEventCreateMouseEvent = _APPLICATION_SERVICES.CGEventCreateMouseEvent
_CGEventCreateMouseEvent.restype = c_void_p
_CGEventCreateMouseEvent.argtypes = [c_void_p, c_uint32, CGPoint, c_uint32]

_CGEventCreateScrollWheelEvent = _APPLICATION_SERVICES.CGEventCreateScrollWheelEvent
_CGEventCreateScrollWheelEvent.restype = c_void_p
_CGEventCreateScrollWheelEvent.argtypes = [c_void_p, c_uint32, c_uint32, c_int32]

_CGEventPost = _APPLICATION_SERVICES.CGEventPost
_CGEventPost.argtypes = [c_uint32, c_void_p]

_CFRelease = _APPLICATION_SERVICES.CFRelease
_CFRelease.argtypes = [c_void_p]

_AXIsProcessTrusted = _APPLICATION_SERVICES.AXIsProcessTrusted
_AXIsProcessTrusted.restype = c_bool
_AXIsProcessTrusted.argtypes = []


def _post_mouse_event(event_type: int, x: float, y: float, button: int) -> None:
    event = _CGEventCreateMouseEvent(None, event_type, CGPoint(x, y), button)
    if not event:
        raise RuntimeError("Failed to create macOS mouse event")
    try:
        _CGEventPost(_kCGHIDEventTap, event)
    finally:
        _CFRelease(event)


def click(x: float, y: float, button: str = "left", click_count: int = 1) -> None:
    if button == "left":
        down_event = _kCGEventLeftMouseDown
        up_event = _kCGEventLeftMouseUp
        button_code = _kCGMouseButtonLeft
    else:
        down_event = _kCGEventRightMouseDown
        up_event = _kCGEventRightMouseUp
        button_code = _kCGMouseButtonRight

    for _ in range(click_count):
        _post_mouse_event(_kCGEventMouseMoved, x, y, button_code)
        _post_mouse_event(down_event, x, y, button_code)
        _post_mouse_event(up_event, x, y, button_code)
        time.sleep(0.05)


def click_element_by_label(app_name: str, label: str, hint: str | None = None) -> str:
    escaped_label = label.replace("\\", "\\\\").replace('"', '\\"')
    hint = (hint or "").strip().lower()
    hint_clause = ""
    if hint == "sidebar":
        hint_clause = """
                set windowPosition to position of front window
                set windowSize to size of front window
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                set eSize to size of e
                set eWidth to item 1 of eSize
                set eHeight to item 2 of eSize
                if eX > (winX + 92) then error "Button outside sidebar hint"
                if eY < (winY + 120) then error "Button outside sidebar hint"
                if eWidth > 96 then error "Button outside sidebar hint"
                if eHeight > 96 then error "Button outside sidebar hint"
"""
    elif hint == "product_rail":
        hint_clause = """
                set windowPosition to position of front window
                set windowSize to size of front window
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set winHeight to item 2 of windowSize
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                set eSize to size of e
                set eWidth to item 1 of eSize
                set eHeight to item 2 of eSize
                if eX < (winX + 8) then error "Button outside product rail hint"
                if eX > (winX + 72) then error "Button outside product rail hint"
                if eY < (winY + 120) then error "Button outside product rail hint"
                if eY > (winY + winHeight - 120) then error "Button outside product rail hint"
                if eWidth > 64 then error "Button outside product rail hint"
                if eHeight > 72 then error "Button outside product rail hint"
"""
    elif hint == "top_right":
        hint_clause = """
                set windowPosition to position of front window
                set windowSize to size of front window
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set winWidth to item 1 of windowSize
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                if eX < (winX + (winWidth * 0.72)) then error "Button outside top-right hint"
                if eY > (winY + 120) then error "Button outside top-right hint"
"""
    script = f'''
tell application "System Events"
    tell process "{app_name}"
        if (count of windows) is 0 then error "No windows for application"
        set buttonElems to every button of front window
        repeat with e in buttonElems
            try
                set elementName to (name of e) as string
                if elementName is "{escaped_label}" then
{hint_clause}
                    try
                        perform action "AXPress" of e
                    on error
                        click e
                    end try
                    return elementName
                end if
            end try
        end repeat
        repeat with e in buttonElems
            try
                set elementName to (name of e) as string
                if elementName contains "{escaped_label}" then
{hint_clause}
                    try
                        perform action "AXPress" of e
                    on error
                        click e
                    end try
                    return elementName
                end if
            end try
        end repeat
        set uiElems to entire contents of front window
        repeat with e in uiElems
            try
                if class of e is button then
                    set elementName to (name of e) as string
                    if elementName is "{escaped_label}" then
{hint_clause}
                        try
                            perform action "AXPress" of e
                        on error
                            click e
                        end try
                        return elementName
                    end if
                end if
            end try
        end repeat
        repeat with e in uiElems
            try
                if class of e is button then
                    set elementName to (name of e) as string
                    if elementName contains "{escaped_label}" then
{hint_clause}
                        try
                            perform action "AXPress" of e
                        on error
                            click e
                        end try
                        return elementName
                    end if
                end if
            end try
        end repeat
        if "{hint}" is not "product_rail" then
            repeat with e in uiElems
                try
                    set elementName to (name of e) as string
                    if elementName is "{escaped_label}" then
                        try
                            perform action "AXPress" of e
                        on error
                            click e
                        end try
                        return elementName
                    end if
                end try
            end repeat
            repeat with e in uiElems
                try
                    set elementName to (name of e) as string
                    if elementName contains "{escaped_label}" then
                        try
                            perform action "AXPress" of e
                        on error
                            click e
                        end try
                        return elementName
                    end if
                end try
            end repeat
        end if
        error "No UI element matching label"
    end tell
end tell
'''
    return run_applescript(script)


def click_frontmost_element_by_label(label: str, hint: str | None = None) -> tuple[str, str]:
    escaped_label = label.replace("\\", "\\\\").replace('"', '\\"')
    hint = (hint or "").strip().lower()
    hint_clause = ""
    if hint == "sidebar":
        hint_clause = """
                set windowPosition to position of front window of frontProcess
                set windowSize to size of front window of frontProcess
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                set eSize to size of e
                set eWidth to item 1 of eSize
                set eHeight to item 2 of eSize
                if eX > (winX + 92) then error "Button outside sidebar hint"
                if eY < (winY + 120) then error "Button outside sidebar hint"
                if eWidth > 96 then error "Button outside sidebar hint"
                if eHeight > 96 then error "Button outside sidebar hint"
"""
    elif hint == "product_rail":
        hint_clause = """
                set windowPosition to position of front window of frontProcess
                set windowSize to size of front window of frontProcess
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set winHeight to item 2 of windowSize
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                set eSize to size of e
                set eWidth to item 1 of eSize
                set eHeight to item 2 of eSize
                if eX < (winX + 8) then error "Button outside product rail hint"
                if eX > (winX + 72) then error "Button outside product rail hint"
                if eY < (winY + 120) then error "Button outside product rail hint"
                if eY > (winY + winHeight - 120) then error "Button outside product rail hint"
                if eWidth > 64 then error "Button outside product rail hint"
                if eHeight > 72 then error "Button outside product rail hint"
"""
    elif hint == "top_right":
        hint_clause = """
                set windowPosition to position of front window of frontProcess
                set windowSize to size of front window of frontProcess
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set winWidth to item 1 of windowSize
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                if eX < (winX + (winWidth * 0.72)) then error "Button outside top-right hint"
                if eY > (winY + 120) then error "Button outside top-right hint"
"""
    script = f'''
tell application "System Events"
    set frontProcess to first application process whose frontmost is true
    if (count of windows of frontProcess) is 0 then error "No windows for frontmost application"
    set processName to name of frontProcess
    set buttonElems to every button of front window of frontProcess
    repeat with e in buttonElems
        try
            set elementName to (name of e) as string
            if elementName is "{escaped_label}" then
{hint_clause}
                try
                    perform action "AXPress" of e
                on error
                    click e
                end try
                return processName & "," & elementName
            end if
        end try
    end repeat
    repeat with e in buttonElems
        try
            set elementName to (name of e) as string
            if elementName contains "{escaped_label}" then
{hint_clause}
                try
                    perform action "AXPress" of e
                on error
                    click e
                end try
                return processName & "," & elementName
            end if
        end try
    end repeat
    set uiElems to entire contents of front window of frontProcess
    repeat with e in uiElems
        try
            if class of e is button then
                set elementName to (name of e) as string
                if elementName is "{escaped_label}" then
{hint_clause}
                    try
                        perform action "AXPress" of e
                    on error
                        click e
                    end try
                    return processName & "," & elementName
                end if
            end if
        end try
    end repeat
    repeat with e in uiElems
        try
            if class of e is button then
                set elementName to (name of e) as string
                if elementName contains "{escaped_label}" then
{hint_clause}
                    try
                        perform action "AXPress" of e
                    on error
                        click e
                    end try
                    return processName & "," & elementName
                end if
            end if
        end try
    end repeat
    if "{hint}" is not "product_rail" then
        repeat with e in uiElems
            try
                set elementName to (name of e) as string
                if elementName is "{escaped_label}" then
                    try
                        perform action "AXPress" of e
                    on error
                        click e
                    end try
                    return processName & "," & elementName
                end if
            end try
        end repeat
        repeat with e in uiElems
            try
                set elementName to (name of e) as string
                if elementName contains "{escaped_label}" then
                    try
                        perform action "AXPress" of e
                    on error
                        click e
                    end try
                    return processName & "," & elementName
                end if
            end try
        end repeat
    end if
    error "No UI element matching label in frontmost window"
end tell
'''
    raw = run_applescript(script)
    process_name, matched_name = raw.split(",", 1)
    return process_name, matched_name


def click_element_by_label_candidates(
    app_names: list[str], labels: list[str], hint: str | None = None
) -> tuple[str, str]:
    last_error: Exception | None = None
    try:
        activate_application_candidates(app_names)
        time.sleep(0.2)
    except Exception as exc:
        last_error = exc
    for app_name in app_names:
        for label in labels:
            try:
                matched_name = click_element_by_label(app_name, label, hint=hint)
                return app_name, matched_name
            except Exception as exc:
                last_error = exc
    for label in labels:
        try:
            return click_frontmost_element_by_label(label, hint=hint)
        except Exception as exc:
            last_error = exc
    raise RuntimeError(
        f"Could not click any UI element with labels {labels} for app candidates: {app_names}"
    ) from last_error


def has_element_by_label(app_name: str, label: str, hint: str | None = None) -> bool:
    escaped_label = label.replace("\\", "\\\\").replace('"', '\\"')
    hint = (hint or "").strip().lower()
    hint_clause = ""
    if hint == "sidebar":
        hint_clause = """
                set windowPosition to position of front window
                set windowSize to size of front window
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                set eSize to size of e
                set eWidth to item 1 of eSize
                set eHeight to item 2 of eSize
                if eX > (winX + 92) then error "Button outside sidebar hint"
                if eY < (winY + 120) then error "Button outside sidebar hint"
                if eWidth > 96 then error "Button outside sidebar hint"
                if eHeight > 96 then error "Button outside sidebar hint"
"""
    elif hint == "product_rail":
        hint_clause = """
                set windowPosition to position of front window
                set windowSize to size of front window
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set winHeight to item 2 of windowSize
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                set eSize to size of e
                set eWidth to item 1 of eSize
                set eHeight to item 2 of eSize
                if eX < (winX + 8) then error "Button outside product rail hint"
                if eX > (winX + 72) then error "Button outside product rail hint"
                if eY < (winY + 120) then error "Button outside product rail hint"
                if eY > (winY + winHeight - 120) then error "Button outside product rail hint"
                if eWidth > 64 then error "Button outside product rail hint"
                if eHeight > 72 then error "Button outside product rail hint"
"""
    elif hint == "top_right":
        hint_clause = """
                set windowPosition to position of front window
                set windowSize to size of front window
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set winWidth to item 1 of windowSize
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                if eX < (winX + (winWidth * 0.72)) then error "Button outside top-right hint"
                if eY > (winY + 120) then error "Button outside top-right hint"
"""
    script = f'''
tell application "System Events"
    tell process "{app_name}"
        if (count of windows) is 0 then return "false"
        set buttonElems to every button of front window
        repeat with e in buttonElems
            try
                set elementName to (name of e) as string
                if elementName is "{escaped_label}" then
{hint_clause}
                    return "true"
                end if
            end try
        end repeat
        repeat with e in buttonElems
            try
                set elementName to (name of e) as string
                if elementName contains "{escaped_label}" then
{hint_clause}
                    return "true"
                end if
            end try
        end repeat
        set uiElems to entire contents of front window
        repeat with e in uiElems
            try
                if class of e is button then
                    set elementName to (name of e) as string
                    if elementName is "{escaped_label}" then
{hint_clause}
                        return "true"
                    end if
                end if
            end try
        end repeat
        repeat with e in uiElems
            try
                if class of e is button then
                    set elementName to (name of e) as string
                    if elementName contains "{escaped_label}" then
{hint_clause}
                        return "true"
                    end if
                end if
            end try
        end repeat
        if "{hint}" is not "product_rail" then
            repeat with e in uiElems
                try
                    set elementName to (name of e) as string
                    if elementName is "{escaped_label}" then return "true"
                end try
            end repeat
            repeat with e in uiElems
                try
                    set elementName to (name of e) as string
                    if elementName contains "{escaped_label}" then return "true"
                end try
            end repeat
        end if
        return "false"
    end tell
end tell
'''
    return run_applescript(script).strip().lower() == "true"


def has_frontmost_element_by_label(label: str, hint: str | None = None) -> bool:
    escaped_label = label.replace("\\", "\\\\").replace('"', '\\"')
    hint = (hint or "").strip().lower()
    hint_clause = ""
    if hint == "sidebar":
        hint_clause = """
                set windowPosition to position of front window of frontProcess
                set windowSize to size of front window of frontProcess
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                set eSize to size of e
                set eWidth to item 1 of eSize
                set eHeight to item 2 of eSize
                if eX > (winX + 92) then error "Button outside sidebar hint"
                if eY < (winY + 120) then error "Button outside sidebar hint"
                if eWidth > 96 then error "Button outside sidebar hint"
                if eHeight > 96 then error "Button outside sidebar hint"
"""
    elif hint == "product_rail":
        hint_clause = """
                set windowPosition to position of front window of frontProcess
                set windowSize to size of front window of frontProcess
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set winHeight to item 2 of windowSize
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                set eSize to size of e
                set eWidth to item 1 of eSize
                set eHeight to item 2 of eSize
                if eX < (winX + 8) then error "Button outside product rail hint"
                if eX > (winX + 72) then error "Button outside product rail hint"
                if eY < (winY + 120) then error "Button outside product rail hint"
                if eY > (winY + winHeight - 120) then error "Button outside product rail hint"
                if eWidth > 64 then error "Button outside product rail hint"
                if eHeight > 72 then error "Button outside product rail hint"
"""
    elif hint == "top_right":
        hint_clause = """
                set windowPosition to position of front window of frontProcess
                set windowSize to size of front window of frontProcess
                set winX to item 1 of windowPosition
                set winY to item 2 of windowPosition
                set winWidth to item 1 of windowSize
                set ePos to position of e
                set eX to item 1 of ePos
                set eY to item 2 of ePos
                if eX < (winX + (winWidth * 0.72)) then error "Button outside top-right hint"
                if eY > (winY + 120) then error "Button outside top-right hint"
"""
    script = f'''
tell application "System Events"
    set frontProcess to first application process whose frontmost is true
    if (count of windows of frontProcess) is 0 then return "false"
    set buttonElems to every button of front window of frontProcess
    repeat with e in buttonElems
        try
            set elementName to (name of e) as string
            if elementName is "{escaped_label}" then
{hint_clause}
                return "true"
            end if
        end try
    end repeat
    repeat with e in buttonElems
        try
            set elementName to (name of e) as string
            if elementName contains "{escaped_label}" then
{hint_clause}
                return "true"
            end if
        end try
    end repeat
    set uiElems to entire contents of front window of frontProcess
    repeat with e in uiElems
        try
            if class of e is button then
                set elementName to (name of e) as string
                if elementName is "{escaped_label}" then
{hint_clause}
                    return "true"
                end if
            end if
        end try
    end repeat
    repeat with e in uiElems
        try
            if class of e is button then
                set elementName to (name of e) as string
                if elementName contains "{escaped_label}" then
{hint_clause}
                    return "true"
                end if
            end if
        end try
    end repeat
    if "{hint}" is not "product_rail" then
        repeat with e in uiElems
            try
                set elementName to (name of e) as string
                if elementName is "{escaped_label}" then return "true"
            end try
        end repeat
        repeat with e in uiElems
            try
                set elementName to (name of e) as string
                if elementName contains "{escaped_label}" then return "true"
            end try
        end repeat
    end if
    return "false"
end tell
'''
    return run_applescript(script).strip().lower() == "true"


def element_exists_by_label_candidates(
    app_names: list[str], labels: list[str], hint: str | None = None
) -> tuple[bool, str | None]:
    last_error: Exception | None = None
    for app_name in app_names:
        for label in labels:
            try:
                if has_element_by_label(app_name, label, hint=hint):
                    return True, label
            except Exception as exc:
                last_error = exc
    for label in labels:
        try:
            if has_frontmost_element_by_label(label, hint=hint):
                return True, label
        except Exception as exc:
            last_error = exc
    if last_error is not None:
        return False, None
    return False, None


def drag(from_x: float, from_y: float, to_x: float, to_y: float) -> None:
    _post_mouse_event(_kCGEventMouseMoved, from_x, from_y, _kCGMouseButtonLeft)
    _post_mouse_event(_kCGEventLeftMouseDown, from_x, from_y, _kCGMouseButtonLeft)
    _post_mouse_event(_kCGEventLeftMouseDragged, to_x, to_y, _kCGMouseButtonLeft)
    _post_mouse_event(_kCGEventLeftMouseUp, to_x, to_y, _kCGMouseButtonLeft)


def scroll(lines: int) -> None:
    event = _CGEventCreateScrollWheelEvent(None, _kCGScrollEventUnitLine, 1, int(lines))
    if not event:
        raise RuntimeError("Failed to create macOS scroll event")
    try:
        _CGEventPost(_kCGHIDEventTap, event)
    finally:
        _CFRelease(event)


def type_text(text: str) -> None:
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    script = f'tell application "System Events" to keystroke "{escaped}"'
    run_applescript(script)


def type_text_via_paste(text: str) -> None:
    result = subprocess.run(
        ["pbcopy"],
        input=text,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "pbcopy failed")
    press_hotkey("cmd+v")


def press_hotkey(value: str) -> None:
    tokens = [token.strip().lower() for token in value.split("+") if token.strip()]
    if not tokens:
        raise ValueError("Hotkey value cannot be empty")

    key = tokens[-1]
    modifiers = tokens[:-1]
    modifier_map = {
        "cmd": "command down",
        "command": "command down",
        "shift": "shift down",
        "option": "option down",
        "alt": "option down",
        "ctrl": "control down",
        "control": "control down",
    }
    special_key_codes = {
        "enter": 36,
        "return": 36,
        "tab": 48,
        "space": 49,
        "delete": 51,
        "escape": 53,
        "esc": 53,
        "up": 126,
        "down": 125,
        "left": 123,
        "right": 124,
    }

    using = ", ".join(modifier_map[item] for item in modifiers if item in modifier_map)
    using_clause = f" using {{{using}}}" if using else ""

    if key in special_key_codes:
        script = (
            f'tell application "System Events" to key code {special_key_codes[key]}'
            f"{using_clause}"
        )
    else:
        escaped = key.replace("\\", "\\\\").replace('"', '\\"')
        script = f'tell application "System Events" to keystroke "{escaped}"{using_clause}'

    run_applescript(script)


def activate_application(app_name: str) -> None:
    run_applescript(f'tell application "{app_name}" to activate')


def activate_application_candidates(app_names: list[str]) -> str:
    last_error: Exception | None = None
    for app_name in app_names:
        try:
            activate_application(app_name)
            return app_name
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Failed to activate any app candidate: {app_names}") from last_error


def is_accessibility_trusted() -> bool:
    try:
        return bool(_AXIsProcessTrusted())
    except Exception:
        return False


def get_window_bounds(app_name: str) -> dict[str, int]:
    script = f'''
tell application "System Events"
    tell process "{app_name}"
        if (count of windows) is 0 then error "No windows for application"
        set windowPosition to position of front window
        set windowSize to size of front window
        set xPos to item 1 of windowPosition
        set yPos to item 2 of windowPosition
        set winWidth to item 1 of windowSize
        set winHeight to item 2 of windowSize
        return (xPos as string) & "," & (yPos as string) & "," & (winWidth as string) & "," & (winHeight as string)
    end tell
end tell
'''
    raw = run_applescript(script)
    x_pos, y_pos, width, height = [int(float(item)) for item in raw.split(",")]
    return {"x": x_pos, "y": y_pos, "width": width, "height": height}


def get_front_window_title(app_name: str) -> str:
    script = f'''
tell application "System Events"
    tell process "{app_name}"
        if (count of windows) is 0 then error "No windows for application"
        return name of front window
    end tell
end tell
'''
    return run_applescript(script)


def get_frontmost_window_title() -> tuple[str, str]:
    script = '''
tell application "System Events"
    set frontProcess to first application process whose frontmost is true
    if (count of windows of frontProcess) is 0 then error "No windows for frontmost application"
    set processName to name of frontProcess
    set windowTitle to name of front window of frontProcess
    return processName & "," & windowTitle
end tell
'''
    raw = run_applescript(script)
    process_name, window_title = raw.split(",", 1)
    return process_name, window_title


def get_front_window_title_candidates(app_names: list[str]) -> tuple[str, str]:
    last_error: Exception | None = None
    for app_name in app_names:
        try:
            return app_name, get_front_window_title(app_name)
        except Exception as exc:
            last_error = exc
    try:
        return get_frontmost_window_title()
    except Exception as exc:
        raise RuntimeError(
            f"Could not resolve front window title for any app candidate: {app_names}"
        ) from exc if last_error is None else last_error


def close_front_window_if_title_matches(
    app_names: list[str], title_keywords: list[str], close_hotkey: str = "cmd+w"
) -> bool:
    try:
        _, title = get_front_window_title_candidates(app_names)
    except Exception:
        return False
    normalized_title = title.strip()
    if not normalized_title:
        return False

    for keyword in title_keywords:
        if keyword.strip() and keyword in normalized_title:
            press_hotkey(close_hotkey)
            return True

    return False


def get_window_bounds_candidates(app_names: list[str]) -> tuple[str, dict[str, int]]:
    last_error: Exception | None = None
    try:
        activate_application_candidates(app_names)
        time.sleep(0.2)
    except Exception as exc:
        last_error = exc
    for app_name in app_names:
        try:
            return app_name, get_window_bounds(app_name)
        except Exception as exc:
            last_error = exc
    try:
        process_name, bounds = get_frontmost_window_bounds()
        return process_name, bounds
    except Exception as exc:
        raise RuntimeError(f"No windows found for any app candidate: {app_names}") from exc


def get_frontmost_window_bounds() -> tuple[str, dict[str, int]]:
    script = '''
tell application "System Events"
    set frontProcess to first application process whose frontmost is true
    if (count of windows of frontProcess) is 0 then error "No windows for frontmost application"
    set processName to name of frontProcess
    set windowPosition to position of front window of frontProcess
    set windowSize to size of front window of frontProcess
    set xPos to item 1 of windowPosition
    set yPos to item 2 of windowPosition
    set winWidth to item 1 of windowSize
    set winHeight to item 2 of windowSize
    return processName & "," & (xPos as string) & "," & (yPos as string) & "," & (winWidth as string) & "," & (winHeight as string)
end tell
'''
    raw = run_applescript(script)
    process_name, x_pos, y_pos, width, height = raw.split(",", 4)
    return process_name, {
        "x": int(float(x_pos)),
        "y": int(float(y_pos)),
        "width": int(float(width)),
        "height": int(float(height)),
    }


def run_applescript(script: str, timeout_seconds: float = 4.0) -> str:
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"AppleScript command timed out after {timeout_seconds:.1f}s"
        ) from exc
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "AppleScript command failed")
    return result.stdout.strip()


def capture_screenshot(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["screencapture", "-x", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() or "screencapture failed"
        if "could not create image from display" in stderr.lower():
            raise RuntimeError(
                "Screenshot capture failed. Grant Screen Recording permission to the terminal "
                "or Python host process in macOS System Settings, then retry."
            )
        raise RuntimeError(stderr)
    return path


def resolve_point(metadata: dict[str, object], default_app_name: str = "飞书") -> tuple[float, float]:
    if "x" in metadata and "y" in metadata:
        return float(metadata["x"]), float(metadata["y"])

    rail_target = str(metadata.get("product_rail_target") or "").strip().lower()
    if rail_target:
        app_names = metadata.get("app_names")
        if isinstance(app_names, list) and app_names:
            candidates = [str(item) for item in app_names]
        else:
            candidates = [str(metadata.get("app_name") or default_app_name)]
        retries = int(metadata.get("resolve_retries", 1))
        delay_seconds = float(metadata.get("resolve_delay_seconds", 0.25))
        last_error: Exception | None = None
        for attempt in range(max(retries, 1)):
            try:
                _, bounds = get_window_bounds_candidates(candidates)
                break
            except Exception as exc:
                last_error = exc
                if attempt < max(retries, 1) - 1:
                    time.sleep(delay_seconds)
        else:
            raise RuntimeError(f"Failed to resolve window bounds for {candidates}: {last_error}") from last_error

        rail_map = {
            "messages": (0.031, 0.243),
            "calendar": (0.031, 0.365),
            "docs": (0.031, 0.421),
            "base": (0.031, 0.475),
            "vc": (0.031, 0.531),
            "workbench": (0.031, 0.584),
        }
        if rail_target not in rail_map:
            raise ValueError(f"unsupported product_rail_target: {rail_target}")
        x_ratio, y_ratio = rail_map[rail_target]
        x_offset = float(metadata.get("x_offset", 0) or 0)
        y_offset = float(metadata.get("y_offset", 0) or 0)
        return (
            bounds["x"] + bounds["width"] * x_ratio + x_offset,
            bounds["y"] + bounds["height"] * y_ratio + y_offset,
        )

    if "x_ratio" in metadata and "y_ratio" in metadata:
        app_names = metadata.get("app_names")
        if isinstance(app_names, list) and app_names:
            candidates = [str(item) for item in app_names]
        else:
            candidates = [str(metadata.get("app_name") or default_app_name)]
        retries = int(metadata.get("resolve_retries", 1))
        delay_seconds = float(metadata.get("resolve_delay_seconds", 0.25))
        last_error: Exception | None = None
        for attempt in range(max(retries, 1)):
            try:
                _, bounds = get_window_bounds_candidates(candidates)
                break
            except Exception as exc:
                last_error = exc
                if attempt < max(retries, 1) - 1:
                    time.sleep(delay_seconds)
        else:
            raise RuntimeError(f"Failed to resolve window bounds for {candidates}: {last_error}") from last_error
        x_ratio = float(metadata["x_ratio"])
        y_ratio = float(metadata["y_ratio"])
        x_offset = float(metadata.get("x_offset", 0) or 0)
        y_offset = float(metadata.get("y_offset", 0) or 0)
        return (
            bounds["x"] + bounds["width"] * x_ratio + x_offset,
            bounds["y"] + bounds["height"] * y_ratio + y_offset,
        )

    raise ValueError("click actions require metadata.x/y or metadata.x_ratio/y_ratio")
