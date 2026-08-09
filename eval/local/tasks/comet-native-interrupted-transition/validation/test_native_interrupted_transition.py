"""Validate deterministic transition recovery and completed Native work."""

import json
import os
import subprocess
import sys
from pathlib import Path

import yaml


WORKSPACE = Path("/workspace")
RESULTS_FILE = os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")
TRANSITION_ID = "11111111-2222-4333-8444-555555555555"


def check_behavior():
    subprocess.run([sys.executable, "-m", "pytest", "-q"], cwd=WORKSPACE, check=True)
    result = subprocess.run(
        [sys.executable, "wordcount.py", "--characters"],
        cwd=WORKSPACE,
        input="ab c\n",
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Characters: 5" in result.stdout


def check_recovery():
    archives = sorted((WORKSPACE / "docs/comet/archive").glob("*-add-character-counting"))
    assert archives
    archived = archives[-1]
    state = yaml.safe_load((archived / "comet-state.yaml").read_text(encoding="utf-8")) or {}
    assert state.get("schema") == "comet.native.v4"
    assert state.get("archived") is True
    assert not (archived / "runtime").exists()
    assert not (archived / "transition.json").exists()
    assert (WORKSPACE / "docs/comet/specs/character-counting/spec.md").is_file()


def main():
    failed = []
    for name, check in (
        ("character_behavior", check_behavior),
        ("transition_recovery", check_recovery),
    ):
        try:
            check()
        except Exception as error:
            failed.append(f"{name}: {error}")
    output = {
        "passed": [] if failed else ["character_behavior", "transition_recovery"],
        "failed": failed,
    }
    (WORKSPACE / RESULTS_FILE).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
