"""Unit tests for LangSmith eval suite configuration helpers."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_langsmith_conftest():
    eval_root = Path(__file__).resolve().parents[3]
    conftest_path = eval_root / "langsmith" / "tests" / "conftest.py"
    spec = importlib.util.spec_from_file_location("_test_langsmith_conftest", conftest_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_langsmith_env_derives_claude_code_plugin_settings(monkeypatch):
    module = _load_langsmith_conftest()
    for key in (
        "LANGSMITH_API_KEY",
        "LANGSMITH_PROJECT",
        "LANGSMITH_TRACING",
        "TRACE_TO_LANGSMITH",
        "CC_LANGSMITH_API_KEY",
        "CC_LANGSMITH_PROJECT",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2_pt_test")
    monkeypatch.setenv("LANGSMITH_PROJECT", "comet-tests")

    module.configure_langsmith_environment()

    assert module.os.environ["LANGSMITH_TRACING"] == "true"
    assert module.os.environ["TRACE_TO_LANGSMITH"] == "true"
    assert module.os.environ["CC_LANGSMITH_API_KEY"] == "lsv2_pt_test"
    assert module.os.environ["CC_LANGSMITH_PROJECT"] == "comet-tests"


def test_langsmith_env_preserves_explicit_claude_code_overrides(monkeypatch):
    module = _load_langsmith_conftest()
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2_pt_eval")
    monkeypatch.setenv("LANGSMITH_PROJECT", "eval-project")
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("TRACE_TO_LANGSMITH", "custom")
    monkeypatch.setenv("CC_LANGSMITH_API_KEY", "lsv2_pt_plugin")
    monkeypatch.setenv("CC_LANGSMITH_PROJECT", "plugin-project")

    module.configure_langsmith_environment()

    assert module.os.environ["LANGSMITH_TRACING"] == "false"
    assert module.os.environ["TRACE_TO_LANGSMITH"] == "custom"
    assert module.os.environ["CC_LANGSMITH_API_KEY"] == "lsv2_pt_plugin"
    assert module.os.environ["CC_LANGSMITH_PROJECT"] == "plugin-project"
