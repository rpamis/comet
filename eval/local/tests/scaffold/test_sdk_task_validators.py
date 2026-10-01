"""Current-checkout workflow Eval must not accept compat artifacts as SDK proof."""

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest
import yaml

from scaffold.python.paths import get_tasks_dir


def _validator(task: str, script: str):
    path = get_tasks_dir() / task / "validation" / script
    spec = importlib.util.spec_from_file_location(f"{task}_validator", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_classic_current_layout_rejects_terminal_compat_state_without_sdk_owner(tmp_path: Path):
    validator = _validator("comet-classic-layout-lifecycle", "test_classic_layout_lifecycle.py")
    validator.WORKSPACE = tmp_path
    (tmp_path / validator.CONTEXT_FILE).write_text(
        json.dumps({"treatment_name": "COMET_CLASSIC_DOCS_LAYOUT"}), encoding="utf-8"
    )
    archived = tmp_path / "docs/openspec/changes/archive/2026-09-30-sentence-counting"
    archived.mkdir(parents=True)
    (archived / ".comet.yaml").write_text(
        "workflow: full\nphase: archive\nverify_result: pass\narchived: true\n",
        encoding="utf-8",
    )

    result = validator.check_sdk_run()

    assert result["check"] == "sdk_run"
    assert result["status"] == "failed"


def test_native_current_workflow_rejects_portable_archive_without_sdk_owner(tmp_path: Path):
    validator = _validator("comet-native-workflow", "test_native_workflow.py")
    validator.WORKSPACE = tmp_path
    archived = tmp_path / "docs/comet/archive/2026-09-30-sentence-counting"
    archived.mkdir(parents=True)
    (archived / "comet-state.yaml").write_text(
        "schema: comet.native.v4\nname: sentence-counting\nphase: archive\n"
        "status: done\narchived: true\n",
        encoding="utf-8",
    )

    result = validator.check_sdk_run()

    assert result["check"] == "sdk_run"
    assert result["status"] == "failed"


def test_native_current_workflow_requires_failed_then_passed_verify(tmp_path: Path):
    validator = _validator("comet-native-workflow", "test_native_workflow.py")
    validator.WORKSPACE = tmp_path
    archived = tmp_path / "docs/comet/archive/2026-09-30-sentence-counting"
    archived.mkdir(parents=True)
    state_path = archived / "comet-state.yaml"
    base = {
        "loop": {"stage": "done"},
        "history_overflow": {
            "dropped_entries": 0,
            "outcome_counts": {
                "pass": 0,
                "fail": 0,
                "blocked": 0,
                "execution-error": 0,
                "recovery": 0,
            },
        },
    }

    def entry(outcome: str, iteration: int, unresolved: list[str]):
        return {
            "goal_cycle": 1,
            "iteration": iteration,
            "attempt": 1,
            "outcome": outcome,
            "unresolved_ids": unresolved,
            "summary": {"text": outcome, "truncated": False},
            "completed_at": "2026-09-30T00:00:00Z",
        }

    state_path.write_text(
        yaml.safe_dump({**base, "history": [entry("pass", 1, [])]}),
        encoding="utf-8",
    )
    assert validator.check_loop()["status"] == "failed"

    state_path.write_text(
        yaml.safe_dump(
            {
                **base,
                "history": [entry("fail", 1, ["A8"]), entry("pass", 2, [])],
            }
        ),
        encoding="utf-8",
    )
    assert validator.check_loop()["status"] == "passed"


@pytest.mark.parametrize(
    ("task", "script", "workflow", "application", "state_file", "steps"),
    [
        (
            "comet-classic-layout-lifecycle",
            "test_classic_layout_lifecycle.py",
            "classic",
            "classic-full",
            ".comet.yaml",
            ["full.build.check", "full.verify.run", "full.archive.execute"],
        ),
        (
            "comet-native-workflow",
            "test_native_workflow.py",
            "native",
            "native",
            "comet-state.yaml",
            ["build.builder", "verify.verifier", "archive.finalize"],
        ),
    ],
)
def test_current_validator_inspects_matching_completed_sdk_run(
    tmp_path: Path,
    monkeypatch,
    task: str,
    script: str,
    workflow: str,
    application: str,
    state_file: str,
    steps: list[str],
):
    validator = _validator(task, script)
    validator.WORKSPACE = tmp_path
    if workflow == "classic":
        (tmp_path / validator.CONTEXT_FILE).write_text(
            json.dumps({"treatment_name": "COMET_CLASSIC_DOCS_LAYOUT"}), encoding="utf-8"
        )
        archived = tmp_path / "docs/openspec/changes/archive/2026-09-30-sentence-counting"
    else:
        archived = tmp_path / "docs/comet/archive/2026-09-30-sentence-counting"
    archived.mkdir(parents=True)
    owner = tmp_path / ".comet/runtime/change-owners" / workflow / "sentence-counting.json"
    owner.parent.mkdir(parents=True)
    owner.write_text(
        json.dumps(
            {
                "schema": "comet.change-owner.v1",
                "workflow": workflow,
                "change": "sentence-counting",
                "format": "sdk",
                "application": application,
                "runId": "sentence-counting",
            }
        ),
        encoding="utf-8",
    )
    (archived / state_file).write_text(
        "# comet-execution: managed-run\n"
        "run_checkpoint:\n"
        "  schema: comet.workflow-run-checkpoint.v1\n"
        f"  hash: '{'0' * 64}'\n"
        "  run:\n"
        "    runId: sentence-counting\n",
        encoding="utf-8",
    )
    calls = []

    def inspect(args, **kwargs):
        calls.append(args)
        request = json.loads(Path(args[-1]).read_text(encoding="utf-8"))
        assert request == {"operation": "inspect", "runId": "sentence-counting"}
        return subprocess.CompletedProcess(
            args,
            0,
            json.dumps(
                {
                    "status": "succeeded",
                    "data": {
                        "runId": "sentence-counting",
                        "workflow": {
                            "id": f"comet-{workflow if workflow == 'native' else 'classic-full'}"
                        },
                        "status": "completed",
                        "actions": [{"stepId": step, "status": "succeeded"} for step in steps],
                    },
                }
            ),
            "",
        )

    monkeypatch.setattr(validator.subprocess, "run", inspect)

    result = validator.check_sdk_run()

    assert result == {"check": "sdk_run", "status": "passed"}
    assert len(calls) == 1
    assert calls[0][:5] == ["comet", "runtime", "dispatch", "--application", application]

    steps.pop()
    incomplete = validator.check_sdk_run()
    assert incomplete["status"] == "failed"
    assert "lacks successful steps" in incomplete["reason"]


@pytest.mark.parametrize(
    "task,script",
    [
        ("comet-classic-layout-lifecycle", "test_classic_layout_lifecycle.py"),
        ("comet-native-workflow", "test_native_workflow.py"),
    ],
)
def test_current_validator_includes_sdk_check_in_main(task: str, script: str):
    source = (get_tasks_dir() / task / "validation" / script).read_text(encoding="utf-8")
    assert "check_sdk_run()" in source[source.index("def main():") :]


@pytest.mark.parametrize("layout", ["docs", "legacy"])
def test_classic_sdk_phase_validation_uses_verified_run_actions_not_compat_events(
    tmp_path: Path, monkeypatch, layout: str
):
    validator = _validator("comet-classic-layout-lifecycle", "test_classic_layout_lifecycle.py")
    validator.WORKSPACE = tmp_path
    treatment = "COMET_CLASSIC_DOCS_LAYOUT" if layout == "docs" else "COMET_CLASSIC_LEGACY_LAYOUT"
    (tmp_path / validator.CONTEXT_FILE).write_text(
        json.dumps({"treatment_name": treatment}), encoding="utf-8"
    )
    (tmp_path / ".comet").mkdir()
    (tmp_path / ".comet/config.yaml").write_text(
        f"schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: {layout}\n",
        encoding="utf-8",
    )
    root = "docs/openspec/changes" if layout == "docs" else "openspec/changes"
    archived = tmp_path / root / "archive/2026-10-01-sentence-counting"
    archived.mkdir(parents=True)
    (archived / ".comet.yaml").write_text(
        "# comet-execution: managed-run\n"
        "workflow: full\nphase: archive\nverify_result: pass\narchived: true\n"
        "run_checkpoint:\n  schema: comet.workflow-run-checkpoint.v1\n"
        f"  hash: '{'0' * 64}'\n  run:\n    runId: sentence-counting\n",
        encoding="utf-8",
    )
    owner_path = tmp_path / ".comet/runtime/change-owners/classic/sentence-counting.json"
    owner_path.parent.mkdir(parents=True)
    owner_path.write_text(
        json.dumps(
            {
                "schema": "comet.change-owner.v1",
                "workflow": "classic",
                "change": "sentence-counting",
                "format": "sdk",
                "application": "classic-full",
                "runId": "sentence-counting",
            }
        ),
        encoding="utf-8",
    )
    steps = [
        "full.open",
        "full.open.revalidate",
        "full.design.handoff",
        "full.design.document",
        "full.build.configure",
        "full.build.plan",
        "full.build.execute",
        "full.build.check",
        "full.verify.run",
        "full.verify.check",
        "full.archive.prepare",
        "full.archive.preflight",
        "full.archive.execute",
        "full.archive.deliver",
    ]
    run = {
        "runId": "sentence-counting",
        "workflow": {"id": "comet-classic-full"},
        "status": "completed",
        "actions": [{"stepId": step, "status": "succeeded"} for step in steps],
    }

    def inspect(args, **kwargs):
        request = json.loads(Path(args[-1]).read_text(encoding="utf-8"))
        assert request == {"operation": "inspect", "runId": "sentence-counting"}
        return subprocess.CompletedProcess(
            args, 0, json.dumps({"status": "succeeded", "data": run}), ""
        )

    monkeypatch.setattr(validator.subprocess, "run", inspect)

    assert validator.check_workflow_phases() == {"check": "workflow_phases", "status": "passed"}
    run["actions"].insert(0, {"stepId": "full.open", "status": "failed"})
    assert validator.check_workflow_phases() == {"check": "workflow_phases", "status": "passed"}
    run["actions"].pop(0)
    # A valid SDK owner must never fall back to forged compat event files.
    compat_dir = archived / ".comet"
    compat_dir.mkdir()
    compat_events = [
        {"event": event, "from": {"phase": source}, "to": {"phase": target}}
        for event, source, target in validator.REQUIRED_TRANSITIONS
    ]
    compat_lines = "\n".join(json.dumps(event) for event in compat_events) + "\n"
    (compat_dir / "state-events.jsonl").write_text(compat_lines, encoding="utf-8")
    (compat_dir / "trajectory.jsonl").write_text(compat_lines, encoding="utf-8")
    for step in steps:
        run["actions"] = [a for a in run["actions"] if a["stepId"] != step]
        result = validator.check_workflow_phases()
        assert result["status"] == "failed", step
        run["actions"] = [{"stepId": s, "status": "succeeded"} for s in steps]
    run["status"] = "running"
    assert validator.check_workflow_phases()["status"] == "failed"
    run["status"] = "completed"
    run["actions"].reverse()
    assert validator.check_workflow_phases()["status"] == "failed"
    run["actions"].reverse()
    run["actions"][0]["status"] = "failed"
    assert validator.check_workflow_phases()["status"] == "failed"
    run["actions"][0]["status"] = "succeeded"
    owner_path.unlink()
    assert validator.check_workflow_phases()["status"] == "failed"
