from pathlib import Path
import hashlib
import json

import pytest
import yaml

from scaffold.python.validation import comet_workflow, rubric


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def sdk_archive(root):
    configure(root)
    change = root / "docs/openspec/changes/archive/2026-10-02-example"
    (change / "specs/example").mkdir(parents=True)
    spec = "### Requirement: Example\nThe feature SHALL work.\n"
    (change / "specs/example/spec.md").write_text("## ADDED Requirements\n" + spec)
    canonical = root / "docs/openspec/specs/example/spec.md"
    canonical.parent.mkdir(parents=True)
    canonical.write_text("# Example\n## Requirements\n" + spec)
    (change / ".comet/handoff").mkdir(parents=True)
    (change / ".comet/handoff/context.md").write_text("Preserve the approved example.")
    proposal = {"change": "example"}
    proposal_hash = digest(proposal)
    run = {
        "protocolVersion": 1,
        "schemaVersion": 1,
        "runId": "example",
        "workflow": {"id": "comet-classic-full", "version": "1"},
        "status": "completed",
        "state": {"context_compression": "off", "created_at": "2026-10-02"},
        "actions": [
            {
                "id": "example:1",
                "stepId": "full.archive.execute",
                "status": "succeeded",
                "outcome": {
                    "status": "succeeded",
                    "output": {"archiveDirectory": change.relative_to(root).as_posix()},
                },
            }
        ],
        "waits": [
            {
                "id": "example:approval",
                "stepId": "full.archive.confirm",
                "status": "resolved",
                "proposal": proposal,
                "proposalHash": proposal_hash,
                "choices": ["approved"],
                "decision": {
                    "id": "user-approved",
                    "choice": "approved",
                    "proposalHash": proposal_hash,
                },
            }
        ],
    }
    return change, run


def save_checkpoint(change, run):
    state = {
        "workflow": "full",
        "phase": "archive",
        "archived": True,
        "run_checkpoint": {
            "schema": "comet.workflow-run-checkpoint.v1",
            "hash": digest(run),
            "run": run,
        },
    }
    (change / ".comet.yaml").write_text("# comet-execution: managed-run\n" + yaml.safe_dump(state))


def test_guard_rubric_observes_public_cli_and_accepted_sdk_checks(tmp_path):
    change, run = sdk_archive(tmp_path)
    steps = ("open.revalidate", "build.check", "verify.check", "archive.preflight")
    run["actions"].extend(
        {
            "stepId": f"full.{step}",
            "status": "succeeded",
            "outcome": {"status": "succeeded"},
        }
        for step in steps
    )
    save_checkpoint(change, run)
    events = {
        "commands_run": ["./current-comet.sh guard example verify --apply -- python3 test.py"]
    }

    def score():
        passed, _ = rubric.comet_rubric_validator(tmp_path, {"events": events})
        return next(line for line in passed if line.startswith("[RUBRIC] gate_guard:"))

    assert "gate_guard: 1.00" in score()

    run["actions"][-1]["status"] = "failed"
    run["actions"][-1]["outcome"]["status"] = "failed"
    save_checkpoint(change, run)
    assert "gate_guard: 1.00" not in score()

    path = change / ".comet.yaml"
    path.write_text(path.read_text().replace(digest(run), "0" * 64))
    assert "gate_guard: 0.00" in score()


@pytest.mark.parametrize(
    "guard", ["comet guard", "node comet-guard.mjs", "./current-comet.sh guard"]
)
def test_guard_rubric_accepts_public_cli_and_bundle_in_compat_mode(guard):
    events = {
        "commands_run": [
            f"{guard} example build --apply",
            "comet state transition example build-complete",
        ]
    }

    assert rubric._score_gate_guard(events)[0] == 1.0


def test_sdk_spec_sync_is_observed_from_archive_outcome_and_canonical_requirements(tmp_path):
    change, run = sdk_archive(tmp_path)
    save_checkpoint(change, run)
    events = {"files_created": ["docs/openspec/changes/example/specs/example/spec.md"]}

    assert rubric._score_spec_drift(events, tmp_path)[0] == 1.0

    (tmp_path / "docs/openspec/specs/example/spec.md").write_text("# Unrelated spec\n")
    assert rubric._score_spec_drift(events, tmp_path)[0] == 0.5


def test_sdk_spec_sync_does_not_credit_an_unsuccessful_archive_command(tmp_path):
    change, run = sdk_archive(tmp_path)
    run["actions"][0]["status"] = "failed"
    run["actions"][0]["outcome"]["status"] = "failed"
    save_checkpoint(change, run)
    events = {
        "files_created": ["docs/openspec/changes/example/specs/example/spec.md"],
        "commands_run": ["openspec archive example"],
    }

    assert rubric._score_spec_drift(events, tmp_path)[0] == 0.5


def test_sdk_spec_sync_checks_removed_requirements_without_requiring_them_in_canonical_specs(
    tmp_path,
):
    change, run = sdk_archive(tmp_path)
    delta = change / "specs/example/spec.md"
    delta.write_text("## REMOVED Requirements\n### Requirement: Example\nThe feature SHALL work.\n")
    canonical = tmp_path / "docs/openspec/specs/example/spec.md"
    canonical.write_text("# Example\n## Requirements\n")
    save_checkpoint(change, run)

    assert rubric._score_spec_drift({}, tmp_path)[0] == 1.0

    canonical.write_text("### Requirement: Example\nThe feature SHALL work.\n")
    assert rubric._score_spec_drift({}, tmp_path)[0] == 0.5


