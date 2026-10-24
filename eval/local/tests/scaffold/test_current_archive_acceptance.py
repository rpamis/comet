"""当前 Native/Classic 分级归档用例必须保留执行身份与终态检查。"""

import json
import importlib.util
import shutil

import pytest

from scaffold.python.paths import get_tasks_dir
from scaffold.python.tasks import load_task
from scaffold.python.validation.current_archive import inspect_completed_archive


@pytest.mark.parametrize(
    ("name", "difficulty"),
    [("comet-small-cli-archive", "easy"), ("comet-counter-refactor-archive", "medium")],
)
def test_graded_archive_tasks_use_current_cli(name, difficulty):
    task = load_task(name)
    assert task.config.difficulty == difficulty
    assert task.default_treatments == ["COMET_NATIVE_SDK_CURRENT", "COMET_CLASSIC_DOCS_LAYOUT"]
    environment = get_tasks_dir() / name / "environment"
    assert (environment / ".include-current-comet-cli").is_file()
    assert "node:22" in (environment / "Dockerfile").read_text(encoding="utf-8")
    assert "Complete the SDK workflow through Archive" in task.render_prompt()
    assert task.config.validation.test_scripts == "test_archive_task.py"


def test_051_acceptance_contains_one_case_for_each_workflow_and_difficulty():
    plan = json.loads((get_tasks_dir().parent / "acceptance-051.json").read_text(encoding="utf-8"))
    assert plan["branch"] == "051"
    assert len(plan["cases"]) == 6
    assert {(case["workflow"], case["difficulty"]) for case in plan["cases"]} == {
        (workflow, difficulty)
        for workflow in ("native", "classic")
        for difficulty in ("easy", "medium", "hard")
    }
    for case in plan["cases"]:
        assert load_task(case["task"]).config.difficulty == case["difficulty"]
        assert case["treatment"] == (
            "COMET_NATIVE_SDK_CURRENT"
            if case["workflow"] == "native"
            else "COMET_CLASSIC_DOCS_LAYOUT"
        )
        assert case["count"] == 1


@pytest.mark.parametrize("treatment", ["COMET_NATIVE_SDK_CURRENT", "COMET_CLASSIC_DOCS_LAYOUT"])
def test_archive_validation_rejects_a_handwritten_terminal_flag(tmp_path, treatment):
    directory = (
        tmp_path
        / (
            "docs/comet/archive"
            if treatment == "COMET_NATIVE_SDK_CURRENT"
            else "docs/openspec/changes/archive"
        )
        / "2026-10-25-example"
    )
    directory.mkdir(parents=True)
    (directory / "comet-state.yaml").write_text(
        "phase: archive\narchived: true\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="managed SDK checkpoint"):
        inspect_completed_archive(tmp_path, "example", treatment)


def test_archive_validation_rejects_a_frozen_workflow_treatment(tmp_path):
    with pytest.raises(ValueError, match="current Native or Classic"):
        inspect_completed_archive(tmp_path, "example", "COMET_FULL_040_BETA")


@pytest.mark.parametrize("name", ["comet-small-cli-archive", "comet-counter-refactor-archive"])
def test_graded_business_validator_detects_the_unmodified_fixture(tmp_path, name):
    root = get_tasks_dir() / name
    for source in (root / "environment").glob("*.py"):
        shutil.copyfile(source, tmp_path / source.name)
    spec = importlib.util.spec_from_file_location(
        "archive_task_validator", root / "validation/test_archive_task.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.check_feature(tmp_path)["status"] == "failed"
