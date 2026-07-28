"""Validation script for comet full workflow task.

Runs inside Docker. Checks that Claude followed the comet workflow
and implemented the sentence counting feature correctly.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

WORKSPACE = Path("/workspace")
RESULTS_FILE = os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")
CONTEXT_FILE = os.environ.get("BENCH_TEST_CONTEXT", "_test_context.json")
DOCS_LAYOUT_TREATMENT = "COMET_CLASSIC_DOCS_LAYOUT"
LEGACY_LAYOUT_TREATMENT = "COMET_CLASSIC_LEGACY_LAYOUT"
DOCS_CHANGES = Path("docs/openspec/changes")
LEGACY_CHANGES = Path("openspec/changes")
CURRENT_LAYOUTS = {
    DOCS_LAYOUT_TREATMENT: ("docs", DOCS_CHANGES, Path("openspec")),
    LEGACY_LAYOUT_TREATMENT: ("legacy", LEGACY_CHANGES, Path("docs/openspec")),
}
REQUIRED_TRANSITIONS = (
    ("open-complete", "open", "design"),
    ("design-complete", "design", "build"),
    ("build-complete", "build", "verify"),
    ("verify-pass", "verify", "archive"),
    ("archived", "archive", "archive"),
)


def passed(name: str):
    return {"check": name, "status": "passed"}


def failed(name: str, reason: str):
    return {"check": name, "status": "failed", "reason": reason}


def current_treatment():
    try:
        context = json.loads((WORKSPACE / CONTEXT_FILE).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return ""
    return context.get("treatment_name", "")


def _read_yaml(path: Path):
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        return None, str(error)
    if not isinstance(value, dict):
        return None, f"{path.name} must contain a mapping"
    return value, None


def _layout_contract():
    """Return the selected changes root and any layout-contract failure."""
    selected = CURRENT_LAYOUTS.get(current_treatment())
    if selected is None:
        return LEGACY_CHANGES, None
    expected_layout, changes_root, forbidden_root = selected

    config_path = WORKSPACE / ".comet/config.yaml"
    config, error = _read_yaml(config_path)
    if error:
        return changes_root, f"Cannot validate .comet/config.yaml: {error}"
    if config.get("schema") != "comet.project.v1":
        return changes_root, ".comet/config.yaml must use schema comet.project.v1"
    workflows = config.get("workflows")
    if not isinstance(workflows, list) or "classic" not in workflows:
        return changes_root, ".comet/config.yaml must enable the classic workflow"
    classic = config.get("classic")
    if not isinstance(classic, dict) or classic.get("artifact_layout") != expected_layout:
        return (
            changes_root,
            ".comet/config.yaml classic.artifact_layout must be "
            f"{expected_layout} for this treatment",
        )
    if (WORKSPACE / forbidden_root).exists():
        return (
            changes_root,
            f"Alternate {forbidden_root.as_posix()}/ root exists during "
            f"{expected_layout}-layout treatment; expected only "
            f"{changes_root.as_posix()}",
        )
    return changes_root, None


def _uses_current_layout():
    return current_treatment() in CURRENT_LAYOUTS


def check_current_cli_init_smoke():
    """Prove the controller snapshot can initialize a real project in this container."""
    selected = CURRENT_LAYOUTS.get(current_treatment())
    if selected is None:
        return passed("current_cli_init_smoke")
    expected_layout, _changes_root, alternate_root = selected
    expected_root = Path("docs/openspec") if expected_layout == "docs" else Path("openspec")

    snapshot = WORKSPACE / "_eval_current_comet"
    required = (
        snapshot / "bin/comet.js",
        snapshot / "dist/app/cli/index.js",
        snapshot / "assets/manifest.json",
        snapshot / "build-identity.json",
    )
    missing = [path.relative_to(WORKSPACE).as_posix() for path in required if not path.is_file()]
    if missing:
        return failed(
            "current_cli_init_smoke",
            f"Current Comet snapshot is missing release assets: {', '.join(missing)}",
        )
    identity, error = _read_yaml(snapshot / "build-identity.json")
    if error:
        try:
            identity = json.loads((snapshot / "build-identity.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as json_error:
            return failed(
                "current_cli_init_smoke",
                f"Current Comet build identity is invalid: {json_error}",
            )
    if (
        not isinstance(identity, dict)
        or identity.get("schema") != "comet.eval.current-comet-build.v1"
        or not identity.get("assetsHash")
        or not identity.get("manifestHash")
    ):
        return failed(
            "current_cli_init_smoke",
            "Current Comet build identity does not bind its release assets",
        )

    executable = shutil.which("comet")
    if executable is None:
        return failed("current_cli_init_smoke", "Current Comet container wrapper is unavailable")

    try:
        with tempfile.TemporaryDirectory(prefix="comet-current-cli-smoke-") as temporary:
            project = Path(temporary) / "project"
            home = Path(temporary) / "home"
            (project / ".git").mkdir(parents=True)
            (project / ".comet").mkdir()
            (project / ".comet/config.yaml").write_text(
                "\n".join(
                    [
                        "schema: comet.project.v1",
                        "default_workflow: classic",
                        "workflows: [classic]",
                        "classic:",
                        f"  artifact_layout: {expected_layout}",
                        "  language: en",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (home / ".claude/skills/using-superpowers").mkdir(parents=True)
            (home / ".claude/skills/using-superpowers/SKILL.md").write_text(
                "# using-superpowers\n", encoding="utf-8"
            )
            env = {
                **os.environ,
                "HOME": str(home),
                "XDG_CONFIG_HOME": str(home / ".config"),
            }
            result = subprocess.run(
                [
                    executable,
                    "init",
                    str(project),
                    "--scope",
                    "project",
                    "--workflow",
                    "classic",
                    "--platform",
                    "claude",
                    "--language",
                    "en",
                    "--json",
                ],
                cwd=project,
                env=env,
                capture_output=True,
                text=True,
                timeout=90,
            )
            if result.returncode != 0:
                detail = (result.stderr or result.stdout).strip()
                return failed(
                    "current_cli_init_smoke",
                    f"Current Comet init failed in the task container: {detail[-1000:]}",
                )
            config, config_error = _read_yaml(project / ".comet/config.yaml")
            if config_error:
                return failed(
                    "current_cli_init_smoke",
                    f"Current Comet init did not create a valid project config: {config_error}",
                )
            classic = config.get("classic") if isinstance(config, dict) else None
            if (
                not isinstance(classic, dict)
                or classic.get("artifact_layout") != expected_layout
            ):
                return failed(
                    "current_cli_init_smoke",
                    f"Current Comet init did not preserve the {expected_layout} Classic layout",
                )
            if not (project / expected_root / "config.yaml").is_file():
                return failed(
                    "current_cli_init_smoke",
                    f"Current Comet init did not create a healthy {expected_root.as_posix()} root",
                )
            if (project / alternate_root).exists():
                return failed(
                    "current_cli_init_smoke",
                    f"Current Comet init created alternate root {alternate_root.as_posix()}",
                )
    except (OSError, subprocess.SubprocessError) as error:
        return failed("current_cli_init_smoke", f"Current Comet init smoke failed: {error}")

    return passed("current_cli_init_smoke")


def _archived_candidates(changes_dir: Path):
    archive_dir = changes_dir / "archive"
    if not archive_dir.is_dir():
        return []
    return sorted(
        (entry for entry in archive_dir.iterdir() if entry.is_dir()),
        key=lambda entry: entry.name,
    )


def _read_state(change_dir: Path):
    state_path = change_dir / ".comet.yaml"
    state, error = _read_yaml(state_path)
    if error:
        return None, f"Cannot validate {state_path.name}: {error}"
    return state, None


def _terminal_state_error(change_dir: Path):
    state, error = _read_state(change_dir)
    if error:
        return error
    expected = {
        "workflow": "full",
        "phase": "archive",
        "verify_result": "pass",
        "archived": True,
    }
    for field, value in expected.items():
        if state.get(field) != value:
            return f".comet.yaml {field} must be {value!r}"
    return None


def _nonempty_file(path: Path):
    try:
        return path.is_file() and bool(path.read_text(encoding="utf-8").strip())
    except OSError:
        return False


def _project_file(pointer, label: str, change_dir: Path, allow_archived_handoff=False):
    if not isinstance(pointer, str) or not pointer.strip():
        return None, f"{label} pointer is missing"
    candidate = (WORKSPACE / pointer).resolve()
    try:
        candidate.relative_to(WORKSPACE.resolve())
    except ValueError:
        return None, f"{label} pointer escapes the workspace"
    if _nonempty_file(candidate):
        return candidate, None
    if allow_archived_handoff:
        normalized = pointer.replace("\\", "/")
        marker = "/.comet/"
        if marker in normalized:
            archived_candidate = change_dir / ".comet" / normalized.split(marker, 1)[1]
            if _nonempty_file(archived_candidate):
                return archived_candidate, None
    return None, f"{label} artifact is missing: {pointer}"


def _artifact_error(change_dir: Path):
    for label, relative in (
        ("proposal", "proposal.md"),
        ("design", "design.md"),
        ("tasks", "tasks.md"),
    ):
        if not _nonempty_file(change_dir / relative):
            return f"{label} artifact is missing or empty"

    delta_specs = list((change_dir / "specs").glob("*/spec.md"))
    if not any(_nonempty_file(spec) for spec in delta_specs):
        return "delta spec artifact is missing or empty"

    tasks = (change_dir / "tasks.md").read_text(encoding="utf-8")
    task_marks = re.findall(r"^\s*[-*]\s+\[([ xX])\]\s+", tasks, re.MULTILINE)
    if not task_marks or any(mark.lower() != "x" for mark in task_marks):
        return "tasks artifact must contain completed checkboxes"

    state, error = _read_state(change_dir)
    if error:
        return error
    for field, label, archived_handoff in (
        ("design_doc", "design doc", False),
        ("plan", "plan", False),
        ("verification_report", "verification report", False),
        ("handoff_context", "handoff", True),
    ):
        _, pointer_error = _project_file(
            state.get(field),
            label,
            change_dir,
            allow_archived_handoff=archived_handoff,
        )
        if pointer_error:
            return pointer_error
    return None


def _read_json_lines(path: Path):
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        return None, str(error)
    records = []
    for line_number, line in enumerate(source.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            return None, f"line {line_number}: {error.msg}"
        if not isinstance(value, dict):
            return None, f"line {line_number}: expected a JSON object"
        records.append(value)
    if not records:
        return None, "file is empty"
    return records, None


def _transition_error(change_dir: Path):
    events_path = change_dir / ".comet/state-events.jsonl"
    events, error = _read_json_lines(events_path)
    if error:
        return f"state-events.jsonl is unavailable or invalid: {error}"

    cursor = 0
    for event_name, source, target in REQUIRED_TRANSITIONS:
        matching_index = None
        invalid_endpoint = False
        for index in range(cursor, len(events)):
            event = events[index]
            if event.get("event") != event_name:
                continue
            if (
                isinstance(event.get("from"), dict)
                and event["from"].get("phase") == source
                and isinstance(event.get("to"), dict)
                and event["to"].get("phase") == target
            ):
                matching_index = index
                break
            invalid_endpoint = True
        if matching_index is None:
            if invalid_endpoint:
                return f"{event_name} has an invalid {source}->{target} state transition"
            return f"state-events.jsonl is missing {event_name}"
        cursor = matching_index + 1

    trajectory_path = change_dir / ".comet/trajectory.jsonl"
    trajectory, error = _read_json_lines(trajectory_path)
    if error:
        return f"trajectory artifact is unavailable or invalid: {error}"
    if len(trajectory) < len(REQUIRED_TRANSITIONS):
        return "trajectory artifact does not cover the complete lifecycle"
    return None


def check_openspec_artifacts():
    """Check that OpenSpec artifacts were created (proposal, design, tasks).

    The current docs and legacy layout treatments must finish the complete
    lifecycle under their configured archive root. Frozen legacy treatments
    retain their original openspec/changes compatibility.
    """
    relative_changes_dir, layout_error = _layout_contract()
    if layout_error:
        return failed("openspec_artifacts", layout_error)
    current_layout = _uses_current_layout()
    changes_dir = WORKSPACE / relative_changes_dir
    if not changes_dir.exists():
        return failed(
            "openspec_artifacts",
            f"{relative_changes_dir.as_posix()}/ directory not found",
        )

    candidates = _archived_candidates(changes_dir)

    if not current_layout:
        candidates.extend(d for d in changes_dir.iterdir() if d.is_dir() and d.name != "archive")

    if not candidates:
        location = (
            f"{relative_changes_dir.as_posix()}/archive/"
            if current_layout
            else f"{relative_changes_dir.as_posix()}/"
        )
        return failed(
            "openspec_artifacts",
            f"No change directories found in {location}",
        )

    if current_layout:
        errors = []
        for change_dir in candidates:
            terminal_error = _terminal_state_error(change_dir)
            artifact_error = _artifact_error(change_dir)
            if not terminal_error and not artifact_error:
                return passed("openspec_artifacts")
            errors.append(terminal_error or artifact_error)
        return failed(
            "openspec_artifacts",
            f"Complete lifecycle artifacts not found ({errors[0]})",
        )

    for change_dir in candidates:
        if (change_dir / "proposal.md").exists() and (change_dir / "tasks.md").exists():
            return passed("openspec_artifacts")

    first = candidates[0]
    return failed(
        "openspec_artifacts",
        f"proposal.md/tasks.md not found together in any change dir "
        f"(checked {len(candidates)}; e.g. {first})",
    )


def check_sentence_feature():
    """Check that the sentence counting feature was implemented."""
    wordcount = WORKSPACE / "wordcount.py"
    if not wordcount.exists():
        return failed("sentence_feature", "wordcount.py not found")

    content = wordcount.read_text()

    # Check for --sentences flag
    if "--sentences" not in content:
        return failed("sentence_feature", "--sentences flag not found in wordcount.py")

    # Check that it actually works
    try:
        result = subprocess.run(
            [sys.executable, str(wordcount), "--sentences"],
            input="Hello world. How are you? Fine!",
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return failed("sentence_feature", f"wordcount.py --sentences failed: {result.stderr}")

        # Should count 3 sentences
        if "3" not in result.stdout:
            return failed("sentence_feature", f"Expected 3 sentences, got: {result.stdout}")

    except Exception as e:
        return failed("sentence_feature", f"Error running wordcount.py: {e}")

    return passed("sentence_feature")


def check_tests_exist():
    """Check that tests were written for the new feature."""
    # Look for test files
    test_files = list(WORKSPACE.glob("test_*.py"))
    if not test_files:
        return failed("tests_exist", "No test files found")

    # Check if any test file has sentence-related tests
    for tf in test_files:
        content = tf.read_text()
        if "sentence" in content.lower() or "sentences" in content.lower():
            return passed("tests_exist")

    return failed("tests_exist", "No sentence-related tests found")


def check_comet_state():
    """Check that .comet.yaml state file was created."""
    relative_changes, layout_error = _layout_contract()
    if layout_error:
        return failed("comet_state", layout_error)
    if _uses_current_layout():
        changes_dir = WORKSPACE / relative_changes
        candidates = _archived_candidates(changes_dir)
        if not candidates:
            return failed("comet_state", "No archived current-layout change found")
        errors = []
        for change_dir in candidates:
            error = _terminal_state_error(change_dir)
            if not error:
                return passed("comet_state")
            errors.append(error)
        return failed("comet_state", f"No complete terminal state found ({errors[0]})")

    # Look for .comet.yaml anywhere in the workspace
    comet_files = list(WORKSPACE.rglob(".comet.yaml"))
    if not comet_files:
        # Also check for openspec status files
        status_files = list(WORKSPACE.rglob("*.yaml"))
        comet_like = [f for f in status_files if "comet" in f.name.lower()]
        if not comet_like:
            return failed("comet_state", "No .comet.yaml or comet state files found")
        return passed("comet_state")

    return passed("comet_state")


def check_workflow_phases():
    """Check that each current layout treatment traversed every Classic phase."""
    relative_changes, layout_error = _layout_contract()
    if layout_error:
        return failed("workflow_phases", layout_error)
    if _uses_current_layout():
        candidates = _archived_candidates(WORKSPACE / relative_changes)
        if not candidates:
            return failed("workflow_phases", "No archived current-layout change found")
        errors = []
        for change_dir in candidates:
            terminal_error = _terminal_state_error(change_dir)
            transition_error = _transition_error(change_dir)
            if not terminal_error and not transition_error:
                return passed("workflow_phases")
            errors.append(terminal_error or transition_error)
        return failed(
            "workflow_phases",
            f"Complete open-design-build-verify-archive trajectory not found ({errors[0]})",
        )

    # Frozen legacy treatments retain their existing artifact-based compatibility
    # signal; current docs and legacy treatments require current state events and
    # trajectory files.
    # Look for evidence of multiple phases in any markdown files
    md_files = list(WORKSPACE.rglob("*.md"))
    all_content = " ".join(f.read_text() for f in md_files if f.exists())

    phases_found = []
    phase_keywords = {
        "open": ["proposal", "design outline", "task list"],
        "design": ["design doc", "brainstorming", "technical design"],
        "build": ["implementation", "plan", "code"],
        "verify": ["verification", "test results", "passed"],
    }

    for phase, keywords in phase_keywords.items():
        if any(kw in all_content.lower() for kw in keywords):
            phases_found.append(phase)

    if len(phases_found) >= 2:
        return passed("workflow_phases")

    return failed("workflow_phases", f"Only found evidence of phases: {phases_found}")


def main():
    results = []

    results.append(check_openspec_artifacts())
    results.append(check_current_cli_init_smoke())
    results.append(check_sentence_feature())
    results.append(check_tests_exist())
    results.append(check_comet_state())
    results.append(check_workflow_phases())

    passed_list = [r["check"] for r in results if r["status"] == "passed"]
    failed_list = [
        f"{r['check']}: {r.get('reason', '')}" for r in results if r["status"] == "failed"
    ]

    output = {"passed": passed_list, "failed": failed_list}

    # Write results file
    (WORKSPACE / RESULTS_FILE).write_text(json.dumps(output, indent=2))

    # Also print for stdout capture
    print(json.dumps(output))

    return 0 if not failed_list else 1


if __name__ == "__main__":
    sys.exit(main())
