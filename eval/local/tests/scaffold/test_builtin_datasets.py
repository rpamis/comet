import pytest
import hashlib
import io
import json
import tarfile
from pathlib import Path
from scaffold.python.dataset_fetch import report_progress

from scaffold.python.builtin_datasets import reward_result, tree_hash, load_dataset_tasks
from scaffold.python.dataset_fetch import extract
from scaffold.python.builtin_datasets import DatasetTask
from scaffold.python.tasks import TaskConfig
from types import SimpleNamespace


@pytest.fixture
def dataset_plan(tmp_path):
    source = tmp_path / "source/tasks/example"
    (source / "environment").mkdir(parents=True)
    original = "FROM python:3.12-slim\nRUN echo existing-node-20\nWORKDIR /workspace\n"
    (source / "environment/Dockerfile").write_text(original, encoding="utf-8")
    plan = {
        "root": str(source.parent.parent),
        "dataset": {"id": "skillsbench"},
        "tasks": [
            {
                "id": "example",
                "source": str(source),
                "supported": True,
                "contentHash": tree_hash(source),
                "instruction": "Do the task.",
                "timeout": 900,
            }
        ],
        "contentHash": "sha256:plan",
    }
    file = tmp_path / "dataset.json"
    file.write_text(json.dumps(plan), encoding="utf-8")
    return file, original


def test_dataset_node_tools_do_not_overwrite_original_node(dataset_plan):
    file, original = dataset_plan
    dockerfile = (load_dataset_tasks(str(file))[0].environment_dir / "Dockerfile").read_text()
    assert dockerfile.startswith(original)
    assert "COPY --from=node:22-bookworm-slim /usr/local/ /opt/comet-node/" in dockerfile
    assert "ENV PATH=/opt/comet-node/bin:/opt/comet-agent/bin:${PATH}" in dockerfile
    assert "node@22" not in dockerfile
    assert "libstdc++6" in dockerfile
    assert (
        'python3 -I /opt/comet-install-claude.py "${CLAUDE_CODE_VERSION}" /opt/comet-agent'
        in dockerfile
    )
    assert "type=cache,id=comet-eval-npm,target=/root/.npm,sharing=locked" in dockerfile


def test_goal_dataset_has_same_task_but_no_comet_install_or_skill(dataset_plan):
    file, original = dataset_plan
    plan = json.loads(file.read_text())
    plan["treatment"] = "CLAUDE_CODE_GOAL"
    file.write_text(json.dumps(plan))
    task = load_dataset_tasks(str(file))[0]
    dockerfile = (task.environment_dir / "Dockerfile").read_text()
    assert dockerfile.startswith(original)
    assert "/opt/comet-agent" in dockerfile
    assert "/opt/comet-cli" not in dockerfile
    assert "/opt/comet-current" not in dockerfile
    assert not (task.environment_dir / ".include-current-comet-cli").exists()
    assert task.config.default_treatments == ["CLAUDE_CODE_GOAL"]
    assert not task.config.evaluation.required_skills
    assert not task.config.evaluation.require_skill_invocation
    assert task.config.interaction.goal
    import conftest

    interaction = conftest._resolve_interaction_config(
        task, "generic", SimpleNamespace(getoption=lambda *_: None)
    )
    assert interaction.goal
    dynamic = conftest._get_dynamic_treatment_config(
        SimpleNamespace(_comet_dataset_plan_file=str(file))
    )
    assert dynamic.name == "CLAUDE_CODE_GOAL"
    assert not dynamic.skills and not dynamic.claude_md


