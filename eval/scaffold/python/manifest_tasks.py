"""Normalize project-authored manifest tasks into the existing Task contract."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from scaffold.python.manifests import ManifestTask, SkillEvalManifest
from scaffold.python.paths import EVAL_ROOT, get_tasks_dir
from scaffold.python.tasks import (
    EvaluationConfig,
    Task,
    TaskConfig,
    ValidationConfig,
    load_task_from_path,
)


def _generic_environment_dir() -> Path:
    candidates = (
        get_tasks_dir() / "generic-skill-smoke" / "environment",
        EVAL_ROOT / "local" / "tasks" / "generic-skill-smoke" / "environment",
    )
    for candidate in candidates:
        if (candidate / "Dockerfile").is_file():
            return candidate
    raise FileNotFoundError("Bundled generic task environment is unavailable")


def _inline_task(manifest: SkillEvalManifest, spec: ManifestTask) -> Task:
    assert spec.prompt is not None
    files = list(spec.expect.get("files", []))
    config = TaskConfig(
        name=spec.name,
        description=f"Inline task authored in {manifest.path}",
        default_treatments=[],
        timeout_sec=900,
        validation=ValidationConfig(target_artifacts=files, timeout=120),
        evaluation=EvaluationConfig(
            profile=manifest.profile or "generic",
            expected_artifacts=files,
            rubric_criteria=list(spec.rubric),
        ),
        interaction=manifest.interaction,
    )
    return Task(
        path=manifest.path.parent,
        config=config,
        instruction_template=spec.prompt,
        _environment_dir=_generic_environment_dir(),
        workspace_dir=spec.workspace,
        manifest_expectations=spec.expect,
        manifest_path=manifest.path,
    )


def load_manifest_tasks(manifest: SkillEvalManifest) -> list[Task]:
    """Load all authored inline/source task entries in manifest order."""
    tasks: list[Task] = []
    for spec in manifest.tasks:
        task = _inline_task(manifest, spec) if spec.is_inline else load_task_from_path(spec.source)
        # ``evaluation.tasks[].name`` is the public identity, including for a
        # sourced package whose internal metadata name differs.  Keep the full
        # package semantics loaded by ``load_task_from_path`` while applying
        # the manifest alias consistently to catalogue, selection, and reports.
        if task.name != spec.name:
            task = replace(task, config=replace(task.config, name=spec.name))
        tasks.append(task)
    return tasks
