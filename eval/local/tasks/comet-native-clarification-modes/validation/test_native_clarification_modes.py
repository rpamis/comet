"""Validate paired Native clarification-mode behavior and terminal artifacts."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml


WORKSPACE = Path("/workspace")
RESULTS_FILE = os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")
EXPECTED_MODES = {
    "COMET_NATIVE_SEQUENTIAL": "sequential",
    "COMET_NATIVE_BATCH": "batch",
}


def passed(name: str):
    return {"check": name, "status": "passed"}


def failed(name: str, reason: str):
    return {"check": name, "status": "failed", "reason": reason}


def missing_decisions(text: str) -> list[str]:
    """Return user decisions that are not preserved semantically in an artifact."""
    normalized = " ".join(text.lower().split())
    missing = []
    abbreviation = "abbrevi" in normalized and bool(
        re.search(
            r"(?:do|does|should)\s+not\s+(?:end|count)|"
            r"(?:ignored|filtered|excluded)\s+as\s+(?:a\s+)?sentence\s+boundar|"
            r"abbrevi.{0,240}not.{0,80}(?:sentence\s+(?:ending|boundar)|false\s+boundar)",
            normalized,
        )
    )
    if not abbreviation:
        missing.append("abbreviation behavior")

    empty = "empty" in normalized and bool(
        re.search(
            r"empty.{0,180}(?:returns?|prints?|result(?:\s+is)?|sentences:)"
            r"[^0-9]{0,24}0\b",
            normalized,
        )
    )
    if not empty:
        missing.append("empty-input count")

    terminators = bool(
        re.search(
            r"(?:consecutive|contiguous|run\s+of).{0,100}(?:terminator|punctuation)", normalized
        )
        and re.search(r"(?:one|single|exactly\s+one).{0,40}(?:sentence\s+)?boundar", normalized)
    )
    if not terminators:
        missing.append("terminator-run behavior")
    return missing


def approval_is_valid(mode: str | None, approval: str | None) -> bool:
    if mode == "sequential":
        return approval in {"implicit", "confirmed"}
    return approval == "confirmed"


def read_context() -> dict:
    path = WORKSPACE / "_test_context.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def archive_directories():
    root = WORKSPACE / "docs" / "comet" / "archive"
    return sorted(path for path in root.glob("*-*") if path.is_dir())


def check_behavior():
    cases = [
        ("", "Sentences: 0"),
        ("Use e.g. examples. Ask Dr. Smith!", "Sentences: 2"),
        ("Really?! Yes.", "Sentences: 2"),
    ]
    try:
        subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=WORKSPACE,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        for source, expected in cases:
            result = subprocess.run(
                [sys.executable, "wordcount.py", "--sentences"],
                cwd=WORKSPACE,
                input=source,
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            if expected not in result.stdout:
                return failed(
                    "clarification_mode_behavior", f"Expected {expected!r}, got {result.stdout!r}"
                )
    except Exception as error:
        return failed("clarification_mode_behavior", str(error))
    return passed("clarification_mode_behavior")


def check_mode_and_interaction():
    context = read_context()
    treatment = context.get("treatment_name")
    expected_mode = EXPECTED_MODES.get(treatment)
    if not expected_mode:
        return failed("clarification_mode_protocol", f"Unexpected treatment: {treatment!r}")

    config_file = WORKSPACE / ".comet" / "config.yaml"
    config = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
    actual_mode = (config.get("native") or {}).get("clarification_mode")
    if actual_mode != expected_mode:
        return failed(
            "clarification_mode_protocol",
            f"Expected native.clarification_mode {expected_mode}, got {actual_mode!r}",
        )

    interaction = context.get("interaction") or {}
    if interaction.get("mode") != "auto_user" or interaction.get("deterministic_replies") != 0:
        return failed("clarification_mode_protocol", "Interactive simulator metadata is invalid")
    decision_points = interaction.get("decision_points")
    expected_points = 2 if expected_mode == "batch" else 3
    if decision_points != expected_points:
        return failed(
            "clarification_mode_protocol",
            f"Expected {expected_points} decision rounds for {expected_mode}, got {decision_points!r}",
        )
    turns = interaction.get("actual_turns")
    if not isinstance(turns, int) or turns < decision_points + 1:
        return failed(
            "clarification_mode_protocol", "Subject turn count is shorter than decision rounds"
        )
    return passed("clarification_mode_protocol")


def check_confirmed_archive():
    active_root = WORKSPACE / "docs" / "comet" / "changes"
    active = sorted(path for path in active_root.glob("*") if path.is_dir())
    if active:
        return failed("clarification_mode_archive", f"Active changes remain: {len(active)}")
    archives = archive_directories()
    if len(archives) != 1:
        return failed("clarification_mode_archive", f"Expected one archive, found {len(archives)}")
    archived = archives[0]
    state_file = archived / "comet-state.yaml"
    if not state_file.is_file():
        return failed("clarification_mode_archive", "Archived state is missing")
    state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
    if state.get("phase") != "archive" or state.get("archived") is not True:
        return failed("clarification_mode_archive", "Archived state is not terminal")
    config_file = WORKSPACE / ".comet" / "config.yaml"
    project_config = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
    clarification_mode = (project_config.get("native") or {}).get("clarification_mode")
    if (
        not approval_is_valid(clarification_mode, state.get("approval"))
        or state.get("verification_result") != "pass"
    ):
        return failed(
            "clarification_mode_archive", "Approval or verification evidence is incomplete"
        )

    brief_file = archived / "brief.md"
    if not brief_file.is_file():
        return failed("clarification_mode_archive", "Archived brief is missing")
    brief = brief_file.read_text(encoding="utf-8")
    missing_brief = missing_decisions(brief)
    if missing_brief:
        return failed(
            "clarification_mode_archive",
            "Brief does not preserve decisions: " + ", ".join(missing_brief),
        )

    spec_changes = state.get("spec_changes") or []
    if len(spec_changes) != 1 or not isinstance(spec_changes[0], dict):
        return failed("clarification_mode_archive", "Expected one capability specification")
    capability = spec_changes[0].get("capability")
    source = spec_changes[0].get("source")
    canonical = WORKSPACE / "docs" / "comet" / "specs" / str(capability) / "spec.md"
    archived_spec = archived / str(source or "")
    if not capability or source != f"specs/{capability}/spec.md":
        return failed("clarification_mode_archive", "Specification link is invalid")
    if not canonical.is_file() or not archived_spec.is_file():
        return failed(
            "clarification_mode_archive", "Canonical or archived specification is missing"
        )
    canonical_text = canonical.read_text(encoding="utf-8")
    if canonical_text.lower() != archived_spec.read_text(encoding="utf-8").lower():
        return failed("clarification_mode_archive", "Canonical and archived specifications differ")
    missing_spec = missing_decisions(canonical_text)
    if missing_spec:
        return failed(
            "clarification_mode_archive",
            "Target specification does not preserve decisions: " + ", ".join(missing_spec),
        )

    report = archived / str(state.get("verification_report") or "")
    if state.get("verification_report") != "verification.md" or not report.is_file():
        return failed("clarification_mode_archive", "Verification report is missing")
    if "pass" not in report.read_text(encoding="utf-8").lower():
        return failed("clarification_mode_archive", "Verification report is not passing")
    return passed("clarification_mode_archive")


def main():
    results = [check_behavior(), check_mode_and_interaction(), check_confirmed_archive()]
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
