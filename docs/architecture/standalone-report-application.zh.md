# 独立报告 Application 样板

`@rpamis/comet/applications` 导出的 `createReportApplication` 提供完整的报告生成、用户审批和本地发布流程。它使用 SDK 的 Run、Action、Wait、子工作流、明确 join 和声明的转移，自行定义报告规则，不依赖 Native 或 Classic 阶段，也不自动获得 Native 独立验收、合并、推送或部署授权。

生成流程的 `draft` 和 `sources` 可以按任意完成顺序回报。两者完成后，`compose` 才写入实际 Markdown 草稿。父 Run 读取子 Run 的结果后进入审批，提案包括草稿的项目相对路径、SHA-256 摘要和完整 Markdown。发布前再次核对实际字节，发布结果也必须对应实际发布文件；加载记录或完成字符串不能代替这些检查。

## 创建可运行的包

在安装了 Comet 0.4.6 的项目中创建独立目录，例如 `.comet/applications/local-report/`。以下三份文件组成最小 Application 包，全部通过现有公开加载器运行。

`application.json`：

```json
{
  "schema": "comet.workflow.application.v1",
  "id": "local-report",
  "version": "1",
  "base": "standalone",
  "runtimeVersion": "0.4.6",
  "entrySkill": "ENTRY.md",
  "module": "application.mjs",
  "skills": [],
  "bindings": []
}
```

`application.mjs`：

```js
export { createReportApplication as createApplication } from '@rpamis/comet/applications';
```

`ENTRY.md` 保存入口的运行说明：

```markdown
# 报告发布

使用本包 application.json 启动 report-publishing@1，输入 title、body 和 sources。
保存原 Run ID，之后使用 --application local-report 查询、执行与恢复。
子流程完成后展示审批提案中的实际 Markdown、文件路径和摘要，等待用户选择。
approved 才能派发发布；rejected 保留草稿并结束；revise 重新读取草稿并再次审批。
结果未知时核对原 Action 与实际文件，不重新发送、部署或覆盖文件。
该流程只验证声明的报告格式和本地发布，不证明来源事实正确，也不提供 Native 独立验收。
```

样板没有外部 Skill 依赖。自己的模型、报告指导 Skill 或工具可以按 Application 适配契约加入；它们的能力、审批、副作用和恢复语义需要分别声明，不能仅靠替换入口说明改变 Run 的执行规则。

样板提供固定的 `inspectHook`：当前 `approve` 或 `approve-revision` 等待用户决定时，可编辑本 Run 的实际草稿，随后选择 `revise`，重新检查并取得新提案的批准。批准后及发布结果未知时拒绝直接修改草稿；SDK 自己通过原执行端口写入和发布文件。Guard 检查项目路径与实际父链，拒绝外根、junction、其他 Run 草稿、固定包、SDK 存储和发布文件的工具写入。结束后仍保留这些资源的保护，对普通项目文件保持中立。

工厂收到完整 Application 上下文时，使用其 `packageRoot` 保护实际固定包路径；直接调用工厂的宿主也可提供该字段。Guard 只检查平台能明确归属的文件写入；未知 shell 行为仍由宿主范围约束及实际执行审计处理，不构成操作系统沙箱。本地发布没有自动变成外部副作用；外部系统恢复需要另行声明 `invoke_skill` 的 `sideEffect: external`，并提供真实宿主 `reconcile` 查询。

## 通过公开 CLI 执行

每次请求写入独立 JSON 文件。首次请求使用包文件，后续请求使用应用身份与同一个 Run ID。下面的 `<项目绝对路径>` 必须是实际项目目录：

```sh
comet runtime dispatch --application-file .comet/applications/local-report/application.json --project-root <项目绝对路径> --request start.json --json
comet runtime dispatch --application local-report --project-root <项目绝对路径> --request request.json --json
```

`start.json`：

```json
{
  "operation": "start",
  "runId": "quarterly-report",
  "workflow": { "id": "report-publishing", "version": "1" },
  "input": {
    "title": "季度报告",
    "body": "本季度已完成三个项目。",
    "sources": ["本地项目记录"]
  }
}
```

