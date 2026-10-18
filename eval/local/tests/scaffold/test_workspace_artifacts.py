"""工件读取边界的纯单元测试；所有输入均为测试自建临时文件。"""

import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from scaffold.python.generic_llm_judge import _collect_workspace_artifacts
from scaffold.python.workspace_artifacts import WorkspaceArtifactError, read_workspace_text


def _symlink(path, target, *, target_is_directory=False):
    try:
        path.symlink_to(target, target_is_directory=target_is_directory)
    except OSError as exc:
        if os.name == "nt" and getattr(exc, "winerror", None) == 1314:
            pytest.skip("此 Windows 主机不允许创建符号链接；junction 由专属测试覆盖")
        raise


def _disable_support(monkeypatch, missing_capability="dir_fd"):
    if os.name == "nt":
        from scaffold.python import workspace_artifacts_windows

        def unavailable():
            raise WorkspaceArtifactError("不支持无符号链接工件读取: Windows API unavailable")

        monkeypatch.setattr(workspace_artifacts_windows, "get_windows_file_api", unavailable)
    elif missing_capability == "dir_fd":
        monkeypatch.setattr(os, "supports_dir_fd", set())
    else:
        monkeypatch.delattr(os, "O_NOFOLLOW")


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    (root / "nested").mkdir(parents=True)
    (root / "result.txt").write_text("normal result", encoding="utf-8")
    (root / "nested/detail.txt").write_text("nested result", encoding="utf-8")
    return root


@pytest.fixture(params=["judge", "report"])
def collect(request, tmp_path, monkeypatch):
    import conftest

    def forbid_execution(*args, **kwargs):
        pytest.fail("单元测试不得执行外部命令")

    monkeypatch.setattr(conftest, "run_python_in_docker", forbid_execution)
    if request.param == "judge":
        return _collect_workspace_artifacts

    def collect_report(root):
        conftest._save_artifacts(tmp_path, "TEXT_ONLY", 1, root)
        saved = tmp_path / "artifacts/text_only_rep1/claude"
        return "\n".join(
            f"{path.relative_to(saved)}: {path.read_text(encoding='utf-8')}"
            for path in sorted(saved.rglob("*"))
            if path.is_file()
        )

    return collect_report


def test_collects_normal_text(workspace, collect):
    result = collect(workspace)
    assert "normal result" in result
    assert "nested result" in result


@pytest.mark.parametrize("target_kind", ["internal", "external", "missing"])
def test_skips_file_symlinks(workspace, tmp_path, collect, target_kind):
    external = tmp_path / "workspace-other.txt"
    external.write_text("outside fixture text", encoding="utf-8")
    target = {
        "internal": workspace / "result.txt",
        "external": external,
        "missing": tmp_path / "absent.txt",
    }[target_kind]
    _symlink(workspace / "linked.txt", target)

    result = collect(workspace)
    assert "linked.txt" not in result
    assert "outside fixture text" not in result
    assert "normal result" in result


@pytest.mark.parametrize("external", [False, True])
def test_skips_directory_symlinks(workspace, tmp_path, collect, external):
    outside = tmp_path / "workspace-other"
    outside.mkdir()
    (outside / "outside.txt").write_text("outside directory fixture", encoding="utf-8")
    target = outside if external else workspace / "nested"
    _symlink(workspace / "linked-dir", target, target_is_directory=True)

    result = collect(workspace)
    assert "linked-dir" not in result
    assert "outside directory fixture" not in result
    assert "nested result" in result
    assert read_workspace_text(workspace, workspace / "linked-dir" / "detail.txt") is None


def test_skips_disappearing_file(workspace, collect, monkeypatch):
    original_walk = os.walk
    vanished = workspace / "vanished.txt"
    vanished.write_text("temporary fixture", encoding="utf-8")

    def walk(path, **kwargs):
        entries = list(original_walk(path, **kwargs))
        if path == workspace:
            vanished.unlink(missing_ok=True)
        return iter(entries)

    monkeypatch.setattr(os, "walk", walk)
    result = collect(workspace)
    assert "vanished.txt" not in result
    assert "normal result" in result


