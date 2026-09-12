# Native 命令与执行参考

只读取当前操作需要的章节。Supervisor 协作、记忆接入和异常处理各有适用条件，遇到对应情况时再读取。

## 记忆接入

进入 change 工作区并读取 Runtime 当前 `phase` 后，Agent 自动运行一次：

```text
comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<本次任务稳定标识>" --json
```

只把返回 JSON 的 `text` 加入当前上下文。`manifest`（注入文本中的 `<context_manifest>`）是 Context Manifest，即上下文条目清单，只包含摘要、使用原因和固定 ID。

当前任务需要正文、来源或验证方式时，运行 `comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<同一标识>" --expand-context "<id>" --json`。路径、操作或阶段变化时，保留同一个 `--session`，用新的 `--path`、`--operation`、`--phase` 重新检索；内容未变化的条目不会重复返回。

若 `<active_policies>` 中包含 `<verification command="...">`，将这些命令加入当前 Verify 的检查，并记录实际结果。只有对应命令成功执行后，Runtime 才会将该策略设为强制执行。

记忆按以下规则保存：

- 用户明确要求长期记住偏好或项目约定时，调用 `comet memory remember <project-root> --text "<偏好或约定>" --scope global|project --json`，立即保存为用户明确指定的记忆。
- 用户没有提出长期记忆要求，但协作方式已经稳定、可供以后任务复用时，才调用 `comet memory observe <project-root> --text "<协作方式>" --workflow <workflow> --change <change-id> --candidate-key <stable-topic-key> --json`。
- 两者都不得保存任务摘要、实现进展、命令输出或测试结果。

实际使用某条上下文后，从 JSON 的 `applications[].applicationId`（Hook 文本中的 `application_id`）取得标识。使用结果明确时，运行 `comet task <project-root> --task "<用户原始请求>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json` 记录结果；没有实际使用的条目不能标为成功。

验证、编译或 linter 失败时，按错误信息修复并重跑。任务结束时，仍调用 `comet task <project-root> --task "<用户原始请求>" --complete --workflow <workflow> --change <change-id> --json` 保存任务完成记录。命令不可用、没有返回内容或自动检索失败时，继续处理任务。没有 Hook 的平台由本 Skill 调用相同接口；`comet memory context` 只作为兼容入口。

## 填写命令输入

首次填写 Runtime 模板或通过 `returnAction` 回传结果前必须读取本节。

把 `inputOptions.template` 复制到系统临时 JSON 文件，只替换模板要求填写的内容，然后执行 `continuation.commandArgs` 或所选 `commandAlternative.commandArgs`。命令结束后删除临时文件。模板中已有的验收轮次、Verifier 尝试次数、状态版本和任务标识都原样保留；只填写模板公开的字段。

`inputOptions` 中同一 `exclusiveGroup` 的选项互斥：选择其中一个，将它的 `template` 作为单个 JSON 对象填入临时文件。字段校验失败时，按 `error.issues` 指出的 JSON 路径、缺失字段和未知字段修正原文件。

Supervisor 子任务在任务包指定的 `projectRoot` 工作。回传结果时，使用 `returnAction` 指定的控制目录、命令和模板。

复制 Runner 输入后，可先执行 `comet native next <change> --runner-input <file> --validate-only --json` 检查 JSON 结构。该校验不会写入状态或启动检查。正式提交时，仍要使用当前 `continuation` 指定的状态版本、任务标识和命令参数。

## Builder 交接

提交 `builder-handoff` 前必须读取本节。

普通 change 和 Supervisor 主任务进入 Verify 前，不需要额外安排一次只读复核。如果已有独立复核结果，可以按 Runtime 模板填写可选的 `review.status=passed`、`review.summary`、`review.reviewer_execution_ref`；复核执行标识不能与 Builder 执行标识相同。

Builder 的交接摘要必须写明本轮修改、处理的验收项、实际运行和未运行的开发期检查，以及已知限制。前面的复核不能替代正式 Verifier；正式 Verifier 仍须独立检查全部验收项。

