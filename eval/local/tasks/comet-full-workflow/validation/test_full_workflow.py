"""Validation script for comet full workflow task.

Runs inside Docker. Checks that Claude followed the comet workflow
and implemented the sentence counting feature correctly.
"""

import json
import os
import subprocess
import sys
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
    """Resolve the OpenSpec root selected by the current Classic treatment."""
    selected = CURRENT_LAYOUTS.get(current_treatment())
    config_path = WORKSPACE / ".comet/config.yaml"
    if not config_path.exists():
        if selected is None:
            return LEGACY_CHANGES, None
        return (
            selected[1],
            ".comet/config.yaml is required for the current Classic treatment",
        )

    config, error = _read_yaml(config_path)
    if error:
        return selected[1] if selected else LEGACY_CHANGES, error

    classic = config.get("classic")
    configured_layout = classic.get("artifact_layout") if isinstance(classic, dict) else None
    if configured_layout not in {"docs", "legacy"}:
        return (
            selected[1] if selected else LEGACY_CHANGES,
            "classic.artifact_layout must be docs or legacy",
        )
    if selected is not None and configured_layout != selected[0]:
        return (
            selected[1],
            "classic.artifact_layout does not match the selected Classic treatment",
        )
    changes = DOCS_CHANGES if configured_layout == "docs" else LEGACY_CHANGES
    if selected is not None and (WORKSPACE / selected[2]).exists():
        return (
            changes,
            f"alternate {selected[2].as_posix()}/ root exists for the selected Classic layout",
        )
    return changes, None


def check_openspec_artifacts():
    """Check that OpenSpec artifacts were created (proposal, design, tasks).

    Resolve the root from the current Classic layout. Current docs-layout runs
    use docs/openspec/changes; frozen legacy runs retain openspec/changes.
    """
    relative_changes, layout_error = _layout_contract()
    if layout_error:
        return failed("openspec_artifacts", layout_error)
    changes_dir = WORKSPACE / relative_changes
    if not changes_dir.exists():
        return failed(
            "openspec_artifacts",
            f"{relative_changes.as_posix()}/ directory not found",
        )

    # Candidate change dirs: direct children of the selected changes root
    # (excluding the archive/ container itself) plus archived change children.
    candidates = []
    for d in changes_dir.iterdir():
        if not d.is_dir():
            continue
        if d.name == "archive":
            for sub in d.iterdir():
                if sub.is_dir():
                    candidates.append(sub)
        else:
            candidates.append(d)

    if not candidates:
        return failed(
            "openspec_artifacts",
            f"No change directories found in {relative_changes.as_posix()}/",
        )

    for change_dir in candidates:
        if (change_dir / "proposal.md").exists() and (change_dir / "tasks.md").exists():
            return passed("openspec_artifacts")

    first = candidates[0]
    return failed(
        "openspec_artifacts",
        "proposal.md/tasks.md not found together in any change dir "
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
    """Check that multiple workflow phases were evident."""
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
