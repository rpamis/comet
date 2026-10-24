"""当前 Classic SDK 三种流程的归档、交付和并存状态验收。"""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import yaml

WORKSPACE = Path("/workspace")
RUNTIME_ROOT = Path("/opt/comet-current")
CLI = ["comet"]
CHANGES = Path("docs/openspec/changes")
CASES = {"sentence-full": "full", "characters-tweak": "tweak", "missing-file-hotfix": "hotfix"}
PARKED = "parked-format"
PARKED_PROPOSAL = "# Parked format\nKeep this unrelated formatting request pending.\n"


def invoke(args, *, source=None):
    result = subprocess.run(
        args, cwd=WORKSPACE, input=source, capture_output=True, text=True, timeout=60, check=False
    )
    if result.returncode:
        raise ValueError(f"Command failed: {result.stderr or result.stdout}")
    return json.loads(result.stdout)


def node(module, code, *args, source=None):
    return invoke(
        [
            "node",
            "--input-type=module",
            "-e",
            f"import * as api from {json.dumps((RUNTIME_ROOT / module).as_uri())};" + code,
            *args,
        ],
        source=source,
    )


def state_source(directory):
    relative = directory.relative_to(WORKSPACE)
    cursor = WORKSPACE
    for part in relative.parts:
        cursor /= part
        if cursor.is_symlink():
            raise ValueError("Change path must not contain symlinks")
    found = [
        directory / name
        for name in ("comet-state.yaml", ".comet.yaml")
        if (directory / name).exists() or (directory / name).is_symlink()
    ]
    if len(found) != 1 or found[0].is_symlink() or not found[0].is_file():
        raise ValueError("Expected one regular managed state file")
    source = found[0].read_text()
    if not source.startswith("# comet-execution: managed-run\n"):
        raise ValueError("State is not SDK managed")
    state = yaml.safe_load(source)
    if not isinstance(state, dict):
        raise ValueError("Managed state is invalid")
    return source, state


def inspect_run(name, profile, directory, *, require_checkpoint=True):
    owner = node(
        "dist/domains/workflow-contract/change-runtime-owner.js",
        "process.stdout.write(JSON.stringify(await api.readSdkChangeOwner("
        'process.argv[1],"classic",process.argv[2],{readOnly:true})));',
        str(WORKSPACE),
        name,
    )
    expected = {
        "schema": "comet.change-owner.v1",
        "workflow": "classic",
        "change": name,
        "format": "sdk",
        "application": f"classic-{profile}",
        "runId": name,
    }
    if owner != expected:
        raise ValueError(f"{name}: SDK owner does not match {profile}")
    source, state = state_source(directory)
    with tempfile.TemporaryDirectory(prefix=".eval-inspect-", dir=WORKSPACE) as temporary:
        request = Path(temporary) / "request.json"
        request.write_text(json.dumps({"operation": "inspect", "runId": name}))
        response = invoke(
            [
                *CLI,
                "runtime",
                "dispatch",
                "--application",
                f"classic-{profile}",
                "--project-root",
                str(WORKSPACE),
                "--request",
                str(request),
            ]
        )
    run = response.get("data")
    if (
        response.get("status") != "succeeded"
        or not isinstance(run, dict)
        or run.get("runId") != name
        or run.get("workflow", {}).get("id") != f"comet-classic-{profile}"
    ):
        raise ValueError(f"{name}: inspect returned the wrong SDK Run")
    # 新建 Open 还没有 checkpoint；此例仍须由真实 owner 和 inspect 返回未推进的 Run。
    if not require_checkpoint and "run_checkpoint" not in state:
        return run, state
    if not isinstance(state.get("run_checkpoint"), dict):
        raise ValueError("Managed checkpoint is missing")
    # 交付后保留已提交的归档基线，产品校验器只允许其后的 delivery 演进。
    matches = node(
        "dist/domains/engine/portable-run-checkpoint.js",
        "import {readFileSync} from 'node:fs';"
        f"import YAML from {json.dumps((RUNTIME_ROOT / 'node_modules/yaml/dist/index.js').as_uri())};"
        'const x=JSON.parse(readFileSync(0,"utf8"));'
        f"import {{readClassicSdkDeliveryCheckpoint}} from {json.dumps((RUNTIME_ROOT / 'dist/domains/comet-classic/classic-sdk-delivery-checkpoint.js').as_uri())};"
        "const checkpoint=YAML.parse(x.source).run_checkpoint;"
        "process.stdout.write(JSON.stringify("
        "api.portableRunCheckpointProjectionMatches(checkpoint,x.run) || "
        "readClassicSdkDeliveryCheckpoint(checkpoint,x.run)!==null));",
        source=json.dumps({"source": source, "run": run}),
    )
    if matches is not True:
        raise ValueError(f"{name}: checkpoint does not match its current SDK Run")
    return run, state


