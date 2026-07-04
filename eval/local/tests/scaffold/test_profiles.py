from pathlib import Path

import pytest

from scaffold.python.profiles import (
    AUTHORING_SKILL_PROFILE,
    COMET_WORKFLOW_PROFILE,
    GENERIC_PROFILE,
    get_profile,
    list_profiles,
    resolve_profile_name,
    run_profile_rubric,
)
from scaffold.python.tasks import load_task


def test_profile_registry_exposes_generic_and_comet_workflow():
    assert list_profiles() == ["authoring-skill", "comet-workflow", "generic"]

    generic = get_profile(GENERIC_PROFILE)
    comet = get_profile(COMET_WORKFLOW_PROFILE)
    authoring = get_profile(AUTHORING_SKILL_PROFILE)

    assert generic.name == "generic"
    assert comet.name == "comet-workflow"
    assert authoring.name == "authoring-skill"
    assert "completion" in generic.rubric_dimensions
    assert "main_flow" in comet.rubric_dimensions
    assert "generated_package" in authoring.rubric_dimensions


def test_get_profile_rejects_unknown_names():
    with pytest.raises(KeyError, match="Profile not found: unknown"):
        get_profile("unknown")


def test_resolve_profile_name_prefers_cli_override():
    task = load_task("comet-full-workflow")

    assert resolve_profile_name(task, override="generic") == "generic"


def test_resolve_profile_name_uses_task_profile_by_default():
    task = load_task("comet-full-workflow")

    assert resolve_profile_name(task) == "comet-workflow"


def test_comet_profile_requires_comet_skill_invocation(tmp_path: Path):
    outputs = {
        "completion": {"passed": ["median fixed"], "failed": []},
        "events": {
            "skills_invoked": [],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
            "commands_run": [],
        },
        "interaction": {"mode": "auto_user", "max_turns": 3},
    }

    passed, failed = run_profile_rubric("comet-workflow", tmp_path, outputs)

    assert "Required skill not invoked: comet" in failed
    assert any("[RUBRIC] skill_invocation: 0.00" in msg for msg in passed)


def test_comet_profile_requires_nested_and_dependency_skill_invocations(tmp_path: Path):
    outputs = {
        "completion": {"passed": ["median fixed"], "failed": []},
        "events": {
            "skills_invoked": ["comet"],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
            "commands_run": [],
        },
        "interaction": {"mode": "auto_user", "max_turns": 3},
    }

    passed, failed = run_profile_rubric("comet-workflow", tmp_path, outputs)

    assert "Required nested Comet stage skill not invoked" in failed
    assert "Required OpenSpec dependency skill not invoked" in failed
    assert "Required Superpowers dependency skill not invoked" in failed
    assert any("[RUBRIC] skill_invocation: 0.20" in msg for msg in passed)
    assert any("comet_stage=missing" in msg for msg in passed)


def test_comet_profile_scores_observed_nested_and_dependency_skill_invocations(
    tmp_path: Path,
):
    outputs = {
        "completion": {"passed": ["median fixed"], "failed": []},
        "events": {
            "skills_invoked": [
                "comet",
                "comet-hotfix",
                "openspec-new-change",
                "comet-verify",
                "verification-before-completion",
            ],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
            "commands_run": [],
        },
        "interaction": {"mode": "auto_user", "max_turns": 3},
    }

    passed, failed = run_profile_rubric("comet-workflow", tmp_path, outputs)

    assert "Required nested Comet stage skill not invoked" not in failed
    assert "Required OpenSpec dependency skill not invoked" not in failed
    assert "Required Superpowers dependency skill not invoked" not in failed
    assert any("[RUBRIC] skill_invocation: 1.00" in msg for msg in passed)
    assert any("comet_stage=comet-hotfix, comet-verify" in msg for msg in passed)
    assert any("openspec=openspec-new-change" in msg for msg in passed)
    assert any("superpowers=verification-before-completion" in msg for msg in passed)


