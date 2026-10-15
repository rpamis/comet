---
name: comet-verify
description: '验证 Classic change 并记录结果。在用户调用 /comet-verify，或 Classic Runtime 进入 Verify 时使用。'
---

# Comet 阶段 4：验证（Verify）

首次进入阶段、交接给新 Agent 或上下文恢复后，读取并执行 [任务上下文与产物语言](../comet-classic/reference/scripts.md#任务上下文与产物语言)，优先采用当前 continuation 或已领取 Action 的 `contextRequest`；同一阶段连续执行不重复获取。

收到入口返回的 layout 后，按 `comet-classic/reference/classic-layout.md` 确定各逻辑根对应的目录。当前上下文已有这份协议时，无需重复加载。本文件中的 OpenSpec CLI 调用均通过适配器执行，文件路径均基于已绑定的 `<classic-*>` 根目录，无需先额外运行 root show。

## SDK Run 路径

进入 SDK 阶段时，必须读取 [SDK 执行方法](../comet-classic/reference/sdk-methods.md) 中当前阶段的章节；Verify 编辑被拒绝或出现待复核提案时，读取[编辑复核](../comet/reference/edit-review.md)。

SDK 新 change 的状态文件为 `comet-state.yaml`；历史 `.comet.yaml` 保持原地读写，compat 初始化仍用旧名。两文件共存时（包括其中一个是失效符号链接）停止并保留现场，不自动改名或覆盖。以 Runtime 返回的归属与路径为准。

响应已有 `agent.continuation.mode` 时，先按 `comet-classic/reference/auto-transition.md` 处理；`wait` 等待原任务，不能因兼容字段 `nextAction.kind: reconcile` 再做恢复查询。使用当前响应的命令与输入；Skill 工作实际完成后才使用 `completion` 提交。本节依据 `nextAction.kind` 的恢复规则仅用于没有 `mode` 的旧响应。

优先复用同一 change、工作区和 Run 的最新有效响应中的 `agent.continuation`、`data.nextAction`、phase、revision 和路径摘要。只有冷恢复、工作区或外部状态变化、响应版本已过期或缺少当前步骤必要信息时，才运行 `comet state next <change-name> --json`；不要因加载下一 Skill 再读一次。后续写操作仍由 Runtime 校验当前版本与证据，不能用缓存跳过检查或批准。确认 `data.runtimeFormat: sdk`、`data.phase: verify` 和 `nextAction.kind`，在已绑定的 `projectRoot` 执行。路径缺失或绑定发生变化时才运行 `comet classic workspace resolve <change-name> --json`；缺少当前任务、工作区或证据摘要时才运行 `comet state check <change-name> verify --json`。`reconcile` 时改用 `comet state check <change-name> verify --recover --json` 查明原 Action 和检查结果；结果未明时停止，不重复执行外部检查。

1. 按 SDK 方法参考的风险评估、最终集成审查和 light/full 验证方法检查当前 change，但以 SDK Run 的状态和证据为准；不调用旧 `state scale`、`state set`、`comet handoff` 或旧 `comet check` 证据路径。实施或任务记录需要修复时，先报告具体失败项；只有当前待执行的是 `<profile>.verify.run`（`<profile>` 为 full、hotfix 或 tweak），才运行 `comet state transition <change-name> verify-fail --reason "<failure-reason>"`。此命令将失败原因作为同一 Run 的 Verify Action 结果并返回 Build；按同次响应的当前 Build Action 继续；缺少续行信息时才读取 `state next --json`。已有检查失败或结果未明时先读取其 Action，不另报一次 Verify 失败。
2. 验证结论合格后，将实际检查项、证据引用、独立审查结论及可接受偏差写入仓库内的验证报告 `<report-ref>`。以明确的完整验证命令直接运行 `comet guard <change-name> verify --report <report-ref> --apply -- <program> [args...]`。Guard 在同一 Run 中提交报告 Action、报告证据和真实检查收据；不能用手工声明代替检查。检查失败后读取同次响应的失败收据和当前 Build/Verify Action；缺少时才读取 `state next --json`，按最新 Action 处理，不将失败解释为通过。
3. Guard 通过后直接使用同次响应；缺少 phase 或 nextAction 时才运行 `comet state next <change-name> --json`。只有 phase 为 `archive` 且 `nextAction.kind` 指向 Archive，才加载 `/comet-archive`。Verify 通过不等于用户已经授权归档；由 Archive Skill 获取并记录当前交付决定。

## Compat 路径

以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`。必须读取 [Compat 操作](reference/compat.md)，按其中当前阶段继续；SDK 不加载该参考。
