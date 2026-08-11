"""Tests for selectable evaluation-agent contracts."""

import pytest

from scaffold.python.agents import (
    AGENT_IDS,
    get_agent_adapter,
    resolve_agent,
)


def test_resolve_agent_applies_cli_manifest_default_precedence():
    assert resolve_agent("qoder", "codex").agent == "qoder"
    assert resolve_agent(None, "codex").agent == "codex"
    assert resolve_agent(None, None).agent == "claude-code"


@pytest.mark.parametrize("agent", ["gemini", "", "Claude-Code"])
def test_resolve_agent_rejects_unknown_agent(agent: str):
    with pytest.raises(ValueError, match="Unsupported evaluation agent"):
        resolve_agent(agent, None)


def test_all_supported_agents_expose_role_neutral_run_commands():
    assert AGENT_IDS == ("claude-code", "codex", "qoder", "codebuddy")

    for agent_id in AGENT_IDS:
        adapter = get_agent_adapter(agent_id)
        command = adapter.build_run_command(
            "inspect the task",
            model="test-model",
            role="subject",
        )

        assert adapter.id == agent_id
        assert command
        assert "inspect the task" in command
        assert "test-model" in command


def test_codebuddy_adapter_uses_headless_streaming_and_resume_contract():
    adapter = get_agent_adapter("codebuddy")

    assert adapter.executable == "codebuddy"
    assert adapter.required_credentials == ("CODEBUDDY_API_KEY", "CODEBUDDY_AUTH_TOKEN")
    assert adapter.build_run_command(
        "continue",
        model="codebuddy-model",
        role="subject",
        resume_id="session-123",
    ) == [
        "codebuddy",
        "-p",
        "continue",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "-r",
        "session-123",
        "--model",
        "codebuddy-model",
    ]


def test_adapters_build_resume_commands_with_isolated_session_ids():
    for agent_id in AGENT_IDS:
        adapter = get_agent_adapter(agent_id)
        command = adapter.build_run_command(
            "continue",
            model=None,
            role="simulator",
            resume_id="session-123",
        )

        assert "session-123" in command
        assert adapter.supports_resume is True