def required_steps(profile):
    steps = [f"{profile}.open"]
    if profile == "full":
        steps += [
            "full.open.revalidate",
            "full.design.handoff",
            "full.design.document",
            "full.build.configure",
            "full.build.plan",
        ]
    steps += [
        f"{profile}.{step}"
        for step in (
            "build.execute",
            "build.check",
            "verify.run",
            "verify.check",
            "archive.prepare",
            "archive.preflight",
            "archive.execute",
            "archive.deliver",
        )
    ]
    return steps


def validate_archive(name, profile):
    matches = list((WORKSPACE / CHANGES / "archive").glob(f"????-??-??-{name}"))
    if len(matches) != 1 or (WORKSPACE / CHANGES / name).exists():
        raise ValueError(f"{name}: expected one archive and no remaining active directory")
    directory = matches[0]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}-" + re.escape(name), directory.name):
        raise ValueError(f"{name}: invalid archive name")
    run, state = inspect_run(name, profile, directory)
    for field, expected in {
        "workflow": profile,
        "phase": "archive",
        "verify_result": "pass",
        "archived": True,
    }.items():
        if state.get(field) != expected:
            raise ValueError(f"{name}: wrong terminal {field}")
    if run.get("status") != "completed":
        raise ValueError(f"{name}: SDK delivery is not completed")
    successful = [a for a in run.get("actions", []) if a.get("status") == "succeeded"]
    cursor = iter(a.get("stepId") for a in successful)
    for step in required_steps(profile):
        if not any(observed == step for observed in cursor):
            raise ValueError(f"{name}: missing ordered successful {step}")
    verification = next(a for a in reversed(successful) if a["stepId"] == f"{profile}.verify.check")
    evidence = verification.get("outcome", {}).get("output", {})
    inputs = evidence.get("deliveryInputs", {})
    if (
        "wordcount.py" not in inputs
        or not any(Path(ref).name.startswith("test_") for ref in inputs)
        or any(ref.startswith(f"{CHANGES}/{PARKED}/") for ref in inputs)
    ):
        raise ValueError(f"{name}: verification must bind source/tests, not the parked change")
    manifest = node(
        "dist/domains/comet-classic/classic-protected-path.js",
        "process.stdout.write(JSON.stringify(await api.readClassicProjectFile("
        'process.argv[1],process.argv[2],{label:"eval verify manifest"})));',
        str(WORKSPACE),
        evidence.get("manifestRef", ""),
    )
    if hashlib.sha256(manifest.encode()).hexdigest() != evidence.get("manifestHash"):
        raise ValueError(f"{name}: accepted verify manifest was changed")
    parked_hash = (
        "git:"
        + subprocess.run(
            ["git", "hash-object", "--stdin"],
            input=PARKED_PROPOSAL,
            cwd=WORKSPACE,
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        ).stdout.strip()
    )
    if not any(
        entry.get("p") == f"{CHANGES}/{PARKED}/proposal.md" and entry.get("h") == parked_hash
        for entry in (json.loads(line) for line in manifest.splitlines() if line)
    ):
        raise ValueError(f"{name}: parked change did not coexist during verification")
    archive = next(a for a in reversed(successful) if a["stepId"] == f"{profile}.archive.execute")
    if archive.get("outcome", {}).get("output", {}).get("archiveDirectory") != (
        directory.relative_to(WORKSPACE).as_posix()
    ):
        raise ValueError(f"{name}: archive outcome points at another change")
    delivery = next(a for a in reversed(successful) if a["stepId"] == f"{profile}.archive.deliver")
    output = delivery.get("outcome", {}).get("output", {})
    if output.get("action") != "local" or not re.fullmatch(
        r"[a-f0-9]{40,64}", output.get("commit", "")
    ):
        raise ValueError(f"{name}: local delivery receipt missing")
    receipt = invoke([*CLI, "state", "delivery", name, "--verify", "--json"])
    if receipt.get("exitCode") != 0:
        raise ValueError(f"{name}: delivery no longer verifies")
    tracked = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", output["commit"], "--", str(CHANGES / PARKED)],
        cwd=WORKSPACE,
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    ).stdout
    if tracked.strip():
        raise ValueError(f"{name}: local delivery committed the parked change")
    for artifact in ("proposal.md", "design.md", "tasks.md"):
        path = directory / artifact
        if path.is_symlink() or not path.is_file() or not path.read_text().strip():
            raise ValueError(f"{name}: missing {artifact}")
    return run


