"""Selectable agent CLI contracts used by the evaluation harness."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from scaffold.python.custom_agents import load_custom_agent_spec


AgentId = str
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
    model_env: str = ""
    base_url_env: str = ""
    supports_resume: bool = True
    supports_single_turn: bool = True
    supports_structured_events: bool = True
    supports_telemetry: bool = True
    supports_skill_invocation_evidence: bool = True
    custom: bool = False
    install_kind: str = "none"
    install_package: str | None = None
    install_version: str | None = None

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
        elif self.custom:
            command.extend(["-p", prompt, "--output-format", "stream-json"])
            if model:
                command.extend(["--model", model])
            if resume_id:
                command.extend(["--resume", resume_id])
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

    def has_observable_skill_invocation(self, events: object) -> bool:
        """Only explicit invocation events count; artifacts are not evidence."""
        if not self.supports_skill_invocation_evidence or not isinstance(events, dict):
            return False
        invocations = events.get("skill_invocations")
        return isinstance(invocations, list) and bool(invocations)


def validate_agent_id(value: object, *, field: str = "evaluation agent") -> AgentId:
    if value in AGENT_IDS:
        return value
    if isinstance(value, str) and load_custom_agent_spec(value) is not None:
        return value
    if value not in AGENT_IDS:
        supported = ", ".join(AGENT_IDS)
        raise ValueError(
            f"Unsupported evaluation agent {value!r} in {field}. Expected one of: {supported} or an installed custom adapter"
        )
    return value  # pragma: no cover


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
    custom = load_custom_agent_spec(validated) if validated not in AGENT_IDS else None
    if custom is not None:
        capabilities = custom.capabilities
        return AgentAdapter(
            id=validated,
            executable=custom.executable,
            required_credentials=custom.credentials,
            model_env=custom.model_env or "",
            base_url_env=custom.base_url_env or "",
            supports_resume=capabilities["resume"],
            supports_single_turn=capabilities["single_turn"],
            supports_structured_events=capabilities["structured_events"],
            supports_telemetry=capabilities["telemetry"],
            supports_skill_invocation_evidence=capabilities["skill_invocation_evidence"],
            custom=True,
            install_kind=custom.install_kind,
            install_package=custom.install_package,
            install_version=custom.install_version,
        )
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
    model_env = {
        "claude-code": "ANTHROPIC_MODEL",
        "codex": "OPENAI_MODEL",
        "qoder": "QODER_MODEL",
        "codebuddy": "CODEBUDDY_MODEL",
    }[validated]
    base_url_env = {
        "claude-code": "ANTHROPIC_BASE_URL",
        "codex": "OPENAI_BASE_URL",
        "qoder": "QODER_BASE_URL",
        "codebuddy": "CODEBUDDY_BASE_URL",
    }[validated]
    return AgentAdapter(validated, executable, required_credentials, model_env, base_url_env)


def normalize_skill_invocations(
    events: object,
    *,
    agent: AgentId | None = None,
    adapter: AgentAdapter | None = None,
) -> list[str]:
    """Return Skill names that satisfy the selected Agent's evidence contract.

    Built-in Agents keep their existing path/tool inference. Custom adapters
    must opt into explicit invocation evidence; otherwise their reported Skill
    names are not treated as observable workflow evidence.
    """
    if not isinstance(events, dict):
        return []
    inferred = events.get("skills_invoked")
    fallback = [item for item in inferred if isinstance(item, str)] if isinstance(inferred, list) else []
    selected = adapter
    if selected is None:
        try:
            selected = get_agent_adapter(agent or DEFAULT_AGENT)
        except (TypeError, ValueError):
            return [] if isinstance(agent, str) and agent not in AGENT_IDS else fallback
    if not selected.custom:
        return fallback
    if not selected.has_observable_skill_invocation(events):
        return []
    explicit = events.get("skill_invocations")
    return [item for item in explicit if isinstance(item, str)] if isinstance(explicit, list) else []


def validate_agent_capabilities(
    adapter: AgentAdapter,
    required: tuple[str, ...] = (
        "single_turn",
        "resume",
        "structured_events",
        "skill_invocation_evidence",
    ),
) -> None:
    fields = {
        "single_turn": adapter.supports_single_turn,
        "resume": adapter.supports_resume,
        "structured_events": adapter.supports_structured_events,
        "telemetry": adapter.supports_telemetry,
        "skill_invocation_evidence": adapter.supports_skill_invocation_evidence,
    }
    missing = [name for name in required if not fields.get(name, False)]
    if missing:
        raise ValueError(
            f"Agent {adapter.id} is missing required capabilities: {', '.join(missing)}"
        )
