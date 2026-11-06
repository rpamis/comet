---
name: comet-native
description: 'Comet Native 工作流。当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用。'
---

# Comet Native

Native 在项目中保存需求和验收结论。先确认 change 的运行格式，再执行当前动作。

旧 SDK Action 继续使用响应中的 `claimRequest` 模板领取，保留原 Run 和执行身份。

## 必须遵守的规则

- 已确认范围内的实现、文档修复、证据复用和恢复连续推进；只在需要新决定、授权或外部信息时暂停。使用最新 continuation 的命令、模板和任务包，修正输入后沿用当前任务。
- SDK 的推进以 Runtime Run 为准，当前 change 的 `comet-state.yaml` 用于边界恢复；旧 Runtime 继续使用其状态文件。读取实际配置和正式文件，聊天记忆只作辅助。Agent 只编辑 brief、完整目标 Spec、关联时的 `delta.yaml` 和 `children.yaml`；状态、检查结果、报告和事务由 Runtime 管理。
- 通过 PATH 中公开的 `comet native` 命令推进，用户不手工执行命令。命令不可用时报告安装不完整并停止；参数以 `comet native <command> --help` 为准。
- 新建 change 走 CLI 并使用响应路径；拒绝后按信息中的命令或目标修正并重试；自定义 Hook、非 Comet 工作和普通同名文件保持中立。
- Builder 提交本轮待验收的代码和相关文件，称为“候选实现”。Verify 覆盖全部验收项，复用仍与当前候选匹配的检查，只补缺失或失效证据。当前 Action 的 `sessionRequirements.independent` 为 `false` 时，由当前 Agent 根据不确定性和用户要求决定是否另请只读 Verifier；为 `true` 时使用独立会话。失败、阻塞、未执行和超时不能算通过。
- 只有用户明确确认完整 Shape、接受最终结果或选择相应交付方式后，才执行对应的确认命令。沿用已确认的需求范围和 Runtime 保存的用户选择。归档、merge、push、PR 和工作区清理各自需要的授权不能互相代替。
- Native 主流程由本 Skill 和 Runtime 完成，不依赖外部 Skill；不改变已确认的需求和约束时，实现方法由 Agent 自行选择。

## 开始或恢复

首次开始任务或更换 Agent 平台时，核对公开 CLI 和结果回报能力。当前 Action 要求独立会话时，再读取[平台能力核对](../comet/reference/host-check.md)并安排执行者。

