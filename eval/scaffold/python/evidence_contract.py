"""Python 与 TypeScript 共用的逐例身份契约。"""
from __future__ import annotations

import re
import math
from typing import Any
from contextlib import contextmanager
from pathlib import Path
import os

_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}\Z")


def valid_repetition(value: Any) -> bool:
    return (not isinstance(value, bool) and isinstance(value, (int, float))
            and 1 <= value <= 9007199254740991 and math.isfinite(value) and value == int(value))


def case_identity(report: dict[str, Any], experiment: str) -> dict[str, Any]:
    events = report.get("events_summary") or {}
    task, treatment, rep = events.get("task"), events.get("treatment"), report.get("rep")
    if valid_repetition(rep):
        rep = int(rep)
    if (not isinstance(task, str) or not _IDENTIFIER.fullmatch(task)
            or not isinstance(treatment, str) or not _IDENTIFIER.fullmatch(treatment)
            or not valid_repetition(rep)
            or not valid_repetition(events.get("sample")) or events.get("sample") != rep or not isinstance(report.get("passed"), bool)
            or report.get("name") not in (f"{task}-{treatment}", f"{task}-{treatment}-r{rep}")):
        raise ValueError("逐例报告身份不一致")
    rep = int(rep)
    identity = {"schema": "comet.eval.case-identity.v1", "experiment": experiment,
                "task": task, "treatment": treatment, "repetition": rep}
    if report.get("case_identity", identity) != identity:
        raise ValueError("逐例报告归属不一致")
    return identity


@contextmanager
def report_publication_lock(path: Path):
    """跨平台发布锁；进程退出由操作系统释放，不依赖残留锁文件时间。"""
    with path.open('a+b') as lock:
        if os.name == 'nt':
            import msvcrt
            if lock.seek(0, os.SEEK_END) == 0:
                lock.write(b'0')
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
