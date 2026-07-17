"""Tests for generated Skill eval manifest loading."""

from pathlib import Path

import pytest

from scaffold.python.manifests import load_eval_manifest


def test_load_eval_manifest_parses_skill_package_metadata(tmp_path: Path):
    package = tmp_path / "my-skill"
    package.mkdir()
    (package / "SKILL.md").write_text("---\nname: my-skill\n---\n\nBody.", encoding="utf-8")
    comet_dir = package / "comet"
    comet_dir.mkdir()
    manifest_path = comet_dir / "eval.yaml"
    manifest_path.write_text(
        """
apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata:
  name: my-skill
  description: Demo manifest
skill:
  name: my-skill
  source: ..
  profile: generic
evaluation:
  recommendedTasks:
    - generic-skill-smoke
    - workflow-route-conformance
  baselineTreatments:
    - CONTROL
  qualityGates:
    minWeightedScore: 0.8
  requiredOutputSchemas:
    - result.schema.v1
  expectedEvidence:
    - node: open
      check: output-schema:open.result.schema.v1.summary
  requiredSkills:
    - my-skill
  expectedArtifacts:
    - result.md
  generatedNodeSkills:
    - my-skill-open
    - my-skill-build
  routeConformance:
    task: workflow-route-conformance
    expectedNodeOrder:
      - open
      - build
interaction:
  mode: auto_user
  maxTurns: 8
  simulatorPrompt: Answer concisely.
  freshResumeMarker: COLD_RESUME_READY
""",
        encoding="utf-8",
    )

    manifest = load_eval_manifest(manifest_path)

    assert manifest.name == "my-skill"
    assert manifest.skill_name == "my-skill"
    assert manifest.skill_path == package.resolve()
    assert manifest.profile == "generic"
    assert manifest.recommended_tasks == ["generic-skill-smoke", "workflow-route-conformance"]
    assert manifest.baseline_treatments == ["CONTROL"]
    assert manifest.quality_gates == {"minWeightedScore": 0.8}
    assert manifest.required_output_schemas == ["result.schema.v1"]
    assert manifest.expected_evidence == [
        {"node": "open", "check": "output-schema:open.result.schema.v1.summary"}
    ]
    assert manifest.required_skills == ["my-skill"]
    assert manifest.expected_artifacts == ["result.md"]
    assert manifest.generated_node_skills == ["my-skill-open", "my-skill-build"]
    assert manifest.route_conformance_task == "workflow-route-conformance"
    assert manifest.route_conformance_expected_node_order == ["open", "build"]
    assert manifest.interaction.mode == "auto_user"
    assert manifest.interaction.max_turns == 8
    assert manifest.interaction.simulator_prompt == "Answer concisely."
    assert manifest.interaction.fresh_resume_marker == "COLD_RESUME_READY"


def test_load_eval_manifest_rejects_wrong_kind(tmp_path: Path):
    manifest_path = tmp_path / "eval.yaml"
    manifest_path.write_text(
        "apiVersion: comet.eval/v1alpha1\nkind: Other\nmetadata:\n  name: bad\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="SkillEvalManifest"):
        load_eval_manifest(manifest_path)


@pytest.mark.parametrize(
    ("field_yaml", "message"),
    [
        (
            "metadata:\n  name: bad\n  draftHash: not-a-hash\nskill:\n  name: bad\n",
            "metadata.draftHash",
        ),
        (
            "metadata:\n  name: bad\nskill:\n  name: bad\nevaluation:\n  baselineTreatments: CONTROL\n",
            "evaluation.baselineTreatments",
        ),
        (
            "metadata:\n  name: bad\nskill:\n  name: bad\nevaluation:\n  requiredOutputSchemas:\n    - 42\n",
            "evaluation.requiredOutputSchemas",
        ),
        (
            "metadata:\n  name: bad\nskill:\n  name: bad\nevaluation:\n  qualityGates:\n    - bad\n",
            "evaluation.qualityGates",
        ),
        (
            "metadata:\n  name: bad\nskill:\n  name: bad\nevaluation:\n  expectedEvidence:\n    - missing-node\n",
            "evaluation.expectedEvidence",
        ),
    ],
)
def test_load_eval_manifest_rejects_malformed_structured_fields(
    tmp_path: Path,
    field_yaml: str,
    message: str,
):
    manifest_path = tmp_path / "eval.yaml"
    manifest_path.write_text(
        f"apiVersion: comet.eval/v1alpha1\nkind: SkillEvalManifest\n{field_yaml}",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=message):
        load_eval_manifest(manifest_path)
