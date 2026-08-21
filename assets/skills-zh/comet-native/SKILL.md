---
name: comet-native
description: "Comet Native 工作流。当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用。"
---

# Comet Native

Native 把需求、完整目标规格、当前进度和验收结论保存在项目中。每完成一个阶段都回到 Runtime 读取下一步，当前只处理 Runtime 指定的阶段。
## 硬性边界

- 磁盘中的 `.comet/config.yaml`、当前 change、`comet-state.yaml` 和正式 Markdown 是工作依据，聊天记忆只作辅助。
- Runtime 管理工作流状态、本机任务、日志、锁和事务；所有阶段推进都通过 PATH 中公开的 `comet native` 命令完成，用户不手工执行这些命令。
- 命令不可用时报告 Comet 安装不完整并停止。参数和输出以 `comet native <command> --help` 为准。
- Builder 提交候选，新的只读 Verifier subagent 或独立 Agent 任务作出验收判断。
- Native 主流程由本 Skill 和 Runtime 完成，不依赖任何外部 Skill。
## 开始或恢复

1. 已知 change 名称时，直接运行 `comet native status <change-name> --details --json`；名称未知时才运行 `comet native status --json`，确定目标后再查询该 change 的详细状态。
2. 当前阶段需要完整验收列表时才执行 `nextPageArgs` 中的分页命令；需要编辑或核对正式正文时才运行 `show` 或读取对应 brief/Spec。
3. active change 已存在时，进入返回的 `workspace.projectRoot` 并 `select`。Runtime 会扫描已登记 Worktree，优先返回绑定分支匹配的工作区；只有多个同样匹配的候选才让用户选择。
4. 没有对应 active change 时才创建，并使用配置指定的产物目录。
### 创建 change

先确定小写 kebab-case 名称，再按[工作区选择参考](reference/workspace.md)决定使用当前目录、创建分支还是创建 worktree。用户明确说并行、同时处理或多个会话时自动选择 `worktree`，不再询问三种方式。

CLI 会在创建 change 前完成分支或 worktree 绑定、复用已登记的 change 分支、在分支仍存在但登记 Worktree 已移除时重建 Worktree、维护仓库本地排除规则、核对配置并创建可跨设备恢复的状态。随后进入命令返回的 `preparation.projectRoot`；后续命令不得继续在原目录执行。

如果准备没有完成，保留已经创建的资源，展示 `preparation` 中的失败原因，并按 Runtime 或用户给出的恢复方向继续。
## 按需读取

确认 phase 后只读取需要的一份 reference：

- Shape：必须读取并执行[澄清参考](reference/clarification.md)；
- 实际编辑 brief/完整目标规格，或查看验收报告时读取[产物参考](reference/artifacts.md)；
- 正常推进时，直接执行 Runtime 在 `continuation` 中给出的命令。只有返回字段含义不清、命令输入被拒绝、无法启动 Verifier、Verifier 执行报错，或 Verifier 要求用户补充信息时，才读取[命令参考](reference/commands.md)；
- 只有任务因进程中断、换设备后本机状态缺失、连续多轮没有进展、并发冲突、旧版本迁移失败或状态损坏而无法继续时，才读取[恢复参考](reference/recovery.md)。
## Shape

先调查能够从仓库、工具和运行环境确定的事实；彼此独立的事实可以交给 subagent 调查。按 `native.clarification_mode` 和澄清参考维护决策树，只把会改变用户可见结果、又无法可靠推断的决定交给用户。用户直接提供文件、附件、链接或本地路径作为需求来源时进入源文档完整覆盖模式：完整读取并记录 `complete`、`partial` 或 `unavailable` 状态，分块读取只改变读取顺序和工作记忆管理，不改变最终覆盖集合；`brief.md` 先保存完整来源需求和覆盖状态，再提出歧义、遗漏或隐含边界问题；可执行来源单元必须同时映射到完整目标 Spec 和至少一个验收 ID，背景、非目标或已废止内容只保留归类、理由和替代关系；修正后的旧单元标为 `superseded` 并指向替代单元；`partial`、`unavailable`、未映射或未确认内容保持 `[blocking]`。仅用于排错、取证、审查或实现参考的材料不自动触发，用途不明时先澄清；摘要不能替代来源覆盖映射。

确认后的用户可见决定和重要约束立即同步到 Decisions、brief 和完整目标规格；普通实现选择保留在实现和测试中，只有影响用户可见行为时才进入正式需求。验收项必须具体、可观察且互不重复。大型需求需要拆分时，在 Supervisor Change 根目录维护 `children.yaml`，用 `depends_on` 表达真实先后关系，并用 `covers` 覆盖 Supervisor Change 的可读验收索引；数组顺序只用于稳定展示和同等就绪时的优先级。新建的 v2 `children.yaml` 只索引 brief 派生的父级验收项，`acceptance_index` 保存每个 ID 的来源和完整文字；Spec 派生的细粒度检查仍由 Runtime 的完整验收矩阵验证，不要求初始 child 计划重复列出。历史 v1 文件继续按原契约接受。

