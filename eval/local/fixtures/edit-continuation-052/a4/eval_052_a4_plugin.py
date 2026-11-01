"""A4-only temporary Eval extension. Never changes the original A3 tasks."""

from pathlib import Path
import hashlib
import json
import os
import re
import shlex
import shutil
import pytest
from agent_call_audit import observe_agent_call, agent_call_evidence

BASE = Path(__file__).resolve().parent
MODES = {
    "seed": "seed",
    "checkpoint-judgment": "judgment",
    "verify": "verify",
    "approve": "approve",
}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def blocks(value):
    if isinstance(value, dict):
        if value.get("type") in ("tool_use", "tool_result"):
            yield value
        for child in value.values():
            yield from blocks(child)
    elif isinstance(value, list):
        for child in value:
            yield from blocks(child)


def texts(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(texts(child) for child in value)
    return value.get("text", "") if isinstance(value, dict) else ""


def allowed_controller(command, workflow):
    try:
        parts = shlex.split(command)
    except (ValueError, TypeError):
        return None
    if len(parts) != 7 or parts[:2] != [
        "node",
        f"/workspace/_eval_trusted_oracles/052-a4/{workflow}/driver.mjs",
    ]:
        return None
    if parts[2] not in MODES:
        return None
    pairs = list(zip(parts[3::2], parts[4::2]))
    options = dict(pairs)
    if len(options) != len(pairs) or any(re.search(r"[;&|`\n]", value) for _, value in pairs):
        return None
    if options != {"--cli-root": "/opt/comet-current", "--root": "/workspace"}:
        return None
    return MODES[parts[2]]


def capture_proofs(stdout, returncode, workflow):
    calls = {}
    results = []
    forbidden = []
    first_bash = None
    call_order = 0
    agent_calls = {}
    subprocess_calls = {}
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except (ValueError, TypeError):
            continue
        for block in blocks(event):
            if block.get("type") == "tool_use":
                observe_agent_call(block, agent_calls, subprocess_calls)
                name = str(block.get("name", "")).lower()
                args = block.get("input", {})
                if name == "skill":
                    skill = str(args.get("skill", "")).split(":")[-1]
                    if skill != "comet" and not skill.startswith("comet-"):
                        forbidden.append(skill)
                if name == "bash":
                    call_order += 1
                    first_bash = first_bash or block["id"]
                    command = args.get("command", "")
                    if re.search(
                        r"(?:git\s+clone|npx|npm\s+(?:i|install)).*superpowers", command, re.I
                    ):
                        forbidden.append("Superpowers install")
                    mode = allowed_controller(command, workflow)
                    if mode and block["id"] not in calls:
                        calls[block["id"]] = {"mode": mode, "command": command, "order": call_order}
            elif block.get("type") == "tool_result":
                results.append(block)
    proofs = {mode: [] for mode in MODES.values()}
    bindings = []
    seen = set()
    for result in results:
        tool_id = result.get("tool_use_id")
        call = calls.get(tool_id)
        if not call or result.get("is_error") or tool_id in seen:
            continue
        seen.add(tool_id)
        text = texts(result.get("content"))
        prefix = f"COMET_052_A4_{call['mode'].upper()}_PROOF="
        values = [line[len(prefix) :] for line in text.splitlines() if line.startswith(prefix)]
        if len(values) != 1:
            continue
        try:
            proof = json.loads(values[0])
        except ValueError:
            continue
        if (
            proof.get("workflow") != workflow
            or proof.get("schema") != f"comet.052.{workflow}-a4.{call['mode']}.v1"
        ):
            continue
        proofs[call["mode"]].append(proof)
        bindings.append(
            {
                **call,
                "toolUseId": tool_id,
                "toolResultHash": digest(text.encode()),
                "proofHash": digest(values[0].encode()),
            }
        )
    seed_first = any(
        item["mode"] == "seed" and item["toolUseId"] == first_bash for item in bindings
    )
    complete = all(len(proofs[mode]) == 1 for mode in proofs)
    ordered = complete and [
        item["mode"] for item in sorted(bindings, key=lambda row: row["order"])
    ] == ["seed", "judgment", "verify", "approve"]
    return {
        "schema": "comet.052.a4.host-tool-evidence.v1",
        "workflow": workflow,
        "subjectExitCode": returncode,
        "rawStreamHash": digest(stdout.encode()),
        "seedWasFirstBash": seed_first,
        "ordered": ordered,
        "proofs": proofs,
        "bindings": bindings,
        "forbiddenSkills": forbidden,
        **agent_call_evidence(agent_calls, subprocess_calls),
    }


@pytest.fixture(autouse=True)
def _prepare_052_a4(fixtures, request):
    task = request.config.getoption("--task", default="") or ""
    if "052-authorized-implementation" not in task:
        yield
        return
    workflow = "native" if "comet-native-052" in task else "classic"
    original_setup = fixtures.setup_test_context
    original_run = fixtures.run_claude

    def setup(*args, **kwargs):
        if os.environ.get("COMET_052_A4_MODEL_AUTHORIZED") != "1":
            raise RuntimeError(
                "A4 model execution is disabled until the frozen candidate is authorized"
            )
        value = original_setup(*args, **kwargs)
        oracle = fixtures.test_dir / "_eval_trusted_oracles/052-a4"
        for kind in ("native", "classic"):
            destination = oracle / kind
            destination.mkdir(parents=True, exist_ok=True)
            for source in (BASE / kind).glob("*.mjs"):
                shutil.copyfile(source, destination / source.name)
        manifest = json.loads((BASE / "assembly-inputs.json").read_text(encoding="utf-8"))
        (oracle / "assembly-inputs.json").write_text(json.dumps(manifest), encoding="utf-8")
        helper_files = {
            file.relative_to(oracle).as_posix(): digest(file.read_bytes())
            for file in sorted(oracle.rglob("*.mjs"))
        }
        (oracle / "helper-bindings.json").write_text(
            json.dumps(
                {
                    "schema": 1,
                    "workflow": workflow,
                    "files": helper_files,
                    "scope": "Read-only helpers; history seed is the subject first Bash and is explicitly simulated",
                }
            ),
            encoding="utf-8",
        )
        return value

    def subject(*args, **kwargs):
        result = original_run(*args, **kwargs)
        from scaffold.python.execution import redact_sensitive

        proof = capture_proofs(redact_sensitive(result.stdout), result.returncode, workflow)
        oracle = fixtures.test_dir / "_eval_trusted_oracles/052-a4"
        (oracle / "model-tool-evidence.json").write_text(
            json.dumps(proof, indent=2), encoding="utf-8"
        )
        if proof["seedWasFirstBash"] and len(proof["proofs"]["seed"]) == 1:
            baseline = proof["proofs"]["seed"][0].get("baseline")
            if isinstance(baseline, dict):
                (oracle / workflow / "baseline.json").write_text(
                    json.dumps(baseline, ensure_ascii=False), encoding="utf-8"
                )
        return result

    fixtures.setup_test_context = setup
    fixtures.run_claude = subject
    try:
        yield
    finally:
        fixtures.setup_test_context = original_setup
        fixtures.run_claude = original_run
