"""Validate beta17 Runtime/Verifier coverage and the repair loop."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from scaffold.python.validation.native_v4 import (
    WORKSPACE,
    archive_changes,
    check_native_isolation,
    failed,
    passed,
    state_for,
    validate_terminal_state,
    write_results,
)


EVIDENCE = Path(".cache/comet-native-eval")


def _target_archive() -> Path | None:
    candidates = archive_changes(WORKSPACE)
    return candidates[-1] if candidates else None


def _target_state() -> tuple[Path | None, dict[str, Any] | None]:
    archived = _target_archive()
    if archived is None:
        return None, None
    return archived, state_for(archived)


def check_v4_archive() -> dict[str, str]:
    archived, state = _target_state()
    if archived is None or state is None:
        return failed("v4_archive", "no archived Native change was found")
    errors = validate_terminal_state(state)
    required = ["brief.md", "comet-state.yaml", "verification.md"]
    missing = [name for name in required if not (archived / name).is_file()]
    if missing:
        errors.append(f"missing formal artifacts: {', '.join(missing)}")
    if any((archived / name).exists() for name in ("runtime", "evidence", "receipt", "checkpoint")):
        errors.append("legacy machine artifacts remain in archive")
    if errors:
        return failed("v4_archive", "; ".join(errors))
    return passed("v4_archive")


def check_acceptance_coverage() -> dict[str, str]:
    _, state = _target_state()
    acceptance = state.get("acceptance") if isinstance(state, dict) else None
    if not isinstance(acceptance, list) or not acceptance:
        return failed("acceptance_coverage", "portable acceptance list is missing")
    ids = [item.get("id") for item in acceptance if isinstance(item, dict)]
    if any(not isinstance(value, str) or not value for value in ids) or len(ids) != len(set(ids)):
        return failed("acceptance_coverage", "acceptance IDs are missing or duplicated")
    if any(item.get("result") != "passed" for item in acceptance if isinstance(item, dict)):
        return failed("acceptance_coverage", "not every acceptance item passed")
    return passed("acceptance_coverage")


def check_loop_and_verifier() -> dict[str, str]:
    _, state = _target_state()
    if not isinstance(state, dict):
        return failed("verifier_loop", "portable state is missing")
    history = state.get("history")
    verification = state.get("verification")
    if not isinstance(history, list) or not history:
        return failed("verifier_loop", "portable history is missing")
    if not isinstance(verification, dict) or verification.get("verdict") != "pass":
        return failed("verifier_loop", "final verifier verdict is not pass")
    outcomes = {entry.get("outcome") for entry in history if isinstance(entry, dict)}
    if "fail" not in outcomes and "blocked" not in outcomes:
        return failed("verifier_loop", "repair loop did not record a failed verifier outcome")
    if "pass" not in outcomes:
        return failed("verifier_loop", "repair loop did not record a final pass")
    return passed("verifier_loop")


def check_runtime_checks() -> dict[str, str]:
    _, state = _target_state()
    if not isinstance(state, dict):
        return failed("runtime_checks", "portable state is missing")
    name = state.get("name")
    if not isinstance(name, str):
        return failed("runtime_checks", "change name is missing")
    local_path = WORKSPACE / ".comet" / "runtime" / "native" / "changes" / name / "state.json"
    if local_path.exists():
        return failed("runtime_checks", "per-change Runtime overlay was not cleaned after Archive")
    evidence_files = (
        list((WORKSPACE / EVIDENCE).glob("*.json")) if (WORKSPACE / EVIDENCE).is_dir() else []
    )
    for path in evidence_files:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        text = json.dumps(value, ensure_ascii=False).lower()
        if "receipt" in text or "preflighthash" in text or "scopehash" in text:
            return failed("runtime_checks", f"legacy verification protocol leaked into {path.name}")
    return passed("runtime_checks")


def check_isolation() -> dict[str, str]:
    return check_native_isolation(WORKSPACE)


def main() -> None:
    results = [
        check_v4_archive(),
        check_acceptance_coverage(),
        check_loop_and_verifier(),
        check_runtime_checks(),
        check_isolation(),
    ]
    write_results(results)
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
