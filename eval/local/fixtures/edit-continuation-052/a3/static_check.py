"""Static suite checks and synthetic proof-parser assertions; never run CLI/model."""

from pathlib import Path
import ast
import json
import hashlib
import tomllib
import yaml
import eval_052_plugin as plugin

base = Path(__file__).resolve().parent
checked = []
for file in [*base.glob("*.py"), *base.glob("tasks/*/validation/*.py")]:
    ast.parse(file.read_text(encoding="utf-8"), filename=str(file))
    checked.append(str(file.relative_to(base)))
for file in base.glob("tasks/*/task.toml"):
    config = tomllib.loads(file.read_text(encoding="utf-8"))
    assert config["interaction"]["mode"] == "none"
    environment = file.parent / "environment"
    assert (environment / "current-comet-package.json").is_file()
    dependencies = json.loads((environment / "current-comet-package.json").read_text())[
        "dependencies"
    ]
    assert ("@fission-ai/openspec" in dependencies) == ("classic" in file.parent.name)
    checked.append(str(file.relative_to(base)))
for file in base.glob("treatments/*/*.yaml"):
    treatments = yaml.safe_load(file.read_text(encoding="utf-8"))
    for value in treatments.values():
        assert all(
            skill["name"] == "comet" or skill["name"].startswith("comet-")
            for skill in value["skills"]
        )
        assert all("assets/skills-zh/" in skill["path"] for skill in value["skills"])
    checked.append(str(file.relative_to(base)))
command = "node /workspace/_eval_trusted_oracles/052/native/controller.mjs prepare-edits --cli-root /opt/comet-current --root /workspace --round 1"
proof = {"schema": 1, "workflow": "native", "round": 1, "saves": 10}


def stream(cmd=command, tool_id="t1", result_id="t1", error=False):
    return "\n".join(
        json.dumps(e)
        for e in [
            {
                "type": "assistant",
                "message": {
                    "content": [
                        {
                            "type": "tool_use",
                            "id": tool_id,
                            "name": "Bash",
                            "input": {"command": cmd},
                        }
                    ]
                },
            },
            {
                "type": "user",
                "message": {
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": result_id,
                            "is_error": error,
                            "content": "COMET_052_EDIT_PROOF=" + json.dumps(proof),
                        }
                    ]
                },
            },
        ]
    )


assert plugin.capture_proofs(stream(), 0, "native")["editProofs"] == [proof]
assert not plugin.capture_proofs(stream(cmd="echo fake"), 0, "native")["editProofs"]
assert not plugin.capture_proofs(stream(result_id="other"), 0, "native")["editProofs"]
assert not plugin.capture_proofs(stream(error=True), 0, "native")["editProofs"]
assert not plugin.capture_proofs(stream(cmd=command + "; echo fake"), 0, "native")["editProofs"]
assert not plugin.capture_proofs(
    stream(cmd=command.replace("/opt/comet-current", "/tmp/fake")), 0, "native"
)["editProofs"]
seed_command = "node /workspace/_eval_trusted_oracles/052/native/driver.mjs seed --cli-root /opt/comet-current --root /workspace --evidence /workspace/.git/052-fixture-evidence"
seed_stream = stream(cmd=seed_command).replace("COMET_052_EDIT_PROOF=", "COMET_052_SEED_PROOF=")
assert plugin.capture_proofs(seed_stream, 0, "native")["seedWasFirstBash"]
other = json.dumps(
    {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "tool_use", "id": "earlier", "name": "Bash", "input": {"command": "pwd"}}
            ]
        },
    }
)
assert not plugin.capture_proofs(other + "\n" + seed_stream, 0, "native")["seedWasFirstBash"]
assert not plugin.capture_proofs(
    seed_stream.replace(seed_command, "echo fabricated seed"), 0, "native"
)["seedProofs"]
report = {
    "passed": True,
    "scope": "Python syntax, task/treatment schema and synthetic tool-proof pairing only",
    "cliExecutions": 0,
    "modelCalls": 0,
    "containerBuilds": 0,
    "files": checked,
    "proofParserCases": 9,
    "hashes": {
        f.name: hashlib.sha256(f.read_bytes()).hexdigest()
        for f in [base / "assemble.py", base / "eval_052_plugin.py", base / "run.py"]
    },
}
(base / "static-check.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
