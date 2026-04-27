"""阿里云 Qwen (DashScope) Provider 实现。

通过 DashScope 的 OpenAI 兼容接口调用，覆盖：
- qwen3-vl-plus / qwen3-vl-flash（GUI Agent 专项训练，主推）
- qwen2.5-vl-72b/32b/7b-instruct（开源系）
- qwen-vl-max / qwen-vl-plus（通用旗舰）

DashScope 默认不支持显式 reasoning 档位，依赖 enable_thinking 参数。
"""

from __future__ import annotations

import os
import time
from typing import Any, Literal

from loguru import logger
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from agent.llm.base import LLMClient, LLMMessage, LLMResponse, ReasoningLevel
from agent.llm.doubao import _to_openai_messages


class QwenClient(LLMClient):
    """阿里云 Qwen 系列模型客户端。

    通过 DashScope OpenAI 兼容协议调用：
        BASE_URL: https://dashscope.aliyuncs.com/compatible-mode/v1   (中国北京)
        国际:     https://dashscope-intl.aliyuncs.com/compatible-mode/v1 (新加坡)

    Reasoning 档位映射策略：
    - MINIMAL → enable_thinking=False（直接回答，最快）
    - LOW / MEDIUM / HIGH → enable_thinking=True（开思考；档位用 prompt 引导）
    """

    DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    def __init__(
        self,
        model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 120.0,
        **kwargs: Any,
    ) -> None:
        model = model or os.getenv("QWEN_MODEL", "qwen3-vl-plus")
        super().__init__(model=model, **kwargs)
        self.api_key = api_key or os.getenv("DASHSCOPE_API_KEY") or os.getenv("QWEN_API_KEY")
        if not self.api_key:
            raise ValueError(
                "DASHSCOPE_API_KEY (或 QWEN_API_KEY) not set；"
                "请在 .env 中填入阿里云百炼 API Key"
            )
        self.base_url = base_url or os.getenv("DASHSCOPE_BASE_URL", self.DEFAULT_BASE_URL)
        self._client = OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=timeout)

    @staticmethod
    def _map_reasoning_to_thinking(level: ReasoningLevel) -> bool:
        """Qwen 用 enable_thinking 二态参数代替多档 reasoning。"""
        return level != ReasoningLevel.MINIMAL

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    def chat(
        self,
        messages: list[LLMMessage],
        reasoning: ReasoningLevel = ReasoningLevel.MINIMAL,
        max_tokens: int | None = None,
        temperature: float = 0.0,
        response_format: Literal["text", "json"] = "text",
        **kwargs: Any,
    ) -> LLMResponse:
        oai_msgs = _to_openai_messages(messages)
        extra: dict[str, Any] = {
            "enable_thinking": self._map_reasoning_to_thinking(reasoning),
        }
        if response_format == "json":
            extra["response_format"] = {"type": "json_object"}

        start = time.perf_counter()
        try:
            resp = self._client.chat.completions.create(
                model=self.model,
                messages=oai_msgs,
                temperature=temperature,
                max_tokens=max_tokens,
                extra_body=extra,
                **kwargs,
            )
        except Exception as exc:
            logger.error("Qwen call failed: model={} reasoning={} err={}", self.model, reasoning.value, exc)
            raise
        latency_ms = (time.perf_counter() - start) * 1000

        choice = resp.choices[0]
        content = choice.message.content or ""
        usage = resp.usage
        return LLMResponse(
            content=content,
            raw=resp.model_dump() if hasattr(resp, "model_dump") else {},
            usage_input_tokens=getattr(usage, "prompt_tokens", 0) if usage else 0,
            usage_output_tokens=getattr(usage, "completion_tokens", 0) if usage else 0,
            model=self.model,
            reasoning=reasoning,
            latency_ms=latency_ms,
        )

    def chat_with_image(
        self,
        prompt: str,
        image_path: str,
        reasoning: ReasoningLevel = ReasoningLevel.MINIMAL,
        system: str | None = None,
        **kwargs: Any,
    ) -> LLMResponse:
        msgs: list[LLMMessage] = []
        if system:
            msgs.append(LLMMessage(role="system", text=system))
        msgs.append(LLMMessage(role="user", text=prompt, image_paths=[image_path]))
        return self.chat(msgs, reasoning=reasoning, **kwargs)
