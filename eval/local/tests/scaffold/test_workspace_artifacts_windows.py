"""原生 Windows 句柄读取测试；输入仅为本测试创建的临时普通文件。"""

import os
import subprocess
from pathlib import Path

import pytest

from scaffold.python.generic_llm_judge import _collect_workspace_artifacts
from scaffold.python.workspace_artifacts import (
    WorkspaceArtifactError,
    iter_workspace_paths,
    read_workspace_text,
)

pytestmark = pytest.mark.skipif(os.name != "nt", reason="需要原生 Windows 文件句柄 API")


def _junction(link: Path, target: Path) -> None:
    subprocess.run(
        ["cmd", "/d", "/c", "mklink", "/J", str(link), str(target)],
        check=True, capture_output=True,
    )


def test_windows_reads_unicode_nested_text(tmp_path):
    root = tmp_path / "工作区 space 😀"
    path = root / "嵌套 📁" / "结果 📝.txt"
    path.parent.mkdir(parents=True)
    path.write_text("正常文本\nsecond line", encoding="utf-8")
    assert read_workspace_text(root, path) == "正常文本\nsecond line"
    assert "正常文本" in _collect_workspace_artifacts(root)

    from conftest import _save_artifacts

    _save_artifacts(tmp_path / "report", "WINDOWS_TEXT", 1, root)
    saved = tmp_path / "report/artifacts/windows_text_rep1/claude" / path.relative_to(root)
    assert saved.read_text(encoding="utf-8") == "正常文本\nsecond line"


@pytest.mark.parametrize("extended_prefix", [False, True])
def test_windows_reads_long_path(tmp_path, extended_prefix):
    # 扩展长度路径同时覆盖 workspace 根和它下面的相对路径。
    root = Path("\\\\?\\" + str(tmp_path.absolute()))
    root = root / ("a" * 90) / ("b" * 90) / ("c" * 90)
    path = root / "更多目录 😀" / "result.txt"
    path.parent.mkdir(parents=True)
    path.write_text("long path fixture", encoding="utf-8")
    try:
        assert len(str(root)) > 260
        read_root = root if extended_prefix else Path(str(root)[4:])
        read_path = path if extended_prefix else Path(str(path)[4:])
        assert read_workspace_text(read_root, read_path) == "long path fixture"
    finally:
        path.unlink()
        path.parent.rmdir()
        root.rmdir()
        root.parent.rmdir()
        root.parent.parent.rmdir()


@pytest.mark.parametrize("internal", [False, True])
def test_windows_skips_junctions(tmp_path, internal):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "normal.txt").write_text("normal fixture", encoding="utf-8")
    target = root / "inside" if internal else tmp_path / "outside"
    target.mkdir()
    (target / "detail.txt").write_text("junction target fixture", encoding="utf-8")
    link = root / "linked"
    _junction(link, target)
    try:
        assert read_workspace_text(root, link / "detail.txt") is None
        assert all(
            "linked" not in path.relative_to(root).parts for path in iter_workspace_paths(root)
        )
        result = _collect_workspace_artifacts(root)
        assert "linked" not in result
        assert "normal fixture" in result
        if not internal:
            assert "junction target fixture" not in result
    finally:
        link.rmdir()


def test_windows_rejects_junction_root(tmp_path):
    target = tmp_path / "target"
    target.mkdir()
    (target / "text.txt").write_text("root fixture", encoding="utf-8")
    link = tmp_path / "alias"
    _junction(link, target)
    try:
        assert read_workspace_text(link, link / "text.txt") is None
        assert list(iter_workspace_paths(link)) == []
    finally:
        link.rmdir()


@pytest.mark.parametrize("outcome", ["success", "missing", "directory", "oversize", "decode"])
def test_windows_releases_handles(tmp_path, outcome):
    root = tmp_path / "workspace"
    nested = root / "nested"
    nested.mkdir(parents=True)
    path = nested / "result.txt"
    path.write_bytes(b"text" if outcome != "decode" else b"\xff")
    if outcome == "missing":
        path.unlink()
        assert read_workspace_text(root, path) is None
    elif outcome == "directory":
        assert read_workspace_text(root, nested) is None
    elif outcome == "oversize":
        assert read_workspace_text(root, path, max_bytes=1) is None
    elif outcome == "decode":
        with pytest.raises(UnicodeDecodeError):
            read_workspace_text(root, path)
    else:
        assert read_workspace_text(root, path) == "text"
    # 打开的句柄未共享 DELETE；仍持有任何一级句柄时重命名会失败。
    renamed = tmp_path / "renamed"
    root.rename(renamed)
    path = renamed / "nested/result.txt"
    path.unlink(missing_ok=True)
    (renamed / "nested").rmdir()
    renamed.rmdir()


def test_windows_skips_sharing_conflict(tmp_path):
    from scaffold.python.workspace_artifacts_windows import get_windows_file_api

    root = tmp_path / "workspace"
    root.mkdir()
    path = root / "result.txt"
    path.write_text("fixture", encoding="utf-8")
    api = get_windows_file_api()
    handle = api.create_file(str(path), 0x40000000, 0, None, 3, 0, None)
    import ctypes

    assert handle != ctypes.c_void_p(-1).value
    try:
        assert read_workspace_text(root, path) is None
    finally:
        api.close_handle(handle)
    assert read_workspace_text(root, path) == "fixture"


@pytest.mark.parametrize("code", [1, 50, 87, 120])
def test_windows_api_errors_are_environment_failures(code):
    from scaffold.python.workspace_artifacts_windows import _raise_windows_error

    with pytest.raises(WorkspaceArtifactError, match="后端失败"):
        _raise_windows_error(code)
