"""LangSmith suite task runner.

Wraps the local task runner with LangSmith's pytest integration. Each
``(task, treatment)`` run syncs to a LangSmith dataset example + experiment:

- ``log_inputs`` / ``log_reference_outputs`` capture the task prompt and the
  ground-truth expectations (expected artifacts, required skills, rubric).
- ``log_outputs`` captures the run's efficiency metrics and invoked skills.
- ``log_feedback`` reports each rubric dimension score (and the check pass rate),
  so CONTROL vs skill-injected treatments compare directly in the experiment view.
- Trajectory tracing (official ``langsmith-tracing`` Claude Code plugin) nests
  under the same run via ``CC_LANGSMITH_PARENT_DOTTED_ORDER`` when a prebuilt
  plugin dir is provided through ``CC_LANGSMITH_PLUGIN_DIR``.

The local suite stays completely free of any LangSmith import; this module only
adds a thin logging wrapper around the unchanged local runner.
"""

import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

from scaffold.python.tasks import load_task
from scaffold.python.logging import TreatmentResult

# ---------------------------------------------------------------------------
# Load the local runner as a module (do NOT re-export its test_task_treatment;
# we wrap it below). pytest_generate_tests and any non-task unit tests are
# re-exported unchanged so parametrization and coverage stay identical.
# ---------------------------------------------------------------------------
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

# LangSmith helpers are optional; degrade to a plain pass-through when the
# ``langsmith`` extra is not installed so collection never crashes.
try:
    from langsmith import testing as ls_testing
    from langsmith import get_current_run_tree
    from langsmith.testing import _internal as ls_testing_internal

    _LANGSMITH_AVAILABLE = True
except Exception:  # pragma: no cover - import guard
    ls_testing = None
    get_current_run_tree = None
    ls_testing_internal = None
    _LANGSMITH_AVAILABLE = False

try:
    from scaffold.python.logging import _rubric_scores as _extract_rubric_scores
except Exception:  # pragma: no cover - fallback if private helper moves
    import re as _re

    _RUBRIC_RE = _re.compile(r"\[RUBRIC\]\s+(\S+):\s*([0-9.]+)")

    def _extract_rubric_scores(result):
        scores = {}
        for check in getattr(result, "checks_passed", []):
            match = _RUBRIC_RE.search(check)
            if match:
                try:
                    scores[match.group(1)] = float(match.group(2))
                except ValueError:
                    continue
        return scores


# =============================================================================
# LANGSMITH LOGGING HELPERS (all best-effort; never break the eval run)
# =============================================================================


def _safe(fn, label=None):
    """Call a LangSmith logging fn, swallowing errors so tracing never fails a run."""
    try:
        fn()
    except Exception as exc:  # pragma: no cover - defensive
        if label:
            print(f"[langsmith] {label} failed: {exc}", file=sys.stderr)


def _install_failed_end_run_outputs_patch():
    """Preserve log_outputs payloads when LangSmith ends a failed pytest run."""
    if not _LANGSMITH_AVAILABLE or ls_testing_internal is None:
        return
    test_case_cls = getattr(ls_testing_internal, "_TestCase", None)
    if test_case_cls is None:
        return
    original = getattr(test_case_cls, "end_run", None)
    if original is None or getattr(original, "_comet_preserve_logged_outputs", False):
        return

    def end_run(self, run_tree, outputs):
        if outputs is None and getattr(self, "_logged_outputs", None) is not None:
            outputs = self._logged_outputs
        return original(self, run_tree, outputs)

    end_run._comet_preserve_logged_outputs = True
    end_run._comet_original = original
    test_case_cls.end_run = end_run


_install_failed_end_run_outputs_patch()


def _log_inputs_and_reference(task_name, treatment_name):
    if not _LANGSMITH_AVAILABLE:
        return
    try:
        task = load_task(task_name)
        evaluation = task.config.evaluation
        _safe(
            lambda: ls_testing.log_inputs(
                {
                    "task": task_name,
                    "treatment": treatment_name,
                    "difficulty": getattr(task.config.metadata, "difficulty", None),
                }
            )
        )
        _safe(
            lambda: ls_testing.log_reference_outputs(
                {
                    "expected_artifacts": list(evaluation.expected_artifacts or []),
                    "required_skills": list(evaluation.required_skills or []),
                    "rubric_criteria": list(evaluation.rubric_criteria or []),
                }
            )
        )
    except Exception:  # pragma: no cover - defensive
        pass


