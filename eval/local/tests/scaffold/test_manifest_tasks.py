"""Tests for normalizing manifest-authored tasks into the runner contract."""

from pathlib import Path

from scaffold.python.manifest_tasks import load_manifest_tasks
from scaffold.python.manifests import load_eval_manifest


def test_inline_task_uses_generic_environment_and_exposes_normalized_contract(tmp_path: Path):
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
    - name: inline-task
      prompt: Create result.md.
      expect:
        files: [result.md]
      rubric:
        - The result is useful.
""",
        encoding="utf-8",
    )

    tasks = load_manifest_tasks(load_eval_manifest(manifest_path))

    assert len(tasks) == 1
    task = tasks[0]
    assert task.name == "inline-task"
    assert task.render_prompt() == "Create result.md."
    assert task.environment_dir.is_dir()
    assert task.config.evaluation.expected_artifacts == ["result.md"]
    assert task.config.evaluation.rubric_criteria == ["The result is useful."]


def test_source_task_is_loaded_without_changing_its_task_contract(tmp_path: Path):
    package = tmp_path / "my-skill"
    source = package / "tasks" / "source-task"
    (source / "environment").mkdir(parents=True)
    (source / "task.toml").write_text(
        '[metadata]\nname = "source-task"\n\n[environment]\ndockerfile = "Dockerfile"\n',
        encoding="utf-8",
    )
    (source / "instruction.md").write_text("Source prompt\n", encoding="utf-8")
    (source / "environment" / "Dockerfile").write_text("FROM alpine\n", encoding="utf-8")
    manifest_path = package / "comet" / "eval.yaml"
    manifest_path.parent.mkdir(parents=True)
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
    - source: ./tasks/source-task
""",
        encoding="utf-8",
    )

    tasks = load_manifest_tasks(load_eval_manifest(manifest_path))

    assert [task.name for task in tasks] == ["source-task"]
    assert tasks[0].render_prompt() == "Source prompt\n"