def test_comet_profile_scores_hotfix_with_hotfix_specific_rubric(tmp_path: Path):
    change_dir = tmp_path / "openspec" / "changes" / "archive" / "2026-07-01-fix-median"
    change_dir.mkdir(parents=True)
    comet_dir = change_dir / ".comet"
    comet_dir.mkdir()
    (comet_dir / "checkpoint.json").write_text(
        '{"runId":"r1","contextHash":null,"artifactsHash":"abc","createdAt":"2026-07-01"}',
        encoding="utf-8",
    )
    (comet_dir / "run-state.json").write_text(
        '{"status":"completed","currentStep":"completed"}',
        encoding="utf-8",
    )
    (comet_dir / "state-events.jsonl").write_text(
        '{"to":{"workflow":"hotfix","phase":"archive","archived":true}}\n',
        encoding="utf-8",
    )
    (comet_dir / "trajectory.jsonl").write_text("{}\n", encoding="utf-8")
    (change_dir / "proposal.md").write_text(
        "\n".join(f"line {i}" for i in range(12)),
        encoding="utf-8",
    )
    (change_dir / "design.md").write_text("Focused hotfix design.", encoding="utf-8")
    (change_dir / "tasks.md").write_text(
        "- [x] Reproduce median bug\n- [x] Fix even median\n",
        encoding="utf-8",
    )
    (tmp_path / "test_stats.py").write_text("def test_even():\n    assert True\n", encoding="utf-8")

    outputs = {
        "completion": {"passed": ["median fixed"], "failed": []},
        "events": {
            "skills_invoked": [
                "comet",
                "comet-hotfix",
                "openspec-new-change",
                "comet-verify",
                "verification-before-completion",
                "comet-archive",
            ],
            "commands_run": [
                "node comet-state.mjs set fix-median verify_mode light",
                "node comet-state.mjs transition fix-median verify-pass",
            ],
            "files_created": [
                "openspec/changes/archive/2026-07-01-fix-median/proposal.md",
                "openspec/changes/archive/2026-07-01-fix-median/tasks.md",
                "openspec/changes/archive/2026-07-01-fix-median/.comet/state-events.jsonl",
                "openspec/changes/archive/2026-07-01-fix-median/verification.md",
            ],
            "files_modified": [],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
        },
        "interaction": {"mode": "auto_user", "max_turns": 3},
    }

    passed, _ = run_profile_rubric("comet-workflow", tmp_path, outputs)

    assert any("[RUBRIC] main_flow: 1.00 - workflow=hotfix" in msg for msg in passed)
    assert any("[RUBRIC] decision_point_compliance: 1.00" in msg for msg in passed)
    assert any("no hotfix decision mutations observed" in msg for msg in passed)
    assert any("[RUBRIC] artifact_quality: 1.00" in msg for msg in passed)
    assert any("workflow=hotfix" in msg and "tasks=2 boxes" in msg for msg in passed)
    assert any("[RUBRIC] recovery_resilience: 1.00" in msg for msg in passed)


def test_comet_profile_scores_tweak_with_tweak_specific_rubric(tmp_path: Path):
    change_dir = tmp_path / "openspec" / "changes" / "archive" / "2026-07-01-adjust-copy"
    change_dir.mkdir(parents=True)
    (change_dir / ".comet").mkdir()
    (change_dir / ".comet.yaml").write_text(
        "classic_profile: tweak\nphase: archive\nverify_result: pass\n",
        encoding="utf-8",
    )
    (change_dir / "proposal.md").write_text(
        "\n".join(f"line {i}" for i in range(12)),
        encoding="utf-8",
    )
    (change_dir / "tasks.md").write_text("- [x] Apply copy tweak\n", encoding="utf-8")
    (tmp_path / "test_copy.py").write_text("def test_copy():\n    assert True\n", encoding="utf-8")

    outputs = {
        "completion": {"passed": ["copy adjusted"], "failed": []},
        "events": {
            "skills_invoked": [
                "comet",
                "comet-tweak",
                "openspec-new-change",
                "openspec-apply-change",
                "comet-verify",
                "verification-before-completion",
                "comet-archive",
            ],
            "commands_run": ["node comet-state.mjs set adjust-copy verify_mode light"],
            "files_created": [
                "openspec/changes/archive/2026-07-01-adjust-copy/proposal.md",
                "openspec/changes/archive/2026-07-01-adjust-copy/tasks.md",
                "openspec/changes/archive/2026-07-01-adjust-copy/.comet/state-events.jsonl",
                "openspec/changes/archive/2026-07-01-adjust-copy/verification.md",
            ],
            "files_modified": [],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
        },
        "interaction": {"mode": "auto_user", "max_turns": 3},
    }

    passed, _ = run_profile_rubric("comet-workflow", tmp_path, outputs)

    assert any("[RUBRIC] main_flow: 1.00 - workflow=tweak" in msg for msg in passed)
    assert any("[RUBRIC] artifact_quality: 1.00" in msg for msg in passed)
    assert any("workflow=tweak" in msg and "tasks=1 boxes" in msg for msg in passed)


