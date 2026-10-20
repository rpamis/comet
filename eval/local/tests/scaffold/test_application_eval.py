"""SDK application inputs, Runtime evidence and frozen report bindings."""

import json
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from scaffold.python.application_eval import (
    install_application_for_case,
    application_execution_prompt,
    application_environment,
    application_runs_validator,
    write_application_result,
    application_generation_guidance,
)
from scaffold.python.auto_tasks import ensure_generated_manifest
from scaffold.python.logging import TreatmentResult


def _context(tmp_path, monkeypatch):
    skill = tmp_path / "skill"
    (skill / "references").mkdir(parents=True)
    (skill / "scripts/application").mkdir(parents=True)
    (skill / "SKILL.md").write_text("Run scripts/application/application.json", encoding="utf-8")
    (skill / "scripts/application/application.json").write_text('{"id":"report"}', encoding="utf-8")
    (skill / "scripts/application/application.mjs").write_text("// fixed implementation", encoding="utf-8")
    preview = {"application": {"id": "report", "version": "1", "contentHash": "a" * 64}, "runtimeIdentityHash": "fixed-runtime", "settings": {"agent": "codex"}, "confirmationHash": "fixed", "limitations": ["codex only"], "workflows": [{"id": "publish", "definitionHash": "fixed-definition", "steps": ["draft", "approve", "publish"], "definition": {"steps": {"approve": {"choices": ["approved", "rejected"]}}}}]}
    (skill / "references/workflows.json").write_text(json.dumps(preview), encoding="utf-8")
    project = tmp_path / "project"
    result_root = project / ".comet/eval/runs/eval-one"
    result_root.mkdir(parents=True)
    context = {"projectRoot": str(project), "preview": preview, "skillRoot": str(skill), "experimentId": "eval-one", "snapshotHash": "snapshot", "resultFile": str(result_root / "application-result.json")}
    monkeypatch.setenv("COMET_APPLICATION_EVAL_CONTEXT", json.dumps(context))
    return skill, result_root


def _complete_logger(logger, task_names=("normal", "rejected")):
    """生成与真实 harness 相同的固定矩阵、清单和报告身份。"""
    import hashlib
    from scaffold.python.aligned_comparison import expected_case_matrix_payload
    from scaffold.python.logging import save_report

    manifest = logger.base_dir.parents[1] / "generated/cases/eval.yaml"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps({"evaluation": {"tasks": [{"name": name} for name in task_names]}}))
    logger.metadata = getattr(logger, "metadata", {})
    logger.metadata["application_task_set"] = {
        "manifestPath": str(manifest),
        "manifestHash": "sha256:" + hashlib.sha256(manifest.read_bytes()).hexdigest(),
    }
    matrix = expected_case_matrix_payload((name, "DYNAMIC_SKILL", 1) for name in task_names)
    (logger.base_dir / "expected-case-matrix.json").write_text(json.dumps(matrix))
    for runs in logger.results.values():
        for result in runs:
            result.name = result.events_summary["task"] + "-DYNAMIC_SKILL-r1"
            result.events_summary.update(treatment="DYNAMIC_SKILL", sample=1)
            result.events_summary.setdefault("sample_quality", {"status": "included"})
            save_report(logger.base_dir, result.name, 1, {
                "name": result.name, "rep": 1, "passed": result.passed,
                "checks_passed": result.checks_passed, "checks_failed": result.checks_failed,
                "events_summary": result.events_summary,
            })
    return logger


def test_application_generation_keeps_one_installed_candidate_and_one_project_root(tmp_path, monkeypatch):
    from scaffold.python.auto_tasks import build_skill_snapshot
    skill, _ = _context(tmp_path, monkeypatch)
    guidance = application_generation_guidance(build_skill_snapshot(skill))
    for contract in (
        "Each case already has its own isolated /workspace", "--project-root /workspace",
        "Do not create /workspace/eval-grill-normal", "Do not generate or install another application",
        "CONTEXT.md", "src/calculator.py", "not /workspace/CONTEXT.md",
        "not a nested project directory", "Do not substitute a hand-written state file",
    ):
        assert contract in guidance


