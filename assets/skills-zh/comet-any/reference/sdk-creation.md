# 创作动作与恢复

仅在领取、回传、确认或恢复当前 Creator 动作时读取本页。请求存入临时 JSON，运行 `comet creator dispatch <name> --project <项目> --request <临时JSON> --json`；不编辑 Runtime 状态。

## 分析动作

宿主只领取 `analyze`，调查真实 Skills 并回传创作结果。compile / verify / eval-preview / evaluate / preview / install 由 `next` 的固定 `creator-local` 执行器完成，不领取或代回报这些机器 Action。`next` 停下后处理返回的 Action 或 Wait。

先读取当前 `actions` 中的 `analyze`，提交 `operation: claim`，保留 `runId`、`actionId`、`attempt`、`inputHash`；使用 `executorId: creator-host`、实际 `sessionId`、唯一且稳定的 `claimToken`，并提供实际具备的 `capabilities: [skill-load, handoff]`。领取成功后才执行分析。

回传 `operation: record-outcome`。`outcome` 保留相同 Action 身份与 claimToken，并使用唯一 outcomeId、真实 status 和 output。成功 output 包含：

- `summary`：说明目标与所选流程。
- `failurePaths`：至少一个具体失败与恢复路径。
- `limitations`：说明能力与证据边界。
- `proposal`：公开 `@rpamis/comet/applications/compiler` 接受的声明式方案，包含 `schema: comet.workflow.application.plan.v1`、manifest、composition、modules；由组合器生成 workflows，不拷贝完整手写 createApplication。
- `proposal.documents`：Agent 创作的完整入口 `SKILL.md` 与 `rules/workflow-guard.md` 业务规则；可补充正文实际引用的 `references/*.md`。两份必需正文缺失或为空时，Creator 拒绝分析、准备或确认，不以模板补齐后宣称创作完成。
- `evaluation`（可选）：agent、model、judgeAgent、judgeModel、maxTurns、timeoutSeconds，也可通过 `--eval-config <JSON文件>` 提供；实际设置在评估预览中确认。凭据仅从执行环境读取。

manifest 指定应用身份、基础流程、Runtime 版本和 Skill 依赖。依赖填写绝对目录、实际内容摘要与适配契约，由组合器读取固定字节。SDK 保留 `documents` 正文，并在同一文件后追加执行协议和通用保护规则；Rule 由 manifest.rule 引用。modules 提供业务执行端口、验证器和已声明的纯转移处理器，不接管 SDK 状态机。额外 Guard 只能收紧保护，不能允许写入 SDK 控制资源；业务 Rule 不授予 Runtime 权限，也不代替用户批准。

`documents` 示例（与 manifest / composition / modules 一起放入 proposal）：

```json
{
  "documents": {
    "SKILL.md": "---\nname: report-review\ndescription: 根据来源生成报告，审阅后发布。\n---\n\n# 报告审阅\n\n用户需要审阅后发布报告时启动。先读取目标和来源，调用已固定的报告 Skill 生成草稿；展示当前草稿并等待用户批准，随后发布该草稿。拒绝时保留草稿；修订后重新审阅。完成前校验报告、来源引用和发布产物。详细来源检查见 references/source-review.md。\n",
    "rules/workflow-guard.md": "# 报告业务规则\n\n只使用已提供的来源，结论须能追溯。保留拒绝的草稿和审阅记录。内容变化后重新审阅，发布内容必须与获批草稿一致。\n",
    "references/source-review.md": "# 来源检查\n\n在生成草稿前逐项核对来源，记录每个结论对应的证据；缺失证据时先澄清。\n"
  }
}
```

示例 id 为 report-review；实际 frontmatter name 必须匹配 manifest.id，description 和正文均非空。`plan.documents` 原文参与当前方案摘要；改变正文须沿 revise 重新确认。

分析成功后运行 `next`，取得实际装配结果，结合有效图检查步骤、产物、Skill 绑定和能力限制，再展示方案。

## 用户决定

当前 `waits` 中只有待处理的 Wait 能接受决定。取得用户明确选择后，提交 `operation: resolve-wait`，保留 `runId`、`waitId`、`proposalHash`，附唯一 decisionId 和当前 Wait 支持的 choice。不要替用户审批或选择跳过。

方案与安装分别通过 confirm-plan、confirm-install 批准。旧摘要或内容漂移时走 revise，重新分析并展示方案。安装 preview 的 files / target 是导出计划，distribution 是固定版本、依赖、宿主入口和 Rule/Hook 配置计划；两部分由当前安装 Wait 一起批准，任一部分变化后重新确认。平台缺少 Hook 支持或需要启用时，在预览中说明。

编译验证后，confirm-eval 接受 evaluate / skip / revise。evaluate 固定完整应用快照和实验身份；通过后进入安装预览，失败或未完成进入 review-eval（retry / revise / skip）。重试复用原用例，修订后优先沿用；skip 保留实际失败或未评估状态。

install-target 是项目内导出目录，应与 SDK 管理目录和平台 Skill 入口分开。批准后由 Creator 导出固定字节，并通过正式 SDK 安装项目入口、Rule/Hook 和 Runtime 依赖，无需应用私有安装器。用户级安装、升级和卸载使用 SDK 分发入口。

只读预览失败进入 review-install，回报包含 reason 与 noFilesWritten。retry 重新生成预览并等待新的 confirm-install；revise 返回 analyze；rejected 停止并保留现场。已发生写入或结果未知时，按下节核对。

## 中断与结果未知

新进程调用 status / next 读取同一 Run。running 或 unknown Action 先核对原执行是否发生。需要标记未知时使用 mark-unknown，保留原 Action 和 attempt；retry 必须携带当前恢复 proposalHash 和实际 reconciliation。不能以超时为理由重新运行已经发生的安装。

核对编译包、导出包和正式平台安装的实际文件，不能只看到导出目录就回报完成。部分写入、文件漂移或无法确认的结果保持阻塞；恢复时保留无关文件与已有安装。
