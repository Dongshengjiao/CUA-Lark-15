"""LarkVision-Tester 补强模块.

主 Agent 由 larkvision/ (vendored TuriX-CUA) 提供;
本包是其外挂式补强:
- verifier: 三层视觉验证 + Oracle 校准
- recovery: 自愈式执行
- reporter: 评测报告 / Streamlit Dashboard

详见 docs/turix_cua_review.md 和 plan/2026-04-27-v0.3-plan.md.
"""

__version__ = "0.0.3"
