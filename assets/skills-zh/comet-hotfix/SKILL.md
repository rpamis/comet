---
name: comet-hotfix
description: '使用 Classic 预设流程修复局部缺陷。在用户明确调用 /comet-hotfix、选择 hotfix，或恢复 workflow: hotfix 时使用。'
---

# Comet 预设路径：Hotfix

开始或恢复任务前，必须先读取并遵守 `comet-classic/reference/classic-layout.md`。本文件中的 OpenSpec CLI 调用必须通过适配器执行，文件路径必须基于该协议绑定的 `<classic-*>` 逻辑根目录。

快速缺陷修复流程：open → build → 根因消除检查 → verify → archive。跳过 brainstorming 和完整实施计划，适用于修复已有行为、不需要设计新功能的场景。

**适用条件**（必须全部满足）：

1. 修复已有功能的缺陷，不新增功能
2. 不涉及接口变更或架构调整
3. 改动范围可预估（文件数仅作提示，不会自动要求升级，见 SDK 方法参考的预设范围复核）

**不适用**：修复过程中如发现 SDK 方法参考的预设范围复核列出的变化，需要由用户决定是否改用完整 `/comet-classic` 流程。

首次进入阶段、交接给新 Agent 或上下文恢复后，读取并执行 [任务上下文与产物语言](../comet-classic/reference/scripts.md#任务上下文与产物语言)，优先采用当前 continuation 或已领取 Action 的 `contextRequest`；同一阶段连续执行不重复获取。

个人记忆只保存可复用用户信息，不写入任务摘要、进展、命令输出或测试结果。

## SDK Run 路径

进入 SDK 阶段时，必须读取 [SDK 执行方法](../comet-classic/reference/sdk-methods.md) 中当前阶段的章节；Verify 编辑被拒绝或出现待复核提案时，读取[编辑复核](../comet/reference/edit-review.md)。

SDK 新 change 的状态文件为 `comet-state.yaml`；历史 `.comet.yaml` 保持原地读写，compat 初始化仍用旧名。两文件共存时（包括其中一个是失效符号链接）停止并保留现场，不自动改名或覆盖。以 Runtime 返回的归属与路径为准。

响应已有 `agent.continuation.mode` 时，先按 `comet-classic/reference/auto-transition.md` 处理；`wait` 等待原任务，不能因兼容字段 `nextAction.kind: reconcile` 再做恢复查询。使用当前响应的命令与输入；Skill 工作实际完成后才使用 `completion` 提交。本节依据 `nextAction.kind` 的恢复规则仅用于没有 `mode` 的旧响应。

开始或恢复时，优先复用当前有效结果中的 `agent.continuation` / `data.nextAction` 及已绑定的 change、工作区、phase 和 Run revision，按已知的 `data.runtimeFormat` 路由。只有冷恢复、外部状态变化或缺少这些信息时，才运行 `comet state next <change-name> --json`。`sdk` 只按本节推进；SDK 方法参考的适用条件、复现与根因消除方法、升级判定和文件数授权规则仍适用，状态与证据通过本节命令提交。若 `nextAction.kind` 为 `reconcile`，运行 `comet state check <change-name> <phase> --recover --json` 核对原 Action；结果未明时不重做实现、检查或归档。

1. 新建时先按 [工作区选择](../comet-classic/reference/workspace.md) 确定隔离方式，运行 `comet classic workspace prepare <name> --isolation <selected-isolation> --json`，进入返回的 `projectRoot`，再运行 `comet state init <name> hotfix --isolation <selected-isolation>`，随后运行 `comet state select <name>` 绑定 Hook 路由。按 SDK 方法参考的开始与产物章节创建精简版 OpenSpec 产物；运行 `comet guard <change-name> open --json` 预览确认内容，保存返回的 `data.approvalHash`。向用户展示本次 Open 产物与范围，获得明确批准后，运行 `comet guard <change-name> open --apply --approval-hash <approvalHash>`。产物变化后必须重新预览并确认，不复用旧哈希。只有 Run 进入 Build，Open 才完成；状态文件是 change 下的 `comet-state.yaml`，历史 change 沿用原文件名。
2. `hotfix.build.execute` 待执行时，沿用本次 change、工作区和 Run，直接恢复 Build，不重新初始化或重跑 Open。按 SDK 方法参考的预设范围复核章节 先复现缺陷、保存失败证据、完成任务并核对根因。出现实质升级信号或文件数超限且无有效授权时，先运行 `comet state propose-escalation <change-name> --reason "<reason>"`；向用户展示当前原因和继续 hotfix / 升级 full 的影响，并保存返回的 `data.wait.proposalHash`。用户明确选择后运行 `comet state decide-escalation <change-name> --proposal-hash <proposalHash> --choice <continue|upgrade>`。`continue` 仍须满足 SDK 方法参考的范围、风险与 ruling 要求；`upgrade` 在同一个 Run 和工作区进入 full Design，立即按入口加载 comet-design。恢复待决定 Wait 时复用原提案，不重新提案或替用户选。
3. 根因消除、任务完成且仍适合 hotfix 时，以完整构建或验收命令运行 `comet guard <change-name> build --apply -- <program> [args...]`。此处没有新的用户决定，`--apply` 会重新校验当前任务、配置、工作区和证据，再执行真实检查并提交收据；只有成功且证据有效时进入 Verify。仅在需要诊断时运行 `comet guard <change-name> build` 只读预检。失败后使用返回的当前状态；结果未提供 continuation 时再读 `state next --json`，不重播结果未明的 Action。
4. Run 进入 Verify 时，**立即执行：** 使用 Skill 工具加载 comet-verify 技能。禁止跳过此步骤。该 Skill 的 SDK 路径完成报告、独立检查和真实命令收据。Run 进入 Archive 时，**立即执行：** 使用 Skill 工具加载 comet-archive 技能。禁止跳过此步骤。归档和交付仍须获得用户当前授权；当前成功结果显示 Run 完成后才能宣告完成；缺少完成状态时再读 `state next --json`。

每次推进后，优先使用同次结果的 `agent.continuation` / `data.nextAction`；状态仍有效且信息完整时，不重复 next、select 或 check。仅在冷恢复、外部状态变化或缺少必要信息时补读。`decision`、`evidence`、`reconcile` 先处理当前 Run 的等待或恢复；`action` 才执行对应步骤。
确定性的本地检查按 SDK 方法参考在 `--` 前加 `--local`，Runtime 核对完整输入和日志后才复用；外部检查保持真实执行。SDK Build 使用稳定的 `--session <builder-execution-ref>` 关联执行；full 的 complete-build 已携带时无需再次传入。

## Compat 路径

以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`。必须读取 [Compat 操作](reference/compat.md)，按其中当前阶段继续；SDK 不加载该参考。