def test_comet_profile_scores_full_with_full_specific_rubric(tmp_path: Path):
    change_dir = tmp_path / "openspec" / "changes" / "archive" / "2026-07-01-add-api"
    change_dir.mkdir(parents=True)
    (change_dir / ".comet" / "handoff").mkdir(parents=True)
    (change_dir / ".comet.yaml").write_text(
        "workflow: full\nphase: archive\nverify_result: pass\n",
        encoding="utf-8",
    )
    (change_dir / ".comet" / "handoff" / "design-context.md").write_text(
        "context",
        encoding="utf-8",
    )
    (change_dir / "proposal.md").write_text(
        "\n".join(f"line {i}" for i in range(12)),
        encoding="utf-8",
    )
    (change_dir / "design.md").write_text(
        "Tradeoff and alternative option with risk to consider.",
        encoding="utf-8",
    )
    (change_dir / "tasks.md").write_text(
        "- [x] Design API\n- [x] Implement API\n- [x] Verify API\n",
        encoding="utf-8",
    )
    (tmp_path / "test_api.py").write_text("def test_api():\n    assert True\n", encoding="utf-8")

    outputs = {
        "completion": {"passed": ["api added"], "failed": []},
        "events": {
            "skills_invoked": [
                "comet",
                "comet-open",
                "openspec-new-change",
                "comet-design",
                "brainstorming",
                "comet-build",
                "writing-plans",
                "comet-verify",
                "verification-before-completion",
                "comet-archive",
            ],
            "commands_run": [
                "node comet-state.mjs set add-api build_mode executing-plans",
                "node comet-state.mjs transition add-api verify-pass",
            ],
            "tool_calls": [{"tool": "AskUserQuestion", "input": {}}],
            "files_created": [
                "openspec/changes/archive/2026-07-01-add-api/proposal.md",
                "openspec/changes/archive/2026-07-01-add-api/tasks.md",
                "docs/superpowers/specs/add-api.md",
                "docs/superpowers/plans/add-api.md",
                "openspec/changes/archive/2026-07-01-add-api/verification.md",
            ],
            "files_modified": [],
            "num_turns": 1,
            "duration_seconds": 5,
        },
        "interaction": {"mode": "auto_user", "max_turns": 3},
    }

    passed, _ = run_profile_rubric("comet-workflow", tmp_path, outputs)

    assert any("[RUBRIC] main_flow: 1.00 - workflow=full" in msg for msg in passed)
    assert any("[RUBRIC] artifact_quality: 1.00" in msg for msg in passed)
    assert any("workflow=full" in msg and "design=deep" in msg for msg in passed)


def test_generic_profile_scores_completion_skill_artifact_and_efficiency(tmp_path: Path):
    (tmp_path / "result.md").write_text("done")
    outputs = {
        "completion": {"passed": ["validator ok"], "failed": []},
        "events": {
            "skills_invoked": ["target-skill"],
            "num_turns": 3,
            "tool_calls": [{"tool": "Read", "input": {}}],
            "duration_seconds": 12,
            "commands_run": [],
        },
        "required_skills": ["target-skill"],
        "expected_artifacts": ["result.md"],
        "interaction": {"mode": "none"},
    }

    passed, failed = run_profile_rubric("generic", tmp_path, outputs)

    assert failed == []
    assert any("[RUBRIC] completion: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] skill_invocation: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] artifact_presence: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] weighted_score:" in msg for msg in passed)


