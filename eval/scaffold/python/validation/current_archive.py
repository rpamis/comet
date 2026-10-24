"""检查当前 SDK 的真实归档和交付，不用目录存在或模型自述替代终态。"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import yaml

from scaffold.python.validation.current_sdk import inspect_run


def inspect_completed_archive(workspace: Path, name: str, treatment: str) -> dict:
    native = treatment == "COMET_NATIVE_SDK_CURRENT"
    if not native and treatment != "COMET_CLASSIC_DOCS_LAYOUT":
        raise ValueError("Expected a current Native or Classic CLI treatment")
    workflow = "native" if native else "classic"
    root = workspace / ("docs/comet/archive" if native else "docs/openspec/changes/archive")
    active = workspace / ("docs/comet/changes" if native else "docs/openspec/changes") / name
    archives = list(root.glob(f"????-??-??-{name}"))
    if len(archives) != 1 or active.exists():
        raise ValueError("Expected one terminal archive and no remaining active change")
    archive = archives[0]
    state_file = archive / "comet-state.yaml"
    run = inspect_run(workspace, workflow, name, "native" if native else "classic-full", state_file)
    state = yaml.safe_load(state_file.read_text(encoding="utf-8"))
    if (
        run.get("status") != "completed"
        or state.get("archived") is not True
        or state.get("phase") != "archive"
    ):
        raise ValueError("SDK Run and portable state must both be completed and archived")
    if any(
        action.get("status") in {"pending", "running", "unknown"}
        for action in run.get("actions", [])
    ):
        raise ValueError("Archive retains unresolved execution")
    successful = {
        action["stepId"]: action
        for action in run.get("actions", [])
        if action.get("status") == "succeeded"
    }
    if native:
        if (
            "archive.finalize" not in successful
            or not state.get("acceptance")
            or any(item.get("result") != "passed" for item in state["acceptance"])
        ):
            raise ValueError("Native archive lacks finalization or full acceptance evidence")
    else:
        delivery = successful.get("full.archive.deliver", {}).get("outcome", {}).get("output", {})
        if (
            state.get("verify_result") != "pass"
            or delivery.get("action") != "local"
            or not delivery.get("commit")
        ):
            raise ValueError("Classic archive lacks verification or local delivery")
        result = subprocess.run(
            ["comet", "state", "delivery", name, "--verify", "--json"],
            cwd=workspace,
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        )
        if json.loads(result.stdout).get("exitCode") != 0:
            raise ValueError("Classic delivery receipt does not verify")
    canonical = (
        workspace / ("docs/comet/specs" if native else "docs/openspec/specs") / name / "spec.md"
    )
    if (
        canonical.is_symlink()
        or not canonical.is_file()
        or not canonical.read_text(encoding="utf-8").strip()
    ):
        raise ValueError("Canonical specification is missing")
    return run
