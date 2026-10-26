"""只读检查当前发布 CLI 的 owner、Run 与归档 checkpoint，不接受便携状态替代。"""

from __future__ import annotations

import json
import hashlib
import re
import subprocess
import tempfile
from pathlib import Path


def sdk_inspection_evidence(workflow: str, application: str, run: dict) -> dict:
    """保留实际只读查询结果，不规范化 revision、领取或原始执行结果。"""
    source = json.dumps(run, sort_keys=True, separators=(",", ":"))
    return {
        "schema": "comet.eval.sdk-inspection.v1",
        "workflow": workflow,
        "application": application,
        "runHash": hashlib.sha256(source.encode()).hexdigest(),
        "run": json.loads(source),
        "actionEvidence": [
            {
                "id": action["id"],
                "attempt": action.get("attempt"),
                "inputHash": action.get("inputHash"),
                "outcomeHash": hashlib.sha256(
                    json.dumps(
                        action.get("outcome"), sort_keys=True, separators=(",", ":")
                    ).encode()
                ).hexdigest(),
            }
            for action in run.get("actions", [])
            if isinstance(action.get("id"), str)
        ],
    }


def classic_new_proposal_approval_issues(
    evidence: dict, interaction: dict, *, required_steps: list[str] | None = None
) -> list[str]:
    """按任务声明核对需要新回复的决定；已授权事项不强制重复问答。"""
    supported = {"full.open.confirm", "full.design.confirm", "full.delivery.confirm"}
    if required_steps is not None and (
        not isinstance(required_steps, list)
        or not required_steps
        or any(not isinstance(step, str) or step not in supported for step in required_steps)
        or len(set(required_steps)) != len(required_steps)
    ):
        return ["Classic proposal interaction scope is invalid"]
    steps = supported if required_steps is None else set(required_steps)
    proposals = set()

    def visit(value):
        if not isinstance(value, dict):
            return
        if value.get("schema") == "comet.eval.sdk-inspection.v1":
            if value.get("workflow") != "classic" or value.get("application") != "classic-full":
                return
            run = value.get("run", {})
            for wait in run.get("waits", []):
                if (
                    wait.get("stepId") in steps
                    and wait.get("status") == "resolved"
                    and wait.get("decision", {}).get("choice") == "approved"
                ):
                    proposals.add(
                        (run.get("runId"), wait.get("id"), wait["stepId"], wait.get("proposalHash"))
                    )
            return
        for child in value.values():
            visit(child)

    visit(evidence)
    required = len(proposals)
    if not required:
        return []
    counts = [
        interaction.get(key) for key in ("actual_turns", "decision_points", "deterministic_replies")
    ]
    if any(type(value) is not int or value < 0 for value in counts):
        return ["Classic new proposal approvals lack trusted user interaction counts"]
    turns, decisions, deterministic = counts
    simulator = interaction.get("role_sessions", {}).get("simulator", [])
    replies = decisions if isinstance(simulator, list) and simulator else deterministic
    if (
        interaction.get("mode") != "auto_user"
        or decisions < required
        or replies < required
        or turns <= required
        or deterministic > decisions
    ):
        return [
            f"Classic new proposal approvals lack user replies: proposals={required}, decisions={decisions}, replies={replies}, turns={turns}"
        ]
    if required_steps is not None:
        bound = set()
        events = interaction.get("sdk_decision_replies", [])
        for event in events if isinstance(events, list) else []:
            if (
                not isinstance(event, dict)
                or type(event.get("turn")) is not int
                or not 1 <= event["turn"] < turns
                or not re.fullmatch(r"[a-f0-9]{64}", str(event.get("replyHash", "")))
                or not isinstance(event.get("decisions"), list)
            ):
                continue
            for decision in event.get("decisions", []):
                if isinstance(decision, dict):
                    identity = tuple(
                        decision.get(key) for key in ("runId", "waitId", "stepId", "proposalHash")
                    )
                    if all(isinstance(value, str) and value for value in identity):
                        bound.add(identity)
        if not proposals <= bound:
            return [
                "Classic new proposal approval lacks a reply bound to its original pending Wait"
            ]
    return []


