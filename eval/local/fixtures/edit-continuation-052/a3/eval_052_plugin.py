"""Temporary extension of the existing Eval runner; no product harness changes.

The controller seeds only after normal isolated environment setup. Original
receipts are frozen in the harness's existing read-only oracle mount. Subject
tool outputs are paired with their actual tool call IDs before acceptance.
"""

from pathlib import Path
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess

import pytest
from agent_call_audit import observe_agent_call, agent_call_evidence

BASE = Path(__file__).resolve().parent


def digest(value):
    return hashlib.sha256(value).hexdigest()


def _blocks(value):
    if isinstance(value, dict):
        if value.get("type") in ("tool_use", "tool_result"):
            yield value
        for child in value.values():
            yield from _blocks(child)
    elif isinstance(value, list):
        for child in value:
            yield from _blocks(child)


def _texts(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(_texts(v) for v in value)
    if isinstance(value, dict):
        return value.get("text", "")
    return ""


def _allowed_controller(command, workflow):
    try:
        parts = shlex.split(command)
    except ValueError:
        return None
    mode = parts[2] if len(parts) > 2 else None
    controller = "controller.mjs" if workflow == "native" and mode != "seed" else "driver.mjs"
    prefix = ["node", f"/workspace/_eval_trusted_oracles/052/{workflow}/{controller}"]
    if parts[:2] != prefix or len(parts) < 3:
        return None
    if mode not in ("prepare-edits", "negative-control", "seed") or (
        mode == "seed" and workflow != "native"
    ):
        return None
    if len(parts[3:]) % 2:
        return None
    pairs = list(zip(parts[3::2], parts[4::2]))
    options = dict(pairs)
    if len(options) != len(pairs) or any(re.search(r"[;&|`\n]", v) for _, v in pairs):
        return None
    if options.get("--cli-root") != "/opt/comet-current" or options.get("--root") != "/workspace":
        return None
    keys = (
        {"--cli-root", "--root", "--round"}
        if mode == "prepare-edits"
        else {"--cli-root", "--root", "--evidence"}
        if mode == "seed"
        else {"--cli-root", "--root", "--file"}
    )
    if mode == "seed" and options.get("--evidence") != "/workspace/.git/052-fixture-evidence":
        return None
    return mode if set(options) == keys else None


def capture_proofs(stdout, returncode, workflow):
    calls = {}
    results = []
    forbidden = []
    first_bash = None
    agent_calls = {}
    subprocess_calls = {}
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except (ValueError, TypeError):
            continue
        for block in _blocks(event):
            if block.get("type") == "tool_use":
                observe_agent_call(block, agent_calls, subprocess_calls)
                name = block.get("name", "")
                args = block.get("input", {})
                if name.lower() == "skill":
                    skill = str(args.get("skill", "")).split(":")[-1]
                    if skill != "comet" and not skill.startswith("comet-"):
                        forbidden.append(skill)
                if name.lower() == "bash":
                    if first_bash is None:
                        first_bash = block["id"]
                    command = args.get("command", "")
                    if re.search(
                        r"(?:git\s+clone|npx|npm\s+(?:i|install)).*superpowers", command, re.I
                    ):
                        forbidden.append("Superpowers install")
                    mode = _allowed_controller(command, workflow)
                    if mode:
                        calls[block["id"]] = {"mode": mode, "command": command}
            elif block.get("type") == "tool_result":
                results.append(block)
    edits = []
    negative = []
    seeds = []
    bindings = []
    seen = set()
    for result in results:
        call = calls.get(result.get("tool_use_id"))
        if not call or result.get("is_error"):
            continue
        if result.get("tool_use_id") in seen:
            continue
        seen.add(result.get("tool_use_id"))
        text = _texts(result.get("content"))
        prefix = (
            "COMET_052_EDIT_PROOF="
            if call["mode"] == "prepare-edits"
            else "COMET_052_SEED_PROOF="
            if call["mode"] == "seed"
            else "COMET_052_NEGATIVE_CONTROL_PROOF="
        )
        found = [line.split(prefix, 1)[1] for line in text.splitlines() if line.startswith(prefix)]
        if len(found) != 1:
            continue
        try:
            proof = json.loads(found[0])
        except ValueError:
            continue
        if proof.get("workflow") != workflow:
            continue
        (
            edits
            if call["mode"] == "prepare-edits"
            else seeds
            if call["mode"] == "seed"
            else negative
        ).append(proof)
        bindings.append(
            {
                "mode": call["mode"],
                "toolUseId": result["tool_use_id"],
                "command": call["command"],
                "toolResultHash": digest(text.encode()),
                "proofHash": digest(found[0].encode()),
            }
        )
    seed_first = any(b["mode"] == "seed" and b["toolUseId"] == first_bash for b in bindings)
    return {
        "schema": 1,
        "workflow": workflow,
        "subjectExitCode": returncode,
        "rawStreamHash": digest(stdout.encode()),
        "seedProofs": seeds,
        "seedWasFirstBash": seed_first,
        "editProofs": edits,
        "negativeProofs": negative,
        "bindings": bindings,
        "forbiddenSkills": forbidden,
        **agent_call_evidence(agent_calls, subprocess_calls),
    }


@pytest.fixture(autouse=True)
def _prepare_052(fixtures, request):
    task_option = request.config.getoption("--task", default="") or ""
    if "052-edit-continuation" not in task_option:
        yield
        return
    workflow = "native" if "comet-native-052" in task_option else "classic"
    original_setup = fixtures.setup_test_context
    original_run = fixtures.run_claude

    def setup(*args, **kwargs):
        if os.environ.get("COMET_052_MODEL_AUTHORIZED") != "1":
            raise RuntimeError(
                "052 preparation only: model execution is disabled until the parent authorizes the frozen candidate"
            )
        result = original_setup(*args, **kwargs)
        oracle = fixtures.test_dir / "_eval_trusted_oracles/052"
        for kind in ("native", "classic"):
            destination = oracle / kind
            destination.mkdir(parents=True, exist_ok=True)
            for source in (BASE / kind).glob("*.mjs"):
                shutil.copyfile(source, destination / source.name)
        if workflow == "native":
            # Native binds hostname and every environment entry. Its trusted
            # offline seed runs in the subject's first Bash tool, on the same
            # container and inherited tool environment as later continuation.
            helper_files = {
                p.relative_to(oracle).as_posix(): digest(p.read_bytes())
                for p in sorted(oracle.rglob("*"))
                if p.is_file()
            }
            (oracle / "seed-bindings.json").write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "workflow": workflow,
                        "scope": "Trusted seed helper; baseline will come only from the first real Bash tool result",
                        "files": helper_files,
                    }
                ),
                encoding="utf-8",
            )
            return result
        from scaffold.python.utils import run_command_in_docker, build_docker_image

        if os.name == "nt":
            image = build_docker_image(fixtures.test_dir, agent="claude-code")
            if not image:
                raise AssertionError("052 seed image could not be built")
            # Same mount-root-only owner normalization as docker.sh's subject
            # entry. run-command does not perform it before the offline seed.
            owner = subprocess.run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--user",
                    "root",
                    "-v",
                    f"{fixtures.test_dir.resolve()}:/workspace",
                    image,
                    "sh",
                    "-ec",
                    'owner="$(id -u agent):$(id -g agent)"; if [ "$(stat -c %u:%g /workspace)" != "$owner" ]; then chown --no-dereference "$owner" /workspace; fi; test "$(stat -c %u:%g /workspace)" = "$owner"',
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if owner.returncode:
                raise AssertionError(
                    f"Isolated workspace owner normalization failed: {owner.stderr}"
                )
        command = f"node /workspace/_eval_trusted_oracles/052/{workflow}/driver.mjs seed --cli-root /opt/comet-current --root /workspace --evidence /workspace/.git/052-fixture-evidence"
        seeded = run_command_in_docker(fixtures.test_dir, command, timeout=600)
        (oracle / "seed-process.json").write_text(
            json.dumps(
                {
                    "command": command,
                    "exitCode": seeded.returncode,
                    "stdout": seeded.stdout,
                    "stderr": seeded.stderr,
                }
            ),
            encoding="utf-8",
        )
        if seeded.returncode:
            raise AssertionError(f"Offline fixture seed failed: {seeded.stdout}\n{seeded.stderr}")
        evidence = fixtures.test_dir / ".git/052-fixture-evidence"
        names = ["baseline.json"] if workflow == "native" else ["fixture.json", "baseline.json"]
        for filename in names:
            shutil.copyfile(evidence / filename, oracle / workflow / filename)
        baseline_files = {
            p.relative_to(oracle).as_posix(): digest(p.read_bytes())
            for p in sorted(oracle.rglob("*"))
            if p.is_file()
        }
        (oracle / "seed-bindings.json").write_text(
            json.dumps(
                {
                    "schema": 1,
                    "workflow": workflow,
                    "scope": "Offline simulated Agent/User seed; not model evidence",
                    "files": baseline_files,
                }
            ),
            encoding="utf-8",
        )
        return result

    def subject(*args, **kwargs):
        result = original_run(*args, **kwargs)
        from scaffold.python.execution import redact_sensitive

        proof = capture_proofs(redact_sensitive(result.stdout), result.returncode, workflow)
        oracle = fixtures.test_dir / "_eval_trusted_oracles/052"
        (oracle / "model-tool-evidence.json").write_text(
            json.dumps(proof, indent=2), encoding="utf-8"
        )
        if workflow == "native" and len(proof["seedProofs"]) == 1 and proof["seedWasFirstBash"]:
            baseline = proof["seedProofs"][0].get("baseline")
            if (
                isinstance(baseline, dict)
                and baseline.get("schema") == "comet.052.native.seed-baseline.v1"
            ):
                (oracle / "native/baseline.json").write_text(
                    json.dumps(baseline, ensure_ascii=False), encoding="utf-8"
                )
        if workflow == "classic":
            if len(proof["negativeProofs"]) == 1:
                (oracle / "classic/negative-control-proof.json").write_text(
                    json.dumps(proof["negativeProofs"][0]), encoding="utf-8"
                )
            if len(proof["editProofs"]) == 1:
                (oracle / "classic/edit-proof.json").write_text(
                    json.dumps(proof["editProofs"][0]), encoding="utf-8"
                )
        return result

    fixtures.setup_test_context = setup
    fixtures.run_claude = subject
    try:
        yield
    finally:
        fixtures.setup_test_context = original_setup
        fixtures.run_claude = original_run
