"""Regression tests for task validation scripts."""

from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
import types
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]


def _final_dockerfile_user_is_non_root(dockerfile: str) -> bool:
    user = None
    for line in dockerfile.splitlines():
        if re.match(r"^\s*FROM\s+", line, re.IGNORECASE):
            user = None
            continue
        match = re.match(r"^\s*USER\s+(\S+)", line, re.IGNORECASE)
        if match:
            user = match.group(1).lower()

    if user is None:
        return False
    return user.split(":", 1)[0] not in {"root", "0"}


def _dockerfile_runs_claude_code_install(dockerfile: str) -> bool:
    instructions = []
    current = []
    for raw_line in dockerfile.splitlines():
        line = raw_line.strip()
        if not current:
            if line.startswith("#") or not re.match(r"^RUN\s+", line, re.IGNORECASE):
                continue
            current.append(line)
        else:
            current.append(line)

        if line.endswith("\\"):
            continue
        instructions.append(" ".join(current).replace("\\", " "))
        current = []

    return any(
        re.search(
            r"\bnpm\s+install\s+-g\s+@anthropic-ai/claude-code(?:@[^\s;&]+)?(?=\s|$|&&|;)",
            instruction,
            re.IGNORECASE,
        )
        for instruction in instructions
    )


@pytest.mark.parametrize(
    ("dockerfile", "expected"),
    [
        ("# RUN npm install -g @anthropic-ai/claude-code@latest\n", False),
        ("RUN echo @anthropic-ai/claude-code@latest\n", False),
        ("RUN npm install -g @anthropic-ai/claude-code@latest\n", True),
        (
            "RUN npm install -g @fission-ai/openspec@1.3.1 && \\\n"
            "    npm install -g @anthropic-ai/claude-code@latest\n",
            True,
        ),
    ],
)
def test_dockerfile_detects_real_claude_code_installation(dockerfile: str, expected: bool):
    assert _dockerfile_runs_claude_code_install(dockerfile) is expected


@pytest.mark.parametrize(
    ("dockerfile", "expected"),
    [
        ("FROM python:3.12-slim\nUSER agent\n", True),
        ("FROM python:3.12-slim\nUSER agent\nUSER root\n", False),
        ("FROM python:3.12-slim\nUSER 0:0\n", False),
        (
            "FROM python:3.12-slim AS builder\nUSER agent\nFROM python:3.12-slim\n",
            False,
        ),
    ],
)
def test_final_dockerfile_user_must_be_non_root(dockerfile: str, expected: bool):
    assert _final_dockerfile_user_is_non_root(dockerfile) is expected


def test_native_wave_validator_import_does_not_load_host_docker_helpers(tmp_path: Path):
    from scaffold.python import utils

    stale_package = tmp_path / "scaffold/python"
    stale_package.mkdir(parents=True)
    (tmp_path / "scaffold/__init__.py").write_text("", encoding="utf-8")
    (stale_package / "__init__.py").write_text(
        "raise RuntimeError('host scaffold package leaked into validator')\n",
        encoding="utf-8",
    )
    utils._copy_scaffold_to_docker(tmp_path)
    env = os.environ.copy()
    env["PYTHONPATH"] = str(tmp_path)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "import scaffold.python.validation.native_wave; "
                "assert 'scaffold.python.validation.docker' not in sys.modules"
            ),
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        env=env,
    )

    assert result.returncode == 0, result.stderr


def _load_validator(path: Path, workspace: Path):
    fake_checks = types.ModuleType("comet_checks")
    fake_checks.WORKSPACE = workspace
    fake_checks._passed = lambda check, message: {
        "check": check,
        "status": "passed",
        "message": message,
    }
    fake_checks._failed = lambda check, message: {
        "check": check,
        "status": "failed",
        "message": message,
    }
    fake_checks.run_comet_checks = lambda: []
    fake_checks.write_results = lambda results: results

    previous = sys.modules.get("comet_checks")
    sys.modules["comet_checks"] = fake_checks
    try:
        spec = importlib.util.spec_from_file_location(f"validator_{path.stem}", path)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("comet_checks", None)
        else:
            sys.modules["comet_checks"] = previous


