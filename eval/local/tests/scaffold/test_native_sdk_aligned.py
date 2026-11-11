"""Canonical business tasks can run with the current SDK without editing fixtures."""

import json

import pytest

from scaffold.python.native_eval import current_native_environment
from scaffold.python.validation import native_sdk


def test_current_native_environment_preserves_business_files_and_original(tmp_path):
    source = tmp_path / "original"
    source.mkdir()
    dockerfile = "FROM python:3.12-slim\nRUN mkdir -p openspec/changes\nUSER agent\n"
    (source / "Dockerfile").write_text(dockerfile)
    (source / "business.py").write_bytes(b"original business input\n")
    with current_native_environment(source, "COMET_NATIVE_SDK_CURRENT") as prepared:
        assert prepared != source
        assert (prepared / "business.py").read_bytes() == b"original business input\n"
        assert (prepared / ".include-current-comet-cli").is_file()
        content = (prepared / "Dockerfile").read_text()
        assert "--from=node:22-bookworm-slim" in content
        assert "RUN mkdir -p openspec/changes" not in content
        assert content.rstrip().endswith("USER agent")
        assert (prepared / "current-comet.sh").is_file()
    assert (source / "Dockerfile").read_text() == dockerfile
    assert not (source / ".include-current-comet-cli").exists()


def test_legacy_and_already_current_environments_are_preserved(tmp_path):
    with current_native_environment(tmp_path, "COMET_NATIVE_PHASE1") as prepared:
        assert prepared == tmp_path
    (tmp_path / ".include-current-comet-cli").touch()
    with current_native_environment(tmp_path, "COMET_NATIVE_SDK_CURRENT") as prepared:
        assert prepared == tmp_path


@pytest.mark.parametrize("status", ["active", "blocked", "completed"])
def test_native_sdk_archive_requires_original_completed_run(tmp_path, monkeypatch, status):
    archive = tmp_path / "docs/comet/archive/2026-11-11-example"
    archive.mkdir(parents=True)
    (archive / "comet-state.yaml").write_text("name: example\n")
    calls = []

    def inspect(*args):
        calls.append(args)
        return {
            "runId": "example",
            "status": status,
            "actions": [{"id": "final", "stepId": "archive.finalize", "status": "succeeded"}],
        }

    monkeypatch.setattr(native_sdk, "inspect_run", inspect)
    result = native_sdk.check_archived_runs(tmp_path)
    assert bool(result["failed"]) == (status != "completed")
    assert calls[0][1:4] == ("native", "example", "native")
    if status == "completed":
        assert result["passed"] == ["sdk_run"]
        assert result["validation_evidence"]["example"]["run"]["runId"] == "example"
        json.dumps(result)


def test_native_sdk_archive_does_not_accept_missing_run(tmp_path):
    result = native_sdk.check_archived_runs(tmp_path)
    assert result["failed"]
    assert not result["passed"]
