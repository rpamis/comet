"""Current-checkout workflow Eval must not accept compat artifacts as SDK proof."""

import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml

from scaffold.python.paths import get_tasks_dir
from scaffold.python.validation import current_sdk


def test_new_classic_proposals_cannot_pass_without_actual_user_interaction():
    def inspection(waits, workflow="classic"):
        return {
            "schema": "comet.eval.sdk-inspection.v1",
            "workflow": workflow,
            "application": "classic-full" if workflow == "classic" else "native",
            "run": {"runId": "original", "waits": waits},
        }

    def approved(step, digest):
        return {
            "id": digest,
            "stepId": step,
            "status": "resolved",
            "proposalHash": digest,
            "decision": {"choice": "approved"},
        }

    evidence = {
        "trusted.py": {
            "original": inspection(
                [
                    approved("full.design.confirm", "design-1"),
                    approved("full.design.confirm", "design-2"),
                    approved("full.delivery.confirm", "delivery-1"),
                ]
            )
        }
    }
    check = current_sdk.classic_new_proposal_approval_issues
    open_only = {"trusted": inspection([approved("full.open.confirm", "open-1")])}
    assert check(open_only, {})
    assert (
        check(
            open_only,
            {
                "mode": "auto_user",
                "actual_turns": 2,
                "decision_points": 1,
                "deterministic_replies": 1,
            },
        )
        == []
    )
    assert check(
        evidence,
        {"mode": "auto_user", "actual_turns": 1, "decision_points": 0, "deterministic_replies": 0},
    )
    assert check(
        evidence,
        {"mode": "auto_user", "actual_turns": 3, "decision_points": 2, "deterministic_replies": 2},
    )
    interaction = {
        "mode": "auto_user",
        "actual_turns": 4,
        "decision_points": 3,
        "deterministic_replies": 3,
    }
    assert check(evidence, interaction) == []
    assert check({"first": evidence, "duplicate": evidence}, interaction) == []
    assert check(evidence, {**interaction, "actual_turns": 1})
    assert check(evidence, {**interaction, "deterministic_replies": True})
    assert check({"trusted": inspection([approved("shape.confirm", "shape")], "native")}, {}) == []
    assert check({"trusted": inspection([approved("full.archive.confirm", "local")])}, {}) == []
    assert check({}, {}) == []


