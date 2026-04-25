"""LLM 抽象基类 —— 所有 Provider (豆包 / GPT-4o / Claude) 的统一接口。

设计目标：
1. Planner / Grounder / Verifier 不直接耦合具体模型，方便后期替换或并存
2. 多模态消息（文本 + 图片）一致表达
3. Reasoning 档位独立于具体 SDK 字段名，由各 Provider 适配
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal


class ReasoningLevel(StrEnum):
    """统一 reasoning 档位语义。

    各 Provider 适配自己的字段：
    - 豆包 2.0 Pro: minimal / low / medium / high
    - 豆包 1.6: thinking off (= MINIMAL) / auto (= LOW) / on (= MEDIUM)
    - GPT-4o: 无对应字段，统一忽略
    """

    MINIMAL = "minimal"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass
class LLMMessage:
    """统一多模态消息结构。

    支持纯文本、文本+图片混合，图片以本地路径或 base64 (data URL) 提供。
    """

    role: Literal["system", "user", "assistant"]
    text: str = ""
    image_paths: list[str] = field(default_factory=list)
    image_urls: list[str] = field(default_factory=list)

    def has_images(self) -> bool:
        return bool(self.image_paths or self.image_urls)


@dataclass
class LLMResponse:
    """统一 LLM 响应结构。"""

    content: str
    raw: dict[str, Any] = field(default_factory=dict)
    usage_input_tokens: int = 0
    usage_output_tokens: int = 0
    model: str = ""
    reasoning: ReasoningLevel = ReasoningLevel.MINIMAL
    latency_ms: float = 0.0


class LLMClient(ABC):
    """LLM 客户端抽象基类。"""

    def __init__(self, model: str, **kwargs: Any) -> None:
        self.model = model
        self.config = kwargs

    @abstractmethod
    def chat(
        self,
        messages: list[LLMMessage],
        reasoning: ReasoningLevel = ReasoningLevel.MINIMAL,
        max_tokens: int | None = None,
        temperature: float = 0.0,
        response_format: Literal["text", "json"] = "text",
        **kwargs: Any,
    ) -> LLMResponse:
        """同步对话调用。子类必须实现。

        Args:
            messages: 多模态消息列表
            reasoning: reasoning 档位（具体语义由 Provider 适配）
            max_tokens: 最大输出 token 数；None = Provider 默认
            temperature: 采样温度，CUA 任务默认 0（确定性）
            response_format: text 或 json（Provider 自适配 JSON mode）
        """
        ...

    @abstractmethod
    def chat_with_image(
        self,
        prompt: str,
        image_path: str,
        reasoning: ReasoningLevel = ReasoningLevel.MINIMAL,
        system: str | None = None,
        **kwargs: Any,
    ) -> LLMResponse:
        """便捷方法：单图 + 文本提示词的快速调用。"""
        ...
