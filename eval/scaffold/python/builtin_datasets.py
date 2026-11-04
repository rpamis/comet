"""内置数据集适配；模型执行与业务判分复用现有 Eval 生命周期。"""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from dataclasses import dataclass

from scaffold.python.tasks import Task, TaskConfig, EvaluationConfig, InteractionConfig
from scaffold.python.execution import redact_sensitive


DATASET_SIMULATOR_PROMPT = """You simulate the user for a fixed benchmark task.
The original task and its public repository materials are authoritative and cannot change.
Approve workflow steps and implementation choices only when they preserve that contract.
Reject requests to remove requirements, change required paths, formats, interfaces or behavior.
Read public evidence supplied in the request before treating a short instruction as ambiguous.
If the public materials do not answer a behavior question, say you have no additional product
decision; ask the agent to solve the original task using its public materials. Do not invent
requirements, promise a different acceptance standard, provide solutions or hidden test information.
Workflow acceptance does not replace the original benchmark grader. Keep replies brief.
"""

SUPPORTED_CANDIDATE_DIRECTORIES = {
    "/root",
    "/app",
    "/data",
    "/outputs",
    "/opt/syzkaller",
    "/home/agent",
}


def candidate_directories(metadata: dict) -> list[str]:
    directories = metadata.get("execution", {}).get(
        "candidateDirectories", ["/root", "/app", "/data"]
    )
    if not isinstance(directories, list) or any(
        p not in SUPPORTED_CANDIDATE_DIRECTORIES for p in directories
    ):
        raise ValueError("数据集候选目录尚不支持或包含不安全路径")
    return list(dict.fromkeys(directories))


def dataset_resource_args(execution: dict) -> list[str]:
    if execution.get("networkMode", "public") != "public":
        raise ValueError("尚不支持此任务网络模式；禁止静默放宽")
    args = []
    for key, option, suffix in [("cpus", "--cpus", ""), ("memoryMb", "--memory", "m")]:
        value = execution.get(key)
        if value is not None:
            if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
                raise ValueError(f"无效的数据集资源限制：{key}")
            args += [option, f"{value:g}{suffix}"]
    return args


def verify_public_instruction(entry: dict, dataset: str) -> None:
    if not entry.get("instructionHash"):
        return  # 旧计划按其原输入身份处理，不静默改写已保存的计划。
    source = Path(entry["source"])
    if dataset == "skillsbench":
        import re

        text = (source / "task.md").read_bytes().decode("utf-8")
        match = re.match(r"^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$", text)
        if not match:
            raise ValueError("原始题面缺少有效元数据")
        instruction = match.group(1)
    else:
        instruction = (source / "instruction.md").read_bytes().decode("utf-8")
    actual = "sha256:" + hashlib.sha256(instruction.encode()).hexdigest()
    if instruction != entry["instruction"] or actual != entry["instructionHash"]:
        raise ValueError("固定原题被替换；模拟用户批准不能修改原题")


def dataset_config_hash(root: Path) -> str:
    file = root / "dataset.toml"
    if not file.is_file() or file.is_symlink():
        raise ValueError("WorkBuddy 数据集缺少有效的 dataset.toml；请重新下载完整数据集")
    return "sha256:" + hashlib.sha256(file.read_bytes()).hexdigest()


