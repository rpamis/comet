"""独立验证业务行为及当前 SDK 归档。"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from scaffold.python.validation.current_archive import inspect_completed_archive

WORKSPACE = Path("/workspace")


def check_feature(workspace):
    try:
        for text, count in [("", 0), ("abc", 3), ("a b\n", 4), ("中文🙂", 3)]:
            p = subprocess.run(
                [sys.executable, "wordcount.py", "--characters", "--lines"],
                input=text,
                cwd=workspace,
                capture_output=True,
                text=True,
                check=True,
                timeout=15,
            )
            lines = p.stdout.splitlines()
            assert f"Characters: {count}" in lines
            assert f"Words: {len(text.split())}" in lines
            assert f"Lines: {len(text.splitlines())}" in lines
        with tempfile.TemporaryDirectory(prefix="comet-character-input-") as temporary:
            source = Path(temporary) / "input.txt"
            source.write_text("a b\n", encoding="utf-8")
            p = subprocess.run(
                [sys.executable, "wordcount.py", str(source), "--characters"],
                cwd=workspace,
                capture_output=True,
                text=True,
                check=True,
                timeout=15,
            )
            assert "Characters: 4" in p.stdout.splitlines()
        subprocess.run(
            [sys.executable, "-m", "pytest", "test_wordcount.py", "-q"],
            cwd=workspace,
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        )
        assert "--characters" in (workspace / "test_wordcount.py").read_text(encoding="utf-8")
        return {"check": "business_behavior", "status": "passed"}
    except (
        OSError,
        ValueError,
        AssertionError,
        AttributeError,
        StopIteration,
        subprocess.SubprocessError,
    ) as error:
        return {"check": "business_behavior", "status": "failed", "reason": str(error)}


def main():
    context = json.loads(
        (WORKSPACE / os.environ.get("BENCH_TEST_CONTEXT", "_test_context.json")).read_text(
            encoding="utf-8"
        )
    )
    results = [check_feature(WORKSPACE)]
    try:
        inspect_completed_archive(
            WORKSPACE, "character-counting", context.get("treatment_name", "")
        )
        results.append({"check": "current_sdk_archive", "status": "passed"})
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        results.append({"check": "current_sdk_archive", "status": "failed", "reason": str(error)})
    output = {
        "passed": [r["check"] for r in results if r["status"] == "passed"],
        "failed": [
            r["check"] + ": " + r.get("reason", "") for r in results if r["status"] == "failed"
        ],
    }
    (WORKSPACE / os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")).write_text(
        json.dumps(output), encoding="utf-8"
    )
    print(json.dumps(output))
    return 0 if not output["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