def test_sdk_recovery_uses_the_bound_checkpoint_and_action_history(tmp_path):
    change, run = sdk_archive(tmp_path)
    save_checkpoint(change, run)

    assert rubric._score_recovery_resilience({}, tmp_path, "full")[0] == 1.0


@pytest.mark.parametrize("status", ["pending", "running", "unknown"])
def test_sdk_recovery_rejects_unfinished_external_actions(tmp_path, status):
    change, run = sdk_archive(tmp_path)
    run["actions"].append({"id": "example:2", "stepId": "full.archive.deliver", "status": status})
    save_checkpoint(change, run)

    assert rubric._score_recovery_resilience({}, tmp_path, "full")[0] == 0.8


def test_sdk_recovery_does_not_fall_back_to_compat_history_after_checkpoint_tampering(tmp_path):
    change, run = sdk_archive(tmp_path)
    save_checkpoint(change, run)
    state_file = change / ".comet.yaml"
    state_file.write_text(state_file.read_text().replace(digest(run), "0" * 64))
    (change / ".comet/state-events.jsonl").write_text('{"event":"archive"}\n')
    (change / ".comet/trajectory.jsonl").write_text('{"event":"archive"}\n')

    assert rubric._score_recovery_resilience({}, tmp_path, "full")[0] == 0.0


def test_sdk_decisions_need_matching_approval_and_host_interaction_evidence(tmp_path):
    change, run = sdk_archive(tmp_path)
    save_checkpoint(change, run)
    events = {"interaction": {"mode": "auto_user", "actual_turns": 2}}

    assert rubric._score_decision_point_compliance(events, "full", tmp_path)[0] == 1.0
    assert rubric._score_decision_point_compliance({}, "full", tmp_path)[0] == 0.0

    run["waits"][0]["decision"]["proposalHash"] = "0" * 64
    save_checkpoint(change, run)
    assert rubric._score_decision_point_compliance(events, "full", tmp_path)[0] == 0.0


def test_sdk_decisions_do_not_credit_pending_waits(tmp_path):
    change, run = sdk_archive(tmp_path)
    run["waits"][0]["status"] = "pending"
    save_checkpoint(change, run)

    assert (
        rubric._score_decision_point_compliance(
            {"interaction": {"mode": "auto_user", "actual_turns": 2}}, "full", tmp_path
        )[0]
        == 0.0
    )


def configure(root: Path, workflow: str = "classic", layout: str = "docs") -> None:
    (root / ".comet").mkdir()
    (root / ".comet/config.yaml").write_text(
        f"default_workflow: {workflow}\nworkflows: [native, classic]\n"
        f"native:\n  artifact_root: docs\nclassic:\n  artifact_layout: {layout}\n",
        encoding="utf-8",
    )


def test_classic_config_is_not_native_even_when_both_are_enabled(tmp_path):
    configure(tmp_path)
    assert not rubric._is_native_eval({}, tmp_path)


def test_observed_classic_entry_overrides_default_native(tmp_path):
    configure(tmp_path, workflow="native")
    outputs = {"events": {"skills_invoked": ["comet-classic", "comet-open"]}}
    assert not rubric._is_native_eval(outputs, tmp_path)


def test_native_rubric_emits_all_dimensions_without_unpacking_error(tmp_path, monkeypatch):
    configure(tmp_path, workflow="native")
    monkeypatch.setenv("BENCH_LLM_JUDGE", "0")
    passed, failed = rubric.comet_rubric_validator(
        tmp_path, {"events": {"skills_invoked": ["comet-native"]}}
    )
    assert len([p for p in passed if p.startswith("[RUBRIC]")]) == len(rubric.RUBRIC_DIMENSIONS) + 1
    assert not failed


def test_docs_layout_comes_from_config_not_treatment_name(tmp_path, monkeypatch):
    configure(tmp_path)
    change = tmp_path / "docs/openspec/changes/archive/example"
    change.mkdir(parents=True)
    (change / "proposal.md").write_text("proposal", encoding="utf-8")
    (change / "tasks.md").write_text("tasks", encoding="utf-8")
    monkeypatch.setattr(comet_workflow, "WORKSPACE", tmp_path)
    assert comet_workflow.check_openspec_artifacts()["status"] == "passed"
    assert rubric._changes_root(tmp_path, {"treatment_name": "ANY_CLASSIC"}) == change.parent.parent


def test_explicit_legacy_layout_is_not_overridden_by_treatment(tmp_path):
    configure(tmp_path, layout="legacy")
    assert (
        rubric._changes_root(tmp_path, {"treatment_name": "COMET_CLASSIC_DOCS_LAYOUT"})
        == tmp_path / "openspec/changes"
    )


def test_explicit_classic_entry_counts_without_generic_router(tmp_path, monkeypatch):
    configure(tmp_path)
    monkeypatch.setenv("BENCH_LLM_JUDGE", "0")
    events = {
        "skills_invoked": ["comet-classic", "comet-open", "openspec-new-change", "writing-plans"]
    }
    assert rubric._score_skill_invocation(events)[0] == 1.0
    _, failed = rubric.comet_rubric_validator(tmp_path, {"events": events})
    assert not failed
