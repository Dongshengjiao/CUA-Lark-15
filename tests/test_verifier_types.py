"""verifier.types 单元测试 (纯数据结构)."""

from __future__ import annotations

from agent.verifier.types import VerdictLevel, VerificationResult, VoteOutcome


def test_verdict_level_values() -> None:
    assert VerdictLevel.PASS.value == "pass"
    assert VerdictLevel.FAIL.value == "fail"
    assert VerdictLevel.UNCERTAIN.value == "uncertain"
    assert VerdictLevel.SKIPPED.value == "skipped"


def test_verification_result_defaults() -> None:
    r = VerificationResult(layer="L1_pixel_diff", verdict=VerdictLevel.PASS)
    assert r.confidence == 0.0
    assert r.evidence == ""
    assert r.elapsed_ms == 0.0


def test_vote_outcome_as_dict() -> None:
    layer = VerificationResult(
        layer="L1_pixel_diff",
        verdict=VerdictLevel.PASS,
        confidence=0.9,
        evidence="SSIM=0.8",
        elapsed_ms=12.3,
    )
    outcome = VoteOutcome(
        final=VerdictLevel.PASS,
        score=0.7,
        layers=[layer],
        reason="weighted",
    )
    d = outcome.as_dict()
    assert d["final"] == "pass"
    assert d["score"] == 0.7
    assert d["layers"][0]["layer"] == "L1_pixel_diff"
    assert d["layers"][0]["verdict"] == "pass"
    assert d["layers"][0]["confidence"] == 0.9
