"""Validate the self-contained Comet Native workflow task inside Docker."""

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


def check_feature():
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
            input="Hello world. How are you? Fine!",
            capture_output=True,
            text=True,
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


def archive_directory():
    archive_root = WORKSPACE / "docs" / "comet" / "archive"
    candidates = sorted(path for path in archive_root.glob("*-*") if path.is_dir())
    return candidates[-1] if candidates else None


def check_native_artifacts():
    config_file = WORKSPACE / ".comet" / "config.yaml"
    if not config_file.exists():
        return failed("native_artifacts", ".comet/config.yaml is missing")
    config = yaml.safe_load(config_file.read_text(encoding="utf-8"))
    if "native" not in (config.get("workflows") or [config.get("default_workflow")]):
        return failed("native_artifacts", "native workflow is not enabled")
    if config.get("native", {}).get("artifact_root") != "docs":
        return failed("native_artifacts", "native.artifact_root is not docs")

    canonical = WORKSPACE / "docs" / "comet" / "specs" / "sentence-counting" / "spec.md"
    if not canonical.is_file() or not canonical.read_text(encoding="utf-8").strip():
        return failed("native_artifacts", "Canonical sentence-counting spec is missing or empty")

    archived = archive_directory()
    if archived is None:
        return failed("native_artifacts", "No date-prefixed Native archive exists")
    required = ["comet-state.yaml", "brief.md", "verification.md", "runtime/trajectory.jsonl"]
    missing = [relative for relative in required if not (archived / relative).is_file()]
    if missing:
        return failed("native_artifacts", f"Archive is missing: {', '.join(missing)}")
    if not list((archived / "specs").rglob("*.md")):
        return failed("native_artifacts", "Archive has no complete proposed specification")
    if any((WORKSPACE / "docs" / "comet" / "changes").iterdir()):
        return failed("native_artifacts", "An active Native change remains after archive")
    return passed("native_artifacts")


def check_trajectory():
    archived = archive_directory()
    if archived is None:
        return failed("trajectory", "Archive is unavailable")
    events = [
        json.loads(line)
        for line in (archived / "runtime" / "trajectory.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    phases = set()
    for event in events:
        data = event.get("data", {})
        phases.update(
            value
            for value in (data.get("phase"), data.get("previousPhase"), data.get("nextPhase"))
            if value
        )
        serialized = json.dumps(event).lower()
        if any(key in serialized for key in ("chain_of_thought", "reasoning_content", "hidden_reasoning")):
            return failed("trajectory", "Trajectory contains a hidden reasoning field")
    if not {"shape", "build", "verify", "archive"}.issubset(phases):
        return failed("trajectory", f"Missing phase evidence; found {sorted(phases)}")
    return passed("trajectory")


def check_isolation():
    comet_config_dir = WORKSPACE / ".comet"
    hidden_entries = (
        {path.name for path in comet_config_dir.iterdir()}
        if comet_config_dir.is_dir()
        else set()
    )
    present = []
    if (WORKSPACE / "openspec").exists():
        present.append("openspec")
    present.extend(f".comet/{name}" for name in sorted(hidden_entries - {"config.yaml"}))
    if present:
        return failed("native_isolation", f"Forbidden workflow artifacts exist: {present}")
    skills_root = WORKSPACE / ".claude" / "skills"
    if skills_root.exists():
        installed = {path.name for path in skills_root.iterdir() if path.is_dir()}
        if installed != {"comet-native"}:
            return failed("native_isolation", f"Unexpected installed Skills: {sorted(installed)}")
    return passed("native_isolation")


def main():
    results = [check_feature(), check_native_artifacts(), check_trajectory(), check_isolation()]
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
