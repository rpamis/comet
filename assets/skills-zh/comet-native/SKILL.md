---
name: comet-native
description: "Comet Native 工作流。当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用。"
---

# Comet Native

Native 把需求、完整目标规格、当前进度和验收结论保存在项目中。每完成一个阶段都回到 Runtime 读取下一步，当前只处理 Runtime 指定的阶段。CLI 文本先给出面向用户的 `summary` 和唯一 `NEXT:`；需要稳定解析时使用 `--json` 读取新增的 `summary`/`next`/`user_message` Envelope，只有排查机器状态才使用 `--verbose`，并在等待用户决定前先转述 `userCommunication`。
## 硬性边界
- 磁盘中的 `.comet/config.yaml`、当前 change、`comet-state.yaml` 和正式产物是工作依据，聊天记忆只作辅助。
- Runtime 管理工作流状态、本机执行状态、日志、锁和事务；所有阶段推进都通过 PATH 中公开的 `comet native` 命令完成，用户不手工执行这些命令。
- 命令不可用时报告 Comet 安装不完整并停止。参数和输出以 `comet native <command> --help` 为准。
- Builder 提交候选，由新的只读 Verifier 作出验收判断；Verifier 的启动方式服从用户选择的推进方式和 Runtime 返回的 `continuation`。
- Native 主流程由本 Skill 和 Runtime 完成，不依赖任何外部 Skill。

## 开始或恢复
1. 已知 change 名称时，先运行紧凑查询 `comet native status <change-name> --json`；名称未知时才运行 `comet native status --json`，确定目标后再查询该 change。
2. 只有当前动作需要验收文字、Builder 交接、历史或验证详情时才加 `--details`，并按返回的 `nextPageArgs` 逐页读取；只读取覆盖当前 `scopeIds` 的页面，不在同一步重复读取完整状态。需要编辑或核对正式正文时才运行 `show` 或读取对应 brief/Spec。
3. active change 已存在时，进入返回的 `workspace.projectRoot` 并 `select`。Runtime 会扫描已登记的 `worktree`，优先返回绑定分支匹配的工作区；只有多个同样匹配的候选才让用户选择。
4. 没有对应 active change 时才创建，并使用配置指定的产物目录。`comet init` 会按所选 Skill 语言初始化 `native.language`；之后产物跟随项目配置，只有用户明确要求覆盖时才传入 `--language`。
### 记忆接入
进入 change 工作区并读取 Runtime 当前 `phase` 后，Agent 自动运行一次：
```text
comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<本次任务稳定标识>" --json
```
- 只把返回 JSON 的 `text` 加入当前上下文。`manifest`（注入文本中的 `<context_manifest>`）是 Context Manifest，只包含摘要、应用原因和稳定 ID；当前任务需要正文、来源或验证方式时，运行 `comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<同一标识>" --expand-context "<id>" --json`。路径、操作或阶段变化时，以同一 `--session` 和新的 `--path`、`--operation`、`--phase` 重新选择；未变化内容不会重复投递。
- 若 `<active_policies>` 中包含 `<verification command="...">`，把这些命令加入当前 Verify 的实际检查，并记录真实结果；只有成功执行过的命令才能让对应策略进入强制执行状态。
- 只有用户明确要求长期记住偏好或项目约定时，才调用 `comet memory remember <project-root> --text "<偏好或约定>" --scope global|project --json` 并立即作为显式记忆生效；没有明确长期要求但出现可跨任务复用的稳定协作方式时，才调用 `comet memory observe <project-root> --text "<协作方式>" --workflow <workflow> --change <change-id> --candidate-key <stable-topic-key> --json`。两者都不得写任务摘要、实现进展、命令输出或测试结果。
- 实际采用某条上下文后，从 JSON 的 `applications[].applicationId`（Hook 文本中的 `application_id`）取得标识，并在结果明确时运行 `comet task <project-root> --task "<用户原始请求>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`；不得为未实际使用的条目回写成功。验证、编译或 linter 失败时直接按诊断修复并重跑。任务结束仍调用 `comet task <project-root> --task "<用户原始请求>" --complete --workflow <workflow> --change <change-id> --json` 记录工作流检查点。命令不可用、没有内容或自动检索失败时继续工作；无 Hook 平台由本 Skill 使用以上同一接口，`comet memory context` 只作为兼容入口。
### 创建 change
先确定小写 kebab-case 名称，再按[工作区选择参考](reference/workspace.md)决定使用当前目录、创建分支还是创建 worktree。用户明确说并行、同时处理或多个会话时自动选择 `worktree`，不再询问三种方式。CLI 会在创建 change 前完成分支或 worktree 绑定，复用或重建已登记的 change worktree，维护仓库本地排除规则，核对配置并创建可跨设备恢复的状态。随后进入命令返回的 `preparation.projectRoot`；后续命令不得继续在原目录执行。
如果准备没有完成，保留已经创建的资源，展示 `preparation` 中的失败原因，并按 Runtime 或用户给出的恢复方向继续。
## 按需读取
确认当前阶段（`phase`）后，按当前动作读取必要的参考文件。通常只读一份；Shape 必须读取澄清参考，编辑正式产物时可同时读取产物参考：

