"""Tests for running the canonical Comet task set with Native workflow semantics."""

from pathlib import Path

import pytest
import yaml

from scaffold.python.native_eval import (
    adapt_checks_for_native,
    adapt_prompt_for_native,
    filter_control_workflow_checks,
    is_observational_baseline_run,
    split_comet_completion_checks,
)
from scaffold.python.validation.native_workflow import validate_native_workflow


def _write_native_archive(root: Path) -> None:
    archive = root / "docs" / "comet" / "archive" / "2026-07-16-fix-median"
    (archive / "specs" / "median").mkdir(parents=True)
    (root / "docs" / "comet" / "changes").mkdir(parents=True)
    (root / "docs" / "comet" / "specs" / "median").mkdir(parents=True)
    (root / ".comet").mkdir(parents=True)
    (root / ".comet" / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "schema": "comet.project.v1",
                "default_workflow": "native",
                "native": {"artifact_root": "docs"},
            }
        ),
        encoding="utf-8",
    )
    (archive / "comet-state.yaml").write_text(
        yaml.safe_dump(
            {
                "schema": "comet.native.v4",
                "name": "fix-median",
                "language": "en",
                "phase": "archive",
                "status": "done",
                "state_version": 5,
                "brief": "brief.md",
                "workspace": {
                    "isolation": "current",
                    "change_branch": None,
                    "target_branch": None,
                    "finish": None,
                },
                "loop": {
                    "stage": "done",
                    "goal_cycle": 1,
                    "iteration": 1,
                    "attempt": 1,
                    "retry_epoch": 0,
                    "failed_iteration_count": 0,
                    "no_progress_count": 0,
                    "execution_failure_count": 0,
                    "previous_unresolved_ids": [],
                    "next_action": None,
                },
                "acceptance": [
                    {
                        "id": "A1",
                        "source": "brief.md",
                        "text": "Median behavior is preserved.",
                        "result": "passed",
                        "reason": {"text": "Verified.", "truncated": False},
                    }
                ],
                "builder_handoff": {
                    "candidate_id": "candidate-1",
                    "identity_provider": "test",
                    "builder_execution_ref": "builder-1",
                    "iteration": 1,
                    "summary": {"text": "Implemented.", "truncated": False},
                    "addressed_acceptance_ids": ["A1"],
                    "checks": [],
                    "checks_truncated": False,
                    "known_limits": [],
                    "known_limits_truncated": False,
                    "submitted_at": "2026-07-16T00:00:00.000Z",
                },
                "blockers": [],
                "verification": {
                    "candidate_id": "candidate-1",
                    "identity_provider": "test",
                    "verifier_execution_ref": "verifier-1",
                    "iteration": 1,
                    "attempt": 1,
                    "assurance": "host-attested",
                    "verdict": "pass",
                    "checks": [],
                    "summary": {"text": "Verified.", "truncated": False},
                    "risks": [],
                    "risks_truncated": False,
                    "completed_at": "2026-07-16T00:00:01.000Z",
                },
                "history": [],
                "history_overflow": {
                    "dropped_entries": 0,
                    "first_dropped_at": None,
                    "last_dropped_at": None,
                    "outcome_counts": {
                        "pass": 0,
                        "fail": 0,
                        "blocked": 0,
                        "execution-error": 0,
                        "recovery": 0,
                    },
                },
                "verification_result": "pass",
                "verification_report": "verification.md",
                "archived": True,
                "created_at": "2026-07-16T00:00:00.000Z",
                "spec_changes": [
                    {
                        "capability": "median",
                        "operation": "create",
                        "source": "specs/median/spec.md",
                        "base_hash": None,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (archive / "brief.md").write_text("# Outcome\nFix median.\n", encoding="utf-8")
    (archive / "verification.md").write_text(
        "# Acceptance evidence\nPass.\n# Commands and results\npytest passed.\n",
        encoding="utf-8",
    )
    (archive / "specs" / "median" / "spec.md").write_text(
        "# Median\nEven lists use the two middle values.\n",
        encoding="utf-8",
    )
    (root / "docs" / "comet" / "specs" / "median" / "spec.md").write_text(
        "# Median\nEven lists use the two middle values.\n",
        encoding="utf-8",
    )


def _write_native_hard_stop(root: Path) -> None:
    change = root / "docs" / "comet" / "changes" / "stalled-average"
    change.mkdir(parents=True)
    (root / ".comet").mkdir(parents=True)
    (root / ".comet" / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "schema": "comet.project.v1",
                "default_workflow": "native",
                "native": {"artifact_root": "docs"},
            }
        ),
        encoding="utf-8",
    )
    (change / "comet-state.yaml").write_text(
        yaml.safe_dump(
            {
                "schema": "comet.native.v4",
                "name": "stalled-average",
                "language": "en",
                "phase": "build",
                "state_version": 4,
                "brief": "brief.md",
                "spec_changes": [],
                "workspace": {
                    "isolation": "current",
                    "change_branch": None,
                    "target_branch": None,
                    "finish": None,
                },
                "loop": {
                    "stage": "blocked",
                    "goal_cycle": 1,
                    "iteration": 1,
                    "attempt": 3,
                    "retry_epoch": 0,
                    "failed_iteration_count": 0,
                    "no_progress_count": 0,
                    "execution_failure_count": 3,
                    "previous_unresolved_ids": [],
                    "next_action": "retry-verifier",
                },
                "acceptance": [],
                "builder_handoff": None,
                "blockers": [
                    {
                        "owner": "runtime",
                        "reason": {"text": "Verifier execution failed.", "truncated": False},
                        "acceptance_ids": [],
                        "resolution_action": "retry-verifier",
                    }
                ],
                "verification": None,
                "history": [
                    {
                        "goal_cycle": 1,
                        "iteration": 1,
                        "attempt": 3,
                        "outcome": "execution-error",
                        "unresolved_ids": [],
                        "summary": {"text": "Verifier execution failed.", "truncated": False},
                        "completed_at": "2026-07-16T00:00:01.000Z",
                    }
                ],
                "history_overflow": {
                    "dropped_entries": 0,
                    "first_dropped_at": None,
                    "last_dropped_at": None,
                    "outcome_counts": {
                        "pass": 0,
                        "fail": 0,
                        "blocked": 0,
                        "execution-error": 0,
                        "recovery": 0,
                    },
                },
                "status": "blocked",
                "verification_result": "pending",
                "verification_report": None,
                "archived": False,
                "created_at": "2026-07-16T00:00:00.000Z",
            }
        ),
        encoding="utf-8",
    )


def test_validate_native_workflow_accepts_terminal_native_change(tmp_path: Path):
    _write_native_archive(tmp_path)
    (tmp_path / ".comet" / "runtime" / "native").mkdir(parents=True)

    passed, failed = validate_native_workflow(
        tmp_path,
        {"events": {"skills_invoked": ["comet-native"]}},
    )

    assert failed == []
    assert passed == [
        "native_skill_invocation",
        "native_artifacts",
        "native_state",
        "native_loop",
        "native_isolation",
    ]


def test_validate_native_workflow_accepts_expected_active_hard_stop(tmp_path: Path):
    _write_native_hard_stop(tmp_path)

    passed, failed = validate_native_workflow(
        tmp_path,
        {"events": {"skills_invoked": ["comet-native"]}},
        terminal_mode="active-blocked",
    )

    assert failed == []
    assert "native_state" in passed
    assert "native_loop" in passed


def test_validate_native_workflow_rejects_classic_artifacts_and_active_change(tmp_path: Path):
    _write_native_archive(tmp_path)
    (tmp_path / "openspec").mkdir()
    (tmp_path / "docs" / "comet" / "changes" / "still-active").mkdir()

    passed, failed = validate_native_workflow(tmp_path, {"events": {"skills_invoked": []}})

    assert "native_skill_invocation" not in passed
    assert any(item.startswith("native_skill_invocation:") for item in failed)
    assert any(item.startswith("native_state:") for item in failed)
    assert any(item.startswith("native_isolation:") for item in failed)


def test_validate_native_workflow_rejects_external_skill_invocation(tmp_path: Path):
    _write_native_archive(tmp_path)

    passed, failed = validate_native_workflow(
        tmp_path,
        {"events": {"skills_invoked": ["comet", "comet-native"]}},
    )

    assert "native_skill_invocation" not in passed
    assert any(
        item == "native_skill_invocation: unexpected Skills were invoked: comet" for item in failed
    )


def test_adapt_checks_for_native_replaces_classic_contract_but_keeps_business(tmp_path: Path):
    _write_native_archive(tmp_path)

    passed, failed = adapt_checks_for_native(
        tmp_path,
        {
            "events": {"skills_invoked": ["comet-native"]},
            "treatment_name": "COMET_NATIVE_PHASE1",
        },
        ["median_fix"],
        [
            "openspec_artifacts: missing",
            "comet_state: missing",
            "workflow_phases: missing",
            "tests_written: missing",
        ],
    )

    assert failed == []
    assert passed == [
        "median_fix",
        "native_skill_invocation",
        "native_artifacts",
        "native_state",
        "native_loop",
        "native_isolation",
    ]


def test_adapt_checks_for_native_does_not_change_other_treatments(tmp_path: Path):
    passed, failed = adapt_checks_for_native(
        tmp_path,
        {"treatment_name": "COMET_FULL_040_BETA"},
        ["median_fix"],
        ["openspec_artifacts: missing"],
    )

    assert passed == ["median_fix"]
    assert failed == ["openspec_artifacts: missing"]


def test_adapt_prompt_for_native_maps_legacy_workflow_words_without_changing_business_text():
    original = "Use the comet workflow to fix median([1, 2, 3, 4]). Follow Open and Design."

    adapted = adapt_prompt_for_native(original, "COMET_NATIVE_PHASE1")

    assert adapted.startswith("[COMET NATIVE BETA17 TREATMENT]")
    assert "Invoke /comet-native as the only Skill" in adapted
    assert "Shape, Build, Verify, and Archive" in adapted
    assert adapted.endswith(original)


@pytest.mark.parametrize(
    ("treatment", "mode"),
    [
        ("COMET_NATIVE_SEQUENTIAL", "sequential"),
        ("COMET_NATIVE_BATCH", "batch"),
    ],
)
def test_adapt_prompt_for_native_preserves_clarification_mode(treatment: str, mode: str):
    adapted = adapt_prompt_for_native("Clarify three decisions.", treatment)

    assert f"native.clarification_mode `{mode}`" in adapted
    assert adapted.endswith("Clarify three decisions.")


def test_adapt_prompt_for_native_preserves_an_expected_active_blocked_terminal():
    adapted = adapt_prompt_for_native(
        "Stop after the runtime hard-stop.",
        "COMET_NATIVE_PHASE1",
        terminal_mode="active-blocked",
    )

    assert "leave the change active at its runtime-enforced blocked state" in adapted
    assert "leave a verified terminal Native archive" not in adapted


def test_adapt_prompt_for_native_leaves_other_treatments_unchanged():
    prompt = "Use the comet workflow."

    assert adapt_prompt_for_native(prompt, "COMET_FULL_040_BETA") == prompt


def test_split_completion_classifies_native_checks_as_workflow():
    completion = split_comet_completion_checks(
        [
            "sentence_feature",
            "native_skill_invocation",
            "native_artifacts",
            "native_loop",
        ],
        [
            "business_rule: failed",
            "native_state: incomplete",
            "native_isolation: forbidden artifacts",
        ],
    )

    assert completion == {
        "business_completion": {
            "passed": ["sentence_feature"],
            "failed": ["business_rule: failed"],
        },
        "workflow_completion": {
            "passed": [
                "native_skill_invocation",
                "native_artifacts",
                "native_loop",
            ],
            "failed": [
                "native_state: incomplete",
                "native_isolation: forbidden artifacts",
            ],
        },
    }


def test_control_is_an_observational_baseline_but_dynamic_treatments_are_gating():
    assert is_observational_baseline_run("CONTROL") is True
    assert is_observational_baseline_run("DYNAMIC_SKILL") is False
    assert is_observational_baseline_run("COMET_FULL_040_BETA") is False


def test_control_filter_removes_classic_and_native_workflow_checks():
    passed, failed = filter_control_workflow_checks(
        "comet-workflow",
        "CONTROL",
        ["sentence_feature", "workflow_phases: 5/5", "native_state"],
        [
            "business_rule: failed",
            "openspec_artifacts: missing",
            "native_isolation: forbidden artifacts",
        ],
    )

    assert passed == ["sentence_feature"]
    assert failed == ["business_rule: failed"]


def test_validate_native_workflow_rejects_artifact_root_outside_workspace(tmp_path: Path):
    (tmp_path / ".comet").mkdir()
    (tmp_path / ".comet" / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "schema": "comet.project.v1",
                "default_workflow": "native",
                "native": {"artifact_root": "../../outside"},
            }
        ),
        encoding="utf-8",
    )

    passed, failed = validate_native_workflow(
        tmp_path,
        {"events": {"skills_invoked": ["comet-native"]}},
    )

    assert "native_artifacts" not in passed
    assert any(item.startswith("native_artifacts:") for item in failed)


def test_validate_native_workflow_rejects_canonical_spec_drift(tmp_path: Path):
    _write_native_archive(tmp_path)
    (tmp_path / "docs" / "comet" / "specs" / "median" / "spec.md").write_text(
        "# Median\nStale behavior.\n",
        encoding="utf-8",
    )

    passed, failed = validate_native_workflow(
        tmp_path,
        {"events": {"skills_invoked": ["comet-native"]}},
    )

    assert "native_state" not in passed
    assert any(item.startswith("native_state:") for item in failed)