def _set_parent_run_env():
    """Point the Claude Code plugin at this test's run so its trajectory nests here."""
    if not _LANGSMITH_AVAILABLE or get_current_run_tree is None:
        return None
    try:
        run_tree = get_current_run_tree()
        dotted_order = getattr(run_tree, "dotted_order", None) if run_tree else None
    except Exception:  # pragma: no cover - defensive
        dotted_order = None
    if dotted_order:
        os.environ["CC_LANGSMITH_PARENT_DOTTED_ORDER"] = dotted_order
    return dotted_order


def _result_from_logger(logger, treatment_name):
    runs = logger.results.get(treatment_name) or []
    if runs:
        return runs[-1]

    parametrized_suffix = f"-{treatment_name}-"
    for result_name, result_runs in reversed(list(logger.results.items())):
        if result_name == treatment_name or parametrized_suffix in result_name:
            return result_runs[-1] if result_runs else None
    return None


def _iter_result_loggers():
    seen = set()
    candidates = [
        getattr(_local_test_tasks, "conftest", None),
        sys.modules.get("conftest"),
        sys.modules.get("_comet_local_conftest"),
    ]
    for module in candidates:
        plugin = getattr(module, "_plugin", None) if module else None
        logger = getattr(plugin, "logger", None) if plugin else None
        if logger is not None and id(logger) not in seen:
            seen.add(id(logger))
            yield logger


def _latest_report_result(treatment_name):
    logs_dir = Path(os.environ.get("BENCH_LOGS_DIR", ""))
    if not logs_dir:
        return None
    reports_root = logs_dir / "experiments"
    if not reports_root.exists():
        return None
    parametrized_suffix = f"-{treatment_name}-"
    report_files = sorted(
        reports_root.glob("*/reports/*_report.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for report_file in report_files:
        try:
            report = json.loads(report_file.read_text())
        except Exception:
            continue
        result_name = report.get("name", "")
        if result_name != treatment_name and parametrized_suffix not in result_name:
            continue
        return TreatmentResult(
            name=result_name,
            passed=report.get("passed", False),
            checks_passed=report.get("checks_passed", []),
            checks_failed=report.get("checks_failed", []),
            events_summary=report.get("events_summary", {}),
            run_id=report.get("run_id", ""),
        )
    return None


def _latest_result(treatment_name):
    for logger in _iter_result_loggers():
        result = _result_from_logger(logger, treatment_name)
        if result is not None:
            return result
    return _latest_report_result(treatment_name)


def _log_outputs_and_feedback(result):
    if not _LANGSMITH_AVAILABLE:
        return
    if result is None:
        print("[langsmith] no local eval result found; outputs/feedback not logged.", file=sys.stderr)
        return
    summary = getattr(result, "events_summary", {}) or {}
    outputs = {
        "run_id": getattr(result, "run_id", ""),
        "passed": getattr(result, "passed", None),
        "checks_passed": len(getattr(result, "checks_passed", [])),
        "checks_failed": len(getattr(result, "checks_failed", [])),
        "num_turns": summary.get("num_turns"),
        "tool_calls": summary.get("tool_calls"),
        "duration_seconds": summary.get("duration_seconds"),
        "total_tokens": summary.get("total_tokens"),
        "total_cost_usd": summary.get("total_cost_usd"),
        "skills_invoked": summary.get("skills_invoked", []),
    }
    _safe(
        lambda: ls_testing.log_outputs(outputs)
    )

    passed = len(getattr(result, "checks_passed", []))
    failed = len(getattr(result, "checks_failed", []))
    total = passed + failed
    if total:
        _safe(
            lambda: ls_testing.log_feedback(key="checks_pass_rate", score=passed / total),
            label="log_feedback checks_pass_rate",
        )

    for dim, score in _extract_rubric_scores(result).items():
        _safe(
            lambda d=dim, s=score: ls_testing.log_feedback(key=f"rubric.{d}", score=s),
            label=f"log_feedback rubric.{dim}",
        )


# =============================================================================
# TEST
# =============================================================================


@pytest.mark.timeout(PYTEST_TIMEOUT)
@pytest.mark.langsmith
def test_task_treatment(task_name, treatment_name):
    """Run a task+treatment via the local runner and log results to LangSmith."""
    _log_inputs_and_reference(task_name, treatment_name)
    _set_parent_run_env()
    try:
        _run_local_task_treatment(task_name, treatment_name)
    finally:
        _log_outputs_and_feedback(_latest_result(treatment_name))
        os.environ.pop("CC_LANGSMITH_PARENT_DOTTED_ORDER", None)

