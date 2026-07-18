"""Hard checks for self-contained Comet Native workflow completion."""

from __future__ import annotations

import json
import re
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
    if not isinstance(spec_changes, list) or not spec_changes:
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
        if operation not in {"create", "replace"} or change.get("source") != expected_source:
            return False
        if not archived.is_file() or not canonical.is_file():
            return False
        if not archived.read_text(encoding="utf-8").strip():
            return False
        if archived.read_bytes() != canonical.read_bytes():
            return False
    return True


def validate_native_workflow(
    test_dir: Path,
    outputs: dict[str, Any],
    terminal_mode: str = "archive",
) -> tuple[list[str], list[str]]:
    """Validate Native invocation, terminal artifacts, trajectory, and isolation."""
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
        [path for path in changes_root.iterdir() if path.is_dir()]
        if changes_root.is_dir()
        else []
    )
    archive, state = _terminal_archive(native_root / "archive")
    trajectory_files: list[Path] = []
    require_hard_stop = terminal_mode == "active-blocked"
    require_active = terminal_mode in {"active", "active-blocked"}
    if require_hard_stop:
        active_state: dict[str, Any] = {}
        if len(active_changes) == 1:
            try:
                active_state = (
                    yaml.safe_load(
                        (active_changes[0] / "comet-state.yaml").read_text(encoding="utf-8")
                    )
                    or {}
                )
            except (OSError, yaml.YAMLError):
                active_state = {}
        if archive is not None:
            failed.append(_failure("native_state", "blocked Native task was unexpectedly archived"))
        elif (
            len(active_changes) != 1
            or active_state.get("phase") != "build"
            or active_state.get("verification_result") != "fail"
            or active_state.get("archived") is not False
        ):
            failed.append(_failure("native_state", "expected one active failed Native change"))
        else:
            passed.append("native_state")
            trajectory_files.append(active_changes[0] / "runtime" / "trajectory.jsonl")
    elif require_active:
        active_states: list[dict[str, Any]] = []
        try:
            active_states = [
                yaml.safe_load((change / "comet-state.yaml").read_text(encoding="utf-8")) or {}
                for change in active_changes
            ]
        except (OSError, yaml.YAMLError):
            active_states = []
        if not active_states or any(
            state.get("phase") == "archive" or state.get("archived") is not False
            for state in active_states
        ):
            failed.append(_failure("native_state", "expected active non-archived Native changes"))
        else:
            passed.append("native_state")
            trajectory_files.extend(
                change / "runtime" / "trajectory.jsonl" for change in active_changes
            )
    elif archive is None or state is None:
        failed.append(_failure("native_state", "no terminal Native archive exists"))
    elif active_changes:
        failed.append(_failure("native_state", "active Native changes remain after archive"))
    elif state.get("verification_result") != "pass":
        failed.append(_failure("native_state", "archived change is not verified as pass"))
    else:
        report_name = state.get("verification_report")
        required_files = [archive / "brief.md", archive / str(report_name or "")]
        if (
            report_name != "verification.md"
            or not all(path.is_file() and path.stat().st_size > 0 for path in required_files)
            or not _spec_changes_are_archived(native_root, archive, state)
        ):
            failed.append(
                _failure("native_state", "brief, specification, or verification evidence is incomplete")
            )
        else:
            passed.append("native_state")

    if not trajectory_files and archive:
        trajectory_files.append(archive / "runtime" / "trajectory.jsonl")
    phases: set[str] = set()
    hidden_reasoning = False
    hard_stop = False
    for trajectory_file in trajectory_files:
        if not trajectory_file.is_file():
            continue
        for line in trajectory_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            data = event.get("data") or {}
            phases.update(
                value
                for value in (data.get("phase"), data.get("previousPhase"), data.get("nextPhase"))
                if isinstance(value, str)
            )
            serialized = json.dumps(event).lower()
            hidden_reasoning = hidden_reasoning or any(
                marker in serialized
                for marker in ("chain_of_thought", "reasoning_content", "hidden_reasoning")
            )
            repair = data.get("repairStagnation") or {}
            hard_stop = hard_stop or repair.get("disposition") == "hard-stop"
    required_phases = (
        {"shape", "build", "verify"}
        if require_hard_stop
        else {"shape", "build"}
        if require_active
        else {"shape", "build", "verify", "archive"}
    )
    if (
        required_phases.issubset(phases)
        and not hidden_reasoning
        and (hard_stop if require_hard_stop else True)
    ):
        passed.append("native_trajectory")
    else:
        failed.append(_failure("native_trajectory", "complete safe phase trajectory is missing"))

    comet_config_dir = test_dir / ".comet"
    hidden_entries = (
        {path.name for path in comet_config_dir.iterdir()}
        if comet_config_dir.is_dir()
        else set()
    )
    if (test_dir / "openspec").exists() or hidden_entries - {"config.yaml"}:
        failed.append(_failure("native_isolation", "Classic or hidden workflow artifacts exist"))
    else:
        passed.append("native_isolation")

    return passed, failed
