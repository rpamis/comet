"""当前候选的固定发布矩阵、内容身份和失败关闭的证据校验。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
from pathlib import Path

from scaffold.python.aligned_comparison import (
    _embedded_case_manifest,
    build_case_manifest,
    expected_case_matrix_payload,
    parse_expected_case_matrix,
)
from scaffold.python.profiles import get_profile

EVAL_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = EVAL_ROOT.parent
CANDIDATE_SCHEMA = "comet.eval.release-candidate.v1"
BASELINE_SCHEMA = "comet.eval.release-baseline.v1"
RECEIPT_SCHEMA = "comet.eval.release-receipt.v1"
CORE_RECEIPT_FILE = "core-regressions.json"
MAX_COUNT = 5
MAX_JSON_BYTES = 8 * 1024 * 1024
# 当前 SDK 是核心发布覆盖；portable 仅作为补充历史覆盖，仍须通过。
SDK_RELEASE_CASES = (
    ("comet-native-workflow", "COMET_NATIVE_SDK_CURRENT", "generic", "sdk-cli"),
    ("comet-classic-layout-lifecycle", "COMET_CLASSIC_DOCS_LAYOUT", "comet-workflow", "sdk-cli"),
    ("comet-classic-layout-lifecycle", "COMET_CLASSIC_LEGACY_LAYOUT", "comet-workflow", "sdk-cli"),
    ("comet-native-sdk-recovery", "COMET_NATIVE_SDK_CURRENT", "generic", "sdk-cli"),
    ("comet-classic-sdk-recovery", "COMET_CLASSIC_DOCS_LAYOUT", "generic", "sdk-cli"),
)
LEGACY_SUPPLEMENTAL_CASES = (
    ("comet-native-clarification", "COMET_NATIVE_PHASE1", "generic", "bundled-runtime"),
    ("comet-native-clarification-depth", "COMET_NATIVE_SEQUENTIAL", "generic", "bundled-runtime"),
    ("comet-native-clarification-modes", "COMET_NATIVE_SEQUENTIAL", "generic", "bundled-runtime"),
    ("comet-native-clarification-modes", "COMET_NATIVE_BATCH", "generic", "bundled-runtime"),
    ("comet-native-repository-fact", "COMET_NATIVE_PHASE1", "generic", "bundled-runtime"),
    ("comet-native-interrupted-transition", "COMET_NATIVE_PHASE1", "generic", "bundled-runtime"),
    ("comet-native-wave-b-decision-resume", "COMET_NATIVE_PHASE1", "generic", "bundled-runtime"),
    (
        "comet-native-wave-c-verification-integrity",
        "COMET_NATIVE_PHASE1",
        "generic",
        "bundled-runtime",
    ),
    ("comet-native-wave-d-stagnation-stop", "COMET_NATIVE_PHASE1", "generic", "bundled-runtime"),
    ("comet-native-wave-e-parallel-safety", "COMET_NATIVE_PHASE1", "generic", "bundled-runtime"),
    (
        "comet-native-wave-f-dashboard-readonly",
        "COMET_NATIVE_PHASE1",
        "generic",
        "bundled-runtime+cli",
    ),
)
RELEASE_CASES = SDK_RELEASE_CASES + LEGACY_SUPPLEMENTAL_CASES
RECOVERY_RELEASE_CASES = tuple(
    case
    for case in SDK_RELEASE_CASES
    if case[0] in {"comet-native-sdk-recovery", "comet-classic-sdk-recovery"}
)


class GateError(ValueError):
    """证据不完整或身份无效，不能得出发布通过结论。"""


def digest_json(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def read_json(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON_BYTES:
        raise GateError(f"证据文件缺失、链接或超过大小限制：{path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise GateError(f"不能读取 JSON 证据：{path}") from error
    if not isinstance(value, dict):
        raise GateError(f"证据必须是 JSON 对象：{path}")
    return value


def regular_tree_files(root: Path, *, exclude_generated_eval: bool = False) -> list[Path]:
    files = []
    if exclude_generated_eval:

        def unreadable(error: OSError) -> None:
            raise GateError(f"不能完整读取候选目录：{error.filename or root}") from error

        for current, directories, names in os.walk(root, onerror=unreadable):
            parent = Path(current)
            for name in directories[:]:
                if parent.name == ".comet" and name == "eval":
                    directories.remove(name)
                elif (parent / name).is_symlink():
                    raise GateError(f"候选目录包含符号链接：{parent / name}")
            for name in names:
                file = parent / name
                if file.is_symlink():
                    raise GateError(f"候选目录包含符号链接：{file}")
                if file.is_file():
                    files.append(file)
        return sorted(files)
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise GateError(f"候选目录包含符号链接：{path}")
        if path.is_file():
            files.append(path)
    return files


def tree_digest(root: Path, files: list[Path]) -> tuple[str, int]:
    digest = hashlib.sha256()
    for path in sorted(set(files)):
        payload = path.read_bytes()
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0" + str(len(payload)).encode() + b"\0")
        digest.update(hashlib.sha256(payload).hexdigest().encode() + b"\n")
    return digest.hexdigest(), len(set(files))


def current_source_identity(root: Path) -> dict:
    # 内容身份涵盖构建输入与发布输出；不能只靠 HEAD 判断工作区是否未变。
    roots = ("app", "domains", "platform", "assets", "bin", "dist", "scripts", "config")
    files = [
        path
        for name in roots
        for path in regular_tree_files(root / name)
        if "__pycache__" not in path.parts and path.suffix not in {".pyc", ".pyo"}
    ]
    required = [root / name for name in ("package.json", "bin/comet.js", "assets/manifest.json")]
    if not all(path.is_file() and not path.is_symlink() for path in required):
        raise GateError("当前候选缺少 package.json、CLI 入口或发布资产")
    files.extend(
        root / name
        for name in (
            "tsconfig.json",
            "package.json",
            "build.js",
            "pnpm-lock.yaml",
            "package-lock.json",
            ".npmignore",
            ".gitattributes",
        )
        if (root / name).is_file()
    )
    source_hash, count = tree_digest(root, files)
    return {"sourceHash": source_hash, "sourceFileCount": count}


def cli_snapshot_identity(root: Path) -> dict:
    required = (
        "dist/app/cli/index.js",
        "dist/domains/dashboard/native-adapter.js",
        "bin/comet.js",
        "assets/manifest.json",
        "package.json",
    )
    if not all((root / name).is_file() for name in required):
        raise GateError("发布候选缺少完整 dist；请先构建最终候选再执行 Eval")
    files = [path for name in ("assets", "bin", "dist") for path in regular_tree_files(root / name)]
    snapshot_hash, count = tree_digest(root, files + [root / "package.json"])
    return {"cliSnapshotHash": snapshot_hash, "cliSnapshotFileCount": count}


def candidate_identity(root: Path = REPOSITORY_ROOT) -> dict:
    def git_rev(value):
        result = subprocess.run(
            ["git", "rev-parse", value], cwd=root, capture_output=True, text=True, check=True
        )
        return result.stdout.strip()

    evaluation_files = []
    for directory in ("scaffold", "local/tasks", "local/treatments", "local/skills"):
        evaluation_files.extend(
            path
            for path in regular_tree_files(
                root / "eval" / directory, exclude_generated_eval=directory == "local/skills"
            )
            if "__pycache__" not in path.parts and path.suffix not in {".pyc", ".pyo"}
        )
    evaluation_files.extend(
        root / "eval" / name
        for name in (
            "local/tests/conftest.py",
            "local/tests/tasks/test_tasks.py",
            "local/scripts/regression_check.py",
            "pyproject.toml",
            "uv.lock",
        )
    )
    evaluation_files.extend(
        path
        for path in regular_tree_files(root / "test")
        if "__pycache__" not in path.parts and path.suffix not in {".pyc", ".pyo"}
    )
    evaluation_files.extend(path for path in root.glob("vitest*config.*") if path.is_file())
    return {
        "schema": CANDIDATE_SCHEMA,
        "revision": git_rev("HEAD"),
        "tree": git_rev("HEAD^{tree}"),
        **current_source_identity(root),
        **cli_snapshot_identity(root),
        "packageVersion": read_json(root / "package.json")["version"],
        "dependencyHash": tree_digest(root, [root / "pnpm-lock.yaml"])[0],
        "harnessHash": tree_digest(root, evaluation_files)[0],
    }


def checked_count(count: int) -> int:
    if type(count) is not int or not 1 <= count <= MAX_COUNT:
        raise GateError(f"每组样本数必须为 1–{MAX_COUNT}")
    return count


def _integer(value, label: str) -> int:
    if type(value) is not int:
        raise GateError(f"{label} 必须为 JSON 整数，不能缺失或使用布尔值")
    return value


def validate_candidate(candidate: dict) -> None:
    if not isinstance(candidate, dict) or candidate.get("schema") != CANDIDATE_SCHEMA:
        raise GateError("候选身份 schema 无效")
    for field in ("sourceFileCount", "cliSnapshotFileCount"):
        if _integer(candidate.get(field), field) <= 0:
            raise GateError(f"{field} 必须为正整数")
    for field in ("revision", "tree"):
        value = candidate.get(field)
        if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value) is None:
            raise GateError(f"候选 {field} 无效")
    for field in ("sourceHash", "cliSnapshotHash", "dependencyHash", "harnessHash"):
        value = candidate.get(field)
        if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
            raise GateError(f"候选 {field} 无效")
    if not isinstance(candidate.get("packageVersion"), str) or not candidate["packageVersion"]:
        raise GateError("候选 packageVersion 缺失")


def _verify_core_receipt_with_node(file: Path) -> None:
    result = subprocess.run(
        ["node", "scripts/lint/core-regressions.mjs", "--verify-evidence", str(file)],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise GateError(f"核心回归原始证据或当前候选不匹配：{result.stderr.strip()}")


def validate_core_regressions(experiment: Path, expected_hash: str) -> dict:
    file = experiment / CORE_RECEIPT_FILE
    receipt = read_json(file)
    if hashlib.sha256(file.read_bytes()).hexdigest() != expected_hash:
        raise GateError("核心回归凭证与本次启动记录不匹配")
    name = receipt.get("recordsFile")
    if (
        not isinstance(name, str)
        or not name.endswith(".records.json")
        or any(char in name for char in "/\\:")
    ):
        raise GateError("核心回归原始记录引用必须位于凭证同目录")
    records = experiment / name
    if (
        records.is_symlink()
        or not records.is_file()
        or hashlib.sha256(records.read_bytes()).hexdigest() != receipt.get("recordsHash")
    ):
        raise GateError("核心回归原始记录缺失或被修改")
    _verify_core_receipt_with_node(file)
    return {"coreReceiptHash": expected_hash, "receipt": receipt}


def validate_launch_result(experiment: Path) -> dict:
    launch = read_json(experiment / "launch-result.json")
    if (
        set(launch) != {"experiment_id", "pytest_exitstatus", "coreReceiptHash"}
        or launch.get("experiment_id") != experiment.name
        or _integer(launch.get("pytest_exitstatus"), "launch.pytest_exitstatus") != 0
    ):
        raise GateError("缺少本次成功的独立 pytest 启动记录或核心回归凭证")
    if not isinstance(launch["coreReceiptHash"], str) or not re.fullmatch(
        r"[a-f0-9]{64}", launch["coreReceiptHash"]
    ):
        raise GateError("核心回归凭证摘要无效")
    return validate_core_regressions(experiment, launch["coreReceiptHash"])


def dimension_minimum(profile: str, dim: str) -> float:
    if dim == "efficiency":
        return 0.33
    # 任务完成、安全、审批与恢复证据不可打折；其余是启发式产物/调用质量分。
    if profile == "comet-workflow" and dim in {"main_flow", "skill_invocation", "artifact_quality"}:
        return {"main_flow": 0.8, "skill_invocation": 0.8, "artifact_quality": 0.75}[dim]
    return 1.0


def release_cases(suite: str = "current", count: int | None = None) -> tuple:
    if suite not in {"current", "recovery"}:
        raise GateError("未知发布验收范围")
    if count is not None:
        checked_count(count)
        if suite == "recovery" and count != 3:
            raise GateError("最高难度恢复验收要求 Native 与 Classic 各 3 次全部通过")
    return RECOVERY_RELEASE_CASES if suite == "recovery" else RELEASE_CASES


def suite_contract(suite: str = "current") -> dict:
    return {
        "suite": suite,
        "cases": [
            {
                "task": task,
                "treatment": treatment,
                "profile": profile,
                "coverage": coverage,
                "role": "release-core" if coverage == "sdk-cli" else "legacy-supplemental",
                "minimums": {
                    dim: dimension_minimum(profile, dim)
                    for dim in get_profile(profile).rubric_dimensions
                },
            }
            for task, treatment, profile, coverage in release_cases(suite)
        ],
    }


def expected_matrix(count: int, suite: str = "current") -> dict:
    checked_count(count)
    return expected_case_matrix_payload(
        (task, treatment, rep)
        for task, treatment, _, _ in release_cases(suite, count)
        for rep in range(1, count + 1)
    )


def case_key(task: str, treatment: str) -> str:
    return f"{task}/{treatment}"


def _score(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise GateError(f"{label} 必须为有限数值")
    if not 0 <= value <= 1:
        raise GateError(f"{label} 不在 [0, 1] 范围")
    return float(value)


def report_dimensions(report: dict, case: dict) -> dict[str, float]:
    checks = report.get("checks_passed")
    if not isinstance(checks, list) or not checks or any(not isinstance(c, str) for c in checks):
        raise GateError("报告缺少成功检查")
    if not any(not check.startswith("[RUBRIC") for check in checks):
        raise GateError("只有 rubric，没有任务验证检查")
    scores = {}
    for check in checks:
        if not check.startswith("[RUBRIC] "):
            continue
        match = re.match(r"\[RUBRIC\] (\w+): (\S+)(?:\s|$)", check)
        if not match:
            raise GateError(f"rubric 格式无效：{check}")
        dim, raw = match.groups()
        if dim in scores:
            raise GateError(f"rubric 维度重复：{dim}")
        try:
            scores[dim] = _score(float(raw), dim)
        except ValueError as error:
            raise GateError(f"rubric 缺失或不是数值：{dim}={raw}") from error
    expected = set(case["minimums"])
    if set(scores) - {"weighted_score"} != expected:
        raise GateError(f"rubric 维度不匹配：需要 {sorted(expected)}，实际 {sorted(scores)}")
    for dim, minimum in case["minimums"].items():
        if scores[dim] < minimum:
            raise GateError(f"{case['task']} {dim}={scores[dim]} 低于绝对底线 {minimum}")
    return {dim: scores[dim] for dim in case["minimums"]}


def validate_experiment(
    experiment: Path, count: int, candidate: dict, suite: str = "current"
) -> dict:
    matrix = expected_matrix(count, suite)
    validate_candidate(candidate)
    core = validate_launch_result(experiment)
    metadata = read_json(experiment / "metadata.json")
    if (
        metadata.get("experiment_id") != experiment.name
        or not isinstance(metadata.get("completed_at"), str)
        or not metadata["completed_at"]
    ):
        raise GateError("实验身份不匹配或实验未完成")
    if (
        _integer(metadata.get("pytest_exitstatus"), "metadata.pytest_exitstatus") != 0
        or _integer(metadata.get("pytest_errors"), "metadata.pytest_errors") != 0
    ):
        raise GateError("pytest 执行失败或存在 setup/teardown 错误")
    if _integer(metadata.get("pytest_skipped"), "metadata.pytest_skipped") != 0:
        raise GateError("发布样本包含跳过项")
    if digest_json(metadata.get("release_candidate")) != digest_json(candidate):
        raise GateError("实验不是当前 Git revision、产品内容或 Eval harness 的候选")
    if digest_json(metadata.get("release_suite")) != digest_json(suite_contract(suite)):
        raise GateError("实验的发布矩阵/质量底线与当前契约不匹配")
    raw_matrix = read_json(experiment / "expected-case-matrix.json")
    if not isinstance(raw_matrix.get("cases"), list) or any(
        not isinstance(case, dict) or type(case.get("rep")) is not int
        for case in raw_matrix["cases"]
    ):
        raise GateError("发布矩阵样本序号必须为 JSON 整数")
    actual_matrix = parse_expected_case_matrix(raw_matrix)
    if actual_matrix != parse_expected_case_matrix(matrix):
        raise GateError("收集的矩阵缺失、重复或含有未授权组合")
    expected = {(case["task"], case["treatment"], case["rep"]) for case in matrix["cases"]}
    cases = {(c["task"], c["treatment"]): c for c in suite_contract(suite)["cases"]}
    reports_dir = experiment / "reports"
    if reports_dir.is_symlink():
        raise GateError("报告目录不能是符号链接")
    paths = sorted(reports_dir.glob("*.json"))
    if len(paths) != len(expected):
        raise GateError(f"报告数量不完整：需要 {len(expected)}，实际 {len(paths)}")
    samples = []
    seen = set()
    sample_run_ids = set()
    snapshot_hashes = set()
    for path in paths:
        report = read_json(path)
        run_id = report.get("run_id")
        if not isinstance(run_id, str) or not run_id.strip() or run_id in sample_run_ids:
            raise GateError("样本执行身份缺失或重复，不能复用一次执行充当多次通过")
        sample_run_ids.add(run_id)
        events = report.get("events_summary")
        if not isinstance(events, dict):
            raise GateError("报告缺少事件证据")
        key = (events.get("task"), events.get("treatment"), report.get("rep"))
        if (
            not all(isinstance(value, str) for value in key[:2])
            or type(key[2]) is not int
            or key not in expected
            or key in seen
        ):
            raise GateError(f"报告重复或不在发布矩阵中：{key}")
        seen.add(key)
        case = cases[key[:2]]
        if (
            report.get("name") != f"{key[0]}-{key[1]}-r{key[2]}"
            or _integer(events.get("sample"), "events_summary.sample") != key[2]
        ):
            raise GateError("报告名称/重复次数与样本身份不一致")
        if report.get("passed") is not True or report.get("checks_failed") != []:
            raise GateError(f"样本有失败或缺少明确通过状态：{key}")
        if _integer(report.get("agent_returncode"), "agent_returncode") != 0:
            raise GateError(f"Agent 未正常完成：{key}")
        if (
            digest_json(events.get("release_candidate")) != digest_json(candidate)
            or events.get("profile") != case["profile"]
        ):
            raise GateError("样本候选身份或评分 profile 不匹配")
        quality = report.get("sample_quality")
        if (
            not isinstance(quality, dict)
            or quality.get("status") != "included"
            or quality.get("include_in_analysis") is not True
        ):
            raise GateError(f"样本被排除、标记或缺少质量信息：{key}")
        manifest = _embedded_case_manifest(report, key[0])
        if manifest is None or not manifest.execution_bound:
            raise GateError("样本缺少有效的用例与执行环境身份")
        expected_manifest = build_case_manifest(
            key[0],
            EVAL_ROOT / "local/tasks" / key[0],
            execution_identity=manifest.execution_identity,
        )
        if manifest.case_hash != expected_manifest.case_hash:
            raise GateError("样本用例/验证器/执行控制器已变化")
        build = events.get("current_comet_build")
        if "cli" in case["coverage"]:
            if (
                not isinstance(build, dict)
                or build.get("schema") != "comet.eval.current-comet-build.v1"
                or build.get("sourceHash") != candidate["sourceHash"]
            ):
                raise GateError("当前 CLI 构建快照没有绑定到受测候选")
            if not re.fullmatch(r"[0-9a-f]{64}", str(build.get("snapshotHash", ""))):
                raise GateError("当前 CLI 构建快照摘要缺失")
            if build["snapshotHash"] != candidate.get("cliSnapshotHash"):
                raise GateError("实际 CLI 快照与当前已构建发布产物不一致")
            if build.get("compilerVersion") != "release-dist":
                raise GateError("发布样本必须使用已构建的实际 dist，不接受另编译的替代 CLI")
            snapshot_hashes.add(build["snapshotHash"])
        dimensions = report_dimensions(report, case)
        samples.append(
            {
                "task": key[0],
                "treatment": key[1],
                "rep": key[2],
                "runId": run_id,
                "report": path.name,
                "reportHash": digest_json(report),
                "dimensions": dimensions,
                "checksPassed": len(report["checks_passed"]),
                "checksFailed": 0,
                "caseHash": manifest.case_hash,
                "executionHash": manifest.execution_hash,
                "cliSnapshotHash": build["snapshotHash"] if build else None,
            }
        )
    if seen != expected or len(snapshot_hashes) != 1:
        raise GateError("样本矩阵不完整或实际 CLI 构建内容不一致")
    return {
        "candidate": candidate,
        "coreReceiptHash": core["coreReceiptHash"],
        "suite": suite,
        "suiteHash": digest_json(suite_contract(suite)),
        "count": count,
        "sampleCount": len(samples),
        "matrixHash": matrix["matrix_hash"],
        "samples": sorted(samples, key=lambda row: (row["task"], row["treatment"], row["rep"])),
    }


def means_from_evidence(evidence: dict) -> dict:
    grouped = {}
    for sample in evidence["samples"]:
        key = case_key(sample["task"], sample["treatment"])
        grouped.setdefault(key, []).append(sample["dimensions"])
    return {
        key: {dim: sum(row[dim] for row in rows) / len(rows) for dim in rows[0]}
        for key, rows in grouped.items()
    }


def validate_baseline(baseline: dict, suite: str = "current") -> dict:
    if baseline.get("schema") != BASELINE_SCHEMA or baseline.get("suiteHash") != digest_json(
        suite_contract(suite)
    ):
        raise GateError("baseline 缺失、仍是旧维度 schema 或矩阵已变化；请明确初始化新文件")
    dimensions = baseline.get("dimensions")
    cases = suite_contract(suite)["cases"]
    if not isinstance(dimensions, dict) or set(dimensions) != {
        case_key(c["task"], c["treatment"]) for c in cases
    }:
        raise GateError("baseline 缺少任务/treatment 维度")
    for case in cases:
        row = dimensions[case_key(case["task"], case["treatment"])]
        if not isinstance(row, dict) or set(row) != set(case["minimums"]):
            raise GateError("baseline 缺少或新增了未经审核的 rubric 维度")
        for dim, minimum in case["minimums"].items():
            if _score(row[dim], dim) < minimum:
                raise GateError(f"baseline 的 {dim} 低于绝对底线")
    if (
        not isinstance(baseline.get("sourceCandidate"), dict)
        or not isinstance(baseline.get("sourceExperiment"), str)
        or not baseline["sourceExperiment"]
    ):
        raise GateError("baseline 缺少来源")
    validate_candidate(baseline["sourceCandidate"])
    checked_count(baseline.get("count"))
    release_cases(suite, baseline.get("count"))
    return baseline


def compare_baseline(evidence: dict, baseline: dict, tolerance: float) -> None:
    validate_baseline(baseline, evidence.get("suite", "current"))
    _score(tolerance, "tolerance")
    if tolerance > 0.10:
        raise GateError("发布允许的回退幅度不能超过 0.10")
    for key, dimensions in means_from_evidence(evidence).items():
        for dim, current in dimensions.items():
            if current + tolerance + 1e-9 < baseline["dimensions"][key][dim]:
                raise GateError(
                    f"回退：{key} {dim}={current} < baseline {baseline['dimensions'][key][dim]}"
                )
