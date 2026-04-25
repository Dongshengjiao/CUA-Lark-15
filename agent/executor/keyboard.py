"""键盘动作执行 —— 基于 PyAutoGUI + pynput 兜底。

中文输入：PyAutoGUI 在 macOS 上对中文支持不佳，使用 pyperclip 复制粘贴方案。
"""

from __future__ import annotations

import platform
import time

import pyautogui
from loguru import logger


def _is_mac() -> bool:
    return platform.system() == "Darwin"


class Keyboard:
    """键盘控制器。

    type_text 对中文采用剪贴板粘贴策略；纯英文走 pyautogui.write。
    hotkey 接受多键名拼接如 'cmd+a'。
    """

    def __init__(self, type_interval: float = 0.02) -> None:
        self.type_interval = type_interval

    def type_text(self, text: str) -> None:
        """输入文本；中文走剪贴板粘贴，英文走 pyautogui.write。"""
        if not text:
            return
        if any(ord(c) > 127 for c in text):
            self._paste_text(text)
        else:
            pyautogui.write(text, interval=self.type_interval)
        logger.info("keyboard.type len={} preview={!r}", len(text), text[:20])

    @staticmethod
    def _paste_text(text: str) -> None:
        try:
            import pyperclip
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "中文输入需要 pyperclip：uv add pyperclip 或 pip install pyperclip"
            ) from exc
        pyperclip.copy(text)
        time.sleep(0.05)
        if _is_mac():
            pyautogui.hotkey("command", "v")
        else:
            pyautogui.hotkey("ctrl", "v")

    def press(self, key: str) -> None:
        """按下单个键，例如 'enter' / 'tab' / 'esc'。"""
        pyautogui.press(key)
        logger.info("keyboard.press {}", key)

    def hotkey(self, combo: str) -> None:
        """组合键，例如 'cmd+a' / 'ctrl+shift+t'。

        在 macOS 上 cmd 自动转 command；其他平台 ctrl 保持 ctrl。
        """
        keys = [k.strip() for k in combo.replace(" ", "").split("+") if k.strip()]
        keys = [self._normalize_key(k) for k in keys]
        pyautogui.hotkey(*keys)
        logger.info("keyboard.hotkey {}", "+".join(keys))

    @staticmethod
    def _normalize_key(k: str) -> str:
        k = k.lower()
        if k == "cmd":
            return "command" if _is_mac() else "ctrl"
        return k