def verify_dataset_config(plan: dict) -> None:
    if plan.get("adapterHash"):
        root = Path(__file__).resolve().parents[3]
        files = json.loads(
            (root / "eval/scaffold/dataset-adapter-files.json").read_text(encoding="utf-8")
        )
        digest = hashlib.sha256()
        for file in sorted(files):
            if not file.startswith("eval/") or ".." in file or Path(file).is_absolute():
                raise ValueError("数据集适配器输入路径无效")
            digest.update(file.encode() + b"\0")
            digest.update((root / file).read_bytes() + b"\0")
        if "sha256:" + digest.hexdigest() != plan["adapterHash"]:
            raise ValueError("评估适配器与固定计划不匹配")
    if plan.get("observerHash"):
        actual_observer = (
            "sha256:"
            + hashlib.sha256(
                Path(__file__).with_name("dataset_pytest_observer.py").read_bytes()
            ).hexdigest()
        )
        if actual_observer != plan["observerHash"]:
            raise ValueError("评分观测器与固定计划不匹配")
    if plan.get("scorerHash"):
        actual = (
            "sha256:"
            + hashlib.sha256(Path(__file__).with_name("dataset_score.py").read_bytes()).hexdigest()
        )
        if actual != plan["scorerHash"]:
            raise ValueError("数据集评分适配器与已确认输入不匹配")
    if plan["dataset"]["id"] == "workbuddy-code":
        if dataset_config_hash(Path(plan["root"])) != plan.get("datasetConfigHash"):
            raise ValueError("数据集 dataset.toml 与已确认的评估输入不匹配")


def reward_result(value: str) -> tuple[float, bool]:
    reward = json.loads(value)
    if type(reward) not in (int, float) or not math.isfinite(reward) or not 0 <= reward <= 1:
        raise ValueError("评分必须为 0–1 的有限数值")
    return float(reward), reward == 1


def tree_hash(root: Path) -> str:
    digest = hashlib.sha256()

    def files(directory):
        for file in sorted(directory.iterdir(), key=lambda p: p.name):
            if file.name in {".git", "__pycache__"}:
                continue
            if file.is_symlink():
                raise ValueError(f"数据集不允许链接：{file}")
            if file.is_dir():
                yield from files(file)
            else:
                yield file

    for file in files(root):
        if any(part in {".git", "__pycache__"} for part in file.relative_to(root).parts):
            continue
        if file.is_symlink():
            raise ValueError(f"数据集不允许链接：{file}")
        if file.is_file():
            digest.update(file.relative_to(root).as_posix().encode())
            digest.update(b"\0")
            with file.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            digest.update(b"\0")
    return "sha256:" + digest.hexdigest()


def docker(*args, **kwargs):
    labels = []
    if args and args[0] in {"create", "run"}:
        for key, env in [
            ("experiment", "COMET_EVAL_EXPERIMENT_ID"),
            ("project", "COMET_EVAL_PROJECT_ID"),
        ]:
            if os.environ.get(env):
                labels += ["--label", f"comet.eval.{key}={os.environ[env]}"]
        args = (args[0], *labels, *args[1:])
    return subprocess.run(
        ["docker", *map(str, args)],
        check=True,
        capture_output=True,
        text=True,
        timeout=kwargs.pop("timeout", 300),
        **kwargs,
    )


