"""Validate early Native conflict/workspace status and one-winner CAS."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import yaml

from scaffold.python.validation.native_wave import (
    active_changes,
    archive_changes,
    check_checkpoint_cas_envelopes,
    check_native_isolation,
    check_pytest,
    check_runtime_envelopes,
    failed,
    passed,
    read_json,
    write_results,
)


WORKSPACE = Path("/workspace")
EVIDENCE = Path(".cache/comet-native-eval")
EXPECTED_CHANGES = {"normalize-case", "preserve-acronyms"}
FORBIDDEN_STATUS_FIELDS = {
    "worktreeId",
    "commonDirId",
    "sessionHash",
    "workspaceIdentityHash",
    "projectPrefix",
    "projectRootId",
    "nativeRootId",
}

BARRIER_WORKER = r"""
import pathlib, subprocess, sys, time
ready = pathlib.Path(sys.argv[1])
release = pathlib.Path(sys.argv[2])
ready.write_text("ready", encoding="utf-8")
deadline = time.monotonic() + 10
while not release.exists():
    if time.monotonic() >= deadline:
        raise SystemExit(124)
    time.sleep(0.005)
result = subprocess.run(sys.argv[3:], capture_output=True, text=True, check=False)
sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
raise SystemExit(result.returncode)
"""


def _finding_codes(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"code", "codes", "findingCodes"}:
                if isinstance(child, str):
                    found.add(child)
                elif isinstance(child, list):
                    found.update(item for item in child if isinstance(item, str))
            found.update(_finding_codes(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_finding_codes(child))
    return found


def check_parallel_safety() -> dict[str, str]:
    check = "parallel_safety"
    active = {path.name for path in active_changes(WORKSPACE)}
    if active != EXPECTED_CHANGES:
        return failed(
            check, f"Expected active changes {sorted(EXPECTED_CHANGES)}, found {sorted(active)}"
        )
    archived_names = {
        (yaml.safe_load((path / "comet-state.yaml").read_text(encoding="utf-8")) or {}).get(
            "name"
        )
        for path in archive_changes(WORKSPACE)
    }
    if archived_names & EXPECTED_CHANGES:
        return failed(check, "Conflicting changes must remain active")

    evidence = WORKSPACE / EVIDENCE
    try:
        status = read_json(evidence / "conflict-status.json")
    except Exception as error:
        return failed(check, f"Invalid conflict status: {error}")
    if (
        not isinstance(status, dict)
        or status.get("command") != "status"
        or status.get("exitCode") != 0
        or not isinstance(status.get("data"), dict)
        or status["data"].get("name") != "normalize-case"
        or status["data"].get("phase") == "archive"
    ):
        return failed(check, "Conflict evidence is not an early exact Native status envelope")
    codes = _finding_codes(status)
    missing_codes = {"native-change-conflict"} - codes
    if missing_codes:
        return failed(check, f"Early status is missing findings: {sorted(missing_codes)}")
    serialized = json.dumps(status, sort_keys=True)
    leaked = sorted(field for field in FORBIDDEN_STATUS_FIELDS if field in serialized)
    if leaked:
        return failed(check, f"Status exposed raw workspace identity fields: {leaked}")

    return passed(check)


def _native_runtime_path() -> Path:
    oracle_root = WORKSPACE / "_eval_trusted_oracles"
    identity_path = oracle_root / "native-runtime-identity.json"
    runtime = oracle_root / "comet-native-runtime.mjs"
    if oracle_root.is_symlink() or not oracle_root.is_dir():
        raise FileNotFoundError("The controller-trusted Native oracle is unavailable")
    if identity_path.is_symlink() or not identity_path.is_file():
        raise FileNotFoundError("The controller-trusted Native oracle identity is unavailable")
    if runtime.is_symlink() or not runtime.is_file():
        raise FileNotFoundError("The controller-trusted Native runtime is unavailable")
    identity = read_json(identity_path)
    expected_keys = {"schema", "runtimeFile", "runtimeHash"}
    if not isinstance(identity, dict) or set(identity) != expected_keys:
        raise ValueError("The controller-trusted Native oracle identity is invalid")
    if (
        identity.get("schema") != "comet.eval.trusted-native-runtime.v1"
        or identity.get("runtimeFile") != runtime.name
        or not re.fullmatch(r"[a-f0-9]{64}", str(identity.get("runtimeHash", "")))
        or hashlib.sha256(runtime.read_bytes()).hexdigest() != identity["runtimeHash"]
    ):
        raise ValueError("The controller-trusted Native runtime does not match its identity")
    return runtime


def run_barrier_commands(
    commands: list[list[str]], root: Path
) -> list[subprocess.CompletedProcess]:
    """Release independent workers together, then collect their exact process results."""
    if len(commands) != 2 or any(not command for command in commands):
        raise ValueError("The CAS validator requires exactly two commands")
    barrier = Path(tempfile.mkdtemp(prefix="native-cas-barrier-", dir=root))
    release = barrier / "release"
    workers: list[subprocess.Popen] = []
    try:
        for index, command in enumerate(commands):
            ready = barrier / f"ready-{index}"
            workers.append(
                subprocess.Popen(
                    [sys.executable, "-c", BARRIER_WORKER, str(ready), str(release), *command],
                    cwd=WORKSPACE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
            )
        deadline = time.monotonic() + 10
        while not all((barrier / f"ready-{index}").is_file() for index in range(2)):
            if any(worker.poll() is not None for worker in workers):
                raise RuntimeError("A CAS worker exited before reaching the barrier")
            if time.monotonic() >= deadline:
                raise TimeoutError("CAS workers did not reach the barrier")
            time.sleep(0.005)
        release.write_text("release", encoding="utf-8")
        results = []
        for worker in workers:
            stdout, stderr = worker.communicate(timeout=30)
            results.append(
                subprocess.CompletedProcess(worker.args, worker.returncode, stdout, stderr)
            )
        return results
    finally:
        for worker in workers:
            if worker.poll() is None:
                worker.kill()
                worker.wait(timeout=5)
        shutil.rmtree(barrier, ignore_errors=True)


def check_live_concurrent_cas() -> dict[str, str]:
    check = "live_concurrent_cas"
    state_file = WORKSPACE / "docs/comet/changes/normalize-case/comet-state.yaml"
    try:
        state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
        expected = state.get("revision")
        if isinstance(expected, bool) or not isinstance(expected, int) or expected < 1:
            raise ValueError("normalize-case has no positive current revision")
        runtime = _native_runtime_path()
        node = shutil.which("node")
        if not node:
            raise FileNotFoundError("Node.js is unavailable to the CAS validator")
        commands = [
            [
                node,
                str(runtime),
                "checkpoint",
                "normalize-case",
                "--summary",
                f"Validator concurrent checkpoint {label}",
                "--next-action",
                f"Inspect concurrent result {label}",
                "--expect-revision",
                str(expected),
                "--project-root",
                str(WORKSPACE),
                "--json",
            ]
            for label in ("A", "B")
        ]
        results = run_barrier_commands(commands, WORKSPACE / EVIDENCE)
        paths = []
        for label, result in zip(("a", "b"), results):
            payload = json.loads(result.stdout)
            if payload.get("exitCode") != result.returncode:
                raise ValueError("CAS process exit code differs from its runtime envelope")
            target = WORKSPACE / EVIDENCE / f"_validator-checkpoint-{label}.json"
            target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            paths.append(target)
        race = check_checkpoint_cas_envelopes(paths)
        if race["status"] != "passed":
            raise ValueError(race.get("reason", "Concurrent CAS evidence is invalid"))
        final_state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
        if final_state.get("revision") != expected + 1:
            raise ValueError("Concurrent CAS did not commit exactly one revision")
    except Exception as error:
        return failed(check, str(error))
    return passed(check)


def check_live_conflict_and_workspace() -> dict[str, str]:
    check = "live_conflict_and_workspace"
    canonical = WORKSPACE / "docs/comet/specs/word-normalization/spec.md"
    if not canonical.is_file():
        return failed(check, "Canonical specification is missing")
    canonical_hash = hashlib.sha256(canonical.read_bytes()).hexdigest()
    proposed_hashes: set[str] = set()
    for name in EXPECTED_CHANGES:
        root = WORKSPACE / "docs/comet/changes" / name
        state_file = root / "comet-state.yaml"
        proposed = root / "specs/word-normalization/spec.md"
        workspace_file = root / "runtime/workspace.json"
        if not all(path.is_file() for path in (state_file, proposed, workspace_file)):
            return failed(check, f"{name} lacks live state, proposed spec, or workspace identity")
        try:
            state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
            workspace = read_json(workspace_file)
        except (OSError, yaml.YAMLError, json.JSONDecodeError) as error:
            return failed(check, f"Invalid live metadata for {name}: {error}")
        matching = [
            item
            for item in state.get("spec_changes", [])
            if isinstance(item, dict) and item.get("capability") == "word-normalization"
        ]
        if len(matching) != 1:
            return failed(check, f"{name} does not declare exactly one word-normalization change")
        change = matching[0]
        if (
            state.get("name") != name
            or state.get("phase") == "archive"
            or change.get("operation") != "replace"
            or change.get("source") != "specs/word-normalization/spec.md"
            or change.get("base_hash") != canonical_hash
            or not proposed.read_text(encoding="utf-8").strip()
        ):
            return failed(check, f"{name} is not a real same-base replacement conflict")
        if (
            not isinstance(workspace, dict)
            or workspace.get("schema") != "comet.native.workspace.v2"
            or workspace.get("nativeRootRef") != "docs/comet"
            or not re.fullmatch(r"[a-f0-9]{64}", str(workspace.get("projectRootId", "")))
            or not re.fullmatch(r"[a-f0-9]{64}", str(workspace.get("nativeRootId", "")))
        ):
            return failed(check, f"{name} does not have a process-free Native workspace identity")
        proposed_hashes.add(hashlib.sha256(proposed.read_bytes()).hexdigest())
    if len(proposed_hashes) != 2:
        return failed(check, "The two conflicting changes do not propose distinct outcomes")

    return passed(check)


def main() -> int:
    evidence = WORKSPACE / EVIDENCE
    results = [
        check_pytest(WORKSPACE),
        check_runtime_envelopes(
            [
                evidence / "conflict-status.json",
                evidence / "checkpoint-attempt-a.json",
                evidence / "checkpoint-attempt-b.json",
            ]
        ),
        check_parallel_safety(),
        check_live_conflict_and_workspace(),
        check_live_concurrent_cas(),
        check_native_isolation(WORKSPACE),
    ]
    return write_results(results, WORKSPACE)


if __name__ == "__main__":
    raise SystemExit(main())
