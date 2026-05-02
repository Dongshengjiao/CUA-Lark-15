from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cua_lark.agent.service import AgentService
from cua_lark.cli import load_case
from cua_lark.config import ClaudeSettings, load_claude_settings
from cua_lark.executors.base import ActionExecutor
from cua_lark.executors.dry_run import DryRunExecutor
from cua_lark.executors.lark_cli import LarkCliExecutor
from cua_lark.executors.macos import MacOSExecutor
from cua_lark.perception.base import PerceptionAdapter
from cua_lark.perception.macos import MacOSScreenCaptureAdapter
from cua_lark.perception.mock import MockPerceptionAdapter
from cua_lark.planners.rule_based import RuleBasedPlanner
from cua_lark.reporting.files import ensure_artifacts_dir, save_run_artifacts
from cua_lark.reporting.markdown import MarkdownReporter
from cua_lark.validators.composite import CompositeValidator


PATH_SPECS: dict[str, dict[str, str]] = {
    "dry-run": {"executor": "dry-run", "perception": "mock"},
    "macos": {"executor": "macos", "perception": "macos"},
    "browser": {"executor": "browser", "perception": "browser"},
    "lark-cli": {"executor": "lark-cli", "perception": "mock"},
}


def _build_executor(name: str, settings: ClaudeSettings) -> ActionExecutor:
    if name == "macos":
        return MacOSExecutor(settings.desktop)
    if name == "browser":
        from cua_lark.executors.browser import BrowserExecutor

        return BrowserExecutor(settings.browser)
    if name == "lark-cli":
        return LarkCliExecutor()
    return DryRunExecutor()


def _build_perception(
    name: str, artifacts_dir: Path, settings: ClaudeSettings
) -> PerceptionAdapter:
    if name == "macos":
        return MacOSScreenCaptureAdapter(artifacts_dir=artifacts_dir)
    if name == "browser":
        from cua_lark.perception.browser import BrowserPerceptionAdapter

        return BrowserPerceptionAdapter(
            artifacts_dir=artifacts_dir, browser_config=settings.browser
        )
    return MockPerceptionAdapter()


def _build_service(
    path_name: str, artifacts_dir: Path, settings: ClaudeSettings
) -> AgentService:
    spec = PATH_SPECS[path_name]
    executor = _build_executor(spec["executor"], settings)
    perception = _build_perception(spec["perception"], artifacts_dir, settings)
    return AgentService(
        perception=perception,
        planner=RuleBasedPlanner(),
        executor=executor,
        validator=CompositeValidator(),
    )