@dataclass
class DatasetTask(Task):
    dataset_entry: dict | None = None
    dataset_plan: dict | None = None

    def render_prompt(self, **kwargs):
        # 原始 JSON/CSS 花括号不能按 Comet 模板再次展开。
        return self.instruction_template

    def execution_prompt(self, prompt: str) -> str:
        return (
            "This is a fixed benchmark task. Its public instruction and repository materials remain authoritative. "
            "Workflow approvals cannot remove requirements or change required interfaces, paths, formats or behavior. "
            "Resolve details from public code and documentation; the simulated user has no new product requirements. "
            "Read the read-only original task at /opt/comet-task-contract/task.md. "
            "Give every independent verifier this original task path and require it to check the original task as well as the approved Spec. "
            "A workflow pass does not override the original grader.\n\nOriginal task:\n" + prompt
        )

    def load_validators(self):
        return [self.validate_dataset]

    def validate_dataset(self, test_dir, outputs):
        # 原始评分可能注入测试或 stage 文件；在候选副本中判分，保留 Native 候选不变。
        outputs["_dataset_source_workspace"] = str(Path(test_dir).resolve())
        try:
            with tempfile.TemporaryDirectory(prefix="comet-dataset-score-") as temporary:
                candidate = Path(temporary) / "candidate"
                shutil.copytree(test_dir, candidate, symlinks=True)
                passed, failed = self._score_dataset(candidate, outputs)
        finally:
            outputs.pop("_dataset_source_workspace", None)
        if (
            not any(
                item.startswith(("dataset_input_changed:", "dataset_environment_changed:"))
                for item in failed
            )
            and (self.dataset_plan or {}).get("treatment", "COMET_NATIVE_SDK_CURRENT")
            != "CLAUDE_CODE_GOAL"
            and (self.dataset_plan or {}).get("verifyMode")
        ):
            proof = outputs.get("dataset_result", {}).get("native_verification") or {}
            if proof.get("status") == "mismatch":
                failed.append("dataset_verify_mode: Run 创建时的验证模式与固定计划不匹配")
            elif (
                proof.get("status") != "matched"
                or proof.get("expectedMode") != self.dataset_plan["verifyMode"]
                or not proof.get("runs")
            ):
                failed.append(
                    "dataset_verify_mode_unavailable: "
                    + str(proof.get("reason", "缺少容器内真实 Runtime 查询结果"))
                )
            else:
                for name, evidence in proof["runs"].items():
                    if (
                        evidence.get("run", {}).get("input", {}).get("verifyMode", "standard")
                        != self.dataset_plan["verifyMode"]
                    ):
                        failed.append("dataset_verify_mode: Run 创建时的验证模式与固定计划不匹配")
                        break
                    outputs.setdefault("validation_evidence", {})["native:" + name] = evidence
        return passed, failed

    def _score_dataset(self, test_dir, outputs):
        from scaffold.python.utils import build_docker_image

        entry, plan = self.dataset_entry, self.dataset_plan
        try:
            verify_dataset_config(plan)
            verify_public_instruction(entry, plan["dataset"]["id"])
            if entry.get("execution"):
                metadata = json.loads(
                    (Path(test_dir) / ".dataset-task.json").read_text(encoding="utf-8")
                )
                if metadata.get("execution") != entry["execution"]:
                    raise ValueError("候选执行条件与固定计划不匹配")
                expected_file = self.environment_dir / ".dataset-task.json"
                if expected_file.is_file():
                    expected = json.loads(expected_file.read_text(encoding="utf-8"))
                    if {
                        key: value for key, value in metadata.items() if key != "controllerPaths"
                    } != expected:
                        raise ValueError("候选目录或身份元数据与固定输入不匹配")
        except ValueError as exc:
            return [], [f"dataset_input_changed: {exc}"]
        # 评分使用固定的镜像装配输入，不接受 Builder 改写评分环境。
        if (Path(test_dir) / ".dataset-build").exists():
            for file in (
                "Dockerfile",
                *(
                    ["current-comet-package.json"]
                    if plan.get("treatment") != "CLAUDE_CODE_GOAL"
                    else []
                ),
                "current-comet-install-claude.py",
            ):
                actual = Path(test_dir) / ".dataset-build" / file
                expected = self.environment_dir / file
                if (
                    not actual.is_file()
                    or not expected.is_file()
                    or actual.read_bytes() != expected.read_bytes()
                ):
                    return [], ["dataset_environment_changed: 评分环境装配输入被修改"]
        if (
            plan["dataset"]["id"] == "workbuddy-code"
            and tree_hash(Path(plan["root"]) / "shared") != plan["sharedHash"]
        ):
            return [], ["dataset_input_changed: 数据集评分插件发生变化"]
        if tree_hash(Path(entry["source"])) != entry["contentHash"]:
            return [], ["dataset_input_changed: 原始任务发生变化"]
        image = build_docker_image(test_dir, agent=outputs.get("agent", "claude-code"))
        if not image:
            return [], ["dataset_environment: 镜像构建失败"]
        name = "comet-eval-score-" + hashlib.sha256(str(test_dir).encode()).hexdigest()[:24]
        mounts = dataset_mounts(Path(test_dir))
        script = Path(__file__).with_name("dataset_score.py")
        scoring_input = Path(test_dir).parent / ("scoring-input-" + name + ".json")
        scoring_input.write_text(
            json.dumps(
                {
                    **entry.get("execution", {}),
                    "verifierTimeoutSeconds": entry.get("verifierTimeout", entry["timeout"]),
                }
            ),
            encoding="utf-8",
        )
        python = (
            ["/opt/comet-verifier/bin/python", "-I"]
            if plan["dataset"]["id"] == "workbuddy-code"
            else ["python3", "-I"]
        )
        inspection_args = []
        inspection_error = None
        if plan.get("verifyMode") and plan.get("treatment") != "CLAUDE_CODE_GOAL":
            from scaffold.python.utils import run_shell

            try:
                volume = run_shell(
                    "docker.sh",
                    "runtime-data-volume",
                    outputs.get("_dataset_source_workspace", test_dir),
                    timeout=10,
                    check=True,
                ).stdout.strip()
                import re

                if not re.fullmatch(r"comet-eval-data-[0-9a-f]{24}", volume):
                    raise ValueError("Runtime 卷身份无效")
                docker("volume", "inspect", volume)
                inspection_args = [
                    "-v",
                    f"{volume}:/opt/comet-eval-data:ro",
                    "-e",
                    "COMET_DATA_DIR=/opt/comet-eval-data",
                    "-v",
                    f"{script.with_name('validation') / 'current_sdk.py'}:/opt/comet-sdk-inspection.py:ro",
                ]
            except (ValueError, OSError, subprocess.SubprocessError) as exc:
                inspection_error = redact_sensitive(str(exc))[-2000:]
            scoring = json.loads(scoring_input.read_text(encoding="utf-8"))
            scoring.update(
                expectedNativeMode=plan["verifyMode"], nativeInspectionError=inspection_error
            )
            scoring_input.write_text(json.dumps(scoring), encoding="utf-8")
        args = [
            "create",
            "--name",
            name,
            "--user",
            "root",
            *dataset_resource_args(entry.get("execution", {})),
            "-v",
            f"{Path(test_dir).resolve()}:/workspace",
            "-v",
            f"{Path(plan['root']).resolve()}:/opt/dataset-original:ro",
            "-v",
            f"{script.resolve()}:/opt/dataset_score.py:ro",
            "-v",
            f"{script.with_name('dataset_pytest_observer.py').resolve()}:/opt/comet-observer/dataset_pytest_observer.py:ro",
            "-v",
            f"{scoring_input.resolve()}:/opt/comet-dataset-execution.json:ro",
            *mounts,
            *inspection_args,
            image,
            *python,
            "/opt/dataset_score.py",
            plan["dataset"]["id"],
            entry["id"],
        ]
        try:
            docker(*args)
            from scaffold.python.progress import observe_dataset_storage

            with observe_dataset_storage(Path(test_dir), name) as storage:
                result = docker(
                    "start",
                    "-a",
                    name,
                    timeout=entry.get("verifierTimeout", entry["timeout"]) + 120,
                )
            if storage["error"]:
                raise ValueError(storage["error"])
            # docker start 的退出状态不代表容器中的判分进程成功。
            status = docker("inspect", "--format", "{{.State.ExitCode}}", name).stdout.strip()
            line = next(
                (
                    line
                    for line in reversed(result.stdout.splitlines())
                    if line.startswith("COMET_DATASET_REWARD=")
                ),
                None,
            )
            if line is None:
                raise ValueError(f"判分进程退出 {status}，没有原始评分: {result.stdout[-1500:]}")
            raw = json.loads(line.split("=", 1)[1])
            if status != "0":
                raw["verifier_status"] = raw.get("verifier_status", "script_error")
            outputs["dataset_result"] = {
                **raw,
                "stdout": redact_sensitive("\n".join(result.stdout.splitlines()[:-1])[-16000:]),
                "stderr": redact_sensitive(getattr(result, "stderr", "")[-6000:]),
                "dataset": plan["dataset"],
                "task": entry["id"],
                "contentHash": entry["contentHash"],
                "execution": entry.get("execution"),
                "verifier_status": raw.get("verifier_status", "unknown"),
                "verifyMode": plan.get("verifyMode"),
            }
            reward, passed = reward_result(json.dumps(raw["reward"]))
            score = f"[RUBRIC] dataset-score: {reward}"
            verifier_status = raw.get("verifier_status", "unknown")
            if verifier_status in {
                "environment_error",
                "collection_error",
                "test_error",
                "script_error",
                "timeout",
                "not_executed",
            }:
                return [score], [
                    f"dataset_verifier_error: {verifier_status}; 原始 reward={reward} 已保留"
                ]
            if verifier_status == "unknown" and not passed:
                return [score], [
                    "dataset_verifier_unconfirmed: 原始评分未达完整成功，测试执行阶段未知；保留原分数，原因待判定"
                ]
            return ([score, "dataset_completed"] if passed else [score]), (
                [] if passed else ["dataset_incomplete: 原始评分未达到完整成功"]
            )
        except Exception as exc:
            detail = str(exc)
            if isinstance(exc, (subprocess.CalledProcessError, subprocess.TimeoutExpired)):
                for value in (exc.stdout, exc.stderr):
                    if value:
                        detail += "\n" + (
                            value.decode("utf-8", errors="replace")
                            if isinstance(value, bytes)
                            else value
                        )
            return [], [f"dataset_verifier_error: {redact_sensitive(detail)[-6000:]}"]
        finally:
            try:
                docker("rm", "-f", name)
            finally:
                scoring_input.unlink(missing_ok=True)


