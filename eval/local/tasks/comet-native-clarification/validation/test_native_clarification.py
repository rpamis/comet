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


def archive_directory():
    root = WORKSPACE / "docs" / "comet" / "archive"
    candidates = sorted(path for path in root.glob("*-*") if path.is_dir())
    return candidates[-1] if candidates else None


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
    archived = archive_directory()
    if archived is None:
        return failed("confirmed_archive", "No Native archive exists")
    state = yaml.safe_load((archived / "change.yaml").read_text(encoding="utf-8"))
    if state.get("approval") != "confirmed":
        return failed("confirmed_archive", "Shape did not record explicit confirmation")
    brief = (archived / "brief.md").read_text(encoding="utf-8").lower()
    if "abbreviation" not in brief and "e.g." not in brief:
        return failed("confirmed_archive", "The confirmed abbreviation decision is missing")
    canonical = WORKSPACE / "docs" / "comet" / "specs" / "sentence-counting" / "spec.md"
    if not canonical.is_file():
        return failed("confirmed_archive", "The canonical target specification is missing")
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
