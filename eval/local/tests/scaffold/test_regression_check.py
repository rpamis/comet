"""发布 Eval 的确定性 badcase；不调用模型、Docker 或完整构建。"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
from types import SimpleNamespace

import conftest
import pytest

from local.scripts import regression_check as cli
from scaffold.python import release_gate as gate
from scaffold.python.aligned_comparison import (
    EXECUTION_IDENTITY_SCHEMA,
    build_case_manifest,
    build_execution_identity,
    case_manifest_payload,
)
from scaffold.python.tasks import load_task
from scaffold.python.treatments import load_treatments


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def execution_identity():
    import hashlib

    image = "sha256:" + "a" * 64
    raw = {
        "schema": EXECUTION_IDENTITY_SCHEMA,
        "runtime_image_id": image,
        "image_id_hash": "sha256:" + hashlib.sha256(image.encode()).hexdigest(),
        "image_repo_digests_hash": "sha256:" + "b" * 64,
        "image_ref_hash": "sha256:" + "c" * 64,
        "claude_tool_version_hash": "sha256:" + "d" * 64,
    }
    return build_execution_identity(
        raw, model="test-model", interaction=SimpleNamespace(mode="none", max_turns=1)
    )


@pytest.fixture
def experiment(tmp_path, monkeypatch):
    candidate = {
        "schema": gate.CANDIDATE_SCHEMA,
        "revision": "a" * 40,
        "tree": "b" * 40,
        "sourceHash": "c" * 64,
        "sourceFileCount": 10,
        "packageVersion": "0.5.1",
        "dependencyHash": "d" * 64,
        "harnessHash": "e" * 64,
        "cliSnapshotHash": "f" * 64,
        "cliSnapshotFileCount": 10,
    }
    monkeypatch.setattr(cli, "_prepare_candidate", lambda: None)
    monkeypatch.setattr(cli, "candidate_identity", lambda: copy.deepcopy(candidate))
    monkeypatch.setattr(cli, "get_logs_dir", lambda: tmp_path / "logs")
    root = tmp_path / "logs/experiments/release_test"
    write(
        root / "metadata.json",
        {
            "experiment_id": root.name,
            "completed_at": "2026-10-24",
            "pytest_exitstatus": 0,
            "pytest_errors": 0,
            "pytest_skipped": 0,
            "release_candidate": candidate,
            "release_suite": gate.suite_contract(),
        },
    )
    write(root / "expected-case-matrix.json", gate.expected_matrix(1))
    write(root / "launch-result.json", {"experiment_id": root.name, "pytest_exitstatus": 0})
    identity = execution_identity()
    for index, case in enumerate(gate.suite_contract()["cases"]):
        task, treatment = case["task"], case["treatment"]
        manifest = build_case_manifest(
            task, gate.EVAL_ROOT / "local/tasks" / task, execution_identity=identity
        )
        report = {
            "name": f"{task}-{treatment}-r1",
            "rep": 1,
            "run_id": f"run-{index}",
            "passed": True,
            "agent_returncode": 0,
            "checks_failed": [],
            "checks_passed": ["business: passed", "workflow: passed"]
            + [f"[RUBRIC] {dim}: 1.00" for dim in case["minimums"]],
            "sample_quality": {"status": "included", "include_in_analysis": True},
            "events_summary": {
                "task": task,
                "treatment": treatment,
                "sample": 1,
                "profile": case["profile"],
                "release_candidate": candidate,
                "case_manifest": case_manifest_payload(manifest),
            },
        }
        if "cli" in case["coverage"]:
            report["events_summary"]["current_comet_build"] = {
                "schema": "comet.eval.current-comet-build.v1",
                "sourceHash": candidate["sourceHash"],
                "snapshotHash": "f" * 64,
                "compilerVersion": "release-dist",
            }
        write(root / f"reports/{index:02}.json", report)
    baseline = {
        "schema": gate.BASELINE_SCHEMA,
        "suiteHash": gate.digest_json(gate.suite_contract()),
        "count": 1,
        "sourceExperiment": root.name,
        "sourceCandidate": candidate,
        "dimensions": {
            gate.case_key(c["task"], c["treatment"]): {dim: 1.0 for dim in c["minimums"]}
            for c in gate.suite_contract()["cases"]
        },
    }
    baseline_file = tmp_path / "baseline.json"
    write(baseline_file, baseline)
    return SimpleNamespace(
        root=root, candidate=candidate, baseline=baseline, baseline_file=baseline_file
    )


def mutate_report(experiment, transform, filename="00.json"):
    path = experiment.root / "reports" / filename
    value = gate.read_json(path)
    transform(value)
    write(path, value)


def run_existing(experiment, *args):
    return cli.main(
        ["--experiment", experiment.root.name, "--baseline", str(experiment.baseline_file), *args]
    )


def test_help_and_plan_are_no_model_operations(monkeypatch, capsys):
    monkeypatch.setattr(cli.subprocess, "run", lambda *a, **k: pytest.fail("must not launch"))
    assert cli.main(["--plan"]) == 0
    assert '"sdk-cli"' in capsys.readouterr().out


def test_regression_check_help_imports_from_eval_working_directory():
    result = subprocess.run(
        [sys.executable, "local/scripts/regression_check.py", "--help"],
        cwd=gate.EVAL_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "--verify-receipt" in result.stdout


def test_matrix_is_bounded_complete_and_uses_supported_current_treatments():
    cases = gate.suite_contract()["cases"]
    assert len(cases) == 14
    assert len({(c["task"], c["treatment"]) for c in cases}) == 14
    assert sum(c["coverage"] == "sdk-cli" for c in cases) == 3
    treatments = load_treatments()
    for case in cases:
        task = load_task(case["task"])
        assert case["treatment"] in treatments
        assert case["treatment"] in task.default_treatments
        assert task.config.evaluation.profile == case["profile"]
        if "cli" in case["coverage"]:
            assert (task.environment_dir / conftest.CURRENT_COMET_CLI_MARKER).is_file()
        assert any(
            c.get("source") == "path" and "../assets/" in c["path"]
            for c in treatments[case["treatment"]].skills
        )
        assert "040" not in case["treatment"] and "039" not in case["treatment"]
    assert len(gate.expected_matrix(5)["cases"]) == 70


@pytest.mark.parametrize("count", [0, -1, 6, True, 1.5, None])
def test_rejects_invalid_or_unbounded_count(count):
    with pytest.raises(gate.GateError):
        gate.expected_matrix(count)


def test_complete_evidence_passes_without_refreshing_baseline(experiment):
    before = experiment.baseline_file.read_bytes()
    assert run_existing(experiment) == 0
    assert experiment.baseline_file.read_bytes() == before
    receipt = experiment.root / cli.RECEIPT_FILE
    assert cli.main(["--verify-receipt", str(receipt)]) == 0
    assert gate.read_json(receipt)["sampleCount"] == 14


@pytest.mark.parametrize("exit_code", [1, 2, 3, 4, 5])
def test_pytest_failure_never_reuses_older_report(experiment, monkeypatch, exit_code):
    calls = []

    def launch(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=exit_code)

    monkeypatch.setattr(cli.subprocess, "run", launch)
    before = experiment.baseline_file.read_bytes()
    assert cli.main(["--baseline", str(experiment.baseline_file)]) != 0
    assert experiment.baseline_file.read_bytes() == before
    assert not (experiment.root / cli.RECEIPT_FILE).exists()
    command, kwargs = calls[0]
    assert "--release-suite=current" in command
    assert not any("040" in item or "--task=" in item for item in command)
    assert kwargs["env"]["COMET_EVAL_EXPERIMENT_ID"] != experiment.root.name


def test_success_without_new_report_does_not_use_old_report(experiment, monkeypatch):
    monkeypatch.setattr(cli.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0))
    assert cli.main(["--baseline", str(experiment.baseline_file)]) != 0
    assert not (experiment.root / cli.RECEIPT_FILE).exists()


@pytest.mark.parametrize(
    "badcase",
    [
        "failed_checks",
        "passed_false",
        "missing_failed_checks",
        "agent_error",
        "missing_agent_exit",
        "zero_completion",
        "missing_dimension",
        "nan_dimension",
        "duplicate_dimension",
        "na_dimension",
        "excluded",
        "flagged",
        "missing_quality",
        "missing_candidate",
        "wrong_candidate",
        "wrong_profile",
        "wrong_task",
        "wrong_repetition",
        "old_cli",
        "missing_cli",
        "missing_case_manifest",
        "only_rubric",
    ],
)
def test_report_badcases_fail_closed(experiment, badcase):
    def break_report(report):
        events = report["events_summary"]
        if badcase == "failed_checks":
            report["checks_failed"] = ["sentence_feature: failed", "workflow_archive: incomplete"]
        elif badcase == "passed_false":
            report["passed"] = False
        elif badcase == "missing_failed_checks":
            report.pop("checks_failed")
        elif badcase == "agent_error":
            report["agent_returncode"] = 2
        elif badcase == "missing_agent_exit":
            report.pop("agent_returncode")
        elif badcase == "zero_completion":
            report["checks_passed"] = [
                v.replace("completion: 1.00", "completion: 0.00") for v in report["checks_passed"]
            ]
        elif badcase == "missing_dimension":
            report["checks_passed"].pop()
        elif badcase == "nan_dimension":
            report["checks_passed"][-1] = "[RUBRIC] safety_boundary: nan"
        elif badcase == "duplicate_dimension":
            report["checks_passed"].append(report["checks_passed"][-1])
        elif badcase == "na_dimension":
            report["checks_passed"][-1] = "[RUBRIC] safety_boundary: N/A"
        elif badcase in {"excluded", "flagged"}:
            report["sample_quality"]["status"] = badcase
        elif badcase == "missing_quality":
            report.pop("sample_quality")
        elif badcase == "missing_candidate":
            events.pop("release_candidate")
        elif badcase == "wrong_candidate":
            events["release_candidate"]["sourceHash"] = "old"
        elif badcase == "wrong_profile":
            events["profile"] = "generic-old"
        elif badcase == "wrong_task":
            events["task"] = "comet-full-workflow"
        elif badcase == "wrong_repetition":
            report["rep"] = 2
        elif badcase == "old_cli":
            events["current_comet_build"]["sourceHash"] = "old"
        elif badcase == "missing_cli":
            events.pop("current_comet_build")
        elif badcase == "missing_case_manifest":
            events.pop("case_manifest")
        elif badcase == "only_rubric":
            report["checks_passed"] = report["checks_passed"][2:]

    mutate_report(experiment, break_report)
    assert run_existing(experiment) != 0
    assert not (experiment.root / cli.RECEIPT_FILE).exists()


@pytest.mark.parametrize(
    "badcase",
    [
        "missing_report",
        "duplicate_report",
        "malformed_report",
        "empty_matrix",
        "skipped",
        "pytest_error",
        "incomplete",
        "changed_candidate",
        "failed_launch",
    ],
)
def test_experiment_badcases_fail_closed(experiment, badcase):
    metadata_file = experiment.root / "metadata.json"
    metadata = gate.read_json(metadata_file)
    if badcase == "missing_report":
        (experiment.root / "reports/00.json").unlink()
    elif badcase == "duplicate_report":
        write(
            experiment.root / "reports/extra.json",
            gate.read_json(experiment.root / "reports/00.json"),
        )
    elif badcase == "malformed_report":
        (experiment.root / "reports/00.json").write_text("{")
    elif badcase == "empty_matrix":
        write(experiment.root / "expected-case-matrix.json", {})
    elif badcase == "skipped":
        metadata["pytest_skipped"] = 1
    elif badcase == "pytest_error":
        metadata["pytest_exitstatus"] = 2
    elif badcase == "incomplete":
        metadata.pop("completed_at")
    elif badcase == "changed_candidate":
        metadata["release_candidate"]["sourceHash"] = "old"
    elif badcase == "failed_launch":
        write(
            experiment.root / "launch-result.json",
            {"experiment_id": experiment.root.name, "pytest_exitstatus": 2},
        )
    write(metadata_file, metadata)
    assert run_existing(experiment) != 0


@pytest.mark.parametrize(
    "badcase", ["missing", "legacy", "missing_dimension", "extra_dimension", "zero", "nan"]
)
def test_baseline_never_silently_accepts_missing_or_degraded_dimensions(experiment, badcase):
    baseline = copy.deepcopy(experiment.baseline)
    key = next(iter(baseline["dimensions"]))
    if badcase == "missing":
        experiment.baseline_file.unlink()
    else:
        if badcase == "legacy":
            baseline = {"dimensions": {"completion": 0.8}}
        elif badcase == "missing_dimension":
            baseline["dimensions"][key].pop("completion")
        elif badcase == "extra_dimension":
            baseline["dimensions"][key]["new_dimension"] = 0
        elif badcase == "zero":
            baseline["dimensions"][key]["completion"] = 0
        elif badcase == "nan":
            baseline["dimensions"][key]["completion"] = float("nan")
        write(experiment.baseline_file, baseline)
    before = experiment.baseline_file.read_bytes() if experiment.baseline_file.exists() else None
    assert run_existing(experiment) != 0
    assert (
        experiment.baseline_file.read_bytes() if experiment.baseline_file.exists() else None
    ) == before


def test_collect_then_explicit_baseline_init_reuses_same_experiment(experiment):
    experiment.baseline_file.unlink()
    assert run_existing(experiment, "--collect-only") == 0
    assert not (experiment.root / cli.RECEIPT_FILE).exists()
    assert run_existing(experiment, "--initialize-baseline", str(experiment.baseline_file)) == 0
    before = experiment.baseline_file.read_bytes()
    assert run_existing(experiment, "--initialize-baseline", str(experiment.baseline_file)) != 0
    assert experiment.baseline_file.read_bytes() == before
    assert run_existing(experiment) == 0


def test_initialization_rejects_failed_zero_results(experiment):
    mutate_report(experiment, lambda r: r.update(checks_failed=["task failed"], passed=False))
    destination = experiment.baseline_file.parent / "new.json"
    assert run_existing(experiment, "--initialize-baseline", str(destination)) != 0
    assert not destination.exists()


def test_receipt_revalidates_original_reports_and_dirty_candidate(experiment, monkeypatch):
    assert run_existing(experiment) == 0
    path = experiment.root / cli.RECEIPT_FILE
    old_candidate = copy.deepcopy(experiment.candidate)
    changed = {**old_candidate, "sourceHash": "0" * 64}
    monkeypatch.setattr(cli, "candidate_identity", lambda: changed)
    assert cli.main(["--verify-receipt", str(path)]) != 0
    monkeypatch.setattr(cli, "candidate_identity", lambda: old_candidate)
    mutate_report(experiment, lambda r: r.update(checks_failed=["tampered failure"]))
    assert cli.main(["--verify-receipt", str(path)]) != 0


def test_current_source_hash_changes_without_commit_change(tmp_path):
    files = {
        "package.json": '{"version":"0.5.1"}',
        "tsconfig.json": "{}",
        "bin/comet.js": "// cli",
        "app/cli.ts": "// source",
        "assets/manifest.json": "{}",
        "assets/skills/comet/SKILL.md": "skill",
    }
    for relative, value in files.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
    first = gate.current_source_identity(tmp_path)
    (tmp_path / "app/cli.ts").write_text("// changed but uncommitted")
    assert gate.current_source_identity(tmp_path) != first


def test_current_cli_snapshot_and_release_candidate_use_identical_source_hash(
    tmp_path, monkeypatch
):
    source = tmp_path / "source"
    for relative, value in {
        "package.json": "{}",
        "tsconfig.json": "{}",
        "bin/comet.js": "// cli",
        "app/cli.ts": "// source",
        "assets/manifest.json": "{}",
        "assets/skills/comet/SKILL.md": "skill",
    }.items():
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
    environment = tmp_path / "env"
    environment.mkdir()
    (environment / conftest.CURRENT_COMET_CLI_MARKER).touch()

    def compile_source(checkout, output):
        for relative in ("app/cli/index.js", "domains/dashboard/native-adapter.js"):
            path = output / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("// compiled")
        return "test-compiler"

    monkeypatch.setenv("BENCH_COMET_SOURCE_ROOT", str(source))
    monkeypatch.setattr(conftest, "_build_current_comet_dist", compile_source)
    conftest._copy_current_comet_cli_snapshot(environment, tmp_path / "workspace")
    build = gate.read_json(tmp_path / "workspace/_eval_current_comet/build-identity.json")
    assert build["sourceHash"] == gate.current_source_identity(source)["sourceHash"]


@pytest.mark.parametrize(
    "relative",
    [
        "build.js",
        "scripts/build/build-native-facade.mjs",
        "scripts/install/postinstall.js",
        "scripts/release/verify-release.mjs",
        "bin/other-entry.js",
        "dist/app/cli/index.js",
        "domains/dashboard/web/theme.css",
        "pnpm-lock.yaml",
        "package-lock.json",
    ],
)
def test_release_hash_binds_build_install_bin_dist_and_lock_changes(tmp_path, relative):
    for name in ("package.json", "bin/comet.js", "assets/manifest.json", relative):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("before")
    before = gate.current_source_identity(tmp_path)
    (tmp_path / relative).write_text("changed after eval, same HEAD")
    assert gate.current_source_identity(tmp_path) != before


def test_release_snapshot_uses_actual_distribution_without_recompiling(tmp_path, monkeypatch):
    source = tmp_path / "candidate"
    files = {
        "package.json": "{}",
        "bin/comet.js": "// entry",
        "assets/manifest.json": "{}",
        "assets/skills/comet/SKILL.md": "skill",
        "app/cli.ts": "// source",
        "dist/app/cli/index.js": "// actual CLI",
        "dist/domains/dashboard/native-adapter.js": "// actual adapter",
        "dist/app/commands/native.bundle.js": "// actual bundled facade",
    }
    for name, value in files.items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
    env = tmp_path / "environment"
    env.mkdir()
    (env / conftest.CURRENT_COMET_CLI_MARKER).touch()
    monkeypatch.setenv("BENCH_COMET_SOURCE_ROOT", str(source))
    monkeypatch.setenv("COMET_EVAL_RELEASE_SUITE", "current")
    monkeypatch.setattr(
        conftest,
        "_build_current_comet_dist",
        lambda *a: pytest.fail("must not rebuild substitute CLI"),
    )
    conftest._copy_current_comet_cli_snapshot(env, tmp_path / "workspace")
    snapshot = tmp_path / "workspace/_eval_current_comet"
    build = gate.read_json(snapshot / "build-identity.json")
    assert build["compilerVersion"] == "release-dist"
    assert build["snapshotHash"] == gate.cli_snapshot_identity(source)["cliSnapshotHash"]
    assert (
        snapshot / "dist/app/commands/native.bundle.js"
    ).read_text() == "// actual bundled facade"


@pytest.mark.parametrize(
    "field,value", [("snapshotHash", "0" * 64), ("compilerVersion", "test-compiler")]
)
def test_valid_looking_but_different_cli_snapshot_is_rejected(experiment, field, value):
    mutate_report(
        experiment,
        lambda report: report["events_summary"]["current_comet_build"].update({field: value}),
    )
    assert run_existing(experiment) != 0


def test_collection_refuses_filtered_release_matrix_before_models():
    config = SimpleNamespace(
        option=SimpleNamespace(numprocesses=0, release_suite="current"),
        getoption=lambda name: 1 if name == "--count" else None,
    )
    plugin = conftest.ExperimentPlugin(config)
    plugin.logger = SimpleNamespace(metadata={})
    case = gate.RELEASE_CASES[0]
    item = SimpleNamespace(
        callspec=SimpleNamespace(params={"task_name": case[0], "treatment_name": case[1]}),
        get_closest_marker=lambda name: SimpleNamespace(kwargs={"repetition": 1}),
    )
    with pytest.raises(pytest.UsageError, match="不会启动模型"):
        plugin.pytest_collection_finish(SimpleNamespace(items=[item]))


def test_current_classic_sdk_fixture_can_meet_release_rubric_thresholds(tmp_path):
    from local.tests.scaffold.test_classic_eval_compatibility import sdk_archive, save_checkpoint
    from scaffold.python.validation import rubric

    change, run = sdk_archive(tmp_path)
    run["actions"].extend(
        {"stepId": f"full.{step}", "status": "succeeded", "outcome": {"status": "succeeded"}}
        for step in ("open.revalidate", "build.check", "verify.check", "archive.preflight")
    )
    (change / "proposal.md").write_text("Purpose and scope\n" * 12)
    (change / "design.md").write_text("tradeoff alternative risk")
    (change / "tasks.md").write_text("- [x] task\n" * 3)
    (tmp_path / "test_feature.py").write_text("assert 1 == 1\n")
    save_checkpoint(change, run)
    outputs = {
        "events": {
            "skills_invoked": [
                "comet-classic",
                "comet-open",
                "openspec-new-change",
                "brainstorming",
            ],
            "commands_run": ["comet guard example verify --apply -- python3 test_feature.py"],
            "interaction": {"mode": "auto_user", "actual_turns": 2},
            "files_created": [
                "test_feature.py",
                "docs/openspec/changes/example/specs/example/spec.md",
            ],
        },
        "business_completion": {"passed": ["business: passed"], "failed": []},
        "workflow_completion": {"passed": ["workflow: passed"], "failed": []},
    }
    passed, failed = rubric.comet_rubric_validator(tmp_path, outputs)
    assert failed == []
    classic_case = next(
        case for case in gate.suite_contract()["cases"] if case["profile"] == "comet-workflow"
    )
    scores = gate.report_dimensions({"checks_passed": ["task: passed", *passed]}, classic_case)
    assert all(scores[dim] >= minimum for dim, minimum in classic_case["minimums"].items())


def test_each_native_profile_can_emit_every_required_dimension(tmp_path):
    from scaffold.python.validation.generic_rubric import generic_rubric_validator

    for case in gate.suite_contract()["cases"]:
        if case["profile"] != "generic":
            continue
        task = load_task(case["task"])
        for relative in task.config.evaluation.expected_artifacts:
            path = tmp_path / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.suffix:
                path.write_text("fixture")
            else:
                path.mkdir(exist_ok=True)
        outputs = {
            "events": {"skills_invoked": ["comet-native"]},
            "completion": {"passed": ["task: passed"], "failed": []},
            "required_skills": ["comet-native"],
            "require_skill_invocation": True,
            "expected_artifacts": task.config.evaluation.expected_artifacts,
            "interaction": {
                "mode": task.config.interaction.mode,
                "max_turns": task.config.interaction.max_turns,
                "actual_turns": 1,
            },
        }
        passed, failed = generic_rubric_validator(tmp_path, outputs)
        assert failed == []
        assert gate.report_dimensions({"checks_passed": ["task: passed", *passed]}, case)


def test_preflight_failure_stops_before_model_launch(monkeypatch):
    calls = []

    def fail_build(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=1)

    monkeypatch.setattr(cli.subprocess, "run", fail_build)
    with pytest.raises(gate.GateError, match="未启动模型"):
        cli._run_eval(1)
    assert len(calls) == 1
    assert calls[0] == ["node", "scripts/build/build-runtime-schemas.mjs", "--check"]


def test_preflight_uses_local_node_without_implicit_package_manager_install(monkeypatch):
    calls = []
    monkeypatch.setattr(
        cli.subprocess,
        "run",
        lambda command, **kwargs: calls.append(command) or SimpleNamespace(returncode=0),
    )
    cli._prepare_candidate()
    assert ["node", "build.js"] in calls
    assert ["node", "scripts/lint/core-regressions.mjs"] in calls
    assert all(command[0] == "node" for command in calls)


def test_tolerated_drop_does_not_ratchet_baseline_down(experiment):
    before = experiment.baseline_file.read_bytes()
    mutate_report(
        experiment,
        lambda report: report.update(
            checks_passed=[
                line.replace("efficiency: 1.00", "efficiency: 0.93")
                for line in report["checks_passed"]
            ]
        ),
    )
    assert run_existing(experiment) == 0
    assert experiment.baseline_file.read_bytes() == before
    mutate_report(
        experiment,
        lambda report: report.update(
            checks_passed=[
                line.replace("efficiency: 0.93", "efficiency: 0.85")
                for line in report["checks_passed"]
            ]
        ),
    )
    assert run_existing(experiment) != 0
    assert experiment.baseline_file.read_bytes() == before


def test_standalone_receipt_without_full_evidence_is_not_release_proof(experiment, tmp_path):
    assert run_existing(experiment) == 0
    receipt = gate.read_json(experiment.root / cli.RECEIPT_FILE)
    standalone = tmp_path / "copied" / experiment.root.name / cli.RECEIPT_FILE
    write(standalone, receipt)
    assert cli.main(["--verify-receipt", str(standalone)]) != 0


@pytest.mark.parametrize("field", ["pytest_exitstatus", "pytest_errors", "pytest_skipped"])
@pytest.mark.parametrize("value", [False, True, 0.0, "0", None, "missing"])
def test_metadata_requires_explicit_integer_statuses(experiment, field, value):
    path = experiment.root / "metadata.json"
    metadata = gate.read_json(path)
    if value == "missing":
        metadata.pop(field)
    else:
        metadata[field] = value
    write(path, metadata)
    with pytest.raises(gate.GateError):
        cli.make_receipt(experiment.root, 1, experiment.baseline, 0.1)


@pytest.mark.parametrize("value", [False, True, 0.0, "0", None, "missing"])
@pytest.mark.parametrize("mode", ["receipt", "collect", "initialize"])
def test_every_mode_uses_strict_launch_record(experiment, value, mode, tmp_path):
    path = experiment.root / "launch-result.json"
    launch = gate.read_json(path)
    if value == "missing":
        launch.pop("pytest_exitstatus")
    else:
        launch["pytest_exitstatus"] = value
    write(path, launch)
    if mode == "receipt":
        with pytest.raises(gate.GateError):
            cli.make_receipt(experiment.root, 1, experiment.baseline, 0.1)
    else:
        destination = tmp_path / "new-baseline.json"
        args = (
            ["--collect-only"] if mode == "collect" else ["--initialize-baseline", str(destination)]
        )
        assert run_existing(experiment, *args) != 0
        assert not destination.exists()


@pytest.mark.parametrize("field", ["agent_returncode", "sample"])
@pytest.mark.parametrize("value", [False, True, 0.0, 1.0, None, "0"])
def test_report_integer_fields_reject_boolean_float_and_missing(experiment, field, value):
    def mutate(report):
        target = report["events_summary"] if field == "sample" else report
        target[field] = value

    mutate_report(experiment, mutate)
    with pytest.raises(gate.GateError):
        cli.make_receipt(experiment.root, 1, experiment.baseline, 0.1)


def test_combined_boolean_malformed_experiment_cannot_pass(experiment):
    path = experiment.root / "metadata.json"
    metadata = gate.read_json(path)
    metadata.update(pytest_exitstatus=False, pytest_errors=False, pytest_skipped=False)
    write(path, metadata)
    write(
        experiment.root / "launch-result.json",
        {"experiment_id": experiment.root.name, "pytest_exitstatus": False},
    )
    for path in (experiment.root / "reports").glob("*.json"):
        report = gate.read_json(path)
        report["agent_returncode"] = False
        report["events_summary"]["sample"] = True
        write(path, report)
    with pytest.raises(gate.GateError):
        cli.make_receipt(experiment.root, 1, experiment.baseline, 0.1)


@pytest.mark.parametrize("field", ["sourceFileCount", "cliSnapshotFileCount"])
@pytest.mark.parametrize("value", [False, True, 1.0, 0, None])
def test_candidate_file_counts_require_positive_json_integers(experiment, field, value):
    candidate = {**experiment.candidate, field: value}
    with pytest.raises(gate.GateError):
        gate.validate_candidate(candidate)
    baseline = {**experiment.baseline, "sourceCandidate": candidate}
    with pytest.raises(gate.GateError):
        gate.validate_baseline(baseline)


@pytest.mark.parametrize("value", [False, True, 1.0, None])
def test_release_matrix_repetitions_are_strict_json_integers(experiment, value):
    path = experiment.root / "expected-case-matrix.json"
    matrix = gate.read_json(path)
    matrix["cases"][0]["rep"] = value
    write(path, matrix)
    with pytest.raises(gate.GateError):
        cli.make_receipt(experiment.root, 1, experiment.baseline, 0.1)


def test_suite_boolean_minimum_cannot_equal_numeric_contract(experiment):
    path = experiment.root / "metadata.json"
    metadata = gate.read_json(path)
    metadata["release_suite"]["cases"][0]["minimums"]["completion"] = True
    write(path, metadata)
    with pytest.raises(gate.GateError):
        cli.make_receipt(experiment.root, 1, experiment.baseline, 0.1)


@pytest.mark.parametrize(
    "field,value", [("checksFailed", False), ("checksPassed", 1.0), ("rep", True)]
)
def test_receipt_counters_do_not_accept_equal_boolean_or_float(experiment, field, value):
    assert run_existing(experiment) == 0
    path = experiment.root / cli.RECEIPT_FILE
    receipt = gate.read_json(path)
    receipt["samples"][0][field] = value
    write(path, receipt)
    assert cli.main(["--verify-receipt", str(path)]) != 0
