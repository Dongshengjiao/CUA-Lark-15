"""LLM 基础结构单元测试 —— 不发 API 调用，只测数据结构与适配。"""

from __future__ import annotations

import pytest

from agent.llm.base import LLMMessage, ReasoningLevel
from agent.llm.doubao import _to_openai_messages


def test_reasoning_level_values() -> None:
    assert ReasoningLevel.MINIMAL.value == "minimal"
    assert ReasoningLevel.LOW.value == "low"
    assert ReasoningLevel.MEDIUM.value == "medium"
    assert ReasoningLevel.HIGH.value == "high"


def test_message_text_only() -> None:
    msg = LLMMessage(role="user", text="hello")
    assert not msg.has_images()


def test_message_with_image() -> None:
    msg = LLMMessage(role="user", text="see this", image_urls=["https://x/y.png"])
    assert msg.has_images()


def test_to_openai_messages_text_only() -> None:
    msgs = [LLMMessage(role="user", text="hi")]
    out = _to_openai_messages(msgs)
    assert out == [{"role": "user", "content": "hi"}]


def test_to_openai_messages_with_image_url() -> None:
    msgs = [LLMMessage(role="user", text="caption?", image_urls=["https://example.com/x.png"])]
    out = _to_openai_messages(msgs)
    assert out[0]["role"] == "user"
    parts = out[0]["content"]
    assert isinstance(parts, list)
    assert parts[0] == {"type": "text", "text": "caption?"}
    assert parts[1] == {"type": "image_url", "image_url": {"url": "https://example.com/x.png"}}


def test_to_openai_messages_image_path_missing() -> None:
    msgs = [LLMMessage(role="user", image_paths=["/tmp/__nope_does_not_exist__.png"])]
    with pytest.raises(FileNotFoundError):
        _to_openai_messages(msgs)
