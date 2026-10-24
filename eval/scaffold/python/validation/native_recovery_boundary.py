"""Trusted loop-driver observation before discarding the subject session."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from current_sdk import inspect_run
else:
    from .current_sdk import inspect_run


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def capture(workspace, subject_session, *, package=Path("/opt/comet-current"), cli=None):
    name = "sentence-counting"
    run = inspect_run(
        workspace,
        "native",
        name,
        "native",
        workspace / "docs/comet/changes" / name / "comet-state.yaml",
        package=package,
        cli=cli,
    )
    state = run["state"]
    if (
        not subject_session
        or run["status"] != "waiting"
        or state["phase"] != "verify"
        or state["status"] != "await-user"
        or state["loop"]["next_action"] != "resolve-verifier-blocker"
    ):
        raise ValueError("Fresh resume marker must occur on the original blocked Verify boundary")
    checks = [a for a in run["actions"] if a["stepId"] == "verify.checks"]
    builders = [a for a in run["actions"] if a["stepId"] == "build.builder"]
    verifiers = [a for a in run["actions"] if a["stepId"] == "verify.verifier"]
    waits = [w for w in run["waits"] if w["status"] == "pending"]
    if len(checks) != 1 or len(builders) != 1 or len(verifiers) != 1 or len(waits) != 1:
        raise ValueError(
            "Boundary must retain exactly one original candidate, check and blocked verifier"
        )
    if verifiers[0]["outcome"]["output"]["response"]["result"]["verdict"] != "blocked":
        raise ValueError("Boundary verifier did not report blocked")
    if any(a["status"] != "succeeded" for a in [builders[0], checks[0], verifiers[0]]):
        raise ValueError("Boundary actions are incomplete")
    if waits[0]["stepId"] != "verify.stop" or waits[0]["choices"] != ["retry", "repair"]:
        raise ValueError("Not the blocked-verifier recovery wait")
    counter = (workspace / ".cache/comet-sdk-recovery/check-count").read_text()
    if counter != "once\n":
        raise ValueError("The original one-shot check was not observed")
    return dict(
        schema="comet.eval.native-recovery-boundary.v1",
        runId=name,
        subjectSession=subject_session,
        counterHash=digest(counter),
        revision=run["revision"],
        waitId=waits[0]["id"],
        candidateId=state["builder_handoff"]["candidate_id"],
        handoffHash=digest(state["builder_handoff"]),
        shapeHash=state["shape_confirmation_hash"],
        actions=[
            dict(
                id=a["id"],
                attempt=a["attempt"],
                inputHash=a["inputHash"],
                outcomeHash=digest(a["outcome"]),
            )
            for a in [builders[0], checks[0], verifiers[0]]
        ],
    )


if __name__ == "__main__":
    print(json.dumps(capture(Path.cwd(), sys.argv[1]), separators=(",", ":")))