def test_generic_profile_can_fail_required_skill_invocation(tmp_path: Path):
    outputs = {
        "completion": {"passed": [], "failed": ["validator failed"]},
        "events": {"skills_invoked": [], "commands_run": []},
        "required_skills": ["target-skill"],
        "expected_artifacts": [],
        "require_skill_invocation": True,
        "interaction": {"mode": "none"},
    }

    passed, failed = run_profile_rubric("generic", tmp_path, outputs)

    assert any("Required skill not invoked: target-skill" in msg for msg in failed)
    assert any("[RUBRIC] skill_invocation: 0.00" in msg for msg in passed)


def test_authoring_profile_scores_generated_package_and_engine_contract(tmp_path: Path):
    package = tmp_path / "authoring-skill"
    (package / "reference").mkdir(parents=True)
    (package / "comet").mkdir(parents=True)
    node_skill = tmp_path / "authoring-skill-open"
    node_skill.mkdir()
    (package / "SKILL.md").write_text(
        "# Demo\n\n## Workflow Nodes\n- `authoring-skill-open`\n\n## 用户停顿点\n- Confirm before exit.\n\n## 自动推进与恢复\n- scripts/workflow-guard.mjs\n\n## 参考\n- `reference/workflow-protocol.json`\n- `reference/resolved-skills.json`\n",
        encoding="utf-8",
    )
    (node_skill / "SKILL.md").write_text(
        "# Node\n\n## Node Goal\n- open\n",
        encoding="utf-8",
    )
    (package / "reference" / "resolved-skills.json").write_text(
        '{"sourceSummaries":[{"name":"demo-source"}]}',
        encoding="utf-8",
    )
    (package / "reference" / "workflow-protocol.json").write_text(
        '{"name":"authoring-skill","nodes":[{"id":"open","disabled":false}]}',
        encoding="utf-8",
    )
    (package / "reference" / "authoring-lanes.json").write_text(
        '{"lanes":[{"lane":"skill-core"},{"lane":"script-contract"},{"lane":"reference"},{"lane":"pause-points"},{"lane":"eval"},{"lane":"skill-review"}],"review":{"passed":true,"blockingFindings":[]}}',
        encoding="utf-8",
    )
    (package / "reference" / "skill-review.md").write_text(
        "# Skill Review\n\nStatus: Review passed\n",
        encoding="utf-8",
    )
    for name in ("skill.yaml", "guardrails.yaml", "checks.yaml"):
        (package / "comet" / name).write_text("name: demo\n", encoding="utf-8")
    (package / "comet" / "eval.yaml").write_text(
        "evaluation:\n"
        "  recommendedTasks:\n"
        "    - workflow-route-conformance\n"
        "  generatedNodeSkills:\n"
        "    - authoring-skill-open\n"
        "  routeConformance:\n"
        "    task: workflow-route-conformance\n"
        "    expectedNodeOrder:\n"
        "      - open\n",
        encoding="utf-8",
    )

    outputs = {
        "completion": {"passed": ["validator ok"], "failed": []},
        "events": {
            "skills_invoked": ["comet-any"],
            "num_turns": 4,
            "tool_calls": [{"tool": "Read", "input": {}}],
            "duration_seconds": 20,
            "commands_run": [],
        },
        "required_skills": ["comet-any"],
        "expected_artifacts": [],
        "interaction": {"mode": "auto_user", "max_turns": 8},
        "skill_package_path": str(package),
        "generated_node_skills": ["authoring-skill-open"],
        "route_conformance_expected_node_order": ["open"],
    }

    passed, failed = run_profile_rubric("authoring-skill", tmp_path, outputs)

    assert failed == []
    assert any("[RUBRIC] generated_package: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] resolved_skill_evidence: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] engine_contract: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] workflow_route_conformance: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] authoring_lanes: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] review_gate: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] weighted_score:" in msg for msg in passed)