def requested_classic_decisions(workspace: Path, requests: list[dict]) -> list[dict]:
    """回复前只读记录指定 Run 的待决定项，作为本次回复的绑定依据。"""
    if not isinstance(requests, list):
        raise ValueError("Invalid decision requests")
    decisions = []
    names = set()
    for request in requests:
        if isinstance(request, dict) and request.get("workflow") == "native":
            continue
        if not isinstance(request, dict) or set(request) != {"name", "profile"}:
            raise ValueError("Invalid Classic decision request")
        name, profile = request["name"], request["profile"]
        if (
            not isinstance(name, str)
            or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name)
            or name in names
            or profile not in ("full", "tweak", "hotfix")
        ):
            raise ValueError("Invalid Classic decision request")
        names.add(name)
        if profile != "full":
            continue
        root = workspace / "docs/openspec/changes"
        locations = (
            [root / name]
            if (root / name).exists()
            else list((root / "archive").glob(f"????-??-??-{name}"))
        )
        if not locations:
            continue
        if len(locations) != 1:
            raise ValueError("Ambiguous Classic decision location")
        state_file = locations[0] / "comet-state.yaml"
        if not state_file.is_file():
            continue
        run = inspect_run(workspace, "classic", name, "classic-full", state_file)
        for wait in run.get("waits", []):
            if wait.get("status") == "pending":
                decisions.append(
                    {
                        "runId": name,
                        "waitId": wait["id"],
                        "stepId": wait["stepId"],
                        "proposalHash": wait["proposalHash"],
                    }
                )
    return decisions


def requested_runs_completed(workspace: Path, requests: list[dict]) -> bool:
    """按固定任务声明查询终态，不依赖模型用哪句话表示完成。"""
    if not isinstance(requests, list) or not requests:
        return False
    if not all(
        isinstance(request, dict) and request.get("workflow") == "native" for request in requests
    ):
        return requested_classic_runs_completed(workspace, requests)
    names = set()
    try:
        for request in requests:
            if set(request) != {"workflow", "name"}:
                return False
            name = request["name"]
            if (
                not isinstance(name, str)
                or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name)
                or name in names
            ):
                return False
            names.add(name)
            if (workspace / "docs/comet/changes" / name).exists():
                return False
            archives = list((workspace / "docs/comet/archive").glob(f"????-??-??-{name}"))
            if len(archives) != 1:
                return False
            state_file = archives[0] / "comet-state.yaml"
            if not state_file.is_file():
                return False
            run = inspect_run(workspace, "native", name, "native", state_file)
            state = run.get("state", {})
            if (
                run.get("runId") != name
                or run.get("workflow", {}).get("id") != "comet-native"
                or run.get("status") != "completed"
                or run.get("lineage") != []
                or state.get("phase") != "archive"
                or state.get("status") != "done"
                or state.get("archived") is not True
                or any(
                    a.get("status") in ("pending", "running", "unknown")
                    for a in run.get("actions", [])
                )
                or any(
                    w.get("status") == "pending"
                    for w in [*run.get("waits", []), *run.get("evidenceWaits", [])]
                )
                or not any(
                    a.get("stepId") == "archive.finalize" and a.get("status") == "succeeded"
                    for a in run.get("actions", [])
                )
            ):
                return False
    except (ValueError, TypeError, KeyError):
        return False
    return True


def requested_classic_runs_completed(workspace: Path, requests: list[dict]) -> bool:
    """只查询固定任务指定的 Run；不推进未列出的并存需求。"""
    if not isinstance(requests, list) or not requests:
        return False
    names = set()
    try:
        for request in requests:
            if not isinstance(request, dict) or set(request) != {"name", "profile"}:
                return False
            name, profile = request["name"], request["profile"]
            if (
                not isinstance(name, str)
                or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name)
                or name in names
                or profile not in ("full", "tweak", "hotfix")
            ):
                return False
            names.add(name)
            # 此判定仅用于声明 docs layout 的 Classic SDK 任务。
            root = workspace / "docs/openspec/changes"
            if (root / name).exists():
                return False
            archives = list((root / "archive").glob(f"????-??-??-{name}"))
            if len(archives) != 1:
                return False
            states = [
                p
                for p in (archives[0] / "comet-state.yaml", archives[0] / ".comet.yaml")
                if p.exists()
            ]
            if len(states) != 1:
                return False
            run = inspect_run(workspace, "classic", name, f"classic-{profile}", states[0])
            if (
                run.get("runId") != name
                or run.get("workflow", {}).get("id") != f"comet-classic-{profile}"
                or run.get("status") != "completed"
                or run.get("lineage") != []
                or any(
                    a.get("status") in ("pending", "running", "unknown")
                    for a in run.get("actions", [])
                )
                or any(
                    w.get("status") == "pending"
                    for w in [*run.get("waits", []), *run.get("evidenceWaits", [])]
                )
                or not any(
                    a.get("stepId") == f"{profile}.archive.deliver"
                    and a.get("status") == "succeeded"
                    for a in run.get("actions", [])
                )
            ):
                return False
    except (ValueError, TypeError, KeyError):
        return False
    return True


