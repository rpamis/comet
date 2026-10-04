# Native 应用扩展与候选审查样板

`@rpamis/comet/applications/native` 提供 `createNativeWorkflowApplication(context, options)`。应用仍使用 Native 的 Shape、Builder、独立 Verifier、用户确认及 Archive 规则；扩展在原候选检查之后执行，必需扩展通过后才继续原流程。

`extensions` 按声明顺序执行。每项声明 `id`、已适配的 `skillId`、`scopes`、实际检查的 `artifactRefs` 和业务 `validator`。范围为普通候选 `candidate`、Supervisor 父候选 `parent`、Child 候选 `child` 与集成候选 `integration`。Builder 指导通过 manifest 的 `usage: guidance` 绑定对应 Builder；它只提供固定内容，不能代替工件检查。

扩展输入中的 `activation.reviewSource` 固定原检查 Action、inputHash、outcomeId、候选、Shape 和验收索引，并保留 Child 的 contractHash、branch、worktree、baseCommit、candidateCommit、Builder session，或集成候选的原 merge/check/repair 关联。`activation.workspaceRoot` 指向本次实际工作区。结果须包含 `verdict`、`bindingHash`、`artifactHashes`、非空 `summary`，并通过真实业务验证器。`loaded: true` 或自行声明 pass 不能通过验证。

`fail` 返回原范围的 Builder 或集成修复 Action，新候选重新检查。`revise-requirements` 产生待用户决定，沿 `comet native next <name> --revise-requirements` 的受保护命令返回 Shape；重新确认后才可继续。存在 running/unknown 工作时先核对原执行，不取消它来修改需求。审查 pass 不代替独立 Verifier 和用户接受结果。

Supervisor 在 Build 期间直接调整需求、设计或验收范围，也可执行上述公开修订命令，无须先让扩展报告需求变化。命令须同时提供非空 `--summary`、当前 `--expected-state-version` 和 `--expected-action revise-requirements`。任何 running/unknown Action 都会阻止修订；先核对原执行结果，再继续同一 Run。

修订 Action 读取已有 Git 工作区的实际分支与提交，保留 Child 候选、集成工作和未提交文件。返回 Shape 时旧确认与验收状态失效，历史 Action 和结果仍可查询。重新确认后沿新的 Builder、检查及独立 Verifier 重新验收；历史通过不能代替本轮结果。保留的工作区身份或提交在恢复前变化时明确阻塞。本路径沿用原 Native workflow 声明与定义校验，固定自定义 Application 的包与依赖检查仍然生效。

真实 Builder 失败产生的 resume 决定也可沿此命令返回 Shape；原 failed 结果、领取关联、候选提交与未提交文件保留，旧待决定项取消，新范围重新确认后才派发 Builder。父目标分支基线与保留的集成基线分别绑定。父候选通过独立验收并获用户接受后，`comet native archive <name> --dry-run` 只读核对交付候选、目标分支、快进关系及工作区；未绑定的目标分支变化会阻塞，不领取交付 Action 或提前合并目标分支。

本地写入 Skill 绑定 `workspaceFrom: activation.workspaceRoot`，声明范围相对此 Action 的实际工作区解析。不同真实 worktree 中的相对文件可以并行；同一绝对文件、目录包含关系及符号链接别名仍有冲突。并行写入不能混用默认范围和实际工作区声明，无法比较时明确拒绝。副作用沿用原 Run 的有效 Wait 批准和宿主授权，外部操作须提供结果核对能力。

## 公开启动模板

`prepareNativeCandidateReviewProject` 在调用者指定的全新 Git 项目中准备正式 brief/Spec、初始候选、固定 Application 包与完整 `startRequest`，不启动或批准 Run。包目录必须为空，项目不能已有 Comet 配置、同名 change 或 candidate.txt。三个 Skill 均带宿主可发现的 `name`、`description` 元数据。

以下 PowerShell 模板使用待验证候选的 npm 包。`$candidatePackage` 替换为当前候选的本地 `.tgz`，避免误用全局 CLI。

