"""Dedicated LLM judge provider configuration."""

from __future__ import annotations

import os
import json
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping

from scaffold.python.agents import AgentId, get_agent_adapter
from scaffold.python.execution import (
    ResolvedExecution,
    ResolvedJudge,
    build_judge_environment,
    redact_sensitive,
    resolve_judge,
)


_ANTHROPIC_PROVIDER_KEYS = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
)


@dataclass(frozen=True)
class JudgeInvocation:
    env: dict[str, str]
    model_flag: list[str]
    model: str
    api_key: str
    auth_token: str
    base_url: str
    agent: AgentId = "claude-code"
    resolved: ResolvedJudge | None = None


def build_judge_invocation(
    source_env: Mapping[str, str] | None = None,
    agent: object | None = None,
    model: object | None = None,
    base_url: object | None = None,
    manifest: object | None = None,
    main_agent: AgentId = "claude-code",
    excluded_credentials: tuple[str, ...] = (),
) -> JudgeInvocation:
    """Build an isolated selected-agent invocation environment for LLM-as-judge.

    Judge configuration is intentionally separate from the subject agent's
    ANTHROPIC_* provider settings. This prevents accidentally judging a run
    with the same model or endpoint under test.
    """
    source = source_env if source_env is not None else os.environ
    if (
        manifest is None
        and agent is None
        and model is None
        and base_url is None
        and str(source.get("BENCH_LLM_JUDGE", "")).strip().lower()
        not in {"1", "true", "yes", "on"}
    ):
        manifest = {}
    main = ResolvedExecution(main_agent, None, None, {})
    resolved = resolve_judge(
        main=main,
        cli_agent=agent,
        cli_model=model,
        cli_base_url=base_url,
        manifest=manifest,
        source_env=source,
    )
    if resolved is None:
        raise ValueError("Judge is not enabled")
    selected_agent = resolved.agent
    selected_model = resolved.model
    selected_base_url = resolved.base_url
    env = build_judge_environment(
        resolved,
        source_env=source,
        excluded_credentials=excluded_credentials,
    )

    api_key = (source.get("BENCH_JUDGE_API_KEY") or "").strip()
    auth_token = (source.get("BENCH_JUDGE_AUTH_TOKEN") or "").strip()

    return JudgeInvocation(
        env=env,
        model_flag=["--model", selected_model],
        model=selected_model,
        api_key=api_key,
        auth_token=auth_token,
        base_url=selected_base_url or "",
        agent=selected_agent,
        resolved=resolved,
    )


def run_judge_prompt(
    prompt: str,
    timeout: int = 120,
    agent: object | None = None,
    model: object | None = None,
    base_url: object | None = None,
    manifest: object | None = None,
    main_agent: AgentId = "claude-code",
    evidence: dict[str, Any] | None = None,
    excluded_credentials: tuple[str, ...] = (),
) -> str:
    """Run the judge prompt through a dedicated provider configuration.

    Anthropic-compatible HTTP is preferred when a judge base URL and credential
    are configured. This avoids Claude CLI request-shape incompatibilities with
    stricter proxy providers. Without a dedicated judge endpoint, fall back to
    the selected local agent CLI for existing host-authenticated setups.
    """
    try:
        invocation = build_judge_invocation(
            agent=agent,
            model=model,
            base_url=base_url,
            manifest=manifest,
            main_agent=main_agent,
            excluded_credentials=excluded_credentials,
        )
    except ValueError as e:
        return f"[RUBRIC-JUDGE] status: skipped - {e}"

    if (
        invocation.agent == "claude-code"
        and invocation.base_url
        and (invocation.auth_token or invocation.api_key)
    ):
        return _run_judge_http(prompt, invocation, timeout=timeout)

    return _run_judge_agent_cli(prompt, invocation, timeout=timeout, evidence=evidence)


def _messages_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/messages"):
        return base
    if base.endswith("/v1"):
        return f"{base}/messages"
    return f"{base}/v1/messages"


def _run_judge_http(prompt: str, invocation: JudgeInvocation, timeout: int = 120) -> str:
    body = json.dumps(
        {
            "model": invocation.model,
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")
    headers = {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    if invocation.auth_token:
        headers["authorization"] = f"Bearer {invocation.auth_token}"
    else:
        headers["x-api-key"] = invocation.api_key

    request = urllib.request.Request(
        _messages_url(invocation.base_url),
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace").strip()
        return redact_sensitive(f"(judge error: HTTP {e.code} {detail})", invocation.env)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return redact_sensitive(f"(judge error: {e})", invocation.env)

    content = payload.get("content") or []
    text_parts = [
        item.get("text", "")
        for item in content
        if isinstance(item, dict) and item.get("type") == "text"
    ]
    return redact_sensitive("\n".join(part for part in text_parts if part).strip(), invocation.env)


def _run_judge_agent_cli(
    prompt: str,
    invocation: JudgeInvocation,
    timeout: int = 120,
    evidence: dict[str, Any] | None = None,
) -> str:
    import shutil

    adapter = get_agent_adapter(invocation.agent)
    executable = shutil.which(adapter.executable) or adapter.executable
    if invocation.agent == "claude-code":
        command = [executable, "-p", "", "--dangerously-skip-permissions", *invocation.model_flag]
        input_text = prompt
    else:
        command = adapter.build_run_command(
            prompt,
            model=invocation.model,
            role="judge",
        )
        command[0] = executable
        input_text = None
    try:
        result = subprocess.run(
            command,
            input=input_text,
            capture_output=True,
            timeout=timeout,
            env=invocation.env,
            encoding="utf-8",
            errors="replace",
        )
        output = result.stdout or ""
        if evidence is not None:
            role_sessions = evidence.setdefault(
                "role_sessions", {"subject": [], "simulator": [], "judge": []}
            )
            judge_sessions = role_sessions.setdefault("judge", [])
            for session_id in _extract_agent_session_ids(output):
                if session_id not in judge_sessions:
                    judge_sessions.append(session_id)
        if invocation.agent == "claude-code":
            return redact_sensitive(output, invocation.env)
        return redact_sensitive(_extract_agent_text(output), invocation.env)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return redact_sensitive(f"(judge error: {e})", invocation.env)


def _extract_agent_session_ids(output: str) -> list[str]:
    session_ids: list[str] = []

    def visit(value: object) -> None:
        if isinstance(value, dict):
            for key in ("session_id", "sessionId", "thread_id", "threadId"):
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate and candidate not in session_ids:
                    session_ids.append(candidate)
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    for line in output.splitlines():
        try:
            visit(json.loads(line))
        except (TypeError, json.JSONDecodeError):
            continue
    return session_ids


def _extract_agent_text(output: str) -> str:
    """Extract the last textual message from selectable-agent JSONL output."""
    values: list[str] = []

    def visit(value: object) -> None:
        if isinstance(value, dict):
            for key in ("result", "response", "text"):
                item = value.get(key)
                if isinstance(item, str) and item.strip():
                    values.append(item)
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    for line in output.splitlines():
        try:
            visit(json.loads(line))
        except (TypeError, json.JSONDecodeError):
            continue
    return values[-1] if values else output
