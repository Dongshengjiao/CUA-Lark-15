"""验证层公共数据类型."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class VerdictLevel(StrEnum):
    """单层验证结果."""

    PASS = "pass"
    FAIL = "fail"
    UNCERTAIN = "uncertain"
    SKIPPED = "skipped"


@dataclass
class VerificationResult:
    """单层验证产出."""

    layer: str
    verdict: VerdictLevel
    confidence: float = 0.0
    evidence: str = ""
    elapsed_ms: float = 0.0


@dataclass
class VoteOutcome:
    """加权投票后的最终判分."""

    final: VerdictLevel
    score: float
    layers: list[VerificationResult] = field(default_factory=list)
    reason: str = ""

    def as_dict(self) -> dict:
        return {
            "final": self.final.value,
            "score": self.score,
            "reason": self.reason,
            "layers": [
                {
                    "layer": layer.layer,
                    "verdict": layer.verdict.value,
                    "confidence": layer.confidence,
                    "evidence": layer.evidence,
                    "elapsed_ms": layer.elapsed_ms,
                }
                for layer in self.layers
            ],
        }
