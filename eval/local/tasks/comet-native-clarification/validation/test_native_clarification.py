"""Validate Native clarification, confirmation, implementation, and archive artifacts."""

import json
import os
import subprocess
import sys
from pathlib import Path

import yaml


WORKSPACE = Path("/workspace")
RESULTS_FILE = os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")


def passed(name: str):
    return {"check": name, "status": "passed"}


def failed(name: str, reason: str):
    return {"check": name, "status": "failed", "reason": reason}


def archive_directories():
    root = WORKSPACE / "docs" / "comet" / "archive"
    return sorted(path for path in root.glob("*-*") if path.is_dir())


def archive_directory():
    candidates = archive_directories()
    return candidates[-1] if candidates else None


def canonical_spec_files():
    root = WORKSPACE / "docs" / "comet" / "specs"
    return sorted(root.glob("*/spec.md"))


def active_change_directories():
    root = WORKSPACE / "docs" / "comet" / "changes"
    return sorted(path for path in root.glob("*") if path.is_dir())


def read_interaction():
    context = WORKSPACE / "_test_context.json"
    if not context.is_file():
        return {}
    return json.loads(context.read_text(encoding="utf-8")).get("interaction") or {}


def check_behavior():
    try:
        subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=WORKSPACE,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        result = subprocess.run(
            [sys.executable, "wordcount.py", "--sentences"],
            cwd=WORKSPACE,
            input="Use e.g. examples. Ask Dr. Smith!",
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
    except Exception as error:
        return failed("clarified_behavior", str(error))
    if "Sentences: 2" not in result.stdout:
        return failed("clarified_behavior", f"Expected Sentences: 2, got {result.stdout!r}")
    return passed("clarified_behavior")


def check_confirmed_archive():
    active = active_change_directories()
    if active:
        return failed(
            "confirmed_archive",
            f"Expected no active change after archive, found {len(active)}",
        )
    archives = archive_directories()
    if len(archives) != 1:
        return failed(
            "confirmed_archive",
            f"Expected exactly one Native archive for the clarified change, found {len(archives)}",
    )
    archived = archives[0]
    state_file = archived / "comet-state.yaml"
    if not state_file.is_file():
        return failed("confirmed_archive", "Archived comet-state.yaml is missing")
    state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
    if state.get("phase") != "archive" or state.get("archived") is not True:
        return failed("confirmed_archive", "Archived state is not terminal")
    if state.get("approval") != "confirmed":
        return failed("confirmed_archive", "Shape did not record explicit confirmation")
    if state.get("verification_result") != "pass":
        return failed("confirmed_archive", "Verify did not record a passing result")
    brief_file = archived / "brief.md"
    if not brief_file.is_file():
        return failed("confirmed_archive", "Archived brief is missing")
    brief = brief_file.read_text(encoding="utf-8").lower()
    if not all(marker in brief for marker in ("abbreviation", "e.g.", "dr.")):
        return failed("confirmed_archive", "The confirmed abbreviation decision is missing")

    spec_changes = state.get("spec_changes") or []
    if len(spec_changes) != 1 or not isinstance(spec_changes[0], dict):
        return failed("confirmed_archive", "Expected exactly one linked capability change")
    spec_change = spec_changes[0]
    capability = spec_change.get("capability")
    expected_source = f"specs/{capability}/spec.md"
    if not capability or spec_change.get("source") != expected_source:
        return failed("confirmed_archive", "Archived spec change is not linked to its capability")

    canonical_specs = canonical_spec_files()
    canonical_path = WORKSPACE / "docs" / "comet" / "specs" / capability / "spec.md"
    if canonical_specs != [canonical_path]:
        return failed(
            "confirmed_archive",
            "Canonical specification does not match the archived capability",
        )
    archived_spec = archived / expected_source
    if not archived_spec.is_file():
        return failed("confirmed_archive", "Archived target specification is missing")
    canonical_source = canonical_path.read_text(encoding="utf-8")
    if canonical_source != archived_spec.read_text(encoding="utf-8"):
        return failed("confirmed_archive", "Archived and canonical specifications differ")
    canonical = canonical_source.lower()
    if "--sentences" not in canonical or not any(
        marker in canonical for marker in ("abbreviation", "e.g.", "dr.")
    ):
        return failed(
            "confirmed_archive",
            "The canonical target specification does not cover sentence counting and abbreviations",
        )

    report_name = state.get("verification_report")
    report_file = archived / str(report_name or "")
    if report_name != "verification.md" or not report_file.is_file():
        return failed("confirmed_archive", "Verification evidence is missing")
    report = report_file.read_text(encoding="utf-8").lower()
    if "pass" not in report or "pytest" not in report:
        return failed("confirmed_archive", "Verification evidence does not record passing tests")

    trajectory_file = archived / "runtime" / "trajectory.jsonl"
    if not trajectory_file.is_file():
        return failed("confirmed_archive", "Native trajectory is missing")
    transitions = []
    for line in trajectory_file.read_text(encoding="utf-8").splitlines():
        event = json.loads(line)
        if event.get("type") == "state_transitioned":
            data = event.get("data") or {}
            transitions.append((data.get("previousPhase"), data.get("nextPhase")))
    expected_transitions = [
        ("shape", "build"),
        ("build", "verify"),
        ("verify", "archive"),
        ("archive", None),
    ]
    if transitions != expected_transitions:
        return failed("confirmed_archive", "Native trajectory does not cover every phase exactly once")

    interaction = read_interaction()
    if interaction.get("mode") != "auto_user":
        return failed("confirmed_archive", "Clarification interaction metadata is missing")
    if interaction.get("decision_points") != 1 or interaction.get("deterministic_replies") != 1:
        return failed("confirmed_archive", "Expected exactly one deterministic clarification reply")
    turns = interaction.get("actual_turns")
    maximum = interaction.get("max_turns")
    if not isinstance(turns, int) or not isinstance(maximum, int) or not (2 <= turns <= maximum):
        return failed("confirmed_archive", "Clarification driver turn count is invalid")
    return passed("confirmed_archive")


def main():
    results = [check_behavior(), check_confirmed_archive()]
    output = {
        "passed": [result["check"] for result in results if result["status"] == "passed"],
        "failed": [
            f'{result["check"]}: {result.get("reason", "")}'
            for result in results
            if result["status"] == "failed"
        ],
    }
    (WORKSPACE / RESULTS_FILE).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output))
    return 0 if not output["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
