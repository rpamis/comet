"""Unit contracts for the Native wave B-F evaluation tasks and validators."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import sys
from pathlib import Path

import yaml
import pytest

from scaffold.python.tasks import load_task
from scaffold.python.validation.native_wave import (
    build_contract_from_change,
    canonical_hash,
    check_archive_transaction,
    check_checkpoint_cas_envelopes,
    check_dashboard_projection,
    check_json_state,
    check_runtime_envelopes,
    parse_scope_bundle,
    parse_verification_bundle,
)


EVAL_ROOT = Path(__file__).resolve().parents[3]
TASKS_ROOT = EVAL_ROOT / "local" / "tasks"
WAVE_TASKS = {
    "comet-native-wave-b-decision-resume": "auto_user",
    "comet-native-wave-c-verification-integrity": "none",
    "comet-native-wave-d-stagnation-stop": "none",
    "comet-native-wave-e-parallel-safety": "none",
    "comet-native-wave-f-dashboard-readonly": "none",
}


def load_validator(task_name: str, filename: str):
    path = TASKS_ROOT / task_name / "validation" / filename
    spec = importlib.util.spec_from_file_location(f"validator_{task_name}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


SNAPSHOT_LIMITS = {
    "maxFiles": 10000,
    "maxFileBytes": 5 * 1024 * 1024,
    "maxTotalBytes": 64 * 1024 * 1024,
    "maxManifestBytes": 1024 * 1024,
}
CHECK_LIMITS = {
    "maxFiles": 256,
    "maxFileBytes": 1024 * 1024,
    "maxTotalBytes": 8 * 1024 * 1024,
    "maxIssues": 128,
}
CHECKER_HASH = "0b8e0e9570269a64123ba2794f1f5125cf454695e1d7fda8f0acddf87ec4912f"


def _file_identity(path: Path) -> dict:
    payload = path.read_bytes()
    return {"hash": hashlib.sha256(payload).hexdigest(), "size": len(payload)}


def _projection(entries: list[dict]) -> tuple[dict, str]:
    value = {
        "schema": "comet.native.content-snapshot-projection.v1",
        "origin": "explicit",
        "complete": True,
        "limits": SNAPSHOT_LIMITS,
        "entries": sorted(entries, key=lambda item: item["path"]),
        "omitted": [],
        "omittedCount": 0,
    }
    return value, canonical_hash("comet.native.content-snapshot-projection.v1", value)


def _unattributed_scope(change: dict) -> dict:
    identity = {
        "kind": "unattributed-change",
        "source": "implementation-scope",
        "path": change["path"],
        "evidence": {
            "after": change["after"],
            "before": change["before"],
            "changeKind": change["kind"],
        },
    }
    return {
        "id": f"scope:{canonical_hash('comet.native.unresolved-scope-id.v1', identity)}",
        "kind": identity["kind"],
        "source": identity["source"],
        "path": identity["path"],
        "reason": f"Changed path is not covered by a declared artifact: {change['path']}",
    }


def write_scope(
    workspace: Path,
    change_root: Path,
    contract_hash: str,
    *,
    partial: bool = False,
) -> tuple[str, dict]:
    project_entries = []
    for name in ("wordcount.py", "test_wordcount.py"):
        path = workspace / name
        if path.is_file():
            identity = _file_identity(path)
            project_entries.append({"path": name, **identity, "type": "file"})
    baseline, baseline_hash = _projection(project_entries)
    current_entries = list(project_entries)
    if partial:
        current_entries.append(
            {"path": "unrelated.txt", "hash": "9" * 64, "size": 1, "type": "file"}
        )
    current, current_hash = _projection(current_entries)
    change = {
        "path": "unrelated.txt",
        "kind": "added",
        "before": None,
        "after": {"hash": "9" * 64, "size": 1},
        "attributedTo": [],
    }
    unresolved = _unattributed_scope(change)
    content = {
        "schema": "comet.native.implementation-scope.v2",
        "contractHash": contract_hash,
        "baselineProjectionRef": f"runtime/evidence/snapshots/{baseline_hash}.json",
        "baselineProjectionHash": baseline_hash,
        "currentProjectionRef": f"runtime/evidence/snapshots/{current_hash}.json",
        "currentProjectionHash": current_hash,
        "complete": not partial,
        "declaredArtifacts": [],
        "changes": [change] if partial else [],
        "unattributed": [change] if partial else [],
        "unresolvedScopes": [unresolved] if partial else [],
        "noCodeReason": None if partial else "No project content changed during this verification.",
    }
    scope_hash = canonical_hash("comet.native.implementation-scope.v2", content)
    scope = {**content, "scopeHash": scope_hash}
    for kind, digest, value in (
        ("snapshots", baseline_hash, baseline),
        ("snapshots", current_hash, current),
        ("scopes", scope_hash, scope),
    ):
        write_json(change_root / f"runtime/evidence/{kind}/{digest}.json", value)
    return f"runtime/evidence/scopes/{scope_hash}.json", scope


def write_contract_artifacts(
    change_root: Path,
    state: dict,
    capability: str,
) -> dict:
    brief = (
        "# Goal\nExercise the Native workflow.\n\n"
        "# Acceptance examples\n- The focused CLI behavior is verified by a project artifact.\n"
    )
    spec = (
        f"# {capability}\n\n## Requirement: Focused behavior\n\n"
        "### Scenario: Focused CLI result\nGiven representative input, the requested output is produced.\n"
    )
    (change_root / f"specs/{capability}").mkdir(parents=True, exist_ok=True)
    (change_root / "brief.md").write_text(brief, encoding="utf-8")
    (change_root / f"specs/{capability}/spec.md").write_text(spec, encoding="utf-8")
    state.update(
        {
            "brief": "brief.md",
            "spec_changes": [
                {
                    "capability": capability,
                    "operation": "create",
                    "source": f"specs/{capability}/spec.md",
                    "base_hash": None,
                }
            ],
        }
    )
    return build_contract_from_change(change_root, state)


def write_check_receipt(
    change_root: Path,
    *,
    change: str,
    source_revision: int,
    contract_hash: str,
    scope: dict,
) -> str:
    selected = [item for item in scope["changes"] if item["after"] is not None]
    checker = {
        "policy": "scoped-text-safety",
        "version": 1,
        "hash": CHECKER_HASH,
        "limits": CHECK_LIMITS,
    }
    input_hash = canonical_hash(
        "comet.native.check-input.v1",
        {
            "change": change,
            "sourceRevision": source_revision,
            "checkerHash": checker["hash"],
            "contractHash": contract_hash,
            "scopeHash": scope["scopeHash"],
            "snapshotHash": scope["currentProjectionHash"],
        },
    )
    content = {
        "schema": "comet.native.check-receipt.v1",
        "change": change,
        "sourceRevision": source_revision,
        "checker": checker,
        "inputHash": input_hash,
        "status": "passed",
        "startedAt": "2026-07-17T00:00:00.000Z",
        "endedAt": "2026-07-17T00:00:01.000Z",
        "contract": {
            "expectedHash": contract_hash,
            "beforeHash": contract_hash,
            "afterHash": contract_hash,
        },
        "implementation": {
            "scopeHash": scope["scopeHash"],
            "expectedSnapshotHash": scope["currentProjectionHash"],
            "beforeSnapshotHash": scope["currentProjectionHash"],
            "afterSnapshotHash": scope["currentProjectionHash"],
        },
        "counts": {
            "filesSelected": len(selected),
            "filesScanned": len(selected),
            "binaryFilesSkipped": 0,
            "bytesScanned": sum(item["after"]["size"] for item in selected),
            "issueCount": 0,
            "recordedIssueCount": 0,
        },
        "issues": [],
        "issuesTruncated": False,
        "stale": False,
        "staleReasons": [],
    }
    receipt_hash = canonical_hash("comet.native.check-receipt.v1", content)
    receipt_ref = f"runtime/evidence/check-receipts/{receipt_hash}.json"
    write_json(change_root / receipt_ref, {**content, "receiptHash": receipt_hash})
    return receipt_ref


def write_verification_bundle(
    workspace: Path,
    change_root: Path,
    state: dict,
    contract: dict,
    *,
    result: str,
    source_revision: int,
    created_at: str,
    partial: bool = False,
    include_receipt: bool = False,
) -> str:
    scope_ref, scope = write_scope(
        workspace, change_root, contract["contractHash"], partial=partial
    )
    allowance_ref = None
    allowance_hash = None
    if partial:
        allowance_content = {
            "schema": "comet.native.partial-allowance.v1",
            "change": state["name"],
            "scopeHash": scope["scopeHash"],
            "scopeIds": [item["id"] for item in scope["unresolvedScopes"]],
            "reason": "The unrelated fixture file is intentionally outside this change.",
            "confirmedSummary": "Confirmed the exact partial scope for this eval.",
            "sourceRevision": source_revision - 1,
            "confirmedAt": "2026-07-17T00:00:00.000Z",
        }
        allowance_hash = canonical_hash("comet.native.partial-allowance.v1", allowance_content)
        allowance = {**allowance_content, "allowanceHash": allowance_hash}
        allowance_ref = f"runtime/evidence/allowances/{allowance_hash}.json"
        write_json(change_root / allowance_ref, allowance)
    report_ref = f"verification-{source_revision}.md"
    report_text = (
        "\n".join(
            f"acceptance_id: {criterion['id']}\nevidence: project file"
            for criterion in contract["acceptance"]
        )
        + "\n"
    )
    (change_root / report_ref).write_text(report_text, encoding="utf-8")
    report_bytes = (change_root / report_ref).read_bytes()
    report_hash = hashlib.sha256(report_bytes).hexdigest()
    write_json(
        change_root / f"runtime/evidence/reports/{report_hash}.json",
        {
            "schema": "comet.native.verification-report.v1",
            "reportHash": report_hash,
            "content": report_bytes.decode("utf-8"),
        },
    )
    entries = []
    evidence_files = ["test_wordcount.py", "wordcount.py"]
    for index, criterion in enumerate(contract["acceptance"]):
        entries.append(
            {
                "acceptanceId": criterion["id"],
                "kind": criterion["kind"],
                "source": criterion["source"],
                "evidenceRefs": [evidence_files[index % len(evidence_files)]],
                "skippedReason": None,
            }
        )
    entries.sort(key=lambda item: item["acceptanceId"])
    trace_content = {
        "schema": "comet.native.acceptance-trace.v1",
        "nativeRootRef": "docs/comet",
        "criteriaHash": contract["acceptanceHash"],
        "total": len(entries),
        "evidenced": len(entries),
        "skipped": 0,
        "entries": entries,
    }
    trace = {
        **trace_content,
        "traceHash": canonical_hash("comet.native.acceptance-trace.v1", trace_content),
    }
    receipt_ref = (
        write_check_receipt(
            change_root,
            change=state["name"],
            source_revision=source_revision,
            contract_hash=contract["contractHash"],
            scope=scope,
        )
        if include_receipt
        else None
    )
    envelope_content = {
        "schema": "comet.native.verification-evidence.v1",
        "change": state["name"],
        "sourceRevision": source_revision,
        "result": result,
        "freshness": "partial" if partial else "complete",
        "contractHash": contract["contractHash"],
        "acceptanceCriteriaHash": contract["acceptanceHash"],
        "implementationScopeRef": scope_ref,
        "implementationScopeHash": scope["scopeHash"],
        "reportRef": report_ref,
        "reportHash": report_hash,
        "acceptanceTrace": trace,
        "partialAllowanceRef": allowance_ref,
        "partialAllowanceHash": allowance_hash,
        "receiptRef": receipt_ref,
        "createdAt": created_at,
    }
    envelope_hash = canonical_hash("comet.native.verification-evidence.v1", envelope_content)
    ref = f"runtime/evidence/verifications/{envelope_hash}.json"
    write_json(change_root / ref, {**envelope_content, "envelopeHash": envelope_hash})
    return ref


def write_archive_transaction(
    workspace: Path,
    transaction_id: str,
    change: str,
    preflight_hash: str,
) -> None:
    target = f"archive/2026-07-17-{change}"
    write_json(
        workspace / "docs/comet/runtime/transactions" / transaction_id / "transaction.json",
        {
            "schema": "comet.native.transaction.v2",
            "id": transaction_id,
            "kind": "archive",
            "status": "committed",
            "change": change,
            "createdAt": "2026-07-17T00:00:00.000Z",
            "preflightHash": preflight_hash,
            "operations": [
                {
                    "id": "archive-change",
                    "type": "move",
                    "source": f"changes/{change}",
                    "target": target,
                    "expectedSourceHash": "d" * 64,
                    "expectedTargetHash": None,
                }
            ],
        },
    )
    events = [
        ("prepared", None),
        ("operation-started", "archive-change"),
        ("operation-completed", "archive-change"),
        ("archive-finalization-started", None),
        ("archive-finalized", None),
        ("commit", None),
    ]
    event_file = workspace / "docs/comet/runtime/transactions" / transaction_id / "events.jsonl"
    event_file.write_text(
        "\n".join(
            json.dumps(
                {
                    "sequence": index,
                    "timestamp": "2026-07-17T00:00:00.000Z",
                    "type": event_type,
                    **({"operationId": operation_id} if operation_id else {}),
                }
            )
            for index, (event_type, operation_id) in enumerate(events, 1)
        )
        + "\n",
        encoding="utf-8",
    )


def test_wave_tasks_use_the_native_skill_contract_and_executable_validators():
    runtime = EVAL_ROOT.parent / "assets/skills/comet-native/scripts/comet-native-runtime.mjs"
    assert runtime.is_file()
    for name, interaction_mode in WAVE_TASKS.items():
        task = load_task(name)
        assert task.default_treatments == ["COMET_NATIVE_PHASE1"]
        assert (task.environment_dir / "Dockerfile").is_file()
        assert (task.environment_dir / "wordcount.py").is_file()
        assert (task.environment_dir / "test_wordcount.py").is_file()
        assert task.config.evaluation.profile == "generic"
        assert task.config.evaluation.required_skills == ["comet-native"]
        assert task.config.evaluation.require_skill_invocation is True
        assert task.config.interaction.mode == interaction_mode
        assert task.load_validators()
        prompt = task.render_prompt()
        assert "`/comet-native` Skill" in prompt
        assert "Do not fabricate" in prompt
        assert ".cache/comet-native-eval" in prompt
        assert "eval-evidence" not in prompt


def test_wave_tasks_are_registered_in_the_local_index():
    index = yaml.safe_load((TASKS_ROOT / "index.yaml").read_text(encoding="utf-8"))
    indexed = {entry["name"] for entry in index["tasks"]}
    assert set(WAVE_TASKS).issubset(indexed)


def test_wave_f_requests_a_current_checkout_cli_snapshot():
    environment = TASKS_ROOT / "comet-native-wave-f-dashboard-readonly/environment"
    assert (environment / ".include-current-comet-cli").is_file()
    dockerfile = (environment / "Dockerfile").read_text(encoding="utf-8")
    wrapper = (environment / "current-comet.sh").read_text(encoding="utf-8")
    prompt = load_task("comet-native-wave-f-dashboard-readonly").render_prompt()

    assert "FROM node:22" in dockerfile
    assert "npm install --prefix /opt/comet-cli" in dockerfile
    assert "/workspace/_eval_current_comet" in wrapper
    assert 'runtime="$(mktemp -d)"' in wrapper
    assert '"$snapshot/node_modules"' not in wrapper
    docker_harness = (EVAL_ROOT / "scaffold/shell/docker.sh").read_text(encoding="utf-8")
    assert "_eval_current_comet:ro" in docker_harness
    assert "current-comet.sh dashboard . --json" in prompt


def test_wave_f_current_checkout_dependency_snapshot_matches_package_runtime_dependencies():
    """Keep the eval image's installed runtime dependencies in lockstep with Comet."""
    package = json.loads((EVAL_ROOT.parent / "package.json").read_text(encoding="utf-8"))
    snapshot = json.loads(
        (
            TASKS_ROOT
            / "comet-native-wave-f-dashboard-readonly/environment/current-comet-package.json"
        ).read_text(encoding="utf-8")
    )

    assert snapshot.get("private") is True
    assert snapshot.get("type") == package.get("type")
    assert snapshot.get("dependencies") == package.get("dependencies")