def dataset_mounts(test_dir: Path) -> list[str]:
    state = test_dir / ".dataset-state"
    metadata = json.loads((test_dir / ".dataset-task.json").read_text(encoding="utf-8"))
    args = []
    root = test_dir.resolve()
    for directory in candidate_directories(metadata):
        path = test_dir if metadata["workdir"] == directory else state / directory.lstrip("/")
        if not path.is_dir():
            if metadata.get("execution", {}).get("candidateDirectories"):
                raise ValueError(f"候选目录缺失：{directory}")
            continue
        resolved = path.resolve()
        if not resolved.is_relative_to(root) or any(
            parent.is_symlink()
            for parent in [path, *path.parents]
            if parent != test_dir and parent.is_relative_to(test_dir)
        ):
            raise ValueError("候选挂载不能通过链接越过工作区")
        args += ["-v", f"{resolved}:{directory}"]
    return args


def load_dataset_tasks(plan_file: str) -> list[DatasetTask]:
    plan = json.loads(Path(plan_file).read_text(encoding="utf-8"))
    treatment = plan.get("treatment", "COMET_NATIVE_SDK_CURRENT")
    if treatment not in {"COMET_NATIVE_SDK_CURRENT", "CLAUDE_CODE_GOAL"}:
        raise ValueError("未知数据集执行方式")
    goal = treatment == "CLAUDE_CODE_GOAL"
    if plan.get("verifyMode", "standard") not in {"standard", "bugfree"} or (
        goal and plan.get("verifyMode", "standard") != "standard"
    ):
        raise ValueError("数据集验证模式与执行方式不匹配")
    verify_dataset_config(plan)
    if (
        plan["dataset"]["id"] == "workbuddy-code"
        and tree_hash(Path(plan["root"]) / "shared") != plan["sharedHash"]
    ):
        raise ValueError("数据集评分插件发生变化")
    tasks = []
    for entry in plan["tasks"]:
        source = Path(entry["source"])
        if not entry["supported"] or tree_hash(source) != entry["contentHash"]:
            raise ValueError(f"数据集输入不匹配或尚不支持：{entry['id']}")
        verify_public_instruction(entry, plan["dataset"]["id"])
        execution = entry.get("execution", {})
        for key in ("timeoutSeconds", "buildTimeoutSeconds"):
            value = execution.get(key)
            if value is not None and (
                type(value) not in (int, float)
                or not math.isfinite(value)
                or not 0 < value <= 86400
            ):
                raise ValueError(f"数据集预算必须为 1–86400 秒：{key}")
        dataset_resource_args(execution)
        directories = candidate_directories({"execution": execution})
        environment = Path(plan_file).with_suffix("") / treatment / entry["id"] / "environment"
        environment.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source / "environment", environment, dirs_exist_ok=True)
        original = (source / "environment/Dockerfile").read_text(encoding="utf-8")
        # 固定 Agent/Runtime 依赖，保持原有任务镜像层和文件路径。
        native_install = """COPY current-comet-package.json /opt/comet-cli/package.json
RUN npm install --prefix /opt/comet-cli --omit=dev --ignore-scripts --loglevel=http --fetch-timeout=120000 --fetch-retries=1 --audit=false --fund=false && mkdir -p /opt/comet-current && ln -s /opt/comet-cli/node_modules /opt/comet-current/node_modules
RUN printf '#!/bin/sh\\nexec node /opt/comet-current/bin/comet.js "$@"\\n' > /usr/local/bin/comet && chmod 755 /usr/local/bin/comet
"""
        additions = """
USER root
COPY --from=node:22-bookworm-slim /usr/local/ /opt/comet-node/
ENV PATH=/opt/comet-node/bin:/opt/comet-agent/bin:${PATH}
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 bash git curl ca-certificates python3 python3-pip && rm -rf /var/lib/apt/lists/*
COPY current-comet-install-claude.py /opt/comet-install-claude.py
RUN --mount=type=cache,id=comet-eval-npm,target=/root/.npm,sharing=locked python3 -I /opt/comet-install-claude.py "${CLAUDE_CODE_VERSION}" /opt/comet-agent
__NATIVE_INSTALL__
RUN id agent >/dev/null 2>&1 || useradd -m -s /bin/bash agent
RUN mkdir -p /workspace /app /data && chown -R agent:agent /workspace /root /app /data
RUN rm -rf /root/.claude/skills /root/.agents/skills /app/skills /workspace/skills /skills
ENV HOME=/home/agent
WORKDIR /workspace
USER agent
"""
        additions = additions.replace("__NATIVE_INSTALL__", "" if goal else native_install)
        additions = additions.replace(
            "RUN mkdir -p /workspace /app /data && chown -R agent:agent /workspace /root /app /data",
            "RUN mkdir -p /workspace "
            + " ".join(directories)
            + " && chown -R agent:agent /workspace "
            + " ".join(directories),
        )
        if plan["dataset"]["id"] == "workbuddy-code":
            additions = additions.replace(
                "RUN id agent",
                "RUN python3 -m venv /opt/comet-verifier\n"
                "RUN /opt/comet-verifier/bin/python -m pip install --disable-pip-version-check --no-input "
                '"workbuddy-bench @ git+https://github.com/Tencent/workbuddy-bench.git@625b2233093ae4f23e76be28c1f341d41cc70373" '
                '"harbor @ git+https://github.com/harbor-framework/harbor.git@527d50deb63a5d279e8c20593c18a2cbc7f61f9e"\nRUN id agent',
            )
        (environment / "Dockerfile").write_text(
            original + "\nARG CLAUDE_CODE_VERSION=latest\n" + additions, encoding="utf-8"
        )
        if not goal:
            (environment / ".include-current-comet-cli").touch()
        shutil.copy2(
            Path(__file__).with_name("install_claude.py"),
            environment / "current-comet-install-claude.py",
        )
        package = json.loads(
            (Path(__file__).resolve().parents[3] / "package.json").read_text(encoding="utf-8")
        )
        # --omit=dev 仍会解析根开发依赖；这里只装配 CLI 实际使用的依赖图。
        runtime_fields = (
            "name",
            "version",
            "type",
            "dependencies",
            "optionalDependencies",
            "peerDependencies",
            "peerDependenciesMeta",
            "overrides",
            "engines",
        )
        if not goal:
            (environment / "current-comet-package.json").write_text(
                json.dumps(
                    {key: package[key] for key in runtime_fields if key in package}, indent=2
                )
                + "\n",
                encoding="utf-8",
            )
        (environment / ".dataset-task.json").write_text(
            json.dumps(
                {
                    "source": str(source),
                    "id": entry["id"],
                    "contentHash": entry["contentHash"],
                    "workdir": entry.get("workdir", "/workspace"),
                    "treatment": treatment,
                    "execution": execution,
                    "instructionHash": entry.get("instructionHash"),
                    **(
                        {"verifyMode": plan["verifyMode"]}
                        if not goal and "verifyMode" in plan
                        else {}
                    ),
                    "environmentFiles": [
                        file.name
                        for file in environment.iterdir()
                        if file.name not in {".include-current-comet-cli", ".dataset-task.json"}
                    ],
                }
            ),
            encoding="utf-8",
        )
        tasks.append(
            DatasetTask(
                path=source,
                config=TaskConfig(
                    name=entry["id"],
                    description=f"{plan['dataset']['id']}: {entry['id']}",
                    timeout_sec=execution.get("timeoutSeconds", entry["timeout"]),
                    default_treatments=[treatment],
                    evaluation=EvaluationConfig(
                        profile="generic",
                        required_skills=[] if goal else ["comet-native"],
                        require_skill_invocation=not goal,
                    ),
                    interaction=InteractionConfig(
                        mode="auto_user",
                        goal=goal,
                        max_turns=40,
                        simulator_prompt=DATASET_SIMULATOR_PROMPT,
                    ),
                ),
                instruction_template=entry["instruction"],
                manifest_path=Path(plan_file),
                manifest_expectations={
                    "dataset": plan["contentHash"],
                    "task": entry["contentHash"],
                },
                _environment_dir=environment,
                dataset_entry=entry,
                dataset_plan=plan,
            )
        )
    return tasks