```powershell
$candidatePackage = 'D:/artifacts/comet-candidate.tgz'
$exampleRoot = Join-Path $env:TEMP ('comet-native-example-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$exampleRoot/project" -Force | Out-Null
npm install --prefix $exampleRoot --ignore-scripts --no-audit --no-fund $candidatePackage
git -C "$exampleRoot/project" init -b main
git -C "$exampleRoot/project" -c user.name='Comet Example' -c user.email='example@localhost' commit --allow-empty -m 'example base'
@'
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prepareNativeCandidateReviewProject } from '@rpamis/comet/applications/native';
const root = process.argv[2];
const prepared = await prepareNativeCandidateReviewProject({
  projectRoot: path.join(root, 'project'), packageRoot: path.join(root, 'application'),
});
await fs.writeFile(path.join(root, 'start.json'), JSON.stringify(prepared.startRequest, null, 2));
console.log(JSON.stringify({ ...prepared, startRequest: path.join(root, 'start.json') }, null, 2));
'@ | Set-Content "$exampleRoot/prepare.mjs" -Encoding utf8
node "$exampleRoot/prepare.mjs" $exampleRoot
$exampleCli = "$exampleRoot/node_modules/@rpamis/comet/bin/comet.js"
node $exampleCli runtime dispatch --application-file "$exampleRoot/application/application.json" --project-root "$exampleRoot/project" --request "$exampleRoot/start.json"
node $exampleCli native next native-example --project-root "$exampleRoot/project" --json
```

入口 Skill 位于 `$exampleRoot/application/SKILL.md`。参考宿主从该入口开始，读取当前 `native status --json` 的 `skillWork` 和 `next` 返回的具体决定参数，取得用户对完整 Shape 的确认后继续。Builder 要读取实际指导并产出候选；独立 Verifier 使用独立执行者。宿主不要读取私有测试 helper，也不要手写投影状态来推进。

候选审查就绪后，将以下公开请求模板写在包目录之外。所有占位值从当前 inspect 的原 Action 读取；不得为中断工作创建新 attempt 或更换 claim。

```json
{
  "operation": "claim",
  "runId": "native-example",
  "actionId": "<当前审查Action.id>",
  "attempt": 1,
  "inputHash": "<当前Action.inputHash>",
  "executorId": "native-review-script",
  "capabilities": ["skill-script"],
  "sessionId": "<实际宿主会话关联标识>",
  "claimToken": "<本次领取token>"
}
```

使用 `runtime dispatch --application native-candidate-review --project-root <项目> --request <JSON>` 领取和 inspect。宿主加载当前 `skillWork` 的真实磁盘 Skill 后，执行 `node <candidate-review/scripts/review.mjs> '<当前Action.input的JSON>'`，将实际输出按以下模板回报。sessionId、executorId 是关联信息，不构成身份认证。

```json
{
  "operation": "record-outcome",
  "runId": "native-example",
  "outcome": {
    "actionId": "<原Action.id>",
    "attempt": 1,
    "inputHash": "<原Action.inputHash>",
    "claimToken": "<原token>",
    "outcomeId": "<稳定结果id>",
    "status": "succeeded",
    "output": "<替换为脚本实际返回的JSON对象>"
  }
}
```

也可使用 `operation: execute`、当前 actionId 和 `executorId: native-review-script` 运行确定性脚本宿主。故意提交缺少 approved 的候选可验证修复；提交 NEEDS-REQUIREMENTS 可验证需求修订。恢复时先 inspect 同一 Run，查询 pending/running/unknown 和原 claim。固定包、Skill、工作区或候选漂移时恢复原内容后继续，不修改归属记录来接受漂移。

## 验证范围

当前确定性测试覆盖实际磁盘 Skill、公开 CLI 跨进程恢复、实际双 Child worktree、失败修复、集成及父候选、独立验收与用户确认保留、未知执行和需求修订。Native 自带应用仍由原工厂提供。活动及归档 checkpoint 恢复都要求原固定包和依赖。

公开 Supervisor transfer 支持 Child Builder 与候选审查、尚未进入独立 Verify/集成的现场。导入前核对原固定 Application、依赖、工作流、Git 分支和工件；原包路径不可用或内容变化时先阻塞，不登记内置应用。导入复用原 portable 合同：原领取 token 转为 portable 摘要，Action ID、attempt 和会话关联保留，执行工作区重定位。回执保存原与目的输入/审查绑定的对应关系；未知审查使用原执行已经返回的真实结果，按目的工作区的实际工件重新核对后回报，不再次派发 Action。原始输出保留，验证器只在核对该回执时解释绑定的重定位。

修订后重复准备同一 Child 时，转移包按实际工作区与分支保留一份快照，原历史 Action 不删除。重复身份、分支或提交与 checkpoint、Git bundle 不一致时，导入在写入目标分支前拒绝。

这些检查不证明真实模型已经遵循 Skill，也不证明 Codex/Claude Code 的平台 Hook 或交接已通过。真实宿主与模型矩阵仍须按用户确认的模型、CLI 版本、次数和时限分别运行；未运行项保持未完成。
