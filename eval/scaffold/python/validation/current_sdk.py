"""只读检查当前发布 CLI 的 owner、Run 与归档 checkpoint，不接受便携状态替代。"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


def inspect_run(
    workspace: Path,
    workflow: str,
    name: str,
    application: str,
    state_file: Path,
    *,
    package: Path = Path("/opt/comet-current"),
    cli: list[str] | None = None,
) -> dict:
    cli = cli or ["comet"]
    if any(
        path.is_symlink() for path in [state_file, *state_file.parents] if path != workspace.parent
    ):
        raise ValueError("Linked archive paths are not SDK proof")
    source = state_file.read_text(encoding="utf-8")
    if state_file.is_symlink() or not source.startswith("# comet-execution: managed-run\n"):
        raise ValueError("Missing managed SDK checkpoint")
    script = (
        f"import {{readSdkChangeOwner}} from {json.dumps((package / 'dist/domains/workflow-contract/change-runtime-owner.js').as_uri())};"
        "console.log(JSON.stringify(await readSdkChangeOwner(process.argv[1],process.argv[2],process.argv[3],{readOnly:true})));"
    )
    owner = json.loads(
        subprocess.run(
            ["node", "--input-type=module", "-e", script, str(workspace), workflow, name],
            cwd=workspace,
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        ).stdout
    )
    if owner != dict(
        schema="comet.change-owner.v1",
        workflow=workflow,
        change=name,
        format="sdk",
        application=application,
        runId=name,
    ):
        raise ValueError("SDK owner does not match this change and application")
    with tempfile.TemporaryDirectory(prefix=".eval-inspect-", dir=workspace) as directory:
        request = Path(directory) / "request.json"
        request.write_text(json.dumps(dict(operation="inspect", runId=name)))
        response = json.loads(
            subprocess.run(
                [
                    *cli,
                    "runtime",
                    "dispatch",
                    "--application",
                    application,
                    "--project-root",
                    str(workspace),
                    "--request",
                    str(request),
                    "--details",
                ],
                cwd=workspace,
                capture_output=True,
                text=True,
                check=True,
                timeout=60,
            ).stdout
        )
    run = response.get("data")
    if (
        response.get("status") != "succeeded"
        or not isinstance(run, dict)
        or run.get("runId") != name
    ):
        raise ValueError("Current CLI did not inspect the expected SDK Run")
    script = (
        "import {readFileSync} from 'node:fs';"
        f"import {{portableRunCheckpointProjectionMatches}} from {json.dumps((package / 'dist/domains/engine/portable-run-checkpoint.js').as_uri())};"
        f"import YAML from {json.dumps((package / 'node_modules/yaml/dist/index.js').as_uri())};"
        "const {source,run}=JSON.parse(readFileSync(0,'utf8'));"
        "console.log(JSON.stringify(portableRunCheckpointProjectionMatches(YAML.parse(source).run_checkpoint,run)));"
    )
    checked = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=json.dumps(dict(source=source, run=run)),
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    if json.loads(checked.stdout) is not True:
        raise ValueError("Archive checkpoint differs from the current SDK Run")
    return run