def test_authoring_profile_allows_lightweight_package_without_engine_files(tmp_path: Path):
    package = tmp_path / "authoring-skill"
    (package / "reference").mkdir(parents=True)
    node_skill = tmp_path / "authoring-skill-open"
    node_skill.mkdir()
    (package / "SKILL.md").write_text(
        "# Demo\n\n## Workflow Nodes\n- `authoring-skill-open`\n\n## 用户停顿点\n- Confirm before exit.\n\n## 自动推进与恢复\n- scripts/workflow-guard.mjs\n\n## 参考\n- `reference/workflow-protocol.json`\n- `reference/resolved-skills.json`\n",
        encoding="utf-8",
    )
    (node_skill / "SKILL.md").write_text(
        "# Node\n\n## Node Goal\n- open\n",
        encoding="utf-8",
    )
    (package / "reference" / "resolved-skills.json").write_text(
        '{"sourceSummaries":[{"name":"demo-source"}]}',
        encoding="utf-8",
    )
    (package / "reference" / "workflow-protocol.json").write_text(
        '{"name":"authoring-skill","nodes":[{"id":"open","disabled":false}]}',
        encoding="utf-8",
    )
    (package / "reference" / "authoring-lanes.json").write_text(
        '{"lanes":[{"lane":"skill-core"},{"lane":"script-contract"},{"lane":"reference"},{"lane":"pause-points"},{"lane":"eval"},{"lane":"skill-review"}],"review":{"passed":true,"blockingFindings":[]}}',
        encoding="utf-8",
    )
    (package / "reference" / "skill-review.md").write_text(
        "# Skill Review\n\nStatus: Review passed\n",
        encoding="utf-8",
    )

    outputs = {
        "completion": {"passed": ["validator ok"], "failed": []},
        "events": {
            "skills_invoked": ["comet-any"],
            "num_turns": 2,
            "tool_calls": [],
            "duration_seconds": 10,
            "commands_run": [],
        },
        "required_skills": ["comet-any"],
        "expected_artifacts": [],
        "interaction": {"mode": "auto_user", "max_turns": 8},
        "skill_package_path": str(package),
        "generated_node_skills": ["authoring-skill-open"],
        "route_conformance_expected_node_order": ["open"],
    }

    passed, failed = run_profile_rubric("authoring-skill", tmp_path, outputs)

    assert failed == []
    assert any("[RUBRIC] engine_contract: 1.00 - Engine disabled for lightweight package" in msg for msg in passed)


# ---------------------------------------------------------------------------
# N/A dimension scoring tests
# ---------------------------------------------------------------------------


def test_generic_rubric_na_dimensions_emit_na_format(tmp_path: Path):
    """When required_skills and expected_artifacts are empty, those dimensions
    should emit N/A instead of a numeric score."""
    outputs = {
        "completion": {"passed": ["ok"], "failed": []},
        "events": {
            "skills_invoked": [],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
            "commands_run": [],
        },
        "required_skills": [],
        "expected_artifacts": [],
        "interaction": {"mode": "none"},
    }

    passed, failed = run_profile_rubric("generic", tmp_path, outputs)

    assert any("[RUBRIC] skill_invocation: N/A -" in msg for msg in passed)
    assert any("[RUBRIC] artifact_presence: N/A -" in msg for msg in passed)
    # Numeric dimensions should still have scores.
    assert any("[RUBRIC] completion: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] efficiency:" in msg for msg in passed)
    assert not any("skill_invocation: 0.50" in msg for msg in passed)
    assert not any("artifact_presence: 0.50" in msg for msg in passed)


def test_generic_rubric_skips_na_dimensions_from_weighted_score(tmp_path: Path):
    """The weighted score should only average over applicable dimensions,
    not dilute with 0.5 for unconfigured ones."""
    outputs_all_na = {
        "completion": {"passed": ["ok"], "failed": []},
        "events": {
            "skills_invoked": [],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
            "commands_run": [],
        },
        "required_skills": [],
        "expected_artifacts": [],
        "interaction": {"mode": "none"},
    }
    outputs_with_skills = {
        "completion": {"passed": ["ok"], "failed": []},
        "events": {
            "skills_invoked": ["target-skill"],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
            "commands_run": [],
        },
        "required_skills": ["target-skill"],
        "expected_artifacts": ["result.md"],
        "interaction": {"mode": "none"},
    }
    (tmp_path / "result.md").write_text("done")

    passed_na, _ = run_profile_rubric("generic", tmp_path, outputs_all_na)
    passed_full, _ = run_profile_rubric("generic", tmp_path, outputs_with_skills)

    def _extract_weighted(passed_list: list[str]) -> float:
        for msg in passed_list:
            if "[RUBRIC] weighted_score:" in msg:
                return float(msg.split("weighted_score:")[1].strip())
        return 0.0

    score_na = _extract_weighted(passed_na)
    score_full = _extract_weighted(passed_full)

    # Both should produce valid scores between 0 and 1.
    assert 0.0 <= score_na <= 1.0
    assert 0.0 <= score_full <= 1.0
    # When all checks pass and no N/A dimensions, score should be 1.0.
    assert score_full == 1.00


