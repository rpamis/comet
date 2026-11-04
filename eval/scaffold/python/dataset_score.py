"""仅在 Agent 结束后的隔离评分容器内执行。"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
import importlib.util
import re
from types import SimpleNamespace


class LocalEnvironment:
    capabilities = SimpleNamespace(mounted=True)

    async def exec(self, command, cwd=None, env=None, timeout_sec=None, **kwargs):
        try:
            result = subprocess.run(
                command,
                shell=True,
                executable="/bin/bash",
                cwd=cwd,
                env={**os.environ, **(env or {})},
                timeout=timeout_sec,
                capture_output=True,
                text=True,
            )
            return SimpleNamespace(
                return_code=result.returncode, stdout=result.stdout, stderr=result.stderr
            )
        except subprocess.TimeoutExpired:
            return SimpleNamespace(return_code=124, stdout="", stderr="Verifier timeout")

    async def upload_dir(self, source_dir, target_dir):
        shutil.copytree(source_dir, target_dir, dirs_exist_ok=True)

    async def upload_file(self, source_path, target_path):
        Path(target_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target_path)

    async def download_dir(self, source_dir, target_dir):
        shutil.copytree(source_dir, target_dir, dirs_exist_ok=True)


def workbuddy_verifier_status(details):
    """使用原评分器的结构化记录区分业务失败和执行中断。"""
    judges = details.get("judges")
    if not isinstance(judges, list) or not judges:
        return "unknown"
    statuses = []
    for judge in judges:
        if not isinstance(judge, dict):
            return "unknown"
        metadata = judge.get("metadata") or {}
        phase = metadata.get("test_status") if isinstance(metadata, dict) else None
        if phase == "timeout":
            return "timeout"
        if phase == "build_error" or judge.get("ok") is False or judge.get("errors"):
            return "test_error"
        if phase not in {None, "pass", "all_pass", "partial_pass", "no_pass"}:
            return "unknown"
        status = judge.get("status")
        if judge.get("ok") is not True or status not in {"pass", "fail"}:
            return "unknown"
        statuses.append(status)
    return "assertion_failed" if "fail" in statuses else "completed"


async def workbuddy(task):
    from workbuddy_bench.judge.runtime import HarborAttemptRuntime
    from workbuddy_bench.judge.registry import (
        load_verifier_contract,
        RegistryBuildContext,
        load_verifier_registry,
        build_default_context,
        maybe_await,
    )
    import tomllib

    config = tomllib.loads((task / "task.toml").read_text())
    log = Path("/logs/verifier")
    log.mkdir(parents=True, exist_ok=True)
    verifier = SimpleNamespace(
        task=SimpleNamespace(
            short_name=task.name,
            paths=SimpleNamespace(task_dir=task, tests_dir=task / "tests"),
            config=SimpleNamespace(
                verifier=SimpleNamespace(env=config.get("verifier", {}).get("env", {}))
            ),
        ),
        trial_paths=SimpleNamespace(reward_json_path=log / "reward.json"),
    )
    runtime = HarborAttemptRuntime(
        verifier=verifier,
        environment=LocalEnvironment(),
        tests_dir="/tests",
        workspace="/workspace",
        container_verifier_dir=str(log),
        host_verifier_dir=log,
    )
    contract = load_verifier_contract(task)
    registry = load_verifier_registry(
        RegistryBuildContext(contract=contract, runtime=runtime, verifier=verifier)
    )
    if registry.custom_verify is not None:
        raise ValueError("尚不支持自定义评分入口")
    await runtime.upload_tests()
    context = build_default_context(contract, runtime)
    if registry.prepare is not None:
        await maybe_await(registry.prepare(context))
    plan = await maybe_await(registry.plan_builder(context))
    score = await registry.engine().run(context, plan)
    if registry.finalize_score is not None:
        score = await maybe_await(registry.finalize_score(score, context, plan))
    runtime.write_score(score)
    rewards = score.reward_payload()
    if "reward" not in rewards:
        raise ValueError(f"缺少 reward 原始评分：{rewards}")
    details = score.score_payload()
    return {
        "reward": rewards["reward"],
        "raw": rewards,
        "details": details,
        "verifier_status": workbuddy_verifier_status(details),
    }


def inspect_native_verification(execution):
    expected = execution.get("expectedNativeMode")
    if expected is None:
        return None
    try:
        if expected not in {"standard", "bugfree"} or execution.get("nativeInspectionError"):
            raise ValueError(execution.get("nativeInspectionError") or "无效的验证模式")
        spec = importlib.util.spec_from_file_location(
            "comet_dataset_sdk_inspection", "/opt/comet-sdk-inspection.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        workspace = Path("/workspace")
        changes = workspace / "docs/comet/changes"
        if changes.exists() and any(
            item.is_dir() or item.is_symlink() for item in changes.iterdir()
        ):
            raise ValueError("仍有未完成的 Native change")
        runs = {}
        for directory in (workspace / "docs/comet/archive").iterdir():
            if not directory.is_dir():
                continue
            match = re.fullmatch(
                r"[0-9]{4}-[0-9]{2}-[0-9]{2}-([a-z0-9]+(?:-[a-z0-9]+)*)", directory.name
            )
            if not match or directory.is_symlink():
                raise ValueError("归档目录身份无效")
            name = match.group(1)
            run = module.inspect_run(
                workspace, "native", name, "native", directory / "comet-state.yaml"
            )
            if (
                run.get("status") != "completed"
                or run.get("workflow", {}).get("id") != "comet-native"
                or run.get("lineage")
            ):
                raise ValueError("Native 根 Run 尚未完成")
            runs[name] = module.sdk_inspection_evidence("native", "native", run)
        if not runs:
            raise ValueError("没有可核对创建时模式的 Native 根 Run")
        return {
            "status": "matched"
            if all(
                item["run"].get("input", {}).get("verifyMode", "standard") == expected
                for item in runs.values()
            )
            else "mismatch",
            "expectedMode": expected,
            "runs": runs,
        }
    except Exception as exc:
        return {"status": "unavailable", "expectedMode": expected, "reason": str(exc)}


def main():
    dataset, name = sys.argv[1:]
    task = Path("/opt/dataset-original/tasks") / name
    if not task.is_dir():
        raise ValueError("评分任务不存在")
    execution_file = Path("/opt/comet-dataset-execution.json")
    execution = (
        json.loads(execution_file.read_text(encoding="utf-8")) if execution_file.is_file() else {}
    )
    native_verification = inspect_native_verification(execution)
    if dataset == "workbuddy-code":
        result = asyncio.run(workbuddy(task))
    else:
        import re

        target = Path("/verifier")
        shutil.copytree(task / "verifier", target, dirs_exist_ok=True)
        execution_file = Path("/opt/comet-dataset-execution.json")
        execution = (
            json.loads(execution_file.read_text(encoding="utf-8"))
            if execution_file.is_file()
            else {}
        )
        verifier = execution.get("verifier", {})
        # 仅清理隔离评分副本；不删除主体候选，也不改原始 verifier。
        cleanup_roots = (
            [
                Path("/workspace"),
                Path("/root"),
                Path("/app"),
                Path("/data"),
                Path("/outputs"),
                Path("/opt/syzkaller"),
                Path("/home/agent"),
            ]
            if execution
            else []
        )
        for root in cleanup_roots:
            if root.is_dir():
                patterns = ["sitecustomize.py", "usercustomize.py", "*.pth"]
                if verifier.get("cleanupConftests"):
                    patterns.append("conftest.py")
                for file in (file for pattern in patterns for file in root.rglob(pattern)):
                    if not file.is_symlink():
                        file.unlink()
        environment = dict(os.environ)
        for key, value in verifier.get("env", {}).items():
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) or re.search(
                r"secret|password|token|api_?key|credential", key, re.I
            ):
                raise ValueError("评分环境不能包含凭据或无效名称")
            environment[key] = str(value)
        reward = Path("/logs/verifier/reward.txt")
        reward.parent.mkdir(parents=True, exist_ok=True)
        reward.unlink(missing_ok=True)
        observer = reward.parent / ("comet-pytest-" + uuid.uuid4().hex + ".jsonl")
        environment["COMET_DATASET_OBSERVER"] = str(observer)
        environment["COMET_DATASET_REQUIRED_PLUGINS"] = json.dumps(
            verifier.get("pytestPlugins", [])
        )
        environment["PYTHONPATH"] = "/opt/comet-observer"
        environment["PYTHONNOUSERSITE"] = "1"
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        environment["UV_CACHE_DIR"] = "/opt/comet-verifier-cache/uv"
        environment["PIP_CACHE_DIR"] = "/opt/comet-verifier-cache/pip"
        environment["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
        environment["COMET_DATASET_PLUGIN_POLICY"] = "root-owned"
        environment["PYTEST_ADDOPTS"] = (
            "-c /dev/null --confcutdir=/verifier --rootdir=/workspace -p no:cacheprovider"
        )
        environment["PYTEST_PLUGINS"] = "dataset_pytest_observer"
        try:
            status = subprocess.run(
                ["bash", str(target / "test.sh")],
                cwd="/workspace",
                timeout=execution.get("verifierTimeoutSeconds", 3600),
                env=environment,
            )
        except subprocess.TimeoutExpired:
            result = {
                "reward": json.loads(reward.read_text()) if reward.is_file() else None,
                "verifier_status": "timeout",
            }
            if native_verification is not None:
                result["native_verification"] = native_verification
            print("COMET_DATASET_REWARD=" + json.dumps(result, allow_nan=False))
            raise
        if status.returncode != 0 and not reward.is_file():
            raise ValueError(f"评分脚本失败：{status.returncode}")
        observations = (
            [json.loads(line) for line in observer.read_text(encoding="utf-8").splitlines()]
            if observer.is_file()
            else []
        )
        statuses = [item["status"] for item in observations]
        verifier_status = next(
            (
                state
                for state in (
                    "environment_error",
                    "collection_error",
                    "test_error",
                    "not_executed",
                    "assertion_failed",
                )
                if state in statuses
            ),
            "completed" if statuses else "script_error" if status.returncode != 0 else "unknown",
        )
        result = {
            "reward": json.loads(reward.read_text()),
            "raw": reward.read_text(),
            "verifier_status": verifier_status,
            "test_runs": observations,
        }
    if native_verification is not None:
        result["native_verification"] = native_verification
    print("COMET_DATASET_REWARD=" + json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
