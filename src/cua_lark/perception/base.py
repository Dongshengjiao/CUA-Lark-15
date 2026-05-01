from __future__ import annotations

from abc import ABC, abstractmethod

from cua_lark.models import Observation


class PerceptionAdapter(ABC):
    @abstractmethod
    def capture(self) -> Observation:
        raise NotImplementedError
