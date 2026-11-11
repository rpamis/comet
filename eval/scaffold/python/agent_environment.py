"""Prepare legacy task images with the selected Claude Code version."""

from contextlib import contextmanager
from pathlib import Path
import re
import shutil
import tempfile


@contextmanager
def pinned_claude_environment(environment_dir: Path, version: str | None):
    dockerfile = environment_dir / "Dockerfile"
    if not version or version == "latest" or not dockerfile.is_file():
        yield environment_dir
        return
    content = dockerfile.read_text(encoding="utf-8")
    package = "@anthropic-ai/claude-code@latest"
    if package not in content:
        yield environment_dir
        return
    content = content.replace(package, "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}")
    if "ARG CLAUDE_CODE_VERSION=" not in content:
        content = re.sub(
            r"(?m)^(FROM [^\n]+\n)",
            r"\1ARG CLAUDE_CODE_VERSION=latest\n",
            content,
            count=1,
        )
    with tempfile.TemporaryDirectory(prefix="comet-pinned-agent-environment-") as temporary:
        prepared = Path(temporary)
        shutil.copytree(environment_dir, prepared, dirs_exist_ok=True)
        (prepared / "Dockerfile").write_text(content, encoding="utf-8")
        yield prepared
