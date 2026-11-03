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


def dataset_config_hash(root: Path) -> str:
    file = root / "dataset.toml"
    if not file.is_file() or file.is_symlink():
        raise ValueError("WorkBuddy 数据集缺少有效的 dataset.toml；请重新下载完整数据集")
    return "sha256:" + hashlib.sha256(file.read_bytes()).hexdigest()


def verify_dataset_config(plan: dict) -> None:
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

    def load_validators(self):
        return [self.validate_dataset]

    def validate_dataset(self, test_dir, outputs):
        # 原始评分可能注入测试或 stage 文件；在候选副本中判分，保留 Native 候选不变。
        with tempfile.TemporaryDirectory(prefix="comet-dataset-score-") as temporary:
            candidate = Path(temporary) / "candidate"
            shutil.copytree(test_dir, candidate, symlinks=True)
            return self._score_dataset(candidate, outputs)

    def _score_dataset(self, test_dir, outputs):
        from scaffold.python.utils import build_docker_image

        entry, plan = self.dataset_entry, self.dataset_plan
        try:
            verify_dataset_config(plan)
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
        python = (
            ["/opt/comet-verifier/bin/python", "-I"]
            if plan["dataset"]["id"] == "workbuddy-code"
            else ["python3"]
        )
        args = [
            "create",
            "--name",
            name,
            "--user",
            "root",
            "-v",
            f"{Path(test_dir).resolve()}:/workspace",
            "-v",
            f"{Path(plan['root']).resolve()}:/opt/dataset-original:ro",
            "-v",
            f"{script.resolve()}:/opt/dataset_score.py:ro",
            *mounts,
            image,
            *python,
            "/opt/dataset_score.py",
            plan["dataset"]["id"],
            entry["id"],
        ]
        try:
            docker(*args)
            result = docker(
                "start", "-a", name, timeout=entry.get("verifierTimeout", entry["timeout"]) + 120
            )
            # docker start 的退出状态不代表容器中的判分进程成功。
            status = docker("inspect", "--format", "{{.State.ExitCode}}", name).stdout.strip()
            if status != "0":
                raise ValueError(f"判分进程退出 {status}: {result.stdout[-1500:]}")
            line = next(
                line
                for line in reversed(result.stdout.splitlines())
                if line.startswith("COMET_DATASET_REWARD=")
            )
            raw = json.loads(line.split("=", 1)[1])
            reward, passed = reward_result(json.dumps(raw["reward"]))
            outputs["dataset_result"] = {
                **raw,
                "stdout": redact_sensitive("\n".join(result.stdout.splitlines()[:-1])[-16000:]),
                "stderr": redact_sensitive(getattr(result, "stderr", "")[-6000:]),
                "dataset": plan["dataset"],
                "task": entry["id"],
                "contentHash": entry["contentHash"],
            }
            score = f"[RUBRIC] dataset-score: {reward}"
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
            docker("rm", "-f", name)


def dataset_mounts(test_dir: Path) -> list[str]:
    state = test_dir / ".dataset-state"
    metadata = json.loads((test_dir / ".dataset-task.json").read_text(encoding="utf-8"))
    return [
        arg
        for name in ("root", "app", "data")
        if (state / name).is_dir()
        for arg in (
            "-v",
            f"{(test_dir if metadata['workdir'] == '/' + name else state / name).resolve()}:/{name}",
        )
    ]


def load_dataset_tasks(plan_file: str) -> list[DatasetTask]:
    plan = json.loads(Path(plan_file).read_text(encoding="utf-8"))
    treatment = plan.get("treatment", "COMET_NATIVE_SDK_CURRENT")
    if treatment not in {"COMET_NATIVE_SDK_CURRENT", "CLAUDE_CODE_GOAL"}:
        raise ValueError("未知数据集执行方式")
    goal = treatment == "CLAUDE_CODE_GOAL"
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
                    timeout_sec=entry["timeout"],
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
                        simulator_prompt="You are a simulated evaluation user. Confirm reasonable work within the original task scope. Do not provide solutions or hidden test information. Explicitly approve or reject requested decisions.",
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
        for directory in ("root", "app", "data"):
            target = state / directory
            target.mkdir(exist_ok=True)
            docker("cp", f"{name}:/{directory}/.", target)
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
    finally:
        docker("rm", "-f", name)
