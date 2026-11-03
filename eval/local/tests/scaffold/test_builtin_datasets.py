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