1. 当前响应已包含工作区、任务和下一步时直接继续。缺少这些信息时，已知名称运行 `comet native select <change-name> --json`，否则运行 `comet native status --json`。active change 已存在时进入 `workspace.projectRoot`；工作区有歧义时才让用户选择。Run 记录丢失时读取[故障恢复](reference/recovery.md#故障恢复)。
2. 没有对应 active change 时，按[工作区选择参考](reference/workspace.md#创建-change)确定隔离方式，运行 `native new`，用 `--task` 传入用户原始请求，不先改写成方案摘要，再进入 `preparation.projectRoot`。准备失败时，保留已创建的分支和目录，按返回的原因处理。
3. 进入工作区并取得 `phase` 后，按[记忆接入](reference/commands.md#记忆接入)获取适用上下文。进入新阶段、交接给新 Agent 或恢复上下文时，由接收方执行 `contextRequest`，重新取得当前适用偏好和项目约束；同一阶段连续执行无需重复获取。任务结束时按该节分别处理项目记忆和个人记忆，再调用 `comet task --complete`。

仅在出现明确的用户纠正、长期记忆要求或已验证的可复用经验时提交学习内容。普通收尾无需调用工具证明没有观察，也无需清空学习队列。任务摘要、进展、命令输出和测试结果不写入个人记忆。

项目经验与个人偏好分开保存：可由当前项目验证、且未来任务仍可复用的经验在任务结束前执行 `comet knowledge remember` 写入项目记忆；用户偏好和稳定协作习惯才进入个人记忆。两者的命令和完成条件见[记忆接入](reference/commands.md#记忆接入)。

## SDK Run 路径

Shape 已明确确认并进入 Build 后，新建普通 SDK 任务使用 `native next <change> --session <真实会话标识> --json` 领取当前任务。响应 `comet.native.task-result.v1` 给出阶段、完整验收正文、结果模板和一个下一步，直接照此执行。

1. Builder 完成实现后，将 `resultTemplate` 的实际业务结果写入临时 UTF-8 JSON，用返回的 `next.commandArgs` 提交。保留命令中的 `--action` 和真实 `--session`。Runtime 连续运行必要检查；当前会话继续验收时使用 `--review current-session`，另请审查者时使用 `--review independent`，由接收者以自己的真实会话领取。
2. Verify 覆盖全部验收项，复用有效检查，只补缺失证据；提交实际结论后，Runtime 返回用户接受结果的步骤。用户明确要求独立审查时必须选择独立会话。
3. 只有用户事前明确委托“验收通过后接受并归档”时，才在本次 Verify 回报中加 `--accept-on-pass <用户授权摘要>`。该摘要绑定本次通过结果。其他情况等待用户接受，再执行返回的确认命令。Git 交付仍使用已有的对应授权。

普通任务无需读取底层协议。当前响应为旧 `comet.native.sdk-status.v1`、`comet.native.dispatch-result.v1`、`comet.native.run-view.v1`，且高层入口不适用，或任务属于 Supervisor、固定应用时，读取[SDK Run 命令与恢复](reference/commands.md#sdk-run)。完整协议需要时用 `--details`，不额外查询 status 来识别已有响应。

两种 Runtime 均使用最新 `continuation`；`--runner-input` 和旧 Archive 输入仅用于旧 Runtime。SDK 路径遵守用户确认、当前 Action 的验收要求和工作区授权。旧 change 不自动迁移。

## 按需读取

只读取当前动作对应的章节。章节中的链接写明了适用条件，满足条件时再读取链接内容；不一次加载整份命令参考或所有参考。

- Shape：必须读取并执行[澄清](reference/clarification.md#澄清)，按项目配置选择 Sequential 或 Batch 的提问步骤。大型需求在最终确认前，必须按该节链接读取 Supervisor 拆分与确认要求。
- 编辑 brief/Spec/`children.yaml` 或核对验收报告前，必须读取[正式产物](reference/artifacts.md#正式产物)。文件、附件、链接或本地路径作为需求来源时，必须进入[源文档完整覆盖模式](reference/artifacts.md#源文档完整覆盖)；仅用于排错、取证、审查或实现参考的材料不自动触发。
- 高层任务响应缺少所需字段，或使用旧 SDK、固定应用时，读取[平台 Action 协议](reference/commands.md#sdk-action-领取与回报)、[SDK Builder 交接](reference/commands.md#sdk-builder-交接)或[SDK Verify 协议](reference/commands.md#sdk-verify-协议)中当前需要的章节。
- Compat 首次填写 Runner 模板或通过 `returnAction` 回传前，读取[填写命令输入](reference/commands.md#填写命令输入)，再按阶段读取[Builder 交接](reference/commands.md#builder-交接)或[Verify 协议](reference/commands.md#verify-协议)。
- 状态包含 `childSummary` 时，必须在分配任务、接收结果或集成前读取[Supervisor 协作](reference/commands.md#supervisor-协作)，只处理 `readyChildren` 列出的子任务和 Supervisor 统筹动作。
- 字段含义不清、命令输入被拒绝、Verifier 不可用、执行错误或缺少外部信息：读取[命令输入与异常](reference/commands.md#命令输入与异常)。正常动作直接使用 Runtime 返回的命令和模板。
- 等待外部输入时，按恢复参考中的[等待外部输入与监控](reference/recovery.md#等待外部输入与监控)处理；独立工作继续。进程中断、换设备、连续无进展、并发冲突、迁移失败或状态损坏时，读取[故障恢复](reference/recovery.md#故障恢复)。

## Shape

Agent 先调查能够查明的事实，只询问会改变用户可见结果、又无法可靠推断的决定。简单问题列出未决项及其依赖关系；多个决定相互影响时才建立决策树。按 `native.clarification_mode` 提问前，先把本轮尚未解决的问题写入 brief。用户确认的结论立即同步到 brief 的相关章节和完整目标规格；未明确回答的部分保持 `[blocking]`。

把用户明确指定的文件位置、必需章节和产物格式写入 brief 的约束，按原要求准备这些内容；不能因模板默认位置而改放其他文件。交接和恢复时以这些已确认约束核对产物，不能只保留业务示例。

写完 Shape 后，回到原始请求和公开项目资料核对目标、验收项与非目标。把实现必需的行为列为非目标前，先说明它会怎样改变用户要求；有多种解释时，写清依据和影响，不把自行选择的解释当作用户已确认的要求。固定评估任务中的模拟批准不能修改原题。

完成标准：需求来源已在用户指定的覆盖边界内完整处理并按用途分类，所有影响结果的决定和假设已处理，没有 `[blocking]`，用户明确确认目标、范围、关键决定、全部验收项和非目标，并且 Runtime 已进入 Build。

新建需求或重新确认 Shape 时，brief 只要求目标、范围、非目标和验收示例四个核心章节；有约束、关键决定、待解决问题或特殊验证要求时再补对应章节。Runtime 同时检查完整目标 Spec 或明确的无产品行为变更理由及正式路径。失败会给出文件和修复动作；补齐后重跑 continuation。后续阶段的旧需求保留进度，回到 Shape 时再检查。

Build、Verify 或待归档阶段出现实际文件变化，或 continuation 指向内容判断时，必须先读取并执行[编辑后续行](reference/edit-review.md)，再处理阶段动作或修订命令。由当前 Agent 合并判断实际变化，只补受影响证据，沿用原 Run 和仍有效的批准。修订命令不构成用户授权；缺授权时保留原阶段与已接受结果，只请求相关决定。

## Build ↔ Verify Loop

Builder 提交候选实现后，由 Runtime 执行检查，再由实际领取 Verify Action 的 Agent 完成验收。未通过则回 Build 修复并重新提交；全部通过后，等待用户接受验收结果。

Verifier 先读原始请求，再对照 Spec 和实现，核对有无遗漏、未经授权的范围缩减或接口行为变化。SDK Run 使用同一份验收结果中的 `requestReview` 说明结论；有冲突或仍影响交付的疑问时，保留 fail 或 blocked。旧 Run 和 Compat 没有保存原始请求时，从交接材料和用户记录补查，不把新生成的 Spec 当成唯一需求来源；Compat 沿用原结果结构。语义核对沿用当前 Verifier，不增加 Agent 或固定测试轮次。

`iteration` 表示提交实现的轮次，`attempt` 表示对同一份候选实现启动 Verifier 的次数。所有计数都由 Runtime 更新。连续验收失败或没有进展的次数达到配置上限时，按最新指令等待用户决定或处理阻塞。

## Build

首次实现前，读取当前 brief、完整目标规格和全部验收项，在已确认的需求范围内修改项目代码和测试。修复时优先处理 Verifier 指出的未通过项、无法验证的原因和失败检查；提交前仍要核对其他已确认行为。`previous_unresolved_ids` 只提示本轮修复重点，下一次正式验收仍覆盖全部验收项。

Build、Verify 和 Archive 会复查正式文件与已批准原文的绑定。出现变化时由当前 Agent 判断语义和影响；契约未变则保留批准，目标、验收标准或授权发生实质变化时才请求相关决定。Hook 编辑后在下一次实现写入或推进前核对实际内容，Hook 未触发也会核对。旧 Shape 沿用原绑定；文档或报告失效时保留工作，只处理具体缺项。普通文档默认不作废候选，可用 `native.document_writes: revert` 保留严格行为；路径范围见[正式产物](reference/artifacts.md#正式产物)。

用户 Hook 的共享输出目录可通过 `.comet/config.yaml` 的 `hook.allow_paths` 放行；该配置对 Native 和 Classic 共用，工作流产物目录不在白名单范围。详见[用户 Hook 写入](reference/commands.md#用户-hook-写入)。

需求变化时，先判断变化属于哪种情况，再执行当前 `continuation` 允许的动作：

- 已确认的功能有实现遗漏：从 Verify 使用 `--revise-implementation`，保留已确认的需求范围，回 Build 修改。
- 用户可见行为或验收标准发生变化：从 Verify 或 Archive-ready 使用 `--revise-requirements`，更新正式文件，按[需求变化后的重新确认](reference/clarification.md#需求变化后的重新确认)先说明变化与影响，再展示完整当前 Shape 并重新确认。
- 与当前需求无关：交给另一个 change。

用户明确补充当前范围时，按同一规则处理。

用户确认一次 Supervisor Shape，就授权执行该范围内的全部子任务。按 Runtime 的指令分配和集成子任务，随后自动进行 Supervisor 主任务的最终验收，覆盖全部验收项。按[Supervisor 协作](reference/commands.md#supervisor-协作)区分统筹、Builder 和 Verifier 的职责；只有 Runtime 接受了子任务的验收结果并确认集成成功，才算完成。

提交候选前，按 brief 中登记的原位置检查文件、章节和格式，补齐遗漏产物；可自动检查的要求列入本轮 Runtime 检查计划，检查实际内容，不能只检查另一个文件中存在同类内容。修改已批准正式内容时沿用现有修订和确认流程。

完成标准：实现和相关检查可供验收，Runtime 接受 Builder 交接并进入 Verify。

## Verify

新 SDK 普通任务按当前 `task` 和 `resultTemplate` 完成验收；Builder 回报已包含内部检查与领取时，直接继续本次任务。旧 SDK 按 [SDK Verify 协议](reference/commands.md#sdk-verify-协议) 与 `sessionRequirements.independent` 领取，优先使用 `resultRequest`，缺少时使用 `outcomeRequest`。所有执行者使用真实会话身份。

Compat 按 [Verify 协议](reference/commands.md#verify-协议) 立即启动新的只读 Verifier，原样传递任务包。派发只代表登记：平台接受启动调用、且 Verifier 回报 `verifier-started` 后，才说明它已运行；启动失败立即按异常流程处理。任务包含验收正文时直接使用，否则按分页读取全部 scopeIds。

Verifier 独立判断全部验收项，同时核对 brief 中登记的产物位置、必需章节和格式，不能用另一文件中的同类内容代替；缺项或错位时报告实际差异，不能给当前候选通过结论。复用与当前实现、工作区和输入匹配的 Runtime 检查，只补缺失或失效证据；文件和日志正文按需读取。等待工具超时后，继续等待同一个 Verifier。只有平台确认执行失败、超时、任务丢失或结束后无结果时才登记错误。Runtime 接受完整结果后按最新状态继续。

用户明确接受当前结果后执行 `--accept-result`。用户事前明确委托通过后接受并归档时，按上文使用带授权摘要的 `--accept-on-pass`；fail、blocked 和执行失败均不能触发接受。Compat 的接受与交付方式仍按当前备选命令处理。

完成标准：Runtime 接受每项验收结论并给出下一步；返回 Build 就继续修复，返回等待或阻塞就处理对应条件，不把阶段结束当任务完成。

## Archive

SDK 接受结果后由 Runtime 连续完成归档。响应已说明归档完成时直接核对用户授权的 Git 交付；返回 Archive 命令时执行该命令。只有 Compat 收尾、工作区交付选择或具体恢复要求不清时，才读取[Archive 收尾](reference/workspace.md#archive-收尾)。只处理当前响应列出的阻塞。

只提交本 change 的实现和正式产物，保留无关修改。Compat 检查 `workspaceFinishResult`，阻塞时按 `recoveryArgs` 保留现场并恢复；SDK 以 Run 与实际 Git 结果分别核对归档和交付。已有授权足以处理的提交说明和本地阻塞由 Agent 修复后继续，不要求用户再次说“重试”；需要新增授权或外部信息时才询问。

完成标准：状态为 `done`；SDK Run 为 `completed` 且用户授权的 Git 交付已实际完成并核对，Compat 工作区收尾为 `completed` 或 `kept`；随后按记忆接入协议记录任务完成。其他结果继续处理。

## 后续指令

响应带有 `continuation.mode` 时，以它决定当前动作：`execute` 使用返回的完整参数、输入模板和任务包；`wait` 等待原任务；`ask` 展示当前提案并等待用户决定；`reconcile` 按返回证据核对原执行或处理阻塞；`done` 核对本次完成或取消的条件后结束。`commandArgs` 中的占位值必须按 `requiredInputs` 和输入模板填写，不能把模板当成已经完成的输入或用户批准。`inputRef` 指向同一响应内的完整输入，直接读取，不另查状态。每次写入后只使用新响应的身份、版本和工作目录；需要详情时执行同一响应给出的读取命令，不为寻找下一步再查询。

旧响应没有 `mode` 时，按原 `disposition` 继续：

- `continue`：在返回的工作目录执行完整 `commandArgs`，按 `inputOptions` 模板填写输入。
- `await-user`：先转述 `userCommunication.message` 和 `suggestedReply`，等待列出的决定；按用户选择执行 `commandAlternatives`，保留 `--expected-state-version` 和 `--expected-action`。过期时读取最新状态，不自行拼接无保护命令。
- `blocked`：处理列出的阻塞或恢复动作；仅暂停依赖该条件的工作。
- `done`：核对 Archive 完成标准后结束。

命令成功且响应包含 `agent` 时，直接复用共用 workflow guard 的轻量所有权读取结果和 `continuation` 继续。只在字段缺失、命令因版本或所有权被拒绝，或需要额外正文时读取详情；新会话或上下文压缩恢复缺少响应状态、仓库/分支/change 切换或有明确外部变化迹象时，才重新查询 `status`。不因等待工具超时重复派发已有的 Verifier 或子任务。

当前动作需要验收文字、交接摘要或历史详情时，才加 `--details`，并按 `nextPageArgs` 读取 `scopeIds` 涉及的全部页面。需要正式文件的正文时，才运行 `show`。阅读 CLI 文本时，先看 `summary`、唯一的 `NEXT:` 和可选转述消息；程序解析使用 `--json`，排查本机执行状态时才用 `--verbose`。

## 可选变更说明

Native 仅在用户要求可视化变更说明时生成 `walkthrough.html`。项目 `change_walkthrough` 默认开启，显式 `false` 时跳过；允许生成且用户需要时读取[变更说明](../comet/reference/change-walkthrough.md)，复用已有差异和结果，生成或更新同一页面并给出链接。普通收尾直接提供简短摘要。Archive 保存已有页面并提供实际归档链接，不补生成、不新增确认、不为页面更新重跑代码检查。
