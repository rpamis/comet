"""Resolve standalone eval execution settings and isolate provider environments."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import urlsplit

from scaffold.python.agents import AgentId, DEFAULT_AGENT, get_agent_adapter, validate_agent_id


_MISSING = object()
_MODEL_ENV: dict[AgentId, tuple[str, ...]] = {
    "claude-code": ("BENCH_CC_MODEL", "ANTHROPIC_MODEL"),
    "codex": ("BENCH_CODEX_MODEL", "OPENAI_MODEL", "CODEX_MODEL"),
    "qoder": ("BENCH_QODER_MODEL", "QODER_MODEL"),
    "codebuddy": ("BENCH_CODEBUDDY_MODEL", "CODEBUDDY_MODEL"),
}
_COMMON_MODEL_AGENTS = frozenset(_MODEL_ENV)
_BASE_URL_ENV: dict[AgentId, tuple[str, ...]] = {
    "claude-code": ("ANTHROPIC_BASE_URL",),
    "codex": ("OPENAI_BASE_URL", "CODEX_BASE_URL"),
    "qoder": ("QODER_BASE_URL",),
    "codebuddy": ("CODEBUDDY_BASE_URL",),
}
_COMMON_BASE_URL_AGENTS = frozenset({"claude-code", "codex", "codebuddy"})
_MODEL_TARGET_ENV: dict[AgentId, str] = {
    "claude-code": "ANTHROPIC_MODEL",
    "codex": "OPENAI_MODEL",
    "qoder": "QODER_MODEL",
    "codebuddy": "CODEBUDDY_MODEL",
}
_BASE_URL_TARGET_ENV: dict[AgentId, str] = {
    "claude-code": "ANTHROPIC_BASE_URL",
    "codex": "OPENAI_BASE_URL",
    "qoder": "QODER_BASE_URL",
    "codebuddy": "CODEBUDDY_BASE_URL",
}
_CREDENTIAL_ENV: dict[AgentId, tuple[str, ...]] = {
    "claude-code": ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"),
    "codex": ("OPENAI_API_KEY", "CODEX_API_KEY"),
    "qoder": ("QODER_PERSONAL_ACCESS_TOKEN",),
    "codebuddy": ("CODEBUDDY_API_KEY", "CODEBUDDY_AUTH_TOKEN"),
}
_PROVIDER_KEYS = {
    key
    for keys in (*_MODEL_ENV.values(), *_BASE_URL_ENV.values(), *_CREDENTIAL_ENV.values())
    for key in keys
}
_MAIN_OVERRIDE_KEYS = {
    "BENCH_EVAL_AGENT",
    "BENCH_CC_MODEL",
    "BENCH_CODEX_MODEL",
    "BENCH_QODER_MODEL",
    "BENCH_CODEBUDDY_MODEL",
    "OPENAI_MODEL",
    "CODEX_MODEL",
    "QODER_MODEL",
    "CODEBUDDY_MODEL",
    "BENCH_BASE_URL",
    "BENCH_API_KEY",
    "BENCH_MODEL",
}
_JUDGE_KEYS = {
    "BENCH_LLM_JUDGE",
    "BENCH_JUDGE_MODEL",
    "BENCH_JUDGE_BASE_URL",
    "BENCH_JUDGE_API_KEY",
    "BENCH_JUDGE_AUTH_TOKEN",
    "BENCH_JUDGE_AGENT",
    "COMET_EVAL_MAIN_CREDENTIALS",
}
_CREDENTIAL_NAME_RE = re.compile(
    r"(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|PERSONAL_ACCESS_TOKEN|PASSWORD|SECRET|CREDENTIALS?|(?:^|_)(?:KEY|TOKEN))$",
    re.I,
)


@dataclass(frozen=True)
class ResolvedExecution:
    agent: AgentId
    model: str | None
    base_url: str | None
    sources: dict[str, str]


@dataclass(frozen=True)
class ResolvedJudge:
    agent: AgentId
    model: str
    base_url: str | None
    sources: dict[str, str]


def _value(source: object, name: str, default: object = _MISSING) -> object:
    if isinstance(source, Mapping):
        if name in source:
            return source[name]
        return default
    value = getattr(source, name, default)
    return value


def _first_non_empty(values: list[object]) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def validate_base_url(value: object, *, field: str = "baseUrl") -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or value.strip() != value or not value:
        raise ValueError(f"{field} must be an absolute http(s) URL")
    parsed = urlsplit(value)
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError(f"{field} must be an absolute http(s) URL") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"{field} must be an absolute http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(f"{field} must not contain credentials, query, or fragment")
    return value


def _declared_credential_names(environment: Mapping[str, str]) -> set[str]:
    names: set[str] = set()
    for key in ("COMET_EVAL_CUSTOM_CREDENTIALS", "COMET_EVAL_MAIN_CREDENTIALS"):
        names.update(
            item.strip()
            for item in environment.get(key, "").split(",")
            if item.strip()
        )
    return names


def _credential_values(environment: Mapping[str, str]) -> tuple[str, ...]:
    declared = _declared_credential_names(environment)
    values = {
        value.strip()
        for key, value in environment.items()
        if value.strip() and (key in declared or _CREDENTIAL_NAME_RE.search(key))
    }
    return tuple(sorted((value for value in values if len(value) >= 4), key=len, reverse=True))


def redact_sensitive(value: Any, source_env: Mapping[str, str] | None = None) -> Any:
    """Redact credential values before eval data reaches user-owned artifacts."""

    environment = source_env if source_env is not None else os.environ
    declared = _declared_credential_names(environment)
    if isinstance(value, dict):
        return {
            key: "[REDACTED]"
            if key in declared or _CREDENTIAL_NAME_RE.search(str(key))
            else redact_sensitive(item, environment)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_sensitive(item, environment) for item in value]
    if not isinstance(value, str):
        return value
    redacted = re.sub(
        r"(?i)(authorization\s*:\s*bearer\s+)[^\s,;]+",
        r"\1[REDACTED]",
        value,
    )
    redacted = re.sub(r"(?i)(x-api-key\s*:\s*)[^\s,;]+", r"\1[REDACTED]", redacted)
    redacted = re.sub(
        r"(?i)(api[_-]?key|auth[_-]?token|access[_-]?token|token|secret|password|credential)\s*[=:]\s*[^\s,;]+",
        r"\1=[REDACTED]",
        redacted,
    )
    redacted = re.sub(
        r"(?i)([?&](?:api[_-]?key|token|access[_-]?token|auth[_-]?token)=)[^&#\s]+",
        r"\1[REDACTED]",
        redacted,
    )
    redacted = re.sub(r"(https?://)[^/@\s:]+:[^/@\s]+@", r"\1[REDACTED]@", redacted)
    for secret in _credential_values(environment):
        redacted = redacted.replace(secret, "[REDACTED]")
    return redacted


def _manifest_value(manifest: object | None, name: str) -> object:
    value = _value(manifest, name) if manifest is not None else _MISSING
    if value is not _MISSING:
        return value
    return None


def _model_env_keys(agent: AgentId) -> tuple[str, ...]:
    adapter = get_agent_adapter(agent)
    return (*_MODEL_ENV.get(agent, ()), *(key for key in (adapter.model_env,) if key))


def _base_url_env_keys(agent: AgentId) -> tuple[str, ...]:
    adapter = get_agent_adapter(agent)
    return (*_BASE_URL_ENV.get(agent, ()), *(key for key in (adapter.base_url_env,) if key))


def resolve_execution(
    *,
    cli_agent: object | None = None,
    cli_model: object | None = None,
    cli_base_url: object | None = None,
    manifest: object | None = None,
    source_env: Mapping[str, str] | None = None,
) -> ResolvedExecution:
    """Resolve main execution settings using CLI > manifest > legacy env > default."""

    environment = source_env if source_env is not None else os.environ
    manifest_agent = _manifest_value(manifest, "agent")
    agent_value = _first_non_empty(
        [cli_agent, manifest_agent, environment.get("BENCH_EVAL_AGENT"), DEFAULT_AGENT]
    )
    agent = validate_agent_id(agent_value, field="evaluation agent")

    manifest_model = _manifest_value(manifest, "model")
    model_candidates: list[object] = [cli_model, manifest_model]
    model_candidates.extend(environment.get(key) for key in _model_env_keys(agent))
    if agent in _COMMON_MODEL_AGENTS:
        model_candidates.append(environment.get("BENCH_MODEL"))
    model = _first_non_empty(model_candidates)

    manifest_base_url = _manifest_value(manifest, "base_url")
    if manifest_base_url is None:
        manifest_base_url = _manifest_value(manifest, "baseUrl")
    base_url_candidates: list[object] = [cli_base_url, manifest_base_url]
    base_url_candidates.extend(environment.get(key) for key in _base_url_env_keys(agent))
    if agent in _COMMON_BASE_URL_AGENTS:
        base_url_candidates.append(environment.get("BENCH_BASE_URL"))
    base_url = _first_non_empty(base_url_candidates)
    base_url = validate_base_url(base_url, field="execution.baseUrl")
    adapter = get_agent_adapter(agent)
    if adapter.custom and base_url and not adapter.base_url_env:
        raise ValueError(
            f"custom Agent {agent} must declare baseUrlEnv before execution.baseUrl can be used"
        )

    return ResolvedExecution(
        agent=agent,
        model=model,
        base_url=base_url,
        sources={
            "agent": "cli"
            if _first_non_empty([cli_agent])
            else "manifest"
            if _first_non_empty([manifest_agent])
            else "environment"
            if _first_non_empty([environment.get("BENCH_EVAL_AGENT")])
            else "default",
            "model": "cli"
            if _first_non_empty([cli_model])
            else "manifest"
            if _first_non_empty([manifest_model])
            else "environment"
            if model
            else "default",
            "base_url": "cli"
            if _first_non_empty([cli_base_url])
            else "manifest"
            if _first_non_empty([manifest_base_url])
            else "environment"
            if base_url
            else "default",
        },
    )


def resolve_judge(
    *,
    main: ResolvedExecution,
    cli_agent: object | None = None,
    cli_model: object | None = None,
    cli_base_url: object | None = None,
    manifest: object = None,
    source_env: Mapping[str, str] | None = None,
) -> ResolvedJudge | None:
    """Resolve the optional independent Judge configuration.

    The main model, base URL, and credentials are deliberately not fallbacks
    for Judge. Only the main Agent ID is an allowed implicit inheritance.
    """

    environment = source_env if source_env is not None else os.environ
    enabled = (
        manifest is not None
        or any(value is not None for value in (cli_agent, cli_model, cli_base_url))
        or str(environment.get("BENCH_LLM_JUDGE", "")).strip().lower()
        in {"1", "true", "yes", "on"}
    )
    if not enabled:
        return None

    manifest_agent = _manifest_value(manifest, "agent")
    agent_value = _first_non_empty([cli_agent, manifest_agent, main.agent])
    agent = validate_agent_id(agent_value, field="judge evaluation agent")

    manifest_model = _manifest_value(manifest, "model")
    model = _first_non_empty([cli_model, manifest_model, environment.get("BENCH_JUDGE_MODEL")])
    if model is None:
        if manifest == {} or str(environment.get("BENCH_LLM_JUDGE", "")).strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }:
            raise ValueError("BENCH_JUDGE_MODEL is required when BENCH_LLM_JUDGE=1")
        raise ValueError("judge.model is required when LLM-as-Judge is enabled")

    manifest_base_url = _manifest_value(manifest, "base_url")
    if manifest_base_url is None:
        manifest_base_url = _manifest_value(manifest, "baseUrl")
    base_url = _first_non_empty(
        [cli_base_url, manifest_base_url, environment.get("BENCH_JUDGE_BASE_URL")]
    )
    base_url = validate_base_url(base_url, field="judge.baseUrl")

    return ResolvedJudge(
        agent=agent,
        model=model,
        base_url=base_url,
        sources={
            "agent": "cli"
            if cli_agent
            else "manifest"
            if manifest_agent
            else "inherited",
            "model": "cli"
            if cli_model
            else "manifest"
            if manifest_model
            else "environment",
            "base_url": "cli"
            if cli_base_url
            else "manifest"
            if manifest_base_url
            else "environment"
            if base_url
            else "default",
        },
    )


def _set_if_value(environment: dict[str, str], key: str, value: str | None) -> None:
    if not key:
        return
    if value:
        environment[key] = value
    else:
        environment.pop(key, None)


def build_agent_environment(
    execution: ResolvedExecution,
    *,
    source_env: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Map resolved main settings to the selected adapter's env contract."""

    environment = dict(source_env if source_env is not None else os.environ)
    for key in _JUDGE_KEYS:
        environment.pop(key, None)
    for key in tuple(environment):
        if key.startswith("COMET_EVAL_CUSTOM_"):
            environment.pop(key, None)
    adapter = get_agent_adapter(execution.agent)
    _set_if_value(environment, adapter.model_env, execution.model)
    _set_if_value(environment, adapter.base_url_env, execution.base_url)
    if not adapter.custom and not any(
        environment.get(key) for key in _CREDENTIAL_ENV.get(execution.agent, ())
    ):
        credential_keys = _CREDENTIAL_ENV.get(execution.agent, ())
        if credential_keys:
            _set_if_value(environment, credential_keys[0], environment.get("BENCH_API_KEY"))
    if adapter.custom:
        environment["COMET_EVAL_CUSTOM_AGENT_ID"] = adapter.id
        environment["COMET_EVAL_CUSTOM_EXECUTABLE"] = adapter.executable
        environment["COMET_EVAL_CUSTOM_CREDENTIALS"] = ",".join(adapter.required_credentials)
        environment["COMET_EVAL_CUSTOM_MODEL_ENV"] = adapter.model_env
        environment["COMET_EVAL_CUSTOM_BASE_URL_ENV"] = adapter.base_url_env
        _set_if_value(environment, "COMET_EVAL_CUSTOM_MODEL", execution.model)
        _set_if_value(environment, "COMET_EVAL_CUSTOM_BASE_URL", execution.base_url)
        environment["COMET_EVAL_CUSTOM_INSTALL_KIND"] = adapter.install_kind
        _set_if_value(environment, "COMET_EVAL_CUSTOM_INSTALL_PACKAGE", adapter.install_package)
        _set_if_value(environment, "COMET_EVAL_CUSTOM_INSTALL_VERSION", adapter.install_version)
    return environment


