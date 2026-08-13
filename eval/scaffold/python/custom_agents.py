"""Explicitly installed, declarative custom Eval Agent adapter registry."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


CUSTOM_ADAPTERS_ENV = "COMET_EVAL_ADAPTERS_DIR"
CUSTOM_ADAPTER_API = "comet.eval.agent/v1alpha1"
CUSTOM_AGENT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
ENV_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9._:@/+%-]{1,160}$")
_CAPABILITY_FIELDS = {
    "singleTurn": "single_turn",
    "resume": "resume",
    "structuredEvents": "structured_events",
    "telemetry": "telemetry",
    "skillInvocationEvidence": "skill_invocation_evidence",
}


@dataclass(frozen=True)
class CustomAgentSpec:
    id: str
    version: str
    executable: str
    credentials: tuple[str, ...]
    model_env: str | None
    base_url_env: str | None
    capabilities: dict[str, bool]
    install_kind: str = "none"
    install_package: str | None = None
    install_version: str | None = None
    manifest_path: Path | None = None


def adapter_root(root: Path | str | None = None) -> Path:
    selected = root or os.environ.get(CUSTOM_ADAPTERS_ENV)
    return Path(selected).expanduser() if selected else Path.home() / ".comet" / "eval" / "adapters"


def _mapping(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"custom Agent adapter {field} must be a mapping")
    return value


def _safe_token(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value or not SAFE_TOKEN_RE.fullmatch(value):
        raise ValueError(f"custom Agent adapter {field} is invalid")
    return value


def _env_name(value: Any, field: str, *, optional: bool = True) -> str | None:
    if value is None and optional:
        return None
    if not isinstance(value, str) or not ENV_NAME_RE.fullmatch(value):
        raise ValueError(f"custom Agent adapter {field} must be an environment variable name")
    return value


def _load(path: Path, directory_name: str) -> CustomAgentSpec:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ValueError(f"custom Agent adapter {path} is invalid YAML") from exc
    if not isinstance(data, dict):
        raise ValueError(f"custom Agent adapter {path} must be a mapping")
    allowed = {"apiVersion", "kind", "metadata", "runtime", "credentials", "modelEnv", "baseUrlEnv", "capabilities"}
    unknown = set(data) - allowed
    if unknown:
        raise ValueError(f"custom Agent adapter {path} has unknown fields: {sorted(unknown)}")
    if data.get("apiVersion") != CUSTOM_ADAPTER_API or data.get("kind") != "EvalAgentAdapter":
        raise ValueError(f"custom Agent adapter {path} has an unsupported apiVersion or kind")
    metadata = _mapping(data.get("metadata"), "metadata")
    agent_id = metadata.get("id")
    if not isinstance(agent_id, str) or not CUSTOM_AGENT_ID_RE.fullmatch(agent_id):
        raise ValueError(f"custom Agent adapter {path} metadata.id is invalid")
    if agent_id != directory_name:
        raise ValueError(f"custom Agent adapter {path} metadata.id must match its directory")
    version = _safe_token(metadata.get("version"), "metadata.version")
    runtime = _mapping(data.get("runtime"), "runtime")
    runtime_unknown = set(runtime) - {"executable", "install"}
    if runtime_unknown:
        raise ValueError(f"custom Agent adapter {path} runtime has unknown fields: {sorted(runtime_unknown)}")
    executable = _safe_token(runtime.get("executable"), "runtime.executable")
    install = _mapping(runtime.get("install", {"kind": "none"}), "runtime.install")
    install_unknown = set(install) - {"kind", "package", "version"}
    if install_unknown:
        raise ValueError(f"custom Agent adapter {path} runtime.install has unknown fields: {sorted(install_unknown)}")
    install_kind = install.get("kind", "none")
    if install_kind not in {"none", "npm", "pip"}:
        raise ValueError(f"custom Agent adapter {path} runtime.install.kind is invalid")
    install_package = install.get("package")
    install_version = install.get("version")
    if install_kind != "none":
        install_package = _safe_token(install_package, "runtime.install.package")
        install_version = _safe_token(install_version or "latest", "runtime.install.version")
    elif install_package is not None or install_version is not None:
        raise ValueError(f"custom Agent adapter {path} runtime.install package requires npm or pip")
    credentials = data.get("credentials", [])
    if not isinstance(credentials, list) or not all(isinstance(item, str) for item in credentials):
        raise ValueError(f"custom Agent adapter {path} credentials must be a list")
    if len(credentials) > 2:
        raise ValueError(
            f"custom Agent adapter {path} supports at most two credentials so Judge can map its dedicated API key and auth token"
        )
    credential_names = tuple(_env_name(item, "credentials") for item in credentials)
    if any(item is None for item in credential_names) or len(set(credential_names)) != len(credential_names):
        raise ValueError(f"custom Agent adapter {path} credentials are invalid or duplicated")
    capabilities = _mapping(data.get("capabilities"), "capabilities")
    if set(capabilities) != set(_CAPABILITY_FIELDS):
        raise ValueError(
            f"custom Agent adapter {path} capabilities must declare: {', '.join(_CAPABILITY_FIELDS)}"
        )
    if not all(isinstance(value, bool) for value in capabilities.values()):
        raise ValueError(f"custom Agent adapter {path} capabilities must be boolean")
    return CustomAgentSpec(
        id=agent_id,
        version=version,
        executable=executable,
        credentials=tuple(item for item in credential_names if item is not None),
        model_env=_env_name(data.get("modelEnv"), "modelEnv"),
        base_url_env=_env_name(data.get("baseUrlEnv"), "baseUrlEnv"),
        capabilities={
            internal_name: bool(capabilities[manifest_name])
            for manifest_name, internal_name in _CAPABILITY_FIELDS.items()
        },
        install_kind=install_kind,
        install_package=install_package,
        install_version=install_version,
        manifest_path=path,
    )


def discover_custom_agent_specs(root: Path | str | None = None) -> dict[str, CustomAgentSpec]:
    """Discover only explicit ``<id>/adapter.yaml`` registrations safely."""
    registry = adapter_root(root)
    if not registry.exists():
        return {}
    if not registry.is_dir():
        raise ValueError(f"custom Agent adapter registry is not a directory: {registry}")
    real_registry = registry.resolve()
    result: dict[str, CustomAgentSpec] = {}
    for entry in sorted(registry.iterdir(), key=lambda item: item.name):
        if not entry.is_dir():
            raise ValueError(f"custom Agent adapter registry contains a non-directory entry: {entry.name}")
        resolved = entry.resolve()
        try:
            resolved.relative_to(real_registry)
        except ValueError as exc:
            raise ValueError(f"custom Agent adapter escapes registry: {entry.name}") from exc
        manifest = entry / "adapter.yaml"
        if not manifest.is_file():
            raise ValueError(f"custom Agent adapter is missing adapter.yaml: {entry.name}")
        spec = _load(manifest.resolve(), entry.name)
        if spec.id in result:
            raise ValueError(f"duplicate custom Agent adapter id: {spec.id}")
        result[spec.id] = spec
    return result


def load_custom_agent_spec(agent_id: str) -> CustomAgentSpec | None:
    if not CUSTOM_AGENT_ID_RE.fullmatch(agent_id):
        return None
    return discover_custom_agent_specs().get(agent_id)
