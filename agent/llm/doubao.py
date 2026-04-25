"""豆包 (Doubao) Provider 实现 —— 通过火山方舟 (Ark) OpenAI 兼容接口调用。

支持模型：
- doubao-seed-2.0-pro (主选, 4 档 reasoning)
- doubao-seed-1-6-* (备选 fallback)
"""

from __future__ import annotations

import base64
import os
import time
from pathlib import Path
from typing import Any, Literal

from loguru import logger
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from agent.llm.base import LLMClient, LLMMessage, LLMResponse, ReasoningLevel


def _encode_image_to_data_url(path: str) -> str:
    """读取本地图片转为 data URL (base64) —— 火山方舟要求 https/http URL 或 data URL。"""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"image not found: {path}")
    suffix = p.suffix.lower().lstrip(".")
    mime_map = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}
    mime = mime_map.get(suffix, "png")
    encoded = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:image/{mime};base64,{encoded}"


def _to_openai_messages(messages: list[LLMMessage]) -> list[dict[str, Any]]:
    """LLMMessage → OpenAI 兼容协议消息格式。"""
    out: list[dict[str, Any]] = []
    for m in messages:
        if not m.has_images():
            out.append({"role": m.role, "content": m.text})
            continue
        parts: list[dict[str, Any]] = []
        if m.text:
            parts.append({"type": "text", "text": m.text})
        for url in m.image_urls:
            parts.append({"type": "image_url", "image_url": {"url": url}})
        for path in m.image_paths:
            parts.append({"type": "image_url", "image_url": {"url": _encode_image_to_data_url(path)}})
        out.append({"role": m.role, "content": parts})
    return out


class DoubaoClient(LLMClient):
    """豆包系列模型客户端。

    通过 OpenAI 兼容接口调用，BASE_URL 默认指向火山方舟北京区。
    Reasoning 档位映射到豆包 2.0 Pro 的 thinking 配置；豆包 1.6 自适应忽略。
    """

    DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

    def __init__(
        self,
        model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 120.0,
        is_pro: bool = True,
        **kwargs: Any,
    ) -> None:
        model = model or os.getenv("DOUBAO_MODEL_PRO", "doubao-seed-2-0-pro")
        super().__init__(model=model, **kwargs)
        self.api_key = api_key or os.getenv("ARK_API_KEY")
        if not self.api_key:
            raise ValueError("ARK_API_KEY not set; export it or fill .env first")
        self.base_url = base_url or os.getenv("ARK_BASE_URL", self.DEFAULT_BASE_URL)
        self.is_pro = is_pro  # 是否走 2.0 Pro 路径(决定 reasoning 字段是否启用)
        self._client = OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=timeout)

    @staticmethod
    def _map_reasoning_pro(level: ReasoningLevel) -> str:
        # 豆包 2.0 Pro: minimal / low / medium / high
        return level.value

    @staticmethod
    def _map_reasoning_legacy(level: ReasoningLevel) -> str:
        # 豆包 1.6: thinking off / auto / on
        return {
            ReasoningLevel.MINIMAL: "off",
            ReasoningLevel.LOW: "auto",
            ReasoningLevel.MEDIUM: "on",
            ReasoningLevel.HIGH: "on",
        }[level]

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
        extra: dict[str, Any] = {}
        if self.is_pro:
            extra["thinking"] = {"type": self._map_reasoning_pro(reasoning)}
        else:
            extra["thinking"] = {"type": self._map_reasoning_legacy(reasoning)}
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
            logger.error("Doubao call failed: model={} reasoning={} err={}", self.model, reasoning.value, exc)
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
