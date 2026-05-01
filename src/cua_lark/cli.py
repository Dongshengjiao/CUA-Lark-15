from __future__ import annotations

import argparse
import json
from pathlib import Path

from cua_lark.agent.service import AgentService
from cua_lark.config import load_claude_settings
from cua_lark.executors.dry_run import DryRunExecutor
from cua_lark.executors.lark_cli import LarkCliExecutor
from cua_lark.executors.macos import MacOSExecutor
from cua_lark.integrations.lark_cli import run_lark_cli_preflight
from cua_lark.integrations.macos import run_macos_preflight
from cua_lark.models import TestCase
from cua_lark.perception.macos import MacOSScreenCaptureAdapter
from cua_lark.perception.mock import MockPerceptionAdapter
from cua_lark.planners.rule_based import RuleBasedPlanner
from cua_lark.reporting.files import ensure_artifacts_dir, save_run_artifacts
from cua_lark.reporting.markdown import MarkdownReporter
from cua_lark.validators.composite import CompositeValidator


def load_case(path: Path) -> TestCase:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return TestCase.model_validate(payload)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a CUA-Lark test case")
    parser.add_argument("case", type=Path, nargs="?", help="Path to a json test case")
    parser.add_argument(
        "--executor",
        choices=["dry-run", "macos", "lark-cli", "browser"],
        default="dry-run",
        help="Action execution backend",
    )
    parser.add_argument(
        "--perception",
        choices=["mock", "macos", "browser"],
        default="mock",
        help="Observation backend",
    )
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        default=Path("reports"),
        help="Directory for screenshots and generated artifacts",
    )
    parser.add_argument(
        "--doctor",
        choices=["lark-cli", "macos"],
        help="Run a toolchain preflight check instead of a test case",
    )
    args = parser.parse_args()

    root = Path.cwd()
    settings = load_claude_settings(root)

    if args.doctor == "lark-cli":
        preflight = run_lark_cli_preflight()
        print(f"Using model: {settings.model or 'not configured'}")
        print("Doctor target: lark-cli")
        print(f"Installed: {preflight.installed}")
        print(f"Ready: {preflight.ready}")
        print(f"Summary: {preflight.summary}")
        if preflight.details:
            print("Details:")
            for detail in preflight.details:
                print(f"- {detail}")
        raise SystemExit(0 if preflight.ready else 1)

    if args.doctor == "macos":
        artifacts_dir = ensure_artifacts_dir(args.artifacts_dir)
        preflight = run_macos_preflight(artifacts_dir=artifacts_dir)
        print(f"Using model: {settings.model or 'not configured'}")
        print("Doctor target: macos")
        print(f"Ready: {preflight.ready}")
        print(f"Summary: {preflight.summary}")
        if preflight.details:
            print("Details:")
            for detail in preflight.details:
                print(f"- {detail}")
        raise SystemExit(0 if preflight.ready else 1)

    if args.case is None:
        parser.error("the following arguments are required: case")

    case = load_case(args.case)
    artifacts_dir = ensure_artifacts_dir(args.artifacts_dir)

    if args.perception == "macos":
        perception = MacOSScreenCaptureAdapter(artifacts_dir=artifacts_dir)
    elif args.perception == "browser":
        from cua_lark.perception.browser import BrowserPerceptionAdapter

        perception = BrowserPerceptionAdapter(artifacts_dir=artifacts_dir, browser_config=settings.browser)
    else:
        perception = MockPerceptionAdapter()

    if args.executor == "macos":
        executor = MacOSExecutor(settings.desktop)
    elif args.executor == "browser":
        from cua_lark.executors.browser import BrowserExecutor

        executor = BrowserExecutor(settings.browser)
    elif args.executor == "lark-cli":
        executor = LarkCliExecutor()
    else:
        executor = DryRunExecutor()

    service = AgentService(
        perception=perception,
        planner=RuleBasedPlanner(),
        executor=executor,
        validator=CompositeValidator(),
    )
    try:
        result = service.run_case(case)
    except Exception as exc:
        print(f"Using model: {settings.model or 'not configured'}")
        print(f"Perception backend: {args.perception}")
        print(f"Executor backend: {args.executor}")
        print(f"Run failed: {exc}")
        raise SystemExit(1) from exc

    reporter = MarkdownReporter()
    markdown = reporter.render(result)
    artifact_paths = save_run_artifacts(
        artifacts_dir,
        result,
        markdown,
        executor=args.executor,
        perception=args.perception,
        model=settings.model,
    )
    print(f"Using model: {settings.model or 'not configured'}")
    print(f"Perception backend: {args.perception}")
    print(f"Executor backend: {args.executor}")
    print(f"Artifacts: {artifact_paths['run_dir']}")
    print(markdown)


if __name__ == "__main__":
    main()