def test_collection_task_set_receipt_is_durable_before_results_or_finalize(tmp_path, monkeypatch):
    import conftest
    skill, run_root = _context(tmp_path, monkeypatch)
    generated = tmp_path / "generated"
    generated.mkdir()
    manifest = generated / "eval.yaml"
    manifest.write_text("frozen case bytes", encoding="utf-8")
    metadata = generated / "generation.json"
    metadata.write_text('{"manifest_hash":"fixed"}', encoding="utf-8")
    config = SimpleNamespace(option=SimpleNamespace(numprocesses=0), _comet_generated_manifest=SimpleNamespace(manifest_path=manifest, metadata_path=metadata, generation_hash="a" * 64))
    plugin = conftest.ExperimentPlugin(config)
    plugin.logger = SimpleNamespace(base_dir=run_root, metadata={})
    items = [SimpleNamespace(callspec=SimpleNamespace(params={"task_name": name, "treatment_name": "DYNAMIC_SKILL"}), get_closest_marker=lambda name: SimpleNamespace(kwargs={"repetition": 1}) if name == "eval_case" else None) for name in ("normal", "rejected")]
    plugin.pytest_collection_finish(SimpleNamespace(items=items))
    receipt_path = run_root / "application-task-set.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    assert receipt["schema"] == "comet.workflow.application.eval.task-set.v1"
    assert receipt["experimentId"] == "eval-one"
    assert receipt["confirmationHash"] == "fixed"
    assert receipt["snapshotHash"] == "snapshot"
    assert receipt["taskSet"]["sourceRoot"] == str(skill)
    assert receipt["taskSet"]["manifestPath"] == str(manifest)
    assert receipt["matrixHash"] == plugin.logger.metadata["expected_case_matrix"]["matrix_hash"]
    assert not (run_root / "application-result.json").exists()
    original = receipt_path.read_bytes()
    plugin.pytest_collection_finish(SimpleNamespace(items=items))
    assert receipt_path.read_bytes() == original
    manifest.write_text("changed frozen cases", encoding="utf-8")
    with pytest.raises(RuntimeError, match="TaskSet|task set|用例"):
        plugin.pytest_collection_finish(SimpleNamespace(items=items))
    assert receipt_path.read_bytes() == original


def test_generator_reads_workflow_and_actual_modules_and_reuses_the_same_cases(tmp_path, monkeypatch):
    skill, _ = _context(tmp_path, monkeypatch)
    prompts = []

    def generate(prompt):
        prompts.append(prompt)
        return {"tasks": [{"name": "normal", "prompt": "Run actual SDK", "expect": {"files": ["report.md"]}}, {"name": "rejected", "prompt": "Reject approval", "expect": {"files": ["draft.md"]}}]}

    first = ensure_generated_manifest(skill, tmp_path, agent="codex", model="test", profile="generic", interaction={"mode": "auto_user"}, generate=generate)
    second = ensure_generated_manifest(skill, tmp_path, agent="codex", model="test", profile="generic", interaction={"mode": "auto_user"}, generate=generate)
    assert first.manifest_path == second.manifest_path
    assert len(prompts) == 1
    assert "approval choices and recovery" in prompts[0]
    assert "fixed implementation" in prompts[0]
    assert "publish" in prompts[0]
    assert "hand-written state" in prompts[0]


def test_application_environment_uses_current_sdk_and_matching_dependencies(tmp_path, monkeypatch):
    skill, _ = _context(tmp_path, monkeypatch)
    environment = application_environment(skill)
    assert (environment / ".include-current-comet-cli").is_file()
    assert "FROM node:22" in (environment / "Dockerfile").read_text()
    source = Path(__file__).resolve().parents[4]
    expected = json.loads((source / "package.json").read_text())["dependencies"]
    actual = json.loads((environment / "current-comet-package.json").read_text())["dependencies"]
    assert actual == expected