def test_goal_runner_selects_real_goal_and_pins_evaluator_model(tmp_path, monkeypatch):
    import conftest
    from scaffold.python.tasks import InteractionConfig

    calls = []

    def run(*args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout="done", stderr="")

    monkeypatch.setattr(conftest, "run_claude_loop_in_docker", run)
    monkeypatch.setattr(conftest, "build_agent_environment", lambda *_: {})
    monkeypatch.setattr(
        conftest,
        "_resolve_eval_execution",
        lambda *_: conftest.ResolvedExecution("claude-code", "glm-5.3-flash", None, {}),
    )
    execute = conftest.run_claude.__wrapped__(tmp_path, None, SimpleNamespace(config=None))
    execute(
        "original task", timeout=None, interaction=InteractionConfig(mode="auto_user", goal=True)
    )
    args, kwargs = calls[0]
    assert "--goal" in args[1]
    assert kwargs["environment"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "glm-5.3-flash"
    assert kwargs["timeout"] is None


def test_builtin_dataset_workflow_has_no_default_wall_clock_deadline():
    import conftest

    for dataset in ("skillsbench", "workbuddy-code"):
        config = SimpleNamespace(
            _comet_dataset_plan_file=f"{dataset}.json",
            getoption=lambda *_: None,
        )
        assert conftest._resolve_agent_timeout(config, task_timeout=900, floor=1500) is None
        config.getoption = lambda *_: 3600
        assert conftest._resolve_agent_timeout(config, task_timeout=900, floor=1500) == 3600
    regular = SimpleNamespace(getoption=lambda *_: None)
    assert conftest._resolve_agent_timeout(regular, task_timeout=900, floor=1500) == 1500


def test_workbuddy_shape_confirmation_replays_chinese_decision_request():
    from scaffold.python.utils import run_shell

    response = (
        "**Shape 已就绪**，等你确认后才会进入 Build。\n"
        "完整文档在 docs/comet/changes/local-del-robust-cleanup/。\n"
        "**请确认以上目标、范围、验收项与非目标是否准确**"
        "（回复“确认”即进入 Build；如需调整请直接说明）。"
    )
    assert run_shell("decision-point.sh", response, check=False).returncode == 0
    completed = "Shape 已确认，Build 和 Verify 已完成，变更已归档。无需确认。"
    assert run_shell("decision-point.sh", completed, check=False).returncode == 1


def test_dataset_unlimited_deadline_reaches_both_agent_loop_adapters(tmp_path, monkeypatch):
    import conftest
    from scaffold.python.tasks import InteractionConfig

    calls = []

    def run(*args, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(returncode=0, stdout="done", stderr="")

    monkeypatch.setattr(conftest, "run_claude_loop_in_docker", run)
    monkeypatch.setattr(conftest, "run_agent_loop_in_docker", run)
    monkeypatch.setattr(conftest, "build_agent_environment", lambda *_: {})
    for agent in ("claude-code", "codex"):
        execution = conftest.ResolvedExecution(agent, None, None, {})
        monkeypatch.setattr(conftest, "_resolve_eval_execution", lambda *_: execution)
        execute = conftest.run_claude.__wrapped__(tmp_path, None, SimpleNamespace(config=None))
        for timeout, expected in ((None, None), (3600, 3660)):
            result = execute(
                "complete the dataset task",
                timeout=timeout,
                interaction=InteractionConfig(mode="auto_user"),
            )
            assert result.returncode == 0
            assert calls[-1]["timeout"] == expected
            assert not (tmp_path / ".eval-task-prompt.txt").exists()


def test_dataset_pytest_guard_does_not_preempt_the_native_workflow():
    import conftest
    import importlib.util

    file = Path(conftest.__file__).parent / "tasks/test_tasks.py"
    spec = importlib.util.spec_from_file_location("dataset_timeout_task_probe", file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original = next(m for m in module.test_task_treatment.pytestmark if m.name == "timeout")
    items = []
    for nodeid in (
        "local/tests/tasks/test_tasks.py::test_task_treatment[example-NATIVE-r1]",
        "local/tests/scaffold/test_example.py::test_task_treatment",
    ):
        marks = [original]
        item = SimpleNamespace(
            nodeid=nodeid,
            add_marker=lambda marker, append=True, marks=marks: (
                marks.append(marker.mark) if append else marks.insert(0, marker.mark)
            ),
            get_closest_marker=lambda name, marks=marks: next(m for m in marks if m.name == name),
        )
        items.append(item)
    config = SimpleNamespace(_comet_dataset_plan_file="dataset.json")
    hook = getattr(conftest, "pytest_collection_modifyitems", None)
    if hook:
        hook(config, items)
    assert items[0].get_closest_marker("timeout").args == (0,)
    assert items[1].get_closest_marker("timeout").args == original.args
    normal_marks = []
    normal = SimpleNamespace(
        nodeid=items[0].nodeid, add_marker=lambda *_, **__: normal_marks.append("changed")
    )
    if hook:
        hook(SimpleNamespace(), [normal])
    assert not normal_marks


def test_workbuddy_missing_dataset_contract_stops_before_preparing_model(dataset_plan):
    file, _ = dataset_plan
    plan = json.loads(file.read_text())
    plan["dataset"]["id"] = "workbuddy-code"
    shared = Path(plan["root"]) / "shared"
    shared.mkdir()
    plan["sharedHash"] = tree_hash(shared)
    file.write_text(json.dumps(plan))
    with pytest.raises(ValueError, match="dataset.toml"):
        load_dataset_tasks(str(file))


def test_workbuddy_dataset_contract_drift_blocks_load_and_scoring(
    dataset_plan, tmp_path, monkeypatch
):
    from scaffold.python.builtin_datasets import dataset_config_hash

    file, _ = dataset_plan
    plan = json.loads(file.read_text())
    plan["dataset"]["id"] = "workbuddy-code"
    root = Path(plan["root"])
    (root / "shared").mkdir()
    plan["sharedHash"] = tree_hash(root / "shared")
    contract = root / "dataset.toml"
    contract.write_text('[dataset]\nid="example"\n')
    plan["datasetConfigHash"] = dataset_config_hash(root)
    file.write_text(json.dumps(plan))
    task = load_dataset_tasks(str(file))[0]
    contract.write_text('[dataset]\nid="changed"\n')
    with pytest.raises(ValueError, match="dataset.toml"):
        load_dataset_tasks(str(file))
    monkeypatch.setattr(
        "scaffold.python.utils.build_docker_image", lambda *_: pytest.fail("must not build")
    )
    passed, failed = task._score_dataset(tmp_path, {})
    assert not passed and "dataset_input_changed" in failed[0]


def test_dataset_score_preserves_redacted_container_failure(dataset_plan, tmp_path, monkeypatch):
    import subprocess

    file, _ = dataset_plan
    task = load_dataset_tasks(str(file))[0]
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".dataset-task.json").write_text(json.dumps({"workdir": "/workspace"}))
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "diagnostic-private-token")
    calls = []

    def docker(*args, **kwargs):
        calls.append(args)
        if args[0] == "start":
            raise subprocess.CalledProcessError(
                1,
                ["docker", *args],
                output="scoring started",
                stderr="VerifierContractError: missing dataset.toml diagnostic-private-token",
            )
        return SimpleNamespace(stdout="")

    monkeypatch.setattr("scaffold.python.builtin_datasets.docker", docker)
    monkeypatch.setattr("scaffold.python.utils.build_docker_image", lambda *_, **__: "image")
    passed, failed = task._score_dataset(workspace, {})
    assert not passed
    assert "VerifierContractError: missing dataset.toml" in failed[0]
    assert "scoring started" in failed[0]
    assert "diagnostic-private-token" not in failed[0]
    assert calls[-1][0] == "rm"


def test_skillsbench_scoring_preserves_the_original_verifier_absolute_directory(
    tmp_path, monkeypatch, capsys
):
    from scaffold.python import dataset_score as scoring
    import sys

    real_path = Path
    source = tmp_path / "original/tasks/example/verifier"
    source.mkdir(parents=True)
    (source / "test.sh").write_text("pytest /verifier/test_outputs.py\n")
    (source / "test_outputs.py").write_text("assert True\n")
    verifier = tmp_path / "verifier"
    reward = tmp_path / "logs/verifier/reward.txt"
    mappings = {
        "/opt/dataset-original/tasks": tmp_path / "original/tasks",
        "/verifier": verifier,
        "/tests": tmp_path / "tests",
        "/logs/verifier/reward.txt": reward,
    }
    monkeypatch.setattr(scoring, "Path", lambda value: mappings.get(str(value), real_path(value)))
    monkeypatch.setattr(sys, "argv", ["score", "skillsbench", "example"])

    def run(command, **kwargs):
        assert command == ["bash", str(verifier / "test.sh")]
        assert (verifier / "test_outputs.py").is_file()
        assert "/verifier/test_outputs.py" in (verifier / "test.sh").read_text()
        assert kwargs["cwd"] == "/workspace"
        reward.write_text("0.75\n")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(scoring.subprocess, "run", run)
    scoring.main()
    result = json.loads(capsys.readouterr().out.split("COMET_DATASET_REWARD=", 1)[1])
    assert result["reward"] == 0.75


def test_dataset_terminal_probe_requires_complete_owned_native_roots(tmp_path, monkeypatch):
    from scaffold.python.validation import current_sdk as sdk

    assert not sdk.dataset_native_runs_completed(tmp_path)
    (tmp_path / ".dataset-task.json").write_text("{}")
    assert not sdk.dataset_native_runs_completed(tmp_path)
    archive = tmp_path / "docs/comet/archive/2026-11-03-example"
    archive.mkdir(parents=True)
    (archive / "comet-state.yaml").write_text("checkpoint")
    run = {
        "runId": "example",
        "workflow": {"id": "comet-native"},
        "status": "completed",
        "lineage": [],
        "state": {"phase": "archive", "status": "done", "archived": True},
        "actions": [{"stepId": "archive.finalize", "status": "succeeded"}],
    }
    calls = []

    def inspect(workspace, workflow, name, application, state_file):
        calls.append((workflow, name, application))
        return run

    monkeypatch.setattr(sdk, "inspect_run", inspect)
    assert sdk.dataset_native_runs_completed(tmp_path)
    assert calls == [("native", "example", "native")]
    run["status"] = "running"
    assert not sdk.dataset_native_runs_completed(tmp_path)
    run["status"] = "completed"
    run["lineage"] = ["parent"]
    assert not sdk.dataset_native_runs_completed(tmp_path)
    run["lineage"] = []
    active = tmp_path / "docs/comet/changes/still-active"
    active.mkdir(parents=True)
    assert not sdk.dataset_native_runs_completed(tmp_path)


def test_dataset_runtime_manifest_excludes_repository_development_graph(dataset_plan):
    import scaffold.python.builtin_datasets as subject

    package_file = Path(subject.__file__).resolve().parents[3] / "package.json"
    before = package_file.read_bytes()
    package = json.loads(before)
    assert "vitest" in package["devDependencies"]
    file, _ = dataset_plan
    task = load_dataset_tasks(str(file))[0]
    generated = json.loads((task.environment_dir / "current-comet-package.json").read_text())
    fields = (
        "name",
        "version",
        "type",
        "dependencies",
        "optionalDependencies",
        "peerDependencies",
        "peerDependenciesMeta",
        "overrides",
        "engines",
    )
    assert generated == {key: package[key] for key in fields if key in package}
    assert "devDependencies" not in generated
    assert "scripts" not in generated
    assert generated["dependencies"] == package["dependencies"]
    assert generated["overrides"] == package["overrides"]
    assert package_file.read_bytes() == before


def test_workbuddy_verifier_installs_upstream_pins_outside_task_python(dataset_plan):
    file, _ = dataset_plan
    plan = json.loads(file.read_text())
    plan["dataset"]["id"] = "workbuddy-code"
    shared = Path(plan["root"]) / "shared"
    shared.mkdir()
    plan["sharedHash"] = tree_hash(shared)
    from scaffold.python.builtin_datasets import dataset_config_hash

    (Path(plan["root"]) / "dataset.toml").write_text('[dataset]\nid="example"\n')
    plan["datasetConfigHash"] = dataset_config_hash(Path(plan["root"]))
    file.write_text(json.dumps(plan))
    task = load_dataset_tasks(str(file))[0]
    dockerfile = (task.environment_dir / "Dockerfile").read_text()
    assert "python3 -m venv /opt/comet-verifier" in dockerfile
    assert "/opt/comet-verifier/bin/python -m pip install" in dockerfile
    assert (
        "harbor @ git+https://github.com/harbor-framework/harbor.git@527d50deb63a5d279e8c20593c18a2cbc7f61f9e"
        in dockerfile
    )
    assert (
        "workbuddy-bench @ git+https://github.com/Tencent/workbuddy-bench.git@625b2233093ae4f23e76be28c1f341d41cc70373"
        in dockerfile
    )
    assert (
        'RUN pip install --break-system-packages "git+https://github.com/Tencent/workbuddy-bench'
        not in dockerfile
    )


def test_workbuddy_score_uses_private_isolated_python(tmp_path, monkeypatch):
    from scaffold.python.builtin_datasets import dataset_config_hash

    source = tmp_path / "source"
    source.mkdir()
    shared = tmp_path / "shared"
    shared.mkdir()
    (tmp_path / "dataset.toml").write_text('[dataset]\nid="example"\n')
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".dataset-task.json").write_text(json.dumps({"workdir": "/workspace"}))
    task = DatasetTask(
        path=source,
        config=TaskConfig(name="example", description=""),
        instruction_template="task",
        dataset_entry={
            "id": "example",
            "source": str(source),
            "contentHash": tree_hash(source),
            "timeout": 900,
        },
        dataset_plan={
            "dataset": {"id": "workbuddy-code"},
            "root": str(tmp_path),
            "sharedHash": tree_hash(shared),
            "datasetConfigHash": dataset_config_hash(tmp_path),
        },
    )
    calls = []

    def fake_docker(*args, **kwargs):
        calls.append(args)
        if args[0] == "start":
            return SimpleNamespace(stdout='COMET_DATASET_REWARD={"reward":1,"raw":{"reward":1}}')
        return SimpleNamespace(stdout="0" if args[0] == "inspect" else "")

    monkeypatch.setattr("scaffold.python.builtin_datasets.docker", fake_docker)
    monkeypatch.setattr(
        "scaffold.python.utils.build_docker_image", lambda *_args, **_kwargs: "image"
    )
    passed, failed = task._score_dataset(workspace, {})
    assert not failed and "dataset_completed" in passed
    assert calls[0][-5:] == (
        "/opt/comet-verifier/bin/python",
        "-I",
        "/opt/dataset_score.py",
        "workbuddy-code",
        "example",
    )
    assert calls[-1][0] == "rm"


