"""M1 Demo: 截图 → 豆包 2.0 Pro grounding → 输出坐标。

跑通这个脚本即代表 M1 单步操作链路打通。

前置：
1. .env 已填好 ARK_API_KEY
2. 目标应用窗口已经在屏幕上 (建议先打开飞书登录页用作 demo)
3. 已 uv sync 完成依赖

用法:
    uv run python demo/m1_grounding_demo.py "飞书登录按钮"
    uv run python demo/m1_grounding_demo.py "邮箱输入框" --click

"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402
from loguru import logger  # noqa: E402

from agent.executor import Mouse  # noqa: E402
from agent.llm.base import ReasoningLevel  # noqa: E402
from agent.llm.router import LLMRouter  # noqa: E402
from agent.perception import ScreenCapture, VisionGrounder  # noqa: E402

load_dotenv()


def main() -> int:
    parser = argparse.ArgumentParser(description="M1 grounding demo")
    parser.add_argument("target", help="自然语言描述目标元素，例如 '飞书登录按钮'")
    parser.add_argument("--reasoning", default="minimal", choices=["minimal", "low", "medium", "high"])
    parser.add_argument("--click", action="store_true", help="找到后真的点一下")
    parser.add_argument("--image", help="跳过截屏，直接用现成图片")
    parser.add_argument("--scale", type=float, default=1.0, help="物理->逻辑缩放（macOS Retina 通常 2.0）")
    args = parser.parse_args()

    logger.info("=== M1 Demo: 截图 → grounding → 坐标 ===")

    if args.image:
        image_path = args.image
        logger.info("使用已有图片: {}", image_path)
    else:
        cap = ScreenCapture()
        shot = cap.capture()
        image_path = shot.path
        logger.info("已截屏: {} ({}x{})", image_path, shot.width, shot.height)

    grounder = VisionGrounder(router=LLMRouter())
    result = grounder.locate(image_path, args.target, reasoning=ReasoningLevel(args.reasoning))

    print("\n" + "=" * 60)
    print(f"目标:        {args.target}")
    print(f"找到:        {result.found}")
    print(f"坐标:        ({result.x}, {result.y})")
    print(f"置信度:      {result.confidence}")
    print(f"识别描述:    {result.description}")
    print(f"理由:        {result.reason}")
    print("=" * 60 + "\n")

    if not result.found:
        logger.warning("没找到目标，跳过点击")
        return 1

    if args.click:
        mouse = Mouse(scale_factor=args.scale)
        mouse.click(result.x, result.y)
        logger.info("已点击 ({}, {})", result.x, result.y)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