def register_dataset_controller_path(test_dir: Path, name: str):
    """登记控制器即将创建的固定路径；原题同名文件必须保留并报错。"""
    if name not in {"_eval_target_skills", ".eval-task-prompt.txt", ".eval-runtime-volume"}:
        raise ValueError("未登记的数据集控制器路径")
    metadata_file = test_dir / ".dataset-task.json"
    if not metadata_file.is_file():
        return
    metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
    if metadata.get("execution", {}).get("controllerFilePolicy") != "exclude-harness-created-paths":
        return
    owned = metadata.get("controllerPaths", [])
    target = test_dir / name
    if target.is_symlink() or (target.exists() and name not in owned):
        raise ValueError(f"原始任务文件与 Eval 控制器路径冲突：{name}")
    git = test_dir / ".git"
    excludes = git / "info/exclude"
    if git.is_symlink() or (git / "info").is_symlink() or excludes.is_symlink():
        raise ValueError("数据集 Git 排除文件不能通过符号链接写入")
    excludes.parent.mkdir(parents=True, exist_ok=True)
    existing = excludes.read_text(encoding="utf-8") if excludes.exists() else ""
    rule = "/" + name
    if rule not in existing.splitlines():
        with excludes.open("a", encoding="utf-8") as stream:
            stream.write("\n" + rule + "\n")
    if name not in owned:
        metadata["controllerPaths"] = [*owned, name]
        metadata_file.write_text(json.dumps(metadata), encoding="utf-8")


