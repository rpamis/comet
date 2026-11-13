# Native 命令与执行参考

Runtime 不再以 PID、进程创建身份或线程绑定决定恢复。进程退出会释放本机事务锁；旧格式锁需确认原操作停止后退役一次。检查中断时沿用原 Run、实际结果和日志；结果未知时先核对副作用，明确确认停止后处理原 Action，不按历史 PID 杀进程、不自动重跑。移除 PID 只消除该机制的恢复阻塞，不能把执行到一半的 Git 或文件操作变成已完成。

只读取当前操作需要的章节。Supervisor 协作、记忆接入和异常处理各有适用条件，遇到对应情况时再读取。

## SDK Run

### 任务结果回报

新建内置 SDK 的普通任务与 Supervisor 任务用 `comet native next <change> --session <实际会话标识> --json` 领取。当前响应是 `comet.native.task-result.v1` 时直接使用 `task`、`resultTemplate` 和 `next.commandArgs`；`--details` 才附带完整 SDK 状态。结果文件只保存实际 `status`、`output` 和需要的业务结果字段，命令中的 `--action` 绑定原任务，`--session` 绑定实际领取者。结果文件放在临时目录；没有 Git 跟踪信息时放在项目之外，避免它成为候选输入。

`shape.prepare` 任务由 Agent 从正式文档整理验收项，按 `resultTemplate` 提交 `output.acceptance`，每项填写实际 `source` 与 `text`。来源使用 brief 或已声明的目标 Spec；CLI 分配稳定验收 ID。自由格式文档无需补固定章节，提交后仍须展示完整方案并取得用户确认。

Supervisor 响应中的 `task.child`、`task.scope` 和 `workspace.projectRoot` 确定实际执行范围；多个候选任务从 `availableTasks` 选择并用真实会话领取。子任务只验收自身条目，父级覆盖全部已确认要求。集成修复使用集成工作区；独立 Verifier 不会自动领取实现或集成修复任务。

普通任务、Child 和父级任务由 Agent 使用平台工具执行检查，读取真实结果后填写 checks 的 name/result/note，记录命令、目录、结果和日志引用。Builder 一次提交实现与结果；Verifier 普通任务填写 output.checks，Child 填写 evidence.checks。checks 可为空，但未运行与失败不能当作通过；验收者负责判断证据是否充分。v4 不提交 verificationChecks、integrationChecks、request-checks 或自制收据，Runtime 不再重复执行普通检查。旧 Run 自动适配业务数据，沿用原批准、任务和候选，使用当前返回的报告模板。`--review current-session` 由当前真实会话领取 Verify；`--review independent` 保留待领取任务，由独立接收者填写自己的会话身份后执行返回命令。用户明确要求独立审查时选择后者。一次响应只执行其当前下一步，完整验收正文不能裁掉。

Verify 回报默认停在用户接受结果。只有用户已明确委托“全部通过后接受并归档”时，才添加 `--accept-on-pass <授权摘要>`；Runtime 只在本次结果通过且对应当前确认时接受，保存该摘要，并连续归档。该选项不授权 Git merge、push、PR 或清理，也不改变旧 `--accept-result` 的提案绑定。重复结果使用原 Action 和相同内容，错误会话、不同结果、候选漂移按原 Runtime 协议拒绝。

以下底层协议只供旧 Run、固定应用、明确异常或调试使用。当前高层响应已充分时直接继续。

响应的 `runtimeFormat` 为 `sdk`，或 `data.schema` 为 `comet.native.sdk-status.v1`、`comet.native.dispatch-result.v1`、`comet.native.run-view.v1` 时使用本节，直接识别当前响应，不额外查询 status。Run ID 使用当前响应的 `data.run.id` 或 `data.runId`；最新 `pendingActions`、`activeActions`、`action` 和 `stateVersion` 决定当前工作。领取响应已经包含当前 Action 输入和回报模板，直接使用；只有缺少实际所需正文时才读取同一响应给出的详情命令。SDK 请求保存为临时 UTF-8 JSON，通过 `comet runtime dispatch --application native --project-root <projectRoot> --request <file>` 提交，不放进 change 产物、提交或报告。命令返回 `status: succeeded` 后，核对同一 Action 的领取或已持久化结果身份；相同领取或结果的幂等确认可以保留原 revision，不要求重复提交产生状态变化。提交后沿用返回的当前身份和 continuation。

### Shape 与 SDK 自有 Action

普通 `status` 只读取当前业务状态；需要历史执行记录时使用 `--details` 或 `doctor`。正常推进直接使用当前响应，遇到实际错误再读取恢复说明。本地 SDK Run 保存每次推进；Portable 检查点在用户等待、Agent 交接和结束等边界写入，内部无副作用步骤不要求同步投影，外部命令执行前仍保存恢复边界。不要手动修改检查点来推进流程。

新 Run 的 Verify 通过后直接等待接受，报告由 Runtime 生成阅读视图。报告写入失败时按 warning 继续或重试 `next`，保留已保存的验收结论。接受后普通流程在 Archive 准备时核对候选和实际输入；候选变化必须重新处理。Supervisor 交付仍使用自己的执行步骤。

完成正式 brief 和完整目标 Spec 后，运行 `comet native next <change> --json`，直到 `run.waits` 出现待处理的 `shape.confirm` 或 `supervisor.shape.confirm`。向用户展示完整 Shape；Supervisor 还要展示 Child 计划，并让用户选择多会话或单会话推进。得到明确确认后，按当前 `continuation.commandAlternatives` 的状态版本和动作执行对应命令；Agent 判断目标、验收或授权发生实质变化时重新提案。之后一次 `next` 连续执行已获授权的 Runtime 内部 Action，遇到用户决定、Agent 任务、失败或未知结果时返回；查看返回的 `pendingActions` 处理全部待办，`pendingAction` 只表示其中第一项。对 `build.builder`、`verify.verifier`、`supervisor.child.builder`、`supervisor.child.verifier`、`supervisor.child.integration-repair` 和 `supervisor.parent.builder`，按下文协议领取并回报各自的 Action；多个 Child 可以并行工作，但集成 Action 与集成结果提交按 Run 顺序串行推进。每次提交后重新读取 Action、Wait 和状态。

