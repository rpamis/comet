"""Windows 工件读取：相对目录句柄打开，不跟随 reparse point。

接口依据：Microsoft Learn 的 NtCreateFile、GetFileInformationByHandle、
CreateFileW 和 CRT _open_osfhandle 文档。工作区根及其上级由 harness 指定；
根本身和根以下的任一 reparse point 均拒绝。
"""

from __future__ import annotations

import ctypes
import os
from contextlib import ExitStack
from functools import lru_cache
from pathlib import Path

from scaffold.python.workspace_artifacts import WorkspaceArtifactError

_DWORD = ctypes.c_uint32
_HANDLE = ctypes.c_void_p
_FILE_ATTRIBUTE_DIRECTORY = 0x10
_FILE_ATTRIBUTE_REPARSE_POINT = 0x400
_FILE_READ_DATA = 0x1
_FILE_TRAVERSE = 0x20
_FILE_READ_ATTRIBUTES = 0x80
_SYNCHRONIZE = 0x100000
_FILE_OPEN_REPARSE_POINT = 0x200000
_FILE_SYNCHRONOUS_IO_NONALERT = 0x20
_FILE_SHARE_READ = 0x1


class _UnicodeString(ctypes.Structure):
    _fields_ = [
        ("Length", ctypes.c_uint16),
        ("MaximumLength", ctypes.c_uint16),
        ("Buffer", ctypes.c_void_p),
    ]


class _ObjectAttributes(ctypes.Structure):
    _fields_ = [
        ("Length", _DWORD),
        ("RootDirectory", _HANDLE),
        ("ObjectName", ctypes.POINTER(_UnicodeString)),
        ("Attributes", _DWORD),
        ("SecurityDescriptor", ctypes.c_void_p),
        ("SecurityQualityOfService", ctypes.c_void_p),
    ]


class _IoStatusBlock(ctypes.Structure):
    # 首字段是 NTSTATUS/指针 union，按指针宽度保留空间与对齐。
    _fields_ = [("Status", ctypes.c_void_p), ("Information", ctypes.c_size_t)]


class _FileTime(ctypes.Structure):
    _fields_ = [("Low", _DWORD), ("High", _DWORD)]


class _FileInformation(ctypes.Structure):
    _fields_ = [
        ("Attributes", _DWORD),
        ("CreationTime", _FileTime),
        ("LastAccessTime", _FileTime),
        ("LastWriteTime", _FileTime),
        ("VolumeSerialNumber", _DWORD),
        ("SizeHigh", _DWORD),
        ("SizeLow", _DWORD),
        ("NumberOfLinks", _DWORD),
        ("FileIndexHigh", _DWORD),
        ("FileIndexLow", _DWORD),
    ]


def _raise_windows_error(code: int) -> None:
    # 缺失、权限/共享冲突和无效文件名可以逐工件跳过。API/ABI/文件系统能力
    # 等其他错误必须停止评估，不能把失效的后端当作空工作区。
    if code in {2, 3, 5, 32, 33, 123, 206, 267}:
        raise ctypes.WinError(code)
    raise WorkspaceArtifactError(f"Windows 工件读取后端失败 (Win32 error {code})")


