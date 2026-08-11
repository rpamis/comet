"""Automatic, cached generation of #250-compatible eval task manifests."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping

import yaml

from scaffold.python.agents import AgentId, validate_agent_id
from scaffold.python.eval_context import managed_path_for_owner
from scaffold.python.manifests import load_eval_manifest
from scaffold.python.utils import run_agent_in_docker


GENERATOR_VERSION = "comet-auto-task-generator.v1"
TASK_SCHEMA_VERSION = "comet.eval/v1alpha1"
MAX_SNAPSHOT_FILES = 128
MAX_SNAPSHOT_BYTES = 512 * 1024
MAX_GENERATED_TASKS = 4
MIN_GENERATED_TASKS = 2


class AutoTaskError(ValueError):
    """A task-generation failure that must not be counted as a task failure."""


@dataclass(frozen=True)
class SnapshotFile:
    path: str
    content: str
    content_hash: str


@dataclass(frozen=True)
class SkillSnapshot:
    files: tuple[SnapshotFile, ...]
    content_hash: str


@dataclass(frozen=True)
class GeneratedManifest:
    manifest_path: Path
    metadata_path: Path
    generation_hash: str
    reused: bool = False


@dataclass(frozen=True)
class GenerationOutput:
    """Generator response plus role-local overhead telemetry."""

    output: object
    telemetry: dict[str, Any]


def _sha256(value: str | bytes) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _safe_skill_root(skill_path: Path) -> Path:
    root = skill_path.resolve()
    if root.is_file() and root.name == "SKILL.md":
        root = root.parent
    if not root.is_dir() or not (root / "SKILL.md").is_file():
        raise AutoTaskError(f"Skill package must contain SKILL.md: {skill_path}")
    return root


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _add_snapshot_file(root: Path, files: dict[str, SnapshotFile], path: Path) -> None:
    if len(files) >= MAX_SNAPSHOT_FILES or not path.is_file() or not _inside(root, path):
        return
    relative = path.resolve().relative_to(root.resolve()).as_posix()
    if relative in files:
        return
    content = path.read_text(encoding="utf-8", errors="replace")
    if (
        sum(len(item.content.encode("utf-8")) for item in files.values())
        + len(content.encode("utf-8"))
        > MAX_SNAPSHOT_BYTES
    ):
        return
    files[relative] = SnapshotFile(relative, content, _sha256(content))


def build_skill_snapshot(skill_path: Path | str) -> SkillSnapshot:
    """Capture only the Skill and its bounded, relevant package context."""
    root = _safe_skill_root(Path(skill_path))
    files: dict[str, SnapshotFile] = {}
    skill_file = root / "SKILL.md"
    _add_snapshot_file(root, files, skill_file)
    skill_content = skill_file.read_text(encoding="utf-8", errors="replace")

    references = re.findall(r"[`\"']([^`\"']+)[`\"']", skill_content)
    for reference in references:
        candidate = root / reference.replace("\\", "/")
        if candidate.is_file() and _inside(root, candidate):
            _add_snapshot_file(root, files, candidate)

    for directory_name in ("scripts", "references", "reference", "examples", "templates"):
        directory = root / directory_name
        if not directory.is_dir():
            continue
        for candidate in sorted(directory.rglob("*")):
            if candidate.is_symlink() or not _inside(root, candidate):
                continue
            _add_snapshot_file(root, files, candidate)
            if len(files) >= MAX_SNAPSHOT_FILES:
                break

    ordered = tuple(files[key] for key in sorted(files))
    manifest = json.dumps(
        [{"path": item.path, "hash": item.content_hash} for item in ordered],
        sort_keys=True,
        separators=(",", ":"),
    )
    return SkillSnapshot(ordered, _sha256(manifest))


def find_project_root(skill_path: Path | str) -> Path:
    """Find a project root without scanning outside the Skill's ancestors."""
    root = _safe_skill_root(Path(skill_path))
    home = Path.home().resolve()
    for candidate in (root, *root.parents):
        if candidate.resolve() == home:
            continue
        if (candidate / ".comet").is_dir() or (candidate / ".git").exists():
            return candidate
    return root.parent