- Shape：必须读取并执行[澄清参考](reference/clarification.md)；
- 实际编辑 brief/完整目标规格，或查看验收报告时读取[产物参考](reference/artifacts.md)；
- 正常推进时，直接执行 Runtime 在 `continuation` 中给出的命令。只有返回字段含义不清、命令输入被拒绝、无法启动 Verifier、Verifier 执行报错，或 Verifier 要求用户补充信息时，才读取[命令参考](reference/commands.md)；
- 只有任务因进程中断、换设备后本机状态缺失、连续多轮没有进展、并发冲突、旧版本迁移失败或状态损坏而无法继续时，才读取[恢复参考](reference/recovery.md)。
## Shape
先调查能够从仓库、工具和运行环境确定的事实；彼此独立的事实可以交给 subagent 调查。按 `native.clarification_mode` 和澄清参考维护决策树，只把会改变用户可见结果、又无法可靠推断的决定交给用户。用户直接提供文件、附件、链接或本地路径作为需求来源时进入源文档完整覆盖模式：完整读取并记录 `complete`、`partial` 或 `unavailable` 状态，分块读取只改变读取顺序和工作记忆管理，不改变最终覆盖集合；`brief.md` 先保存完整来源需求和覆盖状态，再提出歧义、遗漏或隐含边界问题；可执行来源单元必须同时映射到完整目标 Spec 和至少一个验收 ID，背景、非目标或已废止内容只保留归类、理由和替代关系；修正后的旧单元标为 `superseded` 并指向替代单元；`partial`、`unavailable`、未映射或未确认内容保持 `[blocking]`。仅用于排错、取证、审查或实现参考的材料不自动触发，用途不明时先澄清；摘要不能替代来源覆盖映射。
确认后的用户可见决定和重要约束立即同步到 Decisions、brief 和完整目标规格；普通实现选择只有影响用户可见行为时才进入正式需求。验收项必须具体、可观察且互不重复。Runtime 只从 brief 顶层的验收示例和 Spec 中明确以 `Scenario:` 标出的完整场景生成验收项；说明段落、普通列表和单独的 WHEN/THEN 行不能拆成额外验收项。大型需求需要拆分时，在 Supervisor Change 根目录维护 `children.yaml`；依赖、验收映射和版本兼容规则以产物参考为准。
大型需求在最终 Shape 确认前执行一次拆分检测：只有至少两个结果可独立实现和验证、每项验收都能明确分配给子任务，并且确实存在先后依赖或并行价值时，才建议使用 Supervisor Change；目标紧密相关、需要反复修改同一核心区域、协调成本更高或用户要求单个 Native Change 时，不进行拆分；需求文字长、任务条目多本身不能触发拆分。
建议拆分时，Skill 将 `children.yaml` 草案、子任务依赖和先后顺序、每项验收由哪个子任务负责，以及推进方式，一并放入最终 Shape 确认；用户可以调整拆分、继续使用单个 Native Change，或从以下方式中选择其一：

