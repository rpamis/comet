# Classic 组合应用

`@rpamis/comet/applications/classic` 提供 `createClassicApplication(context, options)`。应用选择 `full`、`hotfix` 或 `tweak`，保留原 Classic 状态机、必要工件、用户确认、执行检查和 Archive 交付规则。未使用工厂的内置 Classic 流程保持原行为。

应用包沿用 [Workflow Application 契约](workflow-application.zh.md)的独立身份、固定依赖和宿主执行端口。`application.json` 的 `base` 必须与 `options.profile` 一致；每个实际 `invoke_skill` 步骤须绑定唯一的、经过内容审查的执行 Skill。替换仅改变执行绑定，不删除原步骤的输出校验或领域验收。审批由 Classic 的 Wait 处理，执行 Skill 不能接管审批。

## 替换和新增步骤

`replacements` 使用原 `stepId` 和新 `skillId`。例如替换 `hotfix.build.execute`，仍需产生原 `build-complete` 输出，并完成原 Build 检查；声明“成功”不能替代检查记录。不得替换 `classic-check`、工件证据或用户确认步骤。

`extensions` 的每项声明 `id`、`afterStep`、`skillId`、非空 `artifactRefs` 和实际 SDK `validator`。支持的检查点为当前 profile 的 `open.evidence`、`build.check.evidence`、`verify.check.evidence`，以及 full 的 `open.revalidate`、`design.evidence`、`build.plan.evidence`。preset 升级后的 full 检查点也可使用；preset 的 Build/Verify 新增检查会自动继承到批准升级后的 full 对应检查点，不能通过升级绕过。新增工作通过后才执行原检查点的后续转换。

新增步骤 ID 由 `classicExtensionStepId(id)` 生成。`order` 可完整列出新增步骤 ID，以调整同一检查点内的顺序；重复、遗漏、重排领域步骤或跨检查点移动会被解释并拒绝。

新增结果使用以下字段：

- `verdict`：`pass`、`repair` 或 `revise-requirements`。
- `sourceHash`：对 Action 的 `input.activation.source` 调用 SDK `hashRuntimeValue` 所得摘要。
- `artifactHashes`：`pass` 时每个声明工件的 SHA-256。Runtime 独立读取实际文件，并执行注册的验证器；宿主提供的摘要本身不是验收结果。

原领域证据在新增检查期间发生变化时，当前结果不能继续推进。后续 Action 的领取与结果也会重新核对沿当前执行分支继承的新增检查，防止通过直接 `claim` 或 `record-outcome` 跳过它们。

## 工作授权和恢复

需要写入的组合 Skill 可以把 `authorizationFrom` 绑定到 `classic.composition.confirm`。工厂先通过 `comet-classic-composition-prepare` 生成实际 Skill 和范围预览，再等待 `approved`。这项工作授权只存在于显式定制的应用；full 原有的 Open、Design、Build 和 Archive 确认仍须分别满足。依赖或应用定义变化时，加载器拒绝复用活动 Run。

新增工作失败或返回 `repair` 时，Run 返回对应原工作步骤；返回 `revise-requirements` 时，重新执行工作授权和 Open，并清除已失效的设计、计划与验收状态。保留原 Action 和已完成工作。

已通过检查的工件发生变化时，使用公开 Runtime `dispatch-command` 操作，在当前 `expectedRevision` 下提交：

- `repair-composition`，`input: { "reason": "说明候选变化和修复原因" }`：回到 Build 并重新执行原检查与新增检查。
- `revise-requirements`，`input: { "reason": "说明需求变化" }`：回到工作授权与 Open，重新确认受影响工件。

随后执行派发的 `comet-classic-composition-recovery` Action。存在正在执行或结果未知的 Action 时，命令会拒绝中断，须先核对原执行结果。断连后继续原 Action 的 ID、attempt、inputHash 和 claimToken，不自动重发工作。

定制 Classic 使用 `comet runtime dispatch --application <应用身份>` 或 `--application-file <application.json>` 继续同一 Run。基础 Classic state/guard/Archive 命令会明确拒绝替代组合应用推进。`.comet.yaml` 保存可读投影、原 Application 身份及完整 portable checkpoint；本地运行记录丢失后，恢复必须加载原固定应用包，不能改用内置 Classic。

## 验证边界

开发期回归覆盖真实临时项目中的 full、hotfix、tweak 领域检查、实际 OpenSpec Archive、本地交付提交、失败修复、工件变化和公开 CLI 跨进程恢复。真实平台 Hook、Claude Code 模型执行、正式 12 样本矩阵及安装分发由生产验收单独完成，不能用这些开发测试宣称其已通过。