def _generation_hash(
    snapshot: SkillSnapshot,
    *,
    agent: AgentId,
    model: str | None,
    profile: str,
    interaction: dict[str, Any],
) -> str:
    payload = {
        "snapshot_hash": snapshot.content_hash,
        "agent": agent,
        "model": model or "runtime-default",
        "profile": profile,
        "interaction": interaction,
        "generator_version": GENERATOR_VERSION,
        "task_schema_version": TASK_SCHEMA_VERSION,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _cache_location(project_root: Path, skill_root: Path, generation_hash: str) -> Path:
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", skill_root.name).strip("-") or "skill"
    return managed_path_for_owner(project_root, "generated", safe_name, generation_hash)


def _atomic_write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        newline="\n",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as temporary:
        temporary.write(value)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _without_credentials(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _without_credentials(item)
            for key, item in value.items()
            if not re.search(r"(?:api[_-]?key|auth[_-]?token|password|secret|credential)", key, re.I)
        }
    if isinstance(value, list):
        return [_without_credentials(item) for item in value]
    return value


def _extract_json_payload(raw: object) -> dict[str, Any]:
    if isinstance(raw, GenerationOutput):
        raw = raw.output
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        raise AutoTaskError("task_generation: generator did not return JSON")
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    candidates = [text, *reversed(text.splitlines())]
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            stack: list[object] = [value]
            while stack:
                nested = stack.pop()
                if isinstance(nested, dict):
                    if isinstance(nested.get("tasks"), list):
                        return nested
                    stack.extend(nested.values())
                elif isinstance(nested, list):
                    stack.extend(nested)
                elif isinstance(nested, str):
                    try:
                        decoded = json.loads(nested)
                    except json.JSONDecodeError:
                        continue
                    stack.append(decoded)
    raise AutoTaskError("task_generation: generator output was not a JSON task object")


def _validate_generated_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    tasks = payload.get("tasks")
    if not isinstance(tasks, list) or not MIN_GENERATED_TASKS <= len(tasks) <= MAX_GENERATED_TASKS:
        raise AutoTaskError(
            f"task_generation: generated tasks must contain {MIN_GENERATED_TASKS}-{MAX_GENERATED_TASKS} tasks"
        )
    names: set[str] = set()
    for index, task in enumerate(tasks):
        if not isinstance(task, dict):
            raise AutoTaskError(f"task_generation: tasks[{index}] must be a mapping")
        if set(task) - {"name", "prompt", "workspace", "expect", "rubric"}:
            raise AutoTaskError(f"task_generation: tasks[{index}] contains unsupported fields")
        name = task.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", name):
            raise AutoTaskError(f"task_generation: tasks[{index}].name is invalid")
        if name in names:
            raise AutoTaskError(f"task_generation: duplicate task name: {name}")
        names.add(name)
        if not isinstance(task.get("prompt"), str) or not task["prompt"].strip():
            raise AutoTaskError(f"task_generation: tasks[{index}].prompt is required")
        if not isinstance(task.get("expect"), dict):
            raise AutoTaskError(f"task_generation: tasks[{index}].expect is required")
        if task.get("workspace") is not None and not isinstance(task["workspace"], str):
            raise AutoTaskError(f"task_generation: tasks[{index}].workspace must be a path")
        if task.get("rubric") is not None and (
            not isinstance(task["rubric"], list)
            or not all(isinstance(item, str) and item.strip() for item in task["rubric"])
        ):
            raise AutoTaskError(f"task_generation: tasks[{index}].rubric is invalid")
    return tasks


def _manifest_source(
    skill_root: Path,
    skill_name: str,
    profile: str,
    generation_hash: str,
    tasks: list[dict[str, Any]],
) -> str:
    return yaml.safe_dump(
        {
            "apiVersion": TASK_SCHEMA_VERSION,
            "kind": "SkillEvalManifest",
            "metadata": {
                "name": skill_name,
                "generationHash": generation_hash,
                "generationFile": "generation.json",
            },
            "skill": {"name": skill_name, "source": str(skill_root), "profile": profile},
            "evaluation": {"tasks": tasks},
        },
        sort_keys=False,
        allow_unicode=True,
    )


def _generation_prompt(snapshot: SkillSnapshot, *, profile: str, repair: str | None = None) -> str:
    files = "\n\n".join(
        f"FILE: {item.path}\nHASH: {item.content_hash}\n{item.content}" for item in snapshot.files
    )
    repair_text = f"\nRepair the previous output because: {repair}\n" if repair else ""
    return f"""You are Comet's task-generator session. Generate only JSON and no Markdown.
Produce {MIN_GENERATED_TASKS}-{MAX_GENERATED_TASKS} adaptive Skill evaluation tasks for profile {profile!r}.
Each task must have a unique name, a concrete prompt, and at least one deterministic #250 expect
from files, contains, json, or commands. Rubric is optional. Do not invent source task packages.
Use only paths visible in the bounded Skill snapshot. Return exactly:
{{"tasks":[{{"name":"...","prompt":"...","expect":{{...}},"rubric":["..."]}}]}}
{repair_text}
Bounded Skill snapshot:
{files}
"""


def _default_generate(prompt: str, *, agent: AgentId, model: str | None) -> GenerationOutput:
    from scaffold.python.manifest_tasks import _generic_environment_dir
    from scaffold.python.logging import extract_events, parse_output

    with tempfile.TemporaryDirectory(prefix="comet-task-generator-") as directory:
        workdir = Path(directory)
        shutil.copytree(_generic_environment_dir(), workdir, dirs_exist_ok=True)
        started = time.monotonic()
        result = run_agent_in_docker(workdir, prompt, agent=agent, model=model, timeout=300)
        elapsed = time.monotonic() - started
        if result.returncode != 0:
            raise AutoTaskError(
                f"task_generation: generator agent failed ({result.returncode}): "
                f"{(result.stderr or result.stdout or '')[-1000:]}"
            )
        stdout = result.stdout or ""
        events = extract_events(parse_output(stdout))
        return GenerationOutput(
            stdout,
            {
                "duration_seconds": events.get("duration_seconds") or elapsed,
                "input_tokens": events.get("input_tokens"),
                "output_tokens": events.get("output_tokens"),
                "total_tokens": events.get("total_tokens"),
                "total_cost_usd": events.get("total_cost_usd"),
                "model_usage": events.get("model_usage") or {},
                "model": model or "runtime-default",
            },
        )


def _manifest_hash_matches(manifest_path: Path, metadata: Mapping[str, Any]) -> bool:
    expected = metadata.get("manifest_hash")
    if not isinstance(expected, str):
        return False
    try:
        return _sha256(manifest_path.read_bytes()) == expected
    except OSError:
        return False


def _load_cached(cache_dir: Path, generation_hash: str) -> GeneratedManifest | None:
    manifest_path = cache_dir / "eval.yaml"
    metadata_path = cache_dir / "generation.json"
    if not manifest_path.is_file() or not metadata_path.is_file():
        return None
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("generation_hash") != generation_hash or not _manifest_hash_matches(
            manifest_path, metadata
        ):
            return None
        load_eval_manifest(manifest_path)
    except (OSError, ValueError, json.JSONDecodeError, TypeError):
        return None
    return GeneratedManifest(manifest_path, metadata_path, generation_hash, reused=True)


@contextmanager
def _generation_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as lock_file:
        if os.name == "nt":
            import msvcrt

            if lock_file.seek(0, os.SEEK_END) == 0:
                lock_file.write(b"0")
                lock_file.flush()
            lock_file.seek(0)
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _merge_generation_telemetry(attempts: list[dict[str, Any]]) -> dict[str, Any]:
    def total(key: str) -> int | float | None:
        values = [item[key] for item in attempts if isinstance(item.get(key), (int, float))]
        return sum(values) if values else None

    merged_models: dict[str, dict[str, int | float]] = {}
    for attempt in attempts:
        for model_name, usage in (attempt.get("model_usage") or {}).items():
            if not isinstance(model_name, str) or not isinstance(usage, dict):
                continue
            target = merged_models.setdefault(model_name, {})
            for key, value in usage.items():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    target[key] = target.get(key, 0) + value
    return {
        "attempt_count": len(attempts),
        "duration_seconds": total("duration_seconds"),
        "input_tokens": total("input_tokens"),
        "output_tokens": total("output_tokens"),
        "total_tokens": total("total_tokens"),
        "total_cost_usd": total("total_cost_usd"),
        "model_usage": merged_models,
        "attempts": attempts,
    }


def ensure_generated_manifest(
    skill_path: Path | str,
    project_root: Path | str,
    *,
    agent: object,
    model: str | None,
    profile: str,
    interaction: dict[str, Any],
    collect_only: bool = False,
    generate: Callable[[str], object] | None = None,
) -> GeneratedManifest:
    """Return a valid frozen generated manifest, or generate it once and cache it."""
    selected_agent = validate_agent_id(agent, field="task-generator agent")
    skill_root = _safe_skill_root(Path(skill_path))
    snapshot = build_skill_snapshot(skill_root)
    generation_hash = _generation_hash(
        snapshot,
        agent=selected_agent,
        model=model,
        profile=profile,
        interaction=interaction,
    )
    cache_dir = _cache_location(Path(project_root), skill_root, generation_hash)
    cached = _load_cached(cache_dir, generation_hash)
    if cached:
        return cached
    if collect_only:
        raise AutoTaskError(
            "No cached generated eval manifest exists; run comet eval <skill> once to generate and execute tasks"
        )

    cache_dir.parent.mkdir(parents=True, exist_ok=True)
    lock_path = managed_path_for_owner(
        project_root, "locks", f"generated-{generation_hash}.lock"
    )
    with _generation_lock(lock_path):
        cached = _load_cached(cache_dir, generation_hash)
        if cached:
            return cached

        generator = generate or (
            lambda prompt: _default_generate(prompt, agent=selected_agent, model=model)
        )
        error: str | None = None
        tasks: list[dict[str, Any]] | None = None
        attempts: list[dict[str, Any]] = []
        for attempt in range(2):
            try:
                generated = generator(_generation_prompt(snapshot, profile=profile, repair=error))
                if isinstance(generated, GenerationOutput):
                    raw_output = generated.output
                    telemetry = dict(generated.telemetry)
                else:
                    raw_output = generated
                    telemetry = {}
                telemetry.setdefault("model", model or "runtime-default")
                telemetry["attempt"] = attempt + 1
                attempts.append(telemetry)
                payload = _extract_json_payload(raw_output)
                tasks = _validate_generated_payload(payload)
                manifest_source = _manifest_source(
                    skill_root, skill_root.name, profile, generation_hash, tasks
                )
                with tempfile.NamedTemporaryFile(
                    mode="w", suffix=".yaml", encoding="utf-8", delete=False
                ) as candidate:
                    candidate.write(manifest_source)
                    candidate_path = Path(candidate.name)
                try:
                    load_eval_manifest(candidate_path)
                finally:
                    candidate_path.unlink(missing_ok=True)
                break
            except (AutoTaskError, OSError, ValueError, yaml.YAMLError) as exc:
                error = str(exc)
                tasks = None
        if tasks is None:
            raise AutoTaskError(error or "task_generation: generated manifest is invalid")

        manifest_source = _manifest_source(
            skill_root, skill_root.name, profile, generation_hash, tasks
        )
        metadata = {
            "schema": "comet.eval.generation.v1",
            "generation_hash": generation_hash,
            "generator_version": GENERATOR_VERSION,
            "task_schema_version": TASK_SCHEMA_VERSION,
            "skill_snapshot_hash": snapshot.content_hash,
            "skill_path": str(skill_root),
            "agent": selected_agent,
            "model": model or "runtime-default",
            "profile": profile,
            "interaction": _without_credentials(interaction),
            "manifest_hash": _sha256(manifest_source),
            "generation_overhead": _merge_generation_telemetry(attempts),
        }
        stage_dir = Path(tempfile.mkdtemp(dir=str(cache_dir.parent), prefix=f".{generation_hash}-"))
        try:
            _atomic_write_text(stage_dir / "eval.yaml", manifest_source)
            _atomic_write_text(
                stage_dir / "generation.json", json.dumps(_without_credentials(metadata), indent=2, sort_keys=True) + "\n"
            )
            if cache_dir.exists():
                retired_dir = cache_dir.with_name(f".{cache_dir.name}.{time.time_ns()}.retired")
                os.replace(cache_dir, retired_dir)
            else:
                retired_dir = None
            os.replace(stage_dir, cache_dir)
            stage_dir = None  # type: ignore[assignment]
            if retired_dir is not None:
                shutil.rmtree(retired_dir, ignore_errors=True)
        finally:
            if stage_dir is not None:
                shutil.rmtree(stage_dir, ignore_errors=True)
        return GeneratedManifest(
            cache_dir / "eval.yaml", cache_dir / "generation.json", generation_hash
        )
