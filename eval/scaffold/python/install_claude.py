"""在镜像中安装固定版本 Claude Code，并将平台原生包作为必装依赖。"""

import json
from pathlib import Path
import re
import subprocess
import sys


def install_claude(version, prefix, run=subprocess.run):
    query_flags = ["--fetch-timeout=300000", "--fetch-retries=1", "--loglevel=http"]
    metadata = run(
        ["npm", "view", f"@anthropic-ai/claude-code@{version}", "--json", *query_flags],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    ).stdout
    metadata = json.loads(metadata)
    if isinstance(metadata, list):
        metadata = metadata[-1]
    resolved = metadata.get("version")
    if not isinstance(resolved, str) or not re.fullmatch(
        r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.+-]+)?", resolved
    ):
        raise ValueError("Claude Code 包元数据缺少有效版本")
    target = json.loads(
        run(
            [
                "node",
                "-p",
                "JSON.stringify({platform:process.platform,arch:process.arch,musl:process.platform==='linux'&&!process.report.getReport().header.glibcVersionRuntime})",
            ],
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        ).stdout
    )
    package = f"@anthropic-ai/claude-code-{target['platform']}-{target['arch']}"
    if target.get("musl"):
        package += "-musl"
    optional = metadata.get("optionalDependencies") or {}
    packages = [f"@anthropic-ai/claude-code@{resolved}"]
    if package in optional:
        packages.insert(0, f"{package}@{optional[package]}")
    elif any(key.startswith("@anthropic-ai/claude-code-") for key in optional):
        raise ValueError(f"Claude Code {resolved} 不支持当前平台：{package}")
    # 顶层显式安装将下载失败变成错误，不依赖 npm 对 optionalDependencies 的静默处理。
    run(
        [
            "npm",
            "install",
            "-g",
            "--prefix",
            str(prefix),
            "--include=optional",
            "--foreground-scripts",
            "--loglevel=verbose",
            "--fetch-timeout=300000",
            "--fetch-retries=1",
            "--audit=false",
            "--fund=false",
            *packages,
        ],
        check=True,
    )
    run([str(Path(prefix) / "bin/claude"), "--version"], check=True)
    return resolved


if __name__ == "__main__":
    install_claude(sys.argv[1], sys.argv[2])
