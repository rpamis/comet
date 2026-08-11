"""Selectable agent CLI contracts used by the evaluation harness."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


AgentId = Literal["claude-code", "codex", "qoder", "codebuddy"]
AgentRole = Literal["subject", "simulator", "judge"]

AGENT_IDS: tuple[AgentId, ...] = ("claude-code", "codex", "qoder", "codebuddy")
DEFAULT_AGENT: AgentId = "claude-code"


@dataclass(frozen=True)
class AgentSelection:
    """The resolved agent and the configuration layer that selected it."""

    agent: AgentId
    source: Literal["cli", "manifest", "default"]


@dataclass(frozen=True)
class AgentAdapter:
    """Build role-neutral commands for one supported evaluation agent."""

    id: AgentId
    executable: str
    required_credentials: tuple[str, ...]
    supports_resume: bool = True

    def build_version_command(self) -> list[str]:
        return [self.executable, "--version"]

    def build_run_command(
        self,
        prompt: str,
        *,
        model: str | None,
        role: AgentRole,
        resume_id: str | None = None,
        max_turns: int | None = None,
    ) -> list[str]:
        del role
        command = [self.executable]
        if self.id == "claude-code":
            command.extend(["-p", prompt, "--dangerously-skip-permissions"])
            command.extend(["--output-format", "stream-json", "--verbose"])
            if resume_id:
                command.extend(["--resume", resume_id])
            if max_turns is not None:
                command.extend(["--max-turns", str(max_turns)])
        elif self.id == "codex":
            command.extend(["exec"])
            if resume_id:
                command.extend(["resume", resume_id])
            command.extend(["--json", "--yolo"])
            if model:
                command.extend(["--model", model])
            command.append(prompt)
        elif self.id == "qoder":
            command.extend(["-p", prompt, "--output-format", "stream-json", "--yolo"])
            if resume_id:
                command.extend(["-r", resume_id])
            if model:
                command.extend(["--model", model])
            if max_turns is not None:
                command.extend(["--max-turns", str(max_turns)])
        else:
            command.extend(
                [
                    "-p",
                    prompt,
                    "--output-format",
                    "stream-json",
                    "--dangerously-skip-permissions",
                ]
            )
            if resume_id:
                command.extend(["-r", resume_id])
            if model:
                command.extend(["--model", model])
        if self.id == "claude-code" and model:
            command.extend(["--model", model])
        return command


def validate_agent_id(value: object, *, field: str = "evaluation agent") -> AgentId:
    if value not in AGENT_IDS:
        supported = ", ".join(AGENT_IDS)
        raise ValueError(
            f"Unsupported evaluation agent {value!r} in {field}. Expected one of: {supported}"
        )
    return value


def resolve_agent(
    cli_agent: object | None,
    manifest_agent: object | None,
) -> AgentSelection:
    if cli_agent is not None:
        return AgentSelection(validate_agent_id(cli_agent, field="CLI evaluation agent"), "cli")
    if manifest_agent is not None:
        return AgentSelection(
            validate_agent_id(manifest_agent, field="manifest execution.agent"),
            "manifest",
        )
    return AgentSelection(DEFAULT_AGENT, "default")


def get_agent_adapter(agent_id: object) -> AgentAdapter:
    validated = validate_agent_id(agent_id)
    executable = {
        "claude-code": "claude",
        "codex": "codex",
        "qoder": "qodercli",
        "codebuddy": "codebuddy",
    }[validated]
    required_credentials = {
        "claude-code": ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"),
        "codex": ("OPENAI_API_KEY", "CODEX_API_KEY"),
        "qoder": ("QODER_PERSONAL_ACCESS_TOKEN",),
        "codebuddy": ("CODEBUDDY_API_KEY", "CODEBUDDY_AUTH_TOKEN"),
    }[validated]
    return AgentAdapter(validated, executable, required_credentials)
