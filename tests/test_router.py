"""LLMRouter 路由策略单元测试 —— 用 stub client 隔离真实 API。"""

from __future__ import annotations

from typing import Any

from agent.llm.base import LLMClient, LLMMessage, LLMResponse, ReasoningLevel
from agent.llm.router import DEFAULT_TASK_REASONING, LLMRouter, TaskType


class StubClient(LLMClient):
    def __init__(self, model: str = "stub", fail: bool = False) -> None:
        super().__init__(model=model)
        self.fail = fail
        self.calls: list[tuple[ReasoningLevel, list[LLMMessage]]] = []

    def chat(
        self,
        messages: list[LLMMessage],
        reasoning: ReasoningLevel = ReasoningLevel.MINIMAL,
        max_tokens: int | None = None,
        temperature: float = 0.0,
        response_format: str = "text",
        **kwargs: Any,
    ) -> LLMResponse:
        if self.fail:
            raise RuntimeError("stub failure")
        self.calls.append((reasoning, messages))
        return LLMResponse(content="ok", model=self.model, reasoning=reasoning, latency_ms=1.23)

    def chat_with_image(self, prompt: str, image_path: str, **kwargs: Any) -> LLMResponse:
        return self.chat([LLMMessage(role="user", text=prompt)], **kwargs)


def test_default_task_reasoning_mapping() -> None:
    assert DEFAULT_TASK_REASONING[TaskType.GROUNDING] == ReasoningLevel.MINIMAL
    assert DEFAULT_TASK_REASONING[TaskType.PLANNING] == ReasoningLevel.LOW
    assert DEFAULT_TASK_REASONING[TaskType.CROSS_PRODUCT] == ReasoningLevel.MEDIUM


def test_router_routes_grounding_to_minimal() -> None:
    primary = StubClient("primary")
    router = LLMRouter(primary=primary, fallback=None, enable_fallback=False)
    router.call(TaskType.GROUNDING, messages=[LLMMessage(role="user", text="x")])
    assert primary.calls[0][0] == ReasoningLevel.MINIMAL


def test_router_routes_planning_to_low() -> None:
    primary = StubClient("primary")
    router = LLMRouter(primary=primary, fallback=None, enable_fallback=False)
    router.call(TaskType.PLANNING, messages=[LLMMessage(role="user", text="x")])
    assert primary.calls[0][0] == ReasoningLevel.LOW


def test_router_falls_back_on_primary_failure() -> None:
    primary = StubClient("primary", fail=True)
    fallback = StubClient("fallback")
    router = LLMRouter(primary=primary, fallback=fallback)
    resp = router.call(TaskType.GROUNDING, messages=[LLMMessage(role="user", text="x")])
    assert resp.model == "fallback"
    assert router.stats.fallback_count == 1


def test_router_records_stats() -> None:
    primary = StubClient("primary")
    router = LLMRouter(primary=primary, fallback=None, enable_fallback=False)
    router.call(TaskType.GROUNDING, messages=[LLMMessage(role="user", text="x")])
    router.call(TaskType.PLANNING, messages=[LLMMessage(role="user", text="x")])

    summary = router.summary()
    assert summary["total_calls"] == 2
    assert summary["by_task"]["grounding"] == 1
    assert summary["by_task"]["planning"] == 1
    assert summary["by_reasoning"]["minimal"] == 1
    assert summary["by_reasoning"]["low"] == 1