def prepare_dataset_workspace(test_dir: Path, agent: str):
    if not (test_dir / ".dataset-task.json").is_file():
        return
    from scaffold.python.utils import build_docker_image

    metadata = json.loads((test_dir / ".dataset-task.json").read_text(encoding="utf-8"))
    build_context = test_dir / ".dataset-build"
    build_context.mkdir()
    for name in metadata["environmentFiles"]:
        if "/" in name or "\\" in name or name in {".", ".."}:
            raise ValueError("环境输入名称无效")
        shutil.move(str(test_dir / name), build_context / name)

    image = build_docker_image(test_dir, agent=agent)
    if not image:
        raise RuntimeError("数据集镜像构建失败")
    name = "comet-eval-seed-" + hashlib.sha256(str(test_dir).encode()).hexdigest()[:24]
    try:
        docker("create", "--name", name, image, "true")
        state = test_dir / ".dataset-state"
        state.mkdir(exist_ok=True)
        for directory in [p.lstrip("/") for p in candidate_directories(metadata)]:
            target = state / directory
            target.mkdir(parents=True, exist_ok=True)
            if "/" + directory != metadata["workdir"]:
                docker("cp", f"{name}:/{directory}/.", target)
        controller_paths = [
            item.name
            for item in test_dir.iterdir()
            if item.name not in {".git", ".dataset-build", ".dataset-state"}
        ]
        with tempfile.TemporaryDirectory() as temporary:
            metadata = json.loads((test_dir / ".dataset-task.json").read_text(encoding="utf-8"))
            docker("cp", f"{name}:{metadata['workdir']}/.", temporary)
            for item in Path(temporary).iterdir():
                target = test_dir / item.name
                if target.exists():
                    raise ValueError(f"原始任务文件与 Eval 文件冲突：{item.name}")
                if item.is_dir():
                    shutil.copytree(item, target)
                else:
                    shutil.copy2(item, target)
        shutil.rmtree(build_context / "skills", ignore_errors=True)
        excludes = test_dir / ".git/info/exclude"
        excludes.parent.mkdir(parents=True, exist_ok=True)
        with excludes.open("a", encoding="utf-8") as stream:
            stream.write("\n.dataset-state/\n.dataset-build/\n")
            # 仅排除公开工作区复制前已存在的控制器文件。原始同名文件会在上面
            # 的碰撞检查中被拒绝；这里不会排除 Native 文档或后续业务文件。
            for name in controller_paths:
                escaped = (
                    name.replace("\\", "\\\\")
                    .replace("[", "\\[")
                    .replace("*", "\\*")
                    .replace("?", "\\?")
                )
                stream.write("/" + escaped + "\n")
        metadata["controllerPaths"] = controller_paths
        (test_dir / ".dataset-task.json").write_text(json.dumps(metadata), encoding="utf-8")
    finally:
        docker("rm", "-f", name)
    if "verifyMode" in metadata:
        register_dataset_controller_path(test_dir, ".eval-runtime-volume")
        seed_dataset_native_mode(test_dir, metadata["verifyMode"])