| 选项 | 推进方式 | 实际影响 |
| --- | --- | --- |
| A | 多会话协作（推荐） | 当前会话只负责统筹；优先由独立会话处理当前可执行的子任务，独立会话或 Agent Team 不可用时自动改用 subagent，并持续反馈进度 |
| B | 单会话推进 | 不创建 Codex 独立会话或 Claude Code Agent Team；全部子任务仍按相同范围、依赖和验收要求，由当前会话依次处理 |
用户已经明确要求“多个会话”“独立会话”“跨会话协作”或“Agent Team”时，视为选择 A，不重复询问推进方式。确认前不得创建子 change、worktree、Codex 独立会话、Claude Code Agent Team 或分配任务。
当最终 Shape 已确定为包含两个或更多 Child 的 Supervisor Change 时，必须在 Decisions 中明确记录 Supervisor Change 和每个 Child 条目，并在运行 `--confirmed` 前要求用户在多会话协作和单会话推进中二选一；不得把普通“确认”视为已选择，也不得替用户默认选择。
确认后，Runtime 把推进方式写入 `comet-state.yaml` 的 `coordination_mode`，再为 Supervisor Change 创建独立的集成分支和 worktree，并基于集成分支的当前提交，为每个子任务生成包含角色、worktree、基线提交和 `runId` 的任务包。推进方式不写入 `children.yaml`，也不改变 Runtime 的 `readyChildren`、`runId`、验收或集成规则。Skill 只启动 `readyChildren` 中列出的当前可执行子任务；选择 A 时最多同时启动两个不依赖其他子任务的任务，选择 B 时按顺序执行。每个子任务的范围都必须来自 Supervisor Change 的确认；出现新的用户可见决定时回到 Supervisor Change 的 Shape。
恢复 `/comet-native` 时以 Runtime 持久化的 `coordination_mode` 为准，不重复创建已有子任务或 worktree，也不再询问推进方式。`multi-session` 继续使用多会话协作及其 subagent 自动降级；`single-session` 继续由当前会话按顺序推进。原来的 Codex 独立会话或 Claude Code Agent Team 已经不存在时，先重新读取 Runtime；不得根据旧会话或旧团队的状态推断子任务已经完成，也不得自动改为单会话推进。
未解决问题保持 `[blocking]`；有阻塞项时不修改项目实现。完成标准：所有会影响用户可见结果的选择和未明说的假设均已处理，没有 `[blocking]`，用户明确确认目标、范围、关键决定、验收项和非目标，并且 Runtime 已进入 Build。只有用户明确确认后才使用后续指令中含 `--confirmed` 的命令推进。

## Build ↔ Verify Loop
Build 和 Verify 组成一个有界验收循环（Loop）：Builder 提交候选，Runtime 执行必要检查，再由新的只读 Verifier 验收。验收未通过时回到 Build，完成修改并提交下一轮候选；全部通过时进入 Archive。`iteration` 表示实现候选的轮次，`attempt` 表示同一候选启动 Verifier 的次数。连续失败、没有实际进展或 Verifier 多次执行出错时，Runtime 会在预算上限处进入等待用户或阻塞状态。所有计数都由 Runtime 更新，Agent 只执行最新 `continuation`。

## Build

