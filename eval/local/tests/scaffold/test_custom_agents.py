"""Contract tests for explicitly installed custom Eval Agent adapters."""

from pathlib import Path

import pytest

from scaffold.python.agents import (
    get_agent_adapter,
    normalize_skill_invocations,
    validate_agent_capabilities,
)
from scaffold.python.custom_agents import discover_custom_agent_specs


def _write_adapter(root: Path, *, name: str = "fixture-agent", **overrides) -> Path:
    directory = root / name
    directory.mkdir(parents=True)
    capabilities = overrides.pop(
        "capabilities",
        {
            "singleTurn": True,
            "resume": True,
            "structuredEvents": True,
            "telemetry": False,
            "skillInvocationEvidence": True,
        },
    )
    runtime = overrides.pop(
        "runtime",
        {"executable": "fixture-agent", "install": {"kind": "none"}},
    )
    credentials = overrides.pop("credentials", ["FIXTURE_AGENT_API_KEY"])
    lines = [
        "apiVersion: comet.eval.agent/v1alpha1",
        "kind: EvalAgentAdapter",
        "metadata:",
        f"  id: {name}",
        "  version: '1.0.0'",
        "runtime:",
        f"  executable: {runtime['executable']}",
        "  install:",
        f"    kind: {runtime['install']['kind']}",
        "credentials:",
        *[f"  - {item}" for item in credentials],
        "modelEnv: FIXTURE_AGENT_MODEL",
        "baseUrlEnv: FIXTURE_AGENT_BASE_URL",
        "capabilities:",
        *[f"  {key}: {'true' if value else 'false'}" for key, value in capabilities.items()],
    ]
    for key, value in overrides.items():
        lines.append(f"{key}: {value}")
    path = directory / "adapter.yaml"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_tracked_fixture_can_be_installed_as_a_custom_adapter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fixture = Path(__file__).parent / "fixtures" / "custom-agent" / "adapter.yaml"
    destination = tmp_path / "fixture-agent"
    destination.mkdir()
    (destination / "adapter.yaml").write_text(fixture.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setenv("COMET_EVAL_ADAPTERS_DIR", str(tmp_path))

    adapter = get_agent_adapter("fixture-agent")

    assert adapter.custom is True
    assert adapter.executable == "fixture-agent"


def test_installed_custom_adapter_is_discovered_and_generates_standard_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _write_adapter(tmp_path)
    monkeypatch.setenv("COMET_EVAL_ADAPTERS_DIR", str(tmp_path))

    specs = discover_custom_agent_specs()
    adapter = get_agent_adapter("fixture-agent")

    assert list(specs) == ["fixture-agent"]
    assert adapter.custom is True
    assert adapter.executable == "fixture-agent"
    assert adapter.required_credentials == ("FIXTURE_AGENT_API_KEY",)
    assert adapter.supports_telemetry is False
    assert adapter.build_run_command(
        "Do it.", model="fixture-model", role="subject", resume_id="session-1"
    ) == [
        "fixture-agent",
        "-p",
        "Do it.",
        "--output-format",
        "stream-json",
        "--model",
        "fixture-model",
        "--resume",
        "session-1",
    ]


@pytest.mark.parametrize(
    "capability",
    ["single_turn", "resume", "structured_events", "skill_invocation_evidence"],
)
def test_missing_required_custom_capability_fails_preflight(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capability: str
):
    capabilities = {
        "singleTurn": True,
        "resume": True,
        "structuredEvents": True,
        "telemetry": False,
        "skillInvocationEvidence": True,
    }
    key = {
        "single_turn": "singleTurn",
        "resume": "resume",
        "structured_events": "structuredEvents",
        "skill_invocation_evidence": "skillInvocationEvidence",
    }[capability]
    capabilities[key] = False
    _write_adapter(tmp_path, capabilities=capabilities)
    monkeypatch.setenv("COMET_EVAL_ADAPTERS_DIR", str(tmp_path))

    with pytest.raises(ValueError, match=capability):
        validate_agent_capabilities(get_agent_adapter("fixture-agent"))


def test_custom_registry_rejects_malformed_duplicate_and_escape_entries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _write_adapter(tmp_path, name="first")
    second = _write_adapter(tmp_path, name="second")
    second.write_text(second.read_text(encoding="utf-8").replace("id: second", "id: first"), encoding="utf-8")
    outside = tmp_path.parent / "outside-adapter.yaml"
    outside.write_text("not an adapter\n", encoding="utf-8")
    escaped = tmp_path / "escaped"
    try:
        escaped.symlink_to(outside.parent, target_is_directory=True)
    except OSError:
        pass
    monkeypatch.setenv("COMET_EVAL_ADAPTERS_DIR", str(tmp_path))

    with pytest.raises(ValueError, match="duplicate|outside|invalid|match|escapes"):
        discover_custom_agent_specs()


def test_custom_adapter_does_not_infer_skill_invocation_from_artifacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _write_adapter(tmp_path)
    monkeypatch.setenv("COMET_EVAL_ADAPTERS_DIR", str(tmp_path))
    adapter = get_agent_adapter("fixture-agent")

    assert adapter.has_observable_skill_invocation({"artifacts": ["SKILL.md"]}) is False
    assert adapter.has_observable_skill_invocation({"skill_invocations": ["fixture-agent"]}) is True


def test_custom_adapter_capability_filters_non_observable_skill_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    capabilities = {
        "singleTurn": True,
        "resume": True,
        "structuredEvents": True,
        "telemetry": False,
        "skillInvocationEvidence": False,
    }
    _write_adapter(tmp_path, capabilities=capabilities)
    monkeypatch.setenv("COMET_EVAL_ADAPTERS_DIR", str(tmp_path))
    adapter = get_agent_adapter("fixture-agent")
    events = {"skills_invoked": ["demo"], "skill_invocations": ["demo"]}

    assert normalize_skill_invocations(events, adapter=adapter) == []
