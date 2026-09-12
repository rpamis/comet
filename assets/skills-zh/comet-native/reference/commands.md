# Native 命令与执行参考

只读取当前动作指向的章节；Supervisor、记忆接入和异常协议各自按触发条件读取。

## 记忆接入

进入 change 工作区并读取 Runtime 当前 `phase` 后，Agent 自动运行一次：

```text
comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<本次任务稳定标识>" --json
```

- 只把返回 JSON 的 `text` 加入当前上下文。`manifest`（注入文本中的 `<context_manifest>`）是 Context Manifest，只包含摘要、应用原因和稳定 ID；当前任务需要正文、来源或验证方式时，运行 `comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<同一标识>" --expand-context "<id>" --json`。路径、操作或阶段变化时，以同一 `--session` 和新的 `--path`、`--operation`、`--phase` 重新选择；未变化内容不会重复投递。
- 若 `<active_policies>` 中包含 `<verification command="...">`，把这些命令加入当前 Verify 的实际检查，并记录真实结果；只有成功执行过的命令才能让对应策略进入强制执行状态。
- 只有用户明确要求长期记住偏好或项目约定时，才调用 `comet memory remember <project-root> --text "<偏好或约定>" --scope global|project --json` 并立即作为显式记忆生效；没有明确长期要求但出现可跨任务复用的稳定协作方式时，才调用 `comet memory observe <project-root> --text "<协作方式>" --workflow <workflow> --change <change-id> --candidate-key <stable-topic-key> --json`。两者都不得写任务摘要、实现进展、命令输出或测试结果。
- 实际采用某条上下文后，从 JSON 的 `applications[].applicationId`（Hook 文本中的 `application_id`）取得标识，并在结果明确时运行 `comet task <project-root> --task "<用户原始请求>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`；不得为未实际使用的条目回写成功。验证、编译或 linter 失败时直接按诊断修复并重跑。任务结束仍调用 `comet task <project-root> --task "<用户原始请求>" --complete --workflow <workflow> --change <change-id> --json` 记录工作流检查点。命令不可用、没有内容或自动检索失败时继续工作；无 Hook 平台由本 Skill 使用以上同一接口，`comet memory context` 只作为兼容入口。

## 填写命令输入

首次填写 Runtime 模板或通过 `returnAction` 回传结果前必须读取本节。

把 `inputOptions.template` 复制到系统临时 JSON 文件，只替换模板要求填写的内容，然后执行 `continuation.commandArgs` 或所选 `commandAlternative.commandArgs`。命令结束后删除临时文件。模板中已有的验收轮次、Verifier 尝试次数、状态版本和任务标识都原样保留；只填写模板公开的字段。

`inputOptions` 中同一 `exclusiveGroup` 的选项互斥：选择一个，将其单个对象 `template` 填入临时 JSON 文件。字段校验失败时按 `error.issues` 的 JSON 路径、缺失字段和未知字段修正原文件。Supervisor 子任务在任务的 `projectRoot` 工作，通过 `returnAction` 的控制目录、命令和模板回传结果。

复制 Runner 输入后可先执行 `comet native next <change> --runner-input <file> --validate-only --json` 做无副作用的结构校验；校验不会写状态或启动检查，正式提交时仍需重新遵守当前 continuation 的绑定。

## Builder 交接

提交 `builder-handoff` 前必须读取本节。

普通 change 或 Supervisor 父级不需要为了进入 Verify 额外启动前置只读复核；如果已有独立复核结果，可以按 Runtime 模板填写可选的 `review.status=passed`、`review.summary`、`review.reviewer_execution_ref`，且复核执行标识不能与 Builder 执行标识相同。Builder 仍要提交本轮做了什么、处理哪些验收项、实际运行或没有运行哪些开发期检查和已知限制。前置复核不会替代正式 Verifier，正式 Verifier 必须独立检查完整验收范围。这份交接摘要保存在 `comet-state.yaml` 中，不会生成单独文件，也不代表已经验收通过。Runtime 会把必要摘要交给 Verifier，Builder 提交一次即可。
完成标准：实现和相关检查达到可验收状态，完整验收项已重新核对，Runtime 接受交接摘要并进入 Verify。

## Verify 协议

