"""Inspect the original current Native Runs inside the evaluation container."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from scaffold.python.validation.current_sdk import inspect_run, sdk_inspection_evidence


def check_archived_runs(workspace: Path) -> dict:
    result = {"passed": [], "failed": [], "validation_evidence": {}}
    archives = sorted((workspace / "docs/comet/archive").glob("*/comet-state.yaml"))
    try:
        if not archives:
            raise ValueError("No Native archive identifies an SDK Run")
        for state_file in archives:
            state = yaml.safe_load(state_file.read_text(encoding="utf-8"))
            name = state["name"]
            run = inspect_run(workspace, "native", name, "native", state_file)
            result["validation_evidence"][name] = sdk_inspection_evidence("native", "native", run)
            if (
                run.get("status") != "completed"
                or not any(
                    action.get("stepId") == "archive.finalize"
                    and action.get("status") == "succeeded"
                    for action in run.get("actions", [])
                )
                or any(
                    action.get("status") in {"pending", "running", "unknown"}
                    for action in run.get("actions", [])
                )
            ):
                raise ValueError(f"Original Native Run {name} is not completely archived")
        result["passed"].append("sdk_run")
    except Exception as error:
        result["failed"].append(f"sdk_run: {error}")
    return result


if __name__ == "__main__":
    print(json.dumps(check_archived_runs(Path("/workspace"))))
