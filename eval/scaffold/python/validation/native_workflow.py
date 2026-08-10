"""Hard checks for self-contained Comet Native workflow completion."""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml


def _failure(name: str, reason: str) -> str:
    return f"{name}: {reason}"


def _terminal_archive(archive_root: Path) -> tuple[Path | None, dict[str, Any] | None]:
    if not archive_root.is_dir():
        return None, None
    for candidate in sorted(
        (path for path in archive_root.iterdir() if path.is_dir()),
        reverse=True,
    ):
        state_file = candidate / "comet-state.yaml"
        if not state_file.is_file():
            continue
        try:
            state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            continue
        if state.get("phase") == "archive" and state.get("archived") is True:
            return candidate, state
    return None, None


def _spec_changes_are_archived(
    native_root: Path,
    archive: Path,
    state: dict[str, Any],
) -> bool:
    spec_changes = state.get("spec_changes") or []
    if not isinstance(spec_changes, list):
        return False
    for change in spec_changes:
        if not isinstance(change, dict):
            return False
        capability = change.get("capability")
        operation = change.get("operation")
        if not isinstance(capability, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", capability):
            return False
        canonical = native_root / "specs" / capability / "spec.md"
        if operation == "remove":
            if change.get("source") is not None or canonical.exists():
                return False
            continue
        expected_source = f"specs/{capability}/spec.md"
        archived = archive / expected_source
        if operation not in {"create", "modify"} or change.get("source") != expected_source:
            return False
        if not archived.is_file() or not canonical.is_file():
            return False
        if not archived.read_text(encoding="utf-8").strip():
            return False
        if archived.read_bytes() != canonical.read_bytes():
            return False
    return True


def _portable_text(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("text"), str)
        and isinstance(value.get("truncated"), bool)
    )


def _portable_timestamp(value: Any) -> bool:
    """Accept ISO text and the datetime/date objects produced by PyYAML."""
    return isinstance(value, (str, datetime, date))


