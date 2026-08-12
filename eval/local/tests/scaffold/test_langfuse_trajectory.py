"""Contract tests for Langfuse trajectory provisioning and transcript adapters."""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

from scaffold.python.langfuse_adapter import (
    LangfuseRunReporter,
    TrajectoryProvisionError,
    TrajectoryProvision,
    install_codex_plugin_workspace,
    install_transcript_hook,
    parse_agent_transcript,
    provision_trajectory_plugin,
    trajectory_mode,
)


def _archive_bytes(files: dict[str, str]) -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        for name, content in files.items():
            payload = content.encode("utf-8")
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
    return stream.getvalue()


def test_trajectory_modes_cover_all_supported_agent_contracts():
    assert trajectory_mode("claude-code") == "official-claude-code-plugin"
    assert trajectory_mode("codex") == "official-codex-plugin"
    assert trajectory_mode("qoder") == "qoder-stop-transcript"
    assert trajectory_mode("codebuddy") == "codebuddy-stop-transcript"


def test_plugin_provision_is_pinned_hashed_cached_and_credential_free(tmp_path: Path):
    archive = _archive_bytes(
        {
            "langfuse-plugin/plugins/tracing/hooks/hooks.json": '{"hooks": {}}\n',
            "langfuse-plugin/plugins/tracing/dist/index.mjs": "export {};\n",
        }
    )
    calls = []

    def download(url: str, destination: Path) -> None:
        calls.append(url)
        destination.write_bytes(archive)

    first = provision_trajectory_plugin(tmp_path, "codex", download=download)

    assert first.mode == "official-codex-plugin"
    assert first.plugin_path is not None
    assert (first.plugin_path / "plugins" / "tracing" / "hooks" / "hooks.json").is_file()
    metadata = json.loads((first.cache_dir / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["source_ref"]
    assert metadata["archive_sha256"]
    assert metadata["content_sha256"]
    assert "LANGFUSE_SECRET_KEY" not in json.dumps(metadata)

    second = provision_trajectory_plugin(
        tmp_path,
        "codex",
        download=lambda *_args: pytest.fail("cache hit must not download"),
    )
    assert second.plugin_path == first.plugin_path
    assert len(calls) == 1

    (first.plugin_path / "plugins" / "tracing" / "dist" / "index.mjs").write_text(
        "tampered\n", encoding="utf-8"
    )
    with pytest.raises(TrajectoryProvisionError, match="integrity"):
        provision_trajectory_plugin(tmp_path, "codex", download=lambda *_args: None)


def test_qoder_and_codebuddy_transcripts_normalize_messages_tools_and_bounds(tmp_path: Path):
    transcript = tmp_path / "session.jsonl"
    transcript.write_text(
        "\n".join(
            [
                json.dumps({"type": "session_meta", "sessionId": "s-1", "data": {"model": "m"}}),
                json.dumps({"type": "user", "message": {"content": "Please inspect"}}),
                json.dumps(
                    {
                        "type": "assistant",
                        "message": {
                            "content": [
                                {"type": "text", "text": "I will inspect."},
                                {
                                    "type": "tool_use",
                                    "name": "read_file",
                                    "input": {"path": "a.py"},
                                },
                            ]
                        },
                    }
                ),
                json.dumps(
                    {
                        "type": "user",
                        "message": {
                            "content": [
                                {"type": "tool_result", "tool_use_id": "t-1", "content": "x" * 100}
                            ]
                        },
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    events = parse_agent_transcript(transcript, max_chars=32)

    assert [event.kind for event in events] == ["session", "user", "text", "tool", "tool_result"]
    assert events[0].session_id == "s-1"
    assert events[3].name == "read_file"
    assert events[-1].truncated is True
    assert len(events[-1].output) <= 32


def test_transcript_hook_is_project_local_and_preserves_existing_settings(tmp_path: Path):
    settings = tmp_path / ".codebuddy" / "settings.json"
    settings.parent.mkdir(parents=True)
    settings.write_text(
        json.dumps({"custom": True, "hooks": {"Stop": [{"custom": True}]}}), encoding="utf-8"
    )

    trajectory_path = install_transcript_hook(tmp_path, "codebuddy")

    assert trajectory_path == tmp_path / ".comet" / "eval" / "langfuse" / "trajectories"
    hook_path = tmp_path / ".codebuddy" / "hooks" / "langfuse-stop-hook.py"
    assert hook_path.is_file()
    hook_source = hook_path.read_text(encoding="utf-8")
    assert "COMET_EVAL_AGENT_ROLE" in hook_source
    assert "hashlib.sha256" in hook_source
    saved = json.loads(settings.read_text(encoding="utf-8"))
    assert saved["custom"] is True
    assert len(saved["hooks"]["Stop"]) == 2
    assert "LANGFUSE_SECRET_KEY" not in settings.read_text(encoding="utf-8")

    transcript = tmp_path / "transcript.jsonl"
    transcript.write_text(
        '{"type":"assistant","message":{"content":"done"}}\n',
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, str(hook_path)],
        input=json.dumps(
            {
                "hook_event_name": "Stop",
                "transcript_path": str(transcript),
                "cwd": str(tmp_path),
            }
        ),
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert list(
        (tmp_path / ".comet" / "eval" / "langfuse" / "trajectories").glob("*.jsonl")
    )


def test_codex_plugin_is_copied_into_the_project_codex_home_cache(tmp_path: Path):
    plugin = tmp_path / "plugin"
    tracing = plugin / "plugins" / "tracing"
    (tracing / ".codex-plugin").mkdir(parents=True)
    (tracing / ".codex-plugin" / "plugin.json").write_text(
        json.dumps({"version": "0.1.0"}), encoding="utf-8"
    )
    (tracing / "dist").mkdir()
    (tracing / "dist" / "index.mjs").write_text("export {};\n", encoding="utf-8")
    provision = TrajectoryProvision(
        agent="codex",
        mode="official-codex-plugin",
        cache_dir=tmp_path,
        plugin_path=plugin,
    )

    workspace = tmp_path / "workspace"
    (workspace / ".codex").mkdir(parents=True)
    (workspace / ".codex" / "config.toml").write_text(
        '[features]\nother = true\n\n[profiles.default]\nmodel = "x"\n',
        encoding="utf-8",
    )
    install_codex_plugin_workspace(workspace, provision)

    installed = (
        workspace
        / ".codex"
        / "plugins"
        / "cache"
        / "codex-observability-plugin"
        / "tracing"
        / "0.1.0"
    )
    assert (installed / "dist" / "index.mjs").is_file()
    config = (workspace / ".codex" / "config.toml").read_text(encoding="utf-8")
    assert "hooks = true" in config
    assert 'plugins."tracing@codex-observability-plugin"' in config
    assert config.index("hooks = true") < config.index("[profiles.default]")


class _Observation:
    trace_id = "trace-1"
    id = "observation-1"

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def update(self, **payload):
        self.output = payload.get("output")


class _Client:
    def __init__(self):
        self.observations = []
        self.scores = []

    def start_as_current_observation(self, **kwargs):
        self.observations.append(kwargs)
        return _Observation()

    def create_score(self, **kwargs):
        self.scores.append(kwargs)


def test_reporter_maps_qoder_transcript_to_optional_child_observations(tmp_path: Path):
    transcript = tmp_path / "trajectory.jsonl"
    transcript.write_text(
        json.dumps({"type": "assistant", "sessionId": "s-1", "message": {"content": "done"}})
        + "\n",
        encoding="utf-8",
    )
    client = _Client()
    result = type("Result", (), {"passed": True, "checks_passed": ["ok"], "checks_failed": []})()
    reporter = LangfuseRunReporter(client)

    reporter.report_case(
        "task",
        "CONTROL",
        lambda: None,
        lambda: result,
        metadata={"agent": "qoder"},
        trajectory_path=transcript,
        agent="qoder",
    )

    assert client.observations[1]["as_type"] == "generation"
    assert client.observations[1]["name"].startswith("agent.text/")
