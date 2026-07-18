"""Validate repository-fact discovery and implicit Native completion."""

import json
import os
import subprocess
import sys
from pathlib import Path

import yaml


WORKSPACE = Path("/workspace")
RESULTS_FILE = os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")


def check_behavior():
    subprocess.run([sys.executable, "-m", "pytest", "-q"], cwd=WORKSPACE, check=True)
    result = subprocess.run(
        [sys.executable, "wordcount.py", "--paragraphs"],
        cwd=WORKSPACE,
        input="First block\ncontinues\n\n   \nSecond block",
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Paragraphs: 2" in result.stdout


def check_native():
    archives = sorted((WORKSPACE / "docs/comet/archive").glob("*-*"))
    assert archives
    state = yaml.safe_load((archives[-1] / "comet-state.yaml").read_text(encoding="utf-8"))
    assert state["approval"] == "implicit"
    brief = (archives[-1] / "brief.md").read_text(encoding="utf-8").lower()
    assert "whitespace" in brief or "blank line" in brief
    assert (WORKSPACE / "docs/comet/specs/paragraph-counting/spec.md").is_file()


def main():
    failed = []
    for name, check in (("paragraph_behavior", check_behavior), ("native_artifacts", check_native)):
        try:
            check()
        except Exception as error:
            failed.append(f"{name}: {error}")
    output = {"passed": [] if failed else ["paragraph_behavior", "native_artifacts"], "failed": failed}
    (WORKSPACE / RESULTS_FILE).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