大型需求在最终 Shape 确认前执行一次拆分检测：只有至少两个结果可独立实现和验证、验收项能完整映射且有真实依赖/并行价值时建议 Supervisor Change 模式；目标紧耦合、反复修改同一核心区域、协调成本更高或用户要求单 change 时保持单一 Native change；需求文字长、任务条目多本身不能触发拆分。
建议拆分时，Skill 将 `children.yaml` 草案、执行波次和验收覆盖摘要放入一次 Shape 确认；用户可确认、调整或保持单 change。确认前不得创建子 change、worktree 或派发 Agent。
确认后，Skill 从 Runtime 的 `readyChildren` 自动派发当前可执行子 change；支持并行时同时推进，不支持并行时按顺序执行。子 change 范围严格继承父确认，出现新的用户可见决定时回到父 Shape。
恢复 `/comet-native` 时根据 Runtime 状态继续，不重复创建已有 child 或 worktree。
未解决问题保持 `[blocking]`；有阻塞项时不修改项目实现。完成标准：所有会影响用户可见结果的选择和未明说的假设均已处理，没有 `[blocking]`，用户明确确认目标、范围、关键决定、验收项和非目标，并且 Runtime 已进入 Build。只有用户明确确认后才使用后续指令中含 `--confirmed` 的命令推进。

## Build ↔ Verify Loop

Build 和 Verify 组成一个有界验收循环（Loop）：Builder 提交候选，Runtime 执行必要检查，再由新的只读 Verifier 验收。验收未通过时回到 Build，完成修改并提交下一轮候选；全部通过时进入 Archive。

`iteration` 表示实现候选的轮次，`attempt` 表示同一候选启动 Verifier 的次数。连续失败、没有实际进展或 Verifier 多次执行出错时，Runtime 会在预算上限处进入等待用户或阻塞状态。所有计数都由 Runtime 更新，Agent 只执行最新 `continuation`。

## Build

首次实现时读取当前 brief、完整目标规格和全部验收项。如果 Verify 未通过并返回 Build，先处理 Verifier 指出的未通过项、无法继续验证的问题和失败检查；再次提交前重新核对完整规格与全部验收项，避免只修报错点而遗漏其他要求。

确认一次 Supervisor Change Shape 即授权严格派生的子 change，不要求用户重复确认相同范围。Skill 只执行 Runtime continuation 返回的动作，并在每个 child 完成后重新读取 `readyChildren`，继续下一波；Supervisor Change 最后仍由 Verify 验证完整验收项。

状态包含 `children` 时，当前 change 是 Supervisor Change：不要运行 Supervisor Change Builder，只推进 `readyChildren`。每个 child 都是普通 Native change，必须在独立 worktree 中创建，以 Supervisor Change 的 `workspace.changeBranch` 为目标分支；没有依赖的 child 可以并行 Build/Verify，但 Archive 必须逐个使用 `finish=merge` 合入 Supervisor Change 分支。先提交 Supervisor Change 契约基线以保持集成工作区干净；只有 child 的 Archive 已合入 Supervisor Change 分支才算 `done`，随后才从更新后的 Supervisor Change HEAD 创建依赖它的 child。全部 child 为 `done` 后，执行 Supervisor Change continuation 进入 Verify，由新的 Verifier 在最终集成分支上检查 Supervisor Change 的完整验收项。Supervisor Change Verify 未通过时不要重开已归档 child；按 `repair-child` 提示在 v2 `acceptance_index` 中补充实际失败的 Spec 验收文字，并在 `children.yaml` 中追加覆盖这些失败验收项的唯一 repair child，重新确认 Supervisor Change Shape 后继续。

需求变化时先判断归属：

- 当前需求只是实现有遗漏：从 Verify 使用 `--revise-implementation` 保留已确认需求并回到 Build；
- 用户可见行为或验收标准发生变化：从 Verify 使用 `--revise-requirements`，更新正式产物并重新确认 Shape；
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

Verifier 最终必须逐项标记为通过（`passed`）、未通过（`failed`）或暂时无法验证（`blocked`），一项不能漏，也不能重复。未通过或无法验证时，写出下一轮 Build 可直接处理的原因。无法启动 Verifier、Verifier 执行出错或缺少外部信息时，按命令参考和最新 `continuation` 处理。skill-coordinated Verifier 通过且 Runtime 等待用户决策时，只有用户接受当前结果才用 `--accept-result` 进入 Archive；如果用户要求修改实现或验收标准，分别使用 `--revise-implementation` 或 `--revise-requirements`。

完成标准：Runtime 已接受完整的 Verifier 结果，并明确进入 Build、Archive、等待用户（`await-user`）、阻塞（`blocked`）或完成（`done`）中的一种状态。

## Archive

只有 `continuation` 允许 Archive 时才继续。Archive 直接使用已经接受的验收结果。`branch` 或 `worktree` 需要收尾选择时，一次展示实际 change 分支、目标分支和目录，让用户选择合并（merge）、推送（push）、创建 PR、保留工作区（keep）或暂不归档。

只提交属于当前 change 的实现和正式产物，保留其他用户改动。执行 Runtime 返回的 `commandArgs`，再检查工作区收尾结果 `workspaceFinishResult`；结果为阻塞（`blocked`）时保留现场，并执行 `recoveryArgs` 中的恢复命令。

完成标准：状态为 `done`，并且用户授权的工作区收尾结果为已完成（`completed`）或已保留（`kept`）；其他结果按 `continuation` 继续。

## 后续指令

每次命令后只处理最新的 `continuation`：

- `continue`：执行 `commandArgs`，并按模板填写 `inputOptions`；
- `await-user`：等待列出的用户决定；如有 `commandAlternatives`，选择匹配项执行完整 `commandArgs`，保留 `--expected-state-version` 和 `--expected-action`。alternative 过期时重新读取最新 `continuation`，不得重构无 guard 命令；
- `blocked`：先处理列出的阻塞原因或恢复动作；
- `done`：结束。

执行会修改状态的命令后，重新查询该 change 的详细状态，确认当前阶段、验收循环、状态版本和工作目录。只有需要正式正文时才运行 `show`。