1. 对父 Run 提交 `{ "operation": "next", "runId": "quarterly-report" }`。读取返回的 `children[0].runId`，这是真实子 Run 的身份。
2. 对该子 Run 提交 `inspect`，然后对它每个 `pending` Action 提交下面的 `execute` 请求。先执行 `draft` 和 `sources`；两者完成后执行新派发的 `compose`。所有请求可以来自不同进程。
3. 再对父 Run 提交 `next`。父 Run 进入 `waiting`，此时不存在发布 Action 或发布文件。读取当前 `pending` Wait，向用户展示其 `proposal.outputs.generate.compose` 中的报告。

```json
{
  "operation": "execute",
  "runId": "<实际子 Run ID>",
  "actionId": "<当前 pending Action ID>",
  "executorId": "report-local"
}
```

实际用户选择通过当前 Wait ID、提案摘要和唯一决定 ID 提交。宿主负责获取用户决定；CLI 不自行构造或冒充用户批准。

```json
{
  "operation": "resolve-wait",
  "runId": "quarterly-report",
  "waitId": "<当前 Wait ID>",
  "proposalHash": "<当前 proposalHash>",
  "decisionId": "<本次用户决定的唯一 ID>",
  "choice": "approved"
}
```

`approved` 派发 `publish`，执行它后将报告原字节写入 `.comet/reports/local-report/published/<Run ID 摘要>.md`。`rejected` 派发 `rejected`，执行后以业务结果 `status: rejected` 结束，保留草稿。SDK 的 `completed` 表示声明的路径结束，不能据此声称报告已经发布；必须读取 `outputs.publish` 或 `outputs.rejected`。

## 修改、修复和中断恢复

- 修改前保存实际草稿路径：`.comet/reports/local-report/drafts/<Run ID 摘要>.md`。编辑正文后选择 `revise`，执行 `revise` Action。应用读取实际文件，核对一级标题、非空正文和 1 MiB 大小限制，生成新的摘要与 `approve-revision` Wait。必须重新展示并获取批准。原 Wait 的决定不能复用。
- 最多允许两次修订。第三次选择 `revise` 会派发 `limit`，执行后以 `revision-limit` 结束并保留草稿。开始新的 Run 才能重新创作；不要改写状态文件规避上限。
- 报告在批准后、发布 Action 领取前变化时，发布预检拒绝并保留 `pending`。可用声明的 `revise` 命令取消未领取发布 Action，重新检查和审批；不要把旧提案改成新文本后直接批准。

```json
{
  "operation": "dispatch-command",
  "runId": "quarterly-report",
  "expectedRevision": 12,
  "commandId": "<本次修订命令的唯一 ID>",
  "name": "revise",
  "input": null
}
```

`expectedRevision` 要从本次 `inspect` 返回值读取，示例数字不能直接复用。已领取或结果未知的工作必须先核对；SDK 不允许修订命令直接取消它。

中断后通过 `inspect` 找回同一 Run 和原 Action。`publish` 使用 `retry: reconcile`，不会自动重发。若文件已写入但回执丢失，核对当前批准报告、发布路径和实际文件字节，再为原 `actionId / attempt / inputHash / claimToken` 提交实际 `record-outcome`；发布输出是 `{ "ref": "<实际发布路径>", "contentHash": "<批准摘要>", "report": <批准报告工件对象> }`。验证器读取文件后才接受结果。文件不存在或不匹配时不能声称已经发布，也不能未经核对再次执行。

应用包和依赖在启动后被固定。恢复时保留原包，使用原应用身份与项目；包发生变化时恢复原内容或创建新版本与新 Run。应用身份参与报告文件目录，项目根参与 Run 归属，同名 Run 不会与另一应用或项目共用文件。

## 验证范围

`test/domains/workflow-application/report-application.test.ts` 覆盖真实文件、审批分支、明确 join、修订上限、陈旧提案、错误工件、伪造结果和发布回执丢失后的核对。`test/app/report-application-cli.test.ts` 从实际 npm 包加载公开工厂，在隔离消费者与临时项目中通过多个 CLI 进程完成批准和拒绝路径。依赖复用当前安装，未模拟来源事实正确性，也没有调用真实 Claude Code、Codex 宿主或模型；实际宿主和模型矩阵另行验收。
