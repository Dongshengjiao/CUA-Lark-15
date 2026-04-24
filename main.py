from __future__ import annotations

import argparse
import sys
import traceback

# Unbuffered stdout so status messages appear immediately even if the process
# hangs later. Must happen before the first print.
try:
    sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    sys.stderr.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
except Exception:
    pass

print("[main] starting up...", flush=True)

from rich.console import Console  # noqa: E402

from src.config import load_config  # noqa: E402
from src.framework import run  # noqa: E402
from tests import calendar as calendar_tests  # noqa: E402
from tests import im as im_tests  # noqa: E402

console = Console(soft_wrap=True)

PRESET_TESTS = {
    "im.search_and_send": im_tests.search_and_send,
    "im.send_dm": im_tests.send_dm_to_contact,
    "calendar.create_quick_meeting": calendar_tests.create_quick_meeting,
    "cross.meeting_reminder": calendar_tests.cross_product_meeting_reminder,
}


def cli() -> int:
    print("[main] parsing args...", flush=True)
    parser = argparse.ArgumentParser(
        prog="cua-lark",
        description="CUA testing framework for Lark Desktop.",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--task", help="Natural-language task for the agent")
    group.add_argument(
        "--preset",
        choices=sorted(PRESET_TESTS),
        help="Run a preset test path from tests/",
    )
    parser.add_argument(
        "args",
        nargs="*",
        help="Positional args for the preset (e.g. contact name, message text)",
    )
    ns = parser.parse_args()

    print("[main] loading config...", flush=True)
    try:
        cfg = load_config()
    except RuntimeError as exc:
        print(f"[main] config error: {exc}", flush=True)
        return 1

    if ns.preset:
        goal = PRESET_TESTS[ns.preset](*ns.args)
    else:
        goal = (ns.task or "").strip()
        if not goal:
            print("[main] --task is empty", flush=True)
            return 2

    print(f"[main] goal: {goal}", flush=True)
    console.rule(f"[bold cyan]CUA-Lark[/bold cyan]: {goal}")

    try:
        result = run(cfg, goal)
    except KeyboardInterrupt:
        print("\n[main] aborted by user (KeyboardInterrupt)", flush=True)
        return 130
    except Exception as exc:  # noqa: BLE001 — we want everything visible
        print(f"\n[main] unhandled {type(exc).__name__}: {exc}", flush=True)
        traceback.print_exc()
        return 1

    print(f"[main] done: {result}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(cli())
