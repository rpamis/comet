"""Execution identity must inspect an image prepared with the build budget."""

import json
import subprocess
from types import SimpleNamespace

import pytest
import conftest


def test_execution_identity_builds_the_prepared_workspace_before_inspecting(tmp_path, monkeypatch):
    stages = []
    monkeypatch.setattr(conftest, "_plugin", None)
    monkeypatch.setattr(conftest, "_model_execution_config", lambda: {})
    monkeypatch.setattr(
        conftest, "build_execution_identity", lambda *args, **kwargs: {"safe": True}
    )

    def build(directory, agent=None, **kwargs):
        assert directory == tmp_path
        stages.append("bounded-build")
        return "prepared-image"

    def inspect(*args, **kwargs):
        assert stages == ["bounded-build"], (
            "A cold build must not run behind the 300s identity timeout"
        )
        assert args[:2] == ("docker.sh", "execution-identity")
        stages.append("identity-read")
        return subprocess.CompletedProcess(
            args, 0, json.dumps({"runtime_image_id": "prepared-image"}), ""
        )

    monkeypatch.setattr(conftest, "_build_docker_image_with_lock", build)
    monkeypatch.setattr(conftest, "run_shell", inspect)
    captured = conftest._capture_execution_identity(
        tmp_path, model="test-model", interaction=SimpleNamespace(goal=False)
    )
    assert stages == ["bounded-build", "identity-read"]
    assert captured.runtime_image_id == "prepared-image"


def test_execution_identity_preserves_a_real_build_failure_without_inspecting(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(conftest, "_plugin", None)

    def build(*args, **kwargs):
        raise RuntimeError("original build failed")

    def inspect(*args, **kwargs):
        raise AssertionError("Do not inspect or invoke a model after image preparation failed")

    monkeypatch.setattr(conftest, "_build_docker_image_with_lock", build)
    monkeypatch.setattr(conftest, "run_shell", inspect)
    with pytest.raises(RuntimeError, match="original build failed"):
        conftest._capture_execution_identity(
            tmp_path, model="test-model", interaction=SimpleNamespace(goal=False)
        )
