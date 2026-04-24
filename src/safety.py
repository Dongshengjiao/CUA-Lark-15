from __future__ import annotations

from rich.console import Console
from rich.panel import Panel

_console = Console()


def confirm_action(summary: str, *, default_no: bool = True) -> bool:
    _console.print(Panel(summary, title="[yellow]Confirm action[/yellow]", border_style="yellow"))
    prompt = "Proceed? [y/N]: " if default_no else "Proceed? [Y/n]: "
    try:
        answer = input(prompt).strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    if not answer:
        return not default_no
    return answer in {"y", "yes"}
