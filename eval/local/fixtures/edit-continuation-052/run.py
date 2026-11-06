"""使用既有 Eval 入口收集或显式执行一个固定模型场景。凭据仅来自环境。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

SCENARIOS = {
    "a3": ("eval_052_plugin", "edit-continuation", "", "COMET_052_MODEL_AUTHORIZED", 2700),
    "a4": (
        "eval_052_a4_plugin",
        "authorized-implementation",
        "_A4",
        "COMET_052_A4_MODEL_AUTHORIZED",
        2700,
    ),
    "a5": (
        "eval_052_a5_plugin",
        "pending-feature-decision",
        "_A5",
        "COMET_052_A5_MODEL_AUTHORIZED",
        1800,
    ),
}


def verify_files(root: Path, files: dict[str, str]) -> None:
    for relative, expected in files.items():
        file = (root / relative).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            raise ValueError(f"Frozen input is missing or outside its root: {relative}")
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Frozen input changed; prepare a new output directory: {relative}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assembly", type=Path, required=True)
    parser.add_argument("--scenario", choices=SCENARIOS, required=True)
    parser.add_argument("--workflow", choices=("native", "classic"), required=True)
    parser.add_argument("--mode", choices=("collect", "model"), default="collect")
    parser.add_argument("--authorize-model", action="store_true")
    parser.add_argument("--model")
    options = parser.parse_args()
    if options.mode == "model" and not options.authorize_model:
        parser.error("Model execution requires --authorize-model; no model started")
    if options.mode == "model" and not options.model:
        parser.error("Select the actual model explicitly with --model")
    assembly = options.assembly.resolve()
    prepared = json.loads((assembly / "prepared.json").read_text(encoding="utf-8"))
    folder = assembly / options.scenario
    manifest = json.loads((folder / "assembly-inputs.json").read_text(encoding="utf-8"))
    cli_root = Path(prepared["cliRoot"]).resolve()
    harness = Path(prepared["harnessRoot"]).resolve()
    try:
        if Path(manifest["cliRoot"]).resolve() != cli_root:
            raise ValueError("The prepared CLI identity differs from the selected scenario")
        verify_files(Path(prepared["sourceRoot"]).resolve(), prepared["sourceFiles"])
        verify_files(folder, manifest["files"])
        verify_files(cli_root, manifest["candidateFiles"])
        if "originalA3Files" in manifest:
            verify_files(assembly / "a3", manifest["originalA3Files"])
        for group, files in manifest.get("originalSuites", {}).items():
            verify_files(assembly / group, files)
    except ValueError as error:
        parser.error(str(error))

    plugin, suffix, treatment_suffix, authorization, timeout = SCENARIOS[options.scenario]
    task = f"comet-{options.workflow}-052-{suffix}"
    treatment = f"COMET_{options.workflow.upper()}_052{treatment_suffix}_OWN_ONLY"
    env = dict(os.environ)
    for _, _, _, flag, _ in SCENARIOS.values():
        env.pop(flag, None)
    env.update(
        PYTHON_DOTENV_DISABLED="1",
        BENCH_COMET_SOURCE_ROOT=str(cli_root),
        BENCH_TASKS_DIR=str(folder / "tasks"),
        BENCH_TREATMENTS_DIR=str(folder / "treatments"),
        BENCH_LOGS_DIR=str(folder / "logs"),
        BENCH_CC_VERSION="2.1.310",
        ENABLE_TOOL_SEARCH="false",
        BENCH_LLM_JUDGE="0",
        COMET_EVAL_EXPERIMENT_ID=f"052_{options.workflow}_{options.scenario}_{uuid.uuid4().hex}",
        PYTHONPATH=os.pathsep.join([str(folder), str(harness / "eval"), env.get("PYTHONPATH", "")]),
    )
    if options.mode == "model":
        env[authorization] = "1"
    # 每次使用尚不存在的目录；pytest 不会删除其他实验的工作区。
    workspaces = folder / "workspaces"
    temporary = (workspaces / uuid.uuid4().hex).resolve()
    if temporary.exists() or not temporary.is_relative_to(folder):
        parser.error("Unsafe or existing pytest workspace")
    workspaces.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "pytest",
        "-p",
        plugin,
        "local/tests/tasks/test_tasks.py::test_task_treatment",
        f"--task={task}",
        f"--treatment={treatment}",
        "--skill-path",
        str(cli_root / "assets/skills-zh" / f"comet-{options.workflow}"),
        "--project-root",
        str(folder / f"{options.workflow}-owner"),
        "--agent",
        "claude-code",
        "--model",
        options.model or "collection-only",
        "--count",
        "1",
        "--agent-timeout",
        str(timeout),
        "--basetemp",
        str(temporary),
        "-o",
        "tmp_path_retention_count=100",
        "-o",
        "tmp_path_retention_policy=all",
        "-v",
    ]
    if options.mode == "collect":
        command.extend(["--collect-only", "-q"])
    return subprocess.run(command, cwd=harness / "eval", env=env, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
