"""Dedicated LLM judge provider configuration."""

from __future__ import annotations

import os
import json
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Mapping


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


def build_judge_invocation(
    source_env: Mapping[str, str] | None = None,
) -> JudgeInvocation:
    """Build an isolated Claude CLI invocation environment for LLM-as-judge.

    Judge configuration is intentionally separate from the subject agent's
    ANTHROPIC_* provider settings. This prevents accidentally judging a run
    with the same model or endpoint under test.
    """
    source = source_env if source_env is not None else os.environ
    model = (source.get("BENCH_JUDGE_MODEL") or "").strip()
    if not model:
        raise ValueError("BENCH_JUDGE_MODEL is required when BENCH_LLM_JUDGE=1")

    env = dict(source)
    for key in _ANTHROPIC_PROVIDER_KEYS:
        env.pop(key, None)

    env["ANTHROPIC_MODEL"] = model

    api_key = (source.get("BENCH_JUDGE_API_KEY") or "").strip()
    auth_token = (source.get("BENCH_JUDGE_AUTH_TOKEN") or "").strip()
    base_url = (source.get("BENCH_JUDGE_BASE_URL") or "").strip()

    if api_key:
        env["ANTHROPIC_API_KEY"] = api_key
    if auth_token:
        env["ANTHROPIC_AUTH_TOKEN"] = auth_token
        env.pop("ANTHROPIC_API_KEY", None)
    if base_url:
        env["ANTHROPIC_BASE_URL"] = base_url

    return JudgeInvocation(
        env=env,
        model_flag=["--model", model],
        model=model,
        api_key=api_key,
        auth_token=auth_token,
        base_url=base_url,
    )


def run_judge_prompt(prompt: str, timeout: int = 120) -> str:
    """Run the judge prompt through a dedicated provider configuration.

    Anthropic-compatible HTTP is preferred when a judge base URL and credential
    are configured. This avoids Claude CLI request-shape incompatibilities with
    stricter proxy providers. Without a dedicated judge endpoint, fall back to
    the local Claude CLI for existing host-authenticated setups.
    """
    try:
        invocation = build_judge_invocation()
    except ValueError as e:
        return f"[RUBRIC-JUDGE] status: skipped - {e}"

    if invocation.base_url and (invocation.auth_token or invocation.api_key):
        return _run_judge_http(prompt, invocation, timeout=timeout)

    return _run_judge_claude_cli(prompt, invocation, timeout=timeout)


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


def _run_judge_claude_cli(
    prompt: str,
    invocation: JudgeInvocation,
    timeout: int = 120,
) -> str:
    import shutil

    claude_bin = shutil.which("claude") or "claude"
    try:
        result = subprocess.run(
            [claude_bin, "-p", "", "--dangerously-skip-permissions", *invocation.model_flag],
            input=prompt,
            capture_output=True,
            timeout=timeout,
            env=invocation.env,
            encoding="utf-8",
            errors="replace",
        )
        return result.stdout or ""
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return f"(judge error: {e})"