class _WindowsFileAPI:
    def __init__(self):
        import msvcrt

        self.open_osfhandle = msvcrt.open_osfhandle
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
        self.create_file = kernel.CreateFileW
        self.create_file.argtypes = [
            ctypes.c_wchar_p, _DWORD, _DWORD, ctypes.c_void_p, _DWORD, _DWORD, _HANDLE
        ]
        self.create_file.restype = _HANDLE
        self.close_handle = kernel.CloseHandle
        self.close_handle.argtypes = [_HANDLE]
        self.close_handle.restype = ctypes.c_int32
        self.file_information = kernel.GetFileInformationByHandle
        self.file_information.argtypes = [_HANDLE, ctypes.POINTER(_FileInformation)]
        self.file_information.restype = ctypes.c_int32
        self.file_type = kernel.GetFileType
        self.file_type.argtypes = [_HANDLE]
        self.file_type.restype = _DWORD
        self.nt_create_file = ntdll.NtCreateFile
        self.nt_create_file.argtypes = [
            ctypes.POINTER(_HANDLE), _DWORD, ctypes.POINTER(_ObjectAttributes),
            ctypes.POINTER(_IoStatusBlock), ctypes.c_void_p, _DWORD, _DWORD, _DWORD,
            _DWORD, ctypes.c_void_p, _DWORD,
        ]
        self.nt_create_file.restype = ctypes.c_int32
        self.status_to_error = ntdll.RtlNtStatusToDosError
        self.status_to_error.argtypes = [ctypes.c_int32]
        self.status_to_error.restype = _DWORD

    def open_root(self, workspace: Path) -> int:
        absolute = str(workspace.absolute())
        if not absolute.startswith("\\\\?\\"):
            absolute = (
                "\\\\?\\UNC\\" + absolute[2:]
                if absolute.startswith("\\\\")
                else "\\\\?\\" + absolute
            )
        handle = self.create_file(
            absolute,
            _FILE_READ_ATTRIBUTES | _FILE_TRAVERSE | _SYNCHRONIZE,
            _FILE_SHARE_READ,
            None,
            3,  # OPEN_EXISTING
            0x00200000 | 0x02000000,  # OPEN_REPARSE_POINT | BACKUP_SEMANTICS
            None,
        )
        if handle == ctypes.c_void_p(-1).value:
            _raise_windows_error(ctypes.get_last_error())
        return handle

    def open_relative(self, parent: int, component: str, *, directory: bool) -> int:
        encoded = component.encode("utf-16-le")
        if (
            not component or component in {".", ".."}
            or any(char in component for char in "\\/:\x00")
            or len(encoded) + 2 > 0xFFFF
        ):
            raise OSError("无效的工件路径组件")
        buffer = ctypes.create_string_buffer(encoded + b"\x00\x00")
        name = _UnicodeString(len(encoded), len(encoded) + 2, ctypes.addressof(buffer))
        attributes = _ObjectAttributes(
            ctypes.sizeof(_ObjectAttributes), parent, ctypes.pointer(name), 0x40, None, None
        )
        io_status = _IoStatusBlock()
        handle = _HANDLE()
        access = _FILE_READ_ATTRIBUTES | _SYNCHRONIZE
        access |= _FILE_TRAVERSE if directory else _FILE_READ_DATA
        status = self.nt_create_file(
            ctypes.byref(handle), access, ctypes.byref(attributes), ctypes.byref(io_status),
            None, 0, _FILE_SHARE_READ, 1,  # FILE_OPEN，只打开现有文件
            _FILE_OPEN_REPARSE_POINT | _FILE_SYNCHRONOUS_IO_NONALERT, None, 0,
        )
        if status < 0:
            _raise_windows_error(self.status_to_error(status))
        return handle.value

    def inspect(self, handle: int, *, directory: bool) -> _FileInformation | None:
        ctypes.set_last_error(0)
        file_type = self.file_type(handle)
        if file_type == 0 and ctypes.get_last_error():
            _raise_windows_error(ctypes.get_last_error())
        if file_type != 1:  # FILE_TYPE_DISK
            return None
        info = _FileInformation()
        if not self.file_information(handle, ctypes.byref(info)):
            _raise_windows_error(ctypes.get_last_error())
        if info.Attributes & _FILE_ATTRIBUTE_REPARSE_POINT:
            return None
        if bool(info.Attributes & _FILE_ATTRIBUTE_DIRECTORY) != directory:
            return None
        return info


@lru_cache(maxsize=1)
def get_windows_file_api() -> _WindowsFileAPI:
    try:
        return _WindowsFileAPI()
    except (ImportError, AttributeError, OSError) as exc:
        raise WorkspaceArtifactError("Windows 工件读取 API 不可用，评估已停止") from exc


def read_windows_workspace_text(
    workspace: Path, relative: Path, *, limit: int | None, max_bytes: int | None, errors: str
) -> str | None:
    api = get_windows_file_api()
    try:
        with ExitStack() as directories:
            parent = api.open_root(workspace)
            directories.callback(api.close_handle, parent)
            if api.inspect(parent, directory=True) is None:
                return None
            for component in relative.parts[:-1]:
                parent = api.open_relative(parent, component, directory=True)
                directories.callback(api.close_handle, parent)
                if api.inspect(parent, directory=True) is None:
                    return None
            with ExitStack() as final_handle:
                handle = api.open_relative(parent, relative.name, directory=False)
                final_handle.callback(api.close_handle, handle)
                info = api.inspect(handle, directory=False)
                if info is None:
                    return None
                size = (info.SizeHigh << 32) | info.SizeLow
                if max_bytes is not None and size > max_bytes:
                    return None
                try:
                    fd = api.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
                except OSError as exc:
                    raise WorkspaceArtifactError("Windows 工件句柄转换失败") from exc
                # CRT 成功接管句柄后只由 os.close 关闭，避免重复关闭同一个句柄。
                final_handle.pop_all()
                with ExitStack() as descriptor:
                    descriptor.callback(os.close, fd)
                    with os.fdopen(fd, encoding="utf-8", errors=errors, closefd=False) as stream:
                        return stream.read(limit) if limit is not None else stream.read()
    except OSError:
        return None