Supervisor Child 的 Verifier 明确判定失败时，在原 Child worktree 修复并提交新的候选，再提交平台检查与验收结果。结果未知时先核对原平台任务。Git 集成冲突或中断沿同一 Action 和原现场恢复，不把未知结果当作失败后重放合并；Runtime 继续核对实际提交、分支和祖先关系。

Supervisor 父级 Verifier 明确判定失败，或用户拒绝当前父级验收结果时，Run 会生成新的 `supervisor.parent.builder`。在原集成 worktree 修复并提交后，Builder 回报须携带新的 `candidateCommit`；Runtime 将该提交绑定到后续检查、独立验收和交付。未改动代码时仍需提交新的 Builder 结果和检查，不复用旧候选的验收。

### SDK Action 领取与回报

Builder 开始本轮实现前、Verifier 开始验收前，复制当前 Action 的 `claimRequest`，填写接收会话并保留已提供的稳定领取标识，先提交 `claim`。独立 Action 的领取按 `actionId`、`attempt` 和 `inputHash` 校验，不自行补入旧的全局 revision；其他任务推进不要求重派本任务。请求包含 `operation: "claim"`、`runId`、`actionId`、`attempt`、`inputHash`、`executorId: "native-host"`、`sessionId` 和本次唯一且恢复时保持不变的 `claimToken`。`sessionId` 使用平台会话或任务标识；若平台没有可读标识，使用本次工作稳定唯一的执行引用，并明确其只是关联标识，不能据此宣称执行者身份已认证。只有返回的同一 Action 为 `running`、领取标识匹配，才执行或继续本次工作。已由别的执行者领取时，先核对该工作，不能重新领取或另起同一任务。

领取响应提供 `resultRequest` 时，整体保留其中的 `receipt`，只填写 `result.status` 与真实业务 `result.output`，通过同一 dispatch 命令提交；无需拆装 Action 身份或生成结果 ID。重复提交相同结果沿用原收据。旧 `outcomeRequest` 继续可用，不能混用两种输入。`claimRequest` 中已填好的领取令牌原样保留，只填写实际会话标识。提交时间由 Runtime 补记；`addressedAcceptanceIds` 可选，用于本轮处理重点，省略不代表修改了全部验收项。

没有 `resultRequest` 的旧响应中，执行者完成后用同一 `runId` 提交 `record-outcome`：`outcome` 包含原 `actionId`、`attempt`、`inputHash`、`claimToken`，本次唯一的 `outcomeId`、真实的 `status` 和 `output`。不得把尚未完成、未运行或结果未知的工作写成 `succeeded`。SDK 校验结果并保存收据后才按新的 Run 继续。

### SDK Builder 交接

新 Run 的 Builder 结果含可选布尔字段 `requireIndependentReview`。用户明确要求独立审查，或 Agent 已决定交给独立审查者时填 `true`，该要求随实际 Builder 结果保存，后续领取省略参数也不能取消。普通高层命令的 `--review independent` 自动保存同一要求。Supervisor Child 与主任务也按此选择，当前模板未提供该字段的旧 Run 沿用原规则。验收者始终只读，以实际会话领取；同会话结论显示为 `self-reviewed`。

`build.builder` 和 `supervisor.parent.builder` 的完成结果填写实际 `summary`、实际 `checks`（每项 `name`、`result`、`note`）和 `knownLimits`。当前模板不含 `acceptanceReview` 时直接提交这些内容，完整逐项验收在 Verify 完成。旧模板要求该表时，对每个验收 ID 提供 `{id,status,evidence,note}`，全部为 `implemented-with-evidence` 且证据非空才提交；显式提供的表仍须完整、真实。

按[普通命令与检查](../../comet/reference/platform-execution.md)使用平台工具执行普通命令、核对原任务与副作用、判断结果是否适用，并提交实际报告。Comet 不重复执行检查，不维护普通命令的内容快照、进程监管或恢复机制。 不提交 `request-checks`、检查计划或普通检查收据。

### SDK Verify 协议

`verify.verifier` 和 `supervisor.child.verifier` 的执行者按当前 `sessionRequirements.independent` 确定。为 `false` 时可由当前会话领取，并根据不确定性、交叉核对的价值和用户要求决定是否安排独立审查；为 `true` 时由不同于 Builder 的只读会话领取。只读要求适用于所有验收执行者。安排独立审查时传入当前候选 ID、验收项及引用、工作区和 实际检查报告位置，让它使用真实会话身份领取。平台仅接受派发、尚无 Verifier 领取回执时，状态是“已派发未确认启动”。等待工具超时继续跟踪同一任务。Verifier 读取全部当前验收项并独立核验后，成功 `output` 包含当前 `candidateId`、与领取时相同的 `verifierExecutionRef`，以及 `response`：完整结论使用 `final-result`，实际检查填写 `output.checks`（Child 使用 `evidence.checks`）。缺少证据时通过平台工具补足，沿用同一验收任务。

只有平台确认 Verifier 任务未启动、执行失败、执行超时、丢失或结束后没有可用结果，才将其 Action 提交为 `status: "failed"`，`output` 写真实的非空 `summary`。SDK 保留候选和已完成检查，限次生成新 Action；达到上限后等待用户决定。当前 Action 要求独立会话但无法安排时，停止并报告；始终如实提交实际验收结论。

### 用户决定、Archive 与恢复

