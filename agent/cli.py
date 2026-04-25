"""LarkVision-Tester 命令行入口。"""

from __future__ import annotations

import json
from pathlib import Path

import typer
from dotenv import load_dotenv
from loguru import logger
from rich.console import Console
from rich.table import Table

load_dotenv()

app = typer.Typer(
    name="lvt",
    help="LarkVision-Tester · 飞书桌面端视觉驱动智能测试 Agent",
    no_args_is_help=True,
)
console = Console()


@app.command("shot")
def shot(out_dir: str = typer.Option("./screenshots", help="截图输出目录")) -> None:
    """快速截屏一张主屏，便于调试。"""
    from agent.perception import ScreenCapture

    cap = ScreenCapture(out_dir=out_dir)
    res = cap.capture()
    table = Table(title="Screenshot Result", show_header=False)
    table.add_row("path", res.path)
    table.add_row("size", f"{res.width} x {res.height}")
    table.add_row("scale", f"{res.scale:.2f}")
    table.add_row("elapsed", f"{res.elapsed_ms:.1f} ms")
    console.print(table)


@app.command("ground")
def ground(
    target: str = typer.Argument(..., help="自然语言描述要找的元素"),
    image: str = typer.Option(None, "-i", "--image", help="截图路径，缺省则现场截屏"),
    reasoning: str = typer.Option("minimal", help="minimal / low / medium / high"),
) -> None:
    """对一张截图执行 grounding：返回目标元素中心点坐标。"""
    from agent.llm.base import ReasoningLevel
    from agent.llm.router import LLMRouter
    from agent.perception import ScreenCapture, VisionGrounder

    if image is None:
        cap = ScreenCapture()
        shot = cap.capture()
        image = shot.path
        console.print(f"[dim]captured fresh shot: {image}[/dim]")

    grounder = VisionGrounder(router=LLMRouter())
    res = grounder.locate(image, target, reasoning=ReasoningLevel(reasoning))

    table = Table(title=f"Grounding · {target!r}")
    table.add_column("field")
    table.add_column("value")
    table.add_row("found", str(res.found))
    table.add_row("x, y", f"({res.x}, {res.y})")
    table.add_row("confidence", str(res.confidence))
    table.add_row("description", res.description)
    table.add_row("reason", res.reason)
    console.print(table)
    console.print(f"[dim]raw response:[/dim]\n{res.raw}")


@app.command("router-stats")
def router_stats() -> None:
    """打印路由器统计（占位，需要在持久化日志接入后真正生效）。"""
    console.print(json.dumps({"hint": "stats 持久化将在 M2 接入"}, ensure_ascii=False, indent=2))


def main() -> None:
    logger.add(Path("logs/lvt_{time:YYYY-MM-DD}.log"), rotation="50 MB", retention="14 days")
    app()


if __name__ == "__main__":
    main()
