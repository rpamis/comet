"""Validate the self-contained Comet Native workflow task inside Docker."""

import base64
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
            timeout=30,
            check=True,
        )
        result = subprocess.run(
            [sys.executable, "wordcount.py", "--sentences"],
            cwd=WORKSPACE,
            input="Hello world. How are you? Fine!",
            capture_output=True,
            text=True,
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


def _run_trusted_archive_oracle(
    archived: Path, state: dict, acceptance_ids: list[str]
) -> None:
    runtime = _trusted_native_runtime()
    node = shutil.which("node")
    if node is None:
        raise FileNotFoundError("Node.js is unavailable to the Native oracle")
    if archived.is_symlink() or any(path.is_symlink() for path in archived.rglob("*")):
        raise ValueError("Native archive contains a symbolic link")
    name = state.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", name):
        raise ValueError("Archived Native change name is invalid")
    if (
        state.get("phase") != "archive"
        or state.get("archived") is not True
        or state.get("verification_result") != "pass"
        or not acceptance_ids
        or any(not re.fullmatch(r"acceptance-[a-f0-9]{64}", value) for value in acceptance_ids)
    ):
        raise ValueError("Controller-trusted Native oracle rejected the sealed archive state")
    with tempfile.TemporaryDirectory(prefix="comet-native-archive-oracle-") as temporary:
        project = Path(temporary) / "project"
        shutil.copytree(
            WORKSPACE,
            project,
            ignore=shutil.ignore_patterns(
                "_eval_trusted_oracles",
                "_eval_current_comet",
                "__pycache__",
                ".pytest_cache",
            ),
        )
        relative_archive = archived.relative_to(WORKSPACE)
        copied_archive = project / relative_archive
        active = project / "docs" / "comet" / "changes" / name
        active.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(copied_archive, active)
        shutil.rmtree(copied_archive)
        active_state_file = active / "comet-state.yaml"
        active_state = yaml.safe_load(active_state_file.read_text(encoding="utf-8"))
        if not isinstance(active_state, dict):
            raise ValueError("Archived Native state is invalid")
        active_state["archived"] = False
        active_state_file.write_text(
            yaml.safe_dump(active_state, sort_keys=False),
            encoding="utf-8",
        )
        result = subprocess.run(
            [
                node,
                str(runtime),
                "status",
                name,
                "--details",
                "--json",
                "--project-root",
                str(project),
            ],
            cwd=project,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise ValueError(
                "Controller-trusted Native runtime returned invalid status JSON"
            ) from error
        data = payload.get("data") if isinstance(payload, dict) else None
        acceptance_page = data.get("acceptancePage") if isinstance(data, dict) else None
        runtime_acceptance_ids = sorted(
            item.get("id")
            for item in acceptance_page.get("items", [])
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        ) if isinstance(acceptance_page, dict) else []
        if (
            result.returncode != 0
            or not isinstance(data, dict)
            or data.get("archiveReady") is not True
            or runtime_acceptance_ids != acceptance_ids
        ):
            raise ValueError(
                "Controller-trusted Native runtime rejected the reconstructed pre-archive state"
            )


def _read_typed_receipt(archived: Path, reference: str):
    match = TYPED_RECEIPT_REF.fullmatch(reference) if isinstance(reference, str) else None
    if match is None:
        raise ValueError(f"Invalid typed receipt ref: {reference!r}")
    receipt_file = archived / reference
    if not receipt_file.is_file():
        raise ValueError(f"Typed receipt is missing: {reference}")
    receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
    if (
        receipt.get("schema") != "comet.native.verification-receipt.v2"
        or receipt.get("receiptHash") != match.group(1)
        or _content_hash(
            receipt, "receiptHash", "comet.native.verification-receipt.v2"
        )
        != receipt.get("receiptHash")
    ):
        raise ValueError(f"Typed receipt schema/hash is invalid: {reference}")
    return receipt


def _validate_identity(identity, label: str):
    if not isinstance(identity, dict):
        raise ValueError(f"{label} identity is missing")
    if (
        identity.get("schema") != "comet.native.review-identity.v1"
        or identity.get("algorithm") != "ed25519"
        or not HASH.fullmatch(identity.get("keyId", ""))
    ):
        raise ValueError(f"{label} identity is invalid")
    try:
        public_key = base64.b64decode(identity.get("publicKey", ""), validate=True)
    except Exception as error:
        raise ValueError(f"{label} public key is invalid") from error
    if hashlib.sha256(public_key).hexdigest() != identity["keyId"]:
        raise ValueError(f"{label} public key does not match its key id")


def _validate_signature(signature, identity, payload_hash: str, label: str):
    _validate_identity(identity, label)
    if not isinstance(signature, dict):
        raise ValueError(f"{label} signature is missing")
    if (
        signature.get("schema") != "comet.native.review-signature.v1"
        or signature.get("algorithm") != "ed25519"
        or signature.get("keyId") != identity["keyId"]
        or signature.get("payloadHash") != payload_hash
    ):
        raise ValueError(f"{label} signature binding is invalid")
    try:
        raw_signature = base64.b64decode(signature.get("signature", ""), validate=True)
    except Exception as error:
        raise ValueError(f"{label} signature is invalid") from error
    if len(raw_signature) != 64:
        raise ValueError(f"{label} signature length is invalid")
    node = shutil.which("node")
    if node is None:
        raise FileNotFoundError("Node.js is unavailable for Ed25519 verification")
    verifier = (
        "const {createPublicKey,verify}=require('node:crypto');"
        "const key=createPublicKey({key:Buffer.from(process.argv[1],'base64'),"
        "format:'der',type:'spki'});"
        "const message=Buffer.concat([Buffer.from('comet.native.review-payload.v1\\0'),"
        "Buffer.from(process.argv[2],'hex')]);"
        "process.exit(verify(null,message,key,Buffer.from(process.argv[3],'base64'))?0:1);"
    )
    verified = subprocess.run(
        [
            node,
            "-e",
            verifier,
            identity["publicKey"],
            payload_hash,
            signature["signature"],
        ],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    if verified.returncode != 0:
        raise ValueError(f"{label} Ed25519 signature verification failed")


def _validate_v2_verification(archived: Path, state: dict, evidence_ref: str):
    evidence_match = VERIFICATION_REF.fullmatch(evidence_ref)
    if evidence_match is None:
        raise ValueError("Verification evidence ref is not content-addressed v2 evidence")
    evidence_file = archived / evidence_ref
    if not evidence_file.is_file() or evidence_file.is_symlink():
        raise ValueError("Verification evidence file is missing or unsafe")
    evidence = json.loads(evidence_file.read_text(encoding="utf-8"))
    if (
        state.get("verification_protocol") != "signed-v2"
        or evidence.get("schema") != "comet.native.verification-evidence.v2"
        or evidence.get("envelopeHash") != evidence_match.group(1)
        or _content_hash(
            evidence, "envelopeHash", "comet.native.verification-evidence.v2"
        )
        != evidence.get("envelopeHash")
        or evidence.get("result") != "pass"
    ):
        raise ValueError("Archive does not contain passing signed-v2 verification evidence")

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
        raise ValueError("Passing verification has an incomplete v2 acceptance matrix")
    raw_acceptance_ids = [entry.get("acceptanceId") for entry in entries]
    if any(not isinstance(value, str) for value in raw_acceptance_ids):
        raise ValueError("Acceptance matrix ids are invalid or duplicated")
    acceptance_ids = sorted(raw_acceptance_ids)
    if len(set(acceptance_ids)) != len(acceptance_ids):
        raise ValueError("Acceptance matrix ids are invalid or duplicated")

    acceptance_receipt_refs = set()
    for entry in entries:
        references = entry.get("evidenceRefs")
        if (
            entry.get("status") != "passed"
            or not isinstance(references, list)
            or not references
            or entry.get("skippedReason") is not None
            or entry.get("waiverRef") is not None
        ):
            raise ValueError(f"Acceptance matrix entry is not a direct pass: {entry!r}")
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

    required_refs = evidence.get("requiredReceiptRefs")
    if not isinstance(required_refs, list) or not required_refs:
        raise ValueError("Passing v2 verification has no required check receipt")
    all_receipts = []
    for reference in required_refs:
        receipt = _read_typed_receipt(archived, reference)
        if receipt.get("role") != "required-check" or receipt.get("status") != "passed":
            raise ValueError(f"Required check receipt is not passed: {reference}")
        all_receipts.append(receipt)

    review_ref = evidence.get("independentReviewReceiptRef")
    review = _read_typed_receipt(archived, review_ref)
    review_evidence = review.get("evidence", {})
    checked = review_evidence.get("checked", {})
    matrix = [
        {
            "acceptance_id": entry["acceptanceId"],
            "status": entry["status"],
            "evidence_refs": entry["evidenceRefs"],
            **(
                {}
                if entry.get("skippedReason") is None
                else {"skipped_reason": entry["skippedReason"]}
            ),
            **(
                {}
                if entry.get("waiverRef") is None
                else {"waiver_ref": entry["waiverRef"]}
            ),
        }
        for entry in entries
    ]
    graph = review_evidence.get("evidenceGraph", {})
    graph_content = (
        {key: value for key, value in graph.items() if key != "graphHash"}
        if isinstance(graph, dict)
        else {}
    )
    expected_reviewed_refs = acceptance_receipt_refs | set(required_refs)
    expected_reviewed_refs.update(
        reference
        for reference in (
            checked.get("unifiedIo"),
            checked.get("adversarialPaths"),
            checked.get("generatedAssets"),
            checked.get("lifecycleEval"),
        )
        if isinstance(reference, str)
    )
    if (
        review.get("kind") != "independent-review"
        or review.get("role") != "acceptance-evidence"
        or review.get("status") != "passed"
        or sorted(review.get("acceptanceIds", [])) != acceptance_ids
        or checked.get("acceptanceApplicability") is not True
        or review_evidence.get("matrixHash")
        != _canonical_hash("comet.native.review-acceptance-matrix.v1", matrix)
        or graph.get("schema") != "comet.native.review-evidence-graph.v1"
        or graph.get("graphHash")
        != _canonical_hash("comet.native.review-evidence-graph.v1", graph_content)
        or set(graph.get("reviewedReceiptRefs", [])) != expected_reviewed_refs
        or graph.get("reviewedWaiverRefs") != []
        or any(
            finding.get("status") == "open" and finding.get("severity") in {"P0", "P1"}
            for finding in review_evidence.get("findings", [])
        )
    ):
        raise ValueError("Signed acceptance-applicability review is incomplete")
    unsigned_review_evidence = {
        key: value for key, value in review_evidence.items() if key != "attestation"
    }
    review_payload_hash = _canonical_hash(
        "comet.native.independent-review-attestation.v1",
        {
            "bindings": review["bindings"],
            "status": review["status"],
            "acceptanceIds": sorted(review["acceptanceIds"]),
            "issuedAt": review["issuedAt"],
            "evidence": unsigned_review_evidence,
        },
    )
    _validate_signature(
        review_evidence.get("attestation"),
        review_evidence.get("reviewerIdentity"),
        review_payload_hash,
        "Reviewer",
    )

    implementation_ref = review_evidence.get("implementationReceiptRef")
    implementation = _read_typed_receipt(archived, implementation_ref)
    implementation_evidence = implementation.get("evidence", {})
    if (
        implementation.get("kind") != "implementation-attestation"
        or implementation.get("role") != "acceptance-evidence"
        or implementation.get("status") != "passed"
        or sorted(implementation.get("acceptanceIds", [])) != acceptance_ids
        or implementation_evidence.get("implementationIdentity", {}).get("keyId")
        != review_evidence.get("implementationKeyId")
    ):
        raise ValueError("Review does not bind a complete implementation attestation")
    unsigned_implementation_evidence = {
        key: value
        for key, value in implementation_evidence.items()
        if key != "attestation"
    }
    implementation_payload_hash = _canonical_hash(
        "comet.native.implementation-attestation.v1",
        {
            "bindings": implementation["bindings"],
            "status": implementation["status"],
            "acceptanceIds": sorted(implementation["acceptanceIds"]),
            "issuedAt": implementation["issuedAt"],
            "evidence": unsigned_implementation_evidence,
        },
    )
    _validate_signature(
        implementation_evidence.get("attestation"),
        implementation_evidence.get("implementationIdentity"),
        implementation_payload_hash,
        "Implementation",
    )

    receipt_refs = evidence.get("receiptRefs")
    expected_receipt_refs = acceptance_receipt_refs | {review_ref}
    if not isinstance(receipt_refs, list) or set(receipt_refs) != expected_receipt_refs:
        raise ValueError("Envelope receiptRefs do not exactly match matrix and review receipts")

    all_receipts.extend(
        [_read_typed_receipt(archived, reference) for reference in acceptance_receipt_refs]
    )
    all_receipts.extend([review, implementation])
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

    policy_file = WORKSPACE / ".comet" / "native-review-trust.json"
    if not policy_file.is_file():
        raise ValueError("Pre-trusted review policy is missing")
    policy = json.loads(policy_file.read_text(encoding="utf-8"))
    reviewer_key = review_evidence["reviewerIdentity"]["keyId"]
    trusted_reviewers = {
        identity.get("keyId") for identity in policy.get("trustedReviewers", [])
    }
    policy_content = {
        key: value
        for key, value in policy.items()
        if key not in {"policyHash", "controllerSignature"}
    }
    all_role_keys = [
        policy.get("controllerKeyId"),
        policy.get("implementationKeyId"),
        *trusted_reviewers,
        *{
            identity.get("keyId")
            for identity in policy.get("trustedWaiverSigners", [])
            if isinstance(identity, dict)
        },
    ]
    if (
        policy.get("schema") != "comet.native.review-trust-policy.v2"
        or policy.get("policyHash")
        != _canonical_hash("comet.native.review-trust-policy.v2", policy_content)
        or policy.get("policyHash") != review_evidence.get("reviewPolicyHash")
        or policy.get("policyHash") != implementation_evidence.get("reviewPolicyHash")
        or policy.get("implementationKeyId") != review_evidence.get("implementationKeyId")
        or reviewer_key not in trusted_reviewers
        or any(not isinstance(key, str) or not HASH.fullmatch(key) for key in all_role_keys)
        or len(set(all_role_keys)) != len(all_role_keys)
    ):
        raise ValueError("Signed receipts do not match the pre-trusted review policy")
    _run_trusted_archive_oracle(archived, state, acceptance_ids)


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
    if any((WORKSPACE / "docs" / "comet" / "changes").iterdir()):
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
        for name in sorted(hidden_entries - {"config.yaml", "native-review-trust.json"})
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
