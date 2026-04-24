from __future__ import annotations

"""Framework orchestrator — wires the 5 layers together.

One run:
    1. Focus Lark, take initial screenshot.
    2. Planning Layer → ordered Action list + expected_end_state.
    3. For each Action:
        a. take "before" screenshot
        b. Execution Layer (Visual Layer resolves target_hint as needed)
        c. take "after" screenshot
        d. on the final step, Verification Layer checks expected_end_state
    4. Reporting Layer writes a markdown summary to reports/.

A lightweight safety gate pauses before any action that looks destructive
(keyword match on hint/text/rationale, or pressing Enter which usually sends).
"""

import time
from datetime import datetime
from pathlib import Path

from rich.console import Console

from src.actions import Action
from src.config import Config
from src.layers import execution, planning, reporting, verification, visual
from src.safety import confirm_action

_console = Console()

_DESTRUCTIVE_HINTS = (
    "send",
    "submit",
    "delete",
    "remove",
    "post",
    "publish",
    "confirm send",
)


def _looks_destructive(action: Action) -> bool:
    if action.kind == "key" and any(k.lower() == "enter" for k in action.keys):
        return True
    blob = " ".join(
        filter(
            None,
            [
                (action.target_hint or "").lower(),
                (action.text or "").lower(),
                (action.rationale or "").lower(),
            ],
        )
    )
    return any(w in blob for w in _DESTRUCTIVE_HINTS)


def _action_repr(a: Action) -> str:
    parts = [a.kind]
    if a.target_hint:
        parts.append(f"@ {a.target_hint!r}")
    if a.text is not None:
        parts.append(f"text={a.text!r}")
    if a.keys:
        parts.append(f"keys={a.keys}")
    if a.scroll_amount is not None:
        parts.append(f"scroll={a.scroll_amount}")
    if a.seconds is not None:
        parts.append(f"wait={a.seconds}s")
    return " ".join(parts)


def run(cfg: Config, goal: str) -> dict:
    started = datetime.now()
    run_tag = started.strftime("%Y%m%d-%H%M%S")
    run_shot_dir = cfg.screenshot_dir / run_tag
    run_shot_dir.mkdir(parents=True, exist_ok=True)

    _console.print("[dim]Focusing Lark window...[/dim]")
    focused_title = execution.focus_lark_window()
    if focused_title:
        _console.print(f"[dim]Focused window:[/dim] {focused_title!r}")
    else:
        _console.print(
            "[yellow]No Lark/Feishu window found. Make sure Lark Desktop is running "
            "and not minimized — the screenshot will capture whatever is on screen right now.[/yellow]"
        )
    # Give the OS time to actually raise the window and repaint before we screenshot.
    time.sleep(1.5)

    plan_shot = run_shot_dir / "00_plan.png"
    visual.take_screenshot(plan_shot)
    _console.print("[cyan]Planning...[/cyan]")
    try:
        actions, expected = planning.plan(goal, plan_shot, model=cfg.model)
    except Exception as exc:
        _console.print(f"[red]Planner failed:[/red] {exc}")
        raise

    if not actions:
        _console.print("[yellow]Planner returned zero steps.[/yellow]")
        return {"ok": False, "report": None, "steps": 0, "reason": "empty plan"}

    _console.print(f"[green]Plan:[/green] {len(actions)} step(s)")
    for i, a in enumerate(actions, 1):
        _console.print(f"  {i}. {_action_repr(a)}")
    _console.print(f"[dim]Expected end state:[/dim] {expected}")

    step_records: list[reporting.StepRecord] = []
    overall_ok = True
    last_reason = ""

    for idx, action in enumerate(actions, 1):
        if idx > cfg.max_steps:
            _console.print(f"[yellow]Step cap reached ({cfg.max_steps}).[/yellow]")
            overall_ok = False
            last_reason = "step cap reached"
            break

        _console.print(f"[bold]Step {idx}[/bold] {_action_repr(action)}")

        if cfg.require_confirm and _looks_destructive(action):
            if not confirm_action(
                f"About to execute a destructive-looking action:\n  {_action_repr(action)}\n\n"
                f"Rationale: {action.rationale or '(none)'}"
            ):
                _console.print("[yellow]Skipped by user.[/yellow]")
                overall_ok = False
                last_reason = "skipped by user"
                break

        step_start = time.time()
        shot_before = run_shot_dir / f"{idx:02d}_before.png"
        visual.take_screenshot(shot_before)

        def _locator(desc: str, _shot=shot_before):
            return visual.locate(_shot, desc, model=cfg.model)

        try:
            exec_result = execution.execute(action, _locator)
        except Exception as exc:
            exec_result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

        time.sleep(0.5)
        shot_after = run_shot_dir / f"{idx:02d}_after.png"
        visual.take_screenshot(shot_after)

        if idx == len(actions) and expected:
            vres = verification.verify(
                expected, shot_after, mode=cfg.verify_mode, model=cfg.model
            )
        else:
            ok = bool(exec_result.get("ok"))
            reason = "executed" if ok else f"execution failed: {exec_result.get('error', '?')}"
            vres = verification.VerifyResult(ok=ok, reason=reason, evidence_screenshot=shot_after)

        duration_ms = int((time.time() - step_start) * 1000)
        step_records.append(
            reporting.StepRecord(
                index=idx,
                action_repr=_action_repr(action),
                rationale=action.rationale,
                screenshot_before=shot_before,
                screenshot_after=shot_after,
                verify_ok=vres.ok,
                verify_reason=vres.reason,
                duration_ms=duration_ms,
            )
        )

        if not vres.ok:
            _console.print(f"[red]Verify failed:[/red] {vres.reason}")
            overall_ok = False
            last_reason = vres.reason
            break

        _console.print(f"[green]ok[/green] ({duration_ms} ms)")

    finished = datetime.now()
    run_record = reporting.RunRecord(
        goal=goal,
        started_at=started.isoformat(timespec="seconds"),
        finished_at=finished.isoformat(timespec="seconds"),
        overall_ok=overall_ok,
        steps=step_records,
    )
    report_path = reporting.write_markdown(run_record, cfg.report_dir)
    _console.print(f"[cyan]Report:[/cyan] {report_path}")
    return {
        "ok": overall_ok,
        "report": str(report_path),
        "steps": len(step_records),
        "reason": last_reason,
    }
