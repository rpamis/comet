"""The sole, import-safe authority for Eval task selection."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from scaffold.python.eval_context import ResolvedEvalContext
from scaffold.python.execution import ResolvedExecution, resolve_execution
from scaffold.python.generated_task_cache import (
    GeneratedCache,
    build_skill_snapshot,
    cache_location,
    generation_hash,
    load_generated_cache,
    selected_agent_model,
)
from scaffold.python.manifest_tasks import load_manifest_tasks
from scaffold.python.manifests import SkillEvalManifest, load_eval_manifest
from scaffold.python.tasks import Task, load_task


TaskSource = Literal[
    "explicit", "quick", "authored", "recommended", "generated-cache", "pending-generation"
]


@dataclass(frozen=True)
class GenerationPlan:
    generation_hash: str
    cache_dir: Path
    cached: GeneratedCache | None


@dataclass(frozen=True)
class ResolvedTask:
    name: str
    provenance: Literal["inline", "source", "bundled", "generated"]
    task: Task


@dataclass(frozen=True)
class ResolvedTaskSet:
    source: TaskSource
    tasks: tuple[ResolvedTask, ...]
    generation: GenerationPlan | None


@dataclass(frozen=True)
class TaskCatalogue:
    bundled: dict[str, ResolvedTask]
    canonical: dict[str, ResolvedTask]
    authored: dict[str, ResolvedTask]


def _bundled(tasks_dir: Path) -> dict[str, ResolvedTask]:
    result: dict[str, ResolvedTask] = {}
    canonical: dict[str, str] = {}
    if not tasks_dir.is_dir():
        return result
    for directory in sorted(path for path in tasks_dir.iterdir() if path.is_dir()):
        if not (directory / "task.toml").is_file() or not (directory / "instruction.md").is_file():
            continue
        task = load_task(directory, tasks_dir=tasks_dir)
        if task.name in canonical:
            raise ValueError(
                f'bundled tasks "{canonical[task.name]}" and "{directory.name}" both declare '
                f'metadata.name "{task.name}"'
            )
        canonical[task.name] = directory.name
        result[directory.name] = ResolvedTask(task.name, "bundled", task)
    return result


def build_task_catalogue(manifest: SkillEvalManifest, tasks_dir: Path) -> TaskCatalogue:
    bundled = _bundled(tasks_dir)
    canonical = {item.name: item for item in bundled.values()}
    authored_tasks = load_manifest_tasks(manifest)
    authored: dict[str, ResolvedTask] = {}
    for index, task in enumerate(authored_tasks):
        source = manifest.tasks[index]
        authored[task.name] = ResolvedTask(task.name, "inline" if source.is_inline else "source", task)
    for index, task_name in enumerate(manifest.recommended_tasks):
        if task_name not in bundled:
            raise ValueError(f'evaluation.recommendedTasks[{index}]: unknown bundled task "{task_name}"')
        if task_name in authored:
            raise ValueError(
                f'evaluation.tasks[{next(i for i, item in enumerate(manifest.tasks) if item.name == task_name)}].name '
                f'conflicts with evaluation.recommendedTasks[{index}]: "{task_name}"'
            )
    for index, spec in enumerate(manifest.tasks):
        if spec.name in canonical:
            bundle = next(key for key, item in bundled.items() if item.name == spec.name)
            raise ValueError(
                f'evaluation.tasks[{index}].name conflicts with bundled task "{bundle}": "{spec.name}"'
            )
    return TaskCatalogue(bundled, canonical, authored)


def _generated_plan(
    context: ResolvedEvalContext,
    manifest: SkillEvalManifest,
    execution: ResolvedExecution | None = None,
) -> GenerationPlan:
    snapshot = build_skill_snapshot(context.skill_root)
    resolved_execution = execution or resolve_execution(manifest=manifest.execution)
    selected_agent = resolved_execution.agent
    selected_model = resolved_execution.model or selected_agent_model(selected_agent)
    digest = generation_hash(
        snapshot,
        agent=selected_agent,
        model=selected_model,
        base_url=resolved_execution.base_url,
        profile=manifest.profile or "generic",
        interaction=vars(manifest.interaction),
    )
    cache_dir = cache_location(context.artifact_owner_root, context.skill_root, digest)
    return GenerationPlan(digest, cache_dir, load_generated_cache(cache_dir, digest))


def resolve_task_set(
    context: ResolvedEvalContext,
    manifest: SkillEvalManifest,
    catalogue: TaskCatalogue,
    *,
    explicit_task: str | None = None,
    quick: bool = False,
    static_collect: bool = False,
    execution: ResolvedExecution | None = None,
) -> ResolvedTaskSet:
    """Resolve exactly one precedence branch without probing lower branches."""
    if explicit_task:
        selected = catalogue.authored.get(explicit_task) or catalogue.bundled.get(explicit_task) or catalogue.canonical.get(explicit_task)
        if selected is None:
            available = sorted({*catalogue.authored, *catalogue.bundled, *catalogue.canonical})
            raise ValueError(f'Task not found: {explicit_task}. Available: {available}')
        return ResolvedTaskSet("explicit", (selected,), None)
    if quick:
        selected = catalogue.bundled.get("generic-skill-smoke")
        if selected is None:
            raise ValueError('Bundled quick task generic-skill-smoke is unavailable')
        return ResolvedTaskSet("quick", (selected,), None)
    if manifest.tasks:
        return ResolvedTaskSet("authored", tuple(catalogue.authored[item.name] for item in manifest.tasks), None)
    if manifest.recommended_tasks:
        return ResolvedTaskSet("recommended", tuple(catalogue.bundled[item] for item in manifest.recommended_tasks), None)
    plan = _generated_plan(context, manifest, execution)
    if plan.cached is None:
        return ResolvedTaskSet("pending-generation", (), plan)
    generated = load_eval_manifest(plan.cached.manifest_path)
    loaded = load_manifest_tasks(generated)
    names: set[str] = set()
    tasks: list[ResolvedTask] = []
    for index, task in enumerate(loaded):
        if task.name in names:
            first_index = next(
                item_index
                for item_index, item in enumerate(loaded[:index])
                if item.name == task.name
            )
            raise ValueError(
                f'generated.tasks[{index}].name duplicates '
                f'generated.tasks[{first_index}].name: "{task.name}"'
            )
        if task.name in catalogue.canonical:
            bundle = next(
                key for key, item in catalogue.bundled.items() if item.name == task.name
            )
            raise ValueError(
                f'generated.tasks[{index}].name conflicts with bundled task '
                f'"{bundle}": "{task.name}"'
            )
        names.add(task.name)
        tasks.append(ResolvedTask(task.name, "generated", task))
    return ResolvedTaskSet("generated-cache", tuple(tasks), plan)
