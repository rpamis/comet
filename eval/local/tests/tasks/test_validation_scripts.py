"""Regression tests for task validation scripts."""

from __future__ import annotations

import importlib.util
import json
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


def _load_standalone_validator(path: Path, workspace: Path):
    spec = importlib.util.spec_from_file_location(f"validator_{path.stem}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.WORKSPACE = workspace
    return module


def _write_full_workflow_context(workspace: Path, treatment_name: str):
    (workspace / "_test_context.json").write_text(
        f'{{"treatment_name": "{treatment_name}"}}',
        encoding="utf-8",
    )


def _write_docs_config(workspace: Path, layout: str = "docs"):
    config = workspace / ".comet/config.yaml"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(
        "\n".join(
            [
                "schema: comet.project.v1",
                "default_workflow: classic",
                "workflows:",
                "  - classic",
                "native:",
                "  artifact_root: docs",
                "classic:",
                f"  artifact_layout: {layout}",
                "",
            ]
        ),
        encoding="utf-8",
    )


def _transition_event(event: str, source: str, target: str):
    return {
        "schemaVersion": 1,
        "change": "sentence-counting",
        "event": event,
        "source": "comet-state" if event != "archived" else "comet-archive",
        "from": {"phase": source},
        "to": {"phase": target},
        "effects": [],
    }


def _write_archived_openspec_change(
    workspace: Path,
    changes_root: Path,
    *,
    missing_event: str | None = None,
    missing_artifact: str | None = None,
):
    change = changes_root / "archive/2026-07-28-sentence-counting"
    change.mkdir(parents=True)
    artifacts = {
        "proposal": change / "proposal.md",
        "design": change / "design.md",
        "tasks": change / "tasks.md",
        "delta_spec": change / "specs/sentence-counting/spec.md",
        "design_doc": workspace / "docs/superpowers/specs/sentence-counting.md",
        "plan": workspace / "docs/superpowers/plans/sentence-counting.md",
        "verification_report": workspace / "docs/superpowers/reports/sentence-counting.md",
        "handoff": change / ".comet/handoff/design-context.json",
        "trajectory": change / ".comet/trajectory.jsonl",
    }
    contents = {
        "proposal": "# Proposal\nAdd sentence counting to the word-count CLI.\n",
        "design": "# OpenSpec Design\nSplit text on terminal punctuation.\n",
        "tasks": "# Tasks\n- [x] Add sentence counter\n- [x] Add CLI flag\n- [x] Verify tests\n",
        "delta_spec": "# Sentence counting requirement\nThe CLI counts terminal punctuation.\n",
        "design_doc": "# Technical design\nTrade off punctuation parsing and regex complexity.\n",
        "plan": "# Implementation plan\n- [x] Implement parser\n- [x] Add tests\n",
        "verification_report": "# Verification\nAll sentence-counting tests passed.\n",
        "handoff": '{"schema":"comet.handoff.v1","change":"sentence-counting"}\n',
        "trajectory": "\n".join(
            json.dumps({"sequence": index + 1, "type": "state_transitioned"}) for index in range(5)
        )
        + "\n",
    }
    for name, artifact in artifacts.items():
        if name == missing_artifact:
            continue
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text(contents[name], encoding="utf-8")

    (change / ".comet.yaml").write_text(
        "\n".join(
            [
                "workflow: full",
                "phase: archive",
                "design_doc: docs/superpowers/specs/sentence-counting.md",
                "plan: docs/superpowers/plans/sentence-counting.md",
                "verification_report: docs/superpowers/reports/sentence-counting.md",
                "verify_result: pass",
                "archive_confirmation: confirmed",
                "archived: true",
                "handoff_context: docs/openspec/changes/sentence-counting/.comet/handoff/design-context.json",
                "",
            ]
        ),
        encoding="utf-8",
    )
    events = [
        _transition_event("open-complete", "open", "design"),
        _transition_event("design-complete", "design", "build"),
        _transition_event("build-complete", "build", "verify"),
        _transition_event("verify-pass", "verify", "archive"),
        _transition_event("archived", "archive", "archive"),
    ]
    state_events = change / ".comet/state-events.jsonl"
    state_events.parent.mkdir(parents=True, exist_ok=True)
    state_events.write_text(
        "\n".join(json.dumps(event) for event in events if event["event"] != missing_event) + "\n",
        encoding="utf-8",
    )
    return change


@pytest.mark.parametrize(
    ("treatment_name", "layout", "changes_root"),
    [
        ("COMET_CLASSIC_DOCS_LAYOUT", "docs", "docs/openspec/changes"),
        ("COMET_CLASSIC_LEGACY_LAYOUT", "legacy", "openspec/changes"),
    ],
)
def test_current_full_workflow_layout_requires_complete_archived_lifecycle(
    tmp_path: Path,
    treatment_name: str,
    layout: str,
    changes_root: str,
):
    _write_full_workflow_context(tmp_path, treatment_name)
    _write_docs_config(tmp_path, layout)
    _write_archived_openspec_change(
        tmp_path,
        tmp_path / changes_root,
    )
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    results = [
        module.check_openspec_artifacts(),
        module.check_comet_state(),
        module.check_workflow_phases(),
    ]

    assert results == [
        {"check": "openspec_artifacts", "status": "passed"},
        {"check": "comet_state", "status": "passed"},
        {"check": "workflow_phases", "status": "passed"},
    ]


@pytest.mark.parametrize(
    ("treatment_name", "layout", "open_spec_root"),
    [
        ("COMET_CLASSIC_DOCS_LAYOUT", "docs", "docs/openspec"),
        ("COMET_CLASSIC_LEGACY_LAYOUT", "legacy", "openspec"),
    ],
)
def test_classic_layout_lifecycle_smokes_init_with_the_asset_bound_snapshot(
    monkeypatch,
    tmp_path: Path,
    treatment_name: str,
    layout: str,
    open_spec_root: str,
):
    _write_full_workflow_context(tmp_path, treatment_name)
    snapshot = tmp_path / "_eval_current_comet"
    for relative in (
        "bin/comet.js",
        "dist/app/cli/index.js",
        "assets/manifest.json",
    ):
        target = snapshot / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("{}\n", encoding="utf-8")
    (snapshot / "build-identity.json").write_text(
        json.dumps(
            {
                "schema": "comet.eval.current-comet-build.v1",
                "assetsHash": "a" * 64,
                "manifestHash": "b" * 64,
            }
        ),
        encoding="utf-8",
    )
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        project = Path(command[2])
        config = (project / ".comet/config.yaml").read_text(encoding="utf-8")
        assert f"artifact_layout: {layout}" in config
        (project / open_spec_root).mkdir(parents=True)
        (project / open_spec_root / "config.yaml").write_text(
            "schema: spec-driven\n", encoding="utf-8"
        )
        return types.SimpleNamespace(returncode=0, stdout='{"status":"complete"}\n', stderr="")

    monkeypatch.setattr(module.shutil, "which", lambda _name: "/usr/local/bin/comet")
    monkeypatch.setattr(module.subprocess, "run", fake_run)

    assert module.check_current_cli_init_smoke() == {
        "check": "current_cli_init_smoke",
        "status": "passed",
    }
    assert calls
    command = calls[0][0]
    assert command[1] == "init"
    assert Path(command[2]).name == "project"
    assert "--workflow" in command
    assert "classic" in command


def test_current_full_workflow_smoke_rejects_a_snapshot_without_assets(tmp_path: Path):
    _write_full_workflow_context(tmp_path, "COMET_CLASSIC_LEGACY_LAYOUT")
    snapshot = tmp_path / "_eval_current_comet"
    (snapshot / "bin").mkdir(parents=True)
    (snapshot / "bin/comet.js").write_text("// incomplete\n", encoding="utf-8")
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    result = module.check_current_cli_init_smoke()

    assert result["status"] == "failed"
    assert "missing release assets" in result["reason"]


def test_full_workflow_docs_layout_rejects_legacy_root(tmp_path: Path):
    _write_full_workflow_context(tmp_path, "COMET_CLASSIC_DOCS_LAYOUT")
    _write_docs_config(tmp_path)
    _write_archived_openspec_change(tmp_path, tmp_path / "openspec/changes")
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    result = module.check_openspec_artifacts()

    assert result["status"] == "failed"
    assert "docs/openspec/changes" in result["reason"]


def test_full_workflow_legacy_layout_rejects_docs_root(tmp_path: Path):
    _write_full_workflow_context(tmp_path, "COMET_CLASSIC_LEGACY_LAYOUT")
    _write_docs_config(tmp_path, "legacy")
    _write_archived_openspec_change(tmp_path, tmp_path / "docs/openspec/changes")
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    result = module.check_openspec_artifacts()

    assert result["status"] == "failed"
    assert "docs/openspec" in result["reason"]


@pytest.mark.parametrize(
    ("treatment_name", "layout", "changes_root"),
    [
        ("COMET_CLASSIC_DOCS_LAYOUT", "docs", "docs/openspec/changes"),
        ("COMET_CLASSIC_LEGACY_LAYOUT", "legacy", "openspec/changes"),
    ],
)
def test_current_full_workflow_layout_rejects_unarchived_change(
    tmp_path: Path,
    treatment_name: str,
    layout: str,
    changes_root: str,
):
    _write_full_workflow_context(tmp_path, treatment_name)
    _write_docs_config(tmp_path, layout)
    change = tmp_path / changes_root / "sentence-counting"
    change.mkdir(parents=True)
    (change / "proposal.md").write_text("# Proposal\n", encoding="utf-8")
    (change / "tasks.md").write_text("# Tasks\n", encoding="utf-8")
    (change / ".comet.yaml").write_text(
        "phase: verify\narchived: false\n",
        encoding="utf-8",
    )
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    result = module.check_openspec_artifacts()

    assert result["status"] == "failed"
    assert "archive" in result["reason"].lower()


def test_full_workflow_docs_layout_reads_layout_from_project_config(tmp_path: Path):
    _write_full_workflow_context(tmp_path, "COMET_CLASSIC_DOCS_LAYOUT")
    _write_docs_config(tmp_path, "legacy")
    _write_archived_openspec_change(
        tmp_path,
        tmp_path / "docs/openspec/changes",
    )
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    result = module.check_openspec_artifacts()

    assert result["status"] == "failed"
    assert "classic.artifact_layout" in result["reason"]


def test_full_workflow_legacy_layout_reads_layout_from_project_config(tmp_path: Path):
    _write_full_workflow_context(tmp_path, "COMET_CLASSIC_LEGACY_LAYOUT")
    _write_docs_config(tmp_path, "docs")
    _write_archived_openspec_change(
        tmp_path,
        tmp_path / "openspec/changes",
    )
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    result = module.check_openspec_artifacts()

    assert result["status"] == "failed"
    assert "classic.artifact_layout" in result["reason"]


@pytest.mark.parametrize(
    ("treatment_name", "layout", "changes_root"),
    [
        ("COMET_CLASSIC_DOCS_LAYOUT", "docs", "docs/openspec/changes"),
        ("COMET_CLASSIC_LEGACY_LAYOUT", "legacy", "openspec/changes"),
    ],
)
def test_current_full_workflow_layout_rejects_phase_keywords_without_state_trajectory(
    tmp_path: Path,
    treatment_name: str,
    layout: str,
    changes_root: str,
):
    _write_full_workflow_context(tmp_path, treatment_name)
    _write_docs_config(tmp_path, layout)
    change = tmp_path / changes_root / "archive/2026-07-28-keyword-only"
    change.mkdir(parents=True)
    (change / "proposal.md").write_text(
        "proposal design implementation verification passed archive",
        encoding="utf-8",
    )
    (change / "tasks.md").write_text(
        "- [x] open design build verify archive",
        encoding="utf-8",
    )
    (change / ".comet.yaml").write_text(
        "workflow: full\nphase: archive\nverify_result: pass\narchived: true\n",
        encoding="utf-8",
    )
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    result = module.check_workflow_phases()

    assert result["status"] == "failed"
    assert "state-events.jsonl" in result["reason"]


@pytest.mark.parametrize(
    ("treatment_name", "layout", "changes_root"),
    [
        ("COMET_CLASSIC_DOCS_LAYOUT", "docs", "docs/openspec/changes"),
        ("COMET_CLASSIC_LEGACY_LAYOUT", "legacy", "openspec/changes"),
    ],
)
@pytest.mark.parametrize(
    "missing_event",
    [
        "open-complete",
        "design-complete",
        "build-complete",
        "verify-pass",
        "archived",
    ],
)
def test_current_full_workflow_layout_rejects_missing_transition(
    tmp_path: Path,
    treatment_name: str,
    layout: str,
    changes_root: str,
    missing_event: str,
):
    _write_full_workflow_context(tmp_path, treatment_name)
    _write_docs_config(tmp_path, layout)
    _write_archived_openspec_change(
        tmp_path,
        tmp_path / changes_root,
        missing_event=missing_event,
    )
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    result = module.check_workflow_phases()

    assert result["status"] == "failed"
    assert missing_event in result["reason"]


@pytest.mark.parametrize(
    ("treatment_name", "layout", "changes_root"),
    [
        ("COMET_CLASSIC_DOCS_LAYOUT", "docs", "docs/openspec/changes"),
        ("COMET_CLASSIC_LEGACY_LAYOUT", "legacy", "openspec/changes"),
    ],
)
@pytest.mark.parametrize(
    "missing_artifact",
    [
        "design",
        "delta_spec",
        "design_doc",
        "plan",
        "verification_report",
        "handoff",
        "trajectory",
    ],
)
def test_current_full_workflow_layout_rejects_missing_phase_artifact(
    tmp_path: Path,
    treatment_name: str,
    layout: str,
    changes_root: str,
    missing_artifact: str,
):
    _write_full_workflow_context(tmp_path, treatment_name)
    _write_docs_config(tmp_path, layout)
    _write_archived_openspec_change(
        tmp_path,
        tmp_path / changes_root,
        missing_artifact=missing_artifact,
    )
    module = _load_standalone_validator(
        ROOT / "local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
        tmp_path,
    )

    result = (
        module.check_workflow_phases()
        if missing_artifact == "trajectory"
        else module.check_openspec_artifacts()
    )

    assert result["status"] == "failed"
    assert missing_artifact.replace("_", " ") in result["reason"].replace("_", " ")
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
