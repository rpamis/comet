from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import conftest as langfuse_conftest
import pytest

from scaffold.python.langfuse_adapter import (
    LangfuseConfig,
    LangfuseConfigurationError,
    LangfuseReportingError,
    LangfuseRunReporter,
    create_client,
    enable_trajectory_environment,
    trajectory_mode,
)
from scaffold.python.eval_context import resolve_eval_context


class FakeObservation:
    trace_id = "trace-1"
    id = "observation-1"

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def update(self, **payload):
        self.output = payload["output"]


class FakeClient:
    def __init__(self):
        self.observation = FakeObservation()
        self.scores = []
        self.flushed = False

    def auth_check(self):
        return True

    def start_as_current_observation(self, **kwargs):
        self.input = kwargs
        return self.observation

    def create_score(self, **kwargs):
        self.scores.append(kwargs)

    def flush(self):
        self.flushed = True


def test_langfuse_config_requires_credentials_before_client_creation():
    with pytest.raises(LangfuseConfigurationError, match="LANGFUSE_PUBLIC_KEY"):
        LangfuseConfig.from_environment({})


def test_create_client_authenticates_before_returning():
    calls = []
    client = FakeClient()

    def factory(**kwargs):
        calls.append(kwargs)
        return client

    created = create_client(
        LangfuseConfig("pk", "sk", "https://example.test", "ci"),
        client_factory=factory,
    )

    assert created is client
    assert calls == [
        {
            "public_key": "pk",
            "secret_key": "sk",
            "base_url": "https://example.test",
            "environment": "ci",
        }
    ]


def test_reporter_writes_core_trace_scores_and_flushes():
    client = FakeClient()
    result = SimpleNamespace(
        passed=True,
        checks_passed=["one", "two"],
        checks_failed=[],
        run_id="run-1",
        events_summary={"num_turns": 2},
    )
    reporter = LangfuseRunReporter(client)

    reporter.report_case("task", "CONTROL", lambda: None, lambda: result)
    reporter.flush()

    assert client.input["name"] == "comet.eval.run"
    assert client.observation.output["passed"] is True
    assert {score["name"] for score in client.scores} == {
        "comet.passed",
        "comet.checks_pass_rate",
    }
    assert (
        next(score for score in client.scores if score["name"] == "comet.passed")["value"] is True
    )
    assert all(score["trace_id"] == "trace-1" for score in client.scores)
    assert client.flushed is True


def test_summary_publishes_pass_metrics_and_quality_gate():
    client = FakeClient()
    reporter = LangfuseRunReporter(client)
    passing = SimpleNamespace(
        passed=True,
        checks_passed=["[RUBRIC] weighted_score: 0.90 - ok"],
        checks_failed=[],
        events_summary={"quality_gates": {"minWeightedScore": 0.8}},
    )
    failing = SimpleNamespace(
        passed=False,
        checks_passed=["[RUBRIC] weighted_score: 0.40 - low"],
        checks_failed=["failed"],
        events_summary={"quality_gates": {"minWeightedScore": 0.8}},
    )

    reporter.report_case("task", "CONTROL", lambda: None, lambda: passing)
    reporter.report_case("task", "CONTROL", lambda: None, lambda: failing)
    reporter.report_summary()

    assert client.observation.output["aggregates"]["task/CONTROL"]["pass_at_k"][1] == 0.5
    assert {score["name"] for score in client.scores} >= {
        "comet.pass_at_k",
        "comet.pass_power_k",
        "comet.quality_gate",
    }
    pass_scores = [score for score in client.scores if score["name"] == "comet.pass_at_k"]
    assert {score["metadata"]["k"] for score in pass_scores} == {1, 2, 5}
    assert all(score["metadata"]["task"] == "task" for score in pass_scores)
    assert all(score["metadata"]["treatment"] == "CONTROL" for score in pass_scores)


def test_xdist_master_rebuilds_one_complete_summary_from_local_reports(tmp_path: Path, monkeypatch):
    reports = tmp_path / "experiments" / "exp-1" / "reports"
    reports.mkdir(parents=True)
    (reports / "task_control_r1_report.json").write_text(
        json.dumps(
            {
                "run_id": "run-1",
                "passed": True,
                "checks_passed": ["ok"],
                "checks_failed": [],
                "events_summary": {
                    "task": "task",
                    "treatment": "CONTROL",
                    "sample": 1,
                    "agent": "codex",
                },
            }
        ),
        encoding="utf-8",
    )
    client = FakeClient()
    reporter = LangfuseRunReporter(client)
    monkeypatch.setattr(langfuse_conftest, "_LANGFUSE_REPORTER", reporter)
    monkeypatch.setenv("BENCH_LOGS_DIR", str(tmp_path))
    monkeypatch.setenv("COMET_EVAL_EXPERIMENT_ID", "exp-1")
    session = SimpleNamespace(
        config=SimpleNamespace(option=SimpleNamespace(numprocesses=2)), exitstatus=0
    )

    langfuse_conftest.pytest_sessionfinish(session, 0)

    assert client.observation.output["cases"] == 1
    assert client.observation.output["aggregates"]["task/CONTROL"]["runs"] == 1
    assert client.flushed is True
    assert session.exitstatus == 0


