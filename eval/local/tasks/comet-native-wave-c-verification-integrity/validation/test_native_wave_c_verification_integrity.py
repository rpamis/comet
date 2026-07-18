"""Validate content-bound partial, stale, and complete Native evidence."""

from __future__ import annotations

import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from scaffold.python.validation.native_wave import (
    active_changes,
    archive_changes,
    check_archive_transaction,
    check_cli_feature,
    check_native_isolation,
    check_runtime_envelopes,
    failed,
    parse_partial_allowance,
    parse_runtime_envelope,
    parse_verification_bundle,
    passed,
    write_results,
)


WORKSPACE = Path("/workspace")
EVIDENCE = Path(".cache/comet-native-eval")
HASH = re.compile(r"^[a-f0-9]{64}$")


def _runtime_envelope(path: Path, command: str, exit_code: int) -> dict[str, Any]:
    return parse_runtime_envelope(path, command=command, exit_code=exit_code)


def _codes(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"code", "codes", "findingCodes", "finding_codes"}:
                if isinstance(child, str):
                    found.add(child)
                elif isinstance(child, list):
                    found.update(item for item in child if isinstance(item, str))
            found.update(_codes(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_codes(child))
    return found


def _safe_change_ref(change_root: Path, value: Any, label: str) -> Path:
    if not isinstance(value, str):
        raise ValueError(f"{label} is missing")
    ref = PurePosixPath(value)
    if ref.is_absolute() or ".." in ref.parts or str(ref) != value:
        raise ValueError(f"{label} is not a normalized change-relative ref: {value!r}")
    target = change_root.joinpath(*ref.parts)
    if not target.is_file():
        raise ValueError(f"{label} does not resolve to a live immutable artifact: {value!r}")
    return target


def _safe_project_ref(workspace: Path, value: Any, label: str) -> Path:
    if not isinstance(value, str):
        raise ValueError(f"{label} is missing")
    ref = PurePosixPath(value)
    if ref.is_absolute() or ".." in ref.parts or str(ref) != value:
        raise ValueError(f"{label} is not a normalized project-relative ref: {value!r}")
    lower_parts = tuple(part.lower() for part in ref.parts)
    if (
        (lower_parts and lower_parts[0] in {".cache", ".git"})
        or (lower_parts and lower_parts[0].startswith(".env"))
        or lower_parts[:2] == ("docs", "comet")
    ):
        raise ValueError(f"{label} points at workflow/cache metadata instead of project evidence")
    target = workspace.joinpath(*ref.parts)
    if not target.is_file():
        raise ValueError(f"{label} does not resolve to a live project artifact: {value!r}")
    return target


def _phase_transitions(path: Path) -> list[tuple[Any, Any]]:
    transitions: list[tuple[Any, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        data = event.get("data") if isinstance(event, dict) else None
        if (
            isinstance(event, dict)
            and event.get("type") == "state_transitioned"
            and isinstance(data, dict)
        ):
            transitions.append((data.get("previousPhase"), data.get("nextPhase")))
    return transitions


def _contains_ordered_subsequence(values: list[Any], required: list[Any]) -> bool:
    cursor = iter(values)
    return all(any(value == expected for value in cursor) for expected in required)


def check_verification_integrity() -> dict[str, str]:
    check = "verification_integrity"
    evidence = WORKSPACE / EVIDENCE
    try:
        partial_scope = _runtime_envelope(evidence / "partial-scope.json", "next", 65)
        partial_preview = _runtime_envelope(
            evidence / "partial-archive-preview.json", "archive --dry-run", 0
        )
        stale_status = _runtime_envelope(evidence / "stale-status.json", "status", 0)
        stale_preview = _runtime_envelope(
            evidence / "stale-archive-preview.json", "archive --dry-run", 0
        )
        stale_commit = _runtime_envelope(evidence / "stale-archive-commit.json", "archive", 73)
        final_preview = _runtime_envelope(
            evidence / "final-archive-preview.json", "archive --dry-run", 0
        )
        archive_commit = _runtime_envelope(evidence / "archive-commit.json", "archive", 0)
    except Exception as error:
        return failed(check, f"Invalid runtime evidence: {error}")

    prepared = partial_scope["data"].get("preparedScope")
    if (
        partial_scope["data"].get("next") != "manual"
        or not isinstance(prepared, dict)
        or prepared.get("complete") is not False
        or not isinstance(prepared.get("unresolvedScopeCount"), int)
        or prepared["unresolvedScopeCount"] < 1
        or not isinstance(prepared.get("scopeHash"), str)
        or not HASH.fullmatch(prepared["scopeHash"])
        or "verification-scope-partial" not in _codes(partial_scope)
    ):
        return failed(check, "The partial scope was not produced by Native's blocked Build path")

    partial_data = partial_preview["data"]
    if (
        partial_data.get("ready") is not True
        or partial_data.get("evidenceFreshness") != "partial"
        or partial_data.get("findingCodes") != []
        or not isinstance(partial_data.get("preflightHash"), str)
        or not HASH.fullmatch(partial_data["preflightHash"])
    ):
        return failed(check, "Confirmed partial scope did not yield a fresh bound preview")

    if (
        stale_status["data"].get("phase") != "archive"
        or stale_status["data"].get("archiveReady") is not False
        or "verification-evidence-stale" not in _codes(stale_status)
    ):
        return failed(check, "Post-verification artifact drift is not visible in Native status")

    stale_data = stale_preview["data"]
    stale_commit_data = stale_commit["data"]
    if (
        stale_data.get("ready") is not False
        or stale_data.get("evidenceFreshness") != "stale"
        or "verification-evidence-stale" not in stale_data.get("findingCodes", [])
        or stale_commit.get("error", {}).get("code") != "conflict"
        or stale_commit_data.get("preflightHash") != stale_data.get("preflightHash")
    ):
        return failed(check, "Stale Archive preview/commit did not fail closed on one preflight")

    final_data = final_preview["data"]
    committed_data = archive_commit["data"]
    if (
        final_data.get("ready") is not True
        or final_data.get("evidenceFreshness") != "complete"
        or final_data.get("findingCodes") != []
        or not isinstance(final_data.get("preflightHash"), str)
        or not HASH.fullmatch(final_data["preflightHash"])
        or committed_data.get("preflightHash") != final_data.get("preflightHash")
    ):
        return failed(check, "Final Archive did not commit the exact ready complete preflight")
    transaction = check_archive_transaction(
        WORKSPACE,
        committed_data,
        "add-longest-word",
        final_data["preflightHash"],
    )
    if transaction["status"] != "passed":
        return failed(check, transaction.get("reason", "Archive transaction is invalid"))

    archives = archive_changes(WORKSPACE)
    if active_changes(WORKSPACE):
        return failed(check, "An active change remains after the successful Archive commit")
    if len(archives) != 1:
        return failed(check, f"Expected exactly one Native archive, found {len(archives)}")
    change_root = archives[0]
    try:
        state = (
            yaml.safe_load((change_root / "comet-state.yaml").read_text(encoding="utf-8"))
            or {}
        )
        if (
            state.get("name") != "add-longest-word"
            or state.get("phase") != "archive"
            or state.get("archived") is not True
            or state.get("verification_result") != "pass"
        ):
            return failed(check, f"Archived state is not terminal and verified: {state}")
        final_bundle = parse_verification_bundle(
            project_root=WORKSPACE,
            change_root=change_root,
            evidence_ref=state.get("verification_evidence"),
            state=state,
            expected_result="pass",
            expected_freshness="complete",
            verify_current_files=True,
        )
        envelope = final_bundle["envelope"]
        trace = envelope.get("acceptanceTrace")
        entries = trace.get("entries") if isinstance(trace, dict) else None
        if (
            not isinstance(entries, list)
            or len(entries) < 2
            or trace.get("total") != len(entries)
            or trace.get("evidenced") != len(entries)
            or trace.get("skipped") != 0
        ):
            return failed(check, "Immutable acceptance trace is incomplete or contains skips")
        ids: list[str] = []
        for entry in entries:
            if (
                not isinstance(entry, dict)
                or not isinstance(entry.get("acceptanceId"), str)
                or not re.fullmatch(r"acceptance-[a-f0-9]{64}", entry["acceptanceId"])
                or not isinstance(entry.get("evidenceRefs"), list)
                or not entry["evidenceRefs"]
                or entry.get("skippedReason") is not None
            ):
                return failed(check, "Each acceptance criterion needs concrete immutable evidence")
            for evidence_ref in entry["evidenceRefs"]:
                _safe_project_ref(
                    WORKSPACE,
                    evidence_ref,
                    f"evidenceRef for {entry['acceptanceId']}",
                )
            ids.append(entry["acceptanceId"])
        if len(set(ids)) != len(ids):
            return failed(check, "Acceptance trace contains duplicate identifiers")
        report = _safe_change_ref(change_root, envelope.get("reportRef"), "reportRef")
        report_text = report.read_text(encoding="utf-8")
        if any(identifier not in report_text for identifier in ids):
            return failed(
                check, "Archived verification report does not preserve every acceptance ID"
            )
        verification_root = change_root / "runtime/evidence/verifications"
        verification_refs = sorted(
            f"runtime/evidence/verifications/{path.name}"
            for path in verification_root.iterdir()
            if path.is_file() and not path.is_symlink()
        )
        bundles = [
            parse_verification_bundle(
                project_root=WORKSPACE,
                change_root=change_root,
                evidence_ref=ref,
                state=state,
            )
            for ref in verification_refs
        ]
        if {bundle["envelope"]["freshness"] for bundle in bundles} != {"partial", "complete"}:
            return failed(
                check,
                "Archived evidence does not contain both a bound partial pass and final complete pass",
            )
        allowance_root = change_root / "runtime/evidence/allowances"
        allowance_refs = sorted(
            f"runtime/evidence/allowances/{path.name}"
            for path in allowance_root.iterdir()
            if path.is_file() and not path.is_symlink()
        )
        allowances = [
            parse_partial_allowance(
                change_root,
                ref,
                expected_change="add-longest-word",
            )
            for ref in allowance_refs
        ]
        if len(allowances) != 1 or allowances[0]["scopeHash"] != prepared["scopeHash"]:
            return failed(check, "The exact confirmed partial-scope allowance was not preserved")
        prepared_bundle = next(
            (bundle for bundle in bundles if bundle["scope"]["scopeHash"] == prepared["scopeHash"]),
            None,
        )
        if (
            prepared_bundle is None
            or prepared_bundle["envelope"]["freshness"] != "partial"
            or prepared["unresolvedScopeCount"] != len(prepared_bundle["scope"]["unresolvedScopes"])
        ):
            return failed(
                check,
                "The blocked Build unresolved-scope count does not match its exact persisted scope",
            )
        transitions = _phase_transitions(change_root / "runtime/trajectory.jsonl")
        required = [
            ("verify", "archive"),
            ("archive", "build"),
            ("build", "verify"),
            ("verify", "archive"),
        ]
        if not _contains_ordered_subsequence(transitions, required):
            return failed(
                check,
                f"Archived trajectory does not prove stale-evidence retreat and reverify: {transitions}",
            )
    except (OSError, ValueError, yaml.YAMLError) as error:
        return failed(check, f"Invalid archived Native evidence: {error}")
    return passed(check)


def main() -> int:
    evidence = WORKSPACE / EVIDENCE
    results = [
        check_cli_feature(
            WORKSPACE,
            "--longest-word",
            "tiny extraordinarily medium",
            "Longest word: extraordinarily",
            "longest",
        ),
        check_runtime_envelopes(
            [
                evidence / "partial-scope.json",
                evidence / "partial-archive-preview.json",
                evidence / "stale-status.json",
                evidence / "stale-archive-preview.json",
                evidence / "stale-archive-commit.json",
                evidence / "final-archive-preview.json",
                evidence / "archive-commit.json",
            ]
        ),
        check_verification_integrity(),
        check_native_isolation(WORKSPACE),
    ]
    return write_results(results, WORKSPACE)


if __name__ == "__main__":
    raise SystemExit(main())