def test_generic_rubric_with_required_skills_scores_numeric(tmp_path: Path):
    """When required_skills is configured, skill_invocation should be numeric."""
    outputs = {
        "completion": {"passed": ["ok"], "failed": []},
        "events": {
            "skills_invoked": ["target-skill"],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
            "commands_run": [],
        },
        "required_skills": ["target-skill"],
        "expected_artifacts": [],
        "interaction": {"mode": "none"},
    }

    passed, _ = run_profile_rubric("generic", tmp_path, outputs)

    assert any("[RUBRIC] skill_invocation: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] artifact_presence: N/A -" in msg for msg in passed)


def test_comet_control_marks_workflow_dimensions_not_applicable(tmp_path: Path):
    """CONTROL should score business completion without requiring Comet Skill use."""
    outputs = {
        "treatment_name": "CONTROL",
        "business_completion": {"passed": ["sentence_feature"], "failed": []},
        "workflow_completion": {"passed": [], "failed": ["tests_exist: No test files found"]},
        "events": {
            "skills_invoked": [],
            "num_turns": 2,
            "tool_calls": [],
            "duration_seconds": 5,
            "commands_run": [],
        },
    }

    passed, failed = run_profile_rubric("comet-workflow", tmp_path, outputs)

    assert failed == []
    assert any("[RUBRIC] main_flow: N/A -" in msg for msg in passed)
    assert any("[RUBRIC] gate_guard: N/A -" in msg for msg in passed)
    assert any("[RUBRIC] skill_invocation: N/A -" in msg for msg in passed)
    assert any("[RUBRIC] spec_drift: N/A -" in msg for msg in passed)
    assert any("[RUBRIC] business_completion: 1.00" in msg for msg in passed)
    assert any("[RUBRIC] workflow_completion: N/A -" in msg for msg in passed)
    assert any("[RUBRIC] efficiency:" in msg for msg in passed)
    assert any("[RUBRIC] weighted_score: 1.00" in msg for msg in passed)


def test_comet_profile_splits_business_and_workflow_completion(tmp_path: Path):
    outputs = {
        "business_completion": {
            "passed": ["sentence_feature"],
            "failed": ["business_rule: failed"],
        },
        "workflow_completion": {
            "passed": ["openspec_artifacts"],
            "failed": ["tests_exist: No test files found"],
        },
        "events": {
            "skills_invoked": [
                "comet",
                "comet-hotfix",
                "openspec-new-change",
                "verification-before-completion",
            ],
            "commands_run": [],
            "files_created": [],
            "files_modified": [],
            "num_turns": 1,
            "tool_calls": [],
            "duration_seconds": 5,
        },
    }

    passed, _ = run_profile_rubric("comet-workflow", tmp_path, outputs)

    assert any("[RUBRIC] business_completion: 0.50" in msg for msg in passed)
    assert any("[RUBRIC] workflow_completion: 0.50" in msg for msg in passed)
    assert not any("[RUBRIC] completion:" in msg for msg in passed)


# ---------------------------------------------------------------------------
# LLM judge prompt tests
# ---------------------------------------------------------------------------


def test_generic_llm_judge_prompt_includes_custom_criteria(tmp_path: Path):
    """The judge prompt should include rubric_criteria from task config."""
    from scaffold.python.generic_llm_judge import _build_generic_judge_prompt

    (tmp_path / "output.txt").write_text("hello world")
    outputs = {
        "completion": {"passed": ["ok"], "failed": []},
        "rubric_criteria": [
            "The function handles edge cases",
            "Error messages are user-friendly",
        ],
    }

    prompt = _build_generic_judge_prompt(tmp_path, outputs)

    assert "The function handles edge cases" in prompt
    assert "Error messages are user-friendly" in prompt
    assert "custom_0" in prompt
    assert "custom_1" in prompt
    assert "task_completion" in prompt
    assert "output_quality" in prompt
    assert "instruction_adherence" in prompt


