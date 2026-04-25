"""Grounder 解析逻辑单元测试 —— 不发 API 调用。"""

from __future__ import annotations

import pytest

from agent.perception.grounder import VisionGrounder, _extract_json


def test_extract_pure_json() -> None:
    obj = _extract_json('{"x": 10, "y": 20}')
    assert obj == {"x": 10, "y": 20}


def test_extract_json_in_fenced_block() -> None:
    text = '```json\n{"x": 1, "y": 2}\n```'
    assert _extract_json(text) == {"x": 1, "y": 2}


def test_extract_json_with_prose() -> None:
    text = '这是结果： {"found": true, "x": 1, "y": 2}\n说明：略'
    assert _extract_json(text) == {"found": True, "x": 1, "y": 2}


def test_extract_json_raises_when_missing() -> None:
    import json
    with pytest.raises(json.JSONDecodeError):
        _extract_json("no json here")


def test_parse_valid_grounding_result() -> None:
    content = '{"found": true, "x": 100, "y": 200, "confidence": 95, "description": "btn", "reason": "ok"}'
    res = VisionGrounder._parse(content)
    assert res.found is True
    assert (res.x, res.y) == (100, 200)
    assert res.confidence == 95
    assert res.description == "btn"


def test_parse_not_found_result() -> None:
    content = '{"found": false, "x": -1, "y": -1, "confidence": 0, "reason": "no match"}'
    res = VisionGrounder._parse(content)
    assert res.found is False
    assert (res.x, res.y) == (-1, -1)


def test_parse_malformed_returns_not_found() -> None:
    res = VisionGrounder._parse("plain garbled text")
    assert res.found is False
    assert "parse_error" in res.reason
