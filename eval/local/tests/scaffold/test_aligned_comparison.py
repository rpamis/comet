"""Regression tests for strict two-experiment Native vs 0.4.0 comparison."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from local.scripts.compare_baselines import main
from scaffold.python.aligned_comparison import (
    CASE_MANIFEST_SCHEMA,
    CASE_MANIFEST_SCHEMA_V1,
    EXPECTED_CASE_MATRIX_FILENAME,
    EXECUTION_IDENTITY_SCHEMA,
    build_case_manifest,
    build_aligned_report,
    build_execution_identity,
    case_manifest_payload,
    expected_case_matrix_payload,
)
from scaffold.python.report_outputs import render_markdown_html


def _digest(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()


def _manifest(task: str, variant: str = "canonical") -> dict[str, str]:
    components = {
        "task_hash": _digest(f"{task}:task:{variant}"),
        "instruction_hash": _digest(f"{task}:instruction:{variant}"),
        "validator_hash": _digest(f"{task}:validator:{variant}"),
        "environment_hash": _digest(f"{task}:environment:{variant}"),
        "data_hash": _digest(f"{task}:data:{variant}"),
        "prompt_hash": _digest(f"{task}:prompt:{variant}"),
    }
    payload = {
        "schema": CASE_MANIFEST_SCHEMA_V1,
        "task": task,
        **components,
    }
    case_hash = (
        "sha256:"
        + hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
    )
    return {**payload, "case_hash": case_hash}


def _v2_manifest_from_v1(v1: dict[str, str]) -> dict[str, object]:
    execution_identity = {
        "schema": EXECUTION_IDENTITY_SCHEMA,
        "image_id_hash": _digest("image"),
        "image_repo_digests_hash": _digest("repo-digests"),
        "image_ref_hash": _digest("ref"),
        "claude_tool_version_hash": _digest("tool"),
        "model_selection_hash": _digest("model"),
        "interaction_hash": _digest("interaction"),
        "model_source": "explicit",
        "interaction_mode": "auto_user",
        "interaction_max_turns": "3",
    }
    execution_hash = _digest(json.dumps(execution_identity, sort_keys=True, separators=(",", ":")))
    components = {
        key: v1[key]
        for key in (
            "task_hash",
            "instruction_hash",
            "validator_hash",
            "environment_hash",
            "data_hash",
            "prompt_hash",
        )
    }
    components.update(
        {
            "runner_hash": _digest("runner"),
            "controller_hash": _digest("controller"),
            "execution_hash": execution_hash,
        }
    )
    payload = {"schema": CASE_MANIFEST_SCHEMA, "task": v1["task"], **components}
    return {
        **payload,
        "case_hash": _digest(json.dumps(payload, sort_keys=True, separators=(",", ":"))),
        "execution_identity": execution_identity,
    }


def _write_matrix(experiment: Path, cases: list[tuple[str, str, int]]) -> None:
    experiment.mkdir(parents=True, exist_ok=True)
    (experiment / EXPECTED_CASE_MATRIX_FILENAME).write_text(
        json.dumps(expected_case_matrix_payload(cases), indent=2),
        encoding="utf-8",
    )


def _write_run(
    experiment: Path,
    *,
    task: str,
    treatment: str,
    rep: int,
    passed: bool,
    manifest_variant: str = "canonical",
    duration_ms: tuple[int, ...] | None = (1000,),
    result_telemetry: dict | None = None,
) -> None:
    reports = experiment / "reports"
    raw = experiment / "raw"
    reports.mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)
    stem = f"{task.replace('-', '_')}_{treatment}_r{rep}_rep1"
    stdout = raw / f"{stem}_stdout.json"
    if duration_ms is not None:
        stdout.write_text(
            "\n".join(
                json.dumps(
                    {
                        "type": "result",
                        "duration_ms": duration,
                        **(result_telemetry or {}),
                    }
                )
                for duration in duration_ms
            ),
            encoding="utf-8",
        )
    report = {
        "name": f"{task}-{treatment}-r{rep}",
        "rep": 1,
        "passed": passed,
        "checks_passed": [],
        "checks_failed": [] if passed else ["validator failed"],
        "sample_quality": {
            "status": "included",
            "reason_code": "valid_signal",
            "reason": "complete",
            "include_in_analysis": True,
            "confidence": "high",
            "evidence": ["result event present"],
        },
        "events_summary": {
            "duration_seconds": 9999,
            "case_manifest": _manifest(task, manifest_variant),
            "artifact_references": {
                "raw_stdout": str(stdout) if duration_ms is not None else str(stdout),
            },
        },
    }
    (reports / f"{stem}_report.json").write_text(json.dumps(report), encoding="utf-8")


def _make_experiments(tmp_path: Path) -> tuple[Path, Path, Path]:
    candidate = tmp_path / "candidate"
    baseline = tmp_path / "baseline"
    tasks = tmp_path / "tasks"
    return candidate, baseline, tasks


def test_fallback_case_manifest_never_hashes_dotenv_files(tmp_path: Path):
    tasks = tmp_path / "tasks"
    task = tasks / "task-a"
    task.mkdir(parents=True)
    (task / "task.toml").write_text('name = "task-a"\n', encoding="utf-8")
    (task / "instruction.md").write_text("Do the task.\n", encoding="utf-8")
    secret = task / ".envrc"
    secret.write_text("TOKEN=first-secret\n", encoding="utf-8")
    before = build_case_manifest("task-a", tasks)

    secret.write_text("TOKEN=second-secret\n", encoding="utf-8")
    after = build_case_manifest("task-a", tasks)

    assert before.case_hash == after.case_hash


def test_v2_case_manifest_binds_safe_execution_identity_without_raw_configuration(
    tmp_path: Path,
):
    tasks = tmp_path / "tasks"
    task = tasks / "task-a"
    task.mkdir(parents=True)
    (task / "task.toml").write_text('name = "task-a"\n', encoding="utf-8")
    (task / "instruction.md").write_text("Do the task.\n", encoding="utf-8")
    runtime_image_id = "sha256:" + "1" * 64
    docker_identity = {
        "schema": EXECUTION_IDENTITY_SCHEMA,
        "runtime_image_id": runtime_image_id,
        "image_id_hash": _digest(runtime_image_id),
        "image_repo_digests_hash": _digest("repo-digests"),
        "image_ref_hash": _digest("build-ref"),
        "claude_tool_version_hash": _digest("claude-9.9.9"),
    }
    interaction = SimpleNamespace(
        mode="auto_user",
        max_turns=7,
        simulator_prompt="private simulator instruction",
        decision_patterns=["private decision"],
        decision_reply="private reply",
        continue_prompt="private continuation",
        fresh_resume_marker="private marker",
    )
    identity = build_execution_identity(
        docker_identity,
        model="private-model-alias",
        model_config={"ANTHROPIC_BASE_URL": "private-routing-endpoint"},
        interaction=interaction,
    )
    manifest = build_case_manifest("task-a", tasks, execution_identity=identity)
    payload = case_manifest_payload(manifest)
    serialized = json.dumps(payload, sort_keys=True)

    assert payload["schema"] == CASE_MANIFEST_SCHEMA
    assert payload["execution_identity"]["image_id_hash"] == _digest(runtime_image_id)
    assert payload["runner_hash"].startswith("sha256:")
    assert payload["controller_hash"].startswith("sha256:")
    assert "runtime_image_id" not in serialized
    assert "private-model-alias" not in serialized
    assert "private-routing-endpoint" not in serialized
    assert "private simulator instruction" not in serialized
    assert "private reply" not in serialized

    changed_identity = build_execution_identity(
        docker_identity,
        model="another-model",
        model_config={"ANTHROPIC_BASE_URL": "private-routing-endpoint"},
        interaction=interaction,
    )
    changed = build_case_manifest("task-a", tasks, execution_identity=changed_identity)
    assert changed.case_hash != manifest.case_hash


def test_expected_matrix_detects_case_missing_from_both_experiments(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )
    _write_matrix(
        candidate,
        [
            ("task-a", "COMET_NATIVE_PHASE1", 1),
            ("task-b", "COMET_NATIVE_PHASE1", 1),
            ("irrelevant", "CONTROL", 1),
        ],
    )
    _write_matrix(
        baseline,
        [
            ("task-a", "COMET_FULL_040_BETA", 1),
            ("task-b", "COMET_FULL_040_BETA", 1),
        ],
    )

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "| 1 | 1 | 2 | 1 | 2 | 1 |" in report
    assert "task-b | 1 | missing-repetition | missing candidate and baseline run" in report
    assert "| Candidate | report-bound |" in report
    assert "| Baseline | report-bound |" in report
    assert "Expected-matrix limitation" not in report


def test_invalid_expected_matrix_fails_closed_instead_of_using_observed_runs(
    tmp_path: Path,
):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )
    _write_matrix(candidate, [("task-a", "COMET_NATIVE_PHASE1", 1)])
    _write_matrix(baseline, [("task-a", "COMET_FULL_040_BETA", 1)])
    matrix_path = candidate / EXPECTED_CASE_MATRIX_FILENAME
    tampered = json.loads(matrix_path.read_text(encoding="utf-8"))
    tampered["matrix_hash"] = _digest("forged")
    matrix_path.write_text(json.dumps(tampered), encoding="utf-8")

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "invalid-expected-case-matrix" in report
    assert "unexpected-run" in report
    assert "Invalid-matrix handling" in report
    assert "observed reports are excluded" in report
    assert "N/A (0/1 tasks)" in report


def test_historical_reports_disclose_expected_matrix_and_execution_limitations(
    tmp_path: Path,
):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "Expected-matrix limitation" in report
    assert "cannot be reconstructed or claimed as historically executed" in report
    assert "Execution-identity limitation" in report
    assert "must not be presented as exact historical execution identity" in report


def test_v2_run_can_compare_to_v1_by_core_hash_without_claiming_exact_identity(
    tmp_path: Path,
):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )
    candidate_report = next((candidate / "reports").glob("*.json"))
    candidate_payload = json.loads(candidate_report.read_text(encoding="utf-8"))
    candidate_payload["events_summary"]["case_manifest"] = _v2_manifest_from_v1(_manifest("task-a"))
    candidate_report.write_text(json.dumps(candidate_payload), encoding="utf-8")

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "| 1 | 1 | 1 | 1 | 1 | 0 |" in report
    assert "Execution-identity limitation: 1 run record" in report


def test_task_macro_pass_at_3_does_not_pool_runs_across_tasks(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    for index in range(16):
        task = f"task-{index:02d}"
        candidate_passed = index < 8
        for rep in (1, 2, 3):
            _write_run(
                candidate,
                task=task,
                treatment="COMET_NATIVE_PHASE1",
                rep=rep,
                passed=candidate_passed,
            )
            _write_run(
                baseline,
                task=task,
                treatment="COMET_FULL_040_BETA",
                rep=rep,
                passed=True,
            )

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
    )

    native_pass_at = next(
        line for line in report.splitlines() if "COMET_NATIVE_PHASE1 | pass@k" in line
    )
    assert "0.50 (16/16 tasks)" in native_pass_at
    assert "0.88" not in native_pass_at
    assert "COMET_FULL_040_BETA | pass@k | 1.00" in report
    assert str(candidate) not in report
    assert str(baseline) not in report
    assert f"from `{candidate.name}`" in report
    assert f"from `{baseline.name}`" in report


def test_missing_rep_is_coverage_loss_without_lowering_k(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    for rep in (1, 2):
        _write_run(
            candidate,
            task="task-a",
            treatment="COMET_NATIVE_PHASE1",
            rep=rep,
            passed=True,
        )
    for rep in (1, 2, 3):
        _write_run(
            baseline,
            task="task-a",
            treatment="COMET_FULL_040_BETA",
            rep=rep,
            passed=True,
        )

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1, 2, 3),
    )

    native_pass_at = next(
        line for line in report.splitlines() if "COMET_NATIVE_PHASE1 | pass@k" in line
    )
    assert "N/A (0/1 tasks)" in native_pass_at
    assert "missing-repetition" in report
    assert "task-a | 3 | missing-repetition | missing candidate run" in report
    assert "k is never reduced" in report


def test_combined_experiment_sample_number_is_the_repetition_identity(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=3,
        passed=True,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )
    baseline_report = next((baseline / "reports").glob("*.json"))
    combined_name = (
        baseline / "reports" / "task_a_COMET_FULL_040_BETA_sample3_from_experiment_previous.json"
    )
    baseline_report.rename(combined_name)

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "| 1 | 1 | 1 | 1 | 1 | 0 |" in report
    assert "| task-a | 3 | 1/1 | 1/1 |" in report


def test_combined_experiment_duration_is_bound_to_named_source_experiment(tmp_path: Path):
    candidate, combined, tasks = _make_experiments(tmp_path)
    source = tmp_path / "experiment_source"
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
    )
    _write_run(
        source,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )
    combined_reports = combined / "reports"
    combined_reports.mkdir(parents=True)
    source_report = next((source / "reports").glob("*.json"))
    combined_report = combined_reports / (
        "task_a_COMET_FULL_040_BETA_sample1_from_experiment_source.json"
    )
    source_report.rename(combined_report)

    report = build_aligned_report(
        candidate,
        combined,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "| COMET_FULL_040_BETA | 1 | 1/1 | 1s | 1s |" in report

    wrong_source = combined_reports / (
        "task_a_COMET_FULL_040_BETA_sample1_from_experiment_wrong.json"
    )
    combined_report.rename(wrong_source)
    report = build_aligned_report(
        candidate,
        combined,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )
    assert "| COMET_FULL_040_BETA | 1 | 0/1 | N/A | N/A |" in report


def test_case_hash_mismatch_is_not_compared(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
        manifest_variant="candidate",
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
        manifest_variant="baseline",
    )

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
    )

    assert "Strictly matched pairs | Tasks | Issues" in report
    assert "| 1 | 1 | 1 | 0 | 1 | 1 |" in report
    assert "case-hash-mismatch" in report
    assert "N/A (0/1 tasks)" in report


def test_invalid_embedded_case_manifest_fails_closed(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    for experiment, treatment in (
        (candidate, "COMET_NATIVE_PHASE1"),
        (baseline, "COMET_FULL_040_BETA"),
    ):
        _write_run(
            experiment,
            task="task-a",
            treatment=treatment,
            rep=1,
            passed=True,
        )
    baseline_report = next((baseline / "reports").glob("*.json"))
    payload = json.loads(baseline_report.read_text(encoding="utf-8"))
    payload["events_summary"]["case_manifest"]["case_hash"] = _digest("forged")
    baseline_report.write_text(json.dumps(payload), encoding="utf-8")

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "invalid-case-manifest" in report
    assert "| 1 | 1 | 1 | 0 | 1 | 1 |" in report


def test_duration_is_recomputed_from_raw_stdout_with_explicit_coverage(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    for rep, duration in ((1, (1000, 2000)), (2, (4000,)), (3, None)):
        _write_run(
            candidate,
            task="task-a",
            treatment="COMET_NATIVE_PHASE1",
            rep=rep,
            passed=True,
            duration_ms=duration,
        )
        _write_run(
            baseline,
            task="task-a",
            treatment="COMET_FULL_040_BETA",
            rep=rep,
            passed=True,
            duration_ms=(1000,),
        )

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
    )

    assert "| COMET_NATIVE_PHASE1 | 3 | 2/3 | 7s | 4s | raw_stdout:extract_events |" in report
    assert "| COMET_FULL_040_BETA | 3 | 3/3 | 3s | 1s | raw_stdout:extract_events |" in report
    assert "9999" not in report
    assert "Stored historical duration fields are not mixed" in report
    assert "COMET_NATIVE_PHASE1 missing raw duration: `task-a#r3`" in report


def test_aligned_report_compares_cumulative_success_efficiency(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
        result_telemetry={
            "num_turns": 4,
            "usage": {"input_tokens": 100, "output_tokens": 20},
            "total_cost_usd": 0.1,
        },
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
        result_telemetry={
            "num_turns": 8,
            "usage": {"input_tokens": 200, "output_tokens": 40},
            "total_cost_usd": 0.2,
        },
    )

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
    )

    assert "## Paired task efficiency from raw stdout" in report
    assert "### Strict-success intersection (1 paired runs)" in report
    assert "| Agent turns | 1/1 | 4.00 | 8.00 | 50.0% less |" in report
    assert "| Total tokens incl. cache | 1/1 | 120 | 240 | 50.0% less |" in report
    html = render_markdown_html(report, title="Comet Aligned Experiment Comparison Report")
    assert "Model starts/resumes" in html
    assert "模型启动/恢复次数" in html
    assert "Total tokens incl. cache" in html
    zh = html.split('<section class="localized" data-locale="zh"', 1)[1].split(
        '<section class="localized" data-locale="en"',
        1,
    )[0]
    assert "Comet 对齐实验对比报告" in zh
    assert "对齐规则" in zh
    assert "对齐摘要" in zh
    assert "候选模式平均值" in zh
    assert "已剔除的数据" in zh
    assert "Alignment contract" not in zh
    assert "Candidate average" not in zh


def test_aligned_report_excludes_raw_stdout_without_a_result_event(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
        duration_ms=None,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
    )

    assert "| Model starts/resumes | 0/1 | N/A | N/A | N/A |" in report


def test_duration_rejects_a_raw_artifact_from_another_task(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    for task in ("task-a", "task-b"):
        _write_run(
            candidate,
            task=task,
            treatment="COMET_NATIVE_PHASE1",
            rep=1,
            passed=True,
        )
        _write_run(
            baseline,
            task=task,
            treatment="COMET_FULL_040_BETA",
            rep=1,
            passed=True,
        )
    reports = sorted((candidate / "reports").glob("*.json"))
    task_a = next(path for path in reports if "task_a_" in path.name)
    task_b = next(path for path in reports if "task_b_" in path.name)
    task_a_payload = json.loads(task_a.read_text(encoding="utf-8"))
    task_b_payload = json.loads(task_b.read_text(encoding="utf-8"))
    task_a_payload["events_summary"]["artifact_references"]["raw_stdout"] = task_b_payload[
        "events_summary"
    ]["artifact_references"]["raw_stdout"]
    task_a.write_text(json.dumps(task_a_payload), encoding="utf-8")

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "| COMET_NATIVE_PHASE1 | 2 | 1/2 |" in report
    assert "COMET_NATIVE_PHASE1 missing raw duration: `task-a#r1`" in report


def test_duration_rejects_a_raw_artifact_from_another_repetition(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    for rep in (1, 2):
        _write_run(
            candidate,
            task="task-a",
            treatment="COMET_NATIVE_PHASE1",
            rep=rep,
            passed=True,
        )
        _write_run(
            baseline,
            task="task-a",
            treatment="COMET_FULL_040_BETA",
            rep=rep,
            passed=True,
        )
    reports = sorted((candidate / "reports").glob("*.json"))
    rep_one = next(path for path in reports if "_r1_" in path.name)
    rep_two = next(path for path in reports if "_r2_" in path.name)
    rep_one_payload = json.loads(rep_one.read_text(encoding="utf-8"))
    rep_two_payload = json.loads(rep_two.read_text(encoding="utf-8"))
    rep_one_payload["events_summary"]["artifact_references"]["raw_stdout"] = rep_two_payload[
        "events_summary"
    ]["artifact_references"]["raw_stdout"]
    rep_one.write_text(json.dumps(rep_one_payload), encoding="utf-8")

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "| COMET_NATIVE_PHASE1 | 2 | 1/2 |" in report
    assert "COMET_NATIVE_PHASE1 missing raw duration: `task-a#r1`" in report


def test_duration_rejects_raw_stdout_outside_its_experiment(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )
    candidate_report = next((candidate / "reports").glob("*.json"))
    payload = json.loads(candidate_report.read_text(encoding="utf-8"))
    source = Path(payload["events_summary"]["artifact_references"]["raw_stdout"])
    outside = tmp_path / "outside" / source.name
    outside.parent.mkdir()
    outside.write_bytes(source.read_bytes())
    payload["events_summary"]["artifact_references"]["raw_stdout"] = str(outside)
    candidate_report.write_text(json.dumps(payload), encoding="utf-8")

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "| COMET_NATIVE_PHASE1 | 1 | 0/1 |" in report
    assert "COMET_NATIVE_PHASE1 missing raw duration: `task-a#r1`" in report


def test_duration_rejects_symlinked_raw_stdout(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )
    candidate_report = next((candidate / "reports").glob("*.json"))
    payload = json.loads(candidate_report.read_text(encoding="utf-8"))
    raw = Path(payload["events_summary"]["artifact_references"]["raw_stdout"])
    outside = tmp_path / "outside-stdout.json"
    outside.write_bytes(raw.read_bytes())
    raw.unlink()
    try:
        raw.symlink_to(outside)
    except OSError as error:
        pytest.skip(f"file symlink unavailable: {error}")

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "| COMET_NATIVE_PHASE1 | 1 | 0/1 |" in report


def test_missing_checks_failed_field_fails_closed(tmp_path: Path):
    candidate, baseline, tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )
    candidate_report = next((candidate / "reports").glob("*.json"))
    payload = json.loads(candidate_report.read_text(encoding="utf-8"))
    payload.pop("checks_failed")
    candidate_report.write_text(json.dumps(payload), encoding="utf-8")

    report = build_aligned_report(
        candidate,
        baseline,
        candidate_treatment="COMET_NATIVE_PHASE1",
        baseline_treatment="COMET_FULL_040_BETA",
        tasks_dir=tasks,
        ks=(1,),
    )

    assert "| task-a | 1 | 0/1 | 1/1 |" in report


def test_cli_supports_explicit_candidate_and_baseline_experiments(
    tmp_path: Path,
):
    candidate, baseline, _tasks = _make_experiments(tmp_path)
    _write_run(
        candidate,
        task="task-a",
        treatment="COMET_NATIVE_PHASE1",
        rep=1,
        passed=True,
    )
    _write_run(
        baseline,
        task="task-a",
        treatment="COMET_FULL_040_BETA",
        rep=1,
        passed=True,
    )
    output = tmp_path / "aligned.md"

    result = main(
        [
            "--candidate-experiment",
            str(candidate),
            "--baseline-experiment",
            str(baseline),
            "--ks",
            "1,3",
            "--out",
            str(output),
        ]
    )

    assert result == 0
    assert output.is_file()
    report = output.read_text(encoding="utf-8")
    assert "COMET_NATIVE_PHASE1" in report
    assert "COMET_FULL_040_BETA" in report
    assert "Requested k: 1, 3" in report

    chinese_output = tmp_path / "aligned-zh.md"
    report_config = tmp_path / "report-config.json"
    report_config.write_text(
        json.dumps({"report_outputs": {"markdown": True, "html": True}}),
        encoding="utf-8",
    )
    chinese_result = main(
        [
            "--candidate-experiment",
            str(candidate),
            "--baseline-experiment",
            str(baseline),
            "--ks",
            "1",
            "--language",
            "zh",
            "--report-config",
            str(report_config),
            "--out",
            str(chinese_output),
        ]
    )

    assert chinese_result == 0
    chinese_report = chinese_output.read_text(encoding="utf-8")
    assert "# Comet 对齐实验对比报告" in chinese_report
    assert "## 对齐规则" in chinese_report
    assert "## 已剔除的数据" in chinese_report
    assert "Alignment contract" not in chinese_report
    chinese_html = chinese_output.with_suffix(".html").read_text(encoding="utf-8")
    assert "<title>Comet 对齐实验对比报告</title>" in chinese_html
    zh_html = chinese_html.split('<section class="localized" data-locale="zh"', 1)[1].split(
        '<section class="localized" data-locale="en"',
        1,
    )[0]
    en_html = chinese_html.split('<section class="localized" data-locale="en"', 1)[1]
    assert "## 对齐规则" not in zh_html
    assert "对齐规则" in zh_html
    assert "Alignment contract" in en_html