def _validator(task: str, script: str):
    path = get_tasks_dir() / task / "validation" / script
    spec = importlib.util.spec_from_file_location(f"{task}_validator", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_classic_current_layout_rejects_terminal_compat_state_without_sdk_owner(tmp_path: Path):
    validator = _validator("comet-classic-layout-lifecycle", "test_classic_layout_lifecycle.py")
    validator.WORKSPACE = tmp_path
    (tmp_path / validator.CONTEXT_FILE).write_text(
        json.dumps({"treatment_name": "COMET_CLASSIC_DOCS_LAYOUT"}), encoding="utf-8"
    )
    archived = tmp_path / "docs/openspec/changes/archive/2026-09-30-sentence-counting"
    archived.mkdir(parents=True)
    (archived / ".comet.yaml").write_text(
        "workflow: full\nphase: archive\nverify_result: pass\narchived: true\n",
        encoding="utf-8",
    )

    result = validator.check_sdk_run()

    assert result["check"] == "sdk_run"
    assert result["status"] == "failed"


def test_native_current_workflow_rejects_portable_archive_without_sdk_owner(tmp_path: Path):
    validator = _validator("comet-native-workflow", "test_native_workflow.py")
    validator.WORKSPACE = tmp_path
    archived = tmp_path / "docs/comet/archive/2026-09-30-sentence-counting"
    archived.mkdir(parents=True)
    (archived / "comet-state.yaml").write_text(
        "schema: comet.native.v4\nname: sentence-counting\nphase: archive\n"
        "status: done\narchived: true\n",
        encoding="utf-8",
    )

    result = validator.check_sdk_run()

    assert result["check"] == "sdk_run"
    assert result["status"] == "failed"


@pytest.mark.parametrize(
    "entry", ["fence", "invalid-json", "wrong-schema", "relative-target", "change-local"]
)
def test_native_current_workflow_accepts_only_valid_runtime_fence(tmp_path: Path, entry: str):
    validator = _validator("comet-native-workflow", "test_native_workflow.py")
    validator.WORKSPACE = tmp_path
    (tmp_path / ".comet").mkdir()
    identity = "a" * 64
    fence = {
        "schema": "comet.workspace-runtime-migration.v1",
        "workspaceId": identity,
        "source": "/workspace/.comet/runtime",
        "target": f"/opt/comet-eval-data/workspaces/{identity}/runtime",
        "kind": "directory",
    }
    if entry == "wrong-schema":
        fence["schema"] = "unrelated"
    if entry == "relative-target":
        fence["target"] = f"workspaces/{identity}/runtime"
    (tmp_path / ".comet/runtime").write_text(
        "invalid" if entry == "invalid-json" else json.dumps(fence), encoding="utf-8"
    )
    if entry == "change-local":
        (tmp_path / "docs/comet/archive/2026-10-22-example/runtime").mkdir(parents=True)
    assert validator.check_isolation()["status"] == ("passed" if entry == "fence" else "failed")


@pytest.mark.parametrize(
    "scenario", ["new", "legacy", "both", "directory", "symlink", "parent-link"]
)
def test_classic_state_selection_preserves_names_and_rejects_unsafe_sources(
    tmp_path: Path, scenario: str
):
    validator = _validator("comet-classic-layout-lifecycle", "test_classic_layout_lifecycle.py")
    validator.WORKSPACE = tmp_path
    archive = tmp_path / "archive"
    archive.mkdir()
    name = ".comet.yaml" if scenario == "legacy" else "comet-state.yaml"
    target = archive / name
    if scenario == "directory":
        target.mkdir()
    elif scenario == "symlink":
        try:
            target.symlink_to(archive / "missing.yaml")
        except OSError:
            pytest.skip("This host cannot create the dangling symlink attack fixture")
    else:
        target.write_text("workflow: full\n", encoding="utf-8")
    if scenario == "both":
        (archive / ".comet.yaml").write_text("workflow: full\n", encoding="utf-8")
    if scenario == "parent-link":
        link = tmp_path / "linked"
        result = (
            subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(link), str(archive)], capture_output=True
            )
            if os.name == "nt"
            else None
        )
        if result is not None and result.returncode != 0:
            pytest.skip("This host cannot create the directory link attack fixture")
        if os.name != "nt":
            link.symlink_to(archive, target_is_directory=True)
        archive = link
    if scenario in {"new", "legacy"}:
        assert validator._state_path(archive).name == name
        assert validator._read_state(archive) == ({"workflow": "full"}, None)
    else:
        with pytest.raises((ValueError, OSError)):
            validator._state_path(archive)


