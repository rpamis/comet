"""获取固定数据包；不启动容器或模型。"""

import hashlib
import json
import os
import time
import uuid
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile
import urllib.request


SOURCES = {
    "workbuddy-code": (
        "https://huggingface.co/datasets/tencent/workbuddy-bench/resolve/3e8ad839685c589d83a1dd60fe2d15eabb75f27a/wb-bench-code-v1.0.tar.gz",
        "f60394e44341f45f66af17ba69efc51ceadc61f17c08aa89e4af35b51f6f34e1",
        "3e8ad839685c589d83a1dd60fe2d15eabb75f27a",
    ),
    "skillsbench": (
        "https://codeload.github.com/benchflow-ai/skillsbench/tar.gz/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af",
        "525bf1559a1eb3511ca2daaf2a307e2dd882efd646c130a730de0f9f37da34d7",
        "b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af",
    ),
}


def report_progress(phase, received=0, total=None, error=None):
    destination = os.environ.get("COMET_DATASET_PROGRESS")
    if not destination:
        return
    file = Path(destination)
    temporary = file.with_name(file.name + "." + uuid.uuid4().hex + ".tmp")
    temporary.write_text(
        json.dumps({"phase": phase, "bytes": received, "total": total, "error": error}),
        encoding="utf-8",
    )
    os.replace(temporary, file)


def extract(archive: Path, destination: Path):
    with tarfile.open(archive) as stream:
        for member in stream.getmembers():
            parts = PurePosixPath(member.name).parts
            if (
                member.name.startswith("/")
                or ".." in parts
                or "\\" in member.name
                or ":" in member.name
            ):
                raise ValueError("数据归档路径越界")
        members = [
            member
            for member in stream.getmembers()
            if len(PurePosixPath(member.name).parts) <= 1
            or PurePosixPath(member.name).parts[1]
            in {"tasks", "shared", "dataset.toml", "LICENSE", "NOTICE", "registry.json"}
        ]
        for member in members:
            parts = PurePosixPath(member.name).parts
            if (
                member.name.startswith("/")
                or ".." in parts
                or "\\" in member.name
                or ":" in member.name
            ):
                raise ValueError("数据归档路径越界")
            if not (member.isfile() or member.isdir()):
                raise ValueError(f"数据归档不允许链接或设备文件：{member.name}")
        stream.extractall(destination, members=members, filter="data")


def fetch(dataset: str, destination: Path):
    url, expected, revision = SOURCES[dataset]
    report_progress("connecting")
    destination = destination.resolve()
    if destination.exists():
        raise ValueError(f"目标已存在，请使用该目录或选择新目录：{destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        dir=destination.parent, prefix=".dataset-download-"
    ) as temporary:
        temporary = Path(temporary)
        archive = temporary / "source.tar.gz"
        request = urllib.request.Request(url, headers={"User-Agent": "Comet-Eval"})
        digest = hashlib.sha256()
        with urllib.request.urlopen(request, timeout=120) as response, archive.open("wb") as output:
            total = (
                int(response.headers["Content-Length"])
                if response.headers.get("Content-Length", "").isdigit()
                else None
            )
            received = 0
            last_report = 0
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                output.write(chunk)
                received += len(chunk)
                if time.monotonic() - last_report >= 0.5:
                    report_progress("downloading", received, total)
                    last_report = time.monotonic()
        report_progress("verifying", received, total)
        actual = digest.hexdigest()
        if expected and actual != expected:
            raise ValueError("数据归档 SHA-256 不匹配")
        extracted = temporary / "extracted"
        extracted.mkdir()
        report_progress("extracting", received, total)
        extract(archive, extracted)
        roots = [
            item for item in extracted.iterdir() if item.is_dir() and (item / "tasks").is_dir()
        ]
        if len(roots) != 1:
            raise ValueError("数据包缺少唯一 tasks 根目录")
        (roots[0] / "dataset-source.json").write_text(
            json.dumps(
                {
                    "dataset": dataset,
                    "revision": revision,
                    "url": url,
                    "archiveSha256": actual,
                }
            ),
            encoding="utf-8",
        )
        shutil.move(str(roots[0]), destination)
        report_progress("completed", received, total)
    return destination


if __name__ == "__main__":
    try:
        print(fetch(sys.argv[1], Path(sys.argv[2])))
    except Exception as error:
        report_progress("failed", error=str(error))
        raise
