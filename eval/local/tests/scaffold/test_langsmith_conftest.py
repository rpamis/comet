"""Unit tests for LangSmith eval suite configuration helpers."""

from __future__ import annotations

import inspect
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
import json


def _load_langsmith_conftest():
    eval_root = Path(__file__).resolve().parents[3]
    conftest_path = eval_root / "langsmith" / "tests" / "conftest.py"
    spec = importlib.util.spec_from_file_location("_test_langsmith_conftest", conftest_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _load_langsmith_task_tests():
    eval_root = Path(__file__).resolve().parents[3]
    task_tests_path = eval_root / "langsmith" / "tests" / "tasks" / "test_tasks.py"
    sys.modules.pop("_test_langsmith_task_tests", None)
    sys.modules.pop("_comet_local_test_tasks", None)
    spec = importlib.util.spec_from_file_location("_test_langsmith_task_tests", task_tests_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_langsmith_env_derives_claude_code_plugin_settings(monkeypatch):
    module = _load_langsmith_conftest()
    for key in (
        "LANGSMITH_API_KEY",
        "LANGSMITH_PROJECT",
        "LANGSMITH_TRACING",
        "TRACE_TO_LANGSMITH",
        "CC_LANGSMITH_API_KEY",
        "CC_LANGSMITH_PROJECT",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2_pt_test")
    monkeypatch.setenv("LANGSMITH_PROJECT", "comet-tests")

    module.configure_langsmith_environment()

    assert module.os.environ["LANGSMITH_TRACING"] == "true"
    assert module.os.environ["TRACE_TO_LANGSMITH"] == "true"
    assert module.os.environ["CC_LANGSMITH_API_KEY"] == "lsv2_pt_test"
    assert module.os.environ["CC_LANGSMITH_PROJECT"] == "comet-tests"


def test_langsmith_env_preserves_explicit_claude_code_overrides(monkeypatch):
    module = _load_langsmith_conftest()
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2_pt_eval")
    monkeypatch.setenv("LANGSMITH_PROJECT", "eval-project")
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("TRACE_TO_LANGSMITH", "custom")
    monkeypatch.setenv("CC_LANGSMITH_API_KEY", "lsv2_pt_plugin")
    monkeypatch.setenv("CC_LANGSMITH_PROJECT", "plugin-project")

    module.configure_langsmith_environment()

    assert module.os.environ["LANGSMITH_TRACING"] == "false"
    assert module.os.environ["TRACE_TO_LANGSMITH"] == "custom"
    assert module.os.environ["CC_LANGSMITH_API_KEY"] == "lsv2_pt_plugin"
    assert module.os.environ["CC_LANGSMITH_PROJECT"] == "plugin-project"


def test_langsmith_tracing_auto_builds_default_plugin_cache(monkeypatch, tmp_path):
    module = _load_langsmith_conftest()
    plugin_dir = tmp_path / "langsmith-cc-plugin"
    calls = []

    monkeypatch.setattr(module, "DEFAULT_LANGSMITH_PLUGIN_DIR", plugin_dir)
    monkeypatch.delenv("CC_LANGSMITH_PLUGIN_DIR", raising=False)
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("TRACE_TO_LANGSMITH", "true")

    def fake_build(target):
        calls.append(target)
        target.mkdir(parents=True)
        return True

    monkeypatch.setattr(module, "_build_default_langsmith_plugin", fake_build)

    resolved = module.provision_langsmith_plugin_dir()

    assert resolved == plugin_dir
    assert calls == [plugin_dir]
    assert module.os.environ["CC_LANGSMITH_PLUGIN_DIR"] == module._plugin_dir_env_value(plugin_dir)


def test_langsmith_task_wrapper_registers_reexported_local_module():
    _load_langsmith_task_tests()

    assert "_comet_local_test_tasks" in sys.modules


def test_langsmith_task_wrapper_does_not_require_pytest_request_fixture():
    module = _load_langsmith_task_tests()

    assert "request" not in inspect.signature(module.test_task_treatment).parameters


def test_langsmith_task_wrapper_finds_parametrized_local_result():
    module = _load_langsmith_task_tests()
    result = object()
    module._local_test_tasks.conftest._plugin = SimpleNamespace(
        logger=SimpleNamespace(
            results={
                "comet-fix-median-CONTROL-r1": [result],
            }
        )
    )

    assert module._latest_result("CONTROL") is result


def test_langsmith_task_wrapper_finds_result_from_loaded_conftest(monkeypatch):
    module = _load_langsmith_task_tests()
    result = object()
    monkeypatch.setattr(module._local_test_tasks.conftest, "_plugin", None, raising=False)
    monkeypatch.setitem(
        sys.modules,
        "conftest",
        SimpleNamespace(
            _plugin=SimpleNamespace(
                logger=SimpleNamespace(
                    results={
                        "comet-fix-median-CONTROL-r1": [result],
                    }
                )
            )
        ),
    )

    assert module._latest_result("CONTROL") is result


def test_langsmith_task_wrapper_falls_back_to_latest_report(monkeypatch, tmp_path):
    module = _load_langsmith_task_tests()
    monkeypatch.setattr(module._local_test_tasks.conftest, "_plugin", None, raising=False)
    monkeypatch.setenv("BENCH_LOGS_DIR", str(tmp_path))
    reports_dir = tmp_path / "experiments" / "experiment_20260703_220136" / "reports"
    reports_dir.mkdir(parents=True)
    report = {
        "name": "comet-fix-median-CONTROL-r1",
        "passed": False,
        "run_id": "local-run-1",
        "checks_passed": ["[RUBRIC] weighted_score: 0.35"],
        "checks_failed": ["openspec_artifacts: missing"],
        "events_summary": {"total_tokens": 123},
    }
    (reports_dir / "comet_fix_median_CONTROL_r1_rep1_report.json").write_text(
        json.dumps(report)
    )

    result = module._latest_result("CONTROL")

    assert result.run_id == "local-run-1"
    assert result.checks_failed == ["openspec_artifacts: missing"]
    assert result.events_summary["total_tokens"] == 123


def test_langsmith_task_wrapper_patches_failed_end_run_outputs():
    module = _load_langsmith_task_tests()

    assert getattr(
        module.ls_testing_internal._TestCase.end_run,
        "_comet_preserve_logged_outputs",
        False,
    )


def test_langsmith_task_wrapper_logs_outputs_and_rubric_feedback(monkeypatch):
    module = _load_langsmith_task_tests()
    calls = []
    monkeypatch.setattr(
        module,
        "ls_testing",
        SimpleNamespace(
            log_outputs=lambda outputs: calls.append(("outputs", outputs)),
            log_feedback=lambda **kwargs: calls.append(("feedback", kwargs)),
        ),
    )
    result = SimpleNamespace(
        run_id="local-run-1",
        passed=False,
        checks_passed=[
            "tests_written: ok",
            "[RUBRIC] skill_invocation: 0.20 - missing deps",
            "[RUBRIC] weighted_score: 0.35",
        ],
        checks_failed=["openspec_artifacts: missing"],
        events_summary={"total_tokens": 123, "skills_invoked": ["comet"]},
    )

    module._log_outputs_and_feedback(result)

    assert calls == [
        (
            "outputs",
            {
                "run_id": "local-run-1",
                "passed": False,
                "checks_passed": 3,
                "checks_failed": 1,
                "num_turns": None,
                "tool_calls": None,
                "duration_seconds": None,
                "total_tokens": 123,
                "total_cost_usd": None,
                "skills_invoked": ["comet"],
            },
        ),
        ("feedback", {"key": "checks_pass_rate", "score": 0.75}),
        ("feedback", {"key": "rubric.skill_invocation", "score": 0.2}),
        ("feedback", {"key": "rubric.weighted_score", "score": 0.35}),
    ]


def test_langsmith_task_wrapper_keeps_plugin_on_configured_project(monkeypatch):
    module = _load_langsmith_task_tests()
    monkeypatch.delenv("CC_LANGSMITH_PARENT_DOTTED_ORDER", raising=False)
    monkeypatch.setenv("CC_LANGSMITH_PROJECT", "comet-skill-eval")
    monkeypatch.setattr(
        module,
        "get_current_run_tree",
        lambda: SimpleNamespace(
            dotted_order="20260703T000000Z00000000000000000000000000",
            session_name="comet-skill-eval:abc12345",
        ),
    )

    dotted_order = module._set_parent_run_env()

    assert dotted_order == "20260703T000000Z00000000000000000000000000"
    assert module.os.environ["CC_LANGSMITH_PARENT_DOTTED_ORDER"] == dotted_order
    assert module.os.environ["CC_LANGSMITH_PROJECT"] == "comet-skill-eval"