def test_current_checkpoint_api_validates_generated_v1_and_v2_content():
    repository = Path(__file__).resolve().parents[4]
    checkpoint = repository / "dist/domains/engine/portable-run-checkpoint.js"
    runtime = repository / "dist/domains/engine/runtime.js"
    if not checkpoint.is_file():
        pytest.skip("Current Runtime build is required")
    script = f"""
import {{createRuntime,createMemoryRuntimeStore}} from {json.dumps(runtime.as_uri())};
import {{createPortableRunCheckpoint,encodePortableRunCheckpoint,portableRunCheckpointProjectionMatches}} from {json.dumps(checkpoint.as_uri())};
const runtime=createRuntime({{store:createMemoryRuntimeStore(),workflows:[{{id:'fixture',version:'1',entry:'a',steps:{{a:{{type:'call_tool',ref:'tool'}},b:{{type:'call_tool',ref:'tool'}},c:{{type:'call_tool',ref:'tool'}}}},transitions:[{{from:'a',to:'b'}},{{from:'b',to:'c'}}]}}]}});
let run=await runtime.start({{runId:'fixture',workflow:{{id:'fixture',version:'1'}},input:null}});
for (let index=0; index<3; index++) {{
 const action=run.actions.find(x=>x.status==='pending');
 const claimed=await runtime.claim({{runId:run.runId,actionId:action.id,attempt:action.attempt,inputHash:action.inputHash,executorId:'fixture',claimToken:'fixture-token-'+index}});
 const active=claimed.actions.find(x=>x.id===action.id);
 run=await runtime.recordOutcome({{runId:run.runId,outcome:{{actionId:active.id,attempt:active.attempt,inputHash:active.inputHash,claimToken:active.claim.token,outcomeId:'result-'+index,status:'succeeded',output:{{text:'x'.repeat(150000),index}}}}}});
}}
const v1=createPortableRunCheckpoint(run), v2=encodePortableRunCheckpoint(v1);
const check=value=>{{try{{return portableRunCheckpointProjectionMatches(JSON.parse(JSON.stringify(value)),JSON.parse(JSON.stringify(run)));}}catch{{return false;}}}};
const changed=structuredClone(v2); changed.run.status='cancelled';
const wrongStorage=structuredClone(v2); wrongStorage.storageHash='0'.repeat(64);
const wrongRevision=structuredClone(v2); wrongRevision.sourceRevision++;
console.log(JSON.stringify({{status:run.status,schemas:[v1.schema,v2.schema],v1:check(v1),v2:check(v2),changed:check(changed),wrongStorage:check(wrongStorage),wrongRevision:check(wrongRevision)}}));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    assert json.loads(result.stdout) == {
        "status": "completed",
        "schemas": ["comet.workflow-run-checkpoint.v1", "comet.workflow-run-checkpoint.v2"],
        "v1": True,
        "v2": True,
        "changed": False,
        "wrongStorage": False,
        "wrongRevision": False,
    }


def test_native_current_workflow_requires_failed_then_passed_verify(tmp_path: Path):
    validator = _validator("comet-native-workflow", "test_native_workflow.py")
    validator.WORKSPACE = tmp_path
    archived = tmp_path / "docs/comet/archive/2026-09-30-sentence-counting"
    archived.mkdir(parents=True)
    state_path = archived / "comet-state.yaml"
    base = {
        "loop": {"stage": "done"},
        "history_overflow": {
            "dropped_entries": 0,
            "outcome_counts": {
                "pass": 0,
                "fail": 0,
                "blocked": 0,
                "execution-error": 0,
                "recovery": 0,
            },
        },
    }

    def entry(outcome: str, iteration: int, unresolved: list[str]):
        return {
            "goal_cycle": 1,
            "iteration": iteration,
            "attempt": 1,
            "outcome": outcome,
            "unresolved_ids": unresolved,
            "summary": {"text": outcome, "truncated": False},
            "completed_at": "2026-09-30T00:00:00Z",
        }

    state_path.write_text(
        yaml.safe_dump({**base, "history": [entry("pass", 1, [])]}),
        encoding="utf-8",
    )
    assert validator.check_loop()["status"] == "failed"

    state_path.write_text(
        yaml.safe_dump(
            {
                **base,
                "history": [entry("fail", 1, ["A8"]), entry("pass", 2, [])],
            }
        ),
        encoding="utf-8",
    )
    assert validator.check_loop()["status"] == "passed"


@pytest.mark.parametrize(
    ("task", "script", "workflow", "application", "state_file", "steps"),
    [
        (
            "comet-classic-layout-lifecycle",
            "test_classic_layout_lifecycle.py",
            "classic",
            "classic-full",
            ".comet.yaml",
            ["full.build.check", "full.verify.run", "full.archive.execute"],
        ),
        (
            "comet-native-workflow",
            "test_native_workflow.py",
            "native",
            "native",
            "comet-state.yaml",
            ["build.builder", "verify.verifier", "archive.finalize"],
        ),
        (
            "comet-classic-layout-lifecycle",
            "test_classic_layout_lifecycle.py",
            "classic",
            "classic-full",
            "comet-state.yaml",
            ["full.build.check", "full.verify.run", "full.archive.execute"],
        ),
    ],
)
@pytest.mark.parametrize("runtime_layout", ["legacy", "external"])
@pytest.mark.parametrize(
    "checkpoint_schema", ["comet.workflow-run-checkpoint.v1", "comet.workflow-run-checkpoint.v2"]
)
def test_current_validator_inspects_matching_completed_sdk_run(
    tmp_path: Path,
    monkeypatch,
    task: str,
    script: str,
    workflow: str,
    application: str,
    state_file: str,
    steps: list[str],
    runtime_layout: str,
    checkpoint_schema: str,
):
    steps = list(steps)
    validator = _validator(task, script)
    validator.WORKSPACE = tmp_path
    if workflow == "classic":
        (tmp_path / validator.CONTEXT_FILE).write_text(
            json.dumps({"treatment_name": "COMET_CLASSIC_DOCS_LAYOUT"}), encoding="utf-8"
        )
        archived = tmp_path / "docs/openspec/changes/archive/2026-09-30-sentence-counting"
    else:
        archived = tmp_path / "docs/comet/archive/2026-09-30-sentence-counting"
    archived.mkdir(parents=True)
    runtime_root = tmp_path / (
        ".comet/runtime" if runtime_layout == "legacy" else "external-runtime"
    )
    owner = runtime_root / "change-owner-history" / workflow / "sentence-counting.json"
    owner.parent.mkdir(parents=True)
    owner.write_text(
        json.dumps(
            {
                "schema": "comet.change-owner.v1",
                "workflow": workflow,
                "change": "sentence-counting",
                "format": "sdk",
                "application": application,
                "runId": "sentence-counting",
            }
        ),
        encoding="utf-8",
    )
    (archived / state_file).write_text(
        "# comet-execution: managed-run\n"
        "run_checkpoint:\n"
        f"  schema: {checkpoint_schema}\n"
        f"  hash: '{'0' * 64}'\n"
        "  run:\n"
        "    runId: sentence-counting\n",
        encoding="utf-8",
    )
    calls = []
    run_status = "completed"
    checkpoint_matches = True

    def inspect(args, **kwargs):
        calls.append(args)
        if args[0] == "node":
            if "portableRunCheckpointProjectionMatches" in args[3]:
                payload = json.loads(kwargs["input"])
                assert (
                    yaml.safe_load(payload["source"])["run_checkpoint"]["schema"]
                    == checkpoint_schema
                )
                assert payload["run"]["status"] == "completed"
                return subprocess.CompletedProcess(args, 0, json.dumps(checkpoint_matches), "")
            assert "readSdkChangeOwner" in args[3]
            assert "readOnly: true" in args[3]
            assert args[-3:] == [str(tmp_path), workflow, "sentence-counting"]
            return subprocess.CompletedProcess(args, 0, owner.read_text(encoding="utf-8"), "")
        request = json.loads(Path(args[-1]).read_text(encoding="utf-8"))
        assert request == {"operation": "inspect", "runId": "sentence-counting"}
        return subprocess.CompletedProcess(
            args,
            0,
            json.dumps(
                {
                    "status": "succeeded",
                    "data": {
                        "runId": "sentence-counting",
                        "workflow": {
                            "id": f"comet-{workflow if workflow == 'native' else 'classic-full'}"
                        },
                        "status": run_status,
                        "actions": [{"stepId": step, "status": "succeeded"} for step in steps],
                    },
                }
            ),
            "",
        )

    monkeypatch.setattr(validator.subprocess, "run", inspect)

    result = validator.check_sdk_run()

    assert result == {"check": "sdk_run", "status": "passed"}
    assert len(calls) == 3
    assert calls[1][:5] == ["comet", "runtime", "dispatch", "--application", application]

    run_status = "running"
    assert validator.check_sdk_run()["status"] == "failed"
    run_status = "completed"

    checkpoint_matches = False
    assert validator.check_sdk_run()["status"] == "failed"
    checkpoint_matches = True

    steps.pop()
    incomplete = validator.check_sdk_run()
    assert incomplete["status"] == "failed"
    assert "lacks successful steps" in incomplete["reason"]

    owner_payload = json.loads(owner.read_text(encoding="utf-8"))
    owner_payload["application"] = "unrelated-application"
    owner.write_text(json.dumps(owner_payload), encoding="utf-8")
    assert validator.check_sdk_run()["status"] == "failed"


@pytest.mark.parametrize(
    "scenario", ["foreign-fence", "history-owner", "owner-symlink", "runtime-symlink"]
)
def test_current_runtime_owner_api_uses_workspace_identity_not_fence_target(
    tmp_path: Path, scenario: str
):
    repository = Path(__file__).resolve().parents[4]
    owner_module = repository / "dist/domains/workflow-contract/change-runtime-owner.js"
    paths_module = repository / "dist/platform/paths/workspace-runtime.js"
    if not owner_module.is_file():
        pytest.skip("Current Runtime build is required for its real read-only API contract")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}
    }
    environment["COMET_DATA_DIR"] = str(tmp_path / "data")
    source = f"""
