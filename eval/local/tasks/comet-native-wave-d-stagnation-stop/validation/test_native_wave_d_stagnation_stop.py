"""Validate Native v4 bounded repair stopping without product snapshots."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

from scaffold.python.validation.native_v4 import (
    active_changes,
    archive_changes,
    check_pytest,
    failed,
    parse_runtime_envelope,
    passed,
    write_results,
)


WORKSPACE = Path("/workspace")
EVIDENCE = Path(".cache/comet-native-eval")


def _state(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    candidate = value.get("state")
    return candidate if isinstance(candidate, dict) else value


def _read_state(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(value, dict):
        raise ValueError("Native state must be a mapping")
    return value


def _envelope(path: Path, command: str) -> dict[str, Any]:
    envelope = parse_runtime_envelope(path)
    if not str(envelope.get("command", "")).startswith(command):
        raise ValueError(f"{path.name} is not a {command} envelope")
    return envelope


def _check_user_facing_envelope(envelope: dict[str, Any], label: str) -> str | None:
    summary = envelope.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        return f"{label} has no plain-language summary"
    forbidden = (
        "stateVersion",
        "failed_iteration_count",
        "no_progress_count",
        "commandArgs",
        "continuation",
    )
    if any(token in summary for token in forbidden):
        return f"{label} summary exposes machine fields"
    next_hint = envelope.get("next")
    if not isinstance(next_hint, dict):
        return f"{label} has no next step"
    has_command = isinstance(next_hint.get("command"), str) and bool(next_hint["command"].strip())
    has_question = isinstance(next_hint.get("ask_user"), str) and bool(next_hint["ask_user"].strip())
    if has_command == has_question:
        return f"{label} must contain exactly one command or ask_user next step"
    data = envelope.get("data")
    continuation = data.get("continuation") if isinstance(data, dict) else None
    communication = continuation.get("userCommunication") if isinstance(continuation, dict) else None
    if isinstance(communication, dict) and communication.get("required") is True:
        message = communication.get("message")
        if not isinstance(message, str) or not message.strip():
            return f"{label} requires user communication but has no message"
        if envelope.get("user_message") != message:
            return f"{label} does not preserve the relayable user message"
    return None


def _has_v4_loop(state: dict[str, Any]) -> str | None:
    if state.get("schema") != "comet.native.v4":
        return f"schema={state.get('schema')!r}"
    if not isinstance(state.get("state_version"), int) or isinstance(
        state.get("state_version"), bool
    ):
        return "state_version is missing"
    loop = state.get("loop")
    if not isinstance(loop, dict):
        return "loop is missing"
    for key in ("failed_iteration_count", "no_progress_count", "execution_failure_count"):
        value = loop.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            return f"loop.{key} is invalid"
    if not isinstance(state.get("blockers"), list):
        return "blockers is missing"
    return None


def _legacy_files(change: Path) -> list[str]:
    forbidden: list[str] = []
    for path in change.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(change).as_posix().lower()
        if any(
            token in relative
            for token in ("trajectory", "checkpoint", "receipt", "snapshot", "hash")
        ):
            forbidden.append(relative)
        if (
            relative == "runtime"
            or relative.startswith("runtime/")
            or relative.startswith("runtime\\")
        ):
            forbidden.append(relative)
        if relative.startswith("runtime/evidence/"):
            forbidden.append(relative)
    return sorted(set(forbidden))


def check_stagnation_stop() -> dict[str, str]:
    check = "stagnation_stop"
    active = active_changes(WORKSPACE)
    if [path.name for path in active] != ["stalled-average"]:
        return failed(check, f"Expected stalled-average to remain active, found {active}")
    if archive_changes(WORKSPACE):
        return failed(check, "The unresolved change was archived")

    evidence = WORKSPACE / EVIDENCE
    try:
        manual = _envelope(evidence / "manual-stop.json", "next")
        override = _envelope(evidence / "override.json", "next")
        hard = _envelope(evidence / "hard-stop.json", "next")
        status = _envelope(evidence / "hard-stop-status.json", "status")
    except Exception as error:
        return failed(check, f"Invalid v4 stop evidence: {error}")

    for envelope, label in ((manual, "manual stop"), (override, "override"), (hard, "hard stop"), (status, "status")):
        envelope_error = _check_user_facing_envelope(envelope, label)
        if envelope_error:
            return failed(check, envelope_error)

    manual_state = _state(manual.get("data"))
    manual_loop = manual_state.get("loop") if isinstance(manual_state.get("loop"), dict) else {}
    manual_blockers = manual_state.get("blockers")
    if manual.get("error", {}).get("code") not in {"blocked", "conflict", None}:
        return failed(check, "The third failure has an unexpected Runtime error")
    if (
        manual_loop.get("no_progress_count", 0) < 3
        and manual_loop.get("failed_iteration_count", 0) < 3
    ):
        return failed(check, "The third identical failure did not increment the v4 loop counters")
    if manual_state.get("status") not in {"blocked", "await-user", "active"}:
        return failed(check, "The manual stop did not preserve an active/blocked state")
    if not isinstance(manual_blockers, list) or not manual_blockers:
        return failed(check, "The manual stop has no user-readable blocker")

    override_state = _state(override.get("data"))
    override_loop = (
        override_state.get("loop") if isinstance(override_state.get("loop"), dict) else {}
    )
    if (
        override_state.get("schema") != "comet.native.v4"
        or override_state.get("name") != "stalled-average"
    ):
        return failed(check, "The explicit override did not return the v4 change state")
    if override_state.get("phase") == "archive" or override_state.get("archived") is True:
        return failed(check, "The explicit override incorrectly archived the unresolved change")
    if override_loop.get("failed_iteration_count", 0) < 3:
        return failed(check, "The explicit override reset the repair counters")
    if not isinstance(override_state.get("loop", {}).get("next_action"), str):
        return failed(check, "The explicit override returned no next action")

    hard_state = _state(hard.get("data"))
    hard_loop = hard_state.get("loop") if isinstance(hard_state.get("loop"), dict) else {}
    if hard_state.get("status") not in {"blocked", "await-user"}:
        return failed(check, "The twelfth failure did not leave the change blocked")
    if hard_loop.get("failed_iteration_count", 0) < 12:
        return failed(check, "The twelfth failure did not reach the v4 repair ceiling")
    if not isinstance(hard_state.get("blockers"), list) or not hard_state["blockers"]:
        return failed(check, "The hard stop has no resolution blocker")
    if hard_loop.get("next_action") in (None, ""):
        return failed(check, "The hard stop has no Runtime continuation action")

    status_state = _state(status.get("data"))
    for state, label in ((status_state, "status"),):
        error = _has_v4_loop(state)
        if error:
            return failed(check, f"Durable {label} is not a v4 loop state: {error}")
    if status_state.get("name") != "stalled-average" or status_state.get("status") not in {
        "blocked",
        "await-user",
    }:
        return failed(check, "Durable status does not reconstruct the hard stop")
    status_loop = status_state.get("loop", {})
    if status_loop.get("failed_iteration_count", 0) < 12:
        return failed(check, "Durable status lost the total failure count")

    root = active[0]
    state_file = root / "comet-state.yaml"
    spec_file = root / "specs/average-word-length/spec.md"
    if not all(path.is_file() for path in (state_file, spec_file)):
        return failed(check, "Active state or target specification is missing")
    try:
        durable = _read_state(state_file)
    except (OSError, UnicodeDecodeError, yaml.YAMLError, ValueError) as error:
        return failed(check, f"Invalid durable v4 state: {error}")
    error = _has_v4_loop(durable)
    if error:
        return failed(check, f"Active state is not v4: {error}")
    if durable.get("name") != "stalled-average" or durable.get("status") not in {
        "blocked",
        "await-user",
    }:
        return failed(check, "Unexpected final Native state")
    if durable.get("loop", {}).get("failed_iteration_count", 0) < 12:
        return failed(check, "Final state does not retain the hard ceiling")
    if _legacy_files(root):
        return failed(check, f"Retired per-change Runtime artifacts remain: {_legacy_files(root)}")
    return passed(check)


def check_intentional_failure_remains() -> dict[str, str]:
    check = "intentional_failure_remains"
    try:
        result = subprocess.run(
            [sys.executable, "wordcount.py", "--average-word-length"],
            cwd=WORKSPACE,
            input="one three",
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as error:
        return failed(check, str(error))
    if result.returncode == 0:
        return failed(check, "The intentionally unresolved flag unexpectedly succeeds")
    return passed(check)


def main() -> int:
    results = [
        check_pytest(WORKSPACE),
        check_intentional_failure_remains(),
        check_stagnation_stop(),
    ]
    return write_results(results, WORKSPACE)


if __name__ == "__main__":
    raise SystemExit(main())