首次实现时读取当前 brief、完整目标规格和全部验收项。如果 Verify 未通过并返回 Build，先处理 Verifier 指出的未通过项、无法继续验证的问题和失败检查；修复轮以 `previous_unresolved_ids` 与本轮实际影响的验收 ID 为范围，不重复把已经通过且未受影响的场景交给 Verifier。提交前仍核对改动没有破坏其他已确认行为。
用户确认一次 Supervisor Change 的 Shape，就授权执行所有完全来自该确认范围的子任务，不要求用户重复确认相同范围。Skill 只执行 Runtime 在 `continuation` 中返回的动作，并在每个任务完成后重新读取 `readyChildren`；每个子任务必须经过 `active → verified → integrated`，Supervisor Change 最后仍在集成 worktree 验证全部验收项。
状态包含 `childSummary` 时，不要运行 Supervisor Change Builder，只处理 Runtime 在 `readyChildren` 中列出的当前可执行子任务和 Supervisor 统筹动作。需要某个子任务的完整状态时再读取详情。Runtime 为每个子任务返回 worktree、集成分支的当前提交、角色、任务包和 `runId`；Builder 与 Verifier 回报必须携带当前 `runId`，重复或迟到的回报一律拒绝。子任务不单独执行 Archive；原先通过 `finish=merge` 完成的合入步骤现由 Runtime 负责。只有经过 `active → verified → integrated` 和最小集成检查才算完成集成；Agent 等执行方报告完成，或 worktree 仍有未提交修改，都不能证明已经集成。
选择多会话协作时，当前会话只负责分配任务、检查进度、处理阻塞、集成和 Supervisor Change 的最终 Verify，不直接实现子任务。所有需要修改文件的子任务，都把 Runtime 为该子任务创建的 worktree 作为唯一工作目录；不得为同一子任务再创建另一个 worktree，也不得在 Supervisor Change 或其他子任务的 worktree 写入。分配任务时必须说明子任务角色、任务包、worktree、基线提交、`runId`、验收范围、依赖和停止条件。只启动 `readyChildren` 中列出的当前可执行子任务；不得让独立会话中的 Agent 或团队成员自行领取当前还不能开始的子任务。执行期间持续检查各会话，发现实现偏离、权限或环境阻塞、范围歧义或新的用户可见决定时立即反馈并处理，不等全部任务结束才检查。

- 在 Codex 中，如果可以管理用户可见的独立会话，就为每个当前可执行子任务新建一个独立会话，不要只启动当前会话内的 subagent。创建会话时沿用现有项目，不要让 Codex 另外创建 worktree；新会话必须先进入 Runtime 为该子任务创建的 worktree，后续所有文件和 Git 操作只在该目录执行。当前会话保存会话信息，通过等待或读取会话检查进度，并在需要修正或补充信息时发送后续指令。
- 在 Claude Code 中，如果可以使用 Claude Code Agent Team 且当前为交互式会话，就创建一个 Claude Code Agent Team。当前会话负责统筹，每个当前可执行子任务分配给一个有明确名称的团队成员。团队成员进入 Runtime 为该子任务创建的 worktree；团队任务列表只加入 Runtime 已允许开始的子任务。子任务是否可以开始、是否已经完成，最终以 Runtime 为准。团队成员不得创建新的 Claude Code Agent Team、直接集成父分支或自行扩大范围；当前会话持续读取消息和任务状态并及时引导。
- 如果 Codex 独立会话或 Claude Code Agent Team 不可用，或者恢复后已经找不到原来的会话或团队，先重新读取 Runtime 并说明原因，然后在 `multi-session` 下自动改用 subagent，不再询问推进方式。尚未派发的任务直接按最新 `readyChildren` 创建任务包；已经派发但失去会话的任务不能被视为完成，先用当前 `runId` 提交 `supervisor-cancel`，再执行最新 `continuation` 取得新任务包和新 `runId` 后派发 subagent，旧执行的迟到结果由 Runtime 拒绝。subagent 也不可用时报告真实执行阻塞；不得自动改为单会话推进。
全部子任务都进入 `integrated` 后，立即按 Runtime 返回的 `parentAdvance` 继续，并通知用户 Supervisor Change 进入最终 Verify，不要求用户再次说“推进”。最终 Verify 在集成 worktree 检查全部验收项；失败时保留冲突和阻塞现场，不重新打开已经归档或已进入 `integrated` 的子任务；按 `repair-child` 在 v2 `acceptance_index` 中补充实际失败的 Spec 验收文字，追加一个名称唯一的修复子任务，重新确认 Shape 后继续。目标分支在最终交付前保持不变，最终 Archive、工作区收尾、merge、push 和 PR 仍按原授权边界处理。