import fs from 'node:fs';
import path from 'node:path';
import {{ readSdkChangeOwner }} from {json.dumps(owner_module.as_uri())};
import {{ resolveWorkspaceRuntimeLocation }} from {json.dumps(paths_module.as_uri())};
const root = process.argv[1], scenario = process.argv[2];
const location = resolveWorkspaceRuntimeLocation(root);
const foreign = path.join(path.dirname(root), 'foreign');
const owner = {{schema:'comet.change-owner.v1', workflow:'native', change:'example', format:'sdk', application:'native', runId:'example'}};
const runtime = scenario === 'foreign-fence' ? foreign : location.runtimeRoot;
const directory = path.join(runtime, 'change-owner-history/native');
fs.mkdirSync(directory, {{recursive:true}});
const file = path.join(directory, 'example.json');
fs.writeFileSync(file, JSON.stringify(owner));
fs.mkdirSync(path.join(root,'.comet'));
fs.writeFileSync(path.join(root,'.comet/runtime'), JSON.stringify({{schema:'comet.workspace-runtime-migration.v1',workspaceId:location.workspaceId,source:path.join(root,'.comet/runtime'),target:runtime,kind:'directory'}}));
try {{
 if (scenario === 'owner-symlink') {{ fs.renameSync(file,file+'.real'); fs.symlinkSync(file+'.real', file); }}
 if (scenario === 'runtime-symlink') {{ fs.renameSync(runtime,runtime+'.real'); fs.symlinkSync(runtime+'.real',runtime,'junction'); }}
}} catch (error) {{ if (error.code === 'EPERM') {{ console.log(JSON.stringify({{unsupported:true}})); process.exit(0); }} throw error; }}
const before = fs.readFileSync(path.join(root,'.comet/runtime'),'utf8');
try {{
 const result = await readSdkChangeOwner(root,'native','example',{{readOnly:true}});
 console.log(JSON.stringify({{result,unchanged:before===fs.readFileSync(path.join(root,'.comet/runtime'),'utf8')}}));
}} catch (error) {{ console.log(JSON.stringify({{rejected:true,unchanged:before===fs.readFileSync(path.join(root,'.comet/runtime'),'utf8')}})); }}
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", source, str(workspace), scenario],
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    response = json.loads(result.stdout)
    if response.get("unsupported"):
        pytest.skip("This host cannot create the symlink attack fixture")
    assert response["unchanged"] is True
    if scenario == "history-owner":
        assert response["result"]["runId"] == "example"
    elif scenario == "foreign-fence":
        assert response["result"] is None
    else:
        assert response.get("rejected") is True