def seed_dataset_native_mode(test_dir: Path, mode: str):
    """通过公开 CLI 生成配置；执行目录只接收配置，不接收本机 Runtime 标记。"""
    import yaml

    if mode not in {"standard", "bugfree"}:
        raise ValueError("无效的 Native 验证模式")
    package = Path(
        os.environ.get("BENCH_COMET_SOURCE_ROOT", str(Path(__file__).resolve().parents[3]))
    )
    config_file = test_dir / ".comet/config.yaml"
    if config_file.is_symlink() or config_file.parent.is_symlink():
        raise ValueError("数据集 Native 配置不能通过符号链接写入")
    with tempfile.TemporaryDirectory(prefix="comet-eval-init-") as temporary:
        staging = Path(temporary) / "project"
        staging.mkdir()
        if config_file.exists():
            (staging / ".comet").mkdir()
            shutil.copy2(config_file, staging / ".comet/config.yaml")
        result = subprocess.run(
            [
                "node",
                str(package / "bin/comet.js"),
                "native",
                "init",
                "--root",
                "docs",
                "--language",
                "en",
                "--project-root",
                str(staging),
                "--json",
            ],
            cwd=package,
            env={**os.environ, "COMET_DATA_DIR": str(Path(temporary) / "data")},
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=90,
        )
        if result.returncode:
            raise ValueError(
                "数据集 Native 初始化失败："
                + redact_sensitive(result.stdout + result.stderr)[-3000:]
            )
        config = yaml.safe_load((staging / ".comet/config.yaml").read_text(encoding="utf-8"))
    config["native"]["verify_mode"] = mode
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config_file.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
