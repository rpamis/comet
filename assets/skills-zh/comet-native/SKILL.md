---
name: comet-native
description: "Comet Native 工作流。当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用。"
---

# Comet Native

Native 把需求、完整目标规格、当前进度和验收结论保存在项目中。每完成一个阶段都回到 Runtime 读取下一步，当前只处理 Runtime 指定的阶段。

## 硬性边界

- 磁盘中的 `.comet/config.yaml`、当前 change、`comet-state.yaml` 和正式 Markdown 是工作依据，聊天记忆只作辅助。
- Runtime 管理工作流状态、本机任务、日志、锁和事务；所有阶段推进都通过 PATH 中公开的 `comet native` 命令完成。
- 命令不可用时报告 Comet 安装不完整并停止。参数和输出以 `comet native <command> --help` 为准。
- Builder 提交候选，新的只读 Verifier subagent 或独立 Agent 任务作出验收判断。
- Native 主流程由本 Skill 和 Runtime 完成，不依赖任何外部 Skill。

## 开始或恢复

1. 已知 change 名称时，直接运行 `comet native status <change-name> --details --json`；名称未知时才运行 `comet native status --json`，确定目标后再查询该 change 的详细状态。
2. 当前阶段需要完整验收列表时才执行 `nextPageArgs` 中的分页命令；需要编辑或核对正式正文时才运行 `show` 或读取对应 brief/Spec。
3. active change 已存在时，进入返回的 `workspace.projectRoot` 并 `select`。多个合理候选才让用户选择。
4. 没有对应 active change 时才创建，并使用配置指定的产物目录。

### 创建 change

先确定小写 kebab-case 名称，再按[工作区选择参考](reference/workspace.md)决定使用当前目录、创建分支还是创建 worktree。

CLI 会完成分支或 worktree 绑定、维护仓库本地排除规则、核对配置并创建可跨设备恢复的状态。随后进入命令返回的 `preparation.projectRoot`。

如果准备没有完成，保留已经创建的资源，展示 `preparation` 中的失败原因，并按 Runtime 或用户给出的恢复方向继续。

## 按需读取

确认 phase 后只读取需要的一份 reference：

- Shape：必须读取并执行[澄清参考](reference/clarification.md)；
- 实际编辑 brief/完整目标规格，或查看验收报告时读取[产物参考](reference/artifacts.md)；
- 正常推进时，直接执行 Runtime 在 `continuation` 中给出的命令。只有返回字段含义不清、命令输入被拒绝、无法启动 Verifier、Verifier 执行报错，或 Verifier 要求用户补充信息时，才读取[命令参考](reference/commands.md)；
- 只有任务因进程中断、换设备后本机状态缺失、连续多轮没有进展、并发冲突、旧版本迁移失败或状态损坏而无法继续时，才读取[恢复参考](reference/recovery.md)。

## Shape

先调查能够从仓库、工具和运行环境确定的事实；彼此独立的事实可以交给 subagent 调查。按 `native.clarification_mode` 和澄清参考维护决策树，只把会改变用户可见结果、又无法可靠推断的决定交给用户。

确认后的用户可见决定和重要约束立即同步到 Decisions、brief 和完整目标规格；普通实现选择保留在实现和测试中，只有影响用户可见行为时才进入正式需求。验收项必须具体、可观察且互不重复。

未解决问题保持 `[blocking]`；有阻塞项时不修改项目实现。完成标准：所有会影响用户可见结果的选择和未明说的假设均已处理，没有 `[blocking]`，用户明确确认目标、范围、关键决定、验收项和非目标，并且 Runtime 已进入 Build。只有用户明确确认后才使用后续指令中含 `--confirmed` 的命令推进。

## Build ↔ Verify Loop

Build 和 Verify 组成一个有界验收循环（Loop）：Builder 提交候选，Runtime 执行必要检查，再由新的只读 Verifier 验收。验收未通过时回到 Build，完成修改并提交下一轮候选；全部通过时进入 Archive。

