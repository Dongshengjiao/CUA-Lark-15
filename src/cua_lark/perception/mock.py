from __future__ import annotations

from cua_lark.models import Observation
from cua_lark.perception.base import PerceptionAdapter


class MockPerceptionAdapter(PerceptionAdapter):
    def capture(self) -> Observation:
        return Observation(
            summary="Mock desktop observation for local planning and reporting.",
            ocr_text="Feishu mock screen",
        )