def test_dataset_agent_install_exposes_progress_and_rejects_missing_binary(dataset_plan, tmp_path):
    import subprocess
    from scaffold.python.install_claude import install_claude

    file, _ = dataset_plan
    dockerfile = (load_dataset_tasks(str(file))[0].environment_dir / "Dockerfile").read_text()
    assert "COPY current-comet-install-claude.py /opt/comet-install-claude.py" in dockerfile
    for install_exit, binary_exit, expected, checked in [
        (0, 0, 0, True),
        (7, 0, 7, False),
        (0, 9, 9, True),
    ]:
        calls = []

        def fake_run(command, **kwargs):
            calls.append(command)
            if command[:2] == ["npm", "view"]:
                return SimpleNamespace(
                    stdout=json.dumps(
                        {
                            "version": "2.1.306",
                            "optionalDependencies": {
                                "@anthropic-ai/claude-code-linux-x64": "2.1.306"
                            },
                        }
                    )
                )
            if command[0] == "node":
                return SimpleNamespace(stdout='{"platform":"linux","arch":"x64","musl":false}')
            code = install_exit if command[:2] == ["npm", "install"] else binary_exit
            if code:
                raise subprocess.CalledProcessError(code, command)
            assert kwargs.get("stdout") is None  # 安装进度与脚本输出直接交给构建日志。
            return SimpleNamespace(stdout="")

        if expected:
            with pytest.raises(subprocess.CalledProcessError) as error:
                install_claude("latest", "/opt/comet-agent", run=fake_run)
            assert error.value.returncode == expected
        else:
            assert install_claude("latest", "/opt/comet-agent", run=fake_run) == "2.1.306"
        install = next(command for command in calls if command[:2] == ["npm", "install"])
        for flag in (
            "--foreground-scripts",
            "--loglevel=verbose",
            "--fetch-timeout=300000",
            "--fetch-retries=1",
            "--include=optional",
        ):
            assert flag in install
        assert "@anthropic-ai/claude-code-linux-x64@2.1.306" in install
        assert "@anthropic-ai/claude-code@2.1.306" in install
        assert any(command[-1] == "--version" for command in calls) == checked


def test_agent_installer_handles_legacy_packages_and_rejects_unsupported_native_platforms():
    from scaffold.python.install_claude import install_claude

    for optional in ({}, {"@anthropic-ai/claude-code-linux-arm64": "2.1.306"}):
        calls = []

        def fake_run(command, **kwargs):
            calls.append(command)
            if command[:2] == ["npm", "view"]:
                return SimpleNamespace(
                    stdout=json.dumps({"version": "2.1.306", "optionalDependencies": optional})
                )
            if command[0] == "node":
                return SimpleNamespace(stdout='{"platform":"linux","arch":"x64","musl":false}')
            return SimpleNamespace(stdout="")

        if optional:
            with pytest.raises(ValueError, match="不支持当前平台"):
                install_claude("2.1.306", "/opt/comet-agent", run=fake_run)
            assert not any(command[:2] == ["npm", "install"] for command in calls)
        else:
            install_claude("2.1.306", "/opt/comet-agent", run=fake_run)
            install = next(command for command in calls if command[:2] == ["npm", "install"])
            assert install[-1] == "@anthropic-ai/claude-code@2.1.306"


def test_dataset_rejects_modified_agent_installer_before_building_image(
    dataset_plan, tmp_path, monkeypatch
):
    import shutil

    file, _ = dataset_plan
    task = load_dataset_tasks(str(file))[0]
    workspace = tmp_path / "candidate"
    build = workspace / ".dataset-build"
    build.mkdir(parents=True)
    for name in ("Dockerfile", "current-comet-package.json", "current-comet-install-claude.py"):
        shutil.copy2(task.environment_dir / name, build / name)
    (build / "current-comet-install-claude.py").write_text("untrusted replacement")

    def forbidden(*_args, **_kwargs):
        raise AssertionError("不能执行被修改的构建脚本")

    monkeypatch.setattr("scaffold.python.utils.build_docker_image", forbidden)
    passed, failed = task._score_dataset(workspace, {})
    assert not passed and failed == ["dataset_environment_changed: 评分环境装配输入被修改"]


