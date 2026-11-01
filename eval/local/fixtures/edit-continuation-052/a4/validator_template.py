"""Host invokes this read-only validator after the subject exits."""

import json
import subprocess
import traceback
from pathlib import Path


def workflow_validation_passed(workflow: str, proof: dict) -> bool:
    return proof.get("passed" if workflow == "native" else "ok") is True


root = Path("/workspace/_eval_trusted_oracles/052-a4")
workflow = json.loads((root / "model-tool-evidence.json").read_text())["workflow"]
assert workflow in ("native", "classic"), "Invalid host-selected workflow"
result = {"passed": [], "failed": [], "validation_evidence": {}}
try:
    host = json.loads((root / "model-tool-evidence.json").read_text())
    assert host["workflow"] == workflow and host["subjectExitCode"] == 0, (
        "Subject failed or timed out"
    )
    assert host["seedWasFirstBash"] and host["ordered"], (
        "Missing, duplicate or out-of-order real controller tool results"
    )
    assert not host["forbiddenSkills"], "External Skill invoked"
    assert host["observedExtraAgentCalls"] == 0 and host["extraAgentToolCalls"] == [], (
        "Extra model Agent creation tool was invoked"
    )
    assert host["observedSubprocessAgentCalls"] == 0 and host["subprocessAgentCalls"] == [], (
        "A direct child Claude process was observed"
    )
    for kind in ("seed", "judgment", "verify", "approve"):
        assert len(host["proofs"][kind]) == 1, f"Missing {kind} proof"
    seed = host["proofs"]["seed"][0]
    assert all(
        host["proofs"][kind][0]["baselineHash"] == seed["baselineHash"]
        for kind in ("judgment", "verify", "approve")
    ), "Controller changed its original seed baseline"
    command = [
        "node",
        str(root / workflow / "driver.mjs"),
        "validate",
        "--cli-root",
        "/opt/comet-current",
        "--root",
        "/workspace",
    ]
    process = subprocess.run(command, capture_output=True, text=True, timeout=150)
    result["validation_evidence"] = {
        "runtimeCommand": command,
        "runtimeExitCode": process.returncode,
        "runtimeStdout": process.stdout,
        "runtimeStderr": process.stderr,
        "hostToolEvidence": host,
        "assembly": json.loads((root / "assembly-inputs.json").read_text()),
    }
    assert process.returncode == 0, process.stdout + "\n" + process.stderr
    prefix = "COMET_052_A4_VALIDATE_PROOF="
    values = [
        line[len(prefix) :] for line in process.stdout.splitlines() if line.startswith(prefix)
    ]
    assert len(values) == 1, "Missing exact read-only Runtime validation result"
    runtime = json.loads(values[0])
    result["validation_evidence"]["runtime"] = runtime
    assert (
        workflow_validation_passed(workflow, runtime)
        and runtime["baselineHash"] == seed["baselineHash"]
    ), "Runtime evidence differs from actual seed tool result"
    result["passed"] = [
        "Model changed behavior and recorded its own impact judgment",
        "Original Run and requirements retained; affected A checked and unrelated B not replayed",
        "Successor has controller-simulated independent verification and new User acceptance",
        "Archive and one-time side effects completed once",
    ]
    result["validation_evidence"]["scope"] = (
        "Model semantic judgment and Builder continuation only; simulated history, independent Verifier and User, not a model full lifecycle"
    )
except Exception:
    result["failed"] = [traceback.format_exc()]
Path("/workspace/_test_results.json").write_text(json.dumps(result))
print(json.dumps(result))
