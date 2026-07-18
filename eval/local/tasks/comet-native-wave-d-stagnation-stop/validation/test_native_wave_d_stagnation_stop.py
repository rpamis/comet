"""Validate Native's durable repair-stop and hard-ceiling trajectory."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

from scaffold.python.validation.native_wave import (
    active_changes,
    archive_changes,
    check_native_isolation,
    check_pytest,
    check_runtime_envelopes,
    failed,
    parse_runtime_envelope,
    parse_verification_bundle,
    passed,
    write_results,
)


WORKSPACE = Path("/workspace")
EVIDENCE = Path(".cache/comet-native-eval")
HASH = re.compile(r"^[a-f0-9]{64}$")
BASELINE_HASHES = {
    "wordcount.py": "e08ddd3a7485232992d7abc2539a3a974115b8733acb9f8668dccd3846f9907e",
    "test_wordcount.py": "1ea0c2ecd6299ae2c55a7a9de2b192423671a46c3fc3b7ce4d1661e4a1009170",
}


def _envelope(path: Path, command: str, exit_code: int) -> dict[str, Any]:
    return parse_runtime_envelope(path, command=command, exit_code=exit_code)


def _finding_codes(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"code", "codes", "findingCodes"}:
                if isinstance(child, str):
                    found.add(child)
                elif isinstance(child, list):
                    found.update(item for item in child if isinstance(item, str))
            found.update(_finding_codes(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_finding_codes(child))
    return found


def _trajectory_repairs(path: Path) -> list[dict[str, Any]]:
    repairs: list[dict[str, Any]] = []
    previous_sequence = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        data = event.get("data") if isinstance(event, dict) else None
        projection = data.get("repairStagnation") if isinstance(data, dict) else None
        if projection is not None:
            if event.get("type") != "state_transitioned" or not isinstance(projection, dict):
                raise ValueError("Repair evidence is not attached to a state transition")
            sequence = event.get("sequence")
            if (
                not isinstance(sequence, int)
                or isinstance(sequence, bool)
                or sequence <= previous_sequence
            ):
                raise ValueError("Repair trajectory sequence is not strictly increasing")
            previous_sequence = sequence
            override = projection.get("overrideSummaryHash") is not None
            expected_phases = ("build", "verify") if override else ("verify", "build")
            if (data.get("previousPhase"), data.get("nextPhase")) != expected_phases:
                raise ValueError("Repair projection is attached to the wrong phase transition")
            repairs.append(projection)
    return repairs


def check_stagnation_stop() -> dict[str, str]:
    check = "stagnation_stop"
    active = active_changes(WORKSPACE)
    if [path.name for path in active] != ["stalled-average"]:
        return failed(check, f"Expected stalled-average to remain active, found {active}")
    if archive_changes(WORKSPACE):
        return failed(check, "The unresolved change was archived")

    evidence = WORKSPACE / EVIDENCE
    try:
        manual = _envelope(evidence / "manual-stop.json", "next", 75)
        override = _envelope(evidence / "override.json", "next", 0)
        hard = _envelope(evidence / "hard-stop.json", "next", 75)
        status = _envelope(evidence / "hard-stop-status.json", "status", 0)
    except Exception as error:
        return failed(check, f"Invalid stop evidence: {error}")

    manual_repair = manual["data"].get("repair")
    if (
        manual.get("error", {}).get("code") != "blocked"
        or not isinstance(manual_repair, dict)
        or manual_repair.get("disposition") != "manual-stop"
        or manual_repair.get("reasonCode") != "repeated-failure-stop"
        or manual_repair.get("consecutiveFailures") != 3
        or manual_repair.get("totalRepairFailures") != 3
        or manual_repair.get("remainingIterations") != 9
        or manual_repair.get("overrideAccepted") is not False
        or not HASH.fullmatch(str(manual_repair.get("signatureHash", "")))
        or "repair-stagnation-stop" not in _finding_codes(manual)
    ):
        return failed(check, "The third identical failure is not an exact manual-stop result")
    manual_signature = manual_repair["signatureHash"]

    if (
        override["data"].get("previousPhase") != "build"
        or override["data"].get("change", {}).get("phase") != "verify"
        or override["data"].get("change", {}).get("verification_result") != "pending"
    ):
        return failed(check, "The explicit override did not resume Build to Verify exactly once")

    hard_repair = hard["data"].get("repair")
    if (
        hard.get("error", {}).get("code") != "blocked"
        or not isinstance(hard_repair, dict)
        or hard_repair.get("disposition") != "hard-stop"
        or hard_repair.get("reasonCode") != "repair-iteration-limit"
        or hard_repair.get("totalRepairFailures") != 12
        or hard_repair.get("remainingIterations") != 0
        or hard_repair.get("consecutiveFailures") != 1
        or hard_repair.get("overrideAccepted") is not False
        or not HASH.fullmatch(str(hard_repair.get("signatureHash", "")))
        or "repair-iteration-limit" not in _finding_codes(hard)
    ):
        return failed(check, "The twelfth total failure is not the hard repair ceiling")

    status_repair = status["data"].get("repair")
    if (
        status["data"].get("name") != "stalled-average"
        or status["data"].get("phase") != "build"
        or status["data"].get("verificationResult") != "fail"
        or status["data"].get("nextCommand") is not None
        or not isinstance(status_repair, dict)
        or status_repair.get("disposition") != "hard-stop"
        or status_repair.get("signatureHash") != hard_repair["signatureHash"]
        or "repair-iteration-limit" not in _finding_codes(status)
    ):
        return failed(check, "Durable status does not reconstruct the hard stop from disk")

    root = active[0]
    trajectory = root / "runtime/trajectory.jsonl"
    state_file = root / "comet-state.yaml"
    spec_file = root / "specs/average-word-length/spec.md"
    if not all(path.is_file() for path in (trajectory, state_file, spec_file)):
        return failed(check, "Active state, target specification, or trajectory is missing")
    try:
        state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
        repairs = _trajectory_repairs(trajectory)
    except (OSError, ValueError, json.JSONDecodeError, yaml.YAMLError) as error:
        return failed(check, f"Invalid durable repair trajectory: {error}")
    if (
        state.get("name") != "stalled-average"
        or state.get("phase") != "build"
        or state.get("verification_result") != "fail"
    ):
        return failed(check, f"Unexpected final Native state: {state}")
    if "average-word-length" not in spec_file.read_text(encoding="utf-8").lower():
        return failed(check, "The unresolved acceptance contract is incomplete")

    failures = [item for item in repairs if item.get("overrideSummaryHash") is None]
    overrides = [item for item in repairs if item.get("overrideSummaryHash") is not None]
    if len(failures) != 12:
        return failed(check, f"Expected 12 committed repair failures, found {len(failures)}")
    if len(overrides) != 1:
        return failed(
            check, f"Expected exactly one committed repair override, found {len(overrides)}"
        )
    if [item.get("disposition") for item in failures[:3]] != [
        "continue",
        "warn",
        "manual-stop",
    ]:
        return failed(check, "First three identical failures do not follow continue/warn/stop")
    if len({item.get("signatureHash") for item in failures[:3]}) != 1:
        return failed(check, "First three failures do not share one signature")
    if failures[2].get("signatureHash") != manual_signature:
        return failed(check, "Manual-stop envelope does not match the durable third signature")
    if any(item.get("disposition") != "continue" for item in failures[3:11]):
        return failed(check, "Alternating failures 4-11 should continue below the total ceiling")
    later_signatures = [item.get("signatureHash") for item in failures[3:11]]
    if len(set(later_signatures)) != 2 or any(
        left == right for left, right in zip(later_signatures, later_signatures[1:])
    ):
        return failed(check, "Failures 4-11 do not alternate two real signatures")
    if failures[11].get("disposition") != "hard-stop":
        return failed(check, "The durable twelfth failure is not hard-stop")
    if failures[11].get("signatureHash") != hard_repair["signatureHash"]:
        return failed(check, "Hard-stop envelope does not match the durable twelfth signature")
    single_override = overrides[0]
    if (
        single_override.get("disposition") != "continue"
        or single_override.get("signatureHash") != manual_signature
        or not HASH.fullmatch(str(single_override.get("overrideSummaryHash", "")))
        or repairs.index(single_override) != 3
    ):
        return failed(check, "The one override is not bound between failure 3 and failure 4")

    envelopes = list((root / "runtime/evidence/verifications").glob("*.json"))
    if len(envelopes) != 12:
        return failed(
            check,
            f"Expected exactly 12 immutable verification envelopes, found {len(envelopes)}",
        )
    for envelope_path in envelopes:
        try:
            bundle = parse_verification_bundle(
                project_root=WORKSPACE,
                change_root=root,
                evidence_ref=f"runtime/evidence/verifications/{envelope_path.name}",
                state=state,
                expected_result="fail",
                expected_freshness="complete",
                verify_current_files=True,
            )
            envelope = bundle["envelope"]
        except Exception as error:
            return failed(check, f"Invalid verification envelope {envelope_path.name}: {error}")
        if envelope.get("envelopeHash") != envelope_path.stem:
            return failed(check, f"Failure envelope is not content-addressed: {envelope_path.name}")
    state_ref = state.get("verification_evidence")
    expected_refs = {f"runtime/evidence/verifications/{path.name}" for path in envelopes}
    if state_ref not in expected_refs:
        return failed(check, "Final hard-stop state is not bound to one verified failure envelope")
    for name, expected in BASELINE_HASHES.items():
        actual = hashlib.sha256((WORKSPACE / name).read_bytes()).hexdigest()
        if actual != expected:
            return failed(check, f"{name} changed during the intentional repair exercise")
    return passed(check)


def check_intentional_failure_remains() -> dict[str, str]:
    check = "intentional_failure_remains"
    try:
        result = subprocess.run(
            [sys.executable, "wordcount.py", "--average-word-length"],
            cwd=WORKSPACE,
            input="one three",
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as error:
        return failed(check, str(error))
    if result.returncode == 0:
        return failed(check, "The intentionally unresolved flag unexpectedly succeeds")
    return passed(check)


def main() -> int:
    evidence = WORKSPACE / EVIDENCE
    results = [
        check_pytest(WORKSPACE),
        check_intentional_failure_remains(),
        check_runtime_envelopes(
            [
                evidence / "manual-stop.json",
                evidence / "override.json",
                evidence / "hard-stop.json",
                evidence / "hard-stop-status.json",
            ]
        ),
        check_stagnation_stop(),
        check_native_isolation(WORKSPACE),
    ]
    return write_results(results, WORKSPACE)


if __name__ == "__main__":
    raise SystemExit(main())