def test_dataset_plan_does_not_override_unrelated_manifest_contracts(tmp_path, monkeypatch):
    from local.tests.tasks import test_tasks

    monkeypatch.setenv("COMET_EVAL_DATASET_PLAN", str(tmp_path / "unrelated.json"))
    test_tasks.test_eval_manifest_baselines_extend_dynamic_treatment_list(tmp_path, monkeypatch)
    other = tmp_path / "other"
    other.mkdir()
    test_tasks.test_eval_manifest_prefers_authored_tasks_over_recommended_tasks(other)


def test_dataset_selection_uses_bound_plan_without_ambient_environment(dataset_plan, monkeypatch):
    from local.tests.tasks import test_tasks
    import conftest

    file, _ = dataset_plan
    monkeypatch.setenv("COMET_EVAL_DATASET_PLAN", str(file))
    for name in (
        "context_from_environment",
        "_resolve_eval_execution",
        "_resolve_eval_judge",
        "_normal_run_preflight",
        "_resolve_eval_agent",
    ):
        monkeypatch.setattr(conftest, name, lambda *_: None)
    monkeypatch.setattr(conftest, "ExperimentPlugin", lambda *_: object())
    monkeypatch.setattr(conftest, "_plugin", None)
    config = SimpleNamespace(
        getoption=lambda *_: None,
        addinivalue_line=lambda *_: None,
        pluginmanager=SimpleNamespace(register=lambda *_: None),
    )
    conftest.pytest_configure(config)
    monkeypatch.delenv("COMET_EVAL_DATASET_PLAN", raising=False)
    assert test_tasks.generate_test_params(None, None, config) == [
        ("example", "COMET_NATIVE_SDK_CURRENT")
    ]
    with pytest.raises(ValueError, match="选中数据集任务为空"):
        test_tasks.generate_test_params("not-selected", None, config)


