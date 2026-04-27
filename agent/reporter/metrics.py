"""单次任务运行的核心指标聚合."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RunMetrics:
    """一次任务执行的指标快照."""

    task_id: str
    success: bool
    elapsed_seconds: float
    step_count: int = 0
    action_count: int = 0
    llm_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    verifier_layer_pass: dict[str, int] = field(default_factory=dict)
    error: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "success": self.success,
            "elapsed_seconds": round(self.elapsed_seconds, 2),
            "step_count": self.step_count,
            "action_count": self.action_count,
            "llm_calls": self.llm_calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "verifier_layer_pass": dict(self.verifier_layer_pass),
            "error": self.error,
            "extra": self.extra,
        }


def summarize(runs: list[RunMetrics]) -> dict[str, Any]:
    """对一组 runs 聚合, 给出 Bench 总结."""
    if not runs:
        return {"total": 0}
    total = len(runs)
    success = sum(1 for r in runs if r.success)
    return {
        "total": total,
        "success": success,
        "success_rate": round(success / total, 3),
        "avg_elapsed_seconds": round(sum(r.elapsed_seconds for r in runs) / total, 2),
        "avg_step_count": round(sum(r.step_count for r in runs) / total, 1),
        "avg_llm_calls": round(sum(r.llm_calls for r in runs) / total, 1),
        "total_input_tokens": sum(r.input_tokens for r in runs),
        "total_output_tokens": sum(r.output_tokens for r in runs),
    }
