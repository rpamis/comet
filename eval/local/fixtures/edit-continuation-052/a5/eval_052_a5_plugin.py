"""A5-only real-tool provenance; history is simulated, model judgment is not."""

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
MODES = ("seed", "checkpoint")


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
    if (
        len(parts) != 7
        or parts[:2] != ["node", f"/workspace/_eval_trusted_oracles/052-a5/{workflow}/driver.mjs"]
        or parts[2] not in MODES
    ):
        return None
    pairs = list(zip(parts[3::2], parts[4::2]))
    options = dict(pairs)
    if len(options) != len(pairs) or any(re.search(r"[;&|`\n]", value) for _, value in pairs):
        return None
    return (
        parts[2]
        if options == {"--cli-root": "/opt/comet-current", "--root": "/workspace"}
        else None
    )


def capture_proofs(stdout, returncode, workflow):
    calls = {}
    results = []
    forbidden = []
    first_bash = None
    order = 0
    agent_calls = {}
    subprocess_calls = {}
    assistant_text = ""
    final_result = ""
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except (ValueError, TypeError):
            continue
        if event.get("type") == "assistant":
            message = event.get("message", {})
            value = texts(message.get("content", []))
            if value.strip():
                assistant_text = value
        if event.get("type") == "result" and isinstance(event.get("result"), str):
            final_result = event["result"]
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
                    order += 1
                    first_bash = first_bash or block["id"]
                    command = args.get("command", "")
                    if re.search(
                        r"(?:git\s+clone|npx|npm\s+(?:i|install)).*superpowers", command, re.I
                    ):
                        forbidden.append("Superpowers install")
                    kind = allowed_controller(command, workflow)
                    if kind and block["id"] not in calls:
                        calls[block["id"]] = {"mode": kind, "command": command, "order": order}
            elif block.get("type") == "tool_result":
                results.append(block)
    proofs = {kind: [] for kind in MODES}
    bindings = []
    seen = set()
    for result in results:
        tool_id = result.get("tool_use_id")
        call = calls.get(tool_id)
        if not call or result.get("is_error") or tool_id in seen:
            continue
        seen.add(tool_id)
        raw = texts(result.get("content"))
        prefix = f"COMET_052_A5_{call['mode'].upper()}_PROOF="
        values = [line[len(prefix) :] for line in raw.splitlines() if line.startswith(prefix)]
        if len(values) != 1:
            continue
        try:
            proof = json.loads(values[0])
        except ValueError:
            continue
        if (
            proof.get("workflow") != workflow
            or proof.get("schema") != f"comet.052.{workflow}-a5.{call['mode']}.v1"
        ):
            continue
        proofs[call["mode"]].append(proof)
        bindings.append(
            {
                **call,
                "toolUseId": tool_id,
                "toolResultHash": digest(raw.encode()),
                "proofHash": digest(values[0].encode()),
            }
        )
    complete = all(len(proofs[kind]) == 1 for kind in MODES)
    return {
        "schema": "comet.052.a5.host-tool-evidence.v1",
        "workflow": workflow,
        "subjectExitCode": returncode,
        "rawStreamHash": digest(stdout.encode()),
        "seedWasFirstBash": any(
            item["mode"] == "seed" and item["toolUseId"] == first_bash for item in bindings
        ),
        "ordered": complete
        and [item["mode"] for item in sorted(bindings, key=lambda row: row["order"])]
        == list(MODES),
        "proofs": proofs,
        "bindings": bindings,
        "forbiddenSkills": forbidden,
        "finalAssistantText": final_result or assistant_text,
        **agent_call_evidence(agent_calls, subprocess_calls),
    }


@pytest.fixture(autouse=True)
def _prepare_052_a5(fixtures, request):
    task = request.config.getoption("--task", default="") or ""
    if "052-pending-feature-decision" not in task:
        yield
        return
    workflow = "native" if "comet-native-052" in task else "classic"
    original_setup = fixtures.setup_test_context
    original_run = fixtures.run_claude

    def setup(*args, **kwargs):
        if os.environ.get("COMET_052_A5_MODEL_AUTHORIZED") != "1":
            raise RuntimeError(
                "A5 model execution is disabled until the final candidate is authorized"
            )
        value = original_setup(*args, **kwargs)
        oracle = fixtures.test_dir / "_eval_trusted_oracles/052-a5"
        for folder in ("native", "classic", "original-a3"):
            shutil.copytree(BASE / folder, oracle / folder, dirs_exist_ok=True)
        shutil.copyfile(BASE / "assembly-inputs.json", oracle / "assembly-inputs.json")
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
                    "scope": "Read-only helper mount; seed from the subject first Bash, explicitly simulated history",
                }
            ),
            encoding="utf-8",
        )
        return value

    def subject(*args, **kwargs):
        result = original_run(*args, **kwargs)
        from scaffold.python.execution import redact_sensitive

        proof = capture_proofs(redact_sensitive(result.stdout), result.returncode, workflow)
        oracle = fixtures.test_dir / "_eval_trusted_oracles/052-a5"
        (oracle / "model-tool-evidence.json").write_text(
            json.dumps(proof, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        if proof["seedWasFirstBash"] and len(proof["proofs"]["seed"]) == 1:
            baseline = proof["proofs"]["seed"][0].get("baseline")
            if (
                isinstance(baseline, dict)
                and baseline.get("schema") == f"comet.052.{workflow}-a5.baseline.v1"
            ):
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