def test_application_is_distributed_with_fixed_dependencies_before_the_subject_starts(tmp_path, monkeypatch):
    _context(tmp_path, monkeypatch)
    calls = []
    fixed = "/workspace/.comet/applications/report/versions/" + "a" * 64 + "/application.json"

    def run(_directory, command, _timeout):
        calls.append(command)
        if len(calls) == 1:
            return SimpleNamespace(returncode=0, stdout=json.dumps({"contentHash": "a" * 64, "confirmationHash": "current-preview"}))
        return SimpleNamespace(returncode=0, stdout=json.dumps({"file": fixed}))

    monkeypatch.setattr("scaffold.python.utils.run_command_in_docker", run)
    actual = install_application_for_case(tmp_path, "_eval_target_skills/skill", "claude-code")
    assert actual == fixed
    assert "--platform claude" in calls[0]
    assert "--confirmation-hash current-preview" in calls[1]
    prompt = application_execution_prompt("Check actual report artifacts", "_eval_target_skills/skill", actual)
    assert fixed in prompt
    assert "fixed dependencies" in prompt
    assert "Check actual report artifacts" in prompt


def test_drifted_installation_preview_cannot_start_subject_execution(tmp_path, monkeypatch):
    _context(tmp_path, monkeypatch)
    monkeypatch.setattr("scaffold.python.utils.run_command_in_docker", lambda *_: SimpleNamespace(returncode=0, stdout=json.dumps({"contentHash": "changed", "confirmationHash": "another"})))
    with pytest.raises(ValueError, match="fixed candidate"):
        install_application_for_case(tmp_path, "_eval_target_skills/skill", "codex")


def test_no_runtime_run_cannot_be_reported_as_sdk_execution(tmp_path, monkeypatch):
    _context(tmp_path, monkeypatch)
    monkeypatch.setattr("scaffold.python.utils.run_command_in_docker", lambda *_: SimpleNamespace(returncode=0, stdout="[]"))
    passed, failed = application_runs_validator(tmp_path, {"skill_package_path": "_eval_target_skills/skill"})
    assert not passed
    assert failed == ["No actual SDK application Run was verified"]


def test_runtime_discovery_uses_the_public_sdk_without_legacy_workspace_files(tmp_path, monkeypatch):
    _context(tmp_path, monkeypatch)
    calls = []

    def run(_directory, command, _timeout):
        calls.append(command)
        if "listWorkflowApplicationRunRecords" in command:
            return SimpleNamespace(returncode=0, stdout=json.dumps([
                {"applicationId": "report", "runId": "one", "record": {}, "error": None},
            ]))
        return SimpleNamespace(returncode=0, stdout=json.dumps({
            "status": "succeeded",
            "application": {"id": "report", "version": "1", "contentHash": "fixed-runtime"},
            "data": {"workflow": {"id": "publish", "hash": "fixed-definition"},
                     "actions": [{"stepId": "draft", "attempt": 1, "status": "succeeded"}], "waits": []},
        }))

    monkeypatch.setattr("scaffold.python.utils.run_command_in_docker", run)
    passed, failed = application_runs_validator(tmp_path, {"skill_package_path": "snapshot"})
    assert passed == ["SDK Run inspected by actual Runtime: one"]
    assert not failed
    assert len(calls) == 2


def test_persisted_reports_keep_application_coverage_and_environment_failure(tmp_path):
    from conftest import _build_report_payload

    report = _build_report_payload(treatment_name="dynamic", rep=1, run_id="one", events={"task": "normal", "application_coverage": ["publish/approve"]}, passed=[], failed=["API request timed out"], scripts_used=[], artifact_references={}, failure_attribution=[], returncode=1, stderr="API request timed out")
    assert report["events_summary"]["application_coverage"] == ["publish/approve"]
    assert report["events_summary"]["sample_quality"] == report["sample_quality"]


