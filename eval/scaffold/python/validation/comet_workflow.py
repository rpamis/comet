"""Shared comet-workflow validation checks for eval tasks.

Each comet task validator imports :func:`run_comet_checks` to get the four
generic checks (openspec artifacts, comet state, workflow phases, tests written)
and appends its own task-specific checks. All checks run inside Docker and emit
results via the standard ``_test_results.json`` protocol.

A check is a dict ``{"check": <name>, "status": "passed"|"failed", "message": ...}``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

WORKSPACE = Path("/workspace")
RESULTS_FILE = "_test_results.json"


def _passed(name: str, message: str = "") -> dict:
    return {"check": name, "status": "passed", "message": message}


def _failed(name: str, message: str) -> dict:
    return {"check": name, "status": "failed", "message": message}


def check_openspec_artifacts() -> dict:
    """proposal.md + tasks.md exist in a change dir (active or archived)."""
    changes_dir = WORKSPACE / "openspec" / "changes"
    if not changes_dir.exists():
        return _failed("openspec_artifacts", "openspec/changes/ directory not found")

    candidates: list[Path] = []
    for d in changes_dir.iterdir():
        if not d.is_dir():
            continue
        if d.name == "archive":
            candidates.extend(s for s in d.iterdir() if s.is_dir())
        else:
            candidates.append(d)

    if not candidates:
        return _failed("openspec_artifacts", "No change directories found")

    for change_dir in candidates:
        if (change_dir / "proposal.md").exists() and (change_dir / "tasks.md").exists():
            return _passed("openspec_artifacts", f"found in {change_dir.name}")

    return _failed("openspec_artifacts", f"proposal.md/tasks.md not found together (checked {len(candidates)} dirs)")


def check_comet_state() -> dict:
    """A .comet.yaml exists somewhere under openspec/changes with a sane phase."""
    changes_dir = WORKSPACE / "openspec" / "changes"
    if not changes_dir.exists():
        return _failed("comet_state", "openspec/changes/ not found")

    # Search active + archived change dirs for .comet.yaml.
    state_files: list[Path] = []
    for root, _dirs, files in os_walk(changes_dir):
        for f in files:
            if f == ".comet.yaml":
                state_files.append(Path(root) / f)

    if not state_files:
        archive_dir = changes_dir / "archive"
        if archive_dir.exists():
            for change_dir in archive_dir.iterdir():
                if not change_dir.is_dir():
                    continue
                if (change_dir / "proposal.md").exists() and (change_dir / "tasks.md").exists():
                    return _passed("comet_state", "phase=archived")
        return _failed("comet_state", "No .comet.yaml found under openspec/changes/")

    # Read the first one and check it has a recognised phase.
    try:
        text = state_files[0].read_text(errors="ignore")
    except OSError:
        return _failed("comet_state", f"Cannot read {state_files[0]}")

    m = re.search(r"^phase:\s*(\S+)", text, re.MULTILINE)
    if not m:
        return _failed("comet_state", "No 'phase:' field in .comet.yaml")
    phase = m.group(1)
    valid = {"open", "design", "build", "verify", "archive", "archived"}
    if phase not in valid:
        return _failed("comet_state", f"Unrecognised phase: {phase}")
    return _passed("comet_state", f"phase={phase}")


def check_workflow_phases() -> dict:
    """Evidence of the 5 phases: proposal→design→plan/build→verify→archive."""
    evidence = 0
    found: list[str] = []

    # Phase 1 (open): proposal/tasks
    if _glob_exists("openspec/changes/**/proposal.md") or _glob_exists("openspec/changes/**/tasks.md"):
        evidence += 1
        found.append("open")
    # Phase 2 (design): design.md or docs/superpowers/specs/
    if _glob_exists("openspec/changes/**/design.md") or _glob_exists("docs/superpowers/specs/*.md"):
        evidence += 1
        found.append("design")
    # Phase 3 (build): plan.md, docs/superpowers/plans/, or .comet/ handoff
    if _glob_exists("openspec/changes/**/plan.md") or _glob_exists("docs/superpowers/plans/*.md") or _glob_exists("openspec/changes/**/.comet/"):
        evidence += 1
        found.append("build")
    # Phase 4 (verify): verification report or docs/superpowers/reports/
    if (
        _glob_exists("openspec/changes/**/verification.md")
        or _glob_exists("openspec/changes/**/verification-report.md")
        or _glob_exists("docs/superpowers/reports/*.md")
    ):
        evidence += 1
        found.append("verify")
    # Phase 5 (archive): openspec/changes/archive/
    if (WORKSPACE / "openspec" / "changes" / "archive").exists():
        evidence += 1
        found.append("archive")

    if evidence >= 4:
        return _passed("workflow_phases", f"{evidence}/5 phases ({','.join(found)})")
    if evidence >= 2:
        return _failed("workflow_phases", f"Only {evidence}/5 phases evidenced ({','.join(found)})")
    return _failed("workflow_phases", f"Only {evidence}/5 phases ({','.join(found)})")


def check_tests_written() -> dict:
    """The agent wrote or extended tests (test_*.py with real assertions)."""
    test_files = list(WORKSPACE.glob("test_*.py")) + list(WORKSPACE.glob("**/test_*.py"))
    # Filter out the validator itself and scaffold copies.
    test_files = [f for f in test_files if "scaffold" not in str(f) and "validation" not in str(f)]
    has_assert = False
    for tf in test_files:
        try:
            if "assert" in tf.read_text(errors="ignore").lower():
                has_assert = True
                break
        except OSError:
            continue
    if has_assert:
        return _passed("tests_written", f"{len(test_files)} test file(s) with assertions")
    if test_files:
        return _failed("tests_written", f"{len(test_files)} test file(s) but none with assertions")
    return _failed("tests_written", "No test files written by the agent")


def run_comet_checks() -> list[dict]:
    """Run all four generic comet-workflow checks."""
    return [
        check_openspec_artifacts(),
        check_comet_state(),
        check_workflow_phases(),
        check_tests_written(),
    ]


def write_results(results: list[dict]) -> None:
    """Write the combined results to _test_results.json and print a summary."""
    out = {"checks": results}
    results_path = WORKSPACE / RESULTS_FILE
    try:
        results_path.write_text(json.dumps(out))
    except OSError:
        pass
    failed = [r for r in results if r["status"] == "failed"]
    for r in results:
        status = "✓" if r["status"] == "passed" else "✗"
        print(f"  {status} {r['check']}: {r.get('message', '')}")
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        import sys
        sys.exit(1)


# --- helpers ---------------------------------------------------------------

def os_walk(root: Path):
    """os.walk that tolerates permission errors."""
    import os
    for dirpath, dirnames, filenames in os.walk(root):
        yield dirpath, dirnames, filenames


def _glob_exists(pattern: str) -> bool:
    """True if any file matches the glob pattern under WORKSPACE."""
    try:
        return any(WORKSPACE.glob(pattern))
    except Exception:
        return False