def test_generic_llm_judge_prompt_without_custom_criteria(tmp_path: Path):
    """Without custom criteria, prompt should have exactly 3 standard dimensions."""
    from scaffold.python.generic_llm_judge import _build_generic_judge_prompt

    (tmp_path / "output.txt").write_text("hello world")
    outputs = {"completion": {"passed": ["ok"], "failed": []}}

    prompt = _build_generic_judge_prompt(tmp_path, outputs)

    assert "EXACTLY 3 lines" in prompt
    assert "custom_0" not in prompt
    assert "task_completion" in prompt


def test_generic_llm_judge_collects_workspace_files(tmp_path: Path):
    """The artifact collector should find non-hidden files."""
    from scaffold.python.generic_llm_judge import _collect_workspace_artifacts

    (tmp_path / "result.md").write_text("# Result\nDone")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('hello')")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("ignored")

    artifacts = _collect_workspace_artifacts(tmp_path)

    assert "result.md" in artifacts
    assert str(Path("src") / "main.py") in artifacts
    assert ".git" not in artifacts


def test_judge_env_requires_explicit_judge_model(monkeypatch):
    """LLM judge must not silently reuse the subject model."""
    from scaffold.python.judge_config import build_judge_invocation

    monkeypatch.setenv("ANTHROPIC_MODEL", "subject-model")
    monkeypatch.delenv("BENCH_JUDGE_MODEL", raising=False)

    try:
        build_judge_invocation()
    except ValueError as exc:
        assert "BENCH_JUDGE_MODEL" in str(exc)
    else:
        raise AssertionError("expected missing BENCH_JUDGE_MODEL to fail")


def test_judge_env_maps_independent_provider(monkeypatch):
    """Judge subprocess env should use BENCH_JUDGE_* instead of subject ANTHROPIC_*."""
    from scaffold.python.judge_config import build_judge_invocation

    monkeypatch.setenv("ANTHROPIC_MODEL", "subject-model")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://subject.example")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "subject-token")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "subject-key")
    monkeypatch.setenv("BENCH_JUDGE_MODEL", "judge-model")
    monkeypatch.setenv("BENCH_JUDGE_BASE_URL", "https://judge.example")
    monkeypatch.setenv("BENCH_JUDGE_AUTH_TOKEN", "judge-token")

    invocation = build_judge_invocation()

    assert invocation.model_flag == ["--model", "judge-model"]
    assert invocation.env["ANTHROPIC_MODEL"] == "judge-model"
    assert invocation.env["ANTHROPIC_BASE_URL"] == "https://judge.example"
    assert invocation.env["ANTHROPIC_AUTH_TOKEN"] == "judge-token"
    assert "ANTHROPIC_API_KEY" not in invocation.env
    assert "subject-model" not in invocation.env.values()
    assert "subject-token" not in invocation.env.values()


def test_judge_provider_uses_direct_http_when_base_url_is_configured(monkeypatch):
    """Dedicated judge providers should not require Claude CLI compatibility."""
    import json
    from unittest.mock import patch

    from scaffold.python.judge_config import run_judge_prompt

    monkeypatch.setenv("BENCH_JUDGE_MODEL", "judge-model")
    monkeypatch.setenv("BENCH_JUDGE_BASE_URL", "https://judge.example/api/anthropic")
    monkeypatch.setenv("BENCH_JUDGE_AUTH_TOKEN", "judge-token")

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(
                {
                    "content": [
                        {
                            "type": "text",
                            "text": "[RUBRIC-JUDGE] task_completion: 1.00 - ok",
                        }
                    ]
                }
            ).encode("utf-8")

    with patch("urllib.request.urlopen", return_value=FakeResponse()) as urlopen:
        output = run_judge_prompt("score this")

    request = urlopen.call_args.args[0]
    assert request.full_url == "https://judge.example/api/anthropic/v1/messages"
    assert request.headers["Authorization"] == "Bearer judge-token"
    assert json.loads(request.data.decode("utf-8"))["model"] == "judge-model"
    assert output == "[RUBRIC-JUDGE] task_completion: 1.00 - ok"


