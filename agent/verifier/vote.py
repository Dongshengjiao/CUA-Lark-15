"""加权投票 —— 综合 L1/L2/L3 单层结果给出最终判分.

权重默认: L1 0.2 / L2 0.3 / L3 0.5
L3 confidence > 0.9 时独立决策, 直接采用 L3 结果.
"""

from __future__ import annotations

from agent.verifier.types import VerdictLevel, VerificationResult, VoteOutcome

DEFAULT_WEIGHTS: dict[str, float] = {
    "L1_pixel_diff": 0.2,
    "L2_ocr": 0.3,
    "L3_vlm": 0.5,
}


def vote(
    results: list[VerificationResult],
    weights: dict[str, float] | None = None,
    high_conf_threshold: float = 0.9,
) -> VoteOutcome:
    """加权投票.

    Args:
        results: 各层的验证结果
        weights: 自定义权重 (None = 用默认)
        high_conf_threshold: L3 置信度高于此值时独立决策
    """
    weights = weights or DEFAULT_WEIGHTS

    by_layer = {r.layer: r for r in results}

    l3 = by_layer.get("L3_vlm")
    if l3 and l3.confidence >= high_conf_threshold and l3.verdict != VerdictLevel.SKIPPED:
        return VoteOutcome(
            final=l3.verdict,
            score=l3.confidence,
            layers=results,
            reason=f"L3 high confidence ({l3.confidence:.2f}) overrides voting",
        )

    score = 0.0
    total_weight = 0.0
    for r in results:
        if r.verdict == VerdictLevel.SKIPPED:
            continue
        w = weights.get(r.layer, 0.0)
        if r.verdict == VerdictLevel.PASS:
            score += w
        total_weight += w

    normalized = score / total_weight if total_weight > 0 else 0.0
    if normalized >= 0.5:
        final = VerdictLevel.PASS
    elif normalized > 0:
        final = VerdictLevel.UNCERTAIN
    else:
        final = VerdictLevel.FAIL

    return VoteOutcome(
        final=final,
        score=normalized,
        layers=results,
        reason=f"weighted vote: score={normalized:.3f} (threshold=0.5)",
    )
