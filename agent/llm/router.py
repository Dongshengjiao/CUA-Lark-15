"""LLM Router —— 按任务类型动态切换 reasoning 档位与 fallback 模型。

设计：
- 同一豆包 2.0 Pro 模型，通过 reasoning 档位变化平衡能力 vs 延迟
- 失败时支持 fallback 到豆包 1.6
- 调用统计便于评测报告里写"调用占比 / 平均延迟"
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from loguru import logger

from agent.llm.base import LLMClient, LLMMessage, LLMResponse, ReasoningLevel
from agent.llm.doubao import DoubaoClient


class TaskType(StrEnum):
    """任务类型 —— 决定 reasoning 档位。"""

    GROUNDING = "grounding"
    SIMPLE_VERIFY = "simple_verify"
    PLANNING = "planning"
    CROSS_PRODUCT = "cross_product"
    SELF_HEAL = "self_heal"


# 任务类型 → reasoning 档位 映射
DEFAULT_TASK_REASONING: dict[TaskType, ReasoningLevel] = {
    TaskType.GROUNDING: ReasoningLevel.MINIMAL,
    TaskType.SIMPLE_VERIFY: ReasoningLevel.MINIMAL,
    TaskType.PLANNING: ReasoningLevel.LOW,
    TaskType.CROSS_PRODUCT: ReasoningLevel.MEDIUM,
    TaskType.SELF_HEAL: ReasoningLevel.MEDIUM,
}


@dataclass
class CallStats:
    total: int = 0
    by_task: dict[str, int] = field(default_factory=dict)
    by_reasoning: dict[str, int] = field(default_factory=dict)
    total_latency_ms: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    fallback_count: int = 0


class LLMRouter:
    """按任务类型路由的 LLM 调用器。

    用法:
        router = LLMRouter()
        resp = router.call(TaskType.GROUNDING, messages=[...])
    """

    def __init__(
        self,
        primary: LLMClient | None = None,
        fallback: LLMClient | None = None,
        task_reasoning: dict[TaskType, ReasoningLevel] | None = None,
        enable_fallback: bool = True,
    ) -> None:
        self.primary = primary or DoubaoClient(
            model=os.getenv("DOUBAO_MODEL_PRO", "doubao-seed-2-0-pro"),
            is_pro=True,
        )
        self.fallback = fallback if fallback is not None else (
            DoubaoClient(
                model=os.getenv("DOUBAO_MODEL_FALLBACK", "doubao-seed-1-6-251015"),
                is_pro=False,
            ) if enable_fallback else None
        )
        self.task_reasoning = task_reasoning or DEFAULT_TASK_REASONING
        self.stats = CallStats()

    def reasoning_for(self, task: TaskType) -> ReasoningLevel:
        return self.task_reasoning.get(task, ReasoningLevel.MINIMAL)

    def call(
        self,
        task: TaskType,
        messages: list[LLMMessage],
        reasoning: ReasoningLevel | None = None,
        **kwargs: Any,
    ) -> LLMResponse:
        """按任务类型调用 primary，失败则尝试 fallback。"""
        level = reasoning or self.reasoning_for(task)
        try:
            resp = self.primary.chat(messages, reasoning=level, **kwargs)
        except Exception as exc:
            if self.fallback is None:
                raise
            logger.warning(
                "primary failed, fallback to {}: task={} err={}",
                self.fallback.model,
                task.value,
                exc,
            )
            resp = self.fallback.chat(messages, reasoning=level, **kwargs)
            self.stats.fallback_count += 1

        self._record(task, resp)
        return resp

    def _record(self, task: TaskType, resp: LLMResponse) -> None:
        self.stats.total += 1
        self.stats.by_task[task.value] = self.stats.by_task.get(task.value, 0) + 1
        self.stats.by_reasoning[resp.reasoning.value] = (
            self.stats.by_reasoning.get(resp.reasoning.value, 0) + 1
        )
        self.stats.total_latency_ms += resp.latency_ms
        self.stats.total_input_tokens += resp.usage_input_tokens
        self.stats.total_output_tokens += resp.usage_output_tokens

    def summary(self) -> dict[str, Any]:
        avg_latency = self.stats.total_latency_ms / max(self.stats.total, 1)
        return {
            "total_calls": self.stats.total,
            "by_task": dict(self.stats.by_task),
            "by_reasoning": dict(self.stats.by_reasoning),
            "avg_latency_ms": round(avg_latency, 1),
            "total_input_tokens": self.stats.total_input_tokens,
            "total_output_tokens": self.stats.total_output_tokens,
            "fallback_count": self.stats.fallback_count,
        }
