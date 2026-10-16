---
name: comet-archive
description: '归档并交付 Classic change。在用户调用 /comet-archive，或 Classic Runtime 进入 Archive、恢复交付时使用。'
---

# Comet 阶段 5：归档（Archive）

首次进入阶段、交接给新 Agent 或上下文恢复后，读取并执行 [任务上下文与产物语言](../comet-classic/reference/scripts.md#任务上下文与产物语言)，优先采用当前 continuation 或已领取 Action 的 `contextRequest`；同一阶段连续执行不重复获取。

收到入口返回的 layout 后，按 `comet-classic/reference/classic-layout.md` 确定各逻辑根对应的目录。当前上下文已有这份协议时，无需重复加载。本文件中的 OpenSpec CLI 调用均通过适配器执行，文件路径均基于已绑定的 `<classic-*>` 根目录，无需先额外运行 root show。

## SDK Run 路径

进入 SDK 阶段时，必须读取 [SDK 执行方法](../comet-classic/reference/sdk-methods.md) 中当前阶段的章节；Verify 编辑被拒绝或出现待复核提案时，读取[编辑复核](../comet/reference/edit-review.md)。

SDK 新 change 的状态文件为 `comet-state.yaml`；历史 `.comet.yaml` 保持原地读写，compat 初始化仍用旧名。两文件共存时（包括其中一个是失效符号链接）停止并保留现场，不自动改名或覆盖。以 Runtime 返回的归属与路径为准。

响应已有 `agent.continuation.mode` 时，先按 `comet-classic/reference/auto-transition.md` 处理；`wait` 按 auto-transition.md 区分手动衔接和原任务等待，不能因兼容字段 `nextAction.kind: reconcile` 再做恢复查询。使用当前响应的命令与输入；Skill 工作实际完成后才使用 `completion` 提交。本节依据 `nextAction.kind` 的恢复规则仅用于没有 `mode` 的旧响应。

优先复用同一 change、工作区和 Run 的最新有效响应中的 `agent.continuation`、`data.nextAction`、phase、revision 和路径摘要。只有冷恢复、工作区或外部状态变化、响应版本已过期或缺少当前步骤必要信息时，才运行 `comet state next <change-name> --json`；不要因加载下一 Skill 再读一次。后续写操作仍由 Runtime 校验当前版本与证据，不能用缓存跳过检查或批准。确认 `data.runtimeFormat: sdk`、phase 和 `nextAction.kind`，在已绑定的 `projectRoot` 执行；路径缺失或绑定发生变化时才运行 `comet classic workspace resolve <change-name> --json`。SDK Run 的 Verify 收据必须仍有效；状态文件和验证报告存在并不表示已获归档授权。`reconcile` 时运行 `comet state check <change-name> archive --recover --json` 核对原 Action 与磁盘、Git 证据，结果未明时不重做归档、提交、push 或 PR。

1. 复用当前有效的状态、工作区和证据摘要；缺少时运行 `comet state check <change-name> archive --json`。按 SDK 方法参考的 Archive 与 Git 交付章节 核对验证结论、当前绑定分支、归档影响和无关改动。需要推送或 PR 时，先确认 remote 和 PR base；多个可选目标不能猜测。用当前目标与效果摘要运行 `comet state propose-archive <change-name> --summary "<delivery-summary>"`，需要时附 `--remote <name>`、`--pr-base <branch>`。保存返回的 `data.wait.proposalHash` 为 `<proposalHash>`；恢复已有待决定 Wait 时复用它，不重复提案。
2. 按 decision-point.md 展示当前提案和 SDK 方法参考的 Archive 与 Git 交付选项。已有明确授权覆盖当前归档影响和相同交付目标时沿用；否则等待用户选择。用 `comet state decide-archive <change-name> --proposal-hash <proposalHash> --choice <local|push|pr|reverify|later>` 提交当前选择：local 仅归档并提交，push 再推送，pr 推送并创建 PR，reverify 返回 Verify，later 保留当前工作并停止本次调用。目标或 Verify 证据改变时重新核对并取得新的决定；旧提案哈希不能继续使用。
3. 只有 Run 记录了有效的 `local|push|pr` 决定，才直接运行 `comet guard <change-name> archive --apply`。Guard 核对授权、分支和 Verify 收据，在同一 Run 中完成一次 OpenSpec 归档。中断后先看 `state next --json` 与 `--recover` 返回的 Action；已应用的归档不能再次发送。
4. 按 SDK 方法参考的 Archive 与 Git 交付章节核对 dirty-worktree，显式暂存本 change 的实现、归档目录、主 spec 及 Design Doc/Plan 标注，检查 staged diff，再创建唯一归档提交。SDK Guard 不代替 Agent 执行 Git；不调用旧 `state set branch_status`、`state delivery` 或 `archive-confirm`。选择 `push` 时推送已批准的 remote/分支；选择 `pr` 时先推送再创建目标匹配的 PR。调用结果未知时先只读核对远端或 PR，不盲目重试。
5. 使用真实提交 SHA 运行 `comet state complete-delivery <change-name> --commit <sha>`；PR 选择还需附 `--pr-url <url>`。该命令只核对归档提交及已批准的远端/PR 结果并结束 Run，不执行提交、push 或建 PR。验证失败时保留原 Run 与选择，按返回的具体缺口恢复；只有同次结果表明 Run 已完成且 continuation 为 done，才宣告交付完成；结果未提供终态时才运行 `comet state next <change-name> --json` 核对。

## Compat 路径

以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`。必须读取 [Compat 操作](reference/compat.md)，按其中当前阶段继续；SDK 不加载该参考。
