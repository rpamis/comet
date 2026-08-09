"""Validate Native v4 conflict discovery and one-winner Runtime mutation."""

from __future__ import annotations

import json
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
EXPECTED_CHANGES = {"normalize-case", "preserve-acronyms"}
FORBIDDEN_STATUS_FIELDS = {
    "worktreeId",
    "commonDirId",
    "sessionHash",
    "workspaceIdentityHash",
    "projectPrefix",
    "projectRootId",
    "nativeRootId",
    "base_hash",
    "scopeHash",
    "preflightHash",
}


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _state(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    candidate = value.get("state")
    return candidate if isinstance(candidate, dict) else value


def _codes(value: Any) -> set[str]:
    codes: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"code", "codes", "findingCodes"}:
                if isinstance(child, str):
                    codes.add(child)
                elif isinstance(child, list):
                    codes.update(item for item in child if isinstance(item, str))
            codes.update(_codes(child))
    elif isinstance(value, list):
        for child in value:
            codes.update(_codes(child))
    return codes


def _envelope(path: Path, command_prefix: str) -> dict[str, Any]:
    envelope = parse_runtime_envelope(path)
    if not str(envelope.get("command", "")).startswith(command_prefix):
        raise ValueError(f"{path.name} is not a {command_prefix} envelope")
    return envelope


def _v4_state(path: Path, name: str) -> tuple[dict[str, Any], str | None]:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as error:
        return {}, str(error)
    if not isinstance(value, dict):
        return {}, "state is not a mapping"
    if value.get("schema") != "comet.native.v4":
        return value, f"schema={value.get('schema')!r}"
    if value.get("name") != name:
        return value, f"name={value.get('name')!r}"
    version = value.get("state_version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        return value, "state_version is invalid"
    loop = value.get("loop")
    if not isinstance(loop, dict) or not isinstance(loop.get("stage"), str):
        return value, "loop is invalid"
    return value, None


def _legacy_files(root: Path) -> list[str]:
    forbidden: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix().lower()
        if relative.startswith("runtime/") or any(
            token in relative
            for token in ("trajectory", "checkpoint", "receipt", "snapshot", "hash")
        ):
            forbidden.append(relative)
    return sorted(set(forbidden))


def check_parallel_safety() -> dict[str, str]:
    check = "parallel_safety"
    active = {path.name for path in active_changes(WORKSPACE)}
    if active != EXPECTED_CHANGES:
        return failed(
            check, f"Expected active changes {sorted(EXPECTED_CHANGES)}, found {sorted(active)}"
        )
    if archive_changes(WORKSPACE):
        return failed(check, "Conflicting changes must remain active")

    target_texts: list[str] = []
    for name in sorted(EXPECTED_CHANGES):
        root = WORKSPACE / "docs/comet/changes" / name
        state, error = _v4_state(root / "comet-state.yaml", name)
        if error:
            return failed(check, f"{name} is not a Native v4 state: {error}")
        if state.get("phase") == "archive" or state.get("archived") is True:
            return failed(check, f"{name} is no longer active")
        changes = [item for item in state.get("spec_changes", []) if isinstance(item, dict)]
        matching = [item for item in changes if item.get("capability") == "word-normalization"]
        if len(matching) != 1 or matching[0].get("operation") != "modify":
            return failed(
                check, f"{name} does not declare one v4 modify intent for word-normalization"
            )
        source = matching[0].get("source")
        if source != "specs/word-normalization/spec.md":
            return failed(check, f"{name} has a non-portable target source")
        proposed = root / source
        if not proposed.is_file() or not proposed.read_text(encoding="utf-8").strip():
            return failed(check, f"{name} lacks a non-empty proposed specification")
        target_texts.append(proposed.read_text(encoding="utf-8"))
        legacy = _legacy_files(root)
        if legacy:
            return failed(check, f"{name} contains retired Runtime artifacts: {legacy}")
    if len(set(target_texts)) != 2:
        return failed(check, "The two active changes do not propose distinct outcomes")

    try:
        status = _envelope(EVIDENCE / "conflict-status.json", "status")
    except Exception as error:
        return failed(check, f"Invalid conflict status: {error}")
    status_state = _state(status.get("data"))
    if status_state.get("name") != "normalize-case" or status_state.get("phase") == "archive":
        return failed(check, "Conflict status does not identify the active normalize-case change")
    # Portable status v2 is intentionally a projection and does not carry the
    # conflict-radar details.  The two v4 declarations above are the durable
    # conflict proof; this envelope only proves the read-only inspection ran.
    serialized = json.dumps(status, ensure_ascii=False, sort_keys=True)
    leaked = sorted(field for field in FORBIDDEN_STATUS_FIELDS if field in serialized)
    if leaked or "sha256" in serialized.lower() or "preflight" in serialized.lower():
        return failed(check, f"Status exposed retired identity or hash fields: {leaked}")

    try:
        attempt_a = _envelope(EVIDENCE / "mutation-attempt-a.json", "next")
        attempt_b = _envelope(EVIDENCE / "mutation-attempt-b.json", "next")
    except Exception as error:
        return failed(check, f"Invalid concurrent mutation evidence: {error}")
    attempts = [attempt_a, attempt_b]
    winners = [item for item in attempts if item.get("exitCode") == 0 and "error" not in item]
    losers = [item for item in attempts if item.get("exitCode") != 0 or "error" in item]
    if len(winners) != 1 or len(losers) != 1:
        return failed(check, "Concurrent Runtime mutation did not produce exactly one winner")
    loser_error = losers[0].get("error")
    if isinstance(loser_error, dict) and loser_error.get("code") not in {
        "conflict",
        "blocked",
        "state-version-conflict",
        "native-state-version-conflict",
        "internal",
    }:
        return failed(
            check, f"Losing mutation has an unexpected error: {loser_error.get('code')!r}"
        )
    winner_state = _state(winners[0].get("data"))
    if winner_state and winner_state.get("schema") not in {None, "comet.native.v4"}:
        return failed(check, "Winning mutation returned a non-v4 state")
    return passed(check)


def check_native_layout() -> dict[str, str]:
    check = "native_layout"
    comet = WORKSPACE / ".comet"
    if (WORKSPACE / "openspec").exists():
        return failed(check, "OpenSpec artifacts exist")
    allowed = {"config.yaml", "current-change.json", "runtime"}
    if comet.is_dir():
        unexpected = sorted(path.name for path in comet.iterdir() if path.name not in allowed)
        if unexpected:
            return failed(check, f"Unexpected workflow artifacts exist: {unexpected}")
    return passed(check)


def main() -> int:
    results = [check_pytest(WORKSPACE), check_parallel_safety(), check_native_layout()]
    return write_results(results, WORKSPACE)


if __name__ == "__main__":
    raise SystemExit(main())
