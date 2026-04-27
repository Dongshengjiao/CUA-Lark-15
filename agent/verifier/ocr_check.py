"""L2 OCR 文本校验 —— 用 RapidOCR (中文 SOTA + 轻量).

用法:
    result = verify_text(
        screenshot="after.png",
        expect_keywords=["已发送"],
        forbid_keywords=["失败", "错误"],
    )
"""

from __future__ import annotations

import time
from functools import lru_cache

from agent.verifier.types import VerdictLevel, VerificationResult


@lru_cache(maxsize=1)
def _get_engine():
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def extract_text(screenshot: str) -> str:
    engine = _get_engine()
    result, _ = engine(screenshot)
    if not result:
        return ""
    return "\n".join(item[1] for item in result if len(item) >= 2)


def verify_text(
    screenshot: str,
    expect_keywords: list[str] | None = None,
    forbid_keywords: list[str] | None = None,
) -> VerificationResult:
    """L2: 期望关键词全部出现 + 禁止关键词均不出现 -> PASS."""
    start = time.perf_counter()
    text = extract_text(screenshot)
    elapsed_ms = (time.perf_counter() - start) * 1000

    expect_keywords = expect_keywords or []
    forbid_keywords = forbid_keywords or []

    missing = [k for k in expect_keywords if k not in text]
    found_forbid = [k for k in forbid_keywords if k in text]

    if missing:
        verdict = VerdictLevel.FAIL
        evidence = f"missing expected: {missing}"
    elif found_forbid:
        verdict = VerdictLevel.FAIL
        evidence = f"found forbidden: {found_forbid}"
    elif not expect_keywords and not forbid_keywords:
        verdict = VerdictLevel.SKIPPED
        evidence = "no keywords specified"
    else:
        verdict = VerdictLevel.PASS
        evidence = f"all keywords matched (expect={len(expect_keywords)}, forbid_clear=True)"

    return VerificationResult(
        layer="L2_ocr",
        verdict=verdict,
        confidence=1.0 if verdict == VerdictLevel.PASS else 0.0,
        evidence=evidence,
        elapsed_ms=elapsed_ms,
    )
