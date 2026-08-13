"""Langfuse wrapper around the shared local task runner."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest
import conftest

_LOCAL_TEST_TASKS = (
    Path(__file__).resolve().parents[3] / "local" / "tests" / "tasks" / "test_tasks.py"
)
_spec = importlib.util.spec_from_file_location("_comet_local_test_tasks", _LOCAL_TEST_TASKS)
_local_test_tasks = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
sys.modules[_spec.name] = _local_test_tasks
_spec.loader.exec_module(_local_test_tasks)

pytest_generate_tests = _local_test_tasks.pytest_generate_tests
for _name in dir(_local_test_tasks):
    if _name.startswith("test_") and _name != "test_task_treatment":
        globals()[_name] = getattr(_local_test_tasks, _name)

PYTEST_TIMEOUT = _local_test_tasks.PYTEST_TIMEOUT
_run_local_task_treatment = _local_test_tasks.test_task_treatment


def _latest_result(treatment_name):
    candidates = [
        getattr(_local_test_tasks, "conftest", None),
        sys.modules.get("conftest"),
        sys.modules.get("_comet_local_conftest"),
    ]
    seen = set()
    for module in candidates:
        plugin = getattr(module, "_plugin", None) if module else None
        logger = getattr(plugin, "logger", None) if plugin else None
        if logger is None or id(logger) in seen:
            continue
        seen.add(id(logger))
        runs = logger.results.get(treatment_name) or []
        if runs:
            return runs[-1]

    logs_dir = Path(conftest.os.environ.get("BENCH_LOGS_DIR", ""))
    reports_root = logs_dir / "experiments"
    if not reports_root.exists():
        return None
    suffix = f"-{treatment_name}-"
    for report_file in sorted(
        reports_root.glob("*/reports/*_report.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    ):
        try:
            report = json.loads(report_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if report.get("name") == treatment_name or suffix in report.get("name", ""):
            return conftest.TreatmentResult(
                name=report.get("name", treatment_name),
                passed=report.get("passed", False),
                checks_passed=report.get("checks_passed", []),
                checks_failed=report.get("checks_failed", []),
                events_summary=report.get("events_summary", {}),
                run_id=report.get("run_id", ""),
            )
    return None


def _latest_trajectory_path():
    candidates = [
        getattr(_local_test_tasks, "conftest", None),
        sys.modules.get("conftest"),
        sys.modules.get("_comet_local_conftest"),
    ]
    for module in candidates:
        plugin = getattr(module, "_plugin", None) if module else None
        test_dir = getattr(plugin, "last_test_dir", None) if plugin else None
        if test_dir:
            path = Path(test_dir) / ".comet" / "eval" / "langfuse" / "trajectories"
            if path.is_dir() and any(path.glob("*.jsonl")):
                return path
    return None


@pytest.mark.timeout(PYTEST_TIMEOUT)
@pytest.mark.langfuse
def test_task_treatment(task_name, treatment_name):
    """Run the local case and publish strict core results to Langfuse."""
    reporter = getattr(conftest, "_LANGFUSE_REPORTER", None)
    if reporter is None:
        return _run_local_task_treatment(task_name, treatment_name)
    plugin = getattr(conftest._local_conftest, "_plugin", None) or getattr(
        conftest, "_plugin", None
    )
    agent = conftest._resolve_eval_agent(plugin.config).agent if plugin else "claude-code"
    return reporter.report_case(
        task_name,
        treatment_name,
        lambda: _run_local_task_treatment(task_name, treatment_name),
        lambda: _latest_result(treatment_name),
        metadata={"agent": agent},
        trajectory_path=_latest_trajectory_path,
        agent=agent,
    )
