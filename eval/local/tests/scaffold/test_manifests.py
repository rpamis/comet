"""Tests for generated Skill eval manifest loading."""

from pathlib import Path

import re

import pytest

from scaffold.python.manifests import load_eval_manifest
from scaffold.python.manifest_tasks import load_manifest_tasks


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
execution:
  agent: codex
  model: gpt-main
  baseUrl: https://main.example.com/v1
judge:
  agent: claude-code
  model: claude-judge
  baseUrl: https://judge.example.com
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
    assert manifest.execution_agent == "codex"
    assert manifest.execution.model == "gpt-main"
    assert manifest.execution.base_url == "https://main.example.com/v1"
    assert manifest.judge is not None
    assert manifest.judge.agent == "claude-code"
    assert manifest.judge.model == "claude-judge"
    assert manifest.judge.base_url == "https://judge.example.com"
    assert manifest.raw["execution"]["model"] == "gpt-main"
    assert manifest.raw["judge"]["model"] == "claude-judge"


def test_load_eval_manifest_normalizes_snake_case_aliases(tmp_path: Path):
    package = tmp_path / "my-skill"
    (package / "comet").mkdir(parents=True)
    manifest_path = package / "comet" / "eval.yaml"
    manifest_path.write_text(
        """
apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata:
  name: my-skill
  draft_hash: '0000000000000000000000000000000000000000000000000000000000000000'
  generation_hash: generated
skill:
  name: my-skill
  source: ..
evaluation:
  recommended_tasks: [generic-skill-smoke]
  required_skills: [my-skill]
  expected_artifacts: [result.md]
  generated_node_skills: [my-skill-open]
  route_conformance:
    task: generic-skill-smoke
    expected_node_order: [open, build]
interaction:
  max_turns: 4
  simulator_prompt: Answer.
  fresh_resume_marker: READY
execution:
  base_url: https://main.example.com
judge:
  model: judge-model
  base_url: https://judge.example.com
""",
        encoding="utf-8",
    )

    manifest = load_eval_manifest(manifest_path)

    assert manifest.draft_hash == "0" * 64
    assert manifest.generation_hash == "generated"
    assert manifest.recommended_tasks == ["generic-skill-smoke"]
    assert manifest.required_skills == ["my-skill"]
    assert manifest.expected_artifacts == ["result.md"]
    assert manifest.generated_node_skills == ["my-skill-open"]
    assert manifest.route_conformance_expected_node_order == ["open", "build"]
    assert manifest.interaction.max_turns == 4
    assert manifest.interaction.simulator_prompt == "Answer."
    assert manifest.interaction.fresh_resume_marker == "READY"
    assert manifest.execution.base_url == "https://main.example.com"
    assert manifest.judge is not None
    assert manifest.judge.base_url == "https://judge.example.com"


