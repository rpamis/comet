"""Current SDK blocked→fresh verifier→Archive, with immutable check evidence."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import traceback
from pathlib import Path

from scaffold.python.validation.current_sdk import inspect_run, sdk_inspection_evidence
from scaffold.python.validation.native_recovery_boundary import digest

WORKSPACE = Path("/workspace")
PACKAGE = Path("/opt/comet-current")
CLI = ["comet"]
NAME = "sentence-counting"


def assert_once_check(plan: dict, receipt: dict) -> None:
    argv = plan["argv"]
    if plan["executable"] == "python3":
        assert argv == ["recovery_once.py"], "Unexpected one-shot Python arguments"
    else:
        assert plan["executable"] in {"env", "/usr/bin/env"}, "Unexpected one-shot executable"
        assert len(argv) == 3 and argv[1:] == ["python3", "recovery_once.py"], (
            "Unexpected fixed-PATH one-shot command"
        )
        assert argv[0].startswith("PATH=") and all(
            directory.startswith("/") for directory in argv[0][5:].split(":")
        ), "One-shot PATH must contain only absolute directories"
    assert plan["repeatable"] is False and plan["cwdRef"] == ".", (
        "One-shot check must be non-repeatable at the project root"
    )
    assert receipt["argvDisplay"] == argv and receipt["cwdRef"] == ".", (
        "One-shot receipt does not match its Runtime plan"
    )


def assert_once_artifacts(context: dict) -> None:
    expected = context.get("environment_file_hashes", {}).get("recovery_once.py")
    assert isinstance(expected, str) and re.fullmatch(r"[a-f0-9]{64}", expected), (
        "Missing provided one-shot script digest"
    )
    assert (WORKSPACE / ".cache/comet-sdk-recovery/check-count").read_text() == "once\n"
    assert hashlib.sha256((WORKSPACE / "recovery_once.py").read_bytes()).hexdigest() == expected, (
        "One-shot check script was modified"
    )


def assert_once_evidence(plans: list[dict], receipts: list[dict]) -> tuple[dict, dict]:
    """Bind the uniquely named check to its original plan and receipt identities."""
    identifiers = [plan.get("id") for plan in plans]
    assert all(isinstance(value, str) and value for value in identifiers)
    assert len(identifiers) == len(set(identifiers)), "Duplicate Runtime check identities"
    once = [plan for plan in plans if plan.get("name") == "recovery-once"]
    assert len(once) == 1, "Expected exactly one check named recovery-once"
    plan = once[0]
    matches = [receipt for receipt in receipts if receipt.get("id") == plan["id"]]
    assert len(matches) == 1, "Missing or duplicate original one-shot receipt"
    receipt = matches[0]
    assert receipt.get("name") == plan["name"], "One-shot receipt name does not match its plan"
    assert receipt["status"] == "passed" and receipt["exitCode"] == 0
    assert_once_check(plan, receipt)
    return plan, receipt


def assert_recovery(run: dict, archived: Path, context: dict) -> None:
    """Inspect authoritative current Run actions, never Agent-authored receipts."""
    assert run["workflow"]["id"] == "comet-native" and run["status"] == "completed", (
        "Run not completed"
    )
    state = run["state"]
    assert state["name"] == NAME and state["archived"] is True and state["status"] == "done"
    assert state["loop"]["goal_cycle"] == 1, "Auxiliary line edit restarted Shape"
    actions = run["actions"]
    builders = [a for a in actions if a["stepId"] == "build.builder"]
    checks = [a for a in actions if a["stepId"] == "verify.checks"]
    verifiers = [a for a in actions if a["stepId"] == "verify.verifier"]
    assert len(builders) == len(checks) == 1 and len(verifiers) == 2, (
        "Candidate/checks were replaced or recovery skipped"
    )
    builder, check = builders[0], checks[0]
    assert all(a["status"] == "succeeded" for a in [builder, check, *verifiers])

    def result(action):
        return action["outcome"]["output"]

    blocked, passed = map(result, verifiers)
    assert blocked["response"]["result"]["verdict"] == "blocked", "Missing blocked verifier"
    assert passed["response"]["result"]["verdict"] == "pass", "Missing passing replacement verifier"
    candidate = state["builder_handoff"]["candidate_id"]
    assert (
        blocked["candidateId"] == passed["candidateId"] == result(check)["candidateId"] == candidate
    ), "Candidate changed"
    sessions = [a["claim"]["sessionId"] for a in [builder, *verifiers]]
    assert len(set(sessions)) == 3 and all(sessions), "Verifier is not independent"
    assert [blocked["verifierExecutionRef"], passed["verifierExecutionRef"]] == sessions[1:]
    assert verifiers[1]["input"]["activation"]["recoveryWaitId"], (
        "Replacement was not a recovery action"
    )
    acceptance = {a["id"] for a in state["acceptance"]}
    assert acceptance and all(a["result"] == "passed" for a in state["acceptance"])
    for output, expected in [(blocked, "blocked"), (passed, "passed")]:
        items = output["response"]["result"]["acceptance"]
        assert {a["id"] for a in items} == acceptance and all(
            a["result"] == expected for a in items
        )
    receipt = result(check)
    assert receipt["inputSnapshot"]["schema"] == "comet.native.check-input.v2"
    assert (
        receipt["inputSnapshot"]["complete"] is True
        and receipt["inputSnapshot"]["diagnostics"] == []
    )
    assert receipt["inputSnapshot"]["before"] == receipt["inputSnapshot"]["after"], (
        "Check mutated candidate inputs"
    )
    plans = result(builder)["verificationChecks"]
    assert_once_evidence(plans, receipt["checks"])
    business = {p["id"] for p in plans if "pytest" in p.get("argv", [])}
    assert business and any(
        c["id"] in business and c["status"] == "passed" for c in receipt["checks"]
    ), "No Runtime business-test evidence"
    assert_once_artifacts(context)
    history = [entry["outcome"] for entry in state["history"]]
    assert (
        history.index("blocked") < history.index("recovery") < len(history) - 1
        and history[-1] == "pass"
    )
    assert any(a["stepId"] == "archive.finalize" and a["status"] == "succeeded" for a in actions)
    # Approved auxiliary fields retain planned values; final brief must contain resolved lines.
    auxiliary = [
        x for a in state["shape_semantic_snapshot"]["artifacts"] for x in a.get("auxiliary", [])
    ]
    assert any(x["kind"] == "test-plan-line" and x["value"] == "planned" for x in auxiliary)
    brief = (archived / "brief.md").read_text()
    assert re.search(r"\|\s*\d+(?:\s*[-–]\s*\d+)?\s*\|", brief), "No resolved test line range"
    assert not re.search(r"\|\s*planned\s*\|", brief), "Test line plan was not resolved"
    assert (WORKSPACE / "docs/comet/specs/sentence-counting/spec.md").is_file()


def assert_boundary(run, interaction):
    boundaries = interaction.get("sdk_recovery_boundaries", [])
    assert interaction.get("fresh_resume_boundaries") == 1 and len(boundaries) == 1, (
        "Missing trusted blocked-boundary observation"
    )
    boundary = boundaries[0]
    assert (
        boundary["schema"] == "comet.eval.native-recovery-boundary.v1" and boundary["runId"] == NAME
    )
    assert boundary["revision"] < run["revision"]
    state = run["state"]
    assert boundary["candidateId"] == state["builder_handoff"]["candidate_id"]
    assert boundary["handoffHash"] == digest(state["builder_handoff"])
    assert boundary["counterHash"] == digest(
        (WORKSPACE / ".cache/comet-sdk-recovery/check-count").read_text()
    )
    assert boundary["shapeHash"] == state["shape_confirmation_hash"]
    assert len(boundary["actions"]) == 3
    for original in boundary["actions"]:
        action = next(a for a in run["actions"] if a["id"] == original["id"])
        assert (
            action["attempt"] == original["attempt"]
            and action["inputHash"] == original["inputHash"]
        )
        assert digest(action["outcome"]) == original["outcomeHash"], (
            "Original evidence changed after cold resume"
        )
    replacement = [a for a in run["actions"] if a["stepId"] == "verify.verifier"][1]
    assert replacement["input"]["activation"]["recoveryWaitId"] == boundary["waitId"]
    subjects = interaction.get("role_sessions", {}).get("subject", [])
    assert boundary["subjectSession"] in subjects
    assert subjects.index(boundary["subjectSession"]) < len(subjects) - 1, (
        "No new subject session after blocked observation"
    )


def check_recovery(evidence: dict | None = None) -> dict:
    name = "sdk_recovery"
    try:
        archives = list((WORKSPACE / "docs/comet/archive").glob("*-" + NAME))
        assert len(archives) == 1, "Expected exactly one archive for the original change"
        assert not list((WORKSPACE / "docs/comet/changes").glob("*/comet-state.yaml")), (
            "Change remains active"
        )
        run = inspect_run(
            WORKSPACE,
            "native",
            NAME,
            "native",
            archives[0] / "comet-state.yaml",
            package=PACKAGE,
            cli=CLI,
        )
        if evidence is not None:
            evidence[f"native:{NAME}"] = sdk_inspection_evidence("native", "native", run)
        context = json.loads((WORKSPACE / "_test_context.json").read_text())
        # 两组断言均执行，产物错误不能掩盖冷恢复时原证据被替换的问题。
        failures = []
        for check in (
            lambda: assert_recovery(run, archives[0], context),
            lambda: assert_boundary(run, context.get("interaction", {})),
        ):
            try:
                check()
            except (
                AssertionError,
                KeyError,
                TypeError,
                ValueError,
                OSError,
                IndexError,
                StopIteration,
                subprocess.SubprocessError,
            ) as error:
                frame = traceback.extract_tb(error.__traceback__)[-1]
                failures.append(f"{type(error).__name__} at {frame.name}:{frame.lineno}: {error}")
        if failures:
            return {"check": name, "status": "failed", "reason": "; ".join(failures)}
        return {"check": name, "status": "passed"}
    except (
        AssertionError,
        KeyError,
        TypeError,
        ValueError,
        OSError,
        subprocess.SubprocessError,
    ) as error:
        frame = traceback.extract_tb(error.__traceback__)[-1]
        return {
            "check": name,
            "status": "failed",
            "reason": f"{type(error).__name__} at {frame.name}:{frame.lineno}: {error}",
        }


def check_feature() -> dict:
    try:
        for text, words, sentences in [
            ("", 0, 0),
            ("hello world", 2, 1),
            ("...?!", 1, 0),
            ("First.\nSecond!", 2, 2),
            ("Hello. Why?! Fine!", 3, 3),
        ]:
            output = subprocess.run(
                ["python3", "wordcount.py", "--sentences", "--lines"],
                input=text,
                cwd=WORKSPACE,
                capture_output=True,
                text=True,
                check=True,
                timeout=20,
            ).stdout
            assert sorted(output.splitlines()) == sorted(
                [f"Words: {words}", f"Sentences: {sentences}", f"Lines: {len(text.splitlines())}"]
            ), "Incorrect CLI counts or duplicate output"
        return {"check": "feature", "status": "passed"}
    except (AssertionError, OSError, subprocess.SubprocessError) as error:
        return {"check": "feature", "status": "failed", "reason": str(error)}


def main():
    evidence = {}
    results = [check_recovery(evidence), check_feature()]
    output = {
        "passed": [r["check"] for r in results if r["status"] == "passed"],
        "failed": [
            f"{r['check']}: {r.get('reason', '')}" for r in results if r["status"] == "failed"
        ],
        "validation_evidence": evidence,
    }
    (WORKSPACE / os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")).write_text(
        json.dumps(output)
    )
    print(json.dumps(output))
    return int(bool(output["failed"]))


if __name__ == "__main__":
    raise SystemExit(main())
