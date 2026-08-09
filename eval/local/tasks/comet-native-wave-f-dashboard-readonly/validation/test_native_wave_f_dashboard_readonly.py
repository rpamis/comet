"""Validate the beta17 Dashboard v2 projection without touching Native state."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from scaffold.python.validation.native_v4 import (
    WORKSPACE,
    active_changes,
    check_dashboard_projection,
    check_native_isolation,
    failed,
    passed,
    read_json,
    state_for,
    write_results,
)


EVIDENCE = Path(".cache/comet-native-eval")


def _walk_files(root: Path) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    if not root.is_dir():
        return result
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink():
            stat = path.stat()
            result[path.relative_to(root).as_posix()] = {
                "size": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
            }
    return result


def _envelope_data(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    data = value.get("data", value)
    return data if isinstance(data, dict) else None


def check_active_projection_source() -> dict[str, str]:
    active = active_changes(WORKSPACE)
    if len(active) != 1:
        return failed(
            "active_projection_source", f"expected one active change, found {len(active)}"
        )
    state = state_for(active[0])
    if not isinstance(state, dict) or state.get("schema") != "comet.native.v4":
        return failed("active_projection_source", "active change is not beta17 v4")
    if state.get("phase") != "shape" or state.get("archived") is True:
        return failed("active_projection_source", "fixture must remain an active Shape change")
    if not (active[0] / "brief.md").is_file() or not list((active[0] / "specs").rglob("spec.md")):
        return failed("active_projection_source", "brief/spec artifacts are missing")
    return passed("active_projection_source")


def check_public_native_projection() -> dict[str, str]:
    try:
        dashboard = read_json(WORKSPACE / EVIDENCE / "dashboard.json")
        cli = read_json(WORKSPACE / EVIDENCE / "cli-after.json")
    except (OSError, json.JSONDecodeError) as error:
        return failed("public_native_projection", str(error))
    native = dashboard.get("native") if isinstance(dashboard, dict) else None
    projection = check_dashboard_projection(native)
    if projection["status"] != "passed":
        return projection
    data = _envelope_data(cli)
    state_data = (
        data.get("state")
        if isinstance(data, dict) and isinstance(data.get("state"), dict)
        else data
    )
    changes = native.get("changes") if isinstance(native, dict) else None
    if not isinstance(state_data, dict) or not isinstance(changes, list) or len(changes) != 1:
        return failed("public_native_projection", "CLI or Dashboard change data is missing")
    change = changes[0]
    if change.get("name") != state_data.get("name"):
        return failed("public_native_projection", "Dashboard name differs from CLI status")
    if change.get("stateVersion") != state_data.get(
        "state_version", state_data.get("stateVersion")
    ):
        return failed("public_native_projection", "Dashboard stateVersion differs from CLI status")
    if change.get("phase") != state_data.get("phase"):
        return failed("public_native_projection", "Dashboard phase differs from CLI status")
    if not isinstance(change.get("loop"), dict) or not isinstance(change.get("acceptance"), dict):
        return failed("public_native_projection", "Dashboard omitted loop/acceptance summary")
    return passed("public_native_projection")


def check_dashboard_readonly() -> dict[str, str]:
    try:
        before = read_json(WORKSPACE / EVIDENCE / "cli-before.json")
        after = read_json(WORKSPACE / EVIDENCE / "cli-after.json")
        before_tree = read_json(WORKSPACE / EVIDENCE / "native-tree-before.json")
        after_tree = read_json(WORKSPACE / EVIDENCE / "native-tree-after.json")
    except (OSError, json.JSONDecodeError) as error:
        return failed("dashboard_readonly", str(error))
    if before_tree != after_tree:
        return failed("dashboard_readonly", "Dashboard changed the recorded Native tree")
    live = {"files": _walk_files(WORKSPACE / "docs" / "comet")}
    if after_tree != live:
        return failed("dashboard_readonly", "Native tree manifest does not match live files")
    if _envelope_data(before) != _envelope_data(after):
        return failed("dashboard_readonly", "Dashboard changed the CLI state projection")
    return passed("dashboard_readonly")


def main() -> None:
    results = [
        check_active_projection_source(),
        check_public_native_projection(),
        check_dashboard_readonly(),
        check_native_isolation(WORKSPACE),
    ]
    write_results(results)
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