`verify.confirm` 待处理时，先展示实际验收结论并等待用户决定。只用当前 `run.waits[].proposalHash`、`stateVersion` 和对应 `--expected-action`，执行 `native next <change> --accept-result|--revise-implementation --summary <text> --proposal-hash <hash> --expected-state-version <n> --expected-action <action>`；Runtime 将接受决定绑定到当前候选和结构化验收结果。新 Run 的 Markdown 报告作为阅读视图；旧 Run 保留原报告与执行关联，不根据当前文件字节重新验收。用户修改需求或验收标准时，先说明重新确认 Shape 的影响，得到明确选择后使用当前状态版本执行 `native next <change> --revise-requirements --summary <text> --expected-state-version <n> --expected-action revise-requirements`；该 SDK 命令通过版本化命令替换当前未领取的工作，不使用 Verify 的提案哈希。从新的 Shape 继续，不复用原验收。Archive 中 `archive.execute` 尚未成功时也可修订；已执行归档后不得倒退修改。`verify.retry` 待处理时，用户明确选择重试后才以相同保护参数执行 `--retry-verifier`，继续使用原候选和有效检查。

进入 Archive 后直接执行当前 continuation 返回的 `native archive <change> --json` 命令；Runtime 会按顺序组合执行可安全推进的 `archive.prepare`、`archive.execute`、`archive.finalize`，并保留每个 Action 的真实结果。仅需预览或诊断时使用 `native archive <change> --dry-run --json`。每次只按返回的最新 continuation 继续，不固定重复 Archive，不用旧状态版本重放。Supervisor 还会有 `supervisor.cleanup`：Runtime 只在目标分支仍是已验收提交、临时 worktree 干净且分支已合入时清理本次创建的 Child 和集成 worktree；遇到脏 worktree 或结果未知，保留现场并按原 Action 核对，不强制删除。只有 SDK Run 为 `completed` 且业务状态为 `done` 才说 SDK 归档完成。merge、push、PR 和非 Supervisor 临时工作区的收尾仍按用户授权分别执行和核对，SDK 归档不自动证明这些外部交付已完成。

中断恢复时先读取 `native status <change> --details --json`，必要时用 `runtime dispatch` 的 `inspect` 请求取得完整 Run。待处理 Action 可继续；`running` 或 `unknown` 的平台 Action 先查原平台会话、任务句柄与原 `claimToken`。实际结果已知时由原领取者提交原 Action 的结果；只有权威证据证明未执行，才按 SDK 的 `retry`/reconciliation 协议重新开放。结果未知时保留现场并报告阻塞，不重派 Builder、Verifier 或其他有外部副作用的工作。旧 Runtime 的 `continuation` 和 `--runner-input` 指令不适用于 SDK Run；整个本地 Run 记录丢失时，按主 Skill 的显式恢复步骤处理。

Builder 已部分执行且原 Action 已提交 `failed` 时，保留工作区和原失败结果；不要把它核对成“未执行”后重试，也不要自行重新派发。运行 `native next <change> --json`，从 `pendingBuilderDecisions` 读取对应的 `build.resume`、`supervisor.child.resume` 或 `supervisor.parent.resume` Wait。先向用户说明已完成的修改、失败原因与继续工作的风险，得到明确决定后，填写 `commandArgs` 中的 `--summary` 并原样保留提案摘要、状态版本和预期动作，再执行 `--continue-builder`。Runtime 会创建绑定原失败 Action 的新 Builder Action；在原工作区领取并继续它，完成后重新执行检查和验收。用户尚未决定或提案已过期时停下，重新读取当前 Run，不修改原失败结果。

若 `supervisor.parent.deliver`、`archive.execute`、`archive.finalize` 或 `supervisor.cleanup` 是唯一的 `unknown` Action，且已确认原执行进程停止，可运行 `native archive <change> --recover --json`。交付恢复只在目标分支仍精确指向已验证集成提交时，向原 Action 提交结果；目标尚未交付或分支已漂移时拒绝，不重新执行快进。归档与清理恢复会核对原领取、持久化证据和工作区，必要时完成剩余的安全操作，再向同一 Action 提交结果；恢复不会创建新尝试。证据不足、worktree 有未保存修改，或原执行进程仍可能运行时，保留现场并先处理这些事实。成功返回后重新读取 Run，继续处理新产生的待办 Action。

## 记忆接入

领取响应含 `data.contextDelivery` 时，读取 `data.context[].text` 后直接工作，无需再执行 `contextRequest`；`empty` 表示没有新增交付，`unavailable` 时按明确任务继续。需要正文时使用 `data.contextActions.expand`，上下文丢失时使用 `data.contextActions.restore`，收尾时使用 `data.contextActions.complete` 并填写实际学习文件。新 Agent 使用自己的会话标识，不复用其他执行者的上下文回执。

没有自动交付时，进入 change 工作区并取得当前 `phase` 后，优先执行当前任务包的 `contextRequest`（包括 Compat 的 `supervisorTask.contextRequest`）；没有任务专属请求时使用 `continuation.contextRequest`。SDK 的 Builder、Verifier 和子任务使用对应 `pendingActions[]` 或 `activeActions[]` 中的 `contextRequest`，由接收方在领取成功后执行。命令中的任务填用户原始请求，会话填接收 Agent 自己的稳定标识；原始请求缺失时先从当前 brief 恢复目标。

首次进入阶段、交接给新 Agent、上下文压缩或新会话恢复后，各执行一次完整读取。旧响应没有 `contextRequest` 时使用：

```text
comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<接收 Agent 的稳定标识>" --context-mode snapshot --json
```

把返回 JSON 中 `context[].text` 加入当前上下文。完整读取返回当前阶段适用的内容，不受本会话此前已交付记录的去重影响；重复读取不代表重复使用或成功执行。`manifest`（注入文本中的 `<context_manifest>`）是 Context Manifest，即上下文条目清单，只包含摘要、使用原因和固定 ID。

当前任务需要正文、来源或验证方式时，运行 `comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<同一标识>" --expand-context "<id>" --json`。同一阶段连续执行时复用已取得的内容；路径或操作变化时保留会话标识，按新的 `--path`、`--operation` 重新检索，默认增量模式只返回尚未交付的适用内容。

