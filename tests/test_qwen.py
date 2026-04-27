"""QwenClient 单元测试 —— 不发真实 API，仅测构造、reasoning 映射、消息适配。"""

from __future__ import annotations

import pytest

from agent.llm.base import LLMMessage, ReasoningLevel
from agent.llm.qwen import QwenClient


def test_qwen_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    with pytest.raises(ValueError, match="DASHSCOPE_API_KEY"):
        QwenClient()


def test_qwen_picks_up_api_key_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-fake-key-for-test")
    monkeypatch.setenv("QWEN_MODEL", "qwen3-vl-plus")
    c = QwenClient()
    assert c.model == "qwen3-vl-plus"
    assert c.api_key == "sk-fake-key-for-test"
    assert "compatible-mode" in c.base_url


def test_qwen_alt_env_key_qwen_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.setenv("QWEN_API_KEY", "sk-alt")
    c = QwenClient(model="qwen3-vl-flash")
    assert c.api_key == "sk-alt"


def test_reasoning_map_minimal_disables_thinking() -> None:
    assert QwenClient._map_reasoning_to_thinking(ReasoningLevel.MINIMAL) is False


@pytest.mark.parametrize("level", [ReasoningLevel.LOW, ReasoningLevel.MEDIUM, ReasoningLevel.HIGH])
def test_reasoning_map_higher_enables_thinking(level: ReasoningLevel) -> None:
    assert QwenClient._map_reasoning_to_thinking(level) is True


def test_qwen_custom_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-x")
    intl = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    c = QwenClient(base_url=intl)
    assert c.base_url == intl


def test_qwen_construct_message_with_image(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    """验证多模态消息能走通 _to_openai_messages 适配（不真发 API）。"""
    from agent.llm.doubao import _to_openai_messages

    img = tmp_path / "tiny.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)

    msgs = [LLMMessage(role="user", text="see this", image_paths=[str(img)])]
    out = _to_openai_messages(msgs)
    assert out[0]["role"] == "user"
    parts = out[0]["content"]
    assert parts[0] == {"type": "text", "text": "see this"}
    assert parts[1]["type"] == "image_url"
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")
