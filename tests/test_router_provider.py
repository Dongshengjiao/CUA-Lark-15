"""LLMRouter 跨 Provider 路由单测 —— 通过 env 控制 build_default_client。"""

from __future__ import annotations

import pytest

from agent.llm.doubao import DoubaoClient
from agent.llm.qwen import QwenClient
from agent.llm.router import build_default_client


def test_provider_explicit_qwen(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    client = build_default_client()
    assert isinstance(client, QwenClient)


def test_provider_explicit_doubao(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARK_API_KEY", "ark-test")
    monkeypatch.setenv("LLM_PROVIDER", "doubao")
    client = build_default_client()
    assert isinstance(client, DoubaoClient)


def test_auto_picks_qwen_when_only_dashscope_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("ARK_API_KEY", raising=False)
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-test")
    client = build_default_client()
    assert isinstance(client, QwenClient)


def test_auto_picks_doubao_when_only_ark_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    monkeypatch.setenv("ARK_API_KEY", "ark-test")
    client = build_default_client()
    assert isinstance(client, DoubaoClient)


def test_no_keys_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    for v in ("LLM_PROVIDER", "DASHSCOPE_API_KEY", "QWEN_API_KEY", "ARK_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    with pytest.raises(ValueError, match="no LLM API key"):
        build_default_client()
