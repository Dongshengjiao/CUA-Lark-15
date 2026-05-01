from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ProductArea(str, Enum):
    IM = "im"
    DOCS = "docs"
    CALENDAR = "calendar"
    CROSS_PRODUCT = "cross_product"


class ActionType(str, Enum):
    LARK_CLI = "lark_cli"
    BROWSER = "browser"
    CLICK = "click"
    DOUBLE_CLICK = "double_click"
    RIGHT_CLICK = "right_click"
    DRAG = "drag"
    TYPE = "type"
    HOTKEY = "hotkey"
    ACTIVATE_APP = "activate_app"
    SCROLL = "scroll"
    WAIT = "wait"
    ASSERT_TEXT = "assert_text"


class StepDefinition(BaseModel):
    id: str
    action: ActionType
    target: str | None = None
    value: str | None = None
    continue_on_failure: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class TestCase(BaseModel):
    id: str
    name: str
    product: ProductArea
    goal: str
    expected: str
    steps: list[StepDefinition]
    verifications: list["ExternalVerification"] = Field(default_factory=list)


class Observation(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source: str = "desktop"
    summary: str = ""
    ocr_text: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActionResult(BaseModel):
    step_id: str
    success: bool
    message: str
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ValidationResult(BaseModel):
    success: bool
    message: str
    details: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExternalVerification(BaseModel):
    id: str
    provider: str
    command: list[str] = Field(default_factory=list)
    expected_contains: str | None = None
    optional: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunResult(BaseModel):
    case_id: str
    case_name: str
    success: bool
    product: ProductArea
    action_results: list[ActionResult]
    validation: ValidationResult
    metadata: dict[str, Any] = Field(default_factory=dict)
