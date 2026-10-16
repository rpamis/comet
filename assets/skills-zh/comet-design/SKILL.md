---
name: comet-design
description: '完成 Classic 技术设计并请用户确认。在用户调用 /comet-design，或 Classic Runtime 进入 Design 时使用。'
---

# Comet 阶段 2：深度设计（Design）

首次进入阶段、交接给新 Agent 或上下文恢复后，读取并执行 [任务上下文与产物语言](../comet-classic/reference/scripts.md#任务上下文与产物语言)，优先采用当前 continuation 或已领取 Action 的 `contextRequest`；同一阶段连续执行不重复获取。

收到入口返回的 layout 后，按 `comet-classic/reference/classic-layout.md` 确定各逻辑根对应的目录。当前上下文已有这份协议时，无需重复加载。本文件中的 OpenSpec CLI 调用均通过适配器执行，文件路径均基于已绑定的 `<classic-*>` 根目录，无需先额外运行 root show。

## SDK Run 路径

进入 SDK 阶段时，必须读取 [SDK 执行方法](../comet-classic/reference/sdk-methods.md) 中当前阶段的章节；Verify 编辑被拒绝或出现待复核提案时，读取[编辑复核](../comet/reference/edit-review.md)。

SDK 新 change 的状态文件为 `comet-state.yaml`；历史 `.comet.yaml` 保持原地读写，compat 初始化仍用旧名。两文件共存时（包括其中一个是失效符号链接）停止并保留现场，不自动改名或覆盖。以 Runtime 返回的归属与路径为准。

响应已有 `agent.continuation.mode` 时，先按 `comet-classic/reference/auto-transition.md` 处理；`wait` 按 auto-transition.md 区分手动衔接和原任务等待，不能因兼容字段 `nextAction.kind: reconcile` 再做恢复查询。使用当前响应的命令与输入；Skill 工作实际完成后才使用 `completion` 提交。本节依据 `nextAction.kind` 的恢复规则仅用于没有 `mode` 的旧响应。

优先复用同一 change、工作区和 Run 的最新有效响应中的 `agent.continuation`、`data.nextAction`、phase、revision 和路径摘要。只有冷恢复、工作区或外部状态变化、响应版本已过期或缺少当前步骤必要信息时，才运行 `comet state next <change-name> --json`；不要因加载下一 Skill 再读一次。后续写操作仍由 Runtime 校验当前版本与证据，不能用缓存跳过检查或批准。当 `data.runtimeFormat` 为 `sdk` 时，只执行本节的状态命令；设计探索、提问与正式文档要求见 SDK 方法参考的 Design 章节，状态操作使用本节命令。`data.phase` 必须为 `design`；已进入 Build 时交回当前阶段入口。`data.nextAction.kind` 为 `reconcile` 时，运行 `comet state check <change-name> design --recover --json` 核对已领取 Action 的原结果，在结果明确前停止，不重新提案或重发工作。

1. 待执行 Action 为 `full.design.handoff` 时，复用当前响应的 layout 与产物引用；缺少时才运行 `comet state check <change-name> design --json`，直接读取当前 OpenSpec proposal、tasks、delta specs 和已有 design.md 中本次设计需要的内容。按 SDK 方法参考的 Design 章节形成候选技术方案；此时还没有 SDK handoff 包，不执行旧 `comet handoff ... --write`，也不把手写摘要当作 SDK handoff。持续保存 `brainstorm-summary.md`，未确认内容标为候选。
2. 如候选方案需要 Spec Patch，先按 SDK 方法参考的设计确认规则向用户说明具体补丁并取得明确同意，再修改 delta spec。范围发生实质变化时重新澄清。待 OpenSpec 来源稳定后，执行 `comet state propose-design <change-name> --proposal "<candidate-summary>"`，其中摘要必须覆盖将请用户确认的方案、关键取舍、风险和 Spec Patch；保存返回的 `data.wait.proposalHash` 为 `<proposalHash>`。此命令生成并记录可追溯的 handoff；优先使用提案结果中的 `data.configuration.handoffContext`，缺少时再运行 `comet state next <change-name> --json`；读取 `data.configuration.handoffContext` 对应的 Markdown 包，核对它与候选方案及当前源文件一致。用户尚未决定时，恢复应复用这个 Wait，不重复运行 propose-design。
3. 按 SDK 方法参考的设计确认规则展示最终方案，请用户选择确认、调整或暂缓。SDK 决定命令为 `comet state decide-design <change-name> --proposal-hash <proposalHash> --choice <approved|rejected>`：确认时填 `approved`，要求调整时填 `rejected`，随后继续 brainstorming 并重新提案；暂缓时保留待决定的 Wait，不执行决定命令。哈希必须来自当前提案。OpenSpec 来源或 handoff 变化导致批准被拒绝时，停止并核对变化，不用旧确认继续。
4. 已批准后，按 SDK 方法参考写入唯一 Design Doc，包含要求的 frontmatter；如恢复时 `nextAction.kind` 已为 `action` 且 stepId 为 `full.design.document`，直接从这一步继续。直接运行 `comet state complete-design <change-name> --design-doc <design-doc-ref> --approval-hash <proposalHash>`，由同一 Run 提交文档 Action 和证据。提交失败时保留原 Run 并按具体原因处理；实际状态文件由 Runtime 同步，Agent 不手动推进 phase。成功后按同次响应的 Build Action 与 continuation 路由；缺少续行信息时才运行 `comet state next <change-name> --json`。

## Compat 路径

以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`。必须读取 [Compat 操作](reference/compat.md)，按其中当前阶段继续；SDK 不加载该参考。