交接时附上接收方的 `contextRequest`，保留用户原话、适用条件和来源；Verifier 只接收适用的验收偏好、项目约束和客观证据，不把 Builder 的自评当作结论。按平台实际可用的技能加载接口执行适用的 Skill 偏好；不可用、与当前指令冲突或不符合只读角色时说明原因。记忆已交付、Skill 已加载和实际遵循分别核对；Skill 不代替 Runtime 检查、用户授权或独立验收。获取为空或失败时，沿用明确指令继续，不循环重试，也不为检索结果变化回滚工作流阶段。

若 `<active_policies>` 中包含 `<verification command="...">`，将这些命令加入当前 Verify 的检查，并记录实际结果。只有对应命令成功执行后，Runtime 才会将该策略设为强制执行。

记忆按以下规则保存：

本次确有可复用观察或经验时，按[任务学习收尾](../../comet/reference/task-learning.md)准备学习文件，用 `comet task --complete --learning-file <file>` 一次提交个人观察、项目经验、待评审动作和实际使用反馈。下面的分步保存、评审与完成命令供即时保存、单项纠正及旧版兼容；采用学习文件时无需重复执行。

- 用户明确要求长期记住偏好或项目约定时，调用 `comet memory remember <project-root> --text "<偏好或约定>" --scope global|project --json`，立即保存为用户明确指定的记忆。用户明确限定阶段时追加可重复的 `--phase`，例如 `--phase build --phase verify`；纠正适用阶段使用 `comet memory correct <project-root> --id <id> --phase <phase> --json`。保留用户原话，不把当前阶段自动当作长期适用条件。
- 用户没有提出长期记忆要求，但协作方式已经稳定、可供以后任务复用时，才调用 `comet memory observe <project-root> --text "<协作方式>" --workflow <workflow> --change <change-id> --candidate-key <stable-topic-key> --json`。
- 两者都不得保存任务摘要、实现进展、命令输出或测试结果。

### 项目记忆

项目记忆与个人记忆独立保存。当前项目中已经验证、未来任务仍可复用的事实、决策、模式、步骤、约束或失败处理，任务结束前写入项目记忆：

```text
comet knowledge remember <project-root> --title "<简明标题>" --text "<现象、做法、验证结果>" --type <fact|decision|pattern|procedure|constraint|failure-resolution> --workflow native --change <change-id> --evidence "<来源文件，逗号分隔>" --json
```

同一标题默认更新已有条目，不重复创建；没有可复用经验时跳过。`--evidence` 绑定实际支持结论的项目内文件；没有文件依据的协作决策可省略。返回的 `slug` 是本次写入回执。采用已有经验前，用同一任务参数追加 `--expand-context "project-memory:<slug>"` 展开并核对当前来源；来源变化或不可读取时，先验证并更新经验。任务摘要、一次性命令输出和未验证的猜测不得写入。

只有明确的用户纠正、长期记忆要求或已验证的可复用经验才触发学习提交。没有这些内容时直接记录任务完成，学习标记使用 `not-run`，不另查队列或提交空评审来证明没有观察。已提交内容保留真实回执；待评审和反思队列留给异步维护，学习失败不阻断已完成的开发任务。用户明确要求维护记忆时，再查询和处理相关队列。

观察命令的 JSON `learning.result` 是本次处理结果：`candidate-created` 表示已记录候选，`candidate-promoted` 表示已晋级，`deduplicated` 表示同一 change 重试，`ignored` 或 `skipped` 表示被策略、暂停或安全筛选跳过。若 `status.learning.lastCheck` 显示 `not-run`，说明当前入口没有提交本次学习检查，不能推断为“没有值得学习的内容”。

实际使用某条上下文后，从 JSON 的 `applications[].applicationId`（Hook 文本中的 `application_id`）取得标识。使用结果明确时，运行 `comet task <project-root> --task "<用户原始请求>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json` 记录结果；没有实际使用的条目不能标为成功。

验证、编译或 linter 失败时，按错误信息修复并重跑。任务结束时，调用 `comet task <project-root> --task "<用户原始请求>" --complete --workflow native --change <change-id> --learning-check submitted|no-observation|not-run --project-learning-check submitted|no-observation|not-run [--memory <slug>] --json` 保存任务完成记录。两个检查分别表示个人记忆和项目经验，不能互相替代。命令不可用、没有返回内容或自动检索失败时，继续处理任务。没有 Hook 的平台由本 Skill 调用相同接口；`comet memory context` 只作为兼容入口。

## 用户 Hook 写入

Comet Hook Router 只检查写入目标，不会替换或调用项目自己的其他 Hook。写入项目目录之外的目标会直接放行。用户 Hook 如果在 Shape、Verify 或 Archive 等阶段向项目内的共享目录写文件，应在 `.comet/config.yaml` 配置专用目录：

```yaml
hook:
  allow_paths:
    - .my-hook-output
    - docs/team-notes
```

路径必须是项目相对目录；目录本身及其后代路径都会放行，Native 和 Classic 共用这项配置。即使同时存在多个 active change、还没有当前选择，明确配置的目录也不会要求先选择 change；`.comet/config.yaml` 也属于可写的控制文件。

`.comet/`、Native 的 `native.artifact_root/comet/` 以及 Classic 的工作流产物目录始终由工作流管理，不能通过 `allow_paths` 绕过。一次 Hook 事件包含多个目标时，未配置的目标仍会继续接受阶段检查；建议把用户 Hook 的输出放在独立目录中。

Native 正式产物只能由 `comet native new <name> --json` 登记后创建。Runtime 初始化 brief；Agent 使用响应中的 `artifacts.briefPath`、`artifacts.specsDir` 和其他路径编辑对应文件。拒绝信息会列出原因、错误目标、正确目标和下一动作：直接执行其中的 CLI 命令或修正原目标后重试，不要查询其他目录的同名文件，也不要把自定义 Hook 或普通开发文件强行归为 Comet。

用户明确要求撤销能力关联时，先执行 `comet native status <change> --json`，再使用最新响应中的 `data.stateVersion` 执行 `comet native spec disassociate <change> --expected-state-version <data.stateVersion> --expected-action disassociate-capability`，并按新 continuation 继续。其他关联文件写入意图只查询 status，不猜测为撤销；不要手工删除关联文件。

## 填写命令输入