@pytest.mark.parametrize("command", ["docker_run_claude_loop", "docker_run_agent_loop"])
def test_containers_are_scoped_to_the_application_experiment(tmp_path, command):
    from scaffold.python import utils

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    calls = tmp_path / "docker-calls.txt"
    script = """
source "$1"
resolve_runtime_image() { printf '%s' fake-image; }
build_env_args() { ENV_ARGS=(); }
build_agent_runtime_mount_args() { RUNTIME_CONFIG_MOUNT_ARGS=(); RUNTIME_CONFIG_TMPFS_ARGS=(); }
build_plugin_args() { PLUGIN_MOUNT_ARGS=(); PLUGIN_CLI_ARGS=(); }
build_langfuse_plugin_args() { LANGFUSE_PLUGIN_MOUNT_ARGS=(); LANGFUSE_PLUGIN_CLI_ARGS=(); }
build_trusted_oracle_mount_args() { TRUSTED_ORACLE_MOUNT_ARGS=(); }
docker() { printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"; }
"$3" "$2" 'Test prompt' --max-turns 1
"""
    result = subprocess.run([utils.BASH_EXEC, "-c", script, "_", utils._to_bash_path(utils.SHELL_DIR / "docker.sh"), utils._to_bash_path(workspace), command], env={**os.environ, "DOCKER_CALL_LOG": utils._to_bash_path(calls), "COMET_APPLICATION_EVAL_CONTEXT": "{}", "COMET_EVAL_EXPERIMENT_ID": "app-eval-one"}, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    runs = [line for line in calls.read_text().splitlines() if "--name" in line]
    assert len(runs) == 1
    assert "--label comet.eval.experiment=app-eval-one" in runs[0]


def test_wsl_bridge_retains_the_application_experiment_identity(monkeypatch):
    from scaffold.python import utils

    monkeypatch.setattr(utils.os, "name", "nt")
    monkeypatch.setattr(utils, "BASH_EXEC", r"C:\Windows\System32\bash.exe")
    value = {"COMET_APPLICATION_EVAL_CONTEXT": "{}", "COMET_EVAL_EXPERIMENT_ID": "app-eval-one"}
    names = utils._bash_env(value)["WSLENV"].split(":")
    assert "COMET_APPLICATION_EVAL_CONTEXT" in names
    assert "COMET_EVAL_EXPERIMENT_ID" in names


def test_runtime_inspection_rejects_forged_or_other_application_run(tmp_path, monkeypatch):
    _context(tmp_path, monkeypatch)
    def run(_directory, command, _timeout):
        payload = [{"applicationId": "report", "runId": "one", "record": {}, "error": None}] if "listWorkflowApplicationRunRecords" in command else {"status": "succeeded", "application": {"id": "another", "version": "1"}, "data": {"actions": [], "waits": []}}
        return SimpleNamespace(returncode=0, stdout=json.dumps(payload))
    monkeypatch.setattr("scaffold.python.utils.run_command_in_docker", run)
    passed, failed = application_runs_validator(tmp_path, {"skill_package_path": "_eval_target_skills/skill"})
    assert not passed
    assert any("another application" in failure for failure in failed)


@pytest.mark.parametrize("runtime_hash,definition_hash,accepted", [("fixed-runtime", "fixed-definition", True), ("changed", "fixed-definition", False), ("fixed-runtime", "changed", False)])
def test_runtime_inspection_binds_actual_code_and_tracks_decisions_and_recovery(tmp_path, monkeypatch, runtime_hash, definition_hash, accepted):
    _context(tmp_path, monkeypatch)
    response = {"status": "succeeded", "application": {"id": "report", "version": "1", "contentHash": runtime_hash}, "data": {"workflow": {"id": "publish", "hash": definition_hash}, "actions": [{"stepId": "draft", "attempt": 2, "status": "succeeded"}], "waits": [{"stepId": "approve", "decision": {"choice": "rejected"}}]}}
    monkeypatch.setattr("scaffold.python.utils.run_command_in_docker", lambda _directory, command, _timeout: SimpleNamespace(returncode=0, stdout=json.dumps([{"applicationId": "report", "runId": "one", "record": {}, "error": None}] if "listWorkflowApplicationRunRecords" in command else response)))
    outputs = {"skill_package_path": "_eval_target_skills/skill"}
    passed, failed = application_runs_validator(tmp_path, outputs)
    assert bool(passed) == accepted
    if accepted:
        assert not failed
        assert outputs["application_choices"] == ["publish/approve/rejected"]
        assert outputs["application_recovery"] == ["publish/draft"]
    else:
        assert failed


@pytest.mark.parametrize("quality,second_passed,expected", [("included", True, "passed"), ("included", False, "failed"), ("excluded", False, "incomplete")])
def test_report_binds_version_and_preserves_failure_or_environment_noise(tmp_path, monkeypatch, quality, second_passed, expected):
    _, result_root = _context(tmp_path, monkeypatch)
    results = [TreatmentResult("dynamic", True, ["SDK Run inspected by actual Runtime: one"], [], {"task": "normal", "application_coverage": ["publish/draft", "publish/approve"], "application_executed_steps": ["publish/draft"]}), TreatmentResult("dynamic", second_passed, ["SDK Run inspected by actual Runtime: two"], [] if second_passed else ["rejected branch failed"], {"task": "rejected", "sample_quality": {"status": quality}})]
    logger = SimpleNamespace(base_dir=result_root, results={"dynamic": results})
    write_application_result(_complete_logger(logger))
    report = json.loads((result_root / "application-result.json").read_text())
    assert report["status"] == expected
    assert report["application"] == {"id": "report", "version": "1", "contentHash": "a" * 64}
    assert report["confirmationHash"] == "fixed"
    assert report["uncoveredSteps"] == ["publish/publish"]
    assert report["costUsd"] is None


def test_two_started_runs_without_execution_cannot_pass_the_application_eval(tmp_path, monkeypatch):
    _, result_root = _context(tmp_path, monkeypatch)
    results = [TreatmentResult("dynamic", True, ["SDK Run inspected by actual Runtime: one"], [], {"task": name, "application_coverage": ["publish/approve"]}) for name in ["normal", "rejected"]]
    write_application_result(_complete_logger(SimpleNamespace(base_dir=result_root, results={"dynamic": results})))
    report = json.loads((result_root / "application-result.json").read_text())
    assert report["status"] == "incomplete"
    assert report["executedSteps"] == []
    assert any("actually executed" in failure for failure in report["failures"])


def test_mixed_case_and_teardown_failures_remain_incomplete(tmp_path, monkeypatch):
    _, result_root = _context(tmp_path, monkeypatch)
    results = [TreatmentResult("dynamic", name == "normal", ["SDK Run inspected by actual Runtime: one"], [] if name == "normal" else ["case failed"], {"task": name, "application_executed_steps": ["publish/draft"]}) for name in ("normal", "rejected")]
    logger = SimpleNamespace(base_dir=result_root, results={"dynamic": results}, metadata={"pytest_exitstatus": 1, "pytest_errors": 1})
    write_application_result(_complete_logger(logger))
    assert json.loads((result_root / "application-result.json").read_text())["status"] == "incomplete"


def test_failed_retry_subset_cannot_pass_full_application_acceptance(tmp_path, monkeypatch):
    _, result_root = _context(tmp_path, monkeypatch)
    monkeypatch.setenv("COMET_EVAL_MANAGED", "1")
    monkeypatch.setenv("COMET_EVAL_CONTEXT", "{}")
    monkeypatch.setenv("COMET_EVAL_CASE_SELECTION", json.dumps({"sourceRunId": "original", "cases": [{"task": name, "treatment": "DYNAMIC_SKILL", "repetition": 1, "caseHash": "fixed", "validatorHash": "fixed"} for name in ["normal", "rejected"]]}))
    results = [TreatmentResult("dynamic", True, ["SDK Run inspected by actual Runtime: one"], [], {"task": name, "application_executed_steps": ["publish/draft"]}) for name in ["normal", "rejected"]]
    write_application_result(_complete_logger(SimpleNamespace(base_dir=result_root, results={"dynamic": results})))
    report = json.loads((result_root / "application-result.json").read_text())
    assert report["status"] == "incomplete"
    assert report["caseSelection"]["sourceRunId"] == "original"
    assert report["passed"] == 2


def test_report_does_not_invent_model_identity_or_treat_partial_costs_as_total(tmp_path, monkeypatch):
    _, result_root = _context(tmp_path, monkeypatch)
    results = [TreatmentResult("dynamic", True, ["SDK Run inspected by actual Runtime: one"], [], {"task": name, "application_executed_steps": ["publish/draft"], "execution_identity": {"model": None}, **({"model_usage": {"actual-provider-model": {}}, "total_cost_usd": 0.5} if name == "normal" else {})}) for name in ["normal", "rejected"]]
    write_application_result(_complete_logger(SimpleNamespace(base_dir=result_root, results={"dynamic": results})))
    report = json.loads((result_root / "application-result.json").read_text())
    assert report["actualModels"] == ["actual-provider-model"]
    assert report["costUsd"] is None
    assert report["caseCostUsd"] is None
    assert report["knownCaseCostUsd"] == 0.5
    assert report["costStatus"] == "partial"


def _passing_logger(tmp_path, monkeypatch, task_names=("normal", "rejected", "recovery")):
    _, root = _context(tmp_path, monkeypatch)
    results = [TreatmentResult("dynamic", True, ["SDK Run inspected by actual Runtime: one"], [], {
        "task": name, "application_executed_steps": ["publish/draft"],
    }) for name in task_names]
    return _complete_logger(SimpleNamespace(base_dir=root, results={"dynamic": results}), task_names)


def _application_report(logger):
    write_application_result(logger)
    return json.loads((logger.base_dir / "application-result.json").read_text())


def test_complete_three_case_application_passes(tmp_path, monkeypatch):
    assert _application_report(_passing_logger(tmp_path, monkeypatch))["status"] == "passed"


def test_missing_third_application_case_cannot_pass(tmp_path, monkeypatch):
    logger = _passing_logger(tmp_path, monkeypatch)
    logger.results["dynamic"].pop()
    (logger.base_dir / "reports/recovery_DYNAMIC_SKILL_r1_rep1_report.json").unlink()
    report = _application_report(logger)
    assert report["status"] == "incomplete"
    assert any("Missing application cases" in failure for failure in report["failures"])


@pytest.mark.parametrize("change", ["duplicate", "extra", "treatment", "repetition"])
def test_application_case_identity_drift_cannot_pass(tmp_path, monkeypatch, change):
    logger = _passing_logger(tmp_path, monkeypatch)
    results = logger.results["dynamic"]
    if change == "duplicate":
        results.append(results[0])
    elif change == "extra":
        results[0].events_summary["task"] = "unexpected"
        results[0].name = "unexpected-DYNAMIC_SKILL-r1"
    elif change == "treatment":
        results[0].events_summary["treatment"] = "OTHER"
        results[0].name = "normal-OTHER-r1"
    else:
        results[0].name = "normal-DYNAMIC_SKILL-r2"
    report = _application_report(logger)
    assert report["status"] == "incomplete"
    assert report["failures"]


@pytest.mark.parametrize("change", ["missing", "schema", "hash", "duplicate", "subset"])
def test_application_requires_valid_complete_matrix(tmp_path, monkeypatch, change):
    from scaffold.python.aligned_comparison import expected_case_matrix_payload

    logger = _passing_logger(tmp_path, monkeypatch)
    path = logger.base_dir / "expected-case-matrix.json"
    matrix = json.loads(path.read_text())
    if change == "missing":
        path.unlink()
    else:
        if change == "schema":
            matrix["schema"] = "future"
        elif change == "hash":
            matrix["matrix_hash"] = "sha256:" + "0" * 64
        elif change == "duplicate":
            matrix["cases"].append(matrix["cases"][0])
        else:
            matrix = expected_case_matrix_payload((name, "DYNAMIC_SKILL", 1) for name in ("normal", "rejected"))
        path.write_text(json.dumps(matrix))
    report = _application_report(logger)
    assert report["status"] == "incomplete"
    assert report["failures"]


@pytest.mark.parametrize("change", ["hash", "names"])
def test_application_requires_original_manifest(tmp_path, monkeypatch, change):
    import hashlib

    logger = _passing_logger(tmp_path, monkeypatch)
    path = Path(logger.metadata["application_task_set"]["manifestPath"])
    path.write_text(json.dumps({"evaluation": {"tasks": [{"name": name} for name in ("normal", "rejected")]}}))
    if change == "names":
        logger.metadata["application_task_set"]["manifestHash"] = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
    report = _application_report(logger)
    assert report["status"] == "incomplete"
    assert any("Application task set rejected" in failure for failure in report["failures"])


@pytest.mark.parametrize("change", ["corrupt", "extra", "name", "rep", "passed", "quality"])
def test_application_checks_persisted_reports_even_if_reload_skips_them(tmp_path, monkeypatch, change):
    logger = _passing_logger(tmp_path, monkeypatch)
    path = logger.base_dir / "reports/normal_DYNAMIC_SKILL_r1_rep1_report.json"
    report = json.loads(path.read_text())
    if change == "corrupt":
        path.write_text("{")
    elif change == "extra":
        (path.parent / "duplicate.json").write_text(json.dumps(report))
    elif change == "quality":
        report["sample_quality"] = {"status": "excluded"}
        path.write_text(json.dumps(report))
    else:
        report[change] = {"name": "normal-OTHER-r1", "rep": 2, "passed": False}[change]
        path.write_text(json.dumps(report))
    result = _application_report(logger)
    assert result["status"] == "incomplete"
    assert result["failures"]


def test_corrupt_report_skipped_by_reload_cannot_pass(tmp_path, monkeypatch):
    import conftest

    logger = _passing_logger(tmp_path, monkeypatch)
    logger.reports_dir = logger.base_dir / "reports"
    (logger.reports_dir / "recovery_DYNAMIC_SKILL_r1_rep1_report.json").write_text("{")
    conftest.ExperimentPlugin._reload_results_from_reports(SimpleNamespace(logger=logger))
    assert sum(len(runs) for runs in logger.results.values()) == 2
    report = _application_report(logger)
    assert report["status"] == "incomplete"
    assert any("Missing application cases" in failure for failure in report["failures"])
    assert any("Application report rejected" in failure for failure in report["failures"])


@pytest.mark.parametrize("field", ["matrixHash", "confirmationHash", "snapshotHash", "experimentId"])
def test_application_rejects_drifted_collection_receipt(tmp_path, monkeypatch, field):
    logger = _passing_logger(tmp_path, monkeypatch)
    matrix = json.loads((logger.base_dir / "expected-case-matrix.json").read_text())
    receipt = {
        "schema": "comet.workflow.application.eval.task-set.v1",
        "experimentId": "eval-one", "confirmationHash": "fixed", "snapshotHash": "snapshot",
        "matrixHash": matrix["matrix_hash"],
        "taskSet": logger.metadata["application_task_set"],
    }
    receipt[field] = "changed"
    (logger.base_dir / "application-task-set.json").write_text(json.dumps(receipt))
    report = _application_report(logger)
    assert report["status"] == "incomplete"
    assert any("collection receipt identity" in failure for failure in report["failures"])


@pytest.mark.parametrize("field", ["schema", "matrix_hash", "case_count", "path"])
def test_application_rejects_matrix_metadata_drift(tmp_path, monkeypatch, field):
    logger = _passing_logger(tmp_path, monkeypatch)
    matrix = json.loads((logger.base_dir / "expected-case-matrix.json").read_text())
    logger.metadata["expected_case_matrix"] = {
        "schema": matrix["schema"], "matrix_hash": matrix["matrix_hash"],
        "case_count": 3, "path": "expected-case-matrix.json",
    }
    logger.metadata["expected_case_matrix"][field] = "changed"
    report = _application_report(logger)
    assert report["status"] == "incomplete"
    assert any("matrix metadata" in failure for failure in report["failures"])


def test_application_requires_explicit_included_quality(tmp_path, monkeypatch):
    logger = _passing_logger(tmp_path, monkeypatch)
    result = logger.results["dynamic"][0]
    del result.events_summary["sample_quality"]
    path = logger.base_dir / "reports/normal_DYNAMIC_SKILL_r1_rep1_report.json"
    report = json.loads(path.read_text())
    del report["events_summary"]["sample_quality"]
    path.write_text(json.dumps(report))
    actual = _application_report(logger)
    assert actual["status"] == "incomplete"
    assert any("sample quality" in failure for failure in actual["failures"])


def test_application_rejects_manifest_outside_project_generated_root(tmp_path, monkeypatch):
    logger = _passing_logger(tmp_path, monkeypatch)
    task_set = logger.metadata["application_task_set"]
    outside = tmp_path / "outside.yaml"
    outside.write_bytes(Path(task_set["manifestPath"]).read_bytes())
    task_set["manifestPath"] = str(outside)
    report = _application_report(logger)
    assert report["status"] == "incomplete"
    assert any("Application task set rejected" in failure for failure in report["failures"])


@pytest.mark.parametrize("target", ["receipt", "manifest", "generated", "reports", "report"])
def test_application_rejects_linked_evidence(tmp_path, monkeypatch, target):
    logger = _passing_logger(tmp_path, monkeypatch)
    manifest = Path(logger.metadata["application_task_set"]["manifestPath"])
    paths = {
        "receipt": logger.base_dir / "application-task-set.json",
        "manifest": manifest,
        "generated": manifest.parent.parent,
        "reports": logger.base_dir / "reports",
        "report": logger.base_dir / "reports/normal_DYNAMIC_SKILL_r1_rep1_report.json",
    }
    path = paths[target]
    if target == "receipt":
        path.write_text("{}")
    real_path = path.with_name(path.name + ".original")
    path.rename(real_path)
    path.symlink_to(real_path, target_is_directory=real_path.is_dir())
    report = _application_report(logger)
    assert report["status"] == "incomplete"
    assert any("symbolic link" in failure for failure in report["failures"])


def test_application_rejects_name_repetition_conflicting_with_report_and_sample(tmp_path, monkeypatch):
    logger = _passing_logger(tmp_path, monkeypatch)
    path = logger.base_dir / "reports/normal_DYNAMIC_SKILL_r1_rep1_report.json"
    report = json.loads(path.read_text())
    report["rep"] = 2
    report["events_summary"]["sample"] = 2
    # 保持持久化文件名、聚合数据和sample一致，仅name/matrix仍声明r1。
    path.unlink()
    (path.parent / "normal_DYNAMIC_SKILL_r1_rep2_report.json").write_text(json.dumps(report))
    for runs in logger.results.values():
        for result in runs:
            if result.events_summary["task"] == "normal":
                result.events_summary["sample"] = 2
    actual = _application_report(logger)
    assert actual["status"] == "incomplete"
    assert any("does not match" in failure or "身份不一致" in failure for failure in actual["failures"])
