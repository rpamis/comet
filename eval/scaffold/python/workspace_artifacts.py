"""只读取工作区中的普通工件；文件和目录符号链接均跳过。"""

from __future__ import annotations

import os
import stat
from collections.abc import Iterator
from contextlib import ExitStack
from pathlib import Path


class WorkspaceArtifactError(RuntimeError):
    """宿主环境无法保证工件读取边界，必须停止相关评估。"""


def require_workspace_artifact_support() -> None:
    """缺少安全读取能力时报告环境错误，不能把缺失工件当作空工作区评分。"""
    if os.name == "nt":
        from scaffold.python.workspace_artifacts_windows import get_windows_file_api

        get_windows_file_api()
        return
    if (
        not all(hasattr(os, flag) for flag in ("O_NOFOLLOW", "O_DIRECTORY", "O_NONBLOCK"))
        or os.open not in os.supports_dir_fd
    ):
        raise WorkspaceArtifactError(
            "当前平台不支持无符号链接工件读取；工件收集已停止，请在支持 dir_fd 和 "
            "O_NOFOLLOW 的平台运行 Eval。"
        )


def iter_workspace_paths(workspace: Path) -> Iterator[Path]:
    """剪掉链接目录，避免递归枚举 junction；读取边界仍由文件句柄保证。"""
    def is_plain_directory(path: Path) -> bool:
        try:
            info = path.lstat()
            return stat.S_ISDIR(info.st_mode) and not (
                getattr(info, "st_file_attributes", 0) & 0x400
            )
        except OSError:
            return False

    if not is_plain_directory(workspace):
        return
    for root, directories, files in os.walk(workspace, topdown=True, followlinks=False):
        directories[:] = [
            name for name in directories if is_plain_directory(Path(root) / name)
        ]
        for name in files:
            yield Path(root) / name


def read_workspace_text(
    workspace: Path,
    path: Path,
    *,
    limit: int | None = None,
    max_bytes: int | None = None,
    errors: str = "strict",
) -> str | None:
    """安全读取普通文本，越界、链接、消失或不可读的工件返回 None。

    从工作区目录描述符逐级打开路径，不跟随任何符号链接；大小检查和
    读取使用同一个文件描述符。平台缺少这些能力时报错，不降级为跟随链接。
    UnicodeDecodeError 交由调用方处理，以保留报告复制的非文本提示。
    """
    require_workspace_artifact_support()
    try:
        relative = path.relative_to(workspace)
    except ValueError:
        return None
    if not relative.parts or ".." in relative.parts:
        return None
    if os.name == "nt":
        from scaffold.python.workspace_artifacts_windows import read_windows_workspace_text

        return read_windows_workspace_text(
            workspace, relative, limit=limit, max_bytes=max_bytes, errors=errors
        )
    try:
        with ExitStack() as stack:
            directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            directory_fd = os.open(workspace, directory_flags)
            stack.callback(os.close, directory_fd)
            for component in relative.parts[:-1]:
                directory_fd = os.open(component, directory_flags, dir_fd=directory_fd)
                stack.callback(os.close, directory_fd)
            file_fd = os.open(
                relative.name,
                os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=directory_fd,
            )
            stack.callback(os.close, file_fd)
            info = os.fstat(file_fd)
            if not stat.S_ISREG(info.st_mode):
                return None
            if max_bytes is not None and info.st_size > max_bytes:
                return None
            with os.fdopen(file_fd, encoding="utf-8", errors=errors, closefd=False) as stream:
                return stream.read(limit) if limit is not None else stream.read()
    except OSError:
        return None