本节的 Runner 模板只用于 Compat。SDK 领取与回报使用上面的平台 Action 协议及当前响应的 `claimRequest`、`outcomeRequest`，不使用 `--runner-input`。

首次填写 Runtime 模板或通过 `returnAction` 回传结果前必须读取本节。

把 `inputOptions.template` 复制到系统临时 JSON 文件，只替换模板要求填写的内容，然后执行 `continuation.commandArgs` 或所选 `commandAlternative.commandArgs`。Runtime 接受输入后删除临时文件；输入被拒绝时保留原文件，按错误修正后重提。模板中已有的验收轮次、Verifier 尝试次数、状态版本和任务标识都原样保留；只填写模板公开的字段。

`inputOptions` 中同一 `exclusiveGroup` 的选项互斥：选择其中一个，将它的 `template` 作为单个 JSON 对象填入临时文件。字段校验失败时，按 `error.issues` 指出的 JSON 路径、缺失字段和未知字段修正原文件。

Supervisor 子任务只在任务包指定的 `projectRoot` 工作，把填写好的结果交给主 Agent。主 Agent 在 `returnAction` 指定的控制目录，按原命令和模板逐个提交；保留原 `runId`、候选及实际子会话身份，子任务不直接写父级状态。

按 `inputOptions` 模板填写完整后直接正式提交；Runtime 在提交时校验输入，无需先跑预检。`comet native next <change> --runner-input <file> --validate-only --json` 只在提交被拒且需要区分 JSON 结构错误与业务校验错误时使用；该校验不写入工作流状态（comet-state.yaml）或启动检查。正式提交时，仍要使用当前 `continuation` 指定的状态版本、任务标识和命令参数。

### 枚举字段合法值

模板占位符和校验错误都会列出下列字段的全部合法值。每个字段的取值集合只对该字段有效，不能把一个字段的值套用到另一个字段。

| 输入                                  | 字段                           | 合法值                                                                                     |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `builder-handoff`                     | `checks[].result`              | `passed` / `failed` / `not-run`：Builder 实际运行或未运行的开发检查                        |
| `builder-handoff`                     | `acceptance_review[].status`   | `implemented-with-evidence` / `implemented-no-evidence` / `not-implemented` / `known-fail` |
| `builder-handoff`                     | `review.status`                | `passed`                                                                                   |
| `verifier-response`（`final-result`） | `result.verdict`               | `pass` / `fail` / `blocked`：Verifier 总判定                                               |
| `verifier-response`（`final-result`） | `result.acceptance[].result`   | `passed` / `failed` / `blocked`：逐项验收结论                                              |
| `supervisor-verifier-result`          | `verdict`                      | `pass` / `fail` / `blocked`                                                                |
| `supervisor-verifier-result`          | `evidence.acceptance[].result` | `passed` / `failed` / `blocked`                                                            |

逐项结论和 Builder 检查结果用完成时（`passed`、`failed`），总判定用原形（`pass`、`fail`）。`not-run` 只用于 Builder 的开发检查，`blocked` 只用于 Verifier 字段，`pending` 是 Runtime 内部状态值，不出现在任何输入中。

## Builder 交接

