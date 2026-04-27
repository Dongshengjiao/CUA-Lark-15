"""三层视觉验证 + Oracle 校准 (TuriX 把验证融在 Brain，我们独立做差异化).

- L1 像素 Diff (cv2 + SSIM)
- L2 OCR 文本校验 (RapidOCR)
- L3 VLM 语义判断 (调用 larkvision 的 LLM 客户端，复用 Brain 同款 prompt)
- L0 Oracle 评测期校准（lark-cli 后端真实状态）
- 加权投票决策

最小骨架 (M2 起完整实现).
"""

from agent.verifier.types import VerdictLevel, VerificationResult, VoteOutcome

__all__ = ["VerdictLevel", "VerificationResult", "VoteOutcome"]
