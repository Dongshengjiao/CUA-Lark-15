"""屏幕截图采集层 —— 用 mss 高速截图。"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path

import mss
from loguru import logger
from PIL import Image


@dataclass
class ScreenshotResult:
    """截图结果。

    width/height 为图像像素尺寸；scale 为 DPI 缩放系数（macOS Retina 通常 2.0）。
    """

    path: str
    width: int
    height: int
    scale: float = 1.0
    monitor_index: int = 1
    elapsed_ms: float = 0.0

    @property
    def logical_width(self) -> int:
        return int(self.width / self.scale)

    @property
    def logical_height(self) -> int:
        return int(self.height / self.scale)


class ScreenCapture:
    """屏幕截图器。

    用法:
        cap = ScreenCapture(out_dir="./screenshots")
        result = cap.capture()  # 主屏全屏
        result = cap.capture_region(left=0, top=0, width=800, height=600)
    """

    def __init__(self, out_dir: str | None = None, prefix: str = "shot") -> None:
        self.out_dir = Path(out_dir or os.getenv("SCREENSHOT_DIR", "./screenshots"))
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.prefix = prefix

    def _next_path(self, suffix: str = ".png") -> Path:
        ts = int(time.time() * 1000)
        return self.out_dir / f"{self.prefix}_{ts}{suffix}"

    def capture(self, monitor_index: int = 1) -> ScreenshotResult:
        """截取整个显示器，monitor_index=1 是主屏，0 是所有屏拼接。"""
        start = time.perf_counter()
        with mss.mss() as sct:
            mons = sct.monitors
            if monitor_index >= len(mons):
                logger.warning("monitor_index {} 越界，回退主屏 1", monitor_index)
                monitor_index = 1
            mon = mons[monitor_index]
            sct_img = sct.grab(mon)
            img = Image.frombytes("RGB", sct_img.size, sct_img.rgb)
            path = self._next_path()
            img.save(str(path), format="PNG", optimize=False)
            scale = self._detect_scale(mon)
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.debug("captured {} ({}x{}, scale={:.2f}, {:.1f}ms)", path.name, img.width, img.height, scale, elapsed_ms)
        return ScreenshotResult(
            path=str(path),
            width=img.width,
            height=img.height,
            scale=scale,
            monitor_index=monitor_index,
            elapsed_ms=elapsed_ms,
        )

    def capture_region(self, left: int, top: int, width: int, height: int) -> ScreenshotResult:
        start = time.perf_counter()
        with mss.mss() as sct:
            region = {"left": left, "top": top, "width": width, "height": height}
            sct_img = sct.grab(region)
            img = Image.frombytes("RGB", sct_img.size, sct_img.rgb)
            path = self._next_path("_region.png")
            img.save(str(path), format="PNG")
        elapsed_ms = (time.perf_counter() - start) * 1000
        return ScreenshotResult(
            path=str(path),
            width=img.width,
            height=img.height,
            scale=1.0,
            monitor_index=-1,
            elapsed_ms=elapsed_ms,
        )

    @staticmethod
    def _detect_scale(monitor: dict) -> float:
        # macOS Retina: width 通常会比 logical 大 2 倍；mss 直接给到物理像素
        # 这里粗略估计，只能给 logical->physical 的提示，下游真正用的是物理坐标
        w = monitor.get("width", 0)
        if w >= 3000:
            return 2.0
        return 1.0
