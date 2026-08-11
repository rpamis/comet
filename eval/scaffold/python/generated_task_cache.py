"""Import-safe generated-task snapshot and cache selection primitives."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from scaffold.python.agents import get_agent_adapter
from scaffold.python.eval_context import managed_path_for_owner
from scaffold.python.manifests import load_eval_manifest


GENERATOR_VERSION = "comet-auto-task-generator.v1"
TASK_SCHEMA_VERSION = "comet.eval/v1alpha1"
MIN_GENERATED_TASKS = 2
MAX_GENERATED_TASKS = 4
MAX_SNAPSHOT_FILES = 128
MAX_SNAPSHOT_BYTES = 512 * 1024
DEFAULT_CONTINUE_PROMPT = "Please continue with the next phase of the workflow."
_MODEL_ENV_KEYS = {
    "claude-code": ("BENCH_CC_MODEL", "ANTHROPIC_MODEL"),
    "codex": ("BENCH_CODEX_MODEL", "OPENAI_MODEL"),
    "qoder": ("BENCH_QODER_MODEL", "QODER_MODEL"),
    "codebuddy": ("BENCH_CODEBUDDY_MODEL", "CODEBUDDY_MODEL"),
}


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
class GeneratedCache:
    manifest_path: Path
    metadata_path: Path
    generation_hash: str


def selected_agent_model(agent: str) -> str | None:
    """Resolve the existing environment-backed model selector for cache identity."""
    adapter = get_agent_adapter(agent)
    keys = (*_MODEL_ENV_KEYS.get(agent, ()), *(key for key in (adapter.model_env,) if key))
    return next(
        (os.environ[key] for key in keys if os.environ.get(key)),
        None,
    )


def normalize_interaction(interaction: Mapping[str, Any]) -> dict[str, Any]:
    """Return the one cross-runtime interaction payload used by generation hashes."""
    return {
        "mode": interaction.get("mode", "none"),
        "max_turns": interaction.get("maxTurns", interaction.get("max_turns", 12)),
        "simulator_prompt": interaction.get("simulatorPrompt")
        or interaction.get("simulator_prompt"),
        "decision_patterns": list(
            interaction.get("decisionPatterns", interaction.get("decision_patterns", [])) or []
        ),
        "decision_reply": interaction.get(
            "decisionReply", interaction.get("decision_reply")
        ),
        "decision_replies": list(
            interaction.get("decisionReplies", interaction.get("decision_replies", [])) or []
        ),
        "continue_prompt": interaction.get(
            "continuePrompt",
            interaction.get("continue_prompt", DEFAULT_CONTINUE_PROMPT),
        ),
        "fresh_resume_marker": interaction.get("freshResumeMarker")
        or interaction.get("fresh_resume_marker"),
    }


def sha256(value: str | bytes) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def skill_root(skill_path: Path | str) -> Path:
    root = Path(skill_path).expanduser().resolve()
    if root.is_file() and root.name == "SKILL.md":
        root = root.parent
    if not root.is_dir() or not (root / "SKILL.md").is_file():
        raise ValueError(f"Skill package must contain SKILL.md: {skill_path}")
    return root


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def build_skill_snapshot(skill_path: Path | str) -> SkillSnapshot:
    root = skill_root(skill_path)
    selected: dict[str, SnapshotFile] = {}
    total = 0

    def add(path: Path) -> None:
        nonlocal total
        if len(selected) >= MAX_SNAPSHOT_FILES or not path.is_file() or not _inside(root, path):
            return
        relative = path.resolve().relative_to(root).as_posix()
        if relative in selected:
            return
        content = path.read_text(encoding="utf-8", errors="replace")
        payload = content.encode("utf-8")
        if total + len(payload) > MAX_SNAPSHOT_BYTES:
            return
        total += len(payload)
        selected[relative] = SnapshotFile(relative, content, sha256(content))

    skill_file = root / "SKILL.md"
    add(skill_file)
    body = skill_file.read_text(encoding="utf-8", errors="replace")
    for reference in re.findall(r"[`\"']([^`\"']+)[`\"']", body):
        add(root / reference.replace("\\", "/"))
    for directory in ("scripts", "references", "reference", "examples", "templates"):
        candidate = root / directory
        if candidate.is_dir():
            for child in sorted(candidate.rglob("*")):
                if not child.is_symlink():
                    add(child)
    files = tuple(selected[key] for key in sorted(selected))
    manifest = json.dumps(
        [{"path": item.path, "hash": item.content_hash} for item in files],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return SkillSnapshot(files, sha256(manifest))


def generation_hash(
    snapshot: SkillSnapshot,
    *,
    agent: str,
    model: str | None,
    base_url: str | None = None,
    profile: str,
    interaction: Mapping[str, Any],
) -> str:
    payload = {
        "snapshot_hash": snapshot.content_hash,
        "agent": agent,
        "model": model or "runtime-default",
        "base_url": base_url or "runtime-default",
        "profile": profile,
        "interaction": normalize_interaction(interaction),
        "generator_version": GENERATOR_VERSION,
        "task_schema_version": TASK_SCHEMA_VERSION,
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def cache_location(owner_root: Path | str, skill_path: Path | str, cache_hash: str) -> Path:
    root = skill_root(skill_path)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", root.name).strip("-") or "skill"
    return managed_path_for_owner(owner_root, "generated", safe_name, cache_hash)


def load_generated_cache(cache_dir: Path, cache_hash: str) -> GeneratedCache | None:
    manifest_path = cache_dir / "eval.yaml"
    metadata_path = cache_dir / "generation.json"
    if not manifest_path.is_file() or not metadata_path.is_file():
        return None
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("generation_hash") != cache_hash:
            return None
        if metadata.get("manifest_hash") != sha256(manifest_path.read_bytes()):
            return None
        validate_generated_manifest(manifest_path)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
    return GeneratedCache(manifest_path, metadata_path, cache_hash)


def validate_generated_manifest(manifest_path: Path | str):
    """Validate the stronger contract that applies to generated cache entries.

    The public manifest schema intentionally accepts authored and sourced tasks,
    while a generated cache must contain only the bounded inline task snapshot
    produced by the generator.  Keeping this check beside cache loading makes
    Python execution and static collection reject the same stale or tampered
    cache before it can be reused.
    """
    manifest = load_eval_manifest(manifest_path)
    tasks = manifest.tasks
    if not MIN_GENERATED_TASKS <= len(tasks) <= MAX_GENERATED_TASKS:
        raise ValueError(
            f"generated evaluation.tasks must contain {MIN_GENERATED_TASKS}-{MAX_GENERATED_TASKS} tasks"
        )
    names: set[str] = set()
    for index, task in enumerate(tasks):
        if not task.is_inline:
            raise ValueError(f"generated evaluation.tasks[{index}] must be an inline task")
        if task.name in names:
            raise ValueError(f'generated evaluation.tasks[{index}].name is duplicated: "{task.name}"')
        names.add(task.name)
    return manifest


def write_cache_metadata(cache_dir: Path, cache_hash: str) -> Path:
    """Test and migration helper for a static cache already written atomically by the generator."""
    manifest_path = cache_dir / "eval.yaml"
    metadata_path = cache_dir / "generation.json"
    metadata_path.write_text(
        json.dumps({"generation_hash": cache_hash, "manifest_hash": sha256(manifest_path.read_bytes())}),
        encoding="utf-8",
    )
    return metadata_path
