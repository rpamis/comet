"""Tests for standalone eval execution and Judge resolution."""

from __future__ import annotations

import pytest

from scaffold.python.execution import (
    build_agent_environment,
    build_judge_environment,
    preflight_credentials,
    resolve_execution,
    resolve_judge,
)


def _install_fixture_adapter(root, monkeypatch):
    fixture = root / "fixture-agent"
    fixture.mkdir()
    (fixture / "adapter.yaml").write_text(
        """apiVersion: comet.eval.agent/v1alpha1
kind: EvalAgentAdapter
metadata:
  id: fixture-agent
  version: 1.0.0
runtime:
  executable: fixture-agent
  install:
    kind: none
credentials:
  - FIXTURE_AGENT_API_KEY
modelEnv: FIXTURE_AGENT_MODEL
baseUrlEnv: FIXTURE_AGENT_BASE_URL
capabilities:
  singleTurn: true
  resume: true
  structuredEvents: true
  telemetry: false
  skillInvocationEvidence: true
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("COMET_EVAL_ADAPTERS_DIR", str(root))


def test_main_resolution_uses_cli_then_manifest_then_legacy_environment():
    environment = {
        "BENCH_EVAL_AGENT": "qoder",
        "BENCH_QODER_MODEL": "legacy-qoder",
        "QODER_BASE_URL": "https://legacy.example/v1",
    }

    resolved = resolve_execution(
        cli_agent="codex",
        cli_model="cli-model",
        cli_base_url="https://cli.example/v1",
        manifest={
            "agent": "claude-code",
            "model": "manifest-model",
            "baseUrl": "https://manifest.example/v1",
        },
        source_env=environment,
    )

    assert (resolved.agent, resolved.model, resolved.base_url) == (
        "codex",
        "cli-model",
        "https://cli.example/v1",
    )
    assert resolved.sources == {"agent": "cli", "model": "cli", "base_url": "cli"}


def test_main_resolution_falls_back_to_selected_agent_legacy_defaults():
    resolved = resolve_execution(
        manifest={"agent": "codebuddy"},
        source_env={
            "BENCH_CODEBUDDY_MODEL": "legacy-codebuddy",
            "CODEBUDDY_BASE_URL": "https://codebuddy.example/v1",
        },
    )

    assert resolved.agent == "codebuddy"
    assert resolved.model == "legacy-codebuddy"
    assert resolved.base_url == "https://codebuddy.example/v1"


def test_judge_inherits_only_main_agent_and_requires_independent_model():
    main = resolve_execution(cli_agent="codex", cli_model="subject-model")

    judge = resolve_judge(main=main, manifest={"model": "judge-model"}, source_env={})

    assert judge is not None
    assert judge.agent == "codex"
    assert judge.model == "judge-model"
    assert judge.base_url is None
    assert judge.model != main.model

    with pytest.raises(ValueError, match="BENCH_JUDGE_MODEL"):
        resolve_judge(main=main, manifest={}, source_env={})


def test_judge_cli_and_dedicated_environment_never_inherit_main_provider_values():
    main = resolve_execution(
        cli_agent="claude-code",
        cli_model="subject-model",
        cli_base_url="https://subject.example/v1",
        source_env={"ANTHROPIC_API_KEY": "subject-key"},
    )
    judge = resolve_judge(
        main=main,
        cli_agent="codebuddy",
        cli_model="judge-model",
        cli_base_url="https://judge.example/v1",
        source_env={
            "BENCH_JUDGE_API_KEY": "judge-key",
            "ANTHROPIC_API_KEY": "subject-key",
            "ANTHROPIC_BASE_URL": "https://subject.example/v1",
        },
    )

    assert judge is not None
    child_env = build_judge_environment(judge, source_env={
        "BENCH_JUDGE_API_KEY": "judge-key",
        "ANTHROPIC_API_KEY": "subject-key",
        "ANTHROPIC_BASE_URL": "https://subject.example/v1",
    })
    assert child_env["CODEBUDDY_API_KEY"] == "judge-key"
    assert child_env["CODEBUDDY_BASE_URL"] == "https://judge.example/v1"
    assert "ANTHROPIC_API_KEY" not in child_env
    assert "ANTHROPIC_BASE_URL" not in child_env
    assert "subject-key" not in child_env.values()


def test_main_environment_maps_model_and_url_through_each_builtin_adapter():
    expected = {
        "claude-code": ("ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL"),
        "codex": ("OPENAI_MODEL", "OPENAI_BASE_URL"),
        "qoder": ("QODER_MODEL", "QODER_BASE_URL"),
        "codebuddy": ("CODEBUDDY_MODEL", "CODEBUDDY_BASE_URL"),
    }

    for agent, (model_key, url_key) in expected.items():
        resolved = resolve_execution(
            cli_agent=agent,
            cli_model=f"{agent}-model",
            cli_base_url=f"https://{agent}.example/v1",
        )
        child_env = build_agent_environment(
            resolved,
            source_env={"OPENAI_API_KEY": "main-key"},
        )
        assert child_env[model_key] == f"{agent}-model"
        assert child_env[url_key] == f"https://{agent}.example/v1"


def test_common_subject_settings_map_to_each_builtin_agent():
    expected = {
        "claude-code": ("ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", True),
        "codex": ("OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_API_KEY", True),
        "qoder": ("QODER_MODEL", "QODER_BASE_URL", "QODER_PERSONAL_ACCESS_TOKEN", False),
        "codebuddy": ("CODEBUDDY_MODEL", "CODEBUDDY_BASE_URL", "CODEBUDDY_API_KEY", True),
    }
    source = {
        "BENCH_MODEL": "bench-model",
        "BENCH_BASE_URL": "https://bench.example/v1",
        "BENCH_API_KEY": "bench-key",
    }

    for agent, (model_key, url_key, credential_key, uses_common_url) in expected.items():
        resolved = resolve_execution(cli_agent=agent, source_env=source)
        child_env = build_agent_environment(resolved, source_env=source)

        assert resolved.model == "bench-model"
        assert resolved.base_url == ("https://bench.example/v1" if uses_common_url else None)
        assert child_env[model_key] == "bench-model"
        assert child_env[credential_key] == "bench-key"
        if uses_common_url:
            assert child_env[url_key] == "https://bench.example/v1"
        else:
            assert url_key not in child_env


def test_explicit_subject_credentials_override_common_fallback():
    resolved = resolve_execution(
        cli_agent="claude-code",
        source_env={"BENCH_API_KEY": "fallback-key", "ANTHROPIC_API_KEY": "explicit-key"},
    )

    child_env = build_agent_environment(
        resolved,
        source_env={"BENCH_API_KEY": "fallback-key", "ANTHROPIC_API_KEY": "explicit-key"},
    )

    assert child_env["ANTHROPIC_API_KEY"] == "explicit-key"


def test_common_subject_api_key_satisfies_preflight():
    main = resolve_execution(
        cli_agent="codex",
        source_env={"BENCH_MODEL": "bench-model", "BENCH_API_KEY": "bench-key"},
    )

    assert preflight_credentials(main, None, source_env={"BENCH_API_KEY": "bench-key"}) == []


def test_explicit_agent_model_and_base_url_override_common_fallbacks():
    resolved = resolve_execution(
        cli_agent="codex",
        source_env={
            "BENCH_MODEL": "common-model",
            "BENCH_BASE_URL": "https://common.example/v1",
            "OPENAI_MODEL": "native-model",
            "OPENAI_BASE_URL": "https://native.example/v1",
        },
    )

    assert resolved.model == "native-model"
    assert resolved.base_url == "https://native.example/v1"


def test_custom_agent_environment_preserves_declared_runtime_contract(
    tmp_path, monkeypatch
):
    _install_fixture_adapter(tmp_path, monkeypatch)

    resolved = resolve_execution(
        cli_agent="fixture-agent",
        cli_model="fixture-model",
        cli_base_url="https://fixture.example/v1",
    )
    child_env = build_agent_environment(
        resolved,
        source_env={"FIXTURE_AGENT_API_KEY": "main-secret"},
    )

    assert child_env["FIXTURE_AGENT_MODEL"] == "fixture-model"
    assert child_env["FIXTURE_AGENT_BASE_URL"] == "https://fixture.example/v1"
    assert child_env["COMET_EVAL_CUSTOM_AGENT_ID"] == "fixture-agent"
    assert child_env["COMET_EVAL_CUSTOM_CREDENTIALS"] == "FIXTURE_AGENT_API_KEY"


def test_custom_judge_environment_uses_only_dedicated_credentials(tmp_path, monkeypatch):
    _install_fixture_adapter(tmp_path, monkeypatch)
    main = resolve_execution(cli_agent="codex", cli_model="subject-model")
    judge = resolve_judge(
        main=main,
        cli_agent="fixture-agent",
        cli_model="judge-model",
        cli_base_url="https://judge.example/v1",
        source_env={"BENCH_JUDGE_API_KEY": "judge-secret"},
    )
    assert judge is not None

    child_env = build_judge_environment(
        judge,
        source_env={
            "BENCH_JUDGE_API_KEY": "judge-secret",
            "FIXTURE_AGENT_API_KEY": "main-secret",
            "OPENAI_API_KEY": "subject-secret",
        },
    )

    assert child_env["FIXTURE_AGENT_API_KEY"] == "judge-secret"
    assert child_env["FIXTURE_AGENT_MODEL"] == "judge-model"
    assert child_env["FIXTURE_AGENT_BASE_URL"] == "https://judge.example/v1"
    assert "main-secret" not in child_env.values()
    assert "subject-secret" not in child_env.values()


def test_custom_main_credentials_require_all_declared_values(tmp_path, monkeypatch):
    _install_fixture_adapter(tmp_path, monkeypatch)
    adapter_path = tmp_path / "fixture-agent" / "adapter.yaml"
    adapter_path.write_text(
        adapter_path.read_text(encoding="utf-8").replace(
            "  - FIXTURE_AGENT_API_KEY\n", "  - FIXTURE_AGENT_API_KEY\n  - FIXTURE_AGENT_AUTH_TOKEN\n"
        ),
        encoding="utf-8",
    )
    main = resolve_execution(cli_agent="fixture-agent", cli_model="subject-model")

    assert preflight_credentials(
        main,
        None,
        source_env={"FIXTURE_AGENT_API_KEY": "main-secret"},
    ) == ["main credentials missing for fixture-agent: FIXTURE_AGENT_AUTH_TOKEN"]

    judge = resolve_judge(
        main=main,
        cli_agent="fixture-agent",
        cli_model="judge-model",
        source_env={"BENCH_JUDGE_API_KEY": "judge-secret"},
    )
    assert judge is not None
    assert preflight_credentials(
        main,
        judge,
        source_env={
            "FIXTURE_AGENT_API_KEY": "main-secret",
            "FIXTURE_AGENT_AUTH_TOKEN": "main-token",
            "BENCH_JUDGE_API_KEY": "judge-secret",
        },
    ) == ["judge credentials missing: BENCH_JUDGE_AUTH_TOKEN"]


def test_custom_judge_without_declared_credentials_needs_no_judge_secret(tmp_path, monkeypatch):
    _install_fixture_adapter(tmp_path, monkeypatch)
    adapter_path = tmp_path / "fixture-agent" / "adapter.yaml"
    adapter_path.write_text(
        adapter_path.read_text(encoding="utf-8").replace(
            "credentials:\n  - FIXTURE_AGENT_API_KEY\n", "credentials: []\n"
        ),
        encoding="utf-8",
    )
    main = resolve_execution(cli_agent="fixture-agent", cli_model="subject-model")
    judge = resolve_judge(
        main=main,
        cli_agent="fixture-agent",
        cli_model="judge-model",
        source_env={},
    )

    assert judge is not None
    assert preflight_credentials(main, judge, source_env={}) == []
    child_env = build_judge_environment(judge, source_env={})
    assert "BENCH_JUDGE_API_KEY" not in child_env


def test_judge_legacy_environment_is_independent_from_main_environment():
    main = resolve_execution(
        cli_agent="claude-code",
        source_env={
            "BENCH_CC_MODEL": "subject-model",
            "ANTHROPIC_BASE_URL": "https://subject.example",
        },
    )
    judge = resolve_judge(
        main=main,
        source_env={
            "BENCH_LLM_JUDGE": "1",
            "BENCH_JUDGE_MODEL": "judge-model",
            "BENCH_JUDGE_BASE_URL": "https://judge.example",
            "BENCH_JUDGE_AUTH_TOKEN": "judge-token",
            "ANTHROPIC_BASE_URL": "https://subject.example",
        },
    )

    assert judge is not None
    assert (judge.model, judge.base_url) == ("judge-model", "https://judge.example")


def test_preflight_reports_missing_main_and_judge_credentials_without_values():
    main = resolve_execution(cli_agent="codex", cli_model="subject-model")
    judge = resolve_judge(
        main=main,
        cli_agent="claude-code",
        cli_model="judge-model",
        source_env={},
    )

    errors = preflight_credentials(main, judge, source_env={})

    assert errors == [
        "main credentials missing for codex: OPENAI_API_KEY or CODEX_API_KEY",
        "judge credentials missing: BENCH_JUDGE_API_KEY or BENCH_JUDGE_AUTH_TOKEN",
    ]