@pytest.mark.parametrize(
    "task,script",
    [
        ("comet-classic-layout-lifecycle", "test_classic_layout_lifecycle.py"),
        ("comet-native-workflow", "test_native_workflow.py"),
    ],
)
def test_current_validator_includes_sdk_check_in_main(task: str, script: str):
    source = (get_tasks_dir() / task / "validation" / script).read_text(encoding="utf-8")
    assert "check_sdk_run()" in source[source.index("def main():") :]


@pytest.mark.parametrize("layout", ["docs", "legacy"])
@pytest.mark.parametrize("state_name", [".comet.yaml", "comet-state.yaml"])
def test_classic_sdk_phase_validation_uses_verified_run_actions_not_compat_events(
    tmp_path: Path, monkeypatch, layout: str, state_name: str
):
    validator = _validator("comet-classic-layout-lifecycle", "test_classic_layout_lifecycle.py")
    validator.WORKSPACE = tmp_path
    treatment = "COMET_CLASSIC_DOCS_LAYOUT" if layout == "docs" else "COMET_CLASSIC_LEGACY_LAYOUT"
    (tmp_path / validator.CONTEXT_FILE).write_text(
        json.dumps({"treatment_name": treatment}), encoding="utf-8"
    )
    (tmp_path / ".comet").mkdir()
    (tmp_path / ".comet/config.yaml").write_text(
        f"schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: {layout}\n",
        encoding="utf-8",
    )
    root = "docs/openspec/changes" if layout == "docs" else "openspec/changes"
    archived = tmp_path / root / "archive/2026-10-01-sentence-counting"
    archived.mkdir(parents=True)
    (archived / state_name).write_text(
        "# comet-execution: managed-run\n"
        "workflow: full\nphase: archive\nverify_result: pass\narchived: true\n"
        "run_checkpoint:\n  schema: comet.workflow-run-checkpoint.v1\n"
        f"  hash: '{'0' * 64}'\n  run:\n    runId: sentence-counting\n",
        encoding="utf-8",
    )
    owner_path = tmp_path / ".comet/runtime/change-owners/classic/sentence-counting.json"
    owner_path.parent.mkdir(parents=True)
    owner_path.write_text(
        json.dumps(
            {
                "schema": "comet.change-owner.v1",
                "workflow": "classic",
                "change": "sentence-counting",
                "format": "sdk",
                "application": "classic-full",
                "runId": "sentence-counting",
            }
        ),
        encoding="utf-8",
    )
    steps = [
        "full.open",
        "full.open.revalidate",
        "full.design.handoff",
        "full.design.document",
        "full.build.configure",
        "full.build.plan",
        "full.build.execute",
        "full.build.check",
        "full.verify.run",
        "full.verify.check",
        "full.archive.prepare",
        "full.archive.preflight",
        "full.archive.execute",
        "full.archive.deliver",
    ]
    run = {
        "runId": "sentence-counting",
        "workflow": {"id": "comet-classic-full"},
        "status": "completed",
        "actions": [{"stepId": step, "status": "succeeded"} for step in steps],
    }

    def inspect(args, **kwargs):
        if args[0] == "node":
            if "portableRunCheckpointProjectionMatches" in args[3]:
                return subprocess.CompletedProcess(args, 0, "true", "")
            return subprocess.CompletedProcess(
                args,
                0,
                owner_path.read_text(encoding="utf-8") if owner_path.exists() else "null",
                "",
            )
        request = json.loads(Path(args[-1]).read_text(encoding="utf-8"))
        assert request == {"operation": "inspect", "runId": "sentence-counting"}
        return subprocess.CompletedProcess(
            args, 0, json.dumps({"status": "succeeded", "data": run}), ""
        )

    monkeypatch.setattr(validator.subprocess, "run", inspect)

    assert validator.check_workflow_phases() == {"check": "workflow_phases", "status": "passed"}
    run["actions"].insert(0, {"stepId": "full.open", "status": "failed"})
    assert validator.check_workflow_phases() == {"check": "workflow_phases", "status": "passed"}
    run["actions"].pop(0)
    # A valid SDK owner must never fall back to forged compat event files.
    compat_dir = archived / ".comet"
    compat_dir.mkdir()
    compat_events = [
        {"event": event, "from": {"phase": source}, "to": {"phase": target}}
        for event, source, target in validator.REQUIRED_TRANSITIONS
    ]
    compat_lines = "\n".join(json.dumps(event) for event in compat_events) + "\n"
    (compat_dir / "state-events.jsonl").write_text(compat_lines, encoding="utf-8")
    (compat_dir / "trajectory.jsonl").write_text(compat_lines, encoding="utf-8")
    for step in steps:
        run["actions"] = [a for a in run["actions"] if a["stepId"] != step]
        result = validator.check_workflow_phases()
        assert result["status"] == "failed", step
        run["actions"] = [{"stepId": s, "status": "succeeded"} for s in steps]
    run["status"] = "running"
    assert validator.check_workflow_phases()["status"] == "failed"
    run["status"] = "completed"
    run["actions"].reverse()
    assert validator.check_workflow_phases()["status"] == "failed"
    run["actions"].reverse()
    run["actions"][0]["status"] = "failed"
    assert validator.check_workflow_phases()["status"] == "failed"
    run["actions"][0]["status"] = "succeeded"
    owner_path.unlink()
    assert validator.check_workflow_phases()["status"] == "failed"


