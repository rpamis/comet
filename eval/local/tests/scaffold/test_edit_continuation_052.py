"""固定编辑续行场景的装配与执行边界；这些检查不调用模型或 Docker。"""

import ast
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

from scaffold.python.tasks import list_tasks, load_task

ROOT = Path(__file__).resolve().parents[4]
FIXTURES = ROOT / "eval/local/fixtures/edit-continuation-052"
CONTROLLERS = {
    "a3": {
        "native/controller.mjs",
        "native/driver.mjs",
        "classic/common.mjs",
        "classic/deterministic-driver.mjs",
        "classic/driver.mjs",
        "classic/validator.mjs",
    },
    "a4": {
        "native/driver.mjs",
        "classic/common.mjs",
        "classic/controller.mjs",
        "classic/driver.mjs",
        "classic/validator.mjs",
    },
    "a5": {
        "native/driver.mjs",
        "classic/common.mjs",
        "classic/driver.mjs",
        "classic/validator.mjs",
    },
}


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        ("Q1：JSON 导出归属，请确认 A 或 B。", True),
        ("等待你对 Q1 的明确答复。", True),
        ("等待您的选择后再继续。", True),
        ("等待检查完成，JSON 导出已经批准。", False),
        ("JSON 导出属于新需求。", False),
    ],
)
def test_pending_feature_validator_recognizes_an_actual_decision_request(response, expected):
    source = ast.parse((FIXTURES / "a5/validator_template.py").read_text(encoding="utf-8"))
    function = next(
        node
        for node in source.body
        if isinstance(node, ast.FunctionDef) and node.name == "requests_user_decision"
    )
    namespace = {"re": re}
    exec(
        compile(ast.Module(body=[function], type_ignores=[]), "a5-decision-request", "exec"),
        namespace,
    )
    assert namespace["requests_user_decision"](response) is expected


def test_edit_continuation_source_inventory_is_explicit_and_has_no_private_launcher():
    allowed = set(
        json.loads((ROOT / "config/repository-layout.json").read_text())["allowedCodeFiles"]
    )
    for group, expected in CONTROLLERS.items():
        folder = FIXTURES / group
        actual = {file.relative_to(folder).as_posix() for file in folder.rglob("*.mjs")}
        assert actual == expected
        for relative in expected:
            file = folder / relative
            assert file.relative_to(ROOT).as_posix() in allowed
            source = file.read_text(encoding="utf-8")
            assert "D:/Project" not in source and "D:/nodejs" not in source
        assert not (folder / "run_eval.py").exists()
    runner = (FIXTURES / "run.py").read_text(encoding="utf-8")
    assert ".claude/settings.json" not in runner and "Path.home()" not in runner
    assert "--authorize-model" in runner
    assert "eval_052" not in (ROOT / "eval/local/tests/conftest.py").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def assembled(tmp_path_factory):
    destination = tmp_path_factory.mktemp("edit-continuation-parent") / "prepared"
    result = subprocess.run(
        [
            sys.executable,
            str(FIXTURES / "prepare.py"),
            "--cli-root",
            str(ROOT),
            "--output",
            str(destination),
        ],
        cwd=ROOT / "eval",
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return destination


@pytest.mark.parametrize(
    ("workflow", "proof", "expected"),
    [
        ("native", {"passed": True}, True),
        ("classic", {"ok": True}, True),
        ("native", {"ok": True}, False),
        ("classic", {"passed": True}, False),
        ("native", {"passed": 1}, False),
        ("classic", {"ok": "true"}, False),
    ],
)
def test_authorized_implementation_validator_uses_the_workflow_specific_success_contract(
    workflow, proof, expected
):
    source = ast.parse((FIXTURES / "a4/validator_template.py").read_text(encoding="utf-8"))
    function = next(
        node
        for node in source.body
        if isinstance(node, ast.FunctionDef) and node.name == "workflow_validation_passed"
    )
    namespace = {}
    exec(
        compile(ast.Module(body=[function], type_ignores=[]), "a4-proof-contract", "exec"),
        namespace,
    )
    assert namespace["workflow_validation_passed"](workflow, proof) is expected


def test_edit_continuation_assembles_six_existing_runner_tasks_with_bound_inputs(assembled):
    for group in CONTROLLERS:
        folder = assembled / group
        manifest = json.loads((folder / "assembly-inputs.json").read_text(encoding="utf-8"))
        assert manifest["modelStarted"] is False
        for relative, expected in manifest["files"].items():
            assert hashlib.sha256((folder / relative).read_bytes()).hexdigest() == expected
        names = list_tasks(folder / "tasks")
        assert len(names) == 2
        for name in names:
            task = load_task(name, tasks_dir=folder / "tasks")
            assert task.config.evaluation.profile == "generic"
            prompt = (folder / "tasks" / name / "instruction.md").read_text(encoding="utf-8")
            assert "timeout=600000" in prompt and "run_in_background=false" in prompt
            assert "_eval_trusted_oracles" in prompt and "Superpowers" in prompt
            validator = next((folder / "tasks" / name / "validation").glob("*.py")).read_text(
                encoding="utf-8"
            )
            assert "model-tool-evidence.json" in validator
            assert "observedExtraAgentCalls" in validator
            assert "observedSubprocessAgentCalls" in validator


def test_edit_continuation_preparation_refuses_existing_output(assembled):
    sentinel = assembled / "keep.txt"
    sentinel.write_text("keep", encoding="utf-8")
    result = subprocess.run(
        [
            sys.executable,
            str(FIXTURES / "prepare.py"),
            "--cli-root",
            str(ROOT),
            "--output",
            str(assembled),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
    )
    assert result.returncode != 0
    assert sentinel.read_text(encoding="utf-8") == "keep"


def test_edit_continuation_model_execution_requires_explicit_authorization(assembled):
    result = subprocess.run(
        [
            sys.executable,
            str(FIXTURES / "run.py"),
            "--assembly",
            str(assembled),
            "--scenario",
            "a3",
            "--workflow",
            "native",
            "--mode",
            "model",
            "--model",
            "test-model",
        ],
        cwd=ROOT / "eval",
        env={**os.environ, "PYTHONUTF8": "1"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
    )
    assert result.returncode != 0
    assert "authorize-model" in result.stderr
    assert not (assembled / "a3/logs").exists()


def test_edit_continuation_runner_prepares_parent_of_a_fresh_pytest_workspace(
    assembled, monkeypatch
):
    spec = importlib.util.spec_from_file_location("continuation_runner", FIXTURES / "run.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run.py",
            "--assembly",
            str(assembled),
            "--scenario",
            "a3",
            "--workflow",
            "native",
            "--mode",
            "collect",
        ],
    )

    def inspect_command(command, **kwargs):
        temporary = Path(command[command.index("--basetemp") + 1])
        assert temporary.parent.is_dir()
        assert not temporary.exists()
        assert temporary.is_relative_to(assembled / "a3/workspaces")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(runner.subprocess, "run", inspect_command)
    assert runner.main() == 0
