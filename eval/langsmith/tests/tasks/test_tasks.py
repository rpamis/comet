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
import os
from pathlib import Path

import pytest

from scaffold.python.tasks import load_task

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

    _LANGSMITH_AVAILABLE = True
except Exception:  # pragma: no cover - import guard
    ls_testing = None
    get_current_run_tree = None
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


def _safe(fn):
    """Call a LangSmith logging fn, swallowing errors so tracing never fails a run."""
    try:
        fn()
    except Exception:  # pragma: no cover - defensive
        pass


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


def _latest_result(request, treatment_name):
    plugin = request.config.pluginmanager.get_plugin("experiment_plugin")
    logger = getattr(plugin, "logger", None) if plugin else None
    if logger is None:
        return None
    runs = logger.results.get(treatment_name) or []
    return runs[-1] if runs else None


def _log_outputs_and_feedback(result):
    if not _LANGSMITH_AVAILABLE or result is None:
        return
    summary = getattr(result, "events_summary", {}) or {}
    _safe(
        lambda: ls_testing.log_outputs(
            {
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
        )
    )

    passed = len(getattr(result, "checks_passed", []))
    failed = len(getattr(result, "checks_failed", []))
    total = passed + failed
    if total:
        _safe(lambda: ls_testing.log_feedback(key="checks_pass_rate", score=passed / total))

    for dim, score in _extract_rubric_scores(result).items():
        _safe(lambda d=dim, s=score: ls_testing.log_feedback(key=f"rubric.{d}", score=s))


# =============================================================================
# TEST
# =============================================================================


@pytest.mark.timeout(PYTEST_TIMEOUT)
@pytest.mark.langsmith
def test_task_treatment(task_name, treatment_name, request):
    """Run a task+treatment via the local runner and log results to LangSmith."""
    _log_inputs_and_reference(task_name, treatment_name)
    _set_parent_run_env()
    try:
        _run_local_task_treatment(task_name, treatment_name)
    finally:
        _log_outputs_and_feedback(_latest_result(request, treatment_name))
        os.environ.pop("CC_LANGSMITH_PARENT_DOTTED_ORDER", None)

