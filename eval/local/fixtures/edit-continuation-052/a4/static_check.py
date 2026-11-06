"""Static A4 preparation checks. Never invokes Runtime, Docker or any model."""

from pathlib import Path
import ast
import hashlib
import importlib.util
import json
import subprocess
import tomllib

BASE = Path(__file__).resolve().parent
checks = []
for source in sorted(BASE.rglob("*.py")):
    ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    checks.append(f"python-syntax:{source.relative_to(BASE).as_posix()}")
for source in sorted(BASE.rglob("*.mjs")):
    result = subprocess.run(["node", "--check", str(source)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    checks.append(f"node-syntax:{source.relative_to(BASE).as_posix()}")
for source in sorted((BASE / "tasks").rglob("task.toml")):
    data = tomllib.loads(source.read_text(encoding="utf-8"))
    assert data["interaction"]["mode"] == "none"
    assert data["evaluation"]["require_skill_invocation"] is True
    checks.append(f"task-toml:{source.parent.name}")
spec = importlib.util.spec_from_file_location("a4_plugin_static", BASE / "eval_052_a4_plugin.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


def stream(workflow, order=("seed", "checkpoint-judgment", "verify", "approve")):
    events = []
    for index, mode in enumerate(order):
        kind = plugin.MODES[mode]
        proof = {
            "schema": f"comet.052.{workflow}-a4.{kind}.v1",
            "workflow": workflow,
            "baselineHash": "synthetic-test-only",
        }
        command = f"node /workspace/_eval_trusted_oracles/052-a4/{workflow}/driver.mjs {mode} --cli-root /opt/comet-current --root /workspace"
        events.append(
            {
                "type": "assistant",
                "message": {
                    "content": [
                        {
                            "type": "tool_use",
                            "id": str(index),
                            "name": "Bash",
                            "input": {"command": command},
                        }
                    ]
                },
            }
        )
        marker = f"COMET_052_A4_{kind.upper()}_PROOF=" + json.dumps(proof)
        events.append(
            {
                "type": "user",
                "message": {
                    "content": [
                        {"type": "tool_result", "tool_use_id": str(index), "content": marker}
                    ]
                },
            }
        )
    return events


def capture(events, workflow):
    return plugin.capture_proofs("\n".join(json.dumps(event) for event in events), 0, workflow)


for workflow in ("native", "classic"):
    actual = capture(stream(workflow), workflow)
    assert actual["seedWasFirstBash"] and actual["ordered"]
    assert all(len(value) == 1 for value in actual["proofs"].values())
    assert all(item["toolResultHash"] and item["proofHash"] for item in actual["bindings"])
    checks.append(f"proof-parser:{workflow}:complete")
    assert not capture(
        stream(workflow, ("seed", "verify", "checkpoint-judgment", "approve")), workflow
    )["ordered"]
    checks.append(f"proof-parser:{workflow}:reject-order")
    events = stream(workflow)
    events.insert(
        0,
        {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "extra", "name": "Bash", "input": {"command": "pwd"}}
                ]
            },
        },
    )
    assert not capture(events, workflow)["seedWasFirstBash"]
    checks.append(f"proof-parser:{workflow}:reject-late-seed")
    events = stream(workflow)
    events[1]["message"]["content"][0]["tool_use_id"] = "no-matching-controller"
    assert not capture(events, workflow)["ordered"]
    checks.append(f"proof-parser:{workflow}:reject-unmatched-result")
    events = stream(workflow)
    events[1]["message"]["content"][0]["is_error"] = True
    assert not capture(events, workflow)["ordered"]
    checks.append(f"proof-parser:{workflow}:reject-tool-error")
    events = stream(workflow)
    events[1]["message"]["content"][0]["content"] = events[1]["message"]["content"][0][
        "content"
    ].replace(f"{workflow}-a4.seed.v1", f"{workflow}-a4.approve.v1")
    assert not capture(events, workflow)["ordered"]
    checks.append(f"proof-parser:{workflow}:reject-wrong-schema")
    events = stream(workflow)
    events[0]["message"]["content"][0]["input"]["command"] += "; echo forged"
    assert not capture(events, workflow)["ordered"]
    checks.append(f"proof-parser:{workflow}:reject-shell-composition")
    events = stream(workflow)
    command = events[4]["message"]["content"][0]["input"]["command"]
    events[4]["message"]["content"][0]["input"]["command"] = (
        "cat /workspace/.git/052-a4-count-a /workspace/.git/052-a4-count-b "
        "/workspace/.git/052-a4-count-once; echo; " + command
    )
    assert not capture(events, workflow)["ordered"]
    checks.append(f"proof-parser:{workflow}:reject-composed-counter-diagnostics")
    events = stream(workflow)
    events.insert(
        0,
        {
            "type": "assistant",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "id": "skill",
                        "name": "Skill",
                        "input": {"skill": "superpowers:using-superpowers"},
                    }
                ]
            },
        },
    )
    assert capture(events, workflow)["forbiddenSkills"]
    checks.append(f"proof-parser:{workflow}:reject-external-skill")

manifest_path = BASE / "assembly-inputs.json"
if manifest_path.is_file():
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for ref, expected in manifest["originalA3Files"].items():
        file = BASE.parent / "a3" / ref
        assert hashlib.sha256(file.read_bytes()).hexdigest() == expected, (
            f"Original A3 input changed: {ref}"
        )
    checks.append("original-A3-inputs:unchanged-since-assembly")
report = {
    "scope": "Static syntax and synthetic host tool parser only; no Runtime, CLI seed, Docker or model executed",
    "passed": len(checks),
    "checks": checks,
    "modelStarted": False,
}
(BASE / "static-results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
