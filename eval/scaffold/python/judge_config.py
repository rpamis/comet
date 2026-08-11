"""Dedicated LLM judge provider configuration."""

from __future__ import annotations

import os
import json
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping

from scaffold.python.agents import AgentId, get_agent_adapter, validate_agent_id


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


def build_judge_invocation(
    source_env: Mapping[str, str] | None = None,
    agent: object | None = None,
) -> JudgeInvocation:
    """Build an isolated selected-agent invocation environment for LLM-as-judge.

    Judge configuration is intentionally separate from the subject agent's
    ANTHROPIC_* provider settings. This prevents accidentally judging a run
    with the same model or endpoint under test.
    """
    source = source_env if source_env is not None else os.environ
    selected_agent = validate_agent_id(
        agent if agent is not None else source.get("BENCH_EVAL_AGENT", "claude-code"),
        field="judge evaluation agent",
    )
    model = (source.get("BENCH_JUDGE_MODEL") or "").strip()
    if not model:
        raise ValueError("BENCH_JUDGE_MODEL is required when BENCH_LLM_JUDGE=1")

    env = dict(source)
    env["COMET_EVAL_AGENT_ROLE"] = "judge"
    for key in _ANTHROPIC_PROVIDER_KEYS:
        env.pop(key, None)
    for key in (
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
        "QODER_PERSONAL_ACCESS_TOKEN",
        "CODEBUDDY_API_KEY",
        "CODEBUDDY_AUTH_TOKEN",
        "CODEBUDDY_BASE_URL",
        "CODEBUDDY_MODEL",
    ):
        env.pop(key, None)

    env["ANTHROPIC_MODEL"] = model

    api_key = (source.get("BENCH_JUDGE_API_KEY") or "").strip()
    auth_token = (source.get("BENCH_JUDGE_AUTH_TOKEN") or "").strip()
    base_url = (source.get("BENCH_JUDGE_BASE_URL") or "").strip()

    if selected_agent == "claude-code":
        if api_key:
            env["ANTHROPIC_API_KEY"] = api_key
        if auth_token:
            env["ANTHROPIC_AUTH_TOKEN"] = auth_token
            env.pop("ANTHROPIC_API_KEY", None)
        if base_url:
            env["ANTHROPIC_BASE_URL"] = base_url
    elif selected_agent == "codex":
        if api_key:
            env["OPENAI_API_KEY"] = api_key
        if auth_token:
            env["CODEX_API_KEY"] = auth_token
        if base_url:
            env["OPENAI_BASE_URL"] = base_url
    elif selected_agent == "qoder" and (api_key or auth_token):
        env["QODER_PERSONAL_ACCESS_TOKEN"] = auth_token or api_key
    elif selected_agent == "codebuddy":
        if api_key:
            env["CODEBUDDY_API_KEY"] = api_key
        if auth_token:
            env["CODEBUDDY_AUTH_TOKEN"] = auth_token
        if base_url:
            env["CODEBUDDY_BASE_URL"] = base_url
        env["CODEBUDDY_MODEL"] = model
    if selected_agent != "claude-code":
        env.pop("ANTHROPIC_MODEL", None)

    return JudgeInvocation(
        env=env,
        model_flag=["--model", model],
        model=model,
        api_key=api_key,
        auth_token=auth_token,
        base_url=base_url,
        agent=selected_agent,
    )


def run_judge_prompt(
    prompt: str,
    timeout: int = 120,
    agent: object | None = None,
    evidence: dict[str, Any] | None = None,
) -> str:
    """Run the judge prompt through a dedicated provider configuration.

    Anthropic-compatible HTTP is preferred when a judge base URL and credential
    are configured. This avoids Claude CLI request-shape incompatibilities with
    stricter proxy providers. Without a dedicated judge endpoint, fall back to
    the selected local agent CLI for existing host-authenticated setups.
    """
    try:
        invocation = build_judge_invocation(agent=agent)
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
        return f"(judge error: HTTP {e.code} {detail})"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return f"(judge error: {e})"

    content = payload.get("content") or []
    text_parts = [
        item.get("text", "")
        for item in content
        if isinstance(item, dict) and item.get("type") == "text"
    ]
    return "\n".join(part for part in text_parts if part).strip()


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
            return output
        return _extract_agent_text(output)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return f"(judge error: {e})"


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