def test_current_cli_snapshot_helper_source_builds_checkout(monkeypatch, tmp_path: Path):
    eval_conftest = sys.modules["conftest"]
    checkout = tmp_path / "checkout"
    (checkout / "bin").mkdir(parents=True)
    (checkout / "bin/comet.js").write_text("import '../dist/index.js';\n", encoding="utf-8")
    (checkout / "package.json").write_text('{"type":"module"}\n', encoding="utf-8")
    environment = tmp_path / "environment"
    environment.mkdir()
    (environment / ".include-current-comet-cli").write_text("include\n", encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setattr(eval_conftest, "REPOSITORY_ROOT", checkout)

    def fake_source_build(_checkout: Path, output: Path) -> str:
        (output / "app/cli").mkdir(parents=True)
        (output / "domains/dashboard").mkdir(parents=True)
        (output / "app/cli/index.js").write_text("export {};\n", encoding="utf-8")
        (output / "domains/dashboard/native-adapter.js").write_text(
            "export const schema = 'native';\n", encoding="utf-8"
        )
        return "5.9.3"

    monkeypatch.setattr(eval_conftest, "_build_current_comet_dist", fake_source_build)

    eval_conftest._copy_current_comet_cli_snapshot(environment, workspace)

    snapshot = workspace / "_eval_current_comet"
    assert (snapshot / "bin/comet.js").is_file()
    assert (snapshot / "dist/app/cli/index.js").is_file()
    assert (snapshot / "dist/domains/dashboard/native-adapter.js").is_file()
    assert (snapshot / "package.json").is_file()
    identity = json.loads((snapshot / "build-identity.json").read_text(encoding="utf-8"))
    assert identity["schema"] == "comet.eval.current-comet-build.v1"
    assert identity["sourceFileCount"] >= 2
    assert identity["snapshotFileCount"] >= 4


def test_controller_snapshots_native_runtime_for_readonly_oracle(tmp_path: Path):
    eval_conftest = sys.modules["conftest"]
    environment = tmp_path / "environment"
    environment.mkdir()
    (environment / ".include-trusted-native-runtime").write_text("include\n", encoding="utf-8")
    skill_source = tmp_path / "skill/comet-native"
    runtime = skill_source / "scripts/comet-native-runtime.mjs"
    runtime.parent.mkdir(parents=True)
    runtime.write_text("export const trusted = true;\n", encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    eval_conftest._copy_trusted_native_runtime_snapshot(
        environment,
        workspace,
        {"comet-native": {"source_dir": skill_source}},
    )

    oracle = workspace / "_eval_trusted_oracles/comet-native-runtime.mjs"
    identity = json.loads(
        (workspace / "_eval_trusted_oracles/native-runtime-identity.json").read_text(
            encoding="utf-8"
        )
    )
    assert oracle.read_bytes() == runtime.read_bytes()
    assert identity == {
        "schema": "comet.eval.trusted-native-runtime.v1",
        "runtimeFile": oracle.name,
        "runtimeHash": hashlib.sha256(oracle.read_bytes()).hexdigest(),
    }
    docker_harness = (EVAL_ROOT / "scaffold/shell/docker.sh").read_text(encoding="utf-8")
    assert "_eval_trusted_oracles:ro" in docker_harness


def test_controller_source_build_contains_current_native_dashboard_adapter(tmp_path: Path):
    eval_conftest = sys.modules["conftest"]
    output = tmp_path / "dist"

    version = eval_conftest._build_current_comet_dist(EVAL_ROOT.parent, output)

    assert version
    assert (output / "app/cli/index.js").is_file()
    assert (output / "domains/dashboard/native-adapter.js").is_file()


def test_wave_b_prompt_hides_the_normalization_decision_and_requires_disk_resume():
    task = load_task("comet-native-wave-b-decision-resume")
    prompt = task.render_prompt()

    assert "case-insensitive" not in prompt.lower()
    assert "strip surrounding punctuation" not in prompt.lower()
    assert "distinct normalized word values" in prompt.lower()
    assert "words that occur exactly once" in prompt.lower()
    assert task.config.interaction.decision_reply == (
        "Treat words case-insensitively, strip surrounding punctuation, and preserve internal apostrophes."
    )
    continuation = task.config.interaction.continue_prompt.lower()
    assert "context-cleared continuation" in continuation
    assert "invoke `/comet-native`" in continuation
    assert "first bash command" in continuation
    assert "before any read, edit, test, or transition" in continuation
    assert "status add-unique-counting --json" in continuation
    assert "archive-preview.json" in continuation
    assert "archive-commit.json" in continuation
    assert "--dry-run --json" in continuation
    assert "--expect-preflight" in continuation
    assert "redirect stdout directly" in continuation
    assert "exactly once" in continuation
    assert "never overwrite" in continuation
    assert "do not reconstruct" in continuation
    assert task.config.interaction.fresh_resume_marker == "COMET_NATIVE_COLD_RESUME_READY"
    assert "deliberately omits" not in prompt.lower()
    assert "redirect stdout directly" in prompt.lower()
    assert "verify all three files exist" in prompt.lower()
    assert "do not rely on terminal output" in prompt.lower()
    assert "before invoking either archive command" in prompt.lower()
    assert "must itself redirect stdout" in prompt.lower()


def test_shared_wave_helpers_recognize_state_cas_and_readonly_projection(tmp_path: Path):
    status_file = tmp_path / "status.json"
    write_json(
        status_file,
        {"command": "status", "exitCode": 0, "data": {"freshness": "stale"}},
    )
    assert check_json_state(status_file, "stale")["status"] == "passed"
    assert check_json_state(status_file, "partial")["status"] == "failed"
    assert check_runtime_envelopes([status_file])["status"] == "passed"

    attempt_a = tmp_path / "checkpoint-attempt-a.json"
    write_json(
        attempt_a,
        {
            "command": "checkpoint",
            "exitCode": 0,
            "data": {
                "change": {"name": "normalize-case", "revision": 8},
                "expectedRevision": 7,
                "previousRevision": 7,
                "revision": 8,
                "outcome": "recorded",
            },
        },
    )
    attempt_b = tmp_path / "checkpoint-attempt-b.json"
    write_json(
        attempt_b,
        {
            "command": "checkpoint",
            "exitCode": 73,
            "data": {
                "change": "normalize-case",
                "expectedRevision": 7,
                "actualRevision": 8,
                "outcome": "revision-conflict",
            },
        },
    )
    assert check_checkpoint_cas_envelopes([attempt_a, attempt_b])["status"] == "passed"
    write_json(
        attempt_b,
        {
            "command": "checkpoint",
            "exitCode": 73,
            "data": {
                "change": "normalize-case",
                "expectedRevision": 7,
                "actualRevision": 9,
                "outcome": "revision-conflict",
            },
        },
    )
    assert check_checkpoint_cas_envelopes([attempt_a, attempt_b])["status"] == "failed"

    cli_file = tmp_path / "cli.json"
    dashboard_file = tmp_path / "dashboard.json"
    projection = {
        "name": "add-unique-counting",
        "phase": "build",
        "nextAction": "continue",
        "verificationResult": "pending",
    }
    write_json(cli_file, {"data": projection})
    write_json(dashboard_file, {"snapshot": {"changes": [projection]}})
    assert check_dashboard_projection(cli_file, dashboard_file)["status"] == "passed"

    dashboard_projection = {
        **projection,
        "selected": True,
        "findings": {
            "total": 1,
            "errors": 0,
            "warnings": 1,
            "info": 0,
            "requiresUserDecision": False,
            "codes": ["workspace-root-changed"],
            "truncated": False,
        },
        "continuation": {
            "disposition": "continue",
            "action": "work-phase",
            "command": 'comet native next add-unique-counting --summary "<summary>"',
            "requiresUserDecision": False,
            "requiredInputs": ["summary"],
            "requiredInputsTruncated": False,
        },
    }
    cli_projection = {**dashboard_projection}
    cli_projection["findingSummary"] = cli_projection.pop("findings")
    write_json(cli_file, {"data": cli_projection})
    write_json(dashboard_file, {"snapshot": {"changes": [dashboard_projection]}})
    assert check_dashboard_projection(cli_file, dashboard_file)["status"] == "passed"

    dashboard_projection["selected"] = False
    write_json(dashboard_file, {"snapshot": {"changes": [dashboard_projection]}})
    assert check_dashboard_projection(cli_file, dashboard_file)["status"] == "failed"
    dashboard_projection["selected"] = True
    dashboard_projection["findings"] = {
        **cli_projection["findingSummary"],
        "warnings": 0,
    }
    write_json(dashboard_file, {"snapshot": {"changes": [dashboard_projection]}})
    assert check_dashboard_projection(cli_file, dashboard_file)["status"] == "failed"
    dashboard_projection["findings"] = cli_projection["findingSummary"]
    write_json(
        dashboard_file,
        {"snapshot": {"changes": [dashboard_projection, {**projection, "name": "extra"}]}},
    )
    assert check_dashboard_projection(cli_file, dashboard_file)["status"] == "failed"


def test_wave_b_validator_accepts_one_confirmed_archive_and_resume_snapshot(tmp_path: Path):
    validator = load_validator(
        "comet-native-wave-b-decision-resume", "test_native_wave_b_decision_resume.py"
    )
    validator.WORKSPACE = tmp_path
    archived = tmp_path / "docs/comet/archive/2026-07-17-add-unique-counting"
    (archived / "runtime").mkdir(parents=True)
    (archived / "specs/unique-word-counting").mkdir(parents=True)
    (tmp_path / "docs/comet/changes").mkdir(parents=True)
    canonical = tmp_path / "docs/comet/specs/unique-word-counting/spec.md"
    canonical.parent.mkdir(parents=True)
    state = {
        "name": "add-unique-counting",
        "phase": "archive",
        "approval": "confirmed",
        "archived": True,
        "verification_result": "pass",
    }
    (archived / "comet-state.yaml").write_text(yaml.safe_dump(state), encoding="utf-8")
    decision = (
        "Case-fold tokens with str.lower(), strip punctuation from the start and end of each "
        "token. Internal punctuation is preserved; apostrophes are not removed."
    )
    (archived / "brief.md").write_text(f"# Decisions\n{decision}\n", encoding="utf-8")
    (archived / "specs/unique-word-counting/spec.md").write_text(decision, encoding="utf-8")
    canonical.write_text(decision, encoding="utf-8")
    write_json(
        tmp_path / ".cache/comet-native-eval/resume-status.json",
        {
            "command": "status",
            "exitCode": 0,
            "data": {"name": "add-unique-counting", "phase": "build"},
        },
    )
    preflight_hash = "a" * 64
    transaction_id = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"
    write_json(
        tmp_path / ".cache/comet-native-eval/archive-preview.json",
        {
            "command": "archive --dry-run",
            "exitCode": 0,
            "data": {
                "ready": True,
                "evidenceFreshness": "complete",
                "findingCodes": [],
                "preflightHash": preflight_hash,
            },
        },
    )
    write_json(
        tmp_path / ".cache/comet-native-eval/archive-commit.json",
        {
            "command": "archive",
            "exitCode": 0,
            "data": {
                "preflightHash": preflight_hash,
                "transactionId": transaction_id,
            },
        },
    )
    write_archive_transaction(
        tmp_path,
        transaction_id,
        "add-unique-counting",
        preflight_hash,
    )
    write_json(
        tmp_path / "_test_context.json",
        {
            "interaction": {
                "mode": "auto_user",
                "decision_points": 1,
                "deterministic_replies": 1,
                "fresh_resume_boundaries": 1,
                "actual_turns": 2,
                "max_turns": 4,
            }
        },
    )

    assert validator.check_decision_and_resume()["status"] == "passed"


def test_wave_c_validator_requires_bound_partial_stale_and_complete_archive(tmp_path: Path):
    validator = load_validator(
        "comet-native-wave-c-verification-integrity",
        "test_native_wave_c_verification_integrity.py",
    )
    validator.WORKSPACE = tmp_path
    for name in ("wordcount.py", "test_wordcount.py"):
        source = TASKS_ROOT / "comet-native-wave-c-verification-integrity/environment" / name
        (tmp_path / name).write_bytes(source.read_bytes())
    evidence = tmp_path / ".cache/comet-native-eval"
    archive = tmp_path / "docs/comet/archive/2026-07-17-add-longest-word"
    archive.mkdir(parents=True)
    state = {
        "name": "add-longest-word",
        "phase": "archive",
        "archived": True,
        "verification_result": "pass",
    }
    contract = write_contract_artifacts(archive, state, "longest-word")
    partial_ref = write_verification_bundle(
        tmp_path,
        archive,
        state,
        contract,
        result="pass",
        source_revision=5,
        created_at="2026-07-17T00:00:05.000Z",
        partial=True,
    )
    partial_envelope = json.loads((archive / partial_ref).read_text(encoding="utf-8"))
    partial_hash = partial_envelope["implementationScopeHash"]
    final_ref = write_verification_bundle(
        tmp_path,
        archive,
        state,
        contract,
        result="pass",
        source_revision=9,
        created_at="2026-07-17T00:00:09.000Z",
        include_receipt=True,
    )
    state["verification_evidence"] = final_ref
    (archive / "comet-state.yaml").write_text(yaml.safe_dump(state), encoding="utf-8")
    stale_hash = "b" * 64
    final_hash = "c" * 64
    transaction_id = "cccccccc-1111-2222-3333-dddddddddddd"
    write_json(
        evidence / "partial-scope.json",
        {
            "command": "next",
            "exitCode": 65,
            "data": {
                "next": "manual",
                "preparedScope": {
                    "complete": False,
                    "unresolvedScopeCount": 1,
                    "scopeHash": partial_hash,
                },
                "findings": [{"code": "verification-scope-partial"}],
            },
        },
    )
    write_json(
        evidence / "partial-archive-preview.json",
        {
            "command": "archive --dry-run",
            "exitCode": 0,
            "data": {
                "ready": True,
                "evidenceFreshness": "partial",
                "findingCodes": [],
                "preflightHash": partial_hash,
            },
        },
    )
    write_json(
        evidence / "stale-status.json",
        {
            "command": "status",
            "exitCode": 0,
            "data": {
                "phase": "archive",
                "archiveReady": False,
                "findingSummary": {"codes": ["verification-evidence-stale"]},
            },
        },
    )
    stale_preview = {
        "ready": False,
        "evidenceFreshness": "stale",
        "findingCodes": ["verification-evidence-stale"],
        "preflightHash": stale_hash,
    }
    write_json(
        evidence / "stale-archive-preview.json",
        {"command": "archive --dry-run", "exitCode": 0, "data": stale_preview},
    )
    write_json(
        evidence / "stale-archive-commit.json",
        {
            "command": "archive",
            "exitCode": 73,
            "data": stale_preview,
            "error": {"code": "conflict", "message": "Archive preflight changed"},
        },
    )
    final_preview = {
        "ready": True,
        "evidenceFreshness": "complete",
        "findingCodes": [],
        "preflightHash": final_hash,
    }
    write_json(
        evidence / "final-archive-preview.json",
        {"command": "archive --dry-run", "exitCode": 0, "data": final_preview},
    )
    write_json(
        evidence / "archive-commit.json",
        {
            "command": "archive",
            "exitCode": 0,
            "data": {
                "preflightHash": final_hash,
                "transactionId": transaction_id,
            },
        },
    )
    write_archive_transaction(tmp_path, transaction_id, "add-longest-word", final_hash)
    (archive / "runtime/trajectory.jsonl").write_text(
        "\n".join(
            json.dumps(
                {
                    "sequence": index,
                    "timestamp": "2026-07-17T00:00:00.000Z",
                    "runId": "verification-run",
                    "type": "state_transitioned",
                    "data": {
                        "previousPhase": previous,
                        "nextPhase": next_phase,
                    },
                }
            )
            for index, (previous, next_phase) in enumerate(
                [
                    ("shape", "build"),
                    ("build", "verify"),
                    ("verify", "archive"),
                    ("archive", "build"),
                    ("build", "verify"),
                    ("verify", "archive"),
                    ("archive", None),
                ],
                1,
            )
        )
        + "\n",
        encoding="utf-8",
    )
    (tmp_path / "docs/comet/changes").mkdir(parents=True)

    result = validator.check_verification_integrity()
    assert result["status"] == "passed", result

    partial_scope_path = evidence / "partial-scope.json"
    partial_scope = json.loads(partial_scope_path.read_text(encoding="utf-8"))
    partial_scope["data"]["preparedScope"]["unresolvedScopeCount"] = 2
    write_json(partial_scope_path, partial_scope)
    result = validator.check_verification_integrity()
    assert result["status"] == "failed", result
    assert "count" in result["reason"].lower()


def test_verification_parser_rejects_forged_acceptance_ids_and_hash_corruption(tmp_path: Path):
    for name in ("wordcount.py", "test_wordcount.py"):
        source = TASKS_ROOT / "comet-native-wave-c-verification-integrity/environment" / name
        (tmp_path / name).write_bytes(source.read_bytes())
    root = tmp_path / "docs/comet/changes/strict-evidence"
    root.mkdir(parents=True)
    state = {"name": "strict-evidence", "phase": "archive", "verification_result": "pass"}
    contract = write_contract_artifacts(root, state, "strict-evidence")
    ref = write_verification_bundle(
        tmp_path,
        root,
        state,
        contract,
        result="pass",
        source_revision=3,
        created_at="2026-07-17T00:00:03.000Z",
    )
    parse_verification_bundle(
        project_root=tmp_path,
        change_root=root,
        evidence_ref=ref,
        state=state,
        verify_current_files=True,
    )

    envelope = json.loads((root / ref).read_text(encoding="utf-8"))
    envelope["acceptanceTrace"]["entries"][0]["acceptanceId"] = f"acceptance-{'0' * 64}"
    trace_content = {
        key: value for key, value in envelope["acceptanceTrace"].items() if key != "traceHash"
    }
    envelope["acceptanceTrace"]["traceHash"] = canonical_hash(
        "comet.native.acceptance-trace.v1", trace_content
    )
    content = {key: value for key, value in envelope.items() if key != "envelopeHash"}
    forged_hash = canonical_hash("comet.native.verification-evidence.v1", content)
    envelope["envelopeHash"] = forged_hash
    forged_ref = f"runtime/evidence/verifications/{forged_hash}.json"
    write_json(root / forged_ref, envelope)
    with pytest.raises(ValueError, match="contract|forged"):
        parse_verification_bundle(
            project_root=tmp_path,
            change_root=root,
            evidence_ref=forged_ref,
            state=state,
        )

    original = json.loads((root / ref).read_text(encoding="utf-8"))
    (root / original["reportRef"]).write_text("tampered report\n", encoding="utf-8")
    with pytest.raises(ValueError, match="report content hash"):
        parse_verification_bundle(
            project_root=tmp_path,
            change_root=root,
            evidence_ref=ref,
            state=state,
            verify_current_files=True,
        )


def test_scope_parser_rejects_runtime_impossible_self_consistent_unresolved_scope(
    tmp_path: Path,
):
    for name in ("wordcount.py", "test_wordcount.py"):
        source = TASKS_ROOT / "comet-native-wave-c-verification-integrity/environment" / name
        (tmp_path / name).write_bytes(source.read_bytes())
    root = tmp_path / "docs/comet/changes/forged-scope"
    root.mkdir(parents=True)
    scope_ref, _ = write_scope(tmp_path, root, "1" * 64, partial=True)
    parse_scope_bundle(root, scope_ref)

    scope = json.loads((root / scope_ref).read_text(encoding="utf-8"))
    forged_identity = {
        "kind": "snapshot-omission",
        "source": "baseline",
        "path": "unrelated.txt",
        "evidence": {"reason": "unreadable", "size": 1, "type": "file"},
    }
    scope["unresolvedScopes"] = [
        {
            "id": (
                "scope:" + canonical_hash("comet.native.unresolved-scope-id.v1", forged_identity)
            ),
            "kind": forged_identity["kind"],
            "source": forged_identity["source"],
            "path": forged_identity["path"],
            "reason": "baseline snapshot omitted unrelated.txt: unreadable",
        }
    ]
    content = {key: value for key, value in scope.items() if key != "scopeHash"}
    scope_hash = canonical_hash("comet.native.implementation-scope.v2", content)
    scope["scopeHash"] = scope_hash
    forged_ref = f"runtime/evidence/scopes/{scope_hash}.json"
    write_json(root / forged_ref, scope)

    with pytest.raises(ValueError, match="unresolved|scope"):
        parse_scope_bundle(root, forged_ref)


def test_scope_parser_derives_omission_scopes_from_snapshot_facts(tmp_path: Path):
    for name in ("wordcount.py", "test_wordcount.py"):
        source = TASKS_ROOT / "comet-native-wave-c-verification-integrity/environment" / name
        (tmp_path / name).write_bytes(source.read_bytes())
    root = tmp_path / "docs/comet/changes/omitted-scope"
    root.mkdir(parents=True)
    scope_ref, _ = write_scope(tmp_path, root, "2" * 64, partial=True)

    scope = json.loads((root / scope_ref).read_text(encoding="utf-8"))
    baseline_ref = scope["baselineProjectionRef"]
    baseline = json.loads((root / baseline_ref).read_text(encoding="utf-8"))
    baseline.update(
        {
            "complete": False,
            "omitted": [
                {
                    "path": "too-large.bin",
                    "size": 10,
                    "type": "file",
                    "reason": "file-size",
                }
            ],
            "omittedCount": 1,
        }
    )
    baseline_hash = canonical_hash("comet.native.content-snapshot-projection.v1", baseline)
    baseline_ref = f"runtime/evidence/snapshots/{baseline_hash}.json"
    write_json(root / baseline_ref, baseline)
    scope["baselineProjectionHash"] = baseline_hash
    scope["baselineProjectionRef"] = baseline_ref
    omission_identity = {
        "kind": "snapshot-omission",
        "source": "baseline",
        "path": "too-large.bin",
        "evidence": {"reason": "file-size", "size": 10, "type": "file"},
    }
    incomplete_identity = {
        "kind": "snapshot-incomplete",
        "source": "baseline",
        "path": None,
        "evidence": {"omittedCount": 1},
    }
    derived = [
        {
            "id": (
                "scope:" + canonical_hash("comet.native.unresolved-scope-id.v1", omission_identity)
            ),
            "kind": "snapshot-omission",
            "source": "baseline",
            "path": "too-large.bin",
            "reason": "baseline snapshot omitted too-large.bin: file-size",
        },
        {
            "id": (
                "scope:"
                + canonical_hash("comet.native.unresolved-scope-id.v1", incomplete_identity)
            ),
            "kind": "snapshot-incomplete",
            "source": "baseline",
            "path": None,
            "reason": "baseline snapshot is incomplete",
        },
    ]
    original_unresolved = scope["unresolvedScopes"]
    scope["unresolvedScopes"] = sorted(
        [*original_unresolved, *derived],
        key=lambda item: (
            item["kind"],
            item["source"],
            (0, "") if item["path"] is None else (1, item["path"]),
            item["id"],
        ),
    )
    content = {key: value for key, value in scope.items() if key != "scopeHash"}
    scope_hash = canonical_hash("comet.native.implementation-scope.v2", content)
    scope["scopeHash"] = scope_hash
    valid_ref = f"runtime/evidence/scopes/{scope_hash}.json"
    write_json(root / valid_ref, scope)
    parse_scope_bundle(root, valid_ref)

    scope["unresolvedScopes"] = original_unresolved
    content = {key: value for key, value in scope.items() if key != "scopeHash"}
    scope_hash = canonical_hash("comet.native.implementation-scope.v2", content)
    scope["scopeHash"] = scope_hash
    forged_ref = f"runtime/evidence/scopes/{scope_hash}.json"
    write_json(root / forged_ref, scope)

    with pytest.raises(ValueError, match="omission|unresolved|scope"):
        parse_scope_bundle(root, forged_ref)


@pytest.mark.parametrize(
    "forgery",
    [
        "change",
        "revision",
        "checker",
        "contract",
        "implementation",
        "coverage",
        "issue-counts",
        "issue-order",
    ],
)
def test_verification_parser_rejects_self_consistent_forged_check_receipts(
    tmp_path: Path,
    forgery: str,
):
    for name in ("wordcount.py", "test_wordcount.py"):
        source = TASKS_ROOT / "comet-native-wave-c-verification-integrity/environment" / name
        (tmp_path / name).write_bytes(source.read_bytes())
    root = tmp_path / "docs/comet/changes/receipt-bound"
    root.mkdir(parents=True)
    state = {"name": "receipt-bound", "phase": "archive", "verification_result": "pass"}
    contract = write_contract_artifacts(root, state, "receipt-bound")
    ref = write_verification_bundle(
        tmp_path,
        root,
        state,
        contract,
        result="pass",
        source_revision=3,
        created_at="2026-07-17T00:00:03.000Z",
        include_receipt=True,
    )
    parse_verification_bundle(
        project_root=tmp_path,
        change_root=root,
        evidence_ref=ref,
        state=state,
        verify_current_files=True,
    )

    envelope = json.loads((root / ref).read_text(encoding="utf-8"))
    receipt = json.loads((root / envelope["receiptRef"]).read_text(encoding="utf-8"))
    if forgery == "change":
        receipt["change"] = "other-change"
    elif forgery == "revision":
        receipt["sourceRevision"] += 1
    elif forgery == "checker":
        receipt["checker"] = {
            "policy": "forged-policy",
            "version": 2,
            "hash": "f" * 64,
            "limits": CHECK_LIMITS,
        }
    elif forgery == "contract":
        receipt["contract"] = {
            "expectedHash": "a" * 64,
            "beforeHash": "a" * 64,
            "afterHash": "a" * 64,
        }
    elif forgery == "implementation":
        receipt["implementation"] = {
            "scopeHash": "b" * 64,
            "expectedSnapshotHash": "c" * 64,
            "beforeSnapshotHash": "c" * 64,
            "afterSnapshotHash": "c" * 64,
        }
    elif forgery == "coverage":
        receipt["counts"].update({"filesSelected": 1, "filesScanned": 1})
    elif forgery == "issue-counts":
        receipt["status"] = "failed"
        receipt["counts"].update({"issueCount": 1, "recordedIssueCount": 1})
        receipt["issuesTruncated"] = True
    elif forgery == "issue-order":
        receipt["status"] = "failed"
        receipt["counts"].update({"issueCount": 2, "recordedIssueCount": 2})
        receipt["issues"] = [
            {"path": "z.py", "line": 2, "kind": "trailing-whitespace"},
            {"path": "a.py", "line": 1, "kind": "conflict-marker"},
        ]

    receipt["inputHash"] = canonical_hash(
        "comet.native.check-input.v1",
        {
            "change": receipt["change"],
            "sourceRevision": receipt["sourceRevision"],
            "checkerHash": receipt["checker"]["hash"],
            "contractHash": receipt["contract"]["expectedHash"],
            "scopeHash": receipt["implementation"]["scopeHash"],
            "snapshotHash": receipt["implementation"]["expectedSnapshotHash"],
        },
    )
    receipt_content = {key: value for key, value in receipt.items() if key != "receiptHash"}
    receipt_hash = canonical_hash("comet.native.check-receipt.v1", receipt_content)
    receipt["receiptHash"] = receipt_hash
    receipt_ref = f"runtime/evidence/check-receipts/{receipt_hash}.json"
    write_json(root / receipt_ref, receipt)
    envelope["receiptRef"] = receipt_ref
    envelope_content = {key: value for key, value in envelope.items() if key != "envelopeHash"}
    envelope_hash = canonical_hash("comet.native.verification-evidence.v1", envelope_content)
    envelope["envelopeHash"] = envelope_hash
    forged_ref = f"runtime/evidence/verifications/{envelope_hash}.json"
    write_json(root / forged_ref, envelope)

    with pytest.raises(ValueError, match="receipt|checker|coverage|issue"):
        parse_verification_bundle(
            project_root=tmp_path,
            change_root=root,
            evidence_ref=forged_ref,
            state=state,
            verify_current_files=True,
        )


def test_verification_parser_rejects_receipt_content_hash_corruption(tmp_path: Path):
    for name in ("wordcount.py", "test_wordcount.py"):
        source = TASKS_ROOT / "comet-native-wave-c-verification-integrity/environment" / name
        (tmp_path / name).write_bytes(source.read_bytes())
    root = tmp_path / "docs/comet/changes/receipt-hash"
    root.mkdir(parents=True)
    state = {"name": "receipt-hash", "phase": "archive", "verification_result": "pass"}
    contract = write_contract_artifacts(root, state, "receipt-hash")
    ref = write_verification_bundle(
        tmp_path,
        root,
        state,
        contract,
        result="pass",
        source_revision=4,
        created_at="2026-07-17T00:00:04.000Z",
        include_receipt=True,
    )
    envelope = json.loads((root / ref).read_text(encoding="utf-8"))
    receipt_path = root / envelope["receiptRef"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["endedAt"] = "2026-07-17T00:00:02.000Z"
    write_json(receipt_path, receipt)

    with pytest.raises(ValueError, match="receipt|content hash"):
        parse_verification_bundle(
            project_root=tmp_path,
            change_root=root,
            evidence_ref=ref,
            state=state,
            verify_current_files=True,
        )


def test_archive_transaction_rejects_reordered_durable_events(tmp_path: Path):
    archive = tmp_path / "docs/comet/archive/2026-07-17-transaction-check"
    archive.mkdir(parents=True)
    transaction_id = "dddddddd-1111-2222-3333-eeeeeeeeeeee"
    preflight = "f" * 64
    write_archive_transaction(tmp_path, transaction_id, "transaction-check", preflight)
    commit = {"transactionId": transaction_id, "preflightHash": preflight}
    assert (
        check_archive_transaction(tmp_path, commit, "transaction-check", preflight)["status"]
        == "passed"
    )
    events = tmp_path / f"docs/comet/runtime/transactions/{transaction_id}/events.jsonl"
    lines = events.read_text(encoding="utf-8").splitlines()
    lines[1], lines[2] = lines[2], lines[1]
    events.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert (
        check_archive_transaction(tmp_path, commit, "transaction-check", preflight)["status"]
        == "failed"
    )


def test_verification_parser_rejects_symlinked_evidence_documents(tmp_path: Path):
    for name in ("wordcount.py", "test_wordcount.py"):
        source = TASKS_ROOT / "comet-native-wave-c-verification-integrity/environment" / name
        (tmp_path / name).write_bytes(source.read_bytes())
    root = tmp_path / "docs/comet/changes/symlink-evidence"
    root.mkdir(parents=True)
    state = {"name": "symlink-evidence", "phase": "archive", "verification_result": "pass"}
    contract = write_contract_artifacts(root, state, "symlink-evidence")
    ref = write_verification_bundle(
        tmp_path,
        root,
        state,
        contract,
        result="pass",
        source_revision=3,
        created_at="2026-07-17T00:00:03.000Z",
    )
    envelope = json.loads((root / ref).read_text(encoding="utf-8"))
    report = root / envelope["reportRef"]
    outside = tmp_path / "outside-report.md"
    outside.write_bytes(report.read_bytes())
    report.unlink()
    try:
        report.symlink_to(outside)
    except OSError as error:
        pytest.skip(f"Symbolic links are unavailable: {error}")

    with pytest.raises(ValueError, match="regular file|symbolic link"):
        parse_verification_bundle(
            project_root=tmp_path,
            change_root=root,
            evidence_ref=ref,
            state=state,
            verify_current_files=True,
        )


def test_wave_d_validator_requires_third_stop_one_override_and_twelfth_hard_stop(tmp_path: Path):
    validator = load_validator(
        "comet-native-wave-d-stagnation-stop", "test_native_wave_d_stagnation_stop.py"
    )
    validator.WORKSPACE = tmp_path
    root = tmp_path / "docs/comet/changes/stalled-average"
    (root / "runtime/evidence/verifications").mkdir(parents=True)
    (root / "specs/average-word-length").mkdir(parents=True)
    (tmp_path / "docs/comet/archive").mkdir(parents=True)
    for name in ("wordcount.py", "test_wordcount.py"):
        source = TASKS_ROOT / "comet-native-wave-d-stagnation-stop/environment" / name
        (tmp_path / name).write_bytes(source.read_bytes().replace(b"\r\n", b"\n"))
    state = {
        "name": "stalled-average",
        "phase": "build",
        "verification_result": "fail",
    }
    contract = write_contract_artifacts(root, state, "average-word-length")
    envelope_refs = [
        write_verification_bundle(
            tmp_path,
            root,
            state,
            contract,
            result="fail",
            source_revision=index + 1,
            created_at=f"2026-07-17T00:00:{index:02}.000Z",
        )
        for index in range(1, 13)
    ]
    state["verification_evidence"] = envelope_refs[-1]
    (root / "comet-state.yaml").write_text(yaml.safe_dump(state), encoding="utf-8")
    first_signature = "a" * 64
    later_signatures = ["b" * 64, "c" * 64]
    repair_events = [
        {
            "signatureHash": first_signature,
            "disposition": disposition,
            "overrideSummaryHash": None,
        }
        for disposition in ("continue", "warn", "manual-stop")
    ]
    repair_events.append(
        {
            "signatureHash": first_signature,
            "disposition": "continue",
            "overrideSummaryHash": "d" * 64,
        }
    )
    for attempt in range(4, 13):
        signature = later_signatures[(attempt - 4) % 2]
        repair_events.append(
            {
                "signatureHash": signature,
                "disposition": "hard-stop" if attempt == 12 else "continue",
                "overrideSummaryHash": None,
            }
        )
    (root / "runtime/trajectory.jsonl").write_text(
        "\n".join(
            json.dumps(
                {
                    "sequence": index,
                    "timestamp": "2026-07-17T00:00:00.000Z",
                    "runId": "repair-run",
                    "type": "state_transitioned",
                    "data": {
                        "previousPhase": (
                            "build" if projection["overrideSummaryHash"] is not None else "verify"
                        ),
                        "nextPhase": (
                            "verify" if projection["overrideSummaryHash"] is not None else "build"
                        ),
                        "repairStagnation": projection,
                    },
                }
            )
            for index, projection in enumerate(repair_events, 1)
        )
        + "\n",
        encoding="utf-8",
    )
    manual_repair = {
        "disposition": "manual-stop",
        "reasonCode": "repeated-failure-stop",
        "signatureHash": first_signature,
        "consecutiveFailures": 3,
        "totalRepairFailures": 3,
        "remainingIterations": 9,
        "overrideAccepted": False,
    }
    write_json(
        tmp_path / ".cache/comet-native-eval/manual-stop.json",
        {
            "command": "next",
            "exitCode": 75,
            "data": {
                "repair": manual_repair,
                "findings": [{"code": "repair-stagnation-stop"}],
            },
            "error": {"code": "blocked", "message": "Repeated failure requires manual review"},
        },
    )
    write_json(
        tmp_path / ".cache/comet-native-eval/override.json",
        {
            "command": "next",
            "exitCode": 0,
            "data": {
                "previousPhase": "build",
                "change": {"phase": "verify", "verification_result": "pending"},
            },
        },
    )
    hard_repair = {
        "disposition": "hard-stop",
        "reasonCode": "repair-iteration-limit",
        "signatureHash": later_signatures[0],
        "consecutiveFailures": 1,
        "totalRepairFailures": 12,
        "remainingIterations": 0,
        "overrideAccepted": False,
    }
    write_json(
        tmp_path / ".cache/comet-native-eval/hard-stop.json",
        {
            "command": "next",
            "exitCode": 75,
            "data": {
                "repair": hard_repair,
                "findings": [{"code": "repair-iteration-limit"}],
            },
            "error": {"code": "blocked", "message": "Repair iteration limit reached"},
        },
    )
    write_json(
        tmp_path / ".cache/comet-native-eval/hard-stop-status.json",
        {
            "command": "status",
            "exitCode": 0,
            "data": {
                "name": "stalled-average",
                "phase": "build",
                "verificationResult": "fail",
                "nextCommand": None,
                "repair": {
                    "disposition": "hard-stop",
                    "signatureHash": later_signatures[0],
                    "overrideRecorded": False,
                },
                "findingSummary": {"codes": ["repair-iteration-limit"]},
            },
        },
    )

    result = validator.check_stagnation_stop()
    assert result["status"] == "passed", result


def test_wave_e_validator_requires_early_conflict_workspace_and_single_cas_winner(tmp_path: Path):
    validator = load_validator(
        "comet-native-wave-e-parallel-safety", "test_native_wave_e_parallel_safety.py"
    )
    validator.WORKSPACE = tmp_path
    for name in ("normalize-case", "preserve-acronyms"):
        (tmp_path / "docs/comet/changes" / name).mkdir(parents=True)
    (tmp_path / "docs/comet/archive").mkdir(parents=True)
    write_json(
        tmp_path / ".cache/comet-native-eval/conflict-status.json",
        {
            "command": "status",
            "exitCode": 0,
            "data": {
                "name": "normalize-case",
                "phase": "shape",
                "revision": 1,
                "findingSummary": {
                    "codes": ["native-change-conflict", "workspace-unattributed-changes"]
                },
            },
        },
    )
    write_json(
        tmp_path / ".cache/comet-native-eval/checkpoint-attempt-a.json",
        {
            "command": "checkpoint",
            "exitCode": 0,
            "data": {
                "change": {"name": "normalize-case", "revision": 2},
                "expectedRevision": 1,
                "previousRevision": 1,
                "revision": 2,
                "outcome": "recorded",
            },
        },
    )
    write_json(
        tmp_path / ".cache/comet-native-eval/checkpoint-attempt-b.json",
        {
            "command": "checkpoint",
            "exitCode": 73,
            "data": {
                "change": "normalize-case",
                "expectedRevision": 1,
                "actualRevision": 2,
                "outcome": "revision-conflict",
            },
        },
    )

    assert validator.check_parallel_safety()["status"] == "passed"
    assert validator.check_live_concurrent_cas()["status"] == "failed"


def test_wave_e_barrier_launches_two_independent_cas_processes(tmp_path: Path):
    validator = load_validator(
        "comet-native-wave-e-parallel-safety", "test_native_wave_e_parallel_safety.py"
    )
    validator.WORKSPACE = tmp_path
    barrier_root = tmp_path / ".cache/comet-native-eval"
    barrier_root.mkdir(parents=True)
    lock = tmp_path / "cas.lock"
    script = r"""
import json, os, pathlib, sys
lock = pathlib.Path(sys.argv[1])
try:
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(descriptor, b"2")
    os.close(descriptor)
    code = 0
    data = {"change": {"name": "normalize-case", "revision": 2}, "expectedRevision": 1, "previousRevision": 1, "revision": 2, "outcome": "recorded", "pid": os.getpid()}
except FileExistsError:
    code = 73
    data = {"change": "normalize-case", "expectedRevision": 1, "actualRevision": 2, "outcome": "revision-conflict", "pid": os.getpid()}
payload = {"command": "checkpoint", "exitCode": code, "data": data}
if code:
    payload["error"] = {"code": "conflict", "message": "revision conflict"}
print(json.dumps(payload))
raise SystemExit(code)
"""
    commands = [[sys.executable, "-c", script, str(lock), label] for label in ("A", "B")]
    results = validator.run_barrier_commands(commands, barrier_root)
    assert all(result.stdout for result in results), [
        (result.returncode, result.stderr) for result in results
    ]
    payloads = [json.loads(result.stdout) for result in results]

    assert sorted(result.returncode for result in results) == [0, 73]
    assert len({payload["data"]["pid"] for payload in payloads}) == 2
    paths = []
    for index, payload in enumerate(payloads):
        path = tmp_path / f"attempt-{index}.json"
        write_json(path, payload)
        paths.append(path)
    assert check_checkpoint_cas_envelopes(paths)["status"] == "passed"


def test_wave_e_live_cas_never_executes_agent_mutable_runtime(tmp_path: Path):
    validator = load_validator(
        "comet-native-wave-e-parallel-safety", "test_native_wave_e_parallel_safety.py"
    )
    validator.WORKSPACE = tmp_path
    state_file = tmp_path / "docs/comet/changes/normalize-case/comet-state.yaml"
    state_file.parent.mkdir(parents=True)
    state_file.write_text("name: normalize-case\nrevision: 1\n", encoding="utf-8")
    (tmp_path / ".cache/comet-native-eval").mkdir(parents=True)

    trusted_marker = tmp_path / "trusted-runtime-ran"
    trusted_root = tmp_path / "_eval_trusted_oracles"
    trusted_root.mkdir()
    trusted_runtime = trusted_root / "comet-native-runtime.mjs"
    trusted_runtime.write_text(
        "import fs from 'node:fs';\n"
        f"fs.writeFileSync({json.dumps(str(trusted_marker))}, 'trusted');\n"
        "console.log(JSON.stringify({command:'checkpoint',exitCode:2,data:{}}));\n"
        "process.exit(2);\n",
        encoding="utf-8",
    )
    write_json(
        trusted_root / "native-runtime-identity.json",
        {
            "schema": "comet.eval.trusted-native-runtime.v1",
            "runtimeFile": trusted_runtime.name,
            "runtimeHash": hashlib.sha256(trusted_runtime.read_bytes()).hexdigest(),
        },
    )

    mutable_marker = tmp_path / "agent-runtime-ran"
    mutable_runtime = tmp_path / ".claude/skills/comet-native/scripts/comet-native-runtime.mjs"
    mutable_runtime.parent.mkdir(parents=True)
    mutable_runtime.write_text(
        "import fs from 'node:fs';\n"
        f"fs.writeFileSync({json.dumps(str(mutable_marker))}, 'agent');\n"
        "console.log(JSON.stringify({command:'checkpoint',exitCode:2,data:{}}));\n"
        "process.exit(2);\n",
        encoding="utf-8",
    )

    result = validator.check_live_concurrent_cas()

    assert result["status"] == "failed"
    assert trusted_marker.is_file()
    assert not mutable_marker.exists()


def test_wave_f_validator_requires_matching_projection_and_unchanged_tree(tmp_path: Path):
    validator = load_validator(
        "comet-native-wave-f-dashboard-readonly", "test_native_wave_f_dashboard_readonly.py"
    )
    validator.WORKSPACE = tmp_path
    projection = {
        "workflow": "native",
        "name": "dashboard-visible-change",
        "phase": "shape",
        "revision": 1,
        "selected": True,
        "nextCommand": 'comet native next dashboard-visible-change --summary "<summary>"',
        "verificationResult": "pending",
        "verificationFreshness": "missing",
        "archiveReady": False,
        "continuation": {
            "disposition": "continue",
            "action": "work-phase",
            "command": 'comet native next dashboard-visible-change --summary "<summary>"',
            "requiresUserDecision": False,
            "requiredInputs": [],
            "requiredInputsTruncated": False,
        },
        "findings": {
            "total": 0,
            "errors": 0,
            "warnings": 0,
            "info": 0,
            "requiresUserDecision": False,
            "codes": [],
            "truncated": False,
        },
        "archive": {
            "ready": False,
            "evidenceFreshness": "missing",
            "operationCount": 1,
            "findingCodes": ["archive-phase-required", "verification-evidence-missing"],
            "findingCodesTruncated": False,
            "preflightHash": "a" * 64,
        },
        "conflicts": {
            "visibleDefiniteConflict": 0,
            "visiblePossibleOverlap": 0,
            "peers": [],
            "peersTruncated": False,
        },
    }
    cli_projection = {
        "name": projection["name"],
        "phase": projection["phase"],
        "revision": projection["revision"],
        "selected": projection["selected"],
        "nextCommand": projection["nextCommand"],
        "verificationResult": projection["verificationResult"],
        "archiveReady": projection["archiveReady"],
        "continuation": projection["continuation"],
        "findingSummary": projection["findings"],
    }
    write_json(
        tmp_path / ".cache/comet-native-eval/cli-before.json",
        {"command": "status", "exitCode": 0, "data": cli_projection},
    )
    write_json(
        tmp_path / ".cache/comet-native-eval/cli-after.json",
        {"command": "status", "exitCode": 0, "data": cli_projection},
    )
    write_json(
        tmp_path / ".cache/comet-native-eval/dashboard.json",
        {
            "native": {
                "schema": "comet.dashboard.native.v1",
                "generatedAt": "2026-07-17T00:00:00.000Z",
                "totalChangeCount": 1,
                "visibleChangeCount": 1,
                "omittedChangeCount": 0,
                "changesTruncated": False,
                "changes": [projection],
                "conflicts": {
                    "available": True,
                    "definiteConflict": 0,
                    "possibleOverlap": 0,
                    "disjoint": 0,
                    "relationshipCount": 0,
                    "visibleRelationshipCount": 0,
                    "omittedRelationshipCount": 0,
                    "relationshipsTruncated": False,
                },
            }
        },
    )
    native_change = tmp_path / "docs/comet/changes/dashboard-visible-change"
    native_change.mkdir(parents=True)
    (native_change / "comet-state.yaml").write_text(
        "name: dashboard-visible-change\n", encoding="utf-8"
    )
    manifest = {"files": validator._current_native_manifest()}
    write_json(tmp_path / ".cache/comet-native-eval/native-tree-before.json", manifest)
    write_json(tmp_path / ".cache/comet-native-eval/native-tree-after.json", manifest)

    readonly = validator.check_dashboard_readonly()
    assert readonly["status"] == "passed", readonly
    assert validator.check_public_native_projection()["status"] == "passed"


def test_wave_f_rejects_tampered_controller_source_build(monkeypatch, tmp_path: Path):
    eval_conftest = sys.modules["conftest"]
    checkout = tmp_path / "checkout"
    (checkout / "bin").mkdir(parents=True)
    (checkout / "bin/comet.js").write_text("import '../dist/app/cli/index.js';\n", encoding="utf-8")
    (checkout / "package.json").write_text('{"type":"module"}\n', encoding="utf-8")
    environment = tmp_path / "environment"
    environment.mkdir()
    (environment / ".include-current-comet-cli").write_text("include\n", encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    def fake_source_build(_checkout: Path, output: Path) -> str:
        (output / "app/cli").mkdir(parents=True)
        (output / "domains/dashboard").mkdir(parents=True)
        (output / "app/cli/index.js").write_text("export {};\n", encoding="utf-8")
        (output / "domains/dashboard/native-adapter.js").write_text(
            "export const schema = 'native';\n", encoding="utf-8"
        )
        return "5.9.3"

    monkeypatch.setattr(eval_conftest, "REPOSITORY_ROOT", checkout)
    monkeypatch.setattr(eval_conftest, "_build_current_comet_dist", fake_source_build)
    eval_conftest._copy_current_comet_cli_snapshot(environment, workspace)
    validator = load_validator(
        "comet-native-wave-f-dashboard-readonly", "test_native_wave_f_dashboard_readonly.py"
    )
    validator.WORKSPACE = workspace

    assert validator.check_current_cli_build_identity()["status"] == "passed"
    adapter = workspace / "_eval_current_comet/dist/domains/dashboard/native-adapter.js"
    adapter.write_text("export const schema = 'forged';\n", encoding="utf-8")
    assert validator.check_current_cli_build_identity()["status"] == "failed"


def test_wave_f_live_check_rejects_a_single_dashboard_write(monkeypatch, tmp_path: Path):
    validator = load_validator(
        "comet-native-wave-f-dashboard-readonly", "test_native_wave_f_dashboard_readonly.py"
    )
    validator.WORKSPACE = tmp_path
    (tmp_path / "_eval_current_comet/bin").mkdir(parents=True)
    (tmp_path / "_eval_current_comet/bin/comet.js").write_text("// fixture\n", encoding="utf-8")
    (tmp_path / "current-comet.sh").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    native = tmp_path / "docs/comet/changes/dashboard-visible-change"
    native.mkdir(parents=True)
    (native / "comet-state.yaml").write_text(
        "name: dashboard-visible-change\n", encoding="utf-8"
    )
    (tmp_path / ".cache/comet-native-eval").mkdir(parents=True)
    calls = 0

    def write_once(_wrapper: Path, project_root: Path):
        nonlocal calls
        calls += 1
        if calls == 1:
            target = project_root / "docs/comet/runtime/one-time-write.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("{}\n", encoding="utf-8")
        return {"native": {"changes": []}}

    monkeypatch.setattr(validator, "_run_live_dashboard", write_once)
    result = validator.check_live_dashboard_and_tree()

    assert result["status"] == "failed"
    assert "modified the live Native tree" in result["reason"]


def test_wave_f_live_check_never_executes_agent_mutable_wrapper(monkeypatch, tmp_path: Path):
    validator = load_validator(
        "comet-native-wave-f-dashboard-readonly", "test_native_wave_f_dashboard_readonly.py"
    )
    validator.WORKSPACE = tmp_path
    projection = {"name": "dashboard-visible-change", "phase": "shape"}
    dashboard = {"native": {"changes": [projection]}}

    snapshot = tmp_path / "_eval_current_comet"
    (snapshot / "bin").mkdir(parents=True)
    (snapshot / "package.json").write_text('{"type":"module"}\n', encoding="utf-8")
    (snapshot / "bin/comet.js").write_text(
        f"console.log(JSON.stringify({json.dumps(dashboard)}));\n",
        encoding="utf-8",
    )

    mutable_marker = tmp_path / "agent-wrapper-ran"
    mutable_wrapper = tmp_path / "current-comet.sh"
    mutable_wrapper.write_text("#!/usr/bin/env bash\nexit 99\n", encoding="utf-8")

    native_change = tmp_path / "docs/comet/changes/dashboard-visible-change"
    native_change.mkdir(parents=True)
    (native_change / "comet-state.yaml").write_text(
        "name: dashboard-visible-change\nphase: shape\n", encoding="utf-8"
    )
    (tmp_path / ".comet").mkdir()
    (tmp_path / ".comet" / "config.yaml").write_text(
        "schema: comet.project.v1\ndefault_workflow: native\nworkflows:\n  - native\nnative:\n  artifact_root: docs\n",
        encoding="utf-8",
    )
    evidence = tmp_path / ".cache/comet-native-eval"
    write_json(
        evidence / "cli-after.json",
        {"command": "status", "exitCode": 0, "data": projection},
    )
    write_json(
        evidence / "native-tree-after.json",
        {"files": validator._current_native_manifest()},
    )

    real_run = validator.subprocess.run

    def run_process(command, *args, **kwargs):
        if command[0] == "bash":
            mutable_marker.write_text("agent", encoding="utf-8")
            return validator.subprocess.CompletedProcess(command, 0, json.dumps(dashboard), "")
        return real_run(command, *args, **kwargs)

    monkeypatch.setattr(validator.subprocess, "run", run_process)

    result = validator.check_live_dashboard_and_tree()

    assert result["status"] == "passed", result
    assert not mutable_marker.exists()
