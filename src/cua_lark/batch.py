from __future__ import annotations

import argparse
import json
from pathlib import Path

from cua_lark.agent.service import AgentService
from cua_lark.cli import load_case
from cua_lark.config import load_claude_settings
from cua_lark.executors.dry_run import DryRunExecutor
from cua_lark.executors.macos import MacOSExecutor
from cua_lark.perception.macos import MacOSScreenCaptureAdapter
from cua_lark.perception.mock import MockPerceptionAdapter
from cua_lark.planners.rule_based import RuleBasedPlanner
from cua_lark.reporting.files import ensure_artifacts_dir, save_run_artifacts
from cua_lark.reporting.markdown import MarkdownReporter
from cua_lark.validators.composite import CompositeValidator


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a batch of CUA-Lark test cases")
    parser.add_argument("case_dir", type=Path, help="Directory containing json test cases")
    parser.add_argument("--executor", choices=["dry-run", "macos"], default="dry-run")
    parser.add_argument("--perception", choices=["mock", "macos"], default="mock")
    parser.add_argument("--artifacts-dir", type=Path, default=Path("reports"))
    args = parser.parse_args()

    root = Path.cwd()
    settings = load_claude_settings(root)
    artifacts_dir = ensure_artifacts_dir(args.artifacts_dir)
    reporter = MarkdownReporter()

    if args.perception == "macos":
        perception = MacOSScreenCaptureAdapter(artifacts_dir=artifacts_dir)
    else:
        perception = MockPerceptionAdapter()

    if args.executor == "macos":
        executor = MacOSExecutor(settings.desktop)
    else:
        executor = DryRunExecutor()

    service = AgentService(
        perception=perception,
        planner=RuleBasedPlanner(),
        executor=executor,
        validator=CompositeValidator(),
    )

    case_paths = sorted(args.case_dir.glob("*.json"))
    if not case_paths:
        raise SystemExit(f"No json cases found under {args.case_dir}")

    summary: list[dict[str, object]] = []

    for case_path in case_paths:
        case = load_case(case_path)
        result = service.run_case(case)
        markdown = reporter.render(result)
        artifact_paths = save_run_artifacts(
            artifacts_dir,
            result,
            markdown,
            executor=args.executor,
            perception=args.perception,
            model=settings.model,
        )
        summary.append(
            {
                "case_id": result.case_id,
                "case_name": result.case_name,
                "success": result.success,
                "validation_message": result.validation.message,
                "final_front_window_app": result.metadata.get("final_observation", {})
                .get("metadata", {})
                .get("front_window_app"),
                "final_front_window_title": result.metadata.get("final_observation", {})
                .get("metadata", {})
                .get("front_window_title"),
                "final_screenshot_path": result.metadata.get("final_observation", {})
                .get("metadata", {})
                .get("screenshot_path"),
                "report_path": str(artifact_paths["report"]),
            }
        )
        print(f"[{'PASS' if result.success else 'FAIL'}] {result.case_id} -> {artifact_paths['run_dir']}")

    passed = sum(1 for item in summary if item["success"])
    failed = len(summary) - passed
    batch_payload = {
        "case_dir": str(args.case_dir),
        "executor": args.executor,
        "perception": args.perception,
        "model": settings.model,
        "passed": passed,
        "failed": failed,
        "results": summary,
    }
    summary_path = ensure_artifacts_dir(artifacts_dir / "batch") / "latest-summary.json"
    summary_path.write_text(json.dumps(batch_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Batch summary: passed={passed} failed={failed}")
    print(f"Summary file: {summary_path}")


if __name__ == "__main__":
    main()
