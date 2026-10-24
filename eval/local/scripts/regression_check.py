"""验证当前候选的完整 Eval；默认不更改 baseline，也不使用历史最新报告。

完整运行：uv run python local/scripts/regression_check.py --suite current --count 1
先收集：uv run python local/scripts/regression_check.py --collect-only --count 1
复核指定实验：uv run python local/scripts/regression_check.py --experiment <id> --count 1
初始化新基线：加 --initialize-baseline <new-file.json>，只接受完整、健康的指定实验。
发布凭证复核：uv run python local/scripts/regression_check.py --verify-receipt <release-gate.json>

退出码：0=请求的检查完成，1=评估/质量检查失败，2=参数、基线或证据错误。
--collect-only 和 --initialize-baseline 不产生发布通过凭证。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

EVAL_ROOT = Path(__file__).resolve().parents[2]
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from scaffold.python.paths import get_logs_dir  # noqa: E402
from scaffold.python.release_gate import (  # noqa: E402
    BASELINE_SCHEMA,
    RECEIPT_SCHEMA,
    GateError,
    candidate_identity,
    checked_count,
    compare_baseline,
    digest_json,
    expected_matrix,
    means_from_evidence,
    read_json,
    suite_contract,
    validate_baseline,
    validate_experiment,
)

BASELINE_FILE = EVAL_ROOT / "local/release_baseline.json"
RECEIPT_FILE = "release-gate.json"


def _write_json(path: Path, value: dict, *, exclusive: bool = False) -> None:
    if path.is_symlink():
        raise GateError(f"不能写入链接：{path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x" if exclusive else "w", encoding="utf-8") as stream:
        stream.write(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def _prepare_candidate() -> None:
    """显式完整运行才构建；查询、复核和初始化不调用构建或模型。"""
    commands = [
        ["node", f"scripts/build/{script}", "--check"]
        for script in (
            "build-runtime-schemas.mjs",
            "build-classic-runtime.mjs",
            "build-native-runtime.mjs",
            "build-entry-runtime.mjs",
        )
    ]
    commands.extend(
        [
            ["node", "build.js"],
            ["node", "scripts/release/check-sdk-api.mjs"],
            ["node", "scripts/lint/core-regressions.mjs"],
        ]
    )
    for command in commands:
        result = subprocess.run(command, cwd=EVAL_ROOT.parent, check=False)
        if result.returncode != 0:
            raise GateError(f"模型启动前检查失败：{' '.join(command)}；未启动模型")


def _run_eval(count: int, model: str | None = None, workers: int = 2) -> str:
    """预先分配唯一实验 ID；任何 pytest 非零都停止，不搜索旧报告。"""
    checked_count(count)
    _prepare_candidate()
    experiment_id = "release_" + uuid.uuid4().hex
    experiment_dir = get_logs_dir() / "experiments" / experiment_id
    experiment_dir.mkdir(parents=True, exist_ok=False)
    env = dict(os.environ)
    for key in env:
        if key.startswith("COMET_EVAL_") and key not in {"COMET_EVAL_EXPERIMENT_ID"}:
            raise GateError("发布检查不能混用受管 Skill/应用评估或失败重跑上下文")
    env.update(
        {
            "COMET_EVAL_EXPERIMENT_ID": experiment_id,
            "COMET_EVAL_RELEASE_SUITE": "current",
            "BENCH_SUITE_ROOT": str(EVAL_ROOT / "local"),
            "BENCH_TASKS_DIR": str(EVAL_ROOT / "local/tasks"),
            "BENCH_TREATMENTS_DIR": str(EVAL_ROOT / "local/treatments"),
            "BENCH_SKILLS_DIR": str(EVAL_ROOT / "local/skills"),
            "BENCH_COMET_SOURCE_ROOT": str(EVAL_ROOT.parent),
            "BENCH_LOGS_DIR": str(get_logs_dir()),
        }
    )
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "local/tests/tasks/test_tasks.py::test_task_treatment",
        "--release-suite=current",
        f"--count={count}",
        "-v",
        f"-n={workers}",
    ]
    if model:
        cmd.append(f"--model={model}")
    print(f"[regression] 本次实验：{experiment_id}", file=sys.stderr)
    result = subprocess.run(cmd, cwd=EVAL_ROOT, env=env, check=False)
    _write_json(
        experiment_dir / "launch-result.json",
        {
            "experiment_id": experiment_id,
            "pytest_exitstatus": result.returncode,
        },
    )
    if result.returncode != 0:
        raise GateError(
            f"pytest 退出 {result.returncode}；本次实验失败：{experiment_id}，不会读取旧报告"
        )
    return experiment_id


def resolve_experiment(value: str) -> Path:
    if Path(value).is_absolute():
        experiment = Path(value)
    elif "/" in value or "\\" in value or value in {".", ".."}:
        raise GateError("请提供单个实验 ID，或实验目录的绝对路径")
    else:
        experiment = get_logs_dir() / "experiments" / value
    if experiment.is_symlink() or not experiment.is_dir():
        raise GateError(f"实验目录不存在或是链接：{experiment}")
    return experiment.resolve()


def make_receipt(experiment: Path, count: int, baseline: dict, tolerance: float) -> dict:
    evidence = validate_experiment(experiment, count, candidate_identity())
    compare_baseline(evidence, baseline, tolerance)
    return {
        "schema": RECEIPT_SCHEMA,
        "verdict": "pass",
        "experimentId": experiment.name,
        **evidence,
        "baseline": baseline,
        "baselineHash": digest_json(baseline),
        "tolerance": tolerance,
    }


def verify_receipt(path: Path) -> None:
    receipt = read_json(path)
    if receipt.get("schema") != RECEIPT_SCHEMA or receipt.get("verdict") != "pass":
        raise GateError("不是发布通过凭证")
    if path.name != RECEIPT_FILE or path.parent.name != receipt.get("experimentId"):
        raise GateError("凭证必须位于其完整实验目录内，不能只复制单个 JSON")
    count = checked_count(receipt.get("count"))
    baseline = receipt.get("baseline")
    if not isinstance(baseline, dict):
        raise GateError("凭证缺少已审核 baseline")
    expected = make_receipt(path.parent, count, baseline, receipt.get("tolerance"))
    if digest_json(receipt) != digest_json(expected):
        raise GateError("凭证内容与原始报告、baseline 或当前候选不一致")
    print(
        f"[regression] PASS：{receipt['sampleCount']} 个样本，候选 {receipt['candidate']['revision']}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--suite", choices=["current"], default="current", help="固定当前版 14 组矩阵"
    )
    parser.add_argument("--experiment", help="只复核指定完整实验，不重新调用模型")
    parser.add_argument(
        "--count", type=int, default=1, help="每组样本数 1–5；完整矩阵共 14×count 个样本"
    )
    parser.add_argument(
        "--baseline", type=Path, default=BASELINE_FILE, help="已审核的新 schema 基线"
    )
    parser.add_argument(
        "--tolerance", type=float, default=0.10, help="维度均值回退上限，范围 0–0.10"
    )
    parser.add_argument(
        "--workers", type=int, choices=range(1, 5), default=2, help="并发 worker 数 1–4"
    )
    parser.add_argument("--model", help="模型名称；凭据仅从环境读取")
    parser.add_argument("--plan", action="store_true", help="输出矩阵与质量底线，不调用模型")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--collect-only", action="store_true", help="运行/检查完整实验但不发布放行，可不提供基线"
    )
    mode.add_argument(
        "--initialize-baseline", type=Path, help="从指定的健康完整实验创建新基线，绝不覆盖"
    )
    mode.add_argument("--verify-receipt", type=Path, help="无模型复核凭证与其完整原始实验")
    args = parser.parse_args(argv)
    try:
        checked_count(args.count)
        if not 0 <= args.tolerance <= 0.10:
            raise GateError("tolerance 必须在 0–0.10 范围内")
        if args.plan:
            print(
                json.dumps(
                    {
                        **suite_contract(),
                        "count": args.count,
                        "matrix": expected_matrix(args.count),
                    },
                    indent=2,
                    ensure_ascii=False,
                )
            )
            return 0
        if args.verify_receipt:
            verify_receipt(args.verify_receipt.resolve())
            return 0
        if args.initialize_baseline and not args.experiment:
            raise GateError(
                "初始化 baseline 必须明确指定 --experiment；请先 --collect-only 并审核结果"
            )
        if args.experiment and args.model:
            raise GateError("复用实验不能改变模型；请启动新实验")
        baseline = None
        if not args.collect_only and not args.initialize_baseline:
            baseline = validate_baseline(read_json(args.baseline))
        experiment_id = args.experiment or _run_eval(args.count, args.model, args.workers)
        experiment = resolve_experiment(experiment_id)
        evidence = validate_experiment(experiment, args.count, candidate_identity())
        if args.collect_only:
            print(f"[regression] 完整实验通过绝对质量检查：{experiment}；尚未发布放行")
            return 0
        if args.initialize_baseline:
            payload = {
                "schema": BASELINE_SCHEMA,
                "suiteHash": evidence["suiteHash"],
                "count": args.count,
                "sourceExperiment": experiment.name,
                "sourceCandidate": evidence["candidate"],
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "dimensions": means_from_evidence(evidence),
            }
            validate_baseline(payload)
            _write_json(args.initialize_baseline, payload, exclusive=True)
            print(
                f"[regression] 新基线已创建：{args.initialize_baseline}；请审核并使用 --baseline 复核实验"
            )
            return 0
        receipt = make_receipt(experiment, args.count, baseline, args.tolerance)
        path = experiment / RECEIPT_FILE
        _write_json(path, receipt)
        print(f"[regression] PASS：{receipt['sampleCount']} 个样本；baseline 未改动；凭证：{path}")
        return 0
    except (GateError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"[regression] BLOCKED：{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
