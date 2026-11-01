"""Assemble A4-only task inputs. No Docker, Runtime, compilation or model execution."""

from pathlib import Path
import argparse
import hashlib
import json
import shutil

BASE = Path(__file__).resolve().parent
if not (BASE / ".generated-fixture").is_file():
    raise SystemExit("Use edit-continuation-052/prepare.py with a fresh output directory")
parser = argparse.ArgumentParser()
parser.add_argument("--cli-root", type=Path, required=True)
parser.add_argument("--harness-root", type=Path, default=BASE.parents[1])
options = parser.parse_args()
root = options.cli_root.resolve()
harness = options.harness_root.resolve()
old = BASE.parent / "a3"
package = json.loads((root / "package.json").read_text(encoding="utf-8"))


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


for workflow in ("native", "classic"):
    (BASE / f"{workflow}-owner").mkdir(exist_ok=True)
    task_name = f"comet-{workflow}-052-authorized-implementation"
    treatment = f"COMET_{workflow.upper()}_052_A4_OWN_ONLY"
    task = BASE / "tasks" / task_name
    for folder in ("environment", "validation", "workspace"):
        (task / folder).mkdir(parents=True, exist_ok=True)
    old_env = old / "tasks" / f"comet-{workflow}-052-edit-continuation" / "environment"
    shutil.copyfile(old_env / "Dockerfile", task / "environment/Dockerfile")
    shutil.copyfile(old_env / "current-comet.sh", task / "environment/current-comet.sh")
    (task / "environment/.include-current-comet-cli").write_text("", encoding="utf-8")
    dependencies = dict(package["dependencies"])
    if workflow == "classic":
        dependencies["@fission-ai/openspec"] = "1.11.0"
    (task / "environment/current-comet-package.json").write_text(
        json.dumps(
            {
                "private": True,
                "type": "module",
                "dependencies": dependencies,
                "overrides": package.get("pnpm", {}).get("overrides", package.get("overrides", {})),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (task / "workspace/_052_case.json").write_text(
        json.dumps({"workflow": workflow, "scenario": "authorized-implementation"}),
        encoding="utf-8",
    )
    (task / "task.toml").write_text(
        f'''[metadata]
name = "{task_name}"
description = "Model judges and implements an authorized behavior change; trusted controller explicitly simulates independent verification and result acceptance"
difficulty = "hard"
category = "comet-{workflow}"
tags = ["052", "A4", "same-run", "implementation-revision"]
default_treatments = ["{treatment}"]
[template]
required = []
[environment]
description = "Frozen public CLI, Chinese Comet own Skills, first-Bash simulated history seed"
dockerfile = "environment/Dockerfile"
timeout_sec = 2700
[validation]
test_scripts = "test_a4.py"
target_artifacts = []
timeout = 180
[evaluation]
profile = "generic"
required_skills = ["comet-{workflow}"]
expected_artifacts = []
require_skill_invocation = true
rubric_criteria = ["Current model judges the actual behavior change", "Same Run preserves original requirements and unaffected checks", "New candidate has separate simulated verification and User acceptance", "One-time effects and Archive are never replayed"]
[interaction]
mode = "none"
''',
        encoding="utf-8",
    )
    helper = f"node /workspace/_eval_trusted_oracles/052-a4/{workflow}/driver.mjs"

    def command(mode):
        return f"{helper} {mode} --cli-root /opt/comet-current --root /workspace"

    (task / "instruction.md").write_text(
        f"""使用提供的中文 /comet-{workflow} Skill 完成隔离项目的当前需求。本次只评估你在已有批准历史上的影响判断与实现续行；历史Agent/User/Verifier由控制器明确模拟，不是从零模型生命周期。

先加载Skill，第一条Bash必须完整执行 `{command("seed")}`。该只读脚本只允许初始化空业务项目，用真实公开CLI建立已验收待Archive历史。以后调用Comet统一使用 `node /opt/comet-current/bin/comet.js`，沿同一容器/Bash环境，不额外设置环境变量。

原批准的稳定API允许left返回1或2，right保持原值。现在请你把left的实际返回值从1改为2，保持接口格式、right行为和其他成果。读取当前正式需求、文件、实际检查与公开continuation，自己判断变化的含义和影响范围。只执行必要检查，保留仍有效的检查，已经执行的一次性操作不得重放。不要修改检查定义、计数器、评估控制器、Runtime管理文件或可信oracle。

记录你自己的影响判断之后、执行修订命令之前，执行 `{command("checkpoint-judgment")}`。它只读取并绑定你的判断和当前Runtime，不替你填写分类或选择检查。随后沿公开continuation完成你负责的修订和Builder工作，不创建新change。

操作顺序是：读取原记录 → 实际修改用户要求的文件 → 观察完整差异并记录自己的判断 → 等待 judgment checkpoint 成功 → 沿原 Run 修订 → 完成新 Builder → 交接独立 Verifier。checkpoint 核对实际文件并绑定修订前的原候选，不执行文件修改，不能修订后补交。

新 Builder 必须完整保留原检查计划与各阶段职责。Native 的 Builder outcome 应包含从原历史读取的完整 `verificationChecks`，不能省略成空计划；检查是否重跑由自己的影响判断及 Runtime 决定。Classic 沿用原 Build 的命令与收据定义，不将后继独立 Verifier 负责的命令移到 Build，也不自行执行 Verifier Action。这些约束不替你判断变化含义、填写决定或选择保留哪些检查。

出现独立Verifier交接时执行 `{command("verify")}`。该控制器以明确的模拟独立Verifier身份读取实际需求与文件，核对真实检查并提交自己的结果。你不能代它提交Verifier claim/outcome，不创建冒充独立Verifier的会话。继续执行Runtime要求的报告或归档提案准备；出现新的用户结果确认时执行 `{command("approve")}`，由控制器明确模拟User核对并接受本次结果。你不能自行批准新结果，也不能先批准再让控制器补证。

控制器失败时保留实际错误，不修改断言、伪造证明或继续越过它。成功后沿公开continuation执行一次Archive{"和本地delivery" if workflow == "classic" else "与finalization"}，检查最终状态。禁止安装或调用Superpowers及其他外部Skill；只用提供的Comet自有Skill。最后简述真实变更、实际执行和保留的检查、验收及最终状态，并明确独立Verifier/User为控制器模拟。
""",
        encoding="utf-8",
    )
    shutil.copyfile(BASE / "validator_template.py", task / "validation/test_a4.py")
    skills = (
        ["comet-native"]
        if workflow == "native"
        else [
            "comet",
            "comet-classic",
            "comet-archive",
            "comet-verify",
            "comet-build",
            "comet-design",
            "comet-open",
            "comet-tweak",
            "comet-hotfix",
        ]
    )
    content = f'{treatment}:\n  description: "A4 model judgment and Builder with explicit simulated controller roles"\n  claude_md: |\n    只使用中文Comet自有Skill。不要安装或调用Superpowers。沿真实Runtime续行；独立Verifier和User由任务控制器明确模拟，模型不得代替。\n  skills:\n'
    for skill in skills:
        source = root / "assets/skills-zh" / skill
        if not (source / "SKILL.md").is_file():
            raise ValueError(f"Missing Chinese Skill: {source}")
        content += f"    - name: {skill}\n      source: path\n      path: {json.dumps(source.as_posix())}\n      profile: generic\n"
    destination = BASE / "treatments/comet"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / f"{workflow}.yaml").write_text(content, encoding="utf-8")

# Tool transport setup only; it does not prefill any content judgment.
for _workflow in ("native", "classic"):
    _task = next((BASE / "tasks").glob(f"comet-{_workflow}-*/instruction.md"))
    _task.write_text(
        _task.read_text(encoding="utf-8")
        + "\n控制器调用的工具参数：Bash 使用 timeout=600000、run_in_background=false，并等待同一次调用返回。每个控制器命令必须单独占用整个 Bash command 字符串，原样执行；计数已经包含在证明输出中。需要 cat、echo 或其他诊断时另起一次 Bash，不能与控制器命令通过分号、&&、管道、重定向或其他方式拼接。保持原命令，只设置工具参数；seed 在 Windows 挂载目录可能超过默认 120 秒。不要重复 seed。此设置只保证 host 能将真实控制器输出绑定到原工具 ID，不替你作内容判断。\n",
        encoding="utf-8",
    )
files = {
    file.relative_to(BASE).as_posix(): sha(file)
    for folder in ("native", "classic", "tasks", "treatments")
    for file in sorted((BASE / folder).rglob("*"))
    if file.is_file() and "__pycache__" not in file.parts
}
for file in BASE.glob("*.py"):
    files[file.name] = sha(file)
candidate = {
    file.relative_to(root).as_posix(): sha(file)
    for folder in ("bin", "dist", "assets")
    for file in sorted((root / folder).rglob("*"))
    if file.is_file()
}
for filename in ("package.json", "pnpm-lock.yaml"):
    if (root / filename).is_file():
        candidate[filename] = sha(root / filename)
old_files = {
    file.relative_to(old).as_posix(): sha(file)
    for file in sorted(old.rglob("*"))
    if file.is_file()
    and ("logs" not in file.parts)
    and "__pycache__" not in file.parts
    and file.suffix in (".py", ".mjs", ".toml", ".yaml", ".md")
}
manifest = {
    "schema": "comet.052.a4.assembly.v1",
    "cliRoot": str(root),
    "modelStarted": False,
    "files": files,
    "candidateFiles": candidate,
    "candidateHash": hashlib.sha256(json.dumps(candidate, sort_keys=True).encode()).hexdigest(),
    "originalA3Files": old_files,
    "scope": "Prepared inputs only; build freshness, container and Runtime dryrun are not verified",
}
(BASE / "assembly-inputs.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(
    json.dumps(
        {
            "assembled": True,
            "tasks": 2,
            "modelStarted": False,
            "candidateHash": manifest["candidateHash"],
            "manifest": str(BASE / "assembly-inputs.json"),
        }
    )
)