def _render_benchmark(
    case_ids: list[str],
    path_names: list[str],
    matrix: dict[tuple[str, str], dict[str, Any]],
    case_dir: Path,
    started_at: str,
    ended_at: str,
) -> str:
    lines = [
        "# CUA-Lark Benchmark Report",
        "",
        f"- Case directory: `{case_dir}`",
        f"- Paths: {', '.join(f'`{p}`' for p in path_names)}",
        f"- Started: `{started_at}`",
        f"- Ended: `{ended_at}`",
        "",
        "## Pass/Fail Matrix",
        "",
    ]

    header = "| case |" + "".join(f" {name} |" for name in path_names)
    sep = "|------|" + "".join("---|" for _ in path_names)
    lines.extend([header, sep])
    for case_id in case_ids:
        row = [f"| `{case_id}` |"]
        for path in path_names:
            entry = matrix.get((case_id, path))
            if entry is None:
                row.append(" - |")
            else:
                row.append(f" {'PASS' if entry['success'] else 'FAIL'} |")
        lines.append("".join(row))

    lines.extend(["", "## Per-Run Artifacts", ""])
    for case_id in case_ids:
        lines.append(f"### `{case_id}`")
        for path in path_names:
            entry = matrix.get((case_id, path))
            if entry is None:
                lines.append(f"- `{path}`: skipped")
                continue
            status = "PASS" if entry["success"] else "FAIL"
            lines.append(
                f"- `{path}`: {status} - {entry.get('validation_message', '')} "
                f"(run: `{entry.get('run_dir', '')}`)"
            )
        lines.append("")

    totals_per_path: dict[str, dict[str, int]] = {}
    for path in path_names:
        passed = sum(
            1
            for case_id in case_ids
            if matrix.get((case_id, path)) is not None
            and matrix[(case_id, path)]["success"]
        )
        total = sum(
            1
            for case_id in case_ids
            if matrix.get((case_id, path)) is not None
        )
        totals_per_path[path] = {"passed": passed, "total": total}

    lines.extend(["## Totals", ""])
    for path in path_names:
        totals = totals_per_path[path]
        lines.append(
            f"- `{path}`: {totals['passed']}/{totals['total']} passed"
        )
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run a batch of CUA-Lark test cases, optionally through multiple executor paths"
    )
    parser.add_argument("case_dir", type=Path, help="Directory containing json test cases")
    parser.add_argument(
        "--executor",
        choices=list(PATH_SPECS.keys()),
        default=None,
        help="Single-path mode: pick one executor (paired with a sensible perception)",
    )
    parser.add_argument(
        "--paths",
        nargs="+",
        choices=list(PATH_SPECS.keys()),
        default=None,
        help="Multi-path mode: run cases through several executors and emit a benchmark matrix",
    )
    parser.add_argument(
        "--artifacts-dir", type=Path, default=Path("reports"), help="Artifacts root"
    )
    args = parser.parse_args()

    if args.paths:
        path_names = args.paths
    elif args.executor:
        path_names = [args.executor]
    else:
        path_names = ["dry-run"]

    root = Path.cwd()
    settings = load_claude_settings(root)
    artifacts_dir = ensure_artifacts_dir(args.artifacts_dir)
    reporter = MarkdownReporter()

    case_paths = sorted(args.case_dir.glob("*.json"))
    if not case_paths:
        raise SystemExit(f"No json cases found under {args.case_dir}")

    started_at = datetime.now(timezone.utc).isoformat()
    matrix: dict[tuple[str, str], dict[str, Any]] = {}
    case_ids: list[str] = []
    summary: list[dict[str, Any]] = []

    for path_name in path_names:
        spec = PATH_SPECS[path_name]
        service = _build_service(path_name, artifacts_dir, settings)
        for case_path in case_paths:
            case = load_case(case_path)
            if case.id not in case_ids:
                case_ids.append(case.id)
            try:
                result = service.run_case(case)
                markdown = reporter.render(result)
                artifact_paths = save_run_artifacts(
                    artifacts_dir,
                    result,
                    markdown,
                    executor=spec["executor"],
                    perception=spec["perception"],
                    model=settings.model,
                )
                entry: dict[str, Any] = {
                    "case_id": result.case_id,
                    "case_name": result.case_name,
                    "path": path_name,
                    "executor": spec["executor"],
                    "perception": spec["perception"],
                    "success": result.success,
                    "validation_message": result.validation.message,
                    "run_dir": str(artifact_paths["run_dir"]),
                    "report_path": str(artifact_paths["report"]),
                }
            except Exception as exc:
                entry = {
                    "case_id": case.id,
                    "case_name": case.name,
                    "path": path_name,
                    "executor": spec["executor"],
                    "perception": spec["perception"],
                    "success": False,
                    "validation_message": f"runtime error: {exc}",
                    "run_dir": "",
                    "report_path": "",
                }
            matrix[(entry["case_id"], path_name)] = entry
            summary.append(entry)
            status = "PASS" if entry["success"] else "FAIL"
            print(f"[{status}] {path_name} :: {entry['case_id']}")

    ended_at = datetime.now(timezone.utc).isoformat()

    batch_dir = ensure_artifacts_dir(artifacts_dir / "batch")
    benchmark_md = _render_benchmark(
        case_ids, path_names, matrix, args.case_dir, started_at, ended_at
    )
    benchmark_md_path = batch_dir / "benchmark.md"
    benchmark_md_path.write_text(benchmark_md, encoding="utf-8")

    benchmark_payload = {
        "case_dir": str(args.case_dir),
        "paths": path_names,
        "started_at": started_at,
        "ended_at": ended_at,
        "model": settings.model,
        "results": summary,
    }
    benchmark_json_path = batch_dir / "benchmark.json"
    benchmark_json_path.write_text(
        json.dumps(benchmark_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    summary_path = batch_dir / "latest-summary.json"
    summary_path.write_text(
        json.dumps(benchmark_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    totals_per_path = {
        path: {
            "passed": sum(
                1
                for entry in summary
                if entry["path"] == path and entry["success"]
            ),
            "total": sum(1 for entry in summary if entry["path"] == path),
        }
        for path in path_names
    }
    for path, totals in totals_per_path.items():
        print(f"[{path}] {totals['passed']}/{totals['total']} passed")
    print(f"Benchmark report: {benchmark_md_path}")
    print(f"Benchmark data: {benchmark_json_path}")


if __name__ == "__main__":
    main()