def validate_parked():
    directory = WORKSPACE / CHANGES / PARKED
    if list((WORKSPACE / CHANGES / "archive").glob(f"*-{PARKED}")):
        raise ValueError("Parked change was archived")
    run, state = inspect_run(PARKED, "tweak", directory, require_checkpoint=False)
    if state.get("phase") != "open" or state.get("archived") is not False:
        raise ValueError("Parked change advanced")
    proposal = directory / "proposal.md"
    if proposal.is_symlink() or proposal.read_text() != PARKED_PROPOSAL:
        raise ValueError("Parked proposal was changed")
    if any(
        a.get("stepId", "").startswith("tweak.") and a.get("status") == "succeeded"
        for a in run.get("actions", [])
    ):
        raise ValueError("Parked SDK Run advanced")
    tracked = subprocess.run(
        ["git", "ls-files", "--", str(CHANGES / PARKED)],
        cwd=WORKSPACE,
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    ).stdout
    if tracked.strip():
        raise ValueError("Parked change must remain untracked")
    return run


def validate_features():
    for flag, source, expected in (
        ("--sentences", "One. Two?! Last", "Sentences: 3"),
        ("--sentences", "...!?  ", "Sentences: 0"),
        ("--sentences", "", "Sentences: 0"),
        ("--characters", "a b\n", "Characters: 4"),
        ("--characters", "你好", "Characters: 2"),
        ("--words", "one two\nthree", "Words: 3"),
        ("--lines", "one\ntwo\n", "Lines: 2"),
    ):
        result = subprocess.run(
            [sys.executable, "wordcount.py", flag],
            cwd=WORKSPACE,
            input=source,
            text=True,
            capture_output=True,
            timeout=10,
        )
        if result.returncode or expected not in result.stdout.splitlines():
            raise ValueError(f"{flag}: expected exact output line {expected!r}")
    result = subprocess.run(
        [sys.executable, "wordcount.py", "__eval_missing_input__.txt"],
        cwd=WORKSPACE,
        text=True,
        capture_output=True,
        timeout=10,
    )
    if (
        result.returncode != 2
        or "Error: cannot read input file" not in result.stderr
        or "Traceback" in result.stderr
    ):
        raise ValueError("Missing file must exit 2 with a concise error and no traceback")
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q"],
        cwd=WORKSPACE,
        text=True,
        capture_output=True,
        timeout=30,
    )
    if result.returncode:
        raise ValueError(f"Project regression tests failed: {result.stderr}")


def validate_layout():
    config = yaml.safe_load((WORKSPACE / ".comet/config.yaml").read_text())
    if (
        config.get("schema") != "comet.project.v1"
        or "classic" not in config.get("workflows", [])
        or config.get("classic", {}).get("artifact_layout") != "docs"
        or (WORKSPACE / "openspec").exists()
    ):
        raise ValueError("Expected only the configured Classic docs layout")


def main():
    passed, failed = [], []
    checks = [
        ("docs_layout", validate_layout),
        ("parked_change", validate_parked),
        ("features", validate_features),
    ]
    checks += [
        (name, lambda n=name, p=profile: validate_archive(n, p)) for name, profile in CASES.items()
    ]
    for name, check in checks:
        try:
            check()
            passed.append(name)
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            subprocess.SubprocessError,
            yaml.YAMLError,
        ) as error:
            failed.append(f"{name}: {error}")
    output = {"passed": passed, "failed": failed}
    (WORKSPACE / os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")).write_text(
        json.dumps(output, indent=2)
    )
    print(json.dumps(output))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
