from __future__ import annotations

"""Layer 5: Reporting Layer — Markdown test-summary writer."""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass
class StepRecord:
    index: int
    action_repr: str
    rationale: str | None
    screenshot_before: Path | None
    screenshot_after: Path | None
    verify_ok: bool
    verify_reason: str
    duration_ms: int


@dataclass
class RunRecord:
    goal: str
    started_at: str
    finished_at: str
    overall_ok: bool
    steps: list[StepRecord]


def _slug(s: str, n: int = 48) -> str:
    raw = "".join(c if c.isalnum() else "-" for c in s.lower())
    out = "-".join(p for p in raw.split("-") if p)
    return out[:n] or "run"


def _rel(path: Path, base: Path) -> str:
    try:
        return Path(path).resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return Path(path).as_posix()


def write_markdown(run: RunRecord, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    fname = f"{ts}_{_slug(run.goal)}.md"
    out_path = out_dir / fname

    lines: list[str] = []
    status = "PASS" if run.overall_ok else "FAIL"
    lines.append(f"# CUA-Lark run report — [{status}]")
    lines.append("")
    lines.append(f"- **Goal**: {run.goal}")
    lines.append(f"- **Started**: {run.started_at}")
    lines.append(f"- **Finished**: {run.finished_at}")
    lines.append(f"- **Steps executed**: {len(run.steps)}")
    lines.append(f"- **Overall result**: **{status}**")
    lines.append("")
    lines.append("## Steps")
    lines.append("")

    for s in run.steps:
        step_status = "OK" if s.verify_ok else "FAIL"
        lines.append(f"### Step {s.index} — [{step_status}]")
        lines.append(f"- Action: `{s.action_repr}`")
        if s.rationale:
            lines.append(f"- Rationale: {s.rationale}")
        lines.append(f"- Duration: {s.duration_ms} ms")
        lines.append(f"- Verify: {s.verify_reason}")
        if s.screenshot_after:
            rel = _rel(s.screenshot_after, out_dir)
            lines.append("")
            lines.append(f"![step-{s.index}-after]({rel})")
        lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path