def _state_history(state: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    history = state.get("history")
    if not isinstance(history, list):
        return [], False
    overflow = state.get("history_overflow")
    counts = overflow.get("outcome_counts") if isinstance(overflow, dict) else None
    if (
        not isinstance(overflow, dict)
        or not isinstance(overflow.get("dropped_entries"), int)
        or overflow.get("dropped_entries") < 0
        or not isinstance(counts, dict)
        or set(counts) != {"pass", "fail", "blocked", "execution-error", "recovery"}
        or any(not isinstance(value, int) or value < 0 for value in counts.values())
        or sum(counts.values()) != overflow.get("dropped_entries")
    ):
        return [], False
    entries = [entry for entry in history if isinstance(entry, dict)]
    if len(entries) != len(history) or len(entries) > 50:
        return entries, False
    valid_outcomes = {"pass", "fail", "blocked", "execution-error", "recovery"}
    for entry in entries:
        if (
            not isinstance(entry.get("goal_cycle"), int)
            or not isinstance(entry.get("iteration"), int)
            or not isinstance(entry.get("attempt"), int)
            or entry.get("outcome") not in valid_outcomes
            or not isinstance(entry.get("unresolved_ids"), list)
            or not _portable_text(entry.get("summary"))
            or not _portable_timestamp(entry.get("completed_at"))
        ):
            return entries, False
    return entries, True


def _has_hidden_reasoning(entries: list[dict[str, Any]]) -> bool:
    return any(
        marker in json.dumps(entry, default=str).lower()
        for entry in entries
        for marker in ("chain_of_thought", "reasoning_content", "hidden_reasoning")
    )


def _validate_terminal_state(state: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    loop = state.get("loop") if isinstance(state.get("loop"), dict) else {}
    verification = state.get("verification")
    acceptance = state.get("acceptance")
    if state.get("schema") != "comet.native.v4":
        errors.append("schema is not comet.native.v4")
    if state.get("phase") != "archive" or state.get("status") != "done":
        errors.append("state is not archive/done")
    if state.get("archived") is not True or loop.get("stage") != "done":
        errors.append("loop is not done/archived")
    if state.get("verification_result") != "pass":
        errors.append("verification_result is not pass")
    if state.get("verification_report") != "verification.md":
        errors.append("verification.md is not the report")
    if (
        not isinstance(acceptance, list)
        or not acceptance
        or any(not isinstance(item, dict) or item.get("result") != "passed" for item in acceptance)
    ):
        errors.append("acceptance is incomplete")
    if not isinstance(verification, dict) or verification.get("verdict") != "pass":
        errors.append("verification summary is missing")
    _, history_valid = _state_history(state)
    if not history_valid:
        errors.append("portable history is invalid")
    return errors


def _validate_active_state(state: dict[str, Any], *, blocked: bool) -> list[str]:
    errors: list[str] = []
    loop = state.get("loop") if isinstance(state.get("loop"), dict) else {}
    phase = state.get("phase")
    status = state.get("status")
    stage = loop.get("stage")
    if state.get("schema") != "comet.native.v4":
        errors.append("schema is not comet.native.v4")
    if state.get("archived") is True or phase not in {"shape", "build", "verify"}:
        errors.append("active state is archived or has an invalid phase")
    if blocked:
        if status != "blocked" or stage != "blocked":
            errors.append("expected blocked status and loop stage")
        if state.get("verification_result") not in {"pending", "fail", "blocked"}:
            errors.append("blocked state has an invalid verification result")
    else:
        if status not in {"active", "await-user"}:
            errors.append("expected active or await-user status")
        if stage in {"done", "blocked"}:
            errors.append("active state has a terminal loop stage")
    _, history_valid = _state_history(state)
    if not history_valid:
        errors.append("portable history is invalid")
    return errors


def validate_native_workflow(
    test_dir: Path,
    outputs: dict[str, Any],
    terminal_mode: str = "archive",
) -> tuple[list[str], list[str]]:
    """Validate Native invocation, portable state, and isolation for beta17."""
    passed: list[str] = []
    failed: list[str] = []

    invoked = (outputs.get("events") or {}).get("skills_invoked", []) or []
    unexpected_skills = sorted({skill for skill in invoked if skill != "comet-native"})
    if "comet-native" in invoked and not unexpected_skills:
        passed.append("native_skill_invocation")
    elif unexpected_skills:
        failed.append(
            _failure(
                "native_skill_invocation",
                f"unexpected Skills were invoked: {', '.join(unexpected_skills)}",
            )
        )
    else:
        failed.append(_failure("native_skill_invocation", "comet-native was not invoked"))

    config_file = test_dir / ".comet" / "config.yaml"
    config: dict[str, Any] = {}
    if config_file.is_file():
        try:
            config = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            config = {}
    artifact_root = (config.get("native") or {}).get("artifact_root")
    project_root = test_dir.resolve()
    artifact_root_path = Path(artifact_root) if isinstance(artifact_root, str) else None
    candidate_native_root = (
        (project_root / artifact_root_path / "comet").resolve()
        if artifact_root_path is not None
        else project_root / "comet"
    )
    config_valid = (
        config.get("schema") == "comet.project.v1"
        and config.get("default_workflow") == "native"
        and "native" in (config.get("workflows") or [config.get("default_workflow")])
        and isinstance(artifact_root, str)
        and artifact_root.strip()
        and artifact_root_path is not None
        and not artifact_root_path.is_absolute()
        and candidate_native_root.is_relative_to(project_root)
    )
    if config_valid:
        passed.append("native_artifacts")
        native_root = candidate_native_root
    else:
        failed.append(_failure("native_artifacts", "valid .comet/config.yaml is missing"))
        native_root = project_root / "comet"

    changes_root = native_root / "changes"
    active_changes = (
        [path for path in changes_root.iterdir() if path.is_dir()] if changes_root.is_dir() else []
    )
    archive, state = _terminal_archive(native_root / "archive")
    require_blocked = terminal_mode == "active-blocked"
    require_active = terminal_mode in {"active", "active-blocked"}
    if require_active:
        active_states: list[dict[str, Any]] = []
        for change in active_changes:
            try:
                value = yaml.safe_load((change / "comet-state.yaml").read_text(encoding="utf-8"))
            except (OSError, yaml.YAMLError):
                value = None
            if isinstance(value, dict):
                active_states.append(value)
        if archive is not None:
            failed.append(_failure("native_state", "active Native task was unexpectedly archived"))
        elif len(active_states) != 1:
            failed.append(_failure("native_state", "expected exactly one active Native change"))
        else:
            errors = _validate_active_state(active_states[0], blocked=require_blocked)
            if errors:
                failed.append(_failure("native_state", "; ".join(errors)))
            else:
                passed.append("native_state")
    elif archive is None or state is None:
        failed.append(_failure("native_state", "no terminal Native archive exists"))
    elif active_changes:
        failed.append(_failure("native_state", "active Native changes remain after archive"))
    else:
        errors = _validate_terminal_state(state)
        report_name = state.get("verification_report")
        required_files = [archive / "brief.md", archive / str(report_name or "")]
        if (
            errors
            or not all(path.is_file() and path.stat().st_size > 0 for path in required_files)
            or not _spec_changes_are_archived(native_root, archive, state)
        ):
            reason = (
                "; ".join(errors)
                if errors
                else "brief, specification, or verification evidence is incomplete"
            )
            failed.append(_failure("native_state", reason))
        else:
            passed.append("native_state")

    loop_state = state if state is not None and not require_active else None
    if require_active and active_changes:
        try:
            loop_state = yaml.safe_load(
                (active_changes[0] / "comet-state.yaml").read_text(encoding="utf-8")
            )
        except (OSError, yaml.YAMLError):
            loop_state = None
    loop_errors: list[str] = []
    if not isinstance(loop_state, dict):
        loop_errors.append("portable state is unavailable")
    else:
        loop = loop_state.get("loop")
        if not isinstance(loop, dict):
            loop_errors.append("portable loop is missing")
        elif require_blocked:
            if loop.get("stage") != "blocked":
                loop_errors.append("blocked state has no blocked loop stage")
        elif require_active:
            if loop.get("stage") in {None, "done", "blocked"}:
                loop_errors.append("active state has no active loop stage")
        elif loop.get("stage") != "done":
            loop_errors.append("terminal state has no done loop stage")
        entries, history_valid = _state_history(loop_state)
        if not history_valid:
            loop_errors.append("portable history is invalid")
        elif _has_hidden_reasoning(entries):
            loop_errors.append("portable history contains a hidden reasoning field")
    if loop_errors:
        failed.append(_failure("native_loop", "; ".join(loop_errors)))
    else:
        passed.append("native_loop")

    comet_config_dir = test_dir / ".comet"
    allowed_comet_entries = {"config.yaml", "runtime", "current-change.json"}
    hidden_entries = (
        {path.name for path in comet_config_dir.iterdir()} if comet_config_dir.is_dir() else set()
    )
    invalid_comet_entries = []
    for name in hidden_entries & allowed_comet_entries:
        target = comet_config_dir / name
        if name == "runtime" and (target.is_symlink() or not target.is_dir()):
            invalid_comet_entries.append(name)
        elif name != "runtime" and (target.is_symlink() or not target.is_file()):
            invalid_comet_entries.append(name)
    local_runtime_dirs = []
    for root in (native_root / "changes", native_root / "archive"):
        if root.is_dir():
            local_runtime_dirs.extend(
                path
                for change in root.iterdir()
                if change.is_dir()
                for path in [change / "runtime"]
                if path.exists() or path.is_symlink()
            )
    if (
        (test_dir / "openspec").exists()
        or hidden_entries - allowed_comet_entries
        or invalid_comet_entries
        or local_runtime_dirs
    ):
        failed.append(_failure("native_isolation", "Classic or hidden workflow artifacts exist"))
    else:
        passed.append("native_isolation")

    return passed, failed