交接摘要保存在 `comet-state.yaml` 中，不会生成单独文件，也不表示验收已经通过。Runtime 会将必要摘要交给 Verifier，Builder 提交一次即可。

完成标准：实现和相关检查已准备好交给 Verifier，全部验收项已重新核对，Runtime 接受交接摘要并进入 Verify。

## Verify 协议

启动、追加检查或等待 Verifier 前必须读取本节；填写输入遵循[填写命令输入](#填写命令输入)。

### 检查计划与任务包

普通 change 确认没有适用的命令检查时，可提交空列表。Supervisor 主任务必须填写至少一项集成检查，`cwdRef` 是相对于集成工作区的路径。Runtime 负责执行并记录验收检查；Builder 在 handoff 中列出的开发期检查只用于说明本轮实现，不能代替正式检查结果。

启动 Verifier 时，原样传递 `verifierDispatch` 中的工作目录和文件位置：

- `projectRoot`：运行 Native 命令的控制目录。
- `verificationRoot`：待验收实现所在的工作区；Supervisor 主任务使用集成工作区。
- `changeDir`：解析 `briefRef` 和 `specRefs[].ref` 相对路径时使用的基准目录。
- `supervisorStateRef`：包含子任务验收与集成记录的本机状态文件；普通 change 为 `null`。

如果返回了 `recoveryContext`，也要原样交给 Verifier，其中包含最近一次恢复或用户补充的信息。`detailsPageArgs` 已包含 `--project-root`，从任何工作目录查询都应保留它。追加检查后，把 Runtime 返回的检查结果和交接信息交回当前 Verifier，继续等待最终结果。

Runtime 要求启动 Verifier（`dispatch-verifier`）时，按以下步骤执行：

1. 将本轮实现需要运行的测试和检查命令填入 `inputOptions.template`，由 Runtime 统一执行。Runtime 保存的“检查回执”包括检查结果及其对应的实现版本、工作区和输入信息。同一实现版本、同一工作区、同一机器上，输入未变化且回执完整的成功检查可以复用。
2. 检查中断后，只有最新 `continuation` 返回 `retry-checks` 时，才重试其中指定的可重复检查。断言失败或不允许重复执行的检查，不能当作环境故障自动重跑。
3. 读取 `verifierDispatch` 中的工作区和检查记录位置、`scopeIds`、验收项数量、brief/Spec 引用、详情分页参数、可选复核摘要和检查结果。任务包不直接包含全部验收文字，须按分页参数读完 `scopeIds` 对应的验收场景。
4. 立即使用当前平台的原生能力，启动一个新的只读 Verifier subagent，原样传递工作目录、检查记录位置和 `recoveryContext`（如果存在）。subagent 不可用时，只有用户选择了多会话协作、且平台能管理独立会话，才可以启动与 Builder 分开的独立 Agent 会话。其他情况按命令参考报告 Verifier 不可用，并执行最新 `continuation`。

`dispatch-verifier` 只登记本次验收，并返回任务包和 attempt 标识；它不会启动独立服务或进程，也不需要配置服务地址或回调。Verifier 返回结果时，必须原样带回本次任务包中的 `candidateId` 和 `verifierExecutionRef`。Runtime 会拒绝旧实现版本或旧 Verifier 任务的迟到结果。

### 独立验收与结果

Verifier 全程只读。先读取当前 `scopeIds` 对应的验收场景、brief、完整目标 Spec、实际实现和 Runtime 检查结果，再核对检查记录是否对应当前实现版本、工作区和输入，以及是否覆盖全部验收项。只在 `inputOptions.template` 中补充缺失或失效的检查，由 Runtime 执行；Verifier 仍要独立判断全部验收项。

Verifier 最后再阅读 Builder 交接，将其作为调查线索。Builder 只提供本轮实现的位置、验收项的编号与引用、检查记录位置、已知限制和相关文件位置；日志正文按需读取。

等待工具超时后，继续等待同一个 Verifier。只有平台确认执行失败、执行超时、任务丢失或结束后没有可用结果时，才登记执行错误并重试。

通过 `verifier-response` 提交结果时，Verifier 必须把当前 `scopeIds` 中的每个场景恰好标记一次为通过（`passed`）、未通过（`failed`）或暂时无法验证（`blocked`）。未通过或无法验证时，写明具体原因，让下一轮 Build 能据此修复。

提交修复后的实现时，Runtime 会保留仍然有效的检查回执，并让新的正式 Verifier 在一轮内检查全部验收场景。全部通过后，直接等待用户接受验收结果；不会自动清空结果，再追加一轮相同的完整验收。

Verifier 无法完成任务时，区分以下情况：

- 平台支持 subagent，但本次任务未启动、执行失败、超时或结束后没有返回时，报告 `verifier-execution-error`。
- 只有当前平台确实没有可用的 subagent 能力时，才报告 `verifier-unavailable`。
- Runtime 因 Verifier 不可用而等待用户决定时，用户要求重试就执行 `commandAlternatives` 中的 `retry-verifier`。只有用户明确接受未经过独立验收的结果，才执行 `confirm-verifier-unavailable`。重试会保留本轮代码和已完成检查，不要要求用户恢复文件、服务、进程或回调。

无法启动 Verifier、执行报错、缺少外部信息，或需要用户决定是否接受不完整验收时，必须先读取[命令输入与异常](#命令输入与异常)，再按最新 `continuation` 处理。

由 Skill 启动的最终 Verifier 判定通过、Runtime 等待用户决定时，只有用户接受当前结果，才使用 `--accept-result` 进入 Archive。用户要求修改实现或验收标准时，分别使用 `--revise-implementation` 或 `--revise-requirements`。

### 中断检查重试

- `retry-checks`：只重试本轮实现中由 Runtime 标记为中断、且允许重复执行的检查。复制最新 `continuation` 的 `check_ids`，不要替换检查命令或待验收的实现。每项检查最多执行三次，成功结果和有效日志会保留。

完成标准：Runtime 已接受完整的 Verifier 结果，并明确进入 Build、Archive、等待用户（`await-user`）、阻塞（`blocked`）或完成（`done`）中的一种状态。

## Supervisor 协作

分配任务、接收结果或集成前必须读取本节；首次填写输入或执行 `returnAction` 前必须读取[填写命令输入](#填写命令输入)。

### 分配任务与核对任务标识

用户确认一次 Supervisor Change 的 Shape，就授权执行已确认范围内的全部子任务，不要求用户重复确认相同范围。Skill 只执行 Runtime 在 `continuation` 中返回的动作，每个任务完成后重新读取 `readyChildren`。每个子任务都必须经过 `active → verified → integrated`。最后，Supervisor 主任务仍要在集成 worktree 检查全部验收项。

处理 `childSummary` 时，不要运行 Supervisor Change Builder，只处理 `readyChildren` 列出的当前可执行子任务和 Supervisor 统筹动作。需要某个子任务的完整状态时再读取详情。

Runtime 为每个子任务返回 worktree、集成分支的当前提交、角色、任务包和 `runId`。Builder 与 Verifier 返回结果时必须携带当前 `runId`；Runtime 会拒绝重复提交或已经失效的任务结果。子任务检查中断时，只按最新任务模板中的 `retry_check_ids` 重试本轮实现中允许重复执行的检查，已经通过的项不重复执行。

子任务不单独执行 Archive；原先通过 `finish=merge` 完成的合入步骤现由 Runtime 负责。只有经过 `active → verified → integrated`，且最小集成检查通过，才算完成集成。执行任务的 Agent 声称完成，或 worktree 中仍有未提交修改，都不能证明已经集成。

选择多会话协作时，当前会话只负责分配任务、检查进度、处理阻塞、集成和 Supervisor 主任务的最终 Verify，不直接实现子任务。需要修改文件的子任务，只能使用 Runtime 为它创建的 worktree。不得为同一子任务另建 worktree，也不得写入 Supervisor 主任务或其他子任务的 worktree。

分配任务时必须说明子任务角色、任务包、worktree、基线提交、`runId`、验收项的编号与引用、依赖关系和停止条件。只启动 `readyChildren` 中列出的任务；不得让独立会话中的 Agent 或团队成员自行领取尚未满足启动条件的子任务。执行期间持续查看各会话的进度。发现实现偏离需求、权限或环境阻塞、需求范围不明确，或出现会改变用户可见结果的新决定时，立即反馈并处理，不等全部任务结束后再检查。

- 等待外部输入时，必须读取恢复参考中的[等待外部输入与监控](recovery.md#等待外部输入与监控)：停止回复消息不等于暂停监控。只保留仍有任务可推进或外部状态需检查的监控，并及时告知用户阻塞原因和恢复条件。
- 在 Codex 中，如果可以管理用户可见的独立会话，就为每个当前可执行子任务新建一个独立会话，不要只启动当前会话内的 subagent。创建会话时沿用现有项目，不要让 Codex 另外创建 worktree；新会话必须先进入 Runtime 为该子任务创建的 worktree，后续所有文件和 Git 操作只在该目录执行。当前会话保存会话信息，通过等待或读取会话检查进度，并在需要修正或补充信息时发送后续指令。
- 在 Claude Code 中，如果可以使用 Claude Code Agent Team 且当前为交互式会话，就创建一个 Claude Code Agent Team。当前会话负责统筹，每个当前可执行子任务分配给一个有明确名称的团队成员。团队成员进入 Runtime 为该子任务创建的 worktree；团队任务列表只加入 Runtime 已允许开始的子任务。子任务是否可以开始、是否已经完成，最终以 Runtime 为准。团队成员不得创建新的 Claude Code Agent Team、直接集成父分支或自行扩大范围；当前会话持续读取消息和任务状态并及时引导。
- 如果 Codex 独立会话或 Claude Code Agent Team 不可用，或者恢复后已经找不到原来的会话或团队，先重新读取 Runtime 状态并说明原因，然后在 `multi-session` 下自动改用 subagent，不再询问推进方式。尚未分配的任务直接按最新 `readyChildren` 创建任务包；已经分配但原会话丢失的任务不能被视为完成，先用当前 `runId` 提交 `supervisor-cancel`，再按最新 `continuation` 取得新任务包和新 `runId`，交给 subagent 执行，旧执行的迟到结果由 Runtime 拒绝。subagent 也不可用时，如实报告任务无法执行的原因；不得自动改为单会话推进。

### Supervisor 主任务最终验收

全部子任务都进入 `integrated` 后，立即按 Runtime 返回的 `parentAdvance` 继续，并通知用户 Supervisor Change 进入最终 Verify，不要求用户再次说“推进”。最终 Verify 在集成 worktree 检查全部验收项。

验收失败时，保留冲突文件和阻塞记录，不重新打开已经归档或已进入 `integrated` 的子任务。按 `repair-child` 要求，在 v2 `acceptance_index` 中补充实际失败的 Spec 验收文字，追加一个名称唯一的修复子任务，重新确认 Shape 后继续。

最终交付前不修改目标分支。最终 Archive、工作区收尾、merge、push 和 PR 各自仍须遵守用户的授权。

### 子任务验收与集成

- Supervisor 任务回报使用 `supervisor-builder-result`、`supervisor-builder-failure`、`supervisor-checks`、`supervisor-verifier-result`、`supervisor-reconnect`、`supervisor-cancel` 和 `supervisor-integrate`；Builder、Verifier、检查、重连和取消操作保留当前任务包的 `runId`。需要按顺序执行时，可用 `comet native next <change> --max-parallel 1`，默认上限为 2。

子任务 Verifier 按以下步骤提交检查与验收结果：

1. 读取任务包的 `acceptance`、`contractHash` 和 `verificationBoundary`，再提交 `supervisor-checks`。输入字段为 `kind`、`child`、`runId`、`checks`（非空、`repeatable: true` 的 Runtime 检查计划）和 `materials`（可为空，每份材料为 `{name, content}`）；中断后可填写最新模板中的 `retry_check_ids`。
2. Runtime 在已提交本轮实现、没有未提交修改的子任务工作区执行检查，返回 `checkExecution.status`、`operationId`，检查完成后返回 `receiptRef`。检查回执是 Runtime 保存的检查结果记录，用来证明检查针对哪份实现、在哪个工作区和输入条件下执行。
3. 实现版本、工作区、机器、输入和工具环境均未变化时，可继续使用原检查任务或已保存的回执。中断后只重试列出的可重复检查，保留已经通过的检查和有效日志；每项最多执行三次。失败或中断不算通过。
4. 外部报告通过 `materials` 保存内容快照。普通文件路径和口头报告仅供调查，不能代替正式检查结果。
5. 提交 `supervisor-verifier-result`：`verdict` 为 `pass`、`fail` 或 `blocked`；`evidence` 包含 `summary`、`checks`（非正式备注）、`receiptRef` 和 `acceptance`（每项 `{id, result, reason}`）。任务包中每个验收 ID 必须恰好出现一次，总判定必须与逐项结论一致；正式检查结果以 Runtime 回执为准。失败或阻塞时，`receiptRef` 可为 null。报告有遗漏或前后矛盾时，按具体错误修正，不能编造通过项。

集成子任务时使用 `supervisor-integrate`，不携带 `runId`。其 `checks` 必须是非空、`repeatable: true` 的可执行 Runtime 检查计划，不能自行填写“已通过”；中断后也只能使用本轮实现对应的 `retry_check_ids`。Runtime 在集成工作区合入子任务提交后执行检查，全部通过才记录为 `integrated`。子任务通过后，Supervisor 主任务仍须完成全部验收项的最终验收。

Runtime 可以校验已保存检查记录的内容，以及它对应的实现版本、工作区、机器和输入。普通外部文件的写权限隔离仍由运行平台负责。

## 命令输入与异常

正常流程直接执行 Runtime 在 `continuation` 中给出的命令。本节解释返回字段，并说明如何处理以下情况：命令输入被拒绝、无法启动 Verifier、Verifier 任务执行出错、Verifier 因缺少外部信息无法判断，或 Runtime 要求用户决定是否接受未完成独立验收的结果。`continuation.disposition` 说明现在应继续、等待用户、处理阻塞还是结束。只有用户明确确认后，才执行含 `--confirmed` 的后续命令。CLI 文本先给出用户可读的 `summary`、唯一 `NEXT:` 和可选的 `RELAY TO USER:`；用 `--json` 读取结构化响应，`--verbose` 仅用于排查本机执行状态。

命令签名和当前参数始终以 CLI 为准：

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

### Runtime 返回的下一步

- `disposition`：说明现在应该继续、等待用户、处理阻塞还是结束；`userCommunication.required` 为 true 时先转述消息并等待，再执行任何确认命令；
- `commandArgs` / `commandAlternatives`：Runtime 要求执行的完整命令参数；每个备选操作对应一个互斥的用户决定，选择匹配项执行，不要合并多个备选操作；
- `inputOptions`：这次命令需要填写的字段和 JSON 模板；
- `workspace` / `preparation`：实际工作目录和 change 创建结果；
- `stateVersion` / `loop`：当前状态版本和验收循环进度；
- `acceptance` / `childSummary` / `readyChildren` / `supervisor` / `details.nextPageArgs`：验收计数、Supervisor Change 的子任务计数、当前可执行子任务、集成分支与当前任务包摘要，以及详情下一页命令；
- `verifierDispatch`：启动独立 Verifier 所需的工作区与证据位置、当前 `scopeIds`、数量、正文引用、详情分页参数、复核摘要和检查结果；如果存在 `recoveryContext`，也要把它作为最近一次恢复或用户补充的信息直接传给 Verifier；
- `workspaceFinishResult` / `recoveryArgs`：归档后的工作区收尾结果和恢复命令。

Archive-ready 时先执行 continuation 给出的 `archive --dry-run`。使用隔离工作区、且尚未选择收尾方式（finish）时，使用 `commandAlternatives` 中对应的完整 `--dry-run --finish` 命令；不要自行补 `--finish`，也不要直接执行 `--confirmed`。dry-run 会同时检查归档内容和 Git 收尾涉及的分支及文件；`ready: false` 时在同一响应中处理 `blockers` 和 `workspaceFinishBlockers[].paths` 的完整路径清单，不要额外运行 `status` 或手工提交 change 的状态/verification 文件。只有 `ready: true` 才执行返回的唯一 `archive --confirmed` 命令。

模板中的尖括号表示需要填写的值。`await-user` 表示先等待用户决定，此时不执行推进命令。若 `commandArgs` 为 `null` 且返回了 `commandAlternatives`，先确认用户决定，再执行对应备选操作的完整 `commandArgs`，保留其中的 `--expected-state-version` 和 `--expected-action`。命令因状态过期或动作不匹配失败时，重新读取最新 `continuation`，按当前状态继续；不要自行拼接缺少状态校验参数的命令。`localExecution: absent` 只表示这台机器当前没有正在运行的执行任务，不代表 change 已损坏。

### 异常动作输入

- `verifier-execution-error` / `verifier-unavailable`：平台支持 subagent，但本次任务未启动、执行失败、超时或结束后没有返回时使用前者；只有当前平台确实没有可用的 subagent 能力时才使用后者。模板中的任务关联字段必须原样保留，避免旧任务的迟到消息影响新的 Verifier。
- `retry-verifier` / `confirm-verifier-unavailable`：Runtime 在 Verifier 不可用状态返回这两个 `commandAlternatives`。用户要求重试时选择前者，本轮代码和已完成检查会保留；只有用户明确接受“仅完成自动检查、没有独立验收”的结果时，才选择后者。

### 异常情况

- 无法启动独立 Verifier：先确认适用检查已经列明，且 Runtime 检查全部通过；随后按模板报告 unavailable，等待用户决定是否接受“只有命令检查通过、没有 Verifier 独立核验需求”的结果。
- Verifier 暂时无法判断（`semantic blocked`）：如果只缺用户或外部信息，执行 Runtime 返回的解决动作；如果需要修改实现，回到 Build。
- 由 Skill 启动的 Verifier 判断全部通过（`skill-coordinated pass`）：这表示检查已经完成，但系统无法确认验证者是否独立；Runtime 会显示“已完成检查，但需要你确认验证结果”，用户确认后再执行返回的命令。
- 如果显示“无法完成完整验证，只完成了自动检查”，表示没有 Verifier 独立核验需求，只有 Runtime 自动检查结果；只有用户明确确认后才能继续归档。
- 用户确认接受这种不完整结果后，显示“你已确认接受不完整验证结果”；这只表示用户接受了不完整的验收结果，不能据此宣称已经完成独立验证。
- Verifier 任务执行出错（`execution error`）：按模板提交错误，再读取新的 `continuation`。Runtime 决定复用哪些检查以及是否重试。

### 诊断

正式项目规格必须通过当前 change 的完整目标规格和 Archive 更新，不能直接修改已发布的规格。

只修正已确认目标规格中的本地 Markdown 链接目标时，可以执行 `spec sync`：

- 输入包含 `expectedStateVersion`、`actor`、`reason`、`affectedAcceptanceIds` 和 `replacements: [{from, to}]`。
- `affectedAcceptanceIds` 须包含受影响 Spec 的全部验收项。正文、示例或验收含义发生变化时，仍须回到 Shape。
- Runtime 保存修改前后的内容及原因，保留未受影响的验收结论，并回 Build 重新验证受影响内容。
- 同步中进程突然中断、状态尚未保存时，恢复流程会发现规格与已保存状态不一致，并回到 Shape；尚未保存的修正不能当作已确认结果。

Verifier 失联时，使用普通 `next --summary` 恢复。Runtime 会将中断的任务转为可重新验收的状态，不要无限等待旧 Verifier 任务。

跨 worktree 查找状态时，Runtime 会核对 active 和 archive 中的记录。只有 change 的创建信息与已提交的 Git 历史能够证明归档记录替代了活跃记录，才采用归档状态。发生冲突时按实际记录处理，不能仅凭名称相同或版本号更大就认定任务完成。

先运行只读 `doctor`。只有 `doctor` 明确给出修复命令时才执行；锁、跨设备状态和事务仍由 Runtime 管理。