def test_comet_llm_judge_reports_skipped_without_success_status(monkeypatch, tmp_path: Path):
    """Missing judge config should be visible and not reported as successful."""
    from scaffold.python.llm_judge import judge_messages

    change = tmp_path / "openspec" / "changes" / "demo"
    change.mkdir(parents=True)
    (change / "proposal.md").write_text("proposal")
    monkeypatch.setenv("BENCH_LLM_JUDGE", "1")
    monkeypatch.setenv("ANTHROPIC_MODEL", "subject-model")
    monkeypatch.delenv("BENCH_JUDGE_MODEL", raising=False)

    messages = judge_messages(tmp_path)

    assert messages == [
        "[RUBRIC-JUDGE] status: skipped - BENCH_JUDGE_MODEL is required when BENCH_LLM_JUDGE=1"
    ]
    assert not any("enabled_and_successful" in msg for msg in messages)


def test_comet_profile_does_not_mark_skipped_judge_successful(monkeypatch, tmp_path: Path):
    """Profile rubric should not add success status when judge config is missing."""
    from scaffold.python.profiles import run_profile_rubric

    change = tmp_path / "openspec" / "changes" / "demo"
    change.mkdir(parents=True)
    (change / "proposal.md").write_text("proposal")
    monkeypatch.setenv("BENCH_LLM_JUDGE", "1")
    monkeypatch.setenv("ANTHROPIC_MODEL", "subject-model")
    monkeypatch.delenv("BENCH_JUDGE_MODEL", raising=False)

    passed, _ = run_profile_rubric(
        "comet-workflow",
        tmp_path,
        {"completion": {"passed": ["ok"], "failed": []}},
    )

    assert any("[RUBRIC-JUDGE] status: skipped" in msg for msg in passed)
    assert not any("[RUBRIC-JUDGE] status: enabled_and_successful" in msg for msg in passed)


def test_generic_llm_judge_parses_output(tmp_path: Path):
    """judge_generic_artifacts should parse [RUBRIC-JUDGE] lines correctly."""
    from unittest.mock import patch
    from scaffold.python.generic_llm_judge import judge_generic_artifacts

    mock_output = (
        "[RUBRIC-JUDGE] task_completion: 0.80 - output present and mostly correct\n"
        "[RUBRIC-JUDGE] output_quality: 0.90 - well-structured code\n"
        "[RUBRIC-JUDGE] instruction_adherence: 1.00 - all constraints followed\n"
    )
    outputs = {"completion": {"passed": [], "failed": []}}

    with patch(
        "scaffold.python.generic_llm_judge._run_judge",
        return_value=mock_output,
    ):
        scores = judge_generic_artifacts(tmp_path, outputs)

    assert scores["task_completion"] == (0.80, "output present and mostly correct")
    assert scores["output_quality"] == (0.90, "well-structured code")
    assert scores["instruction_adherence"] == (1.00, "all constraints followed")


def test_generic_llm_judge_parses_custom_dimensions(tmp_path: Path):
    """Custom rubric criteria should produce custom_N dimensions in output."""
    from unittest.mock import patch
    from scaffold.python.generic_llm_judge import judge_generic_artifacts

    mock_output = (
        "[RUBRIC-JUDGE] task_completion: 1.00 - done\n"
        "[RUBRIC-JUDGE] output_quality: 0.80 - good\n"
        "[RUBRIC-JUDGE] instruction_adherence: 1.00 - ok\n"
        "[RUBRIC-JUDGE] custom_0: 0.90 - handles edge cases well\n"
        "[RUBRIC-JUDGE] custom_1: 0.70 - error messages could improve\n"
    )
    outputs = {
        "completion": {"passed": [], "failed": []},
        "rubric_criteria": ["edge cases", "error messages"],
    }

    with patch(
        "scaffold.python.generic_llm_judge._run_judge",
        return_value=mock_output,
    ):
        scores = judge_generic_artifacts(tmp_path, outputs)

    assert "custom_0" in scores
    assert "custom_1" in scores
    assert scores["custom_0"] == (0.90, "handles edge cases well")