def test_dataset_prebuild_failure_preserves_diagnostics_and_stops_before_sample_setup(
    tmp_path, monkeypatch
):
    import conftest
    from scaffold.python.execution import redact_sensitive

    environment = tmp_path / "environment"
    environment.mkdir()
    (environment / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    monkeypatch.setattr(conftest, "context_from_environment", lambda: None)
    monkeypatch.setattr(conftest, "DOCKER_BUILD_LOCK", tmp_path / "build.lock")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "test-build-private-credential")
    calls = []

    def failed_build(*args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(
            returncode=1,
            stdout="",
            stderr="EEXIST /usr/local/bin/node test-build-private-credential",
        )

    monkeypatch.setattr(conftest, "run_shell", failed_build)
    with pytest.raises(RuntimeError) as error:
        conftest._build_docker_image_with_lock(environment)
    assert "EEXIST /usr/local/bin/node" in str(error.value)
    assert "test-build-private-credential" not in str(error.value)
    assert redact_sensitive("test-build-private-credential") in str(error.value)
    assert len(calls) == 1

    monkeypatch.setattr(conftest, "_is_unit_tests_only", lambda *_: False)
    monkeypatch.setattr(conftest, "_docker_environment_dirs_for_request", lambda *_: [environment])
    monkeypatch.setattr(
        conftest, "_resolve_eval_agent", lambda *_: SimpleNamespace(agent="claude-code")
    )
    request = SimpleNamespace(config=SimpleNamespace(option=SimpleNamespace(collectonly=False)))
    fixture = conftest.prebuild_docker_image.__wrapped__(request)
    with pytest.raises(RuntimeError, match="EEXIST"):
        next(fixture)
    assert len(calls) == 2

    import subprocess

    def timed_out(*args, **kwargs):
        raise subprocess.TimeoutExpired(
            "build", 900, stderr="npm http fetch test-explicit-credential"
        )

    monkeypatch.setattr(conftest, "run_shell", timed_out)
    with pytest.raises(RuntimeError, match="超过 900 秒") as error:
        conftest._build_docker_image_with_lock(
            environment, environment={"ANTHROPIC_AUTH_TOKEN": "test-explicit-credential"}
        )
    assert "npm http fetch" in str(error.value)
    assert "test-explicit-credential" not in str(error.value)


def test_dataset_cold_build_has_bounded_extra_time_without_changing_regular_builds(
    tmp_path, monkeypatch
):
    import conftest
    import subprocess

    environment = tmp_path / "environment"
    environment.mkdir()
    (environment / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    marker = environment / ".dataset-task.json"
    marker.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(conftest, "context_from_environment", lambda: None)
    monkeypatch.setattr(conftest, "DOCKER_BUILD_LOCK", tmp_path / "build.lock")
    calls = []

    def build(*args, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(returncode=0, stdout="dataset-image\n", stderr="")

    monkeypatch.setattr(conftest, "run_shell", build)
    assert conftest._build_docker_image_with_lock(environment) == "dataset-image"
    assert calls[-1] == {"timeout": 1800, "check": False, "terminate_process_tree": True}
    marker.unlink()
    conftest._build_docker_image_with_lock(environment)
    assert calls[-1]["timeout"] == 900
    marker.write_text("{}", encoding="utf-8")

    def timed_out(*args, **kwargs):
        raise subprocess.TimeoutExpired("build", kwargs["timeout"], stderr="pip download")

    monkeypatch.setattr(conftest, "run_shell", timed_out)
    with pytest.raises(RuntimeError, match="超过 1800 秒.*pip download"):
        conftest._build_docker_image_with_lock(environment)


def test_reward_requires_finite_numeric_score_and_preserves_fraction():
    assert reward_result("0.75") == (0.75, False)
    assert reward_result("1") == (1.0, True)
    for value in ("", "NaN", "Infinity", "true", "-1", "1.1"):
        with pytest.raises(ValueError):
            reward_result(value)


def test_reward_exit_code_is_not_a_score():
    with pytest.raises(ValueError):
        reward_result("{}")


def test_download_progress_is_explicit_and_does_not_start_workloads(tmp_path, monkeypatch):
    progress = tmp_path / "progress.json"
    report_progress("downloading", 10, 100)
    assert not progress.exists()
    monkeypatch.setenv("COMET_DATASET_PROGRESS", str(progress))
    report_progress("downloading", 10, 100)
    assert json.loads(progress.read_text())["bytes"] == 10
    report_progress("failed", error="network error")
    assert json.loads(progress.read_text())["error"] == "network error"


def test_archive_rejects_path_escape_without_writing(tmp_path):
    archive = tmp_path / "bad.tar"
    with tarfile.open(archive, "w") as stream:
        entry = tarfile.TarInfo("../escaped")
        entry.size = 1
        stream.addfile(entry, io.BytesIO(b"x"))
    with pytest.raises(ValueError):
        extract(archive, tmp_path / "out")
    assert not (tmp_path / "escaped").exists()


def test_dataset_task_preserves_prompt_and_uses_native_without_answer_files(tmp_path):
    task = tmp_path / "source/tasks/example"
    (task / "environment").mkdir(parents=True)
    (task / "environment/Dockerfile").write_text("FROM python:3.12-slim\nWORKDIR /app\n")
    (task / "verifier").mkdir()
    (task / "verifier/test.sh").write_text("echo 0.75")
    entry = {
        "id": "example",
        "source": str(task),
        "supported": True,
        "contentHash": tree_hash(task),
        "instruction": "Write {literal}.",
        "timeout": 900,
    }
    plan = {
        "root": str(task.parent.parent),
        "dataset": {"id": "skillsbench"},
        "tasks": [entry],
        "contentHash": "sha256:plan",
    }
    file = tmp_path / "plan.json"
    file.write_text(json.dumps(plan))
    loaded = load_dataset_tasks(str(file))[0]
    assert loaded.render_prompt() == "Write {literal}."
    assert loaded.config.default_treatments == ["COMET_NATIVE_SDK_CURRENT"]
    assert loaded.config.interaction.mode == "auto_user"
    assert loaded.config.interaction.max_turns == 40
    assert not (loaded.environment_dir / "verifier").exists()
    assert loaded.manifest_path == file
    (task / "verifier/test.sh").write_text("changed")
    with pytest.raises(ValueError):
        load_dataset_tasks(str(file))


def test_tree_hash_matches_depth_first_typescript_order(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "a/x").write_bytes(b"x")
    (tmp_path / "a.txt").write_bytes(b"y")
    expected = hashlib.sha256(b"a/x\0x\0a.txt\0y\0").hexdigest()
    assert tree_hash(tmp_path) == "sha256:" + expected


def test_scoring_uses_candidate_copy_and_keeps_fractional_reward(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "answer.txt").write_text("candidate")
    (workspace / ".dataset-task.json").write_text(json.dumps({"workdir": "/app"}))
    subject = DatasetTask(
        path=source,
        config=TaskConfig(name="example", description=""),
        instruction_template="task",
        dataset_entry={
            "id": "example",
            "source": str(source),
            "contentHash": tree_hash(source),
            "timeout": 900,
        },
        dataset_plan={"dataset": {"id": "skillsbench"}, "root": str(tmp_path)},
    )
    calls = []

    def fake_docker(*args, **kwargs):
        calls.append(args)
        if args[0] == "start":
            return SimpleNamespace(stdout='COMET_DATASET_REWARD={"reward":0.75,"raw":"0.75"}')
        if args[0] == "inspect":
            return SimpleNamespace(stdout="0")
        return SimpleNamespace(stdout="")

    monkeypatch.setattr("scaffold.python.builtin_datasets.docker", fake_docker)
    monkeypatch.setattr("scaffold.python.utils.build_docker_image", lambda *args, **kwargs: "image")
    outputs = {}
    passed, failed = subject.validate_dataset(workspace, outputs)
    assert "[RUBRIC] dataset-score: 0.75" in passed
    assert failed and outputs["dataset_result"]["reward"] == 0.75
    assert (workspace / "answer.txt").read_text() == "candidate"
    assert calls[-1][0] == "rm"
    assert str(workspace.resolve()) + ":/workspace" not in calls[0]


def test_verifier_cannot_mutate_native_candidate(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "answer").write_text("original")
    task = DatasetTask(
        path=tmp_path,
        config=TaskConfig(name="example", description=""),
        instruction_template="task",
    )

    def score(candidate, outputs):
        (candidate / "answer").write_text("injected tests")
        return [], ["failed"]

    monkeypatch.setattr(task, "_score_dataset", score)
    assert task.validate_dataset(workspace, {}) == ([], ["failed"])
    assert (workspace / "answer").read_text() == "original"


def test_original_project_dockerfile_and_inputs_do_not_collide_with_build_context(
    tmp_path, monkeypatch
):
    from scaffold.python.builtin_datasets import prepare_dataset_workspace, dataset_mounts

    (tmp_path / "Dockerfile").write_text("harness Dockerfile")
    (tmp_path / "script.txt").write_text("environment input")
    (tmp_path / "current-comet-package.json").write_text("{}")
    (tmp_path / ".dataset-task.json").write_text(
        json.dumps(
            {
                "workdir": "/app",
                "environmentFiles": ["Dockerfile", "script.txt", "current-comet-package.json"],
            }
        )
    )
    monkeypatch.setattr("scaffold.python.utils.build_docker_image", lambda *args, **kwargs: "image")

    def fake_docker(*args, **kwargs):
        if args[0] == "cp" and ":/app/." in args[1]:
            target = Path(args[2])
            (target / "script.txt").write_text("baked input")
            (target / "Dockerfile").write_text("project Dockerfile")
        return SimpleNamespace(stdout="")

    monkeypatch.setattr("scaffold.python.builtin_datasets.docker", fake_docker)
    prepare_dataset_workspace(tmp_path, "claude-code")
    assert (tmp_path / "Dockerfile").read_text() == "project Dockerfile"
    assert (tmp_path / ".dataset-build/Dockerfile").read_text() == "harness Dockerfile"
    assert (tmp_path / "script.txt").read_text() == "baked input"
    assert f"{tmp_path.resolve()}:/app" in dataset_mounts(tmp_path)


def test_dataset_candidate_mapping_preserves_declared_outputs_for_both_treatments(tmp_path):
    from scaffold.python.builtin_datasets import dataset_mounts

    for directory in ("root", "app", "data", "outputs", "opt/syzkaller"):
        (tmp_path / ".dataset-state" / directory).mkdir(parents=True)
    (tmp_path / ".dataset-task.json").write_text(
        json.dumps(
            {
                "workdir": "/root",
                "execution": {
                    "candidateDirectories": ["/root", "/app", "/data", "/outputs", "/opt/syzkaller"]
                },
            }
        )
    )
    mounts = dataset_mounts(tmp_path)
    assert f"{tmp_path.resolve()}:/root" in mounts
    assert any(value.endswith(":/outputs") for value in mounts)
    assert any(value.endswith(":/opt/syzkaller") for value in mounts)


def test_dataset_new_plan_has_bound_budget_and_original_task_simulator(dataset_plan):
    import conftest

    file, _ = dataset_plan
    plan = json.loads(file.read_text())
    plan["tasks"][0]["execution"] = {"timeoutSeconds": 3600, "buildTimeoutSeconds": 1800}
    file.write_text(json.dumps(plan))
    task = load_dataset_tasks(str(file))[0]
    config = SimpleNamespace(_comet_dataset_plan_file=str(file), getoption=lambda *_: None)
    assert (
        conftest._resolve_agent_timeout(config, task_timeout=task.config.timeout_sec, floor=1500)
        == 3600
    )
    assert "cannot change" in task.config.interaction.simulator_prompt
    assert "public" in task.config.interaction.simulator_prompt
    metadata = json.loads((task.environment_dir / ".dataset-task.json").read_text())
    assert metadata["execution"]["timeoutSeconds"] == 3600


def test_dataset_new_budget_does_not_add_an_implicit_agent_grace(tmp_path, monkeypatch):
    import conftest
    from scaffold.python.tasks import InteractionConfig

    calls = []
    monkeypatch.setattr(
        conftest,
        "run_claude_loop_in_docker",
        lambda *args, **kwargs: (
            calls.append(kwargs) or SimpleNamespace(returncode=0, stdout="", stderr="")
        ),
    )
    monkeypatch.setattr(conftest, "build_agent_environment", lambda *_: {})
    monkeypatch.setattr(
        conftest,
        "_resolve_eval_execution",
        lambda *_: conftest.ResolvedExecution("claude-code", None, None, {}),
    )
    run = conftest.run_claude.__wrapped__(tmp_path, None, SimpleNamespace(config=None))
    run(
        "original",
        timeout=3600,
        interaction=InteractionConfig(mode="auto_user"),
        task_contract_file=str(tmp_path / "original.md"),
    )
    assert calls[0]["timeout"] == 3600
    assert calls[0]["environment"]["COMET_EVAL_TASK_CONTRACT_FILE"]


def test_dataset_missing_efficiency_telemetry_is_unknown():
    from scaffold.python.validation.generic_rubric import _score_efficiency

    assert _score_efficiency({"events": {}})[0] is None


def test_dataset_runtime_mapping_is_independent_of_comet_installation(tmp_path, monkeypatch):
    import shlex
    from scaffold.python.utils import run_shell, SHELL_DIR, _to_bash_path

    contract = tmp_path / "original-public-task.md"
    contract.write_text("Keep the original public interface.")
    monkeypatch.setenv("COMET_EVAL_TASK_CONTRACT_FILE", _to_bash_path(contract))

    (tmp_path / ".dataset-state/outputs").mkdir(parents=True)
    (tmp_path / ".dataset-task.json").write_text(
        json.dumps(
            {
                "workdir": "/workspace",
                "execution": {
                    "candidateDirectories": ["/outputs"],
                    "cpus": 2,
                    "memoryMb": 4096,
                    "networkMode": "public",
                },
            }
        )
    )
    probe = tmp_path / "probe.sh"
    probe.write_text(
        "#!/usr/bin/env bash\nsource " + shlex.quote(_to_bash_path(SHELL_DIR / "docker.sh")) + "\n"
        'docker() { if [[ "$1" == image ]]; then printf agent; fi; }\n'
        'prepare_eval_runtime_data "$1" fake-image\nprintf \'%s\\n\' "${COMET_RUNTIME_MOUNT_ARGS[@]}"\n',
        encoding="utf-8",
        newline="\n",
    )
    goal = run_shell(str(probe), str(tmp_path), check=False)
    assert goal.returncode == 0, goal.stderr
    assert "://outputs" in goal.stdout
    assert "://opt/comet-task-contract/task.md:ro" in goal.stdout
    assert "--cpus\n2\n--memory\n4096m\n" in goal.stdout
    (tmp_path / ".include-current-comet-cli").touch()
    native = run_shell(str(probe), str(tmp_path), check=False)
    assert native.returncode == 0, native.stderr
    assert native.stdout.startswith(goal.stdout)


def test_dataset_candidate_mapping_rejects_protected_and_escaping_paths(tmp_path):
    from scaffold.python.builtin_datasets import dataset_mounts

    for directory in ["/opt/dataset-original", "/root/../verifier", "/", "../outside"]:
        (tmp_path / ".dataset-task.json").write_text(
            json.dumps(
                {"workdir": "/workspace", "execution": {"candidateDirectories": [directory]}}
            )
        )
        with pytest.raises(ValueError, match="候选目录"):
            dataset_mounts(tmp_path)


def test_dataset_trusted_sources_are_readonly_through_workdir_aliases(tmp_path):
    import shlex
    from scaffold.python.utils import run_shell, SHELL_DIR, _to_bash_path

    (tmp_path / "_eval_current_comet").mkdir()
    (tmp_path / "_eval_trusted_oracles").mkdir()
    (tmp_path / ".dataset-task.json").write_text(json.dumps({"workdir": "/root"}))
    probe = tmp_path / "probe.sh"
    probe.write_text(
        "source "
        + shlex.quote(_to_bash_path(SHELL_DIR / "docker.sh"))
        + '\nbuild_trusted_oracle_mount_args "$1"\nprintf "%s\\n" "${TRUSTED_ORACLE_MOUNT_ARGS[@]}"\n',
        encoding="utf-8",
        newline="\n",
    )
    result = run_shell(str(probe), str(tmp_path))
    assert "://workspace/_eval_current_comet:ro" in result.stdout
    assert "://root/_eval_current_comet:ro" in result.stdout
    assert "://root/_eval_trusted_oracles:ro" in result.stdout


def test_dataset_verifier_resources_and_status_preserve_original_reward(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    execution = {"cpus": 2, "memoryMb": 4096, "networkMode": "public"}
    (workspace / ".dataset-task.json").write_text(
        json.dumps({"workdir": "/workspace", "execution": execution})
    )
    subject = DatasetTask(
        path=source,
        config=TaskConfig(name="example", description=""),
        instruction_template="task",
        dataset_entry={
            "id": "example",
            "source": str(source),
            "contentHash": tree_hash(source),
            "timeout": 900,
            "execution": execution,
        },
        dataset_plan={"dataset": {"id": "skillsbench"}, "root": str(tmp_path)},
    )
    calls = []

    def docker(*args, **kwargs):
        calls.append(args)
        if args[0] == "start":
            return SimpleNamespace(
                stdout='COMET_DATASET_REWARD={"reward":0,"verifier_status":"collection_error"}'
            )
        return SimpleNamespace(stdout="0")

    monkeypatch.setattr("scaffold.python.builtin_datasets.docker", docker)
    monkeypatch.setattr("scaffold.python.utils.build_docker_image", lambda *args, **kwargs: "image")
    outputs = {}
    passed, failed = subject.validate_dataset(workspace, outputs)
    assert "[RUBRIC] dataset-score: 0.0" in passed
    assert outputs["dataset_result"]["reward"] == 0
    assert outputs["dataset_result"]["verifier_status"] == "collection_error"
    assert failed[0].startswith("dataset_verifier_error:")
    assert "--cpus" in calls[0] and "4096m" in calls[0]
    assert any(str(value).endswith("/opt/comet-dataset-execution.json:ro") for value in calls[0])
    execution["cpus"] = 4
    assert subject.validate_dataset(workspace, {})[1][0].startswith("dataset_input_changed:")


@pytest.mark.parametrize(
    "body,status",
    [
        ("def test_value(): assert False\n", "assertion_failed"),
        ("raise ImportError('missing deterministic fixture dependency')\n", "collection_error"),
        ("def test_value(): assert True\n", "completed"),
    ],
)
def test_dataset_observer_distinguishes_pytest_execution_without_changing_exit(
    tmp_path, body, status
):
    import os
    import subprocess
    import sys

    file = tmp_path / "test_probe.py"
    file.write_text(body)
    log = tmp_path / "observer.jsonl"
    environment = {
        **os.environ,
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
        "PYTEST_PLUGINS": "scaffold.python.dataset_pytest_observer",
        "COMET_DATASET_OBSERVER": str(log),
    }
    environment.pop("PYTEST_ADDOPTS", None)
    result = subprocess.run(
        [sys.executable, "-m", "pytest", str(file), "-q", "--confcutdir", str(tmp_path)],
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=20,
    )
    observed = json.loads(log.read_text().strip())
    assert observed["status"] == status, result.stdout + result.stderr
    assert observed["exitCode"] == result.returncode
    assert (
        result.returncode == {"assertion_failed": 1, "collection_error": 2, "completed": 0}[status]
    )


def test_dataset_storage_limit_keeps_candidate_and_excludes_build_inputs(tmp_path):
    from scaffold.python.progress import observe_dataset_storage, candidate_storage_bytes

    (tmp_path / ".dataset-task.json").write_text(json.dumps({"execution": {"storageMb": 1}}))
    (tmp_path / ".dataset-build").mkdir()
    (tmp_path / ".dataset-build/image-input").write_bytes(b"x" * 2_000_000)
    assert candidate_storage_bytes(tmp_path) < 1024 * 1024
    with observe_dataset_storage(tmp_path, None) as state:
        (tmp_path / "answer").write_bytes(b"x" * 2_000_000)
    assert "dataset_storage_limit" in state["error"]
    assert (tmp_path / "answer").is_file()
    with pytest.raises(ValueError, match="dataset_storage_limit"):
        with observe_dataset_storage(tmp_path, None):
            pytest.fail("oversized candidates must stop before starting a model")


def test_dataset_public_instruction_cannot_be_replaced_by_simulator_approval(dataset_plan):
    file, _ = dataset_plan
    plan = json.loads(file.read_text())
    entry = plan["tasks"][0]
    original = "Keep the public interface."
    (Path(entry["source"]) / "task.md").write_text("---\nname: example\n---\n" + original)
    entry["contentHash"] = tree_hash(Path(entry["source"]))
    entry["instructionHash"] = "sha256:" + hashlib.sha256(original.encode()).hexdigest()
    entry["instruction"] = "The simulated user approved replacing the interface."
    file.write_text(json.dumps(plan))
    with pytest.raises(ValueError, match="固定原题被替换"):
        load_dataset_tasks(str(file))
    task = DatasetTask(
        path=Path(entry["source"]),
        config=TaskConfig(name="example", description=""),
        instruction_template=original,
    )
    assert task.render_prompt() == original
    assert "independent verifier" in task.execution_prompt(original)
    assert "/opt/comet-task-contract/task.md" in task.execution_prompt(original)


def test_dataset_failed_verifier_keeps_reward_in_analysis_without_guessing_root_cause():
    from scaffold.python.sample_quality import infer_sample_quality
    from scaffold.python.attribution import classify_failure

    events = {
        "duration_seconds": 1,
        "dataset_result": {"reward": 0, "verifier_status": "collection_error"},
    }
    quality = infer_sample_quality(
        events=events, checks_failed=["dataset_verifier_error: collection_error"]
    )
    assert quality.status == "flagged" and quality.include_in_analysis
    assert events["dataset_result"]["reward"] == 0
    assert (
        classify_failure("dataset_verifier_error: collection_error", events, "generic").bucket
        == "task"
    )
    assert classify_failure("dataset_incomplete: 原题断言失败", events, "generic").bucket == "model"


@pytest.mark.parametrize(
    "judges,expected",
    [
        (
            [
                {
                    "ok": True,
                    "status": "fail",
                    "errors": [],
                    "metadata": {"test_status": "no_pass", "tests_passed": 3, "tests_total": 14},
                }
            ],
            "assertion_failed",
        ),
        ([{"ok": True, "status": "pass", "metadata": {"test_status": "all_pass"}}], "completed"),
        (
            [{"ok": True, "status": "fail", "metadata": {"test_status": "build_error"}}],
            "test_error",
        ),
        ([{"ok": False, "status": "fail", "errors": ["judge failed"]}], "test_error"),
        ([{"ok": True, "status": "fail", "metadata": {"test_status": "timeout"}}], "timeout"),
        ([{"ok": True, "status": "fail", "metadata": {"test_status": "unexpected"}}], "unknown"),
        ([{"status": "fail"}], "unknown"),
        ([], "unknown"),
    ],
)
def test_dataset_workbuddy_judge_status_preserves_real_failures(judges, expected):
    from scaffold.python.dataset_score import workbuddy_verifier_status

    assert workbuddy_verifier_status({"judges": judges}) == expected


def test_dataset_workbuddy_partial_score_remains_a_valid_business_failure(tmp_path, monkeypatch):
    from scaffold.python.sample_quality import infer_sample_quality
    from scaffold.python.dataset_score import workbuddy_verifier_status
    from scaffold.python.builtin_datasets import dataset_config_hash

    source = tmp_path / "source"
    source.mkdir()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".dataset-task.json").write_text(json.dumps({"workdir": "/workspace"}))
    shared = tmp_path / "shared"
    shared.mkdir()
    (tmp_path / "dataset.toml").write_text('[dataset]\nid="example"\n')
    raw = {
        "reward": 0.2143,
        "details": {
            "judges": [
                {
                    "ok": True,
                    "status": "fail",
                    "metadata": {"test_status": "no_pass", "tests_passed": 3, "tests_total": 14},
                }
            ]
        },
    }
    raw["verifier_status"] = workbuddy_verifier_status(raw["details"])
    task = DatasetTask(
        path=source,
        config=TaskConfig(name="example", description=""),
        instruction_template="original",
        dataset_entry={
            "id": "example",
            "source": str(source),
            "contentHash": tree_hash(source),
            "timeout": 900,
        },
        dataset_plan={
            "dataset": {"id": "workbuddy-code"},
            "root": str(tmp_path),
            "sharedHash": tree_hash(shared),
            "datasetConfigHash": dataset_config_hash(tmp_path),
        },
    )
    monkeypatch.setattr("scaffold.python.utils.build_docker_image", lambda *args, **kwargs: "image")
    monkeypatch.setattr(
        "scaffold.python.builtin_datasets.docker",
        lambda *args, **kwargs: SimpleNamespace(
            stdout="COMET_DATASET_REWARD=" + json.dumps(raw) if args[0] == "start" else "0"
        ),
    )
    outputs = {}
    passed, failed = task.validate_dataset(workspace, outputs)
    assert "[RUBRIC] dataset-score: 0.2143" in passed, failed
    assert failed == ["dataset_incomplete: 原始评分未达到完整成功"]
    quality = infer_sample_quality(
        events={**outputs, "duration_seconds": 1, "total_tokens": 10, "total_cost_usd": 0.01},
        checks_failed=failed,
    )
    assert quality.status == "included" and quality.include_in_analysis, quality


def test_dataset_simulator_usage_is_recorded_separately_from_subject():
    import conftest

    raw = {
        "type": "result",
        "session_id": "sim",
        "usage": {"input_tokens": 5, "output_tokens": 3},
        "total_cost_usd": 0.01,
    }
    interaction = conftest._extract_loop_interaction(
        "[loop] role-usage simulator " + json.dumps(raw), agent="claude-code"
    )
    assert interaction["simulator_usage"]["total_tokens"] == 8
    assert interaction["simulator_usage"]["total_cost_usd"] == 0.01


def test_dataset_measurements_survive_report_normalization():
    import conftest

    measurements = {
        "token_scope": "subject-invocations",
        "workflow_total_tokens": None,
        "total_cost_usd_lower_bound": 0.2,
        "agent_wall_duration_seconds": 2,
        "case_wall_duration_seconds": 3,
        "dataset_result": {"reward": 0.25, "verifier_status": "assertion_failed"},
        "dataset_comparison_identity": "sha256:" + "a" * 64,
        "simulator_usage": {"total_tokens": 7},
    }
    report = conftest._build_report_payload(
        treatment_name="COMET_NATIVE_SDK_CURRENT",
        rep=1,
        run_id="fixture",
        events={**measurements, "duration_seconds": 1, "total_tokens": 10, "total_cost_usd": 0.01},
        passed=[],
        failed=["dataset_incomplete: original assertion failed"],
        scripts_used=[],
        artifact_references={},
        failure_attribution=[],
    )
    for key, value in measurements.items():
        assert report["events_summary"][key] == value


def test_dataset_pytest_only_loads_root_owned_plugins_outside_candidate(tmp_path, monkeypatch):
    import os
    from scaffold.python import dataset_pytest_observer as observer

    real_path, real_stat = Path, Path.stat
    candidate = tmp_path / "workspace"
    candidate.mkdir()
    files = {
        name: (candidate if name == "candidate" else tmp_path) / (name + ".py")
        for name in ["safe", "candidate", "agent"]
    }
    for file in files.values():
        file.write_text("# fixture")

    def stat(file, *args, **kwargs):
        value = real_stat(file, *args, **kwargs)
        if file in files.values():
            parts = list(value)
            parts[0] = 0o100644
            parts[4] = 1000 if file == files["agent"] else 0
            return os.stat_result(parts)
        return value

    monkeypatch.setattr(Path, "stat", stat)
    monkeypatch.setattr(
        observer, "Path", lambda value: candidate if value == "/workspace" else real_path(value)
    )
    entries = [SimpleNamespace(module=name, name=name) for name in files]
    monkeypatch.setattr(observer.metadata, "entry_points", lambda **kwargs: entries)
    monkeypatch.setattr(
        observer.machinery.PathFinder,
        "find_spec",
        lambda name: SimpleNamespace(origin=str(files[name]), submodule_search_locations=[]),
    )
    monkeypatch.setenv("COMET_DATASET_PLUGIN_POLICY", "root-owned")
    loaded = []
    manager = SimpleNamespace(load_setuptools_entrypoints=lambda group, name: loaded.append(name))
    observer.pytest_load_initial_conftests(SimpleNamespace(pluginmanager=manager), None, [])
    assert loaded == ["safe"]


def test_dataset_native_mode_seed_survives_execution_workspace_relocation(tmp_path, monkeypatch):
    import os
    import shutil
    import subprocess
    from scaffold.python.builtin_datasets import seed_dataset_native_mode

    package = Path(__file__).resolve().parents[4]
    monkeypatch.setenv("BENCH_COMET_SOURCE_ROOT", str(package))
    prepared = tmp_path / "prepared"
    prepared.mkdir()
    seed_dataset_native_mode(prepared, "bugfree")
    assert sorted(
        file.relative_to(prepared).as_posix() for file in prepared.rglob("*") if file.is_file()
    ) == [".comet/config.yaml"]
    execution = tmp_path / "execution"
    shutil.copytree(prepared, execution)
    inspected = subprocess.run(
        [
            "node",
            str(package / "bin/comet.js"),
            "native",
            "status",
            "--project-root",
            str(execution),
            "--json",
        ],
        env={**os.environ, "COMET_DATA_DIR": str(tmp_path / "execution-data")},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    assert inspected.returncode == 0, inspected.stdout + inspected.stderr
    assert json.loads(inspected.stdout)["exitCode"] == 0


def test_dataset_late_controller_skill_snapshot_keeps_business_files_visible(tmp_path):
    import conftest
    import subprocess

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    subprocess.run(["git", "init", str(workspace)], check=True, capture_output=True)
    (workspace / ".dataset-task.json").write_text(
        json.dumps(
            {
                "execution": {"controllerFilePolicy": "exclude-harness-created-paths"},
                "controllerPaths": [".dataset-task.json"],
            }
        )
    )
    (workspace / "source.txt").write_text("business")
    (workspace / "_eval_target_skills_business.txt").write_text("business")
    (workspace / "docs/comet/changes/example").mkdir(parents=True)
    (workspace / "docs/comet/changes/example/brief.md").write_text("approved requirements")
    package = tmp_path / "skill"
    package.mkdir()
    (package / "SKILL.md").write_text("fixture controller package")
    conftest._snapshot_dynamic_skill_package(workspace, {"path": str(package)})
    visible = subprocess.check_output(
        ["git", "-C", str(workspace), "ls-files", "--others", "--exclude-standard"], text=True
    ).splitlines()
    assert not any(path.startswith("_eval_target_skills/") for path in visible)
    assert "source.txt" in visible
    assert "_eval_target_skills_business.txt" in visible
    assert "docs/comet/changes/example/brief.md" in visible


def test_dataset_controller_snapshot_rejects_an_original_business_path_collision(tmp_path):
    import conftest

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".dataset-task.json").write_text(
        json.dumps(
            {
                "execution": {"controllerFilePolicy": "exclude-harness-created-paths"},
                "controllerPaths": [],
            }
        )
    )
    original = workspace / "_eval_target_skills/answer.txt"
    original.parent.mkdir()
    original.write_text("original business data")
    package = tmp_path / "skill"
    package.mkdir()
    (package / "SKILL.md").write_text("fixture controller package")
    with pytest.raises(ValueError, match="冲突"):
        conftest._snapshot_dynamic_skill_package(workspace, {"path": str(package)})
    assert original.read_text() == "original business data"


def test_dataset_seeds_verification_mode_before_any_run_through_public_cli(tmp_path, monkeypatch):
    import yaml
    from scaffold.python.builtin_datasets import seed_dataset_native_mode

    monkeypatch.setenv("BENCH_COMET_SOURCE_ROOT", str(Path(__file__).resolve().parents[4]))
    seed_dataset_native_mode(tmp_path, "bugfree")
    config = yaml.safe_load((tmp_path / ".comet/config.yaml").read_text(encoding="utf-8"))
    assert config["native"]["verify_mode"] == "bugfree"
    assert not list((tmp_path / "docs/comet/changes").glob("*/comet-state.yaml"))


def test_dataset_rejects_actual_run_mode_mismatch_and_preserves_business_score(
    tmp_path, monkeypatch
):
    archive = tmp_path / "docs/comet/archive/2026-11-04-example"
    archive.mkdir(parents=True)
    (archive / "comet-state.yaml").write_text("name: example\n")
    task = DatasetTask(
        path=tmp_path,
        config=TaskConfig(name="example", description=""),
        instruction_template="original",
        dataset_plan={"verifyMode": "bugfree"},
    )
    monkeypatch.setattr(
        task,
        "_score_dataset",
        lambda candidate, outputs: (["[RUBRIC] dataset-score: 0.25"], ["dataset_incomplete"]),
    )
    monkeypatch.setattr(
        "scaffold.python.validation.current_sdk.inspect_run",
        lambda *args: {"input": {"verifyMode": "standard"}},
    )
    passed, failed = task.validate_dataset(tmp_path, {})
    assert passed == ["[RUBRIC] dataset-score: 0.25"]
    assert failed[0] == "dataset_incomplete"
    assert any(item.startswith("dataset_verify_mode:") for item in failed)


def test_dataset_scoring_applies_fixed_verifier_environment_and_hardening(
    tmp_path, monkeypatch, capsys
):
    import sys
    from scaffold.python import dataset_score as scoring

    source = tmp_path / "original/tasks/example/verifier"
    source.mkdir(parents=True)
    (source / "test.sh").write_text("exit 0\n")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "conftest.py").write_text("raise RuntimeError('candidate injection')")
    execution = tmp_path / "execution.json"
    execution.write_text(
        json.dumps(
            {
                "verifierTimeoutSeconds": 75,
                "verifier": {"env": {"REPO_ID": "original/repo"}, "cleanupConftests": True},
            }
        )
    )
    reward = tmp_path / "logs/verifier/reward.txt"
    paths = {
        "/opt/dataset-original/tasks": tmp_path / "original/tasks",
        "/verifier": tmp_path / "verifier",
        "/workspace": workspace,
        "/root": tmp_path / "root",
        "/app": tmp_path / "app",
        "/data": tmp_path / "data",
        "/outputs": tmp_path / "outputs",
        "/opt/syzkaller": tmp_path / "syzkaller",
        "/home/agent": tmp_path / "home-agent",
        "/logs/verifier/reward.txt": reward,
        "/opt/comet-dataset-execution.json": execution,
    }
    original_path = Path
    monkeypatch.setattr(scoring, "Path", lambda value: paths.get(str(value), original_path(value)))
    monkeypatch.setattr(sys, "argv", ["score", "skillsbench", "example"])

    def run(command, **kwargs):
        assert not (workspace / "conftest.py").exists()
        assert kwargs["env"]["REPO_ID"] == "original/repo"
        assert kwargs["timeout"] == 75
        reward.write_text("0")
        Path(kwargs["env"]["COMET_DATASET_OBSERVER"]).write_text(
            json.dumps({"status": "collection_error", "ran": 0}) + "\n"
        )
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(scoring.subprocess, "run", run)
    scoring.main()
    result = json.loads(capsys.readouterr().out.split("COMET_DATASET_REWARD=", 1)[1])
    assert result["reward"] == 0
    assert result["verifier_status"] == "collection_error"
