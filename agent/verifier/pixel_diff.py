"""L1 像素级 Diff 验证 —— SSIM 结构相似度 + 区域过滤.

用法:
    from PIL import Image
    from agent.verifier.pixel_diff import pixel_diff_score

    score = pixel_diff_score("before.png", "after.png")
    # 1.0 = 完全相同; < threshold = 发生了变化
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim

from agent.verifier.types import VerdictLevel, VerificationResult


def _load_gray(path: str | Path) -> np.ndarray:
    img = Image.open(path).convert("L")
    return np.asarray(img, dtype=np.uint8)


def pixel_diff_score(before_path: str, after_path: str) -> float:
    """计算 SSIM 相似度. 返回 [0, 1], 越接近 1 越像."""
    before = _load_gray(before_path)
    after = _load_gray(after_path)
    if before.shape != after.shape:
        h = min(before.shape[0], after.shape[0])
        w = min(before.shape[1], after.shape[1])
        before = before[:h, :w]
        after = after[:h, :w]
    score, _ = ssim(before, after, full=True)
    return float(score)


def verify_changed(
    before_path: str,
    after_path: str,
    *,
    expect_change: bool,
    threshold: float = 0.985,
) -> VerificationResult:
    """L1 验证: 期望/不期望发生变化.

    expect_change=True: 操作应该改变屏幕, score < threshold 才算 PASS
    expect_change=False: 操作不应该改变屏幕 (例如悬停), score >= threshold PASS
    """
    start = time.perf_counter()
    score = pixel_diff_score(before_path, after_path)
    elapsed_ms = (time.perf_counter() - start) * 1000

    if expect_change:
        verdict = VerdictLevel.PASS if score < threshold else VerdictLevel.FAIL
        evidence = f"SSIM={score:.4f} < {threshold} -> changed" if score < threshold else f"SSIM={score:.4f} >= {threshold} -> no change"
    else:
        verdict = VerdictLevel.PASS if score >= threshold else VerdictLevel.FAIL
        evidence = f"SSIM={score:.4f} >= {threshold} -> stable" if score >= threshold else f"SSIM={score:.4f} < {threshold} -> unexpected change"

    return VerificationResult(
        layer="L1_pixel_diff",
        verdict=verdict,
        confidence=score if expect_change else 1.0 - abs(1.0 - score),
        evidence=evidence,
        elapsed_ms=elapsed_ms,
    )