def build_judge_environment(
    judge: ResolvedJudge,
    *,
    source_env: Mapping[str, str] | None = None,
    excluded_credentials: tuple[str, ...] = (),
) -> dict[str, str]:
    """Create a child environment containing only the dedicated Judge secrets."""

    source = source_env if source_env is not None else os.environ
    excluded = set(excluded_credentials) | _declared_credential_names(source)
    environment = {
        key: value
        for key, value in source.items()
        if key not in excluded
        and key not in _PROVIDER_KEYS
        and key not in _MAIN_OVERRIDE_KEYS
        and key not in _JUDGE_KEYS
        and not key.startswith("BENCH_JUDGE_")
        and not key.startswith("COMET_EVAL_CUSTOM_")
        and not re.search(
            r"(?:^|_)(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|PERSONAL_ACCESS_TOKEN|MODEL|BASE_URL|KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)$",
            key,
        )
    }
    api_key = source.get("BENCH_JUDGE_API_KEY", "")
    auth_token = source.get("BENCH_JUDGE_AUTH_TOKEN", "")
    adapter = get_agent_adapter(judge.agent)
    if adapter.custom:
        primary_credential = api_key or auth_token
        for index, key in enumerate(adapter.required_credentials):
            _set_if_value(
                environment,
                key,
                primary_credential if index == 0 else auth_token or api_key,
            )
    elif judge.agent == "claude-code":
        _set_if_value(environment, "ANTHROPIC_API_KEY", api_key)
        _set_if_value(environment, "ANTHROPIC_AUTH_TOKEN", auth_token)
    elif judge.agent == "codex":
        _set_if_value(environment, "OPENAI_API_KEY", api_key)
        _set_if_value(environment, "CODEX_API_KEY", auth_token)
    elif judge.agent == "qoder":
        _set_if_value(environment, "QODER_PERSONAL_ACCESS_TOKEN", auth_token or api_key)
    else:
        _set_if_value(environment, "CODEBUDDY_API_KEY", api_key)
        _set_if_value(environment, "CODEBUDDY_AUTH_TOKEN", auth_token)
    _set_if_value(environment, adapter.model_env, judge.model)
    _set_if_value(environment, adapter.base_url_env, judge.base_url)
    if adapter.custom:
        environment["COMET_EVAL_CUSTOM_AGENT_ID"] = adapter.id
        environment["COMET_EVAL_CUSTOM_EXECUTABLE"] = adapter.executable
        environment["COMET_EVAL_CUSTOM_CREDENTIALS"] = ",".join(adapter.required_credentials)
        environment["COMET_EVAL_CUSTOM_MODEL_ENV"] = adapter.model_env
        environment["COMET_EVAL_CUSTOM_BASE_URL_ENV"] = adapter.base_url_env
        _set_if_value(environment, "COMET_EVAL_CUSTOM_MODEL", judge.model)
        _set_if_value(environment, "COMET_EVAL_CUSTOM_BASE_URL", judge.base_url)
        environment["COMET_EVAL_CUSTOM_INSTALL_KIND"] = adapter.install_kind
        _set_if_value(environment, "COMET_EVAL_CUSTOM_INSTALL_PACKAGE", adapter.install_package)
        _set_if_value(environment, "COMET_EVAL_CUSTOM_INSTALL_VERSION", adapter.install_version)
    if "WSLENV" in environment:
        blocked_wsl = (
            set(excluded)
            | _PROVIDER_KEYS
            | _MAIN_OVERRIDE_KEYS
            | _JUDGE_KEYS
        )
        retained_wsl = [
            item
            for item in environment["WSLENV"].split(":")
            if item
            and item not in blocked_wsl
            and not item.startswith("BENCH_JUDGE_")
            and not item.startswith("COMET_EVAL_CUSTOM_")
        ]
        if retained_wsl:
            environment["WSLENV"] = ":".join(retained_wsl)
        else:
            environment.pop("WSLENV", None)
    environment["COMET_EVAL_AGENT_ROLE"] = "judge"
    return environment