需求变化时先判断归属：

- 当前需求只是实现有遗漏：从 Verify 使用 `--revise-implementation` 保留已确认需求并回到 Build；
- 用户可见行为或验收标准发生变化：从 Verify 或 Archive-ready 使用 `--revise-requirements`，更新正式产物并重新确认 Shape；
- 与当前需求无关：保留给另一个 change。
用户明确补充当前范围时，按同一规则处理。
候选完成后，先启动一个没有写权限的新复核执行，检查本轮代码改动、相关测试和当前验收范围。发现必要问题时由 Builder 修正并重新复核；通过后记录简短复核摘要和该复核的执行标识。然后按 Runtime 在 `continuation` 中提供的输入模板提交一份精简的 Builder 交接摘要，包括：本轮做了什么、处理了哪些验收项、实际运行或没有运行哪些开发期检查、已知限制，以及 `review.status=passed`、`review.summary`、`review.reviewer_execution_ref`。复核执行标识不能与 Builder 执行标识相同。这份交接摘要保存在 `comet-state.yaml` 中，不会生成单独文件，也不代表已经验收通过。Runtime 会把必要摘要交给 Verifier，Builder 提交一次即可。
完成标准：实现和相关检查达到可验收状态，完整验收项已重新核对，Runtime 接受交接摘要并进入 Verify。

## Verify

Runtime 要求启动 Verifier（`dispatch-verifier`）时，先把当前候选需要运行的测试和检查命令填入 `inputOptions.template`，由 Runtime 统一执行。Runtime 会复用已经完成的检查；是否重试或补充检查，以最新 `continuation` 为准。`verifierDispatch` 携带工作区与证据位置、`scopeIds`、数量、brief/Spec 引用、详情分页参数、复核摘要和检查结果，不直接携带全部验收文字；如果存在 `recoveryContext`，也要原样传给 Verifier，作为最近一次恢复或用户补充的上下文。`dispatch-verifier` 只登记本次验收并返回任务包和 attempt 标识；它不会启动独立服务或进程，也不需要配置服务地址或回调。按详情分页参数读取覆盖 `scopeIds` 的验收场景后，Agent 必须立即使用当前平台的原生能力启动一个新的只读 Verifier subagent，并原样传递工作区与证据定位信息。subagent 不可用时，只有选择多会话协作且平台可以管理独立会话，才启动与 Builder 分开的独立 Agent 会话；其他情况按命令参考报告 Verifier 不可用，并执行最新 `continuation`。
Verifier 先读取当前 `scopeIds` 对应的验收场景、brief、完整目标 Spec、实际实现和 Runtime 检查结果，最后再把 Builder 交接摘要当作调查线索，保持验收判断独立。Verifier 保持只读。如果现有检查不足，就在 Runtime 返回的 `inputOptions.template` 中列出还需要运行哪些检查，由 Runtime 执行并把结果返回给 Verifier。
Verifier 必须把当前 `scopeIds` 中的每个场景恰好标记一次为通过（`passed`）、未通过（`failed`）或暂时无法验证（`blocked`）。修复范围通过后，Runtime 保留已完成检查并准备一次覆盖全部验收场景的新 Verifier；只有这次最终全量验证通过，才允许进入 Archive。未通过或无法验证时，写出下一轮 Build 可直接处理的原因。平台支持 subagent，但本次任务未启动、执行失败、超时或结束后没有返回时，报告 `verifier-execution-error`；只有当前平台确实没有可用的 subagent 能力时，才报告 `verifier-unavailable`。Runtime 进入 Verifier 不可用的等待用户状态后，用户要求重试时执行 `commandAlternatives` 中的 `retry-verifier`，只有用户明确接受降级结果时才执行 `confirm-verifier-unavailable`；重试会保留候选代码和已完成检查，不要要求用户恢复文件、服务、进程或回调。缺少外部信息时，按命令参考和最新 `continuation` 处理。由 Skill 启动的最终 Verifier 通过且 Runtime 等待用户决策时，只有用户接受当前结果才用 `--accept-result` 进入 Archive；如果用户要求修改实现或验收标准，分别使用 `--revise-implementation` 或 `--revise-requirements`。
完成标准：Runtime 已接受完整的 Verifier 结果，并明确进入 Build、Archive、等待用户（`await-user`）、阻塞（`blocked`）或完成（`done`）中的一种状态。

