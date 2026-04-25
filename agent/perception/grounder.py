"""视觉 Grounder —— 给定截图和意图，返回点击坐标。

调用豆包 2.0 Pro (reasoning=minimal)，让它返回结构化 JSON。
后续若 grounding 精度不达标，可挂 OmniParser v2 缩小搜索空间，
或切 UI-TARS-1.5 (火山 API 版) 作为专用 grounder。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from loguru import logger

from agent.llm.base import LLMMessage, ReasoningLevel
from agent.llm.router import LLMRouter, TaskType

GROUNDER_SYSTEM_PROMPT = """\
你是一个 GUI 元素视觉定位专家。
给定一张应用截图和一个自然语言描述的目标元素，你的任务是返回该元素的中心点坐标。

输出严格的 JSON 格式（不要任何解释、Markdown 代码块、前后多余文字）：
{
  "found": true | false,
  "x": <int>,
  "y": <int>,
  "confidence": <0-100>,
  "description": "你识别到的元素描述",
  "reason": "为什么这是目标（找不到时说明原因）"
}

坐标系约定：
- 原点 (0, 0) 在截图左上角
- 单位是像素
- x 向右增大、y 向下增大
- 如果找不到目标，返回 found=false，x/y 填 -1
"""


@dataclass
class GroundingResult:
    found: bool
    x: int
    y: int
    confidence: int
    description: str = ""
    reason: str = ""
    raw: str = ""


class VisionGrounder:
    """视觉定位器：截图 + 意图描述 → (x, y)。"""

    def __init__(self, router: LLMRouter | None = None) -> None:
        self.router = router or LLMRouter()

    def locate(
        self,
        screenshot_path: str,
        target_description: str,
        reasoning: ReasoningLevel = ReasoningLevel.MINIMAL,
    ) -> GroundingResult:
        """在截图上定位目标元素。

        Args:
            screenshot_path: 截图本地路径
            target_description: 自然语言描述（例如 "飞书登录按钮 / 邮箱输入框"）
            reasoning: 默认 minimal；复杂场景可升 low
        """
        user_text = f"目标元素描述：{target_description}\n请返回 JSON 坐标。"
        messages = [
            LLMMessage(role="system", text=GROUNDER_SYSTEM_PROMPT),
            LLMMessage(role="user", text=user_text, image_paths=[screenshot_path]),
        ]
        resp = self.router.call(
            TaskType.GROUNDING,
            messages=messages,
            reasoning=reasoning,
            response_format="json",
        )
        return self._parse(resp.content)

    @staticmethod
    def _parse(content: str) -> GroundingResult:
        raw = content
        try:
            data = _extract_json(content)
            return GroundingResult(
                found=bool(data.get("found", False)),
                x=int(data.get("x", -1)),
                y=int(data.get("y", -1)),
                confidence=int(data.get("confidence", 0)),
                description=str(data.get("description", "")),
                reason=str(data.get("reason", "")),
                raw=raw,
            )
        except (json.JSONDecodeError, ValueError, TypeError) as exc:
            logger.error("grounder JSON parse failed: {} | content={}", exc, content[:200])
            return GroundingResult(
                found=False, x=-1, y=-1, confidence=0,
                reason=f"parse_error: {exc}", raw=raw,
            )


def _extract_json(text: str) -> dict[str, Any]:
    """从可能包含 Markdown 代码块的文本中提取 JSON 对象。"""
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))
    obj = re.search(r"\{.*\}", text, re.DOTALL)
    if obj:
        return json.loads(obj.group(0))
    raise json.JSONDecodeError("no JSON object found", text, 0)
