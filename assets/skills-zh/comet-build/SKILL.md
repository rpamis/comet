---
name: comet-build
description: '制定计划、实施并验收 Classic 任务。在用户调用 /comet-build，或 Classic Runtime 进入 Build、返回 Build 修复时使用。'
---

# Comet 阶段 3：计划与构建（Build）

首次进入阶段、交接给新 Agent 或上下文恢复后，读取并执行 [任务上下文与产物语言](../comet-classic/reference/scripts.md#任务上下文与产物语言)，优先采用当前 continuation 或已领取 Action 的 `contextRequest`；同一阶段连续执行不重复获取。

收到入口返回的 layout 后，按 `comet-classic/reference/classic-layout.md` 确定各逻辑根对应的目录。当前上下文已有这份协议时，无需重复加载。本文件中的 OpenSpec CLI 调用均通过适配器执行，文件路径均基于已绑定的 `<classic-*>` 根目录，无需先额外运行 root show。

编辑后需要判断实际影响，或 continuation 指向内容判断时，必须读取并执行[编辑后续行](../comet/reference/edit-review.md)。由当前 Agent 合并处理变化，保留原 Run、有效批准和检查，只补受影响证据。

## SDK Run 路径

首次进入当前 SDK 阶段、换 Agent 或恢复上下文时，读取[阶段入口与恢复](../comet-classic/reference/sdk-methods.md#阶段入口与恢复)及该参考的当前阶段章节；本会话已有且仍有效时直接复用。下文按当前阶段执行；`nextAction.kind` 的恢复路由只适用于没有 continuation mode 的旧响应。

优先复用当前有效结果中的 `agent.continuation` / `data.nextAction` 与已绑定状态；只有冷恢复、外部状态变化或缺少必要信息时，才运行 `comet state next <change-name> --json`。`data.runtimeFormat` 为 `sdk` 时，只按本节推进 Run；SDK 方法参考的执行策略选项、计划内容要求、实施与审查方法仍适用，状态和证据通过本节命令提交。`data.phase` 必须为 `build`。已有有效 layout 与当前配置时直接复用；缺少时运行 `comet state check <change-name> build --json`；若 `nextAction.kind` 为 `reconcile`，运行 `comet state check <change-name> build --recover --json` 核对原 Action 的结果，在结果明确前不重发外部工作。

先核对有效配置中的 `workflow` 或当前 `nextAction.stepId`。`tweak.build.*` / `workflow: tweak`：**立即执行：** 使用 Skill 工具加载 comet-tweak 技能。禁止跳过此步骤。`hotfix.build.*` / `workflow: hotfix`：**立即执行：** 使用 Skill 工具加载 comet-hotfix 技能。禁止跳过此步骤。技能加载后，传入同一 change、工作区、phase、Run revision 和 continuation，从该预设的 SDK Build 步骤继续，不要求 full Design Doc 或完整计划，也不重跑 Open。旧 Run 的原始 Action 仍可能引用 `comet-build`，同样按此规则路由。已批准升级且当前步骤为 `full.build.*` 时，执行下列 full 路径。

1. `full.build.configure` 待执行时，按 SDK 方法参考的 [Build 配置说明](../comet-classic/reference/sdk-methods.md#build)展示值、含义及确认状态，只补真正缺失、无效或用户要求更改的执行方式、TDD 和审查决定。将已确认的 `build_mode`、`tdd_mode`、`review_mode`、`subagent_dispatch` 和需要时的 `direct_override` 写入仓库内的临时 JSON；用户已明确选择这份完整配置时，运行 `comet state propose-build <change-name> --file <configuration-json> --confirmed` 一次保存提案与批准；尚未决定时运行 `comet state propose-build <change-name> --file <configuration-json>`。仅在仍有待决定 Wait 时，从返回的 `data.wait.proposalHash` 保存 `<proposalHash>`，向用户展示实际配置并按 decision-point.md 等待确认。确认或拒绝时运行 `comet state decide-build <change-name> --proposal-hash <proposalHash> --choice <approved|rejected>`；拒绝后从新配置重新提案。恢复已有待决定 Wait 时复用原提案，不重复提问或新建配置 Action。保存批准后简短回显并继续，不再增加一次继续确认。
2. `full.build.plan` 待执行时，按 SDK 方法参考的 Build 章节创建或核对计划。计划引用当前 Design Doc 和 tasks.md，以 `<!-- comet-task-authority: <classic-task-authority-ref> -->` 及 `<!-- comet-task-ref:<task-id> -->` 映射任务，不能另建 checkbox。运行 `comet state submit-plan <change-name> --plan <plan-ref>` 提交计划及证据。只有用户明确要求写完计划暂停时加 `--pause`；恢复 `plan-ready` Wait 时，必须等用户明确继续，再用该 Wait 的当前哈希运行 `comet state continue-plan <change-name> --proposal-hash <proposalHash>`。计划或任务要求变化后不复用原批准。
3. `full.build.execute` 待执行时，按 SDK 方法参考的 Build 章节的已选方法实施、做任务级或分段审查并运行相关检查。任务实际完成且审查合格后勾选同一 tasks.md；任务 ID、勾选和协调进度使用共享参考中的 `state tasks`、`state task-complete`、`state checkpoint`；这些命令不推进 SDK Run。SDK 不调用旧 `comet handoff --write`。核对计划、任务和工作区后运行 `comet state complete-build <change-name> --session <builder-execution-ref>`，由 Run 进入检查 Action。实现或计划与已接受证据不一致时先解决具体漂移，不绕过 SDK 校验。
4. `full.build.check` 待执行时，以当前工作区中明确的完整构建或验收入口运行 `comet guard <change-name> build --apply -- <program> [args...]`。此处没有新的用户决定，`--apply` 会重新校验当前任务、配置、工作区和证据，再执行真实检查并向同一 Run 提交收据；仅在检查成功且证据仍有效时进入 Verify。仅在需要诊断时运行 `comet guard <change-name> build` 只读预检。若收据提交中断，先核对同一 Action 和检查记录，按 Guard 的恢复结果补交，不重新执行已完成的外部检查。失败后按返回的当前 Build Action 修复并重新验证；结果未提供 continuation 时再读 `state next --json`。

每次推进后，优先使用同次结果的 `agent.continuation` / `data.nextAction`；状态仍有效且信息完整时，不重复 next、select 或 check。仅在冷恢复、外部状态变化或缺少必要信息时补读。只有 `action` 且指向下一阶段时才加载下一 Skill。`decision`、`evidence`、`reconcile` 均先完成当前 Run 的恢复或用户决定。
确定性的本地检查按 SDK 方法参考在 `--` 前加 `--local`，Runtime 核对完整输入和日志后才复用；外部检查保持真实执行。SDK Build 使用稳定的 `--session <builder-execution-ref>` 关联执行；full 的 complete-build 已携带时无需再次传入。

## Compat 路径

以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`。必须读取 [Compat 操作](reference/compat.md)，按其中当前阶段继续；SDK 不加载该参考。
