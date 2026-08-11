"""Import-safe generated-task snapshot and cache selection primitives."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from scaffold.python.eval_context import managed_path_for_owner
from scaffold.python.manifests import load_eval_manifest


GENERATOR_VERSION = "comet-auto-task-generator.v1"
TASK_SCHEMA_VERSION = "comet.eval/v1alpha1"
MAX_SNAPSHOT_FILES = 128
MAX_SNAPSHOT_BYTES = 512 * 1024


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
        sort_keys=True,
        separators=(",", ":"),
    )
    return SkillSnapshot(files, sha256(manifest))


def generation_hash(
    snapshot: SkillSnapshot,
    *,
    agent: str,
    model: str | None,
    profile: str,
    interaction: Mapping[str, Any],
) -> str:
    payload = {
        "snapshot_hash": snapshot.content_hash,
        "agent": agent,
        "model": model or "runtime-default",
        "profile": profile,
        "interaction": dict(interaction),
        "generator_version": GENERATOR_VERSION,
        "task_schema_version": TASK_SCHEMA_VERSION,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


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
        load_eval_manifest(manifest_path)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
    return GeneratedCache(manifest_path, metadata_path, cache_hash)


def write_cache_metadata(cache_dir: Path, cache_hash: str) -> Path:
    """Test and migration helper for a static cache already written atomically by the generator."""
    manifest_path = cache_dir / "eval.yaml"
    metadata_path = cache_dir / "generation.json"
    metadata_path.write_text(
        json.dumps({"generation_hash": cache_hash, "manifest_hash": sha256(manifest_path.read_bytes())}),
        encoding="utf-8",
    )
    return metadata_path
