"""Small, product-facing validators for the beta17 Native portable protocol.

The evaluator deliberately checks the same human-readable boundary as Native:
portable ``comet-state.yaml`` plus brief/spec/verification Markdown.  It does
not recreate the removed snapshot, receipt, evidence, or checkpoint protocol.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable

import yaml


WORKSPACE = Path("/workspace")
STATE_SCHEMA = "comet.native.v4"
DASHBOARD_SCHEMA = "comet.dashboard.native.v2"
ALLOWED_COMET_ENTRIES = {"config.yaml", "runtime", "current-change.json"}


def passed(check: str, message: str = "") -> dict[str, str]:
    return {"check": check, "status": "passed", "message": message}


def failed(check: str, message: str) -> dict[str, str]:
    return {"check": check, "status": "failed", "message": message}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def write_results(
    results: list[dict[str, Any]],
    workspace: Path = WORKSPACE,
    results_file: str | None = None,
) -> int:
    output = {
        "passed": [result["check"] for result in results if result["status"] == "passed"],
        "failed": [
            f"{result['check']}: {result.get('message', result.get('reason', ''))}"
            for result in results
            if result["status"] == "failed"
        ],
    }
    target = workspace / (
        results_file or os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")
    )
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False))
    return 1 if output["failed"] else 0


def active_changes(workspace: Path = WORKSPACE) -> list[Path]:
    root = workspace / "docs" / "comet" / "changes"
    return sorted(path for path in root.glob("*") if path.is_dir()) if root.is_dir() else []


def archive_changes(workspace: Path = WORKSPACE) -> list[Path]:
    root = workspace / "docs" / "comet" / "archive"
    return sorted(path for path in root.glob("*") if path.is_dir()) if root.is_dir() else []


def state_for(change: Path) -> dict[str, Any] | None:
    state_path = change / "comet-state.yaml"
    if not state_path.is_file() or state_path.is_symlink():
        return None
    try:
        value = read_yaml(state_path)
    except (OSError, yaml.YAMLError):
        return None
    return value if isinstance(value, dict) else None


def v4_state(change: Path) -> dict[str, Any]:
    state = state_for(change)
    if state is None or state.get("schema") != STATE_SCHEMA:
        raise ValueError(f"missing beta17 state in {change}")
    return state


def _all_acceptance_passed(state: dict[str, Any]) -> bool:
    acceptance = state.get("acceptance")
    return (
        isinstance(acceptance, list)
        and bool(acceptance)
        and all(isinstance(item, dict) and item.get("result") == "passed" for item in acceptance)
    )


def validate_terminal_state(state: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    loop = state.get("loop") if isinstance(state.get("loop"), dict) else {}
    verification = state.get("verification")
    if state.get("schema") != STATE_SCHEMA:
        errors.append("schema is not comet.native.v4")
    if state.get("phase") != "archive" or state.get("status") != "done":
        errors.append("state is not archive/done")
    if state.get("archived") is not True or loop.get("stage") != "done":
        errors.append("loop is not done/archived")
    if state.get("verification_result") != "pass":
        errors.append("verification_result is not pass")
    if not _all_acceptance_passed(state):
        errors.append("acceptance is incomplete")
    if not isinstance(verification, dict) or verification.get("verdict") != "pass":
        errors.append("verification summary is missing")
    if state.get("verification_report") != "verification.md":
        errors.append("verification.md is not the report")
    return errors


def validate_active_state(state: dict[str, Any], *, blocked: bool = False) -> list[str]:
    errors: list[str] = []
    loop = state.get("loop") if isinstance(state.get("loop"), dict) else {}
    phase = state.get("phase")
    if state.get("schema") != STATE_SCHEMA:
        errors.append("schema is not comet.native.v4")
    if state.get("archived") is True:
        errors.append("active state is marked archived")
    if loop.get("stage") not in {"shape", "build", "verify", "await-user", "blocked"}:
        errors.append("invalid loop stage")
    if phase not in {"shape", "build", "verify", "archive"}:
        errors.append("invalid phase")
    if blocked and state.get("status") not in {"blocked", "await-user"}:
        errors.append("expected blocked/await-user status")
    return errors


def check_native_isolation(workspace: Path = WORKSPACE) -> dict[str, str]:
    errors: list[str] = []
    if (workspace / "openspec").exists():
        errors.append("OpenSpec directory exists")
    comet = workspace / ".comet"
    if comet.is_dir():
        unexpected = sorted(
            path.name for path in comet.iterdir() if path.name not in ALLOWED_COMET_ENTRIES
        )
        if unexpected:
            errors.append(f"unexpected .comet entries: {', '.join(unexpected)}")
    for root in (
        workspace / "docs" / "comet" / "changes",
        workspace / "docs" / "comet" / "archive",
    ):
        if not root.is_dir():
            continue
        for change in root.iterdir():
            if change.is_dir() and (change / "runtime").exists():
                errors.append(f"change-local runtime exists: {change.name}")
    return failed("native_isolation", "; ".join(errors)) if errors else passed("native_isolation")


def parse_runtime_envelope(
    path: Path, command: str | None = None, exit_code: int | None = None
) -> dict[str, Any]:
    value = read_json(path)
    if not isinstance(value, dict) or not isinstance(value.get("data"), (dict, type(None))):
        raise ValueError(f"invalid Runtime envelope: {path}")
    if command is not None and value.get("command") != command:
        raise ValueError(f"Runtime envelope command mismatch: {path}")
    if exit_code is not None and value.get("exitCode") != exit_code:
        raise ValueError(f"Runtime envelope exit code mismatch: {path}")
    return value


def check_runtime_envelopes(paths: Iterable[Path]) -> dict[str, str]:
    try:
        for path in paths:
            parse_runtime_envelope(path)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return failed("runtime_envelopes", str(error))
    return passed("runtime_envelopes")


def check_cli_feature(
    workspace: Path = WORKSPACE,
    flag: str | None = None,
    input_text: str | None = None,
    expected_output: str | None = None,
    test_marker: str | None = None,
) -> dict[str, str]:
    try:
        result = subprocess.run(
            ["pytest", "-q"],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return failed("feature_checks", str(error))
    if result.returncode != 0:
        return failed("feature_checks", result.stdout[-2000:])
    if flag is None:
        return passed("feature_checks")
    try:
        result = subprocess.run(
            [sys.executable, "wordcount.py", flag],
            cwd=workspace,
            input=input_text or "",
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return failed(f"feature_{flag.lstrip('-').replace('-', '_')}", str(error))
    check = f"feature_{flag.lstrip('-').replace('-', '_')}"
    if result.returncode != 0 or (expected_output and expected_output not in result.stdout):
        return failed(check, f"unexpected command result: {result.stdout[-500:]}")
    if test_marker:
        tests = workspace / "test_wordcount.py"
        if (
            not tests.is_file()
            or test_marker.lower() not in tests.read_text(encoding="utf-8").lower()
        ):
            return failed(check, f"focused test marker is missing: {test_marker}")
    return passed(check)


def check_pytest(workspace: Path = WORKSPACE, check: str = "project_tests") -> dict[str, str]:
    result = check_cli_feature(workspace)
    return {**result, "check": check}


def check_dashboard_projection(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or value.get("schema") != DASHBOARD_SCHEMA:
        return failed("dashboard_projection", "Dashboard projection is not v2")
    for key in ("totalChangeCount", "visibleChangeCount", "changes"):
        if key not in value:
            return failed("dashboard_projection", f"Dashboard v2 field is missing: {key}")
    for change in value.get("changes", []):
        if not isinstance(change, dict):
            return failed("dashboard_projection", "Dashboard change is not an object")
        if "stateVersion" not in change or "loop" not in change or "acceptance" not in change:
            return failed("dashboard_projection", "Dashboard change is missing v4 loop fields")
        raw = json.dumps(change, ensure_ascii=False)
        if any(marker in raw for marker in ("executionId", "operationId", "cwd", "absolutePath")):
            return failed("dashboard_projection", "Dashboard exposes local execution details")
    return passed("dashboard_projection")
