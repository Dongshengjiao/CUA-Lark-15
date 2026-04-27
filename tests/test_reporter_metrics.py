"""reporter.metrics 单元测试."""

from __future__ import annotations

from agent.reporter.metrics import RunMetrics, summarize


def test_run_metrics_as_dict() -> None:
    m = RunMetrics(
        task_id="im_send_text",
        success=True,
        elapsed_seconds=65.234,
        step_count=3,
        action_count=3,
        llm_calls=9,
        input_tokens=12000,
        output_tokens=300,
    )
    d = m.as_dict()
    assert d["task_id"] == "im_send_text"
    assert d["success"] is True
    assert d["elapsed_seconds"] == 65.23
    assert d["step_count"] == 3
    assert d["llm_calls"] == 9


def test_summarize_empty_runs() -> None:
    assert summarize([]) == {"total": 0}


def test_summarize_basic() -> None:
    runs = [
        RunMetrics(task_id="a", success=True, elapsed_seconds=60.0, step_count=3, llm_calls=10, input_tokens=1000, output_tokens=200),
        RunMetrics(task_id="b", success=False, elapsed_seconds=120.0, step_count=8, llm_calls=24, input_tokens=5000, output_tokens=500),
        RunMetrics(task_id="c", success=True, elapsed_seconds=90.0, step_count=5, llm_calls=15, input_tokens=3000, output_tokens=400),
    ]
    s = summarize(runs)
    assert s["total"] == 3
    assert s["success"] == 2
    assert s["success_rate"] == 0.667
    assert s["avg_elapsed_seconds"] == 90.0
    assert s["avg_step_count"] == 5.3
    assert s["total_input_tokens"] == 9000
    assert s["total_output_tokens"] == 1100
