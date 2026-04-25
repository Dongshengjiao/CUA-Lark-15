"""鼠标动作执行 —— 基于 PyAutoGUI。

注意：macOS 需要在 系统设置 → 隐私与安全性 → 辅助功能 中授予 终端 / Cursor / Python 权限。
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import pyautogui
from loguru import logger

# 故障保护：把鼠标移到屏幕角落可立刻终止
pyautogui.FAILSAFE = True
# 默认每次动作之间停 0.05s，让 UI 有响应时间
pyautogui.PAUSE = 0.05


@dataclass
class ClickResult:
    x: int
    y: int
    button: str
    elapsed_ms: float


class Mouse:
    """鼠标控制器，所有方法接受**物理像素**坐标。

    macOS Retina 屏：截图坐标(物理)与 PyAutoGUI 坐标(逻辑)不一致，
    在 macOS 上 PyAutoGUI 已自动处理，传逻辑坐标即可。
    见 .scale_factor 自动校正。
    """

    def __init__(self, scale_factor: float = 1.0, move_duration: float = 0.15) -> None:
        self.scale_factor = scale_factor
        self.move_duration = move_duration

    def _logical(self, x: int, y: int) -> tuple[int, int]:
        if self.scale_factor != 1.0:
            return int(x / self.scale_factor), int(y / self.scale_factor)
        return x, y

    def click(self, x: int, y: int, button: str = "left", clicks: int = 1) -> ClickResult:
        lx, ly = self._logical(x, y)
        start = time.perf_counter()
        pyautogui.moveTo(lx, ly, duration=self.move_duration)
        pyautogui.click(button=button, clicks=clicks)
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info("mouse.click({}, {}) button={} clicks={}", lx, ly, button, clicks)
        return ClickResult(x=lx, y=ly, button=button, elapsed_ms=elapsed_ms)

    def double_click(self, x: int, y: int) -> ClickResult:
        return self.click(x, y, button="left", clicks=2)

    def right_click(self, x: int, y: int) -> ClickResult:
        return self.click(x, y, button="right", clicks=1)

    def move(self, x: int, y: int, duration: float | None = None) -> None:
        lx, ly = self._logical(x, y)
        pyautogui.moveTo(lx, ly, duration=duration or self.move_duration)

    def drag(self, from_xy: tuple[int, int], to_xy: tuple[int, int], duration: float = 0.5) -> None:
        fx, fy = self._logical(*from_xy)
        tx, ty = self._logical(*to_xy)
        pyautogui.moveTo(fx, fy, duration=self.move_duration)
        pyautogui.dragTo(tx, ty, duration=duration, button="left")
        logger.info("mouse.drag {} -> {}", (fx, fy), (tx, ty))

    def scroll(self, clicks: int, x: int | None = None, y: int | None = None) -> None:
        """正数向上滚，负数向下滚。可选先移到指定位置再滚。"""
        if x is not None and y is not None:
            self.move(x, y)
        pyautogui.scroll(clicks)