def test_rejects_paths_outside_workspace(workspace, tmp_path):
    sibling = tmp_path / "workspace-other"
    sibling.mkdir()
    (sibling / "result.txt").write_text("sibling fixture", encoding="utf-8")
    assert read_workspace_text(workspace, sibling / "result.txt") is None
    assert read_workspace_text(workspace, workspace / "../workspace-other/result.txt") is None
    assert read_workspace_text(workspace, workspace) is None


def test_rejects_symlink_workspace_root(workspace, tmp_path, collect):
    alias = tmp_path / "workspace-alias"
    _symlink(alias, workspace, target_is_directory=True)
    assert "normal result" not in collect(alias)


def test_regular_file_limits(workspace):
    path = workspace / "result.txt"
    assert read_workspace_text(workspace, path, limit=6) == "normal"
    assert read_workspace_text(workspace, path, max_bytes=3) is None


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="平台无 FIFO")
def test_skips_non_regular_file(workspace, collect):
    os.mkfifo(workspace / "pipe.txt")
    result = collect(workspace)
    assert "pipe.txt" not in result
    assert "normal result" in result


@pytest.mark.parametrize("missing_capability", ["dir_fd", "O_NOFOLLOW"])
@pytest.mark.parametrize("empty", [False, True])
def test_unsupported_platform_fails_collection(
    workspace, collect, monkeypatch, missing_capability, empty, tmp_path
):
    if empty:
        workspace = tmp_path / "empty"
        workspace.mkdir()
    _disable_support(monkeypatch, missing_capability)
    with pytest.raises(WorkspaceArtifactError, match="不支持无符号链接工件读取"):
        collect(workspace)


def test_unsupported_platform_never_invokes_judge(workspace, monkeypatch):
    from scaffold.python import generic_llm_judge

    def forbid_judge(*args, **kwargs):
        pytest.fail("缺少安全工件读取能力时不得评分")

    _disable_support(monkeypatch)
    monkeypatch.setattr(generic_llm_judge, "_run_judge", forbid_judge)
    with pytest.raises(WorkspaceArtifactError, match="不支持无符号链接工件读取"):
        generic_llm_judge.judge_generic_artifacts(workspace, {})


def test_unsupported_platform_fails_before_workloads(monkeypatch):
    import conftest

    _disable_support(monkeypatch)
    config = SimpleNamespace(args=["local/tests/tasks/test_tasks.py"], option=SimpleNamespace())
    with pytest.raises(pytest.UsageError, match="Eval harness 环境错误"):
        conftest._normal_run_preflight(config)


def test_unsupported_platform_does_not_overwrite_report(workspace, tmp_path, monkeypatch):
    import conftest

    saved = tmp_path / "artifacts/text_only_rep1/claude"
    saved.mkdir(parents=True)
    (saved / "result.txt").write_text("previous result", encoding="utf-8")
    _disable_support(monkeypatch)
    with pytest.raises(WorkspaceArtifactError):
        conftest._save_artifacts(tmp_path, "TEXT_ONLY", 1, workspace)
    assert (saved / "result.txt").read_text(encoding="utf-8") == "previous result"
    assert not (saved / "nested").exists()


def test_generic_rubric_does_not_swallow_artifact_environment_error(workspace, monkeypatch):
    from scaffold.python import generic_llm_judge
    from scaffold.python.profiles import run_profile_rubric

    def fail_collection(*args, **kwargs):
        raise WorkspaceArtifactError("fixture environment unsupported")

    monkeypatch.setenv("BENCH_LLM_JUDGE", "1")
    monkeypatch.setattr(generic_llm_judge, "judge_generic_messages", fail_collection)
    with pytest.raises(WorkspaceArtifactError, match="fixture environment unsupported"):
        run_profile_rubric("generic", workspace, {"completion": {"passed": [], "failed": []}})


def test_report_does_not_swallow_runtime_backend_error(workspace, tmp_path, monkeypatch):
    import conftest

    def unavailable(*args, **kwargs):
        raise WorkspaceArtifactError("fixture runtime API failure")

    monkeypatch.setattr(conftest, "read_workspace_text", unavailable)
    with pytest.raises(WorkspaceArtifactError, match="fixture runtime API failure"):
        conftest._save_artifacts(tmp_path, "TEXT_ONLY", 1, workspace)