启动、追加检查或等待 Verifier 前必须读取本节；填写输入遵循[填写命令输入](#填写命令输入)。

### 检查计划与任务包

普通 change 确认没有适用的命令检查时可提交空列表；Supervisor 父级必须填写至少一项集成检查，`cwdRef` 相对于集成工作区。Runtime 负责执行并记录验收检查，Builder 在 handoff 中列出的开发检查只用于说明候选。

启动 Verifier 时原样传递 `verifierDispatch` 的定位信息：`projectRoot` 是运行 Native 命令的控制目录；`verificationRoot` 是验收实现的工作区，Supervisor 父级使用集成工作区；`changeDir` 是 `briefRef` 和 `specRefs[].ref` 的相对路径基准；`supervisorStateRef` 指向包含子任务验收与集成证据的本机状态，普通 change 为 `null`。如果存在 `recoveryContext`，也要原样交给 Verifier，作为最近一次恢复或用户补充的上下文。`detailsPageArgs` 已包含 `--project-root`，从任何工作目录查询都应保留它。追加检查后，把返回的检查结果和交接信息交回当前 Verifier，继续等待最终结果。

Runtime 要求启动 Verifier（`dispatch-verifier`）时，先把当前候选需要运行的测试和检查命令填入 `inputOptions.template`，由 Runtime 统一执行。Runtime 会复用同一候选、同一工作区和同一机器上输入未变化且有完整回执的成功检查；中断的可重复检查由最新 `continuation` 返回 `retry-checks` 时只重试指定项，不能把断言失败或非可重复检查当成环境故障自动重跑。`verifierDispatch` 携带工作区与证据位置、`scopeIds`、数量、brief/Spec 引用、详情分页参数、可选复核摘要和检查结果，不直接携带全部验收文字；Verifier 回包必须从本次 dispatch 原样带回 `candidateId` 与 `verifierExecutionRef`，旧候选或旧执行的迟到结果会被拒绝；如果存在 `recoveryContext`，也要原样传给 Verifier，作为最近一次恢复或用户补充的上下文。`dispatch-verifier` 只登记本次验收并返回任务包和 attempt 标识；它不会启动独立服务或进程，也不需要配置服务地址或回调。按详情分页参数读取覆盖 `scopeIds` 的验收场景后，Agent 必须立即使用当前平台的原生能力启动一个新的只读 Verifier subagent，并原样传递工作区与证据定位信息。subagent 不可用时，只有选择多会话协作且平台可以管理独立会话，才启动与 Builder 分开的独立 Agent 会话；其他情况按命令参考报告 Verifier 不可用，并执行最新 `continuation`。

### 独立验收与结果

Verifier 保持只读，先读取当前 `scopeIds` 对应的验收场景、brief、完整目标 Spec、实际实现和 Runtime 检查结果，核对证据与当前候选、工作区和输入的绑定及验收覆盖；只在 `inputOptions.template` 中补充缺失或失效的检查，由 Runtime 执行，独立判断仍覆盖全部验收项。最后把 Builder 交接当作调查线索：只传候选、验收范围、证据位置、限制和相关文件位置，日志正文按需读取。等待工具超时后继续等待同一个 Verifier；只有平台确认执行失败、执行超时、任务丢失或结束后没有可用结果时，才登记执行错误并重试。

通过 `verifier-response` 提交结果时，Verifier 必须把当前 `scopeIds` 中的每个场景恰好标记一次为通过（`passed`）、未通过（`failed`）或暂时无法验证（`blocked`）。修复候选提交后，Runtime 会保留仍然有效的检查回执，并让下一次正式 Verifier 一次覆盖全部验收场景；这次完整结果通过后直接进入结果接受边界，不会再自动清空结果并追加一轮相同的全量验收。未通过或无法验证时，写出下一轮 Build 可直接处理的原因。平台支持 subagent，但本次任务未启动、执行失败、超时或结束后没有返回时，报告 `verifier-execution-error`；只有当前平台确实没有可用的 subagent 能力时，才报告 `verifier-unavailable`。Runtime 进入 Verifier 不可用的等待用户状态后，用户要求重试时执行 `commandAlternatives` 中的 `retry-verifier`，只有用户明确接受降级结果时才执行 `confirm-verifier-unavailable`；重试会保留候选代码和已完成检查，不要要求用户恢复文件、服务、进程或回调。无法启动 Verifier、执行报错、缺少外部信息或等待降级决定时，必须先读取[命令输入与异常](#命令输入与异常)，再按最新 `continuation` 处理。由 Skill 启动的最终 Verifier 通过且 Runtime 等待用户决策时，只有用户接受当前结果才用 `--accept-result` 进入 Archive；如果用户要求修改实现或验收标准，分别使用 `--revise-implementation` 或 `--revise-requirements`。

### 中断检查重试

- `retry-checks`：只重试当前候选中由 Runtime 标记为中断且允许重复的检查；复制最新 continuation 的 `check_ids`，不要替换命令或候选。每项检查最多执行三次，成功检查和有效日志会保留。

完成标准：Runtime 已接受完整的 Verifier 结果，并明确进入 Build、Archive、等待用户（`await-user`）、阻塞（`blocked`）或完成（`done`）中的一种状态。

## Supervisor 协作

派发、接收回报或集成前必须读取本节；首次填写输入或执行 `returnAction` 前必须读取[填写命令输入](#填写命令输入)。

### 任务分配与执行身份

用户确认一次 Supervisor Change 的 Shape，就授权执行所有完全来自该确认范围的子任务，不要求用户重复确认相同范围。Skill 只执行 Runtime 在 `continuation` 中返回的动作，并在每个任务完成后重新读取 `readyChildren`；每个子任务必须经过 `active → verified → integrated`，Supervisor Change 最后仍在集成 worktree 做一次最终全量验证，覆盖全部验收项。
处理 `childSummary` 时，不要运行 Supervisor Change Builder，只处理 Runtime 在 `readyChildren` 中列出的当前可执行子任务和 Supervisor 统筹动作。需要某个子任务的完整状态时再读取详情。Runtime 为每个子任务返回 worktree、集成分支的当前提交、角色、任务包和 `runId`；Builder 与 Verifier 回报必须携带当前 `runId`，重复或迟到的回报一律拒绝。子任务检查中断时，只按最新任务模板中的 `retry_check_ids` 重试当前候选的可重复项，已经通过的项不重复执行。子任务不单独执行 Archive；原先通过 `finish=merge` 完成的合入步骤现由 Runtime 负责。只有经过 `active → verified → integrated` 和最小集成检查才算完成集成；Agent 等执行方报告完成，或 worktree 仍有未提交修改，都不能证明已经集成。
选择多会话协作时，当前会话只负责分配任务、检查进度、处理阻塞、集成和 Supervisor Change 的最终 Verify，不直接实现子任务。所有需要修改文件的子任务，都把 Runtime 为该子任务创建的 worktree 作为唯一工作目录；不得为同一子任务再创建另一个 worktree，也不得在 Supervisor Change 或其他子任务的 worktree 写入。分配任务时必须说明子任务角色、任务包、worktree、基线提交、`runId`、验收范围、依赖和停止条件。只启动 `readyChildren` 中列出的当前可执行子任务；不得让独立会话中的 Agent 或团队成员自行领取当前还不能开始的子任务。执行期间持续检查各会话，发现实现偏离、权限或环境阻塞、范围歧义或新的用户可见决定时立即反馈并处理，不等全部任务结束才检查。

- 等待外部输入时，必须读取恢复参考中的[等待外部输入与监控](recovery.md#等待外部输入与监控)：区分静默与实际暂停，只保留有推进或检查价值的监控，并及时告知用户阻塞与恢复条件。
- 在 Codex 中，如果可以管理用户可见的独立会话，就为每个当前可执行子任务新建一个独立会话，不要只启动当前会话内的 subagent。创建会话时沿用现有项目，不要让 Codex 另外创建 worktree；新会话必须先进入 Runtime 为该子任务创建的 worktree，后续所有文件和 Git 操作只在该目录执行。当前会话保存会话信息，通过等待或读取会话检查进度，并在需要修正或补充信息时发送后续指令。
- 在 Claude Code 中，如果可以使用 Claude Code Agent Team 且当前为交互式会话，就创建一个 Claude Code Agent Team。当前会话负责统筹，每个当前可执行子任务分配给一个有明确名称的团队成员。团队成员进入 Runtime 为该子任务创建的 worktree；团队任务列表只加入 Runtime 已允许开始的子任务。子任务是否可以开始、是否已经完成，最终以 Runtime 为准。团队成员不得创建新的 Claude Code Agent Team、直接集成父分支或自行扩大范围；当前会话持续读取消息和任务状态并及时引导。
- 如果 Codex 独立会话或 Claude Code Agent Team 不可用，或者恢复后已经找不到原来的会话或团队，先重新读取 Runtime 并说明原因，然后在 `multi-session` 下自动改用 subagent，不再询问推进方式。尚未派发的任务直接按最新 `readyChildren` 创建任务包；已经派发但失去会话的任务不能被视为完成，先用当前 `runId` 提交 `supervisor-cancel`，再执行最新 `continuation` 取得新任务包和新 `runId` 后派发 subagent，旧执行的迟到结果由 Runtime 拒绝。subagent 也不可用时报告真实执行阻塞；不得自动改为单会话推进。

### 父级最终验收

全部子任务都进入 `integrated` 后，立即按 Runtime 返回的 `parentAdvance` 继续，并通知用户 Supervisor Change 进入最终 Verify，不要求用户再次说“推进”。最终 Verify 在集成 worktree 检查全部验收项；失败时保留冲突和阻塞现场，不重新打开已经归档或已进入 `integrated` 的子任务；按 `repair-child` 在 v2 `acceptance_index` 中补充实际失败的 Spec 验收文字，追加一个名称唯一的修复子任务，重新确认 Shape 后继续。目标分支在最终交付前保持不变，最终 Archive、工作区收尾、merge、push 和 PR 仍按原授权边界处理。

### 子任务验收与集成

- Supervisor 任务回报使用 `supervisor-builder-result`、`supervisor-builder-failure`、`supervisor-checks`、`supervisor-verifier-result`、`supervisor-reconnect`、`supervisor-cancel` 和 `supervisor-integrate`；Builder、Verifier、检查、重连和取消操作保留当前任务包的 `runId`。需要按顺序执行时，可用 `comet native next <change> --max-parallel 1`，默认上限为 2。
- 子任务 Verifier 先读取任务包的 `acceptance`、`contractHash` 和 `verificationBoundary`，再提交 `supervisor-checks`：字段为 `kind`、`child`、`runId`、`checks`（非空、`repeatable: true` 的 Runtime 计划）、`materials`（可为空，每份材料为 `{name, content}`），中断后可选填最新模板中的 `retry_check_ids`。检查在干净的子任务候选工作区执行，Runtime 返回 `checkExecution.status`、`operationId` 和完成后的 `receiptRef`。相同候选、同一工作区、同一机器且输入和工具环境未变化时复用执行句柄或已登记回执；中断后只重试列出的可重复检查，已经通过的检查和有效日志保留，每项最多三次。失败或中断不算通过。外部报告通过 `materials` 登记内容快照，普通路径和口头报告仅是调查线索。 `supervisor-verifier-result` 的 `verdict` 为 `pass`、`fail` 或 `blocked`；`evidence` 包含 `summary`、`checks`（非正式备注）、`receiptRef`、`acceptance`（每项 `{id, result, reason}`）。任务包中每个验收 ID 必须恰好出现一次；总判定必须与逐项结论一致，正式检查以 Runtime 回执为准；失败或阻塞时 `receiptRef` 可为 null。报告遗漏或矛盾时按具体错误修正，不能自行补造通过项。子任务通过后父级仍执行最终全量验收。 `supervisor-integrate` 不携带 `runId`，其 `checks` 必须是非空、`repeatable: true` 的可执行 Runtime 检查计划，不能提交自行声明的通过状态；中断后同样只能使用当前候选的 `retry_check_ids`。Runtime 在集成工作区合入候选后执行检查，只有全部通过才记录 integrated。已登记证据可校验内容、候选、工作区、机器和输入绑定；普通外部文件的写权限隔离仍由运行平台负责。

## 命令输入与异常

正常流程直接执行 Runtime 在 `continuation` 中给出的命令。本文件用于解释返回字段，以及处理以下情况：命令输入被拒绝、无法启动 Verifier、Verifier 任务执行出错、Verifier 因缺少外部信息无法判断，或 Runtime 要求用户确认降级验收。`continuation.disposition` 说明现在应继续、等待用户、处理阻塞还是结束。只有用户明确确认后，才执行含 `--confirmed` 的后续命令。CLI 文本先给出用户可读的 `summary`、唯一 `NEXT:` 和可选的 `RELAY TO USER:`；用 `--json` 读取新增 Envelope，`--verbose` 仅用于机器状态排查。

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

Archive-ready 时先执行 continuation 给出的 `archive --dry-run`。隔离 workspace 尚未选择 finish 时，使用 `commandAlternatives` 中对应的完整 `--dry-run --finish` 命令；不要自行补 `--finish`，也不要直接执行 `--confirmed`。dry-run 会同时检查归档内容和 Git 收尾范围；`ready: false` 时在同一响应中处理 `blockers` 和 `workspaceFinishBlockers[].paths` 的完整路径清单，不要额外运行 `status` 或手工提交 change 的状态/verification 文件。只有 `ready: true` 才执行返回的唯一 `archive --confirmed` 命令。

模板中的尖括号表示需要填写的值。`await-user` 表示先等待用户决定，此时不执行推进命令。若 `commandArgs` 为 `null` 且返回了 `commandAlternatives`，先确认用户决定，再执行对应备选操作的完整 `commandArgs`，保留其中的 `--expected-state-version` 和 `--expected-action`。命令因状态过期或动作不匹配失败时，重新读取最新 `continuation`，按当前状态继续；不要自行拼接不带 guard 的命令。`localExecution: absent` 只表示这台机器当前没有正在运行的执行任务，不代表 change 已损坏。

### 异常动作输入

- `verifier-execution-error` / `verifier-unavailable`：平台支持 subagent，但本次任务未启动、执行失败、超时或结束后没有返回时使用前者；只有当前平台确实没有可用的 subagent 能力时才使用后者。模板中的任务关联字段必须原样保留，避免旧任务的迟到消息影响新的 Verifier。
- `retry-verifier` / `confirm-verifier-unavailable`：Runtime 在 Verifier 不可用状态返回这两个 `commandAlternatives`。用户要求重试时选择前者，候选代码和已完成检查会保留；只有用户明确接受只有自动检查的降级结果时才选择后者。

### 异常情况

- 无法启动独立 Verifier：先确认适用检查已经列明，且 Runtime 检查全部通过；随后按模板报告 unavailable，等待用户决定是否接受只有命令检查、没有独立语义验收的降级结果。
- Verifier 暂时无法判断（`semantic blocked`）：如果只缺用户或外部信息，执行 Runtime 返回的解决动作；如果需要修改实现，回到 Build。
- 由 Skill 启动的 Verifier 判断全部通过（`skill-coordinated pass`）：这表示检查已经完成，但系统无法确认验证者是否独立；Runtime 会显示“已完成检查，但需要你确认验证结果”，用户确认后再执行返回的命令。
- 如果显示“无法完成完整验证，只完成了自动检查”，表示没有可用的语义验证，只有 Runtime 自动检查结果；只有用户明确确认后才能继续归档。
- 用户确认接受这种不完整结果后，显示“你已确认接受不完整验证结果”；这只表示用户明确接受降级结果，不会把它改成独立验证。
- Verifier 任务执行出错（`execution error`）：按模板提交错误，再读取新的 `continuation`。Runtime 决定复用哪些检查以及是否重试。

### 诊断

正式项目规格通过当前 change 的完整目标规格及 Archive 更新，不能直接修改已发布的规格。仅修正已确认目标规格的本地 Markdown 链接目标时，可执行 `spec sync`；输入包含 `expectedStateVersion`、`actor`、`reason`、`affectedAcceptanceIds` 和 `replacements: [{from, to}]`。覆盖受影响 Spec 的全部验收项；正文、示例和验收语义变化继续回 Shape。Runtime 保存修改前后内容及原因，保留未受影响结论并回 Build 重验。同步中进程突然中断而未提交状态时，恢复会检测规格漂移并回 Shape，不把未提交的修正当作已确认结果。 Verifier 失联时，使用普通 `next --summary` 恢复，Runtime 将中断执行转为可重验状态；不要无限等待旧执行引用。跨 worktree 状态发现会核对活跃记录和归档记录，只有创建身份与已提交 Git 历史证明替代关系时才选择归档；冲突需按真实记录处理，不能按同名或版本大小推断完成。 先运行只读 `doctor`。只有 `doctor` 明确给出修复命令时才执行；锁、跨设备状态和事务仍由 Runtime 管理。
