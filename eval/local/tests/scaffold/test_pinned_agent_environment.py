"""Legacy image templates must honor an explicit Agent version."""

from pathlib import Path
from types import SimpleNamespace

import conftest


def legacy_environment(root: Path) -> Path:
    root.mkdir()
    (root / "Dockerfile").write_text(
        "FROM python:3.12-slim\nWORKDIR /workspace\n"
        "RUN npm install -g @fission-ai/openspec@1.3.1 && \\\n"
        "    npm install -g @anthropic-ai/claude-code@latest\n"
        "COPY business.py /workspace/\n"
    )
    (root / "business.py").write_bytes(b"original business input\r\n")
    return root


def test_copied_legacy_environment_honors_selected_claude_version(
    tmp_path, setup_test_context, monkeypatch
):
    source = legacy_environment(tmp_path / "source")
    original = (source / "Dockerfile").read_bytes()
    monkeypatch.setenv("BENCH_CC_VERSION", "2.1.318")
    workspace = setup_test_context(environment_dir=source)
    content = (workspace / "Dockerfile").read_text()
    assert "ARG CLAUDE_CODE_VERSION=latest" in content
    assert "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" in content
    assert "@anthropic-ai/claude-code@latest" not in content
    assert "@fission-ai/openspec@1.3.1" in content
    assert (workspace / "business.py").read_bytes() == b"original business input\r\n"
    assert (source / "Dockerfile").read_bytes() == original


def test_session_prebuild_uses_the_same_pinned_environment(tmp_path, monkeypatch):
    source = legacy_environment(tmp_path / "source")
    monkeypatch.setenv("BENCH_CC_VERSION", "2.1.318")
    monkeypatch.setattr(conftest, "_is_unit_tests_only", lambda config: False)
    monkeypatch.setattr(conftest, "_getoption", lambda *args: "COMET_FULL_040_BETA")
    monkeypatch.setattr(conftest, "_docker_environment_dirs_for_request", lambda *args: [source])
    monkeypatch.setattr(
        conftest, "_resolve_eval_agent", lambda config: SimpleNamespace(agent="claude-code")
    )
    built = []

    def build(directory, *args, **kwargs):
        built.append((directory / "Dockerfile").read_text())
        assert "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" in built[-1]
        assert (directory / "business.py").read_bytes() == b"original business input\r\n"
        return "prepared-image"

    monkeypatch.setattr(conftest, "_build_docker_image_with_lock", build)
    request = SimpleNamespace(config=SimpleNamespace(option=SimpleNamespace(collectonly=False)))
    fixture = conftest.prebuild_docker_image.__wrapped__(request)
    next(fixture)
    assert len(built) == 1
    fixture.close()


def test_unpinned_legacy_environment_retains_authored_bytes(
    tmp_path, setup_test_context, monkeypatch
):
    source = legacy_environment(tmp_path / "source")
    monkeypatch.delenv("BENCH_CC_VERSION", raising=False)
    workspace = setup_test_context(environment_dir=source)
    assert "@anthropic-ai/claude-code@latest" in (workspace / "Dockerfile").read_text()
