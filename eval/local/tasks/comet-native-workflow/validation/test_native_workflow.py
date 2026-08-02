"""Validate the self-contained Comet Native workflow task inside Docker."""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml


WORKSPACE = Path("/workspace")
RESULTS_FILE = os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")
HASH = re.compile(r"^[a-f0-9]{64}$")
TYPED_RECEIPT_REF = re.compile(
    r"^runtime/evidence/receipts/([a-f0-9]{64})\.json$"
)
VERIFICATION_REF = re.compile(
    r"^runtime/evidence/verifications/([a-f0-9]{64})\.json$"
)


def passed(name: str):
    return {"check": name, "status": "passed"}


def failed(name: str, reason: str):
    return {"check": name, "status": "failed", "reason": reason}


def check_feature():
    try:
        subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=WORKSPACE,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=True,
        )
        result = subprocess.run(
            [sys.executable, "wordcount.py", "--sentences"],
            cwd=WORKSPACE,
            input="Hello world. How are you? Fine!",
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
            check=True,
        )
    except Exception as error:
        return failed("sentence_feature", str(error))
    if "Sentences: 3" not in result.stdout:
        return failed("sentence_feature", f"Expected Sentences: 3, got {result.stdout!r}")
    tests = (WORKSPACE / "test_wordcount.py").read_text(encoding="utf-8").lower()
    if "sentence" not in tests:
        return failed("sentence_feature", "No sentence-counting tests were added")
    return passed("sentence_feature")


def archive_directory():
    archive_root = WORKSPACE / "docs" / "comet" / "archive"
    candidates = sorted(path for path in archive_root.glob("*-*") if path.is_dir())
    return candidates[-1] if candidates else None


def _utf16_key(value: str):
    encoded = value.encode("utf-16-be", "surrogatepass")
    return tuple(
        int.from_bytes(encoded[index : index + 2], "big")
        for index in range(0, len(encoded), 2)
    )