## Archive

只有 `continuation` 允许 Archive 时才继续。Archive 直接使用已经接受的验收结果。`current` 不需要选择工作区收尾方式：展示当前分支和目录，说明不会执行 merge、push 或创建 PR，再按最新 `continuation` 继续。
使用 `branch` 或 `worktree` 时如果需要选择收尾方式，一次展示实际 change 分支、目标分支和目录，并以单选题提供以下全部选项。文本提问必须使用下表；结构化提问必须将“方式”作为短标签、“实际影响”作为说明，不得只显示 `merge`、`push`、`pull-request` 或 `keep`：

| 选项 | 方式 | 实际影响 |
| --- | --- | --- |
| A | 仅归档并保留工作区（`keep`） | 完成归档并在 change 分支创建归档提交；不合并、不推送、不创建 PR，保留当前分支和目录 |
| B | 本地合并（`merge`） | 完成归档并创建归档提交，再把 change 分支本地合并到目标分支；不推送、不创建 PR |
| C | 归档并推送（`push`） | 完成归档并创建归档提交，再推送 change 分支；不合并到目标分支、不创建 PR |
| D | 归档、推送并创建 PR（`pull-request`） | 完成归档并创建归档提交，推送 change 分支，再以目标分支作为基础分支创建 PR |
| E | 暂不归档 | 不执行归档或工作区收尾，保留当前仍在进行的 change 和工作区，等待稍后继续 |

用户选择 A、B、C 或 D 后，按 `keep`、`merge`、`push` 或 `pull-request` 的映射执行 Runtime 返回的完整命令；选择 E 后停止。选择 A 表示保留当前分支和目录，同一次归档不得删除该 worktree。其他普通 change 归档后，如有已经归档且没有未提交修改的 change worktree，向用户提供清理选项；Runtime 已清理的无需再次询问。只有用户确认后才执行 `git worktree remove`，存在未提交修改或仍在使用的 worktree 必须保留。
Supervisor 最终交付后，Runtime 只自动清理确认没有未提交修改且不再使用的子任务 worktree、集成 worktree 及其分支；发现未提交文件、当前进程仍在其中或 Git 步骤未完成时保留现场并返回阻塞原因，绝不强制删除。
只提交属于当前 change 的实现和正式产物，保留其他用户改动。执行 Runtime 返回的 `commandArgs`，再检查工作区收尾结果 `workspaceFinishResult`；结果为阻塞（`blocked`）时保留现场，并执行 `recoveryArgs` 中的恢复命令。
完成标准：状态为 `done`，并且用户授权的工作区收尾结果为已完成（`completed`）或已保留（`kept`）；其他结果按 `continuation` 继续。

## 后续指令

每次命令后只处理最新的 `continuation`，并按 CLI 输出分层规则处理结果：
- `continue`：执行 `commandArgs`，并按模板填写 `inputOptions`；
- `await-user`：先转述 `userCommunication.message` 和 `suggestedReply`（如果存在），等待列出的用户决定；如有 `commandAlternatives`，选择匹配项执行完整 `commandArgs`，保留 `--expected-state-version` 和 `--expected-action`。备选操作已经过期时重新读取最新 `continuation`，不得自行拼出不带状态保护参数的命令；
- `blocked`：先处理列出的阻塞原因或恢复动作；
- `done`：结束。

执行会修改状态的命令后，重新运行紧凑状态查询，确认当前阶段、验收循环、状态版本和工作目录；只有当前动作确实需要长字段时才分页读取详情，只有需要正式正文时才运行 `show`。
