"""Write two isolated 052 Eval tasks; never build images, seed Runs, or call models."""

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
ROOT = options.cli_root.resolve()
HARNESS = options.harness_root.resolve()
docker = """FROM node:22-bookworm-slim
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends bash git curl jq ca-certificates python3 python3-pip python-is-python3 && rm -rf /var/lib/apt/lists/*
RUN pip install --break-system-packages --no-cache-dir pyyaml pytest
COPY current-comet-package.json /opt/comet-cli/package.json
RUN npm install --prefix /opt/comet-cli --omit=dev --ignore-scripts
RUN mkdir -p /opt/comet-current && ln -s /opt/comet-cli/node_modules /opt/comet-current/node_modules
__OPENSPEC_LINK__
ARG CLAUDE_CODE_VERSION=2.1.310
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
COPY current-comet.sh /usr/local/bin/comet
RUN chmod 0755 /usr/local/bin/comet && useradd --create-home --shell /bin/bash agent && chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
ENV ENABLE_TOOL_SEARCH=false
ENV PYTHONPATH=/workspace
RUN git config --global user.email "agent@eval.local" && git config --global user.name "052 Eval Agent" && git config --global init.defaultBranch main
CMD ["bash"]
"""

for workflow in ("native", "classic"):
    task_name = f"comet-{workflow}-052-edit-continuation"
    treatment = f"COMET_{workflow.upper()}_052_OWN_ONLY"
    task = BASE / "tasks" / task_name
    for folder in ("environment", "validation", "workspace"):
        (task / folder).mkdir(parents=True, exist_ok=True)
    openspec_link = (
        "RUN ln -s /opt/comet-cli/node_modules/.bin/openspec /usr/local/bin/openspec"
        if workflow == "classic"
        else ""
    )
    (task / "environment/Dockerfile").write_text(
        docker.replace("__OPENSPEC_LINK__", openspec_link), encoding="utf-8"
    )
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    dependencies = dict(package["dependencies"])
    if workflow == "classic":
        dependencies["@fission-ai/openspec"] = "1.11.0"
    (task / "environment/current-comet-package.json").write_text(
        json.dumps(
            {
                "type": "module",
                "private": True,
                "dependencies": dependencies,
                "overrides": package.get("pnpm", {}).get("overrides", package.get("overrides", {})),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (task / "environment/.include-current-comet-cli").write_text("", encoding="utf-8")
    shutil.copyfile(
        HARNESS / "eval/local/tasks/comet-native-sdk-recovery/environment/current-comet.sh",
        task / "environment/current-comet.sh",
    )
    (task / "workspace/_052_case.json").write_text(
        json.dumps({"workflow": workflow}), encoding="utf-8"
    )
    (task / "task.toml").write_text(
        f'''[metadata]
name = "{task_name}"
description = "Resume ordinary edits in the same accepted SDK Run; preserve unrelated checks and approvals"
difficulty = "hard"
category = "comet-{workflow}"
tags = ["052", "edit-continuation", "same-run"]
default_treatments = ["{treatment}"]
[template]
required = []
[environment]
description = "Current CLI and Chinese Comet own Skills only; accepted fixture is seeded by the host controller"
dockerfile = "environment/Dockerfile"
timeout_sec = 2700
[validation]
test_scripts = "test_052.py"
target_artifacts = []
timeout = 180
[evaluation]
profile = "generic"
required_skills = ["comet-{workflow}"]
expected_artifacts = []
require_skill_invocation = true
rubric_criteria = ["Current Agent judges actual language-independent edits", "Preserves original accepted Run and applicable checks", "Rejects fresh unjudged input and never replays one-time effects"]
[interaction]
mode = "none"
''',
        encoding="utf-8",
    )
    controller = "controller.mjs" if workflow == "native" else "driver.mjs"
    preparation = (
        "控制器已通过真实公开CLI预置原Run，请先加载Skill并查看当前状态。"
        if workflow == "classic"
        else "先加载Skill。第一条Bash工具调用必须完整执行 `node /workspace/_eval_trusted_oracles/052/native/driver.mjs seed --cli-root /opt/comet-current --root /workspace --evidence /workspace/.git/052-fixture-evidence`。它只允许空隔离项目，用真实公开CLI模拟历史Agent/User并停在已接受待归档；已有Run会拒绝。此步骤不是你的需求判断，不计为从零模型研发。其后所有Comet调用使用 `node /opt/comet-current/bin/comet.js` 这个公开入口，以继承相同容器和Bash环境，不额外设置环境变量。"
    )
    extra = (
        """
完成第一轮补充检查后，执行同一 prepare-edits 命令但使用 --round 2，重新判断实际新输入并补充必要检查。第二轮补充检查已创建、尚未执行时运行下面的新鲜度负控。
"""
        if workflow == "native"
        else """
本例仅一轮编辑。补充检查已创建、尚未执行时运行下面的新鲜度负控。
"""
    )
    (task / "instruction.md").write_text(
        f"""请使用 /comet-{workflow} 继续隔离项目的已批准需求。本例通过只读控制器建立“原实现与验收已获批准、尚待归档”的历史状态；前置Agent/User明确模拟，本次只评价你的编辑续行，不创建其他change。

用户要求：普通代码/说明和正式文档可以正常修改，沿原 Run 轻量继续。你需要自己读取当前原文、差异及公开 continuation，判断含义与受影响检查；内容判断不能依赖文件语言、AST 或编译。保留仍适用的原批准、报告和检查，执行必要的补充检查，最终只归档一次。此前已完成的一次性动作不得重放。用户禁止安装或调用 Superpowers，也不调用其他外部 Skill。仅使用已安装的 Comet 自有中文 Skill 草稿和当前 comet CLI。

{preparation}

用户编辑由只读控制器施加：执行 `node /workspace/_eval_trusted_oracles/052/{workflow}/{controller} prepare-edits --cli-root /opt/comet-current --root /workspace --round 1`。它对普通输入连续保存十次并改写一处正式文档说明，不推进Runtime、不作语义判断。然后你读取修改内容，一次合并处理，按公开Runtime当前模板继续。不要直接修改Runtime管理文件，也不要改写验收控制器、计数器或检查定义。
{extra}
将 Runtime 返回的待执行补充检查 executeRequest 原样保存为 JSON，并执行 `node /workspace/_eval_trusted_oracles/052/{workflow}/{controller} negative-control --cli-root /opt/comet-current --root /workspace --file <executeRequest.json>`。编辑判断和 Runtime 请求 JSON 保存在 /tmp 临时目录，避免把控制请求当作业务输入修改。这段只读控制器会临时注入一个新的实际行为变化，尝试旧请求，要求它被拒绝且没有执行副作用，然后恢复先前确切输入。它不会替你判断内容或执行恢复后的检查。若控制器失败，保留实际错误并停止，不降低断言。

负控通过后，沿公开 continuation 完成补充检查；重复提交同一个 refresh 请求不得再次执行已完成检查。核对实际结果后沿原批准归档，并使用公开状态查询确认完成。不要重新启动 Builder 或重新请求已覆盖的批准。若发现真实需求变化超出原批准，明确报告阻塞，不能为了达到终态而伪造批准。最后说明改动、执行与保留的检查、真实阻塞及完成状态。
""",
        encoding="utf-8",
    )
    (task / "validation/test_052.py").write_text(
        """import json, subprocess, traceback
from pathlib import Path
root=Path('/workspace/_eval_trusted_oracles/052')
workflow=json.loads((root/'model-tool-evidence.json').read_text())['workflow']
assert workflow in ('native','classic'), 'Invalid host-selected workflow'
result={'passed':[], 'failed':[], 'validation_evidence':{}}
try:
    proof=json.loads((root/'model-tool-evidence.json').read_text())
    assert proof['workflow']==workflow and proof['subjectExitCode']==0, 'Subject failed or timed out'
    assert not proof['forbiddenSkills'], 'External Skill invoked'
    assert proof['observedExtraAgentCalls']==0 and proof['extraAgentToolCalls']==[], 'Extra model Agent creation tool was invoked'
    assert proof['observedSubprocessAgentCalls']==0 and proof['subprocessAgentCalls']==[], 'A direct child Claude process was observed'
    assert proof['negativeProofs'], 'Missing host-observed negative control tool result'
    required_rounds=[1,2] if workflow=='native' else [1]
    assert sorted(p['round'] for p in proof['editProofs'])==required_rounds, 'Missing or repeated controlled edit rounds'
    assert proof['editProofs'][0]['saves']==10, 'Missing ten-save merge input'
    command=['node',str(root/workflow/'driver.mjs'),'validate','--cli-root','/opt/comet-current','--root','/workspace','--evidence','/workspace/.git/052-fixture-evidence','--baseline',str(root/workflow/'baseline.json')]
    p=subprocess.run(command,capture_output=True,text=True,timeout=150)
    assert p.returncode==0, p.stdout+'\\n'+p.stderr
    runtime=json.loads(p.stdout)
    assert len(proof['negativeProofs'])==1, 'Missing or repeated negative control'
    if workflow=='native':
        assert len(proof['seedProofs'])==1 and proof['seedWasFirstBash'], 'Missing authoritative first Bash seed baseline'
        assert runtime['baselineHash']==proof['seedProofs'][0]['baselineHash'], 'Baseline differs from real seed tool output'
        neg=proof['negativeProofs'][0]
        assert neg['actionId']==runtime['refreshActionIds'][-1], 'Negative control was not bound to latest supplemental check'
        assert neg['before']==neg['after']==dict(a=2,b=1,once=1), 'Negative control executed a check'
        assert neg['exitCode']!=0 and neg['rejection']['status']=='failed', 'Runtime did not explicitly reject fresh input'
    result['passed']=['Same accepted Run, original approvals/reports and unaffected checks preserved','Affected checks refreshed; one-time effects and Archive not replayed','Real tool result rejected new unjudged input without execution','Current Agent processed ten saved edits together']
    result['validation_evidence']={'runtime':runtime,'hostToolEvidence':proof,'scope':'Accepted offline seed plus real model continuation; not a full lifecycle model Eval'}
except Exception:
    result['failed']=[traceback.format_exc()]
Path('/workspace/_test_results.json').write_text(json.dumps(result))
print(json.dumps(result))
""",
        encoding="utf-8",
    )
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
    content = f"""{treatment}:
  description: '052 accepted Run continuation with current Chinese Comet own Skills only'
  claude_md: |
    使用当前中文 Comet Skill 继续已有 change。用户禁止外部 Skill，包括 Superpowers。前置 change 已批准，不初始化新流程；依据公开 Runtime continuation 和实际差异自行判断。
  skills:
"""
    for skill in skills:
        source = ROOT / "assets/skills-zh" / skill
        if not (source / "SKILL.md").is_file():
            raise ValueError(f"Missing Chinese Skill: {source}")
        content += f"    - name: {skill}\n      source: path\n      path: {json.dumps(source.as_posix())}\n      profile: generic\n"
    treatment_dir = BASE / "treatments/comet"
    treatment_dir.mkdir(parents=True, exist_ok=True)
    (treatment_dir / f"{workflow}.yaml").write_text(content, encoding="utf-8")

# Tool transport setup only; it does not prefill any content judgment.
for _workflow in ("native", "classic"):
    _task = next((BASE / "tasks").glob(f"comet-{_workflow}-*/instruction.md"))
    _task.write_text(
        _task.read_text(encoding="utf-8")
        + "\n控制器调用的工具参数：Bash 使用 timeout=600000、run_in_background=false，并等待同一次调用返回。保留上列命令字符串原样，仅设置工具参数；seed 在 Windows 挂载目录可能超过默认 120 秒。不要重复 seed。此设置只保证 host 能将真实控制器输出绑定到原工具 ID，不替你作内容判断。\n",
        encoding="utf-8",
    )
files = {
    p.relative_to(BASE).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
    for d in ("native", "classic", "tasks", "treatments")
    for p in sorted((BASE / d).rglob("*"))
    if p.is_file() and not any(part.startswith("dryrun") for part in p.relative_to(BASE).parts)
}
for name in ("assemble.py", "eval_052_plugin.py", "run.py", "agent_call_audit.py"):
    files[name] = hashlib.sha256((BASE / name).read_bytes()).hexdigest()
(BASE / "assembly-inputs.json").write_text(
    json.dumps(
        {"schema": 1, "cliRoot": str(ROOT), "modelStarted": False, "files": files}, indent=2
    ),
    encoding="utf-8",
)
print(
    json.dumps(
        {
            "assembled": True,
            "tasks": 2,
            "modelStarted": False,
            "inputManifest": str(BASE / "assembly-inputs.json"),
        }
    )
)
