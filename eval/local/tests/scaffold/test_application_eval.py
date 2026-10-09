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
    result_root = tmp_path / "experiment"
    result_root.mkdir()
    context = {"preview": preview, "skillRoot": str(skill), "experimentId": "eval-one", "snapshotHash": "snapshot", "resultFile": str(result_root / "application-result.json")}
    monkeypatch.setenv("COMET_APPLICATION_EVAL_CONTEXT", json.dumps(context))
    return skill, result_root


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
    passed, failed = application_runs_validator(tmp_path, {"skill_package_path": "_eval_target_skills/skill"})
    assert not passed
    assert failed == ["No actual SDK application Run was verified"]


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
    storage = tmp_path / ".comet/runtime/applications/report/run-one"
    storage.mkdir(parents=True)
    (storage / "0000000000000001.json").write_text(json.dumps({"run": {"runId": "one"}}))
    monkeypatch.setattr("scaffold.python.utils.run_command_in_docker", lambda *_: SimpleNamespace(returncode=0, stdout=json.dumps({"status": "succeeded", "application": {"id": "another", "version": "1"}, "data": {"actions": [], "waits": []}})))
    passed, failed = application_runs_validator(tmp_path, {"skill_package_path": "_eval_target_skills/skill"})
    assert not passed
    assert any("another application" in failure for failure in failed)


@pytest.mark.parametrize("runtime_hash,definition_hash,accepted", [("fixed-runtime", "fixed-definition", True), ("changed", "fixed-definition", False), ("fixed-runtime", "changed", False)])
def test_runtime_inspection_binds_actual_code_and_tracks_decisions_and_recovery(tmp_path, monkeypatch, runtime_hash, definition_hash, accepted):
    _context(tmp_path, monkeypatch)
    storage = tmp_path / ".comet/runtime/applications/report/run-one"
    storage.mkdir(parents=True)
    (storage / "0000000000000001.json").write_text(json.dumps({"run": {"runId": "one"}}))
    response = {"status": "succeeded", "application": {"id": "report", "version": "1", "contentHash": runtime_hash}, "data": {"workflow": {"id": "publish", "hash": definition_hash}, "actions": [{"stepId": "draft", "attempt": 2, "status": "succeeded"}], "waits": [{"stepId": "approve", "decision": {"choice": "rejected"}}]}}
    monkeypatch.setattr("scaffold.python.utils.run_command_in_docker", lambda *_: SimpleNamespace(returncode=0, stdout=json.dumps(response)))
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
    write_application_result(logger)
    report = json.loads((result_root / "application-result.json").read_text())
    assert report["status"] == expected
    assert report["application"] == {"id": "report", "version": "1", "contentHash": "a" * 64}
    assert report["confirmationHash"] == "fixed"
    assert report["uncoveredSteps"] == ["publish/publish"]
    assert report["costUsd"] is None


def test_two_started_runs_without_execution_cannot_pass_the_application_eval(tmp_path, monkeypatch):
    _, result_root = _context(tmp_path, monkeypatch)
    results = [TreatmentResult("dynamic", True, ["SDK Run inspected by actual Runtime: one"], [], {"task": name, "application_coverage": ["publish/approve"]}) for name in ["normal", "rejected"]]
    write_application_result(SimpleNamespace(base_dir=result_root, results={"dynamic": results}))
    report = json.loads((result_root / "application-result.json").read_text())
    assert report["status"] == "incomplete"
    assert report["executedSteps"] == []
    assert any("actually executed" in failure for failure in report["failures"])


def test_report_does_not_invent_model_identity_or_treat_partial_costs_as_total(tmp_path, monkeypatch):
    _, result_root = _context(tmp_path, monkeypatch)
    results = [TreatmentResult("dynamic", True, ["SDK Run inspected by actual Runtime: one"], [], {"task": name, "application_executed_steps": ["publish/draft"], "execution_identity": {"model": None}, **({"model_usage": {"actual-provider-model": {}}, "total_cost_usd": 0.5} if name == "normal" else {})}) for name in ["normal", "rejected"]]
    write_application_result(SimpleNamespace(base_dir=result_root, results={"dynamic": results}))
    report = json.loads((result_root / "application-result.json").read_text())
    assert report["actualModels"] == ["actual-provider-model"]
    assert report["costUsd"] is None
    assert report["caseCostUsd"] is None
    assert report["knownCaseCostUsd"] == 0.5
    assert report["costStatus"] == "partial"
