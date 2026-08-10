"""Validate the self-contained Comet Native workflow task for beta17."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import yaml


WORKSPACE = Path("/workspace")
RESULTS_FILE = os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")


def passed(name: str):
    return {"check": name, "status": "passed"}


def failed(name: str, reason: str):
    return {"check": name, "status": "failed", "reason": reason}


def _read_yaml(path: Path):
    if not path.is_file() or path.is_symlink():
        return None
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return None
    return value if isinstance(value, dict) else None


def archive_directory():
    archive_root = WORKSPACE / "docs" / "comet" / "archive"
    candidates = sorted(path for path in archive_root.glob("*-*") if path.is_dir())
    return candidates[-1] if candidates else None


def _portable_text(value):
    return (
        isinstance(value, dict)
        and isinstance(value.get("text"), str)
        and isinstance(value.get("truncated"), bool)
    )


def _portable_timestamp(value):
    return isinstance(value, (str, datetime, date))


def _all_acceptance_passed(state):
    acceptance = state.get("acceptance")
    return (
        isinstance(acceptance, list)
        and bool(acceptance)
        and all(isinstance(item, dict) and item.get("result") == "passed" for item in acceptance)
    )


def _history_is_valid(state):
    history = state.get("history")
    if not isinstance(history, list) or len(history) > 50:
        return False
    overflow = state.get("history_overflow")
    counts = overflow.get("outcome_counts") if isinstance(overflow, dict) else None
    if (
        not isinstance(overflow, dict)
        or not isinstance(overflow.get("dropped_entries"), int)
        or overflow.get("dropped_entries") < 0
        or not isinstance(counts, dict)
        or set(counts) != {"pass", "fail", "blocked", "execution-error", "recovery"}
        or any(not isinstance(value, int) or value < 0 for value in counts.values())
        or sum(counts.values()) != overflow.get("dropped_entries")
    ):
        return False
    outcomes = {"pass", "fail", "blocked", "execution-error", "recovery"}
    for entry in history:
        if not isinstance(entry, dict) or any(
            not isinstance(entry.get(field), int)
            for field in ("goal_cycle", "iteration", "attempt")
        ):
            return False
        if (
            entry.get("outcome") not in outcomes
            or not isinstance(entry.get("unresolved_ids"), list)
            or not _portable_text(entry.get("summary"))
            or not _portable_timestamp(entry.get("completed_at"))
        ):
            return False
        serialized = json.dumps(entry, default=str).lower()
        if any(
            marker in serialized
            for marker in ("chain_of_thought", "reasoning_content", "hidden_reasoning")
        ):
            return False
    return True


def check_feature():
    try:
        subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=WORKSPACE,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=True,
        )
        result = subprocess.run(
            [sys.executable, "wordcount.py", "--sentences"],
            cwd=WORKSPACE,
            input="Hello world. How are you? Fine!",
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
            check=True,
        )
    except Exception as error:
        return failed("sentence_feature", str(error))
    if "Sentences: 3" not in result.stdout:
        return failed("sentence_feature", f"Expected Sentences: 3, got {result.stdout!r}")
    tests = (WORKSPACE / "test_wordcount.py").read_text(encoding="utf-8").lower()
    if "sentence" not in tests:
        return failed("sentence_feature", "No sentence-counting tests were added")
    return passed("sentence_feature")


def check_native_artifacts():
    config = _read_yaml(WORKSPACE / ".comet" / "config.yaml")
    native = config.get("native") if isinstance(config, dict) else None
    if (
        not isinstance(config, dict)
        or config.get("schema") != "comet.project.v1"
        or config.get("default_workflow") != "native"
        or "native" not in (config.get("workflows") or [])
        or not isinstance(native, dict)
        or native.get("artifact_root") != "docs"
        or native.get("max_verify_failures") != 5
        or native.get("archive_confirmation", "automatic") != "automatic"
    ):
        return failed("native_artifacts", "beta17 .comet/config.yaml is invalid")

    archived = archive_directory()
    if archived is None:
        return failed("native_artifacts", "No date-prefixed Native archive exists")
    state = _read_yaml(archived / "comet-state.yaml")
    loop = state.get("loop") if isinstance(state, dict) else None
    verification = state.get("verification") if isinstance(state, dict) else None
    required = ["brief.md", "comet-state.yaml", "verification.md"]
    missing = [relative for relative in required if not (archived / relative).is_file()]
    if missing:
        return failed("native_artifacts", f"Archive is missing: {', '.join(missing)}")
    if not list((archived / "specs").rglob("*.md")):
        return failed("native_artifacts", "Archive has no complete proposed specification")
    changes_root = WORKSPACE / "docs" / "comet" / "changes"
    if changes_root.is_dir() and any(changes_root.iterdir()):
        return failed("native_artifacts", "An active Native change remains after archive")
    if (
        not isinstance(state, dict)
        or state.get("schema") != "comet.native.v4"
        or state.get("phase") != "archive"
        or state.get("status") != "done"
        or state.get("archived") is not True
        or state.get("verification_result") != "pass"
        or state.get("verification_report") != "verification.md"
        or not isinstance(loop, dict)
        or loop.get("stage") != "done"
        or not isinstance(verification, dict)
        or verification.get("verdict") != "pass"
        or not _all_acceptance_passed(state)
        or not _history_is_valid(state)
    ):
        return failed("native_artifacts", "Archive state is not a terminal beta17 pass")
    return passed("native_artifacts")


def check_loop():
    """Check portable Loop state; a valid direct pass need not contain failed history."""
    archived = archive_directory()
    state = _read_yaml(archived / "comet-state.yaml") if archived else None
    if not isinstance(state, dict):
        return failed("loop", "Archive state is unavailable")
    loop = state.get("loop")
    if not isinstance(loop, dict) or loop.get("stage") != "done":
        return failed("loop", "Portable loop is not in the done stage")
    if not _history_is_valid(state):
        return failed("loop", "Portable history is invalid")
    return passed("loop")


def check_isolation():
    comet_config_dir = WORKSPACE / ".comet"
    hidden_entries = (
        {path.name for path in comet_config_dir.iterdir()} if comet_config_dir.is_dir() else set()
    )
    allowed_entries = {"config.yaml", "runtime", "current-change.json"}
    present = []
    if (WORKSPACE / "openspec").exists():
        present.append("openspec")
    present.extend(f".comet/{name}" for name in sorted(hidden_entries - allowed_entries))
    for name in sorted(hidden_entries & allowed_entries):
        target = comet_config_dir / name
        if name == "runtime" and (target.is_symlink() or not target.is_dir()):
            present.append(f".comet/{name}")
        elif name != "runtime" and (target.is_symlink() or not target.is_file()):
            present.append(f".comet/{name}")
    for root in (
        WORKSPACE / "docs" / "comet" / "changes",
        WORKSPACE / "docs" / "comet" / "archive",
    ):
        if root.is_dir():
            present.extend(
                f"{change.relative_to(WORKSPACE)}/runtime"
                for change in root.iterdir()
                if change.is_dir()
                and ((change / "runtime").exists() or (change / "runtime").is_symlink())
            )
    if present:
        return failed("native_isolation", f"Forbidden workflow artifacts exist: {present}")
    skills_root = WORKSPACE / ".claude" / "skills"
    if skills_root.exists():
        installed = {path.name for path in skills_root.iterdir() if path.is_dir()}
        if installed != {"comet-native"}:
            return failed("native_isolation", f"Unexpected installed Skills: {sorted(installed)}")
    return passed("native_isolation")


def main():
    results = [check_feature(), check_native_artifacts(), check_loop(), check_isolation()]
    output = {
        "passed": [result["check"] for result in results if result["status"] == "passed"],
        "failed": [
            f"{result['check']}: {result.get('reason', '')}"
            for result in results
            if result["status"] == "failed"
        ],
    }
    (WORKSPACE / RESULTS_FILE).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output))
    return 0 if not output["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