def test_generic_skill_smoke_accepts_plain_language_approach_summary(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    (tmp_path / "result.md").write_text(
        """# Skill Smoke Result

Created this file directly with a single write, since the task only required producing a small markdown document with a fixed structure — no code exploration or additional tooling was needed.

- Wrote `result.md` at the workspace root
- Included the required `# Skill Smoke Result` heading and a short summary
- Verified the bullet list contains exactly three bullets
""",
        encoding="utf-8",
    )
    module = _load_validator(
        ROOT / "local/tasks/generic-skill-smoke/validation/test_generic_skill_smoke.py",
        tmp_path,
    )
    captured = {}
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(module, "write_test_results", captured.update)

    module.main()

    assert "result.md describes approach" in captured["passed"]


def test_refactor_counter_accepts_annotated_wrappers(tmp_path: Path):
    (tmp_path / "text_processor.py").write_text(
        """
def count(text: str, unit: str) -> int:
    return len(text)

def count_words(text: str) -> int:
    return count(text, "words")

def count_lines(text: str) -> int:
    return count(text, "lines")

def count_chars(text: str) -> int:
    return count(text, "chars")
""",
        encoding="utf-8",
    )
    module = _load_validator(
        ROOT / "local/tasks/comet-refactor-counter/validation/test_refactor_counter.py",
        tmp_path,
    )

    result = module.check_count_dispatcher()

    assert result["status"] == "passed"


def test_fix_median_reports_pytest_stderr(monkeypatch, tmp_path: Path):
    module = _load_validator(
        ROOT / "local/tasks/comet-fix-median/validation/test_fix_median.py",
        tmp_path,
    )
    calls = []

    def fake_run(*args, **kwargs):
        calls.append(args[0])
        if len(calls) == 1:
            return types.SimpleNamespace(returncode=0, stdout="2.5\n", stderr="")
        return types.SimpleNamespace(
            returncode=1,
            stdout="",
            stderr="/usr/local/bin/python: No module named pytest\n",
        )

    monkeypatch.setattr(module.subprocess, "run", fake_run)

    result = module.check_median_fix()

    assert result["status"] == "failed"
    assert "No module named pytest" in result["message"]


def test_pytest_task_images_install_pytest():
    task_root = ROOT / "local/tasks"
    missing = []
    for dockerfile in task_root.glob("*/environment/Dockerfile"):
        environment = dockerfile.parent
        if not any(
            "import pytest" in test.read_text(encoding="utf-8")
            for test in environment.glob("test_*.py")
        ):
            continue
        text = dockerfile.read_text(encoding="utf-8").lower()
        if "pytest" not in text:
            missing.append(str(dockerfile.relative_to(ROOT)))

    assert missing == []


def test_claude_eval_task_images_do_not_use_unapproved_npm_registry():
    task_root = ROOT / "local/tasks"
    mirror_images = []
    for dockerfile in task_root.glob("*/environment/Dockerfile"):
        text = dockerfile.read_text(encoding="utf-8").lower()
        if "@anthropic-ai/claude-code" in text and "registry.npmmirror.com" in text:
            mirror_images.append(str(dockerfile.relative_to(ROOT)))

    assert mirror_images == []


def test_comet_state_accepts_archived_change_without_active_state(monkeypatch, tmp_path: Path):
    from scaffold.python.validation import comet_workflow

    archived = tmp_path / "openspec" / "changes" / "archive" / "2026-06-20-fix"
    archived.mkdir(parents=True)
    (archived / "proposal.md").write_text("# Proposal\n", encoding="utf-8")
    (archived / "tasks.md").write_text("- [x] Done\n", encoding="utf-8")
    monkeypatch.setattr(comet_workflow, "WORKSPACE", tmp_path)

    result = comet_workflow.check_comet_state()

    assert result == {
        "check": "comet_state",
        "status": "passed",
        "message": "phase=archived",
    }


def test_workflow_phases_accepts_verification_report_name(monkeypatch, tmp_path: Path):
    from scaffold.python.validation import comet_workflow

    archived = tmp_path / "openspec" / "changes" / "archive" / "2026-06-20-refactor"
    archived.mkdir(parents=True)
    (archived / "proposal.md").write_text("# Proposal\n", encoding="utf-8")
    (archived / "design.md").write_text("# Design\n", encoding="utf-8")
    (archived / "tasks.md").write_text("- [x] Done\n", encoding="utf-8")
    (archived / "verification-report.md").write_text("# Verification\n", encoding="utf-8")
    monkeypatch.setattr(comet_workflow, "WORKSPACE", tmp_path)

    result = comet_workflow.check_workflow_phases()

    assert result["status"] == "passed"
    assert "verify" in result["message"]


def test_claude_eval_task_images_install_claude_code():
    task_root = ROOT / "local/tasks"
    dockerfiles = sorted(task_root.glob("*/environment/Dockerfile"))
    missing_claude = []
    root_images = []
    for dockerfile in dockerfiles:
        text = dockerfile.read_text(encoding="utf-8")
        relative = str(dockerfile.relative_to(ROOT))
        if not _dockerfile_runs_claude_code_install(text):
            missing_claude.append(relative)
        if not _final_dockerfile_user_is_non_root(text):
            root_images.append(relative)

    assert dockerfiles != []
    assert missing_claude == []
    assert root_images == []