def test_requested_classic_completion_requires_every_owned_delivery(tmp_path, monkeypatch):
    requests = [
        {"name": "sentence-full", "profile": "full"},
        {"name": "characters-tweak", "profile": "tweak"},
        {"name": "missing-file-hotfix", "profile": "hotfix"},
    ]
    runs = {}
    for request in requests:
        name, profile = request.values()
        archive = tmp_path / "docs/openspec/changes/archive" / f"2026-10-26-{name}"
        archive.mkdir(parents=True)
        (archive / "comet-state.yaml").write_text("fixture")
        runs[name] = {
            "runId": name,
            "workflow": {"id": f"comet-classic-{profile}"},
            "status": "completed",
            "lineage": [],
            "waits": [],
            "evidenceWaits": [],
            "actions": [{"stepId": f"{profile}.archive.deliver", "status": "succeeded"}],
        }
    observed = []

    def inspect(workspace, workflow, name, application, state_file):
        assert workspace == tmp_path and workflow == "classic"
        assert application == "classic-" + next(r["profile"] for r in requests if r["name"] == name)
        assert state_file.read_text() == "fixture"
        observed.append(name)
        return runs[name]

    monkeypatch.setattr(current_sdk, "inspect_run", inspect)
    # The excluded parked Run is deliberately not terminal and must not be inspected.
    runs["parked-format"] = {"status": "waiting"}
    assert current_sdk.requested_classic_runs_completed(tmp_path, requests)
    assert observed == [r["name"] for r in requests]
    assert current_sdk.requested_runs_completed(tmp_path, requests)
    for mutation in (
        {"status": "waiting"},
        {"lineage": ["parent"]},
        {"runId": "another"},
        {"workflow": {"id": "comet-classic-full"}},
        {"actions": []},
        {"actions": [{"stepId": "hotfix.archive.deliver", "status": "unknown"}]},
        {"waits": [{"status": "pending"}]},
        {"evidenceWaits": [{"status": "pending"}]},
    ):
        original = runs["missing-file-hotfix"]
        runs["missing-file-hotfix"] = {**original, **mutation}
        assert not current_sdk.requested_classic_runs_completed(tmp_path, requests), mutation
        runs["missing-file-hotfix"] = original
    for malformed in (
        [],
        requests + requests[:1],
        [{"name": "../escape", "profile": "full"}],
        [{"name": "x", "profile": "other"}],
    ):
        assert not current_sdk.requested_classic_runs_completed(tmp_path, malformed)
    monkeypatch.setattr(
        current_sdk, "inspect_run", lambda *_: (_ for _ in ()).throw(ValueError("owner mismatch"))
    )
    assert not current_sdk.requested_classic_runs_completed(tmp_path, requests)
    # 查询基础设施不可用必须向控制器报告，不能当作 Run 尚未完成。
    for unavailable in (
        FileNotFoundError("missing node"),
        PermissionError("unreadable store"),
        subprocess.TimeoutExpired("node", 30),
        subprocess.CalledProcessError(1, "node"),
    ):
        monkeypatch.setattr(
            current_sdk,
            "inspect_run",
            lambda *_, error=unavailable: (_ for _ in ()).throw(error),
        )
        with pytest.raises(type(unavailable)):
            current_sdk.requested_classic_runs_completed(tmp_path, requests)


