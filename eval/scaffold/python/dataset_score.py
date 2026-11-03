"""仅在 Agent 结束后的隔离评分容器内执行。"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
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
    return {"reward": rewards["reward"], "raw": rewards, "details": score.score_payload()}


def main():
    dataset, name = sys.argv[1:]
    task = Path("/opt/dataset-original/tasks") / name
    if not task.is_dir():
        raise ValueError("评分任务不存在")
    if dataset == "workbuddy-code":
        result = asyncio.run(workbuddy(task))
    else:
        target = Path("/verifier")
        shutil.copytree(task / "verifier", target, dirs_exist_ok=True)
        reward = Path("/logs/verifier/reward.txt")
        reward.parent.mkdir(parents=True, exist_ok=True)
        reward.unlink(missing_ok=True)
        status = subprocess.run(["bash", str(target / "test.sh")], cwd="/workspace", timeout=3600)
        if status.returncode != 0:
            raise ValueError(f"评分脚本失败：{status.returncode}")
        result = {"reward": json.loads(reward.read_text()), "raw": reward.read_text()}
    print("COMET_DATASET_REWARD=" + json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