def test_load_eval_manifest_rejects_wrong_kind(tmp_path: Path):
    manifest_path = tmp_path / "eval.yaml"
    manifest_path.write_text(
        "apiVersion: comet.eval/v1alpha1\nkind: Other\nmetadata:\n  name: bad\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="SkillEvalManifest"):
        load_eval_manifest(manifest_path)


@pytest.mark.parametrize(
    ("section", "message"),
    [
        ("metadata:\n  draftHash: one\n  draft_hash: two", "metadata.draftHash"),
        (
            "evaluation:\n  recommendedTasks: [one]\n  recommended_tasks: [two]",
            "evaluation.recommendedTasks",
        ),
        (
            "execution:\n  baseUrl: https://main.example\n  base_url: https://other.example",
            "execution.baseUrl",
        ),
    ],
)
def test_load_eval_manifest_rejects_conflicting_aliases(
    tmp_path: Path, section: str, message: str
):
    manifest_path = tmp_path / "eval.yaml"
    manifest_path.write_text(
        "apiVersion: comet.eval/v1alpha1\n"
        "kind: SkillEvalManifest\n"
        "metadata:\n  name: demo\n"
        "skill:\n  name: demo\n"
        f"{section}\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=re.escape(message)):
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
        (
            "metadata:\n  name: bad\nskill:\n  name: bad\nexecution:\n  agent: gemini\n",
            "Unsupported evaluation agent",
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


def test_load_eval_manifest_parses_inline_and_source_tasks(tmp_path: Path):
    package = tmp_path / "my-skill"
    package.mkdir()
    (package / "SKILL.md").write_text("# Skill\n", encoding="utf-8")
    fixtures = package / "fixtures"
    fixtures.mkdir()
    (fixtures / "input.txt").write_text("input\n", encoding="utf-8")

    source_task = package / "tasks" / "advanced"
    (source_task / "environment").mkdir(parents=True)
    (source_task / "validation").mkdir()
    (source_task / "task.toml").write_text(
        '[metadata]\nname = "advanced"\n\n[environment]\ndockerfile = "Dockerfile"\n',
        encoding="utf-8",
    )
    (source_task / "instruction.md").write_text("Advanced task\n", encoding="utf-8")
    (source_task / "environment" / "Dockerfile").write_text("FROM alpine\n", encoding="utf-8")

    manifest_path = package / "comet" / "eval.yaml"
    manifest_path.parent.mkdir()
    manifest_path.write_text(
        """
apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata:
  name: my-skill
skill:
  name: my-skill
  source: ..
evaluation:
  tasks:
    - name: create-summary
      prompt: Create summary.md.
      workspace: ./fixtures
      expect:
        files:
          - summary.md
        contains:
          summary.md:
            - "# Summary"
        json:
          - file: summary.json
            path: $.status
            equals: complete
        commands:
          - run: test -f summary.md
            timeout: 30
      rubric:
        - The summary explains the result.
    - name: advanced-alias
      source: ./tasks/advanced
""",
        encoding="utf-8",
    )

    manifest = load_eval_manifest(manifest_path)

    assert [task.name for task in manifest.tasks] == ["create-summary", "advanced-alias"]
    inline = manifest.tasks[0]
    assert inline.prompt == "Create summary.md."
    assert inline.workspace == fixtures.resolve()
    assert inline.expect["files"] == ["summary.md"]
    assert inline.rubric == ["The summary explains the result."]
    assert manifest.tasks[1].source == source_task.resolve()
    assert [task.name for task in load_manifest_tasks(manifest)] == [
        "create-summary",
        "advanced-alias",
    ]


@pytest.mark.parametrize(
    ("task_yaml", "message"),
    [
        (
            "- name: missing-prompt\n  expect:\n    files: [result.md]\n",
            "prompt",
        ),
        (
            "- name: no-expect\n  prompt: Do it.\n",
                "expect: is required",
        ),
        (
            "- name: unsafe\n  prompt: Do it.\n  expect:\n    files: [../secret]\n",
            "evaluation.tasks.*.expect.files",
        ),
        (
            "- name: unsafe\n  prompt: Do it.\n  workspace: ../outside\n  expect:\n    files: [result.md]\n",
            "workspace",
        ),
        (
            "- name: unknown\n  prompt: Do it.\n  expect:\n    files: [result.md]\n  executable: true\n",
            "unknown field",
        ),
    ],
)
def test_load_eval_manifest_rejects_invalid_inline_tasks(
    tmp_path: Path,
    task_yaml: str,
    message: str,
):
    package = tmp_path / "my-skill"
    (package / "comet").mkdir(parents=True)
    manifest_path = package / "comet" / "eval.yaml"
    manifest_path.write_text(
        "apiVersion: comet.eval/v1alpha1\n"
        "kind: SkillEvalManifest\n"
        "metadata:\n  name: my-skill\n"
        "skill:\n  name: my-skill\n  source: ..\n"
        "evaluation:\n  tasks:\n"
        + "".join(f"    {line}\n" for line in task_yaml.rstrip().splitlines()),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=message):
        load_eval_manifest(manifest_path)


def test_load_eval_manifest_rejects_duplicate_authored_task_names(tmp_path: Path):
    package = tmp_path / "my-skill"
    (package / "comet").mkdir(parents=True)
    manifest_path = package / "comet" / "eval.yaml"
    manifest_path.write_text(
        """
apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata:
  name: my-skill
skill:
  name: my-skill
  source: ..
evaluation:
  tasks:
    - name: duplicate
      prompt: First.
      expect:
        files: [one.txt]
    - name: duplicate
      prompt: Second.
      expect:
        files: [two.txt]
""",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="duplicates evaluation.tasks"):
        load_eval_manifest(manifest_path)


def test_load_eval_manifest_rejects_duplicate_recommended_task_names(tmp_path: Path):
    manifest_path = tmp_path / "eval.yaml"
    manifest_path.write_text(
        "apiVersion: comet.eval/v1alpha1\n"
        "kind: SkillEvalManifest\n"
        "metadata: {name: my-skill}\n"
        "skill: {name: my-skill, source: .}\n"
        "evaluation:\n"
        "  recommendedTasks: [generic-skill-smoke, generic-skill-smoke]\n",
        encoding="utf-8",
    )

    with pytest.raises(
        ValueError,
        match=re.escape(
            'evaluation.recommendedTasks[1] duplicates '
            'evaluation.recommendedTasks[0]: "generic-skill-smoke"'
        ),
    ):
        load_eval_manifest(manifest_path)


@pytest.mark.parametrize(
    ("section", "message"),
    [
        ("execution:\n  model: '   '\n", "execution.model"),
        ("execution:\n  baseUrl: ftp://main.example.com\n", "execution.baseUrl"),
        ("judge:\n  agent: codex\n", "judge.model"),
        ("judge:\n  model: '   '\n", "judge.model"),
        (
            "judge:\n  agent: unknown-agent\n  model: judge-model\n",
            "manifest judge.agent",
        ),
        (
            "judge:\n  model: judge-model\n  baseUrl: relative/path\n",
            "judge.baseUrl",
        ),
    ],
)
def test_manifest_rejects_invalid_preserved_execution_and_judge_fields(
    tmp_path: Path, section: str, message: str
):
    manifest_path = tmp_path / "eval.yaml"
    manifest_path.write_text(
        "apiVersion: comet.eval/v1alpha1\n"
        "kind: SkillEvalManifest\n"
        "metadata: {name: my-skill}\n"
        "skill: {name: my-skill, source: .}\n"
        + section,
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=re.escape(message)):
        load_eval_manifest(manifest_path)


@pytest.mark.parametrize(
    ("yaml_fragment", "message"),
    [
        ("unknownTopLevel: true\n", "unknownTopLevel: unknown field"),
        ("evaluation:\n  unknownFlag: true\n", "evaluation.unknownFlag: unknown field"),
        ("execution:\n  unknownFlag: true\n", "execution.unknownFlag: unknown field"),
        (
            "judge:\n  model: judge-model\n  unknownFlag: true\n",
            "judge.unknownFlag: unknown field",
        ),
        ("reporting:\n  unknownFlag: true\n", "reporting.unknownFlag: unknown field"),
        ("interaction:\n  unknownFlag: true\n", "interaction.unknownFlag: unknown field"),
        (
            "evaluation:\n"
            "  tasks:\n"
            "    - name: exact\n"
            "      prompt: Write result.md.\n"
            "      expect: {files: [result.md]}\n"
            "      unknownFlag: true\n",
            "evaluation.tasks[0].unknownFlag: unknown field",
        ),
    ],
)
def test_schema_rejects_unknown_fields_with_yaml_paths(tmp_path: Path, yaml_fragment: str, message: str):
    manifest_path = tmp_path / "eval.yaml"
    manifest_path.write_text(
        "apiVersion: comet.eval/v1alpha1\n"
        "kind: SkillEvalManifest\n"
        "metadata:\n"
        "  name: my-skill\n"
        "skill:\n"
        "  name: my-skill\n"
        "  source: .\n"
        + yaml_fragment,
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=re.escape(message)):
        load_eval_manifest(manifest_path)


@pytest.mark.parametrize(
    ("fragment", "message"),
    [
        ("interaction: null\n", "interaction: None is not of type 'object'"),
        ("evaluation: []\n", "evaluation: [] is not of type 'object'"),
        ("execution: invalid\n", "execution: 'invalid' is not of type 'object'"),
    ],
)
def test_schema_rejects_explicit_non_mapping_sections(
    tmp_path: Path, fragment: str, message: str
):
    manifest_path = tmp_path / "eval.yaml"
    manifest_path.write_text(
        "apiVersion: comet.eval/v1alpha1\nkind: SkillEvalManifest\nmetadata: {name: my-skill}\nskill: {name: my-skill, source: .}\n"
        + fragment,
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=re.escape(message)):
        load_eval_manifest(manifest_path)


def test_schema_declared_interaction_fields_are_normalized(tmp_path: Path):
    manifest_path = tmp_path / "eval.yaml"
    manifest_path.write_text(
        """apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata: {name: my-skill}
skill: {name: my-skill, source: .}
interaction:
  decisionPatterns: [confirm]
  decisionReply: "yes"
  decisionReplies: [first, second]
  continuePrompt: Keep going.
""",
        encoding="utf-8",
    )
    interaction = load_eval_manifest(manifest_path).interaction
    assert interaction.decision_patterns == ["confirm"]
    assert interaction.decision_reply == "yes"
    assert interaction.decision_replies == ["first", "second"]
    assert interaction.continue_prompt == "Keep going."
