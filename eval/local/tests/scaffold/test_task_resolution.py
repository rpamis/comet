"""Contract tests for the single static task-resolution authority."""

from __future__ import annotations

from pathlib import Path

import pytest

from scaffold.python.auto_tasks import ensure_generated_manifest
from scaffold.python.eval_context import resolve_eval_context
from scaffold.python.execution import resolve_execution
from scaffold.python.manifests import load_eval_manifest
from scaffold.python.task_resolution import build_task_catalogue, resolve_task_set


def _bundled_task(root: Path, directory: str, name: str | None = None) -> None:
    task = root / directory
    (task / "environment").mkdir(parents=True)
    (task / "task.toml").write_text(
        f'[metadata]\nname = "{name or directory}"\n\n[environment]\ndockerfile = "Dockerfile"\n',
        encoding="utf-8",
    )
    (task / "instruction.md").write_text("Do it.\n", encoding="utf-8")
    (task / "environment" / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")


def _manifest(tmp_path: Path, evaluation: str) -> tuple[Path, object]:
    skill = tmp_path / "skill"
    (skill / "comet").mkdir(parents=True)
    (skill / "SKILL.md").write_text("# Skill\n", encoding="utf-8")
    manifest_path = skill / "comet" / "eval.yaml"
    manifest_path.write_text(
        "\n".join(
            [
                "apiVersion: comet.eval/v1alpha1",
                "kind: SkillEvalManifest",
                "metadata:",
                "  name: skill",
                "skill:",
                "  name: skill",
                "  source: ..",
                *(["evaluation:", *[f"  {line}" for line in evaluation.splitlines()]] if evaluation else []),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return manifest_path, load_eval_manifest(manifest_path)


def test_resolution_precedence_is_explicit_then_quick_then_authored_then_recommended(
    tmp_path: Path,
):
    tasks_dir = tmp_path / "bundled"
    _bundled_task(tasks_dir, "generic-skill-smoke")
    _bundled_task(tasks_dir, "recommended")
    manifest_path, manifest = _manifest(
        tmp_path,
        "\n".join(
            [
                "tasks:",
                "  - name: authored",
                "    prompt: Write result.md.",
                "    expect:",
                "      files: [result.md]",
                "recommendedTasks: [recommended]",
            ]
        ),
    )
    context = resolve_eval_context(manifest_path=manifest_path)
    catalogue = build_task_catalogue(manifest, tasks_dir)

    assert [
        task.name
        for task in resolve_task_set(
            context, manifest, catalogue, explicit_task="authored", quick=True
        ).tasks
    ] == ["authored"]
    assert resolve_task_set(context, manifest, catalogue, quick=True).source == "quick"
    assert [task.name for task in resolve_task_set(context, manifest, catalogue, quick=True).tasks] == [
        "generic-skill-smoke"
    ]
    resolved = resolve_task_set(context, manifest, catalogue)
    assert resolved.source == "authored"
    assert [task.name for task in resolved.tasks] == ["authored"]


def test_recommended_branch_and_pending_generation_do_not_merge_or_load_cache(tmp_path: Path):
    tasks_dir = tmp_path / "bundled"
    _bundled_task(tasks_dir, "generic-skill-smoke")
    _bundled_task(tasks_dir, "recommended")
    manifest_path, manifest = _manifest(tmp_path, "recommendedTasks: [recommended]")
    context = resolve_eval_context(manifest_path=manifest_path)
    catalogue = build_task_catalogue(manifest, tasks_dir)

    recommended = resolve_task_set(context, manifest, catalogue, static_collect=True)
    assert recommended.source == "recommended"
    assert [task.name for task in recommended.tasks] == ["recommended"]

    manifest_path, empty_manifest = _manifest(tmp_path / "empty", "")
    empty_context = resolve_eval_context(manifest_path=manifest_path)
    pending = resolve_task_set(
        empty_context,
        empty_manifest,
        build_task_catalogue(empty_manifest, tasks_dir),
        static_collect=True,
    )
    assert pending.source == "pending-generation"
    assert pending.tasks == ()
    assert pending.generation is not None


def test_catalogue_rejects_duplicate_sources_with_exact_diagnostics(tmp_path: Path):
    tasks_dir = tmp_path / "bundled"
    _bundled_task(tasks_dir, "first", "same")
    _bundled_task(tasks_dir, "second", "same")
    manifest_path, manifest = _manifest(tmp_path, "")

    with pytest.raises(
        ValueError,
        match='bundled tasks "first" and "second" both declare metadata.name "same"',
    ):
        build_task_catalogue(manifest, tasks_dir)


def test_catalogue_rejects_authored_and_recommended_conflict(tmp_path: Path):
    tasks_dir = tmp_path / "bundled"
    _bundled_task(tasks_dir, "generic-skill-smoke")
    _manifest_path, manifest = _manifest(
        tmp_path,
        "\n".join(
            [
                "tasks:",
                "  - name: generic-skill-smoke",
                "    prompt: Write result.md.",
                "    expect:",
                "      files: [result.md]",
                "recommendedTasks: [generic-skill-smoke]",
            ]
        ),
    )

    with pytest.raises(
        ValueError,
        match='evaluation.tasks\\[0\\].name conflicts with evaluation.recommendedTasks\\[0\\]: "generic-skill-smoke"',
    ):
        build_task_catalogue(manifest, tasks_dir)


def test_resolution_reuses_normal_generation_cache_with_default_interaction(tmp_path: Path):
    tasks_dir = tmp_path / "bundled"
    tasks_dir.mkdir()
    manifest_path, manifest = _manifest(tmp_path, "")
    context = resolve_eval_context(manifest_path=manifest_path)
    ensure_generated_manifest(
        context.skill_root,
        context.artifact_owner_root,
        agent="claude-code",
        model=None,
        profile="generic",
        interaction={"mode": "none", "max_turns": 12},
        generate=lambda _prompt: {
            "tasks": [
                {
                    "name": "generated-one",
                    "prompt": "one",
                    "expect": {"files": ["one.md"]},
                },
                {
                    "name": "generated-two",
                    "prompt": "two",
                    "expect": {"files": ["two.md"]},
                },
            ]
        },
    )

    resolved = resolve_task_set(
        context,
        manifest,
        build_task_catalogue(manifest, tasks_dir),
        static_collect=True,
    )

    assert resolved.source == "generated-cache"
    assert [task.name for task in resolved.tasks] == ["generated-one", "generated-two"]


def test_generation_plan_uses_cli_execution_identity(tmp_path: Path):
    tasks_dir = tmp_path / "bundled"
    tasks_dir.mkdir()
    manifest_path, manifest = _manifest(tmp_path, "")
    context = resolve_eval_context(manifest_path=manifest_path)
    catalogue = build_task_catalogue(manifest, tasks_dir)

    default_plan = resolve_task_set(context, manifest, catalogue, static_collect=True).generation
    cli_plan = resolve_task_set(
        context,
        manifest,
        catalogue,
        static_collect=True,
        execution=resolve_execution(
            cli_agent="codex",
            cli_model="subject-model",
            cli_base_url="https://subject.example/v1",
        ),
    ).generation

    assert default_plan is not None
    assert cli_plan is not None
    assert cli_plan.generation_hash != default_plan.generation_hash
    assert cli_plan.cache_dir != default_plan.cache_dir