def _canonical_json(value):
    if isinstance(value, dict):
        return "{" + ",".join(
            f"{json.dumps(key, ensure_ascii=False)}:{_canonical_json(value[key])}"
            for key in sorted(value, key=_utf16_key)
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_canonical_json(item) for item in value) + "]"
    if value is None or isinstance(value, (bool, str)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        if value == 0:
            return "0"
        if not (float("-inf") < value < float("inf")):
            raise ValueError("Non-finite canonical JSON number")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    raise ValueError(f"Unsupported canonical JSON value: {type(value).__name__}")


def _canonical_hash(tag: str, value) -> str:
    return hashlib.sha256(f"{tag}\n{_canonical_json(value)}".encode("utf-8")).hexdigest()


def _content_hash(value: dict, hash_field: str, tag: str) -> str:
    if not isinstance(value, dict) or hash_field not in value:
        raise ValueError(f"{hash_field} is missing")
    content = {key: child for key, child in value.items() if key != hash_field}
    return _canonical_hash(tag, content)


def _trusted_native_runtime() -> Path:
    oracle_root = WORKSPACE / "_eval_trusted_oracles"
    identity_path = oracle_root / "native-runtime-identity.json"
    runtime = oracle_root / "comet-native-runtime.mjs"
    if oracle_root.is_symlink() or not oracle_root.is_dir():
        raise FileNotFoundError("The controller-trusted Native oracle is unavailable")
    if identity_path.is_symlink() or not identity_path.is_file():
        raise FileNotFoundError("The controller-trusted Native oracle identity is unavailable")
    if runtime.is_symlink() or not runtime.is_file():
        raise FileNotFoundError("The controller-trusted Native runtime is unavailable")
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    if (
        set(identity) != {"schema", "runtimeFile", "runtimeHash"}
        or identity.get("schema") != "comet.eval.trusted-native-runtime.v1"
        or identity.get("runtimeFile") != runtime.name
        or not HASH.fullmatch(identity.get("runtimeHash", ""))
        or hashlib.sha256(runtime.read_bytes()).hexdigest() != identity["runtimeHash"]
    ):
        raise ValueError("The controller-trusted Native runtime does not match its identity")
    return runtime


def _validate_native_contract_with_trusted_runtime(
    archived: Path, state: dict, expected_contract_hash: str
):
    """Recompute the archived contract with the controller-owned Native runtime.

    The archive's JSON documents are content-addressed, but that only proves they agree with
    one another.  Replaying the sealed archive as an active change in a temporary projection
    lets the trusted runtime derive the contract from the archived brief/spec files instead of
    trusting the candidate's contract hash.
    """
    if not HASH.fullmatch(expected_contract_hash):
        raise ValueError("Archived contract hash is invalid")
    name = state.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", name):
        raise ValueError("Archived Native change name is invalid")

    runtime = _trusted_native_runtime()
    with tempfile.TemporaryDirectory(prefix="comet-native-oracle-") as temporary:
        root = Path(temporary)
        active = root / "docs" / "comet" / "changes" / name
        shutil.copytree(archived, active, symlinks=False)

        (root / ".comet").mkdir(parents=True, exist_ok=True)
        (root / ".comet" / "config.yaml").write_text(
            yaml.safe_dump(
                {
                    "schema": "comet.project.v1",
                    "default_workflow": "native",
                    "native": {
                        "artifact_root": "docs",
                        "max_verify_failures": 5,
                        "archive_confirmation": "automatic",
                    },
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )

        spec_changes = state.get("spec_changes")
        if not isinstance(spec_changes, list):
            raise ValueError("Archived Native spec changes are missing")
        for change in spec_changes:
            if not isinstance(change, dict) or change.get("operation") == "remove":
                continue
            capability = change.get("capability")
            source = change.get("source")
            if not isinstance(capability, str) or not isinstance(source, str):
                raise ValueError("Archived Native spec change is invalid")
            source_file = active / Path(*source.split("/"))
            if not source_file.is_file() or source_file.is_symlink():
                raise ValueError(f"Archived Native spec source is missing: {source}")
            canonical = root / "docs" / "comet" / "specs" / capability / "spec.md"
            canonical.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_file, canonical)

        state_file = active / "comet-state.yaml"
        candidate_state = yaml.safe_load(state_file.read_text(encoding="utf-8"))
        if not isinstance(candidate_state, dict):
            raise ValueError("Archived Native state is invalid")
        candidate_state.update(
            {
                "phase": "build",
                "approval": "confirmed",
                "approved_contract_hash": expected_contract_hash,
                "verification_result": "pending",
                "verification_report": None,
                "implementation_scope": None,
                "verification_evidence": None,
                "partial_allowance": None,
                "archived": False,
            }
        )
        state_file.write_text(yaml.safe_dump(candidate_state, sort_keys=False), encoding="utf-8")

        result = subprocess.run(
            [
                "node",
                str(runtime.resolve()),
                "--json",
                "--project-root",
                str(root),
                "status",
                name,
                "--details",
            ],
            cwd=root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError(
                f"Trusted Native runtime could not validate the archived contract: {result.stderr.strip()}"
            )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise ValueError("Trusted Native runtime returned invalid contract validation JSON") from error
        data = payload.get("data") if isinstance(payload, dict) else None
        summary = data.get("findingSummary") if isinstance(data, dict) else None
        codes = summary.get("codes", []) if isinstance(summary, dict) else []
        if (
            not isinstance(data, dict)
            or data.get("phase") != "build"
            or not isinstance(summary, dict)
        ):
            raise ValueError(
                "Trusted Native runtime returned an invalid contract validation result"
            )
        if "contract-changed-after-approval" in codes:
            raise ValueError("Trusted Native runtime rejected the archived contract hash")


def _validate_native_scope_bindings(archived: Path, bindings: dict):
    """Bind archived scope evidence to the real workspace files it claims to cover."""
    scope_hash = bindings.get("scopeHash")
    if not isinstance(scope_hash, str) or not HASH.fullmatch(scope_hash):
        raise ValueError("Archived implementation scope hash is invalid")
    scope_file = archived / f"runtime/evidence/scopes/{scope_hash}.json"
    if not scope_file.is_file() or scope_file.is_symlink():
        raise ValueError("Archived implementation scope is missing")
    scope = json.loads(scope_file.read_text(encoding="utf-8"))
    if (
        not isinstance(scope, dict)
        or scope.get("schema") != "comet.native.implementation-scope.v2"
        or scope.get("scopeHash") != scope_hash
        or _content_hash(
            scope, "scopeHash", "comet.native.implementation-scope.v2"
        )
        != scope_hash
        or scope.get("contractHash") != bindings.get("contractHash")
        or scope.get("currentProjectionHash") != bindings.get("snapshotHash")
    ):
        raise ValueError("Archived implementation scope bindings are invalid")

    declared = scope.get("declaredArtifacts")
    if not isinstance(declared, list) or any(
        not isinstance(item, dict)
        or not isinstance(item.get("path"), str)
        or item.get("kind") not in {"file", "directory"}
        for item in declared
    ):
        raise ValueError("Archived declared artifacts are missing")
    expected_artifact_hash = _canonical_hash(
        "comet.native.declared-artifacts.v1",
        sorted(declared, key=lambda item: (item.get("path", ""), item.get("kind", ""))),
    )
    if expected_artifact_hash != bindings.get("artifactHash"):
        raise ValueError("Archived declared artifact binding is invalid")

    projection_ref = scope.get("currentProjectionRef")
    projection_match = re.fullmatch(
        r"runtime/evidence/snapshots/([a-f0-9]{64})\.json", projection_ref or ""
    )
    if projection_match is None:
        raise ValueError("Archived current snapshot reference is invalid")
    projection_file = archived / projection_ref
    if not projection_file.is_file() or projection_file.is_symlink():
        raise ValueError("Archived current snapshot is missing")
    projection = json.loads(projection_file.read_text(encoding="utf-8"))
    if (
        not isinstance(projection, dict)
        or projection.get("schema") != "comet.native.content-snapshot-projection.v1"
        or _canonical_hash("comet.native.content-snapshot-projection.v1", projection)
        != projection_match.group(1)
        or projection_match.group(1) != bindings.get("snapshotHash")
    ):
        raise ValueError("Archived current snapshot bindings are invalid")

    entries = projection.get("entries")
    if not isinstance(entries, list):
        raise ValueError("Archived current snapshot entries are missing")
    workspace_root = WORKSPACE.resolve()
    for entry in entries:
        relative = entry.get("path") if isinstance(entry, dict) else None
        if (
            not isinstance(relative, str)
            or not relative
            or "\\" in relative
            or relative.startswith("/")
            or ":" in relative.split("/")[0]
            or ".." in relative.split("/")
        ):
            raise ValueError("Archived snapshot entry path is unsafe")
        target = WORKSPACE.joinpath(*relative.split("/"))
        if target.is_symlink() or not target.is_file() or workspace_root not in target.resolve().parents:
            raise ValueError(f"Archived snapshot entry is unavailable: {relative}")
        content = target.read_bytes()
        if (
            hashlib.sha256(content).hexdigest() != entry.get("hash")
            or len(content) != entry.get("size")
        ):
            raise ValueError(f"Archived snapshot entry does not match workspace: {relative}")


def _read_typed_receipt(archived: Path, reference: str):
    match = TYPED_RECEIPT_REF.fullmatch(reference) if isinstance(reference, str) else None
    if match is None:
        raise ValueError(f"Invalid typed receipt ref: {reference!r}")
    receipt_file = archived / reference
    if not receipt_file.is_file():
        raise ValueError(f"Typed receipt is missing: {reference}")
    receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
    if (
        receipt.get("schema") != "comet.native.verification-receipt.v3"
        or receipt.get("receiptHash") != match.group(1)
        or _content_hash(
            receipt, "receiptHash", "comet.native.verification-receipt.v3"
        )
        != receipt.get("receiptHash")
    ):
        raise ValueError(f"Typed receipt schema/hash is invalid: {reference}")
    return receipt


def _direct_acceptance_receipt_refs(entry: dict) -> list[str]:
    references = entry.get("evidenceRefs")
    if (
        set(entry)
        != {"acceptanceId", "status", "kind", "source", "evidenceRefs", "skippedReason"}
        or entry.get("status") != "passed"
        or entry.get("kind") not in {"brief-example", "spec-scenario", "spec-must"}
        or not isinstance(entry.get("source"), str)
        or not entry["source"]
        or not isinstance(references, list)
        or not references
        or entry.get("skippedReason") is not None
    ):
        raise ValueError(f"Acceptance matrix entry is not a direct pass: {entry!r}")
    return references


def _validate_v2_verification(archived: Path, state: dict, evidence_ref: str):
    if archived.is_symlink() or any(path.is_symlink() for path in archived.rglob("*")):
        raise ValueError("Native archive contains a symbolic link")
    evidence_match = VERIFICATION_REF.fullmatch(evidence_ref)
    if evidence_match is None:
        raise ValueError("Verification evidence ref is not content-addressed v2 evidence")
    evidence_file = archived / evidence_ref
    if not evidence_file.is_file() or evidence_file.is_symlink():
        raise ValueError("Verification evidence file is missing or unsafe")
    evidence = json.loads(evidence_file.read_text(encoding="utf-8"))
    if (
        state.get("verification_protocol") != "legacy-v1"
        or evidence.get("schema") != "comet.native.verification-evidence.v2"
        or evidence.get("envelopeHash") != evidence_match.group(1)
        or _content_hash(
            evidence, "envelopeHash", "comet.native.verification-evidence.v2"
        )
        != evidence.get("envelopeHash")
        or evidence.get("result") != "pass"
        or "independentReviewReceiptRef" in evidence
        or "waiverRefs" in evidence
    ):
        raise ValueError("Archive does not contain current passing verification evidence")

    trace = evidence.get("acceptanceTrace")
    entries = trace.get("entries") if isinstance(trace, dict) else None
    if (
        not isinstance(trace, dict)
        or trace.get("schema") != "comet.native.acceptance-trace.v2"
        or not isinstance(entries, list)
        or not entries
        or trace.get("total") != len(entries)
        or trace.get("evidenced") != len(entries)
        or trace.get("skipped") != 0
        or _content_hash(trace, "traceHash", "comet.native.acceptance-trace.v2")
        != trace.get("traceHash")
    ):
        raise ValueError("Passing verification has an incomplete acceptance matrix")
    raw_acceptance_ids = [entry.get("acceptanceId") for entry in entries]
    if (
        any(not isinstance(value, str) for value in raw_acceptance_ids)
        or len(set(raw_acceptance_ids)) != len(raw_acceptance_ids)
    ):
        raise ValueError("Acceptance matrix ids are invalid or duplicated")
    if any(
        not re.fullmatch(r"acceptance-[a-f0-9]{64}", value)
        for value in raw_acceptance_ids
    ):
        raise ValueError("Acceptance matrix ids are not content-addressed")

    acceptance_receipt_refs = set()
    all_receipts = []
    for entry in entries:
        references = _direct_acceptance_receipt_refs(entry)
        for reference in references:
            receipt = _read_typed_receipt(archived, reference)
            if (
                receipt.get("kind") not in {"automated-check", "manual-evidence"}
                or receipt.get("role") != "acceptance-evidence"
                or receipt.get("status") != "passed"
                or entry["acceptanceId"] not in receipt.get("acceptanceIds", [])
            ):
                raise ValueError(f"Acceptance receipt does not cover {entry['acceptanceId']}")
            acceptance_receipt_refs.add(reference)
            all_receipts.append(receipt)

    required_refs = evidence.get("requiredReceiptRefs")
    if not isinstance(required_refs, list) or not required_refs:
        raise ValueError("Passing verification has no required check receipt")
    for reference in required_refs:
        receipt = _read_typed_receipt(archived, reference)
        if (
            receipt.get("kind") != "static-inspection"
            or receipt.get("role") != "required-check"
            or receipt.get("status") != "passed"
        ):
            raise ValueError(f"Required check receipt is not passed: {reference}")
        all_receipts.append(receipt)

    receipt_refs = evidence.get("receiptRefs")
    if not isinstance(receipt_refs, list) or set(receipt_refs) != acceptance_receipt_refs:
        raise ValueError("Envelope receiptRefs do not exactly match acceptance receipts")
    bindings = all_receipts[0].get("bindings")
    if any(receipt.get("bindings") != bindings for receipt in all_receipts[1:]):
        raise ValueError("Verification receipts do not share exact current bindings")
    if (
        bindings.get("change") != evidence.get("change")
        or bindings.get("sourceRevision") != evidence.get("sourceRevision")
        or bindings.get("contractHash") != evidence.get("contractHash")
        or bindings.get("scopeHash") != evidence.get("implementationScopeHash")
    ):
        raise ValueError("Verification receipt bindings do not match the evidence envelope")
    _validate_native_contract_with_trusted_runtime(
        archived, state, bindings["contractHash"]
    )
    _validate_native_scope_bindings(archived, bindings)
    # Archive finalization intentionally changes the run state, checkpoint, canonical
    # spec location, and workspace bindings. Replaying the sealed archive as an active
    # change therefore cannot reproduce the pre-archive status. Validate the sealed,
    # content-addressed evidence above and separately require the controller-owned
    # runtime snapshot to retain its trusted identity.
    _trusted_native_runtime()


def check_native_artifacts():
    config_file = WORKSPACE / ".comet" / "config.yaml"
    if not config_file.exists():
        return failed("native_artifacts", ".comet/config.yaml is missing")
    config = yaml.safe_load(config_file.read_text(encoding="utf-8"))
    if "native" not in (config.get("workflows") or [config.get("default_workflow")]):
        return failed("native_artifacts", "native workflow is not enabled")
    if config.get("native", {}).get("artifact_root") != "docs":
        return failed("native_artifacts", "native.artifact_root is not docs")
    if config.get("native", {}).get("max_verify_failures") != 5:
        return failed("native_artifacts", "native.max_verify_failures is not 5")
    if config.get("native", {}).get("archive_confirmation", "automatic") != "automatic":
        return failed("native_artifacts", "native.archive_confirmation is not automatic")

    canonical = WORKSPACE / "docs" / "comet" / "specs" / "sentence-counting" / "spec.md"
    if not canonical.is_file() or not canonical.read_text(encoding="utf-8").strip():
        return failed("native_artifacts", "Canonical sentence-counting spec is missing or empty")

    archived = archive_directory()
    if archived is None:
        return failed("native_artifacts", "No date-prefixed Native archive exists")
    required = ["comet-state.yaml", "brief.md", "verification.md", "runtime/trajectory.jsonl"]
    missing = [relative for relative in required if not (archived / relative).is_file()]
    if missing:
        return failed("native_artifacts", f"Archive is missing: {', '.join(missing)}")
    if not list((archived / "specs").rglob("*.md")):
        return failed("native_artifacts", "Archive has no complete proposed specification")
    changes_root = WORKSPACE / "docs" / "comet" / "changes"
    if changes_root.is_dir() and any(changes_root.iterdir()):
        return failed("native_artifacts", "An active Native change remains after archive")
    state = yaml.safe_load((archived / "comet-state.yaml").read_text(encoding="utf-8"))
    evidence_ref = state.get("verification_evidence")
    if state.get("verification_result") != "pass" or not isinstance(evidence_ref, str):
        return failed("native_artifacts", "Archive has no passing Native verification evidence")
    evidence_file = archived / evidence_ref
    if not evidence_file.is_file():
        return failed("native_artifacts", "Archive verification evidence receipt is missing")
    try:
        _validate_v2_verification(archived, state, evidence_ref)
    except Exception as error:
        return failed("native_artifacts", str(error))
    return passed("native_artifacts")


def check_trajectory():
    archived = archive_directory()
    if archived is None:
        return failed("trajectory", "Archive is unavailable")
    events = [
        json.loads(line)
        for line in (archived / "runtime" / "trajectory.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    phases = set()
    failed_loop_index = None
    final_pass_index = None
    for index, event in enumerate(events):
        data = event.get("data", {})
        phases.update(
            value
            for value in (data.get("phase"), data.get("previousPhase"), data.get("nextPhase"))
            if value
        )
        serialized = json.dumps(event).lower()
        if any(key in serialized for key in ("chain_of_thought", "reasoning_content", "hidden_reasoning")):
            return failed("trajectory", "Trajectory contains a hidden reasoning field")
        repair = data.get("repairStagnation")
        if (
            data.get("previousPhase") == "verify"
            and data.get("nextPhase") == "build"
            and data.get("verificationResult") == "fail"
            and isinstance(repair, dict)
            and repair.get("contractHash")
            and repair.get("failedAcceptanceIds")
            and repair.get("maxVerifyFailures") == 5
        ):
            failed_loop_index = index
        if (
            data.get("previousPhase") == "verify"
            and data.get("nextPhase") == "archive"
            and data.get("verificationResult") == "pass"
        ):
            final_pass_index = index
    if not {"shape", "build", "verify", "archive"}.issubset(phases):
        return failed("trajectory", f"Missing phase evidence; found {sorted(phases)}")
    if (
        failed_loop_index is None
        or final_pass_index is None
        or failed_loop_index >= final_pass_index
    ):
        return failed("trajectory", "Missing failed-gap Build loop before the final passing Verify")
    return passed("trajectory")


def check_isolation():
    comet_config_dir = WORKSPACE / ".comet"
    hidden_entries = (
        {path.name for path in comet_config_dir.iterdir()}
        if comet_config_dir.is_dir()
        else set()
    )
    present = []
    if (WORKSPACE / "openspec").exists():
        present.append("openspec")
    present.extend(
        f".comet/{name}"
        for name in sorted(hidden_entries - {"config.yaml"})
    )
    if present:
        return failed("native_isolation", f"Forbidden workflow artifacts exist: {present}")
    skills_root = WORKSPACE / ".claude" / "skills"
    if skills_root.exists():
        installed = {path.name for path in skills_root.iterdir() if path.is_dir()}
        if installed != {"comet-native"}:
            return failed("native_isolation", f"Unexpected installed Skills: {sorted(installed)}")
    return passed("native_isolation")


def main():
    results = [check_feature(), check_native_artifacts(), check_trajectory(), check_isolation()]
    output = {
        "passed": [result["check"] for result in results if result["status"] == "passed"],
        "failed": [
            f'{result["check"]}: {result.get("reason", "")}'
            for result in results
            if result["status"] == "failed"
        ],
    }
    (WORKSPACE / RESULTS_FILE).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output))
    return 0 if not output["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
