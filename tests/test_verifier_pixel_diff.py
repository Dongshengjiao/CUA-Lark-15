"""verifier.pixel_diff 单元测试 (生成内存图避免依赖外部文件)."""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from agent.verifier.pixel_diff import pixel_diff_score, verify_changed
from agent.verifier.types import VerdictLevel


@pytest.fixture
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


def _save(arr: np.ndarray, path: Path) -> str:
    Image.fromarray(arr).save(path)
    return str(path)


def test_pixel_diff_identical(tmp_dir: Path) -> None:
    arr = np.ones((100, 100, 3), dtype=np.uint8) * 128
    a = _save(arr, tmp_dir / "a.png")
    b = _save(arr, tmp_dir / "b.png")
    assert pixel_diff_score(a, b) >= 0.99


def test_pixel_diff_different(tmp_dir: Path) -> None:
    a_arr = np.zeros((100, 100, 3), dtype=np.uint8)
    b_arr = np.full((100, 100, 3), 255, dtype=np.uint8)
    a = _save(a_arr, tmp_dir / "a.png")
    b = _save(b_arr, tmp_dir / "b.png")
    score = pixel_diff_score(a, b)
    assert score < 0.5


def test_verify_changed_expect_change_pass(tmp_dir: Path) -> None:
    a = _save(np.zeros((50, 50, 3), dtype=np.uint8), tmp_dir / "a.png")
    b = _save(np.full((50, 50, 3), 255, dtype=np.uint8), tmp_dir / "b.png")
    result = verify_changed(a, b, expect_change=True)
    assert result.verdict == VerdictLevel.PASS
    assert "changed" in result.evidence


def test_verify_changed_expect_change_fail(tmp_dir: Path) -> None:
    arr = np.full((50, 50, 3), 100, dtype=np.uint8)
    a = _save(arr, tmp_dir / "a.png")
    b = _save(arr, tmp_dir / "b.png")
    result = verify_changed(a, b, expect_change=True)
    assert result.verdict == VerdictLevel.FAIL


def test_verify_changed_expect_stable_pass(tmp_dir: Path) -> None:
    arr = np.full((50, 50, 3), 100, dtype=np.uint8)
    a = _save(arr, tmp_dir / "a.png")
    b = _save(arr, tmp_dir / "b.png")
    result = verify_changed(a, b, expect_change=False)
    assert result.verdict == VerdictLevel.PASS


def test_verify_handles_size_mismatch(tmp_dir: Path) -> None:
    a = _save(np.zeros((100, 100, 3), dtype=np.uint8), tmp_dir / "a.png")
    b = _save(np.zeros((80, 90, 3), dtype=np.uint8), tmp_dir / "b.png")
    result = verify_changed(a, b, expect_change=False)
    assert result.verdict in {VerdictLevel.PASS, VerdictLevel.FAIL}