def missing_credentials(
    agent: AgentId,
    *,
    source_env: Mapping[str, str] | None = None,
    judge: bool = False,
) -> tuple[str, ...]:
    """Return missing credential names for preflight without exposing values."""

    environment = source_env if source_env is not None else os.environ
    adapter = get_agent_adapter(agent)
    if judge:
        if not adapter.required_credentials:
            return ()
        if len(adapter.required_credentials) == 1:
            return () if any(
                environment.get(key) for key in ("BENCH_JUDGE_API_KEY", "BENCH_JUDGE_AUTH_TOKEN")
            ) else ("BENCH_JUDGE_API_KEY or BENCH_JUDGE_AUTH_TOKEN",)
        required = (
            "BENCH_JUDGE_API_KEY",
            "BENCH_JUDGE_AUTH_TOKEN",
        )
        return tuple(key for key in required if not environment.get(key))
    keys = adapter.required_credentials
    if adapter.custom:
        return tuple(key for key in keys if not environment.get(key))
    return () if any(environment.get(key) for key in keys) or environment.get("BENCH_API_KEY") else keys


def preflight_credentials(
    main: ResolvedExecution,
    judge: ResolvedJudge | None,
    *,
    source_env: Mapping[str, str] | None = None,
) -> list[str]:
    """Return safe, value-free credential errors for normal-run preflight."""

    errors: list[str] = []
    main_missing = missing_credentials(main.agent, source_env=source_env)
    if main_missing:
        separator = ", " if get_agent_adapter(main.agent).custom else " or "
        errors.append(f"main credentials missing for {main.agent}: {separator.join(main_missing)}")
    if judge is not None:
        judge_missing = missing_credentials(judge.agent, source_env=source_env, judge=True)
        if judge_missing:
            separator = ", " if get_agent_adapter(judge.agent).custom else " or "
            errors.append("judge credentials missing: " + separator.join(judge_missing))
    return errors


def api_identity(base_url: str | None) -> str:
    """Return the user-visible routing identity without exposing a URL."""

    return "custom" if base_url else "default"


__all__ = [
    "ResolvedExecution",
    "ResolvedJudge",
    "api_identity",
    "build_agent_environment",
    "build_judge_environment",
    "missing_credentials",
    "preflight_credentials",
    "resolve_execution",
    "resolve_judge",
    "redact_sensitive",
    "validate_base_url",
]