def test_xdist_master_reads_reports_from_the_resolved_owner_runs_root(tmp_path: Path, monkeypatch):
    skill = tmp_path / "skill"
    owner = tmp_path / "owner"
    skill.mkdir()
    owner.mkdir()
    (skill / "SKILL.md").write_text("# Demo\n", encoding="utf-8")
    context = resolve_eval_context(skill_path=skill, project_root=owner)
    reports = context.artifact_root / "runs" / "exp-owner" / "reports"
    reports.mkdir(parents=True)
    (reports / "task_control_r1_report.json").write_text(
        json.dumps(
            {
                "run_id": "run-owner",
                "passed": True,
                "checks_passed": ["ok"],
                "checks_failed": [],
                "events_summary": {
                    "task": "task",
                    "treatment": "CONTROL",
                    "sample": 1,
                    "agent": "codex",
                },
            }
        ),
        encoding="utf-8",
    )
    client = FakeClient()
    reporter = LangfuseRunReporter(client)
    monkeypatch.setattr(langfuse_conftest, "_LANGFUSE_REPORTER", reporter)
    monkeypatch.setenv("COMET_EVAL_CONTEXT", json.dumps(context.to_payload()))
    monkeypatch.setenv("COMET_EVAL_EXPERIMENT_ID", "exp-owner")
    session = SimpleNamespace(
        config=SimpleNamespace(option=SimpleNamespace(numprocesses=2)), exitstatus=0
    )

    langfuse_conftest.pytest_sessionfinish(session, 0)

    assert client.observation.output["cases"] == 1
    assert client.observation.output["aggregates"]["task/CONTROL"]["runs"] == 1


def test_langfuse_default_trajectory_cache_is_owned_by_the_resolved_owner(tmp_path: Path):
    skill = tmp_path / "skill"
    owner = tmp_path / "owner"
    skill.mkdir()
    owner.mkdir()
    (skill / "SKILL.md").write_text("# Demo\n", encoding="utf-8")
    context = resolve_eval_context(skill_path=skill, project_root=owner)

    assert langfuse_conftest.default_trajectory_cache_root(context) == (
        owner / ".comet" / "eval" / "cache" / "langfuse" / "plugins"
    )


def test_langfuse_context_cache_ignores_an_external_environment_override(tmp_path: Path, monkeypatch):
    skill = tmp_path / "skill"
    owner = tmp_path / "owner"
    external = tmp_path / "external-cache"
    skill.mkdir()
    owner.mkdir()
    external.mkdir()
    (skill / "SKILL.md").write_text("# Demo\n", encoding="utf-8")
    context = resolve_eval_context(skill_path=skill, project_root=owner)
    monkeypatch.setenv("LANGFUSE_TRAJECTORY_CACHE_DIR", str(external))

    resolved = langfuse_conftest.resolve_trajectory_cache_root(context, owner)

    assert resolved == owner / ".comet" / "eval" / "cache" / "langfuse" / "plugins"


def test_trajectory_modes_expose_official_and_transcript_adapters():
    config = LangfuseConfig("pk", "sk")
    mode = enable_trajectory_environment(config, "qoder")

    assert mode == "qoder-stop-transcript"
    assert trajectory_mode("claude-code") == "official-claude-code-plugin"
    assert trajectory_mode("codex") == "official-codex-plugin"
    assert trajectory_mode("codebuddy") == "codebuddy-stop-transcript"


def test_core_score_failure_is_strict():
    client = FakeClient()

    def fail_score(**kwargs):
        raise RuntimeError("offline")

    client.create_score = fail_score
    reporter = LangfuseRunReporter(client)
    result = SimpleNamespace(passed=True, checks_passed=["ok"], checks_failed=[])

    with pytest.raises(LangfuseReportingError, match="core score failed"):
        reporter.report_case("task", "CONTROL", lambda: None, lambda: result)