`iteration` 表示实现候选的轮次，`attempt` 表示同一候选启动 Verifier 的次数。连续失败、没有实际进展或 Verifier 多次执行出错时，Runtime 会在预算上限处进入等待用户或阻塞状态。所有计数都由 Runtime 更新，Agent 只执行最新 `continuation`。

## Build

首次实现时读取当前 brief、完整目标规格和全部验收项。如果 Verify 未通过并返回 Build，先处理 Verifier 指出的未通过项、无法继续验证的问题和失败检查；再次提交前重新核对完整规格与全部验收项，避免只修报错点而遗漏其他要求。

需求变化时先判断归属：

- 当前需求只是实现有遗漏：从 Verify 或 Archive 使用 `--return-to-build` 回到 Build；
- 用户可见行为或验收标准发生变化：回到 Shape，更新正式产物并重新确认；
- 与当前需求无关：保留给另一个 change。

用户明确补充当前范围时，按同一规则处理。

候选完成后，按 Runtime 在 `continuation` 中提供的输入模板提交一份精简的 Builder 交接摘要，包括：本轮做了什么、处理了哪些验收项、实际运行或没有运行哪些开发期检查，以及还有哪些已知限制。

这份 handoff 保存在 `comet-state.yaml` 中，不会生成单独文件，也不代表已经验收通过。Runtime 会把它交给 Verifier，Builder 提交一次即可。

完成标准：实现和相关检查达到可验收状态，完整验收项已重新核对，Runtime 接受 handoff 并进入 Verify。

## Verify

Runtime 要求启动 Verifier（`dispatch-verifier`）时，先把当前候选需要运行的测试和检查命令填入 `inputOptions.template`，由 Runtime 统一执行。Runtime 会复用已经完成的检查；是否重试或补充检查，以最新 `continuation` 为准。

Runtime 返回 `verifierDispatch` 后，立即启动一个新的只读 Verifier subagent。平台不支持 subagent 时，启动一个与 Builder 会话分开的新 Agent 任务。

Verifier 先读取验收项、brief、完整目标 Spec、实际实现和 Runtime 检查结果，最后再把 Builder handoff 当作调查线索，保持验收判断独立。

Verifier 保持只读。如果现有检查不足，就在 Runtime 返回的 `inputOptions.template` 中列出还需要运行哪些检查，由 Runtime 执行并把结果返回给 Verifier。

Verifier 最终必须逐项标记为通过（`passed`）、未通过（`failed`）或暂时无法验证（`blocked`），一项不能漏，也不能重复。未通过或无法验证时，写出下一轮 Build 可直接处理的原因。无法启动 Verifier、Verifier 执行出错或缺少外部信息时，按命令参考和最新 `continuation` 处理。

完成标准：Runtime 已接受完整的 Verifier 结果，并明确进入 Build、Archive、等待用户（`await-user`）、阻塞（`blocked`）或完成（`done`）中的一种状态。

## Archive

只有 `continuation` 允许 Archive 时才继续。Archive 直接使用已经接受的验收结果。`branch` 或 `worktree` 需要收尾选择时，一次展示实际 change 分支、目标分支和目录，让用户选择合并（merge）、推送（push）、创建 PR、保留工作区（keep）或暂不归档。

只提交属于当前 change 的实现和正式产物，保留其他用户改动。执行 Runtime 返回的 `commandArgs`，再检查工作区收尾结果 `workspaceFinishResult`；结果为阻塞（`blocked`）时保留现场，并执行 `recoveryArgs` 中的恢复命令。

完成标准：状态为 `done`，并且用户授权的工作区收尾结果为已完成（`completed`）或已保留（`kept`）；其他结果按 `continuation` 继续。

## 后续指令

每次命令后只处理最新的 `continuation`：

- `continue`：执行 `commandArgs`，并按模板填写 `inputOptions`；
- `await-user`：等待列出的用户决定；
- `blocked`：先处理列出的阻塞原因或恢复动作；
- `done`：结束。

执行会修改状态的命令后，重新查询该 change 的详细状态，确认当前阶段、验收循环、状态版本和工作目录。只有需要正式正文时才运行 `show`。
