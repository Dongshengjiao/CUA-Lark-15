from __future__ import annotations

"""Layer 4: Verification Layer — post-action state check.

Default mode is VLM: ask Claude whether the current screenshot matches the
expected description. OCR mode (optional) uses pytesseract for strict literal
text matching.
"""

import base64
import json
import re
from dataclasses import dataclass
from pathlib import Path

import anthropic


@dataclass
class VerifyResult:
    ok: bool
    reason: str
    evidence_screenshot: Path | None


_SYSTEM = """You are a strict GUI state verifier for the Lark desktop app.
Given a screenshot and an expected-state description, answer whether the
screenshot actually shows that state.

Respond with ONLY a JSON object:
{"ok": true|false, "reason": "one or two short sentences of evidence"}

Be strict: if important elements described in the expected state are missing
or different, answer false. Do not hallucinate details.

Do NOT wrap in code fences. No prose around the JSON.
"""


def _encode_png(path: Path) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def verify(expected: str, screenshot_path: Path, *, mode: str, model: str) -> VerifyResult:
    if (mode or "vlm").lower() == "ocr":
        return _verify_ocr(expected, screenshot_path)
    return _verify_vlm(expected, screenshot_path, model=model)


def _verify_vlm(expected: str, screenshot_path: Path, *, model: str) -> VerifyResult:
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=model,
        max_tokens=300,
        system=_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": _encode_png(screenshot_path),
                        },
                    },
                    {"type": "text", "text": f"Expected state: {expected}"},
                ],
            }
        ],
    )
    raw = resp.content[0].text if resp.content else ""
    text = _strip_fences(raw)
    data = json.loads(text)
    return VerifyResult(
        ok=bool(data.get("ok", False)),
        reason=str(data.get("reason", "")),
        evidence_screenshot=screenshot_path,
    )


def _verify_ocr(expected: str, screenshot_path: Path) -> VerifyResult:
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return VerifyResult(
            ok=False,
            reason="pytesseract not installed; install with .[ocr] extras",
            evidence_screenshot=screenshot_path,
        )
    text = pytesseract.image_to_string(Image.open(screenshot_path))
    ok = expected.lower() in text.lower()
    return VerifyResult(
        ok=ok,
        reason=f"OCR {'found' if ok else 'missed'} the expected text",
        evidence_screenshot=screenshot_path,
    )
