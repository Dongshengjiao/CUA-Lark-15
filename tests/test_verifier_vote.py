"""verifier.vote 加权投票单元测试."""

from __future__ import annotations

from agent.verifier.types import VerdictLevel, VerificationResult
from agent.verifier.vote import DEFAULT_WEIGHTS, vote


def _layer(name: str, verdict: VerdictLevel, conf: float = 0.7) -> VerificationResult:
    return VerificationResult(layer=name, verdict=verdict, confidence=conf)


def test_default_weights_sum_to_one() -> None:
    assert abs(sum(DEFAULT_WEIGHTS.values()) - 1.0) < 1e-6


def test_all_pass_means_pass() -> None:
    results = [
        _layer("L1_pixel_diff", VerdictLevel.PASS),
        _layer("L2_ocr", VerdictLevel.PASS),
        _layer("L3_vlm", VerdictLevel.PASS, conf=0.7),
    ]
    outcome = vote(results)
    assert outcome.final == VerdictLevel.PASS
    assert outcome.score == 1.0


def test_all_fail_means_fail() -> None:
    results = [
        _layer("L1_pixel_diff", VerdictLevel.FAIL),
        _layer("L2_ocr", VerdictLevel.FAIL),
        _layer("L3_vlm", VerdictLevel.FAIL, conf=0.7),
    ]
    outcome = vote(results)
    assert outcome.final == VerdictLevel.FAIL
    assert outcome.score == 0.0


def test_l3_high_confidence_overrides_others() -> None:
    """L1/L2 都失败但 L3 高置信通过 -> 直接 PASS."""
    results = [
        _layer("L1_pixel_diff", VerdictLevel.FAIL),
        _layer("L2_ocr", VerdictLevel.FAIL),
        _layer("L3_vlm", VerdictLevel.PASS, conf=0.95),
    ]
    outcome = vote(results)
    assert outcome.final == VerdictLevel.PASS
    assert "high confidence" in outcome.reason


def test_l3_low_confidence_does_not_override() -> None:
    results = [
        _layer("L1_pixel_diff", VerdictLevel.FAIL),
        _layer("L2_ocr", VerdictLevel.FAIL),
        _layer("L3_vlm", VerdictLevel.PASS, conf=0.6),
    ]
    outcome = vote(results)
    # L3 0.5 - L1 0 - L2 0 = 0.5, score = 0.5/1.0 = 0.5 -> PASS (>= 0.5)
    assert outcome.final == VerdictLevel.PASS


def test_skipped_layer_excluded_from_vote() -> None:
    results = [
        _layer("L1_pixel_diff", VerdictLevel.PASS),
        _layer("L2_ocr", VerdictLevel.SKIPPED),
        _layer("L3_vlm", VerdictLevel.PASS, conf=0.7),
    ]
    outcome = vote(results)
    # L1 0.2 + L3 0.5 = 0.7 / (0.2+0.5) = 1.0 -> PASS
    assert outcome.final == VerdictLevel.PASS


def test_partial_pass_uncertain() -> None:
    """L1 通过 0.2 / 总 1.0 = 0.2 < 0.5 -> UNCERTAIN."""
    results = [
        _layer("L1_pixel_diff", VerdictLevel.PASS),
        _layer("L2_ocr", VerdictLevel.FAIL),
        _layer("L3_vlm", VerdictLevel.FAIL, conf=0.7),
    ]
    outcome = vote(results)
    assert outcome.final == VerdictLevel.UNCERTAIN
    assert 0 < outcome.score < 0.5
