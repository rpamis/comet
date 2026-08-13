"""Resolve standalone Eval targets into a portable, user-owned context."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import yaml


CONTEXT_ENV = "COMET_EVAL_CONTEXT"
CONTEXT_SCHEMA = "comet.eval.context.v1"
_CREDENTIAL_KEY = re.compile(r"(?:api[_-]?key|auth[_-]?token|password|secret|credential)", re.I)
_MANAGED_ROOTS = frozenset({"cache", "runs", "generated", "locks"})
ManifestSource = Literal["explicit", "auto-detected", "synthesized"]


class EvalContextError(ValueError):
    """The supplied Eval target cannot be resolved safely."""


def _contains_credentials(value: object) -> bool:
    if isinstance(value, dict):
        return any(_CREDENTIAL_KEY.search(str(key)) or _contains_credentials(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_contains_credentials(item) for item in value)
    return False


def _skill_root(path: Path | str) -> Path:
    root = Path(path).expanduser().resolve()
    if root.is_file() and root.name == "SKILL.md":
        root = root.parent
    if not root.is_dir() or not (root / "SKILL.md").is_file():
        raise EvalContextError(f"Skill package must contain SKILL.md: {path}")
    return root


def _manifest_skill_root(manifest_path: Path) -> Path:
    try:
        data = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        raise EvalContextError(f"Could not read eval manifest: {manifest_path}") from exc
    if not isinstance(data, dict):
        raise EvalContextError("Eval manifest must be a mapping")
    skill = data.get("skill") or {}
    if not isinstance(skill, dict):
        raise EvalContextError("Eval manifest skill must be a mapping")
    source = skill.get("source", "..")
    if not isinstance(source, str) or not source.strip():
        raise EvalContextError("Eval manifest skill.source must be a non-empty path")
    source_path = Path(source)
    target = source_path if source_path.is_absolute() else manifest_path.parent / source_path
    return _skill_root(target)


def _base_manifest(skill_root: Path) -> dict[str, Any]:
    return {
        "apiVersion": "comet.eval/v1alpha1",
        "kind": "SkillEvalManifest",
        "metadata": {"name": skill_root.name},
        "skill": {"name": skill_root.name, "source": str(skill_root)},
        "evaluation": {},
    }


def artifact_root_for_owner(owner_root: Path | str) -> Path:
    """Return an owner-local Eval root without following a `.comet` escape."""
    owner = Path(owner_root).expanduser().resolve()
    if not owner.is_dir():
        raise EvalContextError(f"Artifact owner root must be an existing directory: {owner}")
    artifact_root = owner / ".comet" / "eval"
    resolved_artifact_root = artifact_root.resolve()
    try:
        resolved_artifact_root.relative_to(owner)
    except ValueError as exc:
        raise EvalContextError("Eval artifact root must stay within its owner root") from exc
    return artifact_root


def assert_artifact_root_is_safe(context: "ResolvedEvalContext") -> Path:
    """Revalidate the boundary immediately before a harness writes mutable state."""
    expected = artifact_root_for_owner(context.artifact_owner_root)
    if context.artifact_root != expected:
        raise EvalContextError("Eval context artifact root must stay under its owner root")
    return expected


def _managed_path_for_owner(owner_root: Path | str, managed_root: str, *parts: str) -> Path:
    """Resolve one mutable Eval path while keeping every real component owner-local."""
    if managed_root not in _MANAGED_ROOTS:
        raise EvalContextError(f"Unsupported Eval managed root: {managed_root}")
    owner = Path(owner_root).expanduser().resolve()
    artifact_root = artifact_root_for_owner(owner)
    path = artifact_root / managed_root
    for part in parts:
        component = Path(part)
        if component.is_absolute() or len(component.parts) != 1 or component.parts[0] in {".", ".."}:
            raise EvalContextError("Eval managed path components must be relative names")
        path /= component
    try:
        path.resolve().relative_to(owner)
    except ValueError as exc:
        raise EvalContextError("Eval managed path must stay within its owner root") from exc
    return path


def resolve_managed_path(
    context: "ResolvedEvalContext", managed_root: str, *parts: str
) -> Path:
    """Return a checked owner-owned mutable path immediately before it is used."""
    assert_artifact_root_is_safe(context)
    return _managed_path_for_owner(context.artifact_owner_root, managed_root, *parts)


def managed_path_for_owner(owner_root: Path | str, managed_root: str, *parts: str) -> Path:
    """Resolve a checked mutable path for callers that only have the owner root."""
    return _managed_path_for_owner(owner_root, managed_root, *parts)


@dataclass(frozen=True)
class ResolvedEvalContext:
    """The target identity and all mutable state locations for one Eval run."""

    skill_root: Path
    manifest_source: ManifestSource
    artifact_owner_root: Path
    artifact_root: Path
    manifest_path: Path | None = None
    base_manifest: dict[str, Any] | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "schema": CONTEXT_SCHEMA,
            "skillRoot": str(self.skill_root),
            "manifestSource": self.manifest_source,
            "artifactOwnerRoot": str(self.artifact_owner_root),
            "artifactRoot": str(self.artifact_root),
        }
        if self.manifest_path is not None:
            payload["manifestPath"] = str(self.manifest_path)
        if self.base_manifest is not None:
            payload["baseManifest"] = self.base_manifest
        return payload


def resolve_eval_context(
    *,
    skill_path: Path | str | None = None,
    manifest_path: Path | str | None = None,
    project_root: Path | str | None = None,
) -> ResolvedEvalContext:
    """Resolve the only supported standalone target forms without parent scans."""
    if bool(skill_path) == bool(manifest_path):
        raise EvalContextError("Pass exactly one of skill_path or manifest_path")

    resolved_manifest: Path | None = None
    base_manifest: dict[str, Any] | None = None
    if manifest_path is not None:
        resolved_manifest = Path(manifest_path).expanduser().resolve()
        if not resolved_manifest.is_file() or resolved_manifest.name not in {"eval.yaml", "eval.yml"}:
            raise EvalContextError(f"Eval manifest must be an eval.yaml or eval.yml file: {manifest_path}")
        skill_root = _manifest_skill_root(resolved_manifest)
        source: ManifestSource = "explicit"
    else:
        skill_root = _skill_root(skill_path)
        yaml_manifest = skill_root / "comet" / "eval.yaml"
        yml_manifest = skill_root / "comet" / "eval.yml"
        if yaml_manifest.is_file():
            resolved_manifest = yaml_manifest.resolve()
            source = "auto-detected"
        elif yml_manifest.is_file():
            resolved_manifest = yml_manifest.resolve()
            source = "auto-detected"
        else:
            source = "synthesized"
            base_manifest = _base_manifest(skill_root)

    owner = Path(project_root).expanduser().resolve() if project_root else skill_root
    artifact_root = artifact_root_for_owner(owner)
    return ResolvedEvalContext(
        skill_root=skill_root,
        manifest_source=source,
        manifest_path=resolved_manifest,
        artifact_owner_root=owner,
        artifact_root=artifact_root,
        base_manifest=base_manifest,
    )


def context_from_environment() -> ResolvedEvalContext | None:
    """Read the CLI-resolved context without accepting credentials in the payload."""
    raw = os.environ.get(CONTEXT_ENV)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise EvalContextError(f"{CONTEXT_ENV} must contain JSON") from exc
    if not isinstance(payload, dict) or _contains_credentials(payload):
        raise EvalContextError("Eval context must not contain credentials")
    if payload.get("schema") != CONTEXT_SCHEMA:
        raise EvalContextError("Unsupported Eval context schema")
    source = payload.get("manifestSource")
    if source not in {"explicit", "auto-detected", "synthesized"}:
        raise EvalContextError("Eval context has an invalid manifest source")
    skill_root = _skill_root(payload.get("skillRoot", ""))
    owner = Path(payload.get("artifactOwnerRoot", "")).expanduser().resolve()
    expected_artifact_root = artifact_root_for_owner(owner)
    supplied_artifact_root = Path(payload.get("artifactRoot", "")).expanduser().absolute()
    if supplied_artifact_root != expected_artifact_root:
        raise EvalContextError("Eval context artifact root must stay under its owner root")
    manifest_value = payload.get("manifestPath")
    manifest_path = Path(manifest_value).expanduser().resolve() if isinstance(manifest_value, str) else None
    if source == "synthesized":
        if manifest_path is not None:
            raise EvalContextError("Synthesized Eval context must not have a manifest path")
        base_manifest = payload.get("baseManifest")
        if not isinstance(base_manifest, dict):
            raise EvalContextError("Synthesized Eval context requires an in-memory base manifest")
    else:
        if manifest_path is None:
            raise EvalContextError("Manifest-backed Eval context requires a manifest path")
        base_manifest = None
    return ResolvedEvalContext(
        skill_root=skill_root,
        manifest_source=source,
        manifest_path=manifest_path,
        artifact_owner_root=owner,
        artifact_root=expected_artifact_root,
        base_manifest=base_manifest,
    )
