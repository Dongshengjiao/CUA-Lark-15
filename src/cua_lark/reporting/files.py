from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from cua_lark.models import RunResult


def ensure_artifacts_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_run_artifacts(
    artifacts_dir: Path,
    result: RunResult,
    markdown: str,
    *,
    executor: str,
    perception: str,
    model: str | None,
) -> dict[str, Path]:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_dir = ensure_artifacts_dir(artifacts_dir / "runs" / f"{timestamp}-{result.case_id}")

    report_path = run_dir / "report.md"
    report_path.write_text(markdown, encoding="utf-8")

    payload = {
        "case_id": result.case_id,
        "case_name": result.case_name,
        "success": result.success,
        "product": result.product.value,
        "executor": executor,
        "perception": perception,
        "model": model,
        "result": result.model_dump(mode="json"),
    }
    result_path = run_dir / "result.json"
    result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    latest_path = ensure_artifacts_dir(artifacts_dir / "latest")
    latest_report = latest_path / "report.md"
    latest_result = latest_path / "result.json"
    latest_report.write_text(markdown, encoding="utf-8")
    latest_result.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    return {
        "run_dir": run_dir,
        "report": report_path,
        "result": result_path,
        "latest_report": latest_report,
        "latest_result": latest_result,
    }