仅用于 Compat。SDK 使用 [SDK Builder 交接](#sdk-builder-交接) 及当前 `outcomeRequest`。

提交 `builder-handoff` 前必须读取本节。

普通 change 和 Supervisor 主任务进入 Verify 前，不需要额外安排一次只读复核。如果已有独立复核结果，可以按 Runtime 模板填写可选的 `review.status=passed`、`review.summary`、`review.reviewer_execution_ref`；复核执行标识不能与 Builder 执行标识相同。

Builder 的交接摘要必须写明本轮修改、处理的验收项、实际运行和未运行的开发期检查，以及已知限制。前面的复核不能替代正式 Verifier；正式 Verifier 仍须独立检查全部验收项。

交接前逐项核对当前 brief、完整目标 Spec 和所有已确认验收 ID，按 Runtime 模板填写 `acceptance_review`；每个 ID 恰好一项。`id` 沿用模板，`status` 如实填写，`evidence` 列出具体文件位置、检查记录或可复核的观察，`note` 说明实现如何满足该项。只有全部为 `implemented-with-evidence` 且每项证据非空时才提交。`implemented-no-evidence`、`not-implemented`、`known-fail` 对应尚缺证据、尚未实现和已知失败，先据此补齐剩余工作，不把未完成候选交给 Verifier 试探反馈。修复模板会保留未受影响项的上轮证据，受影响项提示补充本轮证据；提交前核对每项证据仍适用，并更新失效内容。预填内容不是新的检查结果。自查不代表独立验收通过。

按[普通命令与检查](../../comet/reference/platform-execution.md)使用平台工具执行普通命令、核对原任务与副作用、判断结果是否适用，并提交实际报告。Comet 不重复执行检查，不维护普通命令的内容快照、进程监管或恢复机制。 `builder-handoff.checks` 保存实际检查与日志引用，交接不触发命令。

交接摘要保存在 `comet-state.yaml` 中，不会生成单独文件，也不表示验收已经通过。Runtime 会将必要摘要交给 Verifier，Builder 提交一次即可。

完成标准：实现和相关检查已准备好交给 Verifier，全部验收项已重新核对，Runtime 接受交接摘要并进入 Verify。

## Verify 协议

仅用于 Compat。SDK 使用 [SDK Verify 协议](#sdk-verify-协议)，领取回执代替下面的 `startupInput`，不提交旧 Runner 响应。

启动、追加检查或等待 Verifier 前必须读取本节；填写输入遵循[填写命令输入](#填写命令输入)。

### 平台任务与任务包

沿用 `verifierDispatch` 的实际工作区、候选 ID、Verifier 执行引用、验收条目及 brief/Spec 引用；正文缺失时按分页读取全部 `scopeIds`。通过平台启动所需的只读任务，以真实会话提交 `verifier-started`；该回报只登记业务任务，不启动或监管进程。平台接受后持续等待同一任务，工具等待超时不代表执行失败。按[普通命令与检查](../../comet/reference/platform-execution.md)使用平台工具执行普通命令、核对原任务与副作用、判断结果是否适用，并提交实际报告。Comet 不重复执行检查，不维护普通命令的内容快照、进程监管或恢复机制。

### 独立验收与结果

Verifier 全程只读，先提交任务包的 `startupInput`（`verifier-started`，重复无副作用）。读取当前 scope 的全部验收文字、brief、完整目标 Spec、实现和实际检查报告，核对版本、工作区、输入及覆盖范围。使用平台工具补充必要检查；独立判断 `scopeIds` 中每项。

Verifier 最后再阅读 Builder 交接，将其作为调查线索。Builder 只提供本轮实现的位置、验收项的编号与引用、检查记录位置、已知限制和相关文件位置；日志正文按需读取。

等待工具超时后，继续等待同一个 Verifier。只有平台确认执行失败、执行超时、任务丢失或结束后没有可用结果时，才登记执行错误并重试。

通过 `verifier-response` 提交结果时，响应只列出当前 `scopeIds`，每项恰好标记一次为 `passed`、`failed` 或 `blocked`；后两种情况写明原因。已通过且仍报告通过的合法超集会由 Runtime 过滤；不存在或重复的 ID、缺少当前 scope，以及 scope 外的 `failed` 或 `blocked` 仍会被拒绝。

结果或检查请求因字段、格式或验收范围被拒绝时，按错误修正原输入，并使用返回的当前 `continuation` 重提；仍在运行的 Verifier 继续使用，不登记 `verifier-execution-error` 或重新派发。候选或执行绑定不匹配时先核对派发身份，旧任务的结果不能改成新任务身份后重提。实际检查执行失败、平台任务失败等情况，仍按对应失败路径处理。

提交修复后的实现时，保留仍然适用的实际检查报告，并让新的正式 Verifier 在一轮内检查全部验收场景。全部通过后，直接等待用户接受验收结果；不会自动清空结果，再追加一轮相同的完整验收。

Verifier 无法完成任务时，区分以下情况：

- 平台支持 subagent，但本次任务未启动、执行失败、超时或结束后没有返回时，报告 `verifier-execution-error`。
- 只有当前平台确实没有可用的 subagent 能力时，才报告 `verifier-unavailable`。
- Runtime 因 Verifier 不可用而等待用户决定时，用户要求重试就执行 `commandAlternatives` 中的 `retry-verifier`。只有用户明确接受未经过独立验收的结果，才执行 `confirm-verifier-unavailable`。重试会保留本轮代码和已完成检查，不要要求用户恢复文件、服务、进程或回调。

无法启动 Verifier、执行报错、缺少外部信息，或需要用户决定是否接受不完整验收时，必须先读取[命令输入与异常](#命令输入与异常)，再按最新 `continuation` 处理。

由 Skill 启动的最终 Verifier 判定通过、Runtime 等待用户决定时，只有用户接受当前结果，才使用 `--accept-result` 进入 Archive。用户要求修改实现或验收标准时，分别使用 `--revise-implementation` 或 `--revise-requirements`。

### 中断检查

按[普通命令与检查](../../comet/reference/platform-execution.md)使用平台工具执行普通命令、核对原任务与副作用、判断结果是否适用，并提交实际报告。Comet 不重复执行检查，不维护普通命令的内容快照、进程监管或恢复机制。 旧 `retry-checks` 不再执行命令。失败、超时、未执行和未知结果不能算通过。完成标准是 Runtime 已接受完整结果，返回实际的 Build、Archive、等待、阻塞或完成状态。

## Supervisor 协作

仅用于 Compat 的 `childSummary`、`readyChildren` 和 Runner 任务包。SDK 的 Child、集成与恢复使用 [SDK Run](#sdk-run) 的 Action 协议。

分配任务、接收结果或集成前必须读取本节；首次填写输入或执行 `returnAction` 前必须读取[填写命令输入](#填写命令输入)。

### 分配任务与核对任务标识

用户确认一次 Supervisor Change 的 Shape，就授权执行已确认范围内的全部子任务，不要求用户重复确认相同范围。Skill 只执行 Runtime 在 `continuation` 中返回的动作，每个任务完成后重新读取 `readyChildren`。每个子任务都必须经过 `active → verified → integrated`；验证未通过、Verifier 失联登记失败、或 Agent 明确将已有候选退回重验时进入 `needs-reverify`，Runtime 会在下一次 `next` 自动为它重派 Verifier，`childSummary` 里计入 blocked。最后，Supervisor 主任务仍要在集成 worktree 检查全部验收项。

处理 `childSummary` 时，不要运行 Supervisor Change Builder，只处理 `readyChildren` 列出的当前可执行子任务和 Supervisor 统筹动作。存在在途任务时，`readyChildren` 列出的是在途任务本身；容量未满且还有未派发子任务时，下一次 `next` 会在任务完成后自动派发。需要某个子任务的完整状态时再读取详情。

Runtime 为每个子任务返回 worktree、集成分支的当前提交、角色、任务包和 `runId`。Builder 与 Verifier 返回结果时必须携带当前 `runId`；Runtime 会拒绝重复提交或已经失效的任务结果。子任务检查中断时先核对原平台任务和副作用，再判断需补跑的检查。

子任务不单独执行 Archive；原先通过 `finish=merge` 完成的合入步骤现由 Runtime 负责。只有经过 `active → verified → integrated`，且所选集成检查通过，才算完成集成。执行任务的 Agent 声称完成，或 worktree 中仍有未提交修改，都不能证明已经集成。

选择多会话协作时，当前会话只负责分配任务、检查进度、处理阻塞、集成和 Supervisor 主任务的最终 Verify，不直接实现子任务。需要修改文件的子任务，只能使用 Runtime 为它创建的 worktree。不得为同一子任务另建 worktree，也不得写入 Supervisor 主任务或其他子任务的 worktree。

分配任务时必须说明子任务角色、任务包、worktree、基线提交、`runId`、验收项的编号与引用、依赖关系和停止条件，并明确结果返回主 Agent，由主 Agent 顺序提交。主 Agent 使用实际接收者的会话身份领取，保留原 Action、领取身份和结果模板；子任务只写自己的 worktree，不直接推进父 Run。只启动 `readyChildren` 中列出的任务；不得让独立会话中的 Agent 或团队成员自行领取尚未满足启动条件的子任务。执行期间持续查看各会话的进度。发现实现偏离需求、权限或环境阻塞、需求范围不明确，或出现会改变用户可见结果的新决定时，立即反馈并处理，不等全部任务结束后再检查。

- 等待外部输入时，必须读取恢复参考中的[等待外部输入与监控](recovery.md#等待外部输入与监控)：停止回复消息不等于暂停监控。只保留仍有任务可推进或外部状态需检查的监控，并及时告知用户阻塞原因和恢复条件。
- 在 Codex 中，如果可以管理用户可见的独立会话，就为每个当前可执行子任务新建一个独立会话，不要只启动当前会话内的 subagent。创建会话时沿用现有项目，不要让 Codex 另外创建 worktree；新会话必须先进入 Runtime 为该子任务创建的 worktree，后续所有文件和 Git 操作只在该目录执行。当前会话保存会话信息，通过等待或读取会话检查进度，并在需要修正或补充信息时发送后续指令。
- 在 Claude Code 中，如果可以使用 Claude Code Agent Team 且当前为交互式会话，就创建一个 Claude Code Agent Team。当前会话负责统筹，每个当前可执行子任务分配给一个有明确名称的团队成员。团队成员进入 Runtime 为该子任务创建的 worktree；团队任务列表只加入 Runtime 已允许开始的子任务。子任务是否可以开始、是否已经完成，最终以 Runtime 为准。团队成员不得创建新的 Claude Code Agent Team、直接集成父分支或自行扩大范围；当前会话持续读取消息和任务状态并及时引导。
- 如果 Codex 独立会话或 Claude Code Agent Team 不可用，或者恢复后已经找不到原来的会话或团队，先重新读取 Runtime 状态并说明原因，然后在 `multi-session` 下改用 subagent，不再询问推进方式。尚未分配的任务直接按最新 `readyChildren` 创建任务包。已分配任务的会话丢失时，先运行 `next --summary` 取得全部在途任务的完整任务包（含 `runId`、worktree 和基线提交），再通过原平台核对原执行及其后代是否已停止；会话不可访问和迟到结果被拒收都不能证明执行已停止。只有平台确认原执行及其后代已停止后，才用当前 `runId` 提交 `supervisor-cancel`，按最新 `continuation` 取得新任务包和新 `runId`，交给 subagent 执行。无法确认停止时，保留原 `runId` 和 worktree，报告阻塞原因及所需停止证据，等待核对；不得取消或重新派发，也不得继续修改该 worktree。subagent 也不可用时，如实报告任务无法执行的原因；不得自动改为单会话推进。

### Supervisor 主任务最终验收

全部子任务都进入 `integrated` 后，立即按 Runtime 返回的 `parentAdvance` 继续，并通知用户 Supervisor Change 进入最终 Verify，不要求用户再次说“推进”。最终 Verify 在集成 worktree 检查全部验收项。

验收失败后，Agent 根据实际失败选择修复安排，父级可以修复其集成范围，也可追加名称唯一、引用有效验收 ID 的修复子任务。保留失败记录和预算，不重新打开已归档或 integrated 的子任务。需要修改计划时显式执行返回的 --revise-requirements，展示完整方案并确认；文件编辑不会自动退回 Shape。

最终交付前不修改目标分支。最终 Archive、工作区收尾、merge、push 和 PR 各自仍须遵守用户的授权。

### 子任务验收与集成

Builder 与 Verifier 沿用原任务的 `child`、`runId`、候选和实际 worktree，提交实际实现、检查及逐项验收报告。`supervisor-verifier-result` 的 `verdict` 为 `pass`、`fail` 或 `blocked`；`evidence` 保存真实摘要、检查和每项 `{id,result,reason}`。每个验收 ID 恰好出现一次，总结论与逐项结论一致，不提交普通检查 `receiptRef` 或内容快照。

SDK 的 Git 集成沿当前 Action 继续；Compat 由 Agent 在指定集成 worktree 通过平台工具完成合并与必要检查，再按 `supervisor-integrate` 模板提交实际 `integrationCommit` 和报告。没有实际提交时只返回平台操作指引，不执行检查或声称集成成功。冲突保留原现场，不在父分支或其他子任务工作区处理。集成后父级仍覆盖全部验收项。

## 命令输入与异常

SDK 按 [SDK Run](#sdk-run) 与当前 continuation 核对同一 Action、领取和结果；以下 Runner 模板、`verifier-unavailable` 及 `--finish` 选项只用于 Compat，不能用于 SDK 恢复。

正常流程直接执行 Runtime 在 `continuation` 中给出的命令。恢复时未提交动作输入的 `next --summary` 会返回当前模板并保留阶段，直接填写该模板继续，无需再查询一次 status。本节解释返回字段，并说明如何处理以下情况：命令输入被拒绝、无法启动 Verifier、Verifier 任务执行出错、Verifier 因缺少外部信息无法判断，或 Runtime 要求用户决定是否接受未完成独立验收的结果。`continuation.disposition` 说明现在应继续、等待用户、处理阻塞还是结束。只有用户明确确认后，才执行含 `--confirmed` 的后续命令。CLI 文本先给出用户可读的 `summary`、唯一 `NEXT:` 和可选的 `RELAY TO USER:`；用 `--json` 读取结构化响应，`--verbose` 仅用于排查本机执行状态。

命令签名和当前参数始终以 CLI 为准：

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

### Runtime 返回的下一步

- `disposition`：说明现在应该继续、等待用户、处理阻塞还是结束；`requiresUserDecision` 为 true 时转述消息并等待决定；`userCommunication.required` 也可能只是要求通知恢复进展，此时按已有授权继续；
- `commandArgs` / `commandAlternatives`：Runtime 要求执行的完整命令参数；每个备选操作对应一个互斥的用户决定，选择匹配项执行，不要合并多个备选操作；
- `inputOptions`：这次命令需要填写的字段和 JSON 模板；
- `workspace` / `preparation`：实际工作目录和 change 创建结果；
- `stateVersion` / `loop`：当前状态版本和验收循环进度；
- `acceptance` / `childSummary` / `readyChildren` / `supervisor` / `details.nextPageArgs`：验收计数、Supervisor Change 的子任务计数、当前可执行子任务、集成分支与当前任务包摘要，以及详情下一页命令；
- `verifierDispatch`：启动独立 Verifier 所需的工作区与证据位置、当前 `scopeIds`、`scopeCount`、全部验收项数量、正文引用、详情分页参数、复核摘要和检查结果；如果存在 `recoveryContext`，也要把它作为最近一次恢复或用户补充的信息直接传给 Verifier；
- `workspaceFinishResult` / `recoveryArgs`：归档后的工作区收尾结果和恢复命令。

Archive-ready 时执行最新 continuation。使用隔离工作区、且尚未选择收尾方式（finish）时，等待用户选择，然后执行对应的 `--confirmed --finish` 完整备选命令，保留状态版本参数；Runtime 记录选择并完成预检和事务内复验。用户在接受结果时已选择 finish 的，沿用该选择，不再询问。需要预览自定义提交说明时可先 dry-run；不要自行补其他参数。dry-run 会同时检查归档内容和 Git 收尾涉及的分支及文件；`ready: false` 时在同一响应中处理 `blockers` 和 `workspaceFinishBlockers[].paths` 的完整路径清单，不要额外运行 `status` 或手工提交 change 的状态/verification 文件。只有 `ready: true` 才执行返回的唯一 `archive --confirmed` 命令。

模板中的尖括号表示需要填写的值。`await-user` 表示先等待用户决定，此时不执行推进命令。若 `commandArgs` 为 `null` 且返回了 `commandAlternatives`，先确认用户决定，再执行对应备选操作的完整 `commandArgs`，保留其中的 `--expected-state-version` 和 `--expected-action`。命令因状态过期或动作不匹配失败时，重新读取最新 `continuation`，按当前状态继续；不要自行拼接缺少状态校验参数的命令。平台任务是否仍在运行须通过原平台核对，不能仅凭本地文件缺失判断。

### 异常动作输入

- `verifier-execution-error` / `verifier-unavailable`：平台支持 subagent，但本次任务未启动、执行失败、超时或结束后没有返回时使用前者；只有当前平台确实没有可用的 subagent 能力时才使用后者。模板中的任务关联字段必须原样保留，避免旧任务的迟到消息影响新的 Verifier。
- `retry-verifier` / `confirm-verifier-unavailable`：Runtime 在 Verifier 不可用状态返回这两个 `commandAlternatives`。用户要求重试时选择前者，本轮代码和已完成检查会保留；只有用户明确接受“仅完成自动检查、没有独立验收”的结果时，才选择后者。

### 异常情况

- 无法启动独立 Verifier：先确认适用检查已经列明，且 Runtime 检查全部通过；随后按模板报告 unavailable，等待用户决定是否接受“只有命令检查通过、没有 Verifier 独立核验需求”的结果。
- Verifier 暂时无法判断（`semantic blocked`）：如果只缺用户或外部信息，执行 Runtime 返回的解决动作；如果需要修改实现，回到 Build。
- 由 Skill 启动的 Verifier 判断全部通过（`skill-coordinated pass`）：这表示检查已经完成，但系统无法确认验证者是否独立；Runtime 会显示“已完成检查，但需要你确认验证结果”，用户确认后再执行返回的命令。
- 如果显示“无法完成完整验证，只完成了自动检查”，表示没有 Verifier 独立核验需求，只有 Runtime 自动检查结果；只有用户明确确认后才能继续归档。
- 用户确认接受这种不完整结果后，显示“你已确认接受不完整验证结果”；这只表示用户接受了不完整的验收结果，不能据此宣称已经完成独立验证。
- Verifier 任务执行出错（`execution error`）：按模板提交错误，再读取新的 `continuation`。Agent 根据当前候选和实际检查结果判断复用或重试。

### 诊断

正式项目规格必须通过当前 change 的完整目标规格和 Archive 更新，不能直接修改已发布的规格。

只修正已确认目标规格中的本地 Markdown 链接目标时，可以执行 `spec sync`：

- 输入包含 `expectedStateVersion`、`actor`、`reason`、`affectedAcceptanceIds` 和 `replacements: [{from, to}]`。
- `affectedAcceptanceIds` 须包含受影响 Spec 的全部验收项。正文、示例或验收含义发生变化时，仍须回到 Shape。
- Runtime 保存修改前后的内容及原因，保留未受影响的验收结论，并回 Build 重新验证受影响内容。
- 同步中进程突然中断、状态尚未保存时，恢复流程会发现规格与已保存状态不一致，并回到 Shape；尚未保存的修正不能当作已确认结果。

Verifier 失联时，使用普通 `next --summary` 恢复。Runtime 返回恢复指引（await-user），不会自动转换状态；按指引登记 `verifier-execution-error` 后，Runtime 才把中断的任务转为可重新验收的状态。不要无限等待旧 Verifier 任务，也不要反复重跑 `next`。

在原 worktree 使用返回的明确目录读取状态，不自动搜索其他 worktree。当前工作区出现 active 与 archive 记录冲突时，按只读诊断和明确恢复入口处理；不能仅凭名称相同或版本号更大就认定任务完成。

先运行只读 `doctor`。只有 `doctor` 明确给出修复命令时才执行；Runtime 维护跨设备业务状态和实际文件事务，普通流程不恢复锁。

Agent 根据当前候选和环境判断原检查结果是否适用，保留真实执行来源，只补缺失或失效的检查。按当前结果模板提交报告，不提交旧检查计划、文件指纹或 edit-review 记录。