def inspect_run(
    workspace: Path,
    workflow: str,
    name: str,
    application: str,
    state_file: Path,
    *,
    package: Path = Path("/opt/comet-current"),
    cli: list[str] | None = None,
) -> dict:
    cli = cli or ["comet"]
    if any(
        path.is_symlink() for path in [state_file, *state_file.parents] if path != workspace.parent
    ):
        raise ValueError("Linked archive paths are not SDK proof")
    source = state_file.read_text(encoding="utf-8")
    if state_file.is_symlink() or not source.startswith("# comet-execution: managed-run\n"):
        raise ValueError("Missing managed SDK checkpoint")
    script = (
        f"import {{readSdkChangeOwner}} from {json.dumps((package / 'dist/domains/workflow-contract/change-runtime-owner.js').as_uri())};"
        "console.log(JSON.stringify(await readSdkChangeOwner(process.argv[1],process.argv[2],process.argv[3],{readOnly:true})));"
    )
    owner = json.loads(
        subprocess.run(
            ["node", "--input-type=module", "-e", script, str(workspace), workflow, name],
            cwd=workspace,
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        ).stdout
    )
    if owner != dict(
        schema="comet.change-owner.v1",
        workflow=workflow,
        change=name,
        format="sdk",
        application=application,
        runId=name,
    ):
        raise ValueError("SDK owner does not match this change and application")
    with tempfile.TemporaryDirectory(prefix=".eval-inspect-", dir=workspace) as directory:
        request = Path(directory) / "request.json"
        request.write_text(json.dumps(dict(operation="inspect", runId=name)))
        response = json.loads(
            subprocess.run(
                [
                    *cli,
                    "runtime",
                    "dispatch",
                    "--application",
                    application,
                    "--project-root",
                    str(workspace),
                    "--request",
                    str(request),
                    "--details",
                ],
                cwd=workspace,
                capture_output=True,
                text=True,
                check=True,
                timeout=60,
            ).stdout
        )
    run = response.get("data")
    if (
        response.get("status") != "succeeded"
        or not isinstance(run, dict)
        or run.get("runId") != name
    ):
        raise ValueError("Current CLI did not inspect the expected SDK Run")
    delivery_import = (
        f"import {{readClassicSdkDeliveryCheckpoint}} from {json.dumps((package / 'dist/domains/comet-classic/classic-sdk-delivery-checkpoint.js').as_uri())};"
        if workflow == "classic"
        else ""
    )
    delivery_match = (
        " || readClassicSdkDeliveryCheckpoint(checkpoint,run)!==null"
        if workflow == "classic"
        else ""
    )
    script = (
        "import {readFileSync} from 'node:fs';"
        f"import {{portableRunCheckpointProjectionMatches}} from {json.dumps((package / 'dist/domains/engine/portable-run-checkpoint.js').as_uri())};"
        f"import YAML from {json.dumps((package / 'node_modules/yaml/dist/index.js').as_uri())};"
        + delivery_import
        + "const {source,run}=JSON.parse(readFileSync(0,'utf8'));"
        "const checkpoint=YAML.parse(source).run_checkpoint;"
        f"console.log(JSON.stringify(portableRunCheckpointProjectionMatches(checkpoint,run){delivery_match}));"
    )
    checked = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=json.dumps(dict(source=source, run=run)),
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    if json.loads(checked.stdout) is not True:
        raise ValueError("Archive checkpoint differs from the current SDK Run")
    return run