def test_requested_native_completion_uses_owned_terminal_run_without_prose(tmp_path, monkeypatch):
    requests = [{"workflow": "native", "name": "sentence-counting"}]
    archive = tmp_path / "docs/comet/archive/2026-10-26-sentence-counting"
    archive.mkdir(parents=True)
    state_file = archive / "comet-state.yaml"
    state_file.write_text("fixture")
    run = {
        "runId": "sentence-counting",
        "workflow": {"id": "comet-native"},
        "status": "completed",
        "lineage": [],
        "state": {"phase": "archive", "status": "done", "archived": True},
        "actions": [{"stepId": "archive.finalize", "status": "succeeded"}],
        "waits": [],
        "evidenceWaits": [],
    }
    observed = []

    def inspect(workspace, workflow, name, application, checkpoint):
        assert (workspace, workflow, name, application, checkpoint) == (
            tmp_path,
            "native",
            "sentence-counting",
            "native",
            state_file,
        )
        observed.append(name)
        return run

    monkeypatch.setattr(current_sdk, "inspect_run", inspect)
    assert current_sdk.requested_runs_completed(tmp_path, requests)
    assert observed == ["sentence-counting"]
    for mutation in (
        {"status": "waiting"},
        {"runId": "another"},
        {"workflow": {"id": "comet-classic-full"}},
        {"lineage": ["parent"]},
        {"state": {"phase": "archive", "status": "done", "archived": False}},
        {"actions": []},
        {"actions": [{"stepId": "archive.finalize", "status": "unknown"}]},
        {"actions": [*run["actions"], {"stepId": "verify.checks", "status": "running"}]},
        {"waits": [{"status": "pending"}]},
        {"evidenceWaits": [{"status": "pending"}]},
    ):
        original = run
        run = {**run, **mutation}
        assert not current_sdk.requested_runs_completed(tmp_path, requests), mutation
        run = original
    for malformed in (
        [],
        requests * 2,
        [{"workflow": "native", "name": "../escape"}],
        [{"workflow": "other", "name": "sentence-counting"}],
        [{"workflow": "native", "name": "sentence-counting", "profile": "full"}],
    ):
        assert not current_sdk.requested_runs_completed(tmp_path, malformed)
    active = tmp_path / "docs/comet/changes/sentence-counting"
    active.mkdir(parents=True)
    assert not current_sdk.requested_runs_completed(tmp_path, requests)
    active.rmdir()
    monkeypatch.setattr(
        current_sdk, "inspect_run", lambda *_: (_ for _ in ()).throw(ValueError("owner mismatch"))
    )
    assert not current_sdk.requested_runs_completed(tmp_path, requests)
    for error in (
        FileNotFoundError("node"),
        PermissionError("store"),
        subprocess.TimeoutExpired("node", 30),
    ):
        monkeypatch.setattr(
            current_sdk, "inspect_run", lambda *_, error=error: (_ for _ in ()).throw(error)
        )
        with pytest.raises(type(error)):
            current_sdk.requested_runs_completed(tmp_path, requests)


def test_native_recovery_task_declares_its_fixed_completion_run():
    import tomllib

    task = tomllib.loads((get_tasks_dir() / "comet-native-sdk-recovery/task.toml").read_text())
    assert task["interaction"]["completion_runs"] == [
        {"workflow": "native", "name": "sentence-counting"}
    ]
    assert "Include in the brief a `## Spec → 测试名与断言计划` Markdown table" in (
        get_tasks_dir() / "comet-native-sdk-recovery/instruction.md"
    ).read_text(encoding="utf8")
