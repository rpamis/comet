---
name: comet-native
description: 'Comet Native 工作流。当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用。'
---

# Comet Native

Native 在项目中保存需求和验收结论。先确认 change 的运行格式，再执行当前动作。

## 必须遵守的规则

- 已确认范围内的实现、文档修复、证据复用和恢复连续推进；只在需要新决定、授权或外部信息时暂停。使用最新 continuation 的命令、模板和任务包，修正输入后沿用当前任务。
- 以磁盘上的 `.comet/config.yaml`、当前 change 的 `comet-state.yaml`、Runtime 返回的进度，以及正式文件为准，聊天记忆只作辅助。工作流保存的正式文件中，Agent 只编辑 brief、完整目标 Spec、关联时的 `delta.yaml` 和 `children.yaml`；状态、检查结果、报告、锁和事务由 Runtime 管理。
- 通过 PATH 中公开的 `comet native` 命令推进，用户不手工执行命令。命令不可用时报告安装不完整并停止；参数以 `comet native <command> --help` 为准。
- 新建 change 走 CLI 并使用响应路径；拒绝后按信息中的命令或目标修正并重试；自定义 Hook、非 Comet 工作和普通同名文件保持中立。
- Builder 提交本轮待验收的代码和相关文件，称为“候选实现”。每轮都由新的只读 Verifier 独立判断全部验收项。判断全部验收项不等于重跑全部命令：仍与当前候选实现匹配的 Runtime 检查记录可以复用，只补充缺失或失效的检查。失败、阻塞、未执行和超时不能算通过。
- 只有用户明确确认完整 Shape、接受最终结果或选择相应交付方式后，才执行对应的确认命令。沿用已确认的需求范围和 Runtime 保存的用户选择。归档、merge、push、PR 和工作区清理各自需要的授权不能互相代替。
- Native 主流程由本 Skill 和 Runtime 完成，不依赖外部 Skill；不改变已确认的需求和约束时，实现方法由 Agent 自行选择。

## 开始或恢复

1. 已知名称时运行 `comet native select <change-name> --json`，否则运行 `comet native status --json`。active change 已存在时，进入 `workspace.projectRoot`；工作区有歧义时才让用户选择。若 Run 记录丢失，读取[故障恢复](reference/recovery.md#故障恢复)：有检查点则沿用阶段；否则先诊断并等待恢复决定。
2. 没有对应 active change 时，按[工作区选择参考](reference/workspace.md#创建-change)确定隔离方式，运行 `native new` 创建，再进入 `preparation.projectRoot`。准备失败时，保留已创建的分支和目录，按返回的原因处理。
3. 进入工作区并取得 `phase` 后，按[记忆接入](reference/commands.md#记忆接入)检索一次上下文。需要详情时再展开；实际使用后记录使用结果，任务结束时按该节分别处理项目记忆和个人记忆，再调用 `comet task --complete`。

记忆学习只提交可复用的用户信息；任务摘要、进展、命令输出和测试结果不写入个人记忆。任务结束前按记忆接入章节完成学习检查，并记录 `submitted`、`no-observation` 或 `not-run`。

项目经验与个人偏好分开保存：可由当前项目验证、且未来任务仍可复用的经验在任务结束前执行 `comet knowledge remember` 写入项目记忆；用户偏好和稳定协作习惯才进入个人记忆。两者的命令和完成条件见[记忆接入](reference/commands.md#记忆接入)。

## SDK Run 路径

当前响应的 `data.runtimeFormat` 为 `sdk`，或 `data.schema` 为 `comet.native.sdk-status.v1`、`comet.native.dispatch-result.v1` 或 `comet.native.run-view.v1` 时，立即执行[SDK Run 命令与恢复](reference/commands.md#sdk-run)，不为识别格式再次运行 status。Run 是唯一权威；Builder、Verifier 按参考领取并提交 Action，`native next` 执行 Runtime Action 和用户决定。

两种 Runtime 均使用最新 `continuation`；`--runner-input` 和旧 Archive 输入仅用于旧 Runtime。SDK 路径仍遵守用户确认、独立验收和工作区授权。旧 change 不自动迁移。

## 按需读取

只读取当前动作对应的章节。章节中的链接写明了适用条件，满足条件时再读取链接内容；不一次加载整份命令参考或所有参考。

- Shape：必须读取并执行[澄清](reference/clarification.md#澄清)，按项目配置选择 Sequential 或 Batch 的提问步骤。大型需求在最终确认前，必须按该节链接读取 Supervisor 拆分与确认要求。
- 编辑 brief/Spec/`children.yaml` 或核对验收报告前，必须读取[正式产物](reference/artifacts.md#正式产物)。文件、附件、链接或本地路径作为需求来源时，必须进入[源文档完整覆盖模式](reference/artifacts.md#源文档完整覆盖)；仅用于排错、取证、审查或实现参考的材料不自动触发。
- 首次填写 Runtime 模板或通过 `returnAction` 回传结果前，必须读取[填写命令输入](reference/commands.md#填写命令输入)。
- Builder 提交本轮实现前，必须读取[Builder 交接](reference/commands.md#builder-交接)。启动 Verifier、补充检查或等待结果前，必须读取[Verify 协议](reference/commands.md#verify-协议)。
- 状态包含 `childSummary` 时，必须在分配任务、接收结果或集成前读取[Supervisor 协作](reference/commands.md#supervisor-协作)，只处理 `readyChildren` 列出的子任务和 Supervisor 统筹动作。
- 字段含义不清、命令输入被拒绝、Verifier 不可用、执行错误或缺少外部信息：读取[命令输入与异常](reference/commands.md#命令输入与异常)。正常动作直接使用 Runtime 返回的命令和模板。
- 等待外部输入时，按恢复参考中的[等待外部输入与监控](reference/recovery.md#等待外部输入与监控)处理；独立工作继续。进程中断、换设备、连续无进展、并发冲突、迁移失败或状态损坏时，读取[故障恢复](reference/recovery.md#故障恢复)。

## Shape

Agent 先调查能够查明的事实，只询问会改变用户可见结果、又无法可靠推断的决定。简单问题列出未决项及其依赖关系；多个决定相互影响时才建立决策树。按 `native.clarification_mode` 提问前，先把本轮尚未解决的问题写入 brief。用户确认的结论立即同步到 brief 的相关章节和完整目标规格；未明确回答的部分保持 `[blocking]`。

完成标准：需求来源已在用户指定的覆盖边界内完整处理并按用途分类，所有影响结果的决定和假设已处理，没有 `[blocking]`，用户明确确认目标、范围、关键决定、全部验收项和非目标，并且 Runtime 已进入 Build。

新建需求或重新确认 Shape 时，brief 只要求目标、范围、非目标和验收示例四个核心章节；有约束、关键决定、待解决问题或特殊验证要求时再补对应章节。Runtime 同时检查完整目标 Spec 或明确的无产品行为变更理由及正式路径。失败会给出文件和修复动作；补齐后重跑 continuation。后续阶段的旧需求保留进度，回到 Shape 时再检查。

## Build ↔ Verify Loop

Builder 提交候选实现后，由 Runtime 执行必要检查，再交给新的只读 Verifier 验收。未通过则回 Build 修复并重新提交；全部通过后，等待用户接受验收结果。

`iteration` 表示提交实现的轮次，`attempt` 表示对同一份候选实现启动 Verifier 的次数。所有计数都由 Runtime 更新。连续验收失败或没有进展的次数达到配置上限时，按最新指令等待用户决定或处理阻塞。

## Build

首次实现前，读取当前 brief、完整目标规格和全部验收项，在已确认的需求范围内修改项目代码和测试。修复时优先处理 Verifier 指出的未通过项、无法验证的原因和失败检查；提交前仍要核对其他已确认行为。`previous_unresolved_ids` 只提示本轮修复重点，下一次正式验收仍覆盖全部验收项。

Build、Verify 和 Archive 会复查正式文件绑定。新确认的 Shape 按 Markdown 内容绑定，空行和软换行保留确认；正文、结构、代码、链接或验收变化仍须重新确认。Hook 编辑后在下一次实现写入或推进前检查实际内容；旧 Shape 沿用原绑定。文档或报告失效时保留工作并给出修复动作，Hook 未触发也会检查。普通文档默认不作废候选，可用 `native.document_writes: revert` 恢复严格行为；路径范围见[正式产物](reference/artifacts.md#正式产物)。

用户 Hook 的共享输出目录可通过 `.comet/config.yaml` 的 `hook.allow_paths` 放行；该配置对 Native 和 Classic 共用，工作流产物目录不在白名单范围。详见[用户 Hook 写入](reference/commands.md#用户-hook-写入)。

需求变化时，先判断变化属于哪种情况，再执行当前 `continuation` 允许的动作：

- 已确认的功能有实现遗漏：从 Verify 使用 `--revise-implementation`，保留已确认的需求范围，回 Build 修改。
- 用户可见行为或验收标准发生变化：从 Verify 或 Archive-ready 使用 `--revise-requirements`，更新正式文件并重新确认 Shape。
- 与当前需求无关：交给另一个 change。

用户明确补充当前范围时，按同一规则处理。

用户确认一次 Supervisor Shape，就授权执行该范围内的全部子任务。按 Runtime 的指令分配和集成子任务，随后自动进行 Supervisor 主任务的最终验收，覆盖全部验收项。按[Supervisor 协作](reference/commands.md#supervisor-协作)区分统筹、Builder 和 Verifier 的职责；只有 Runtime 接受了子任务的验收结果并确认集成成功，才算完成。

完成标准：实现和相关检查可供验收，Runtime 接受 Builder 交接并进入 Verify。

## Verify

按 Verify 协议立即启动新的只读 Verifier，原样传递任务包。派发只代表登记：平台接受启动调用、且 Verifier 回报 `verifier-started` 后，才说明它已运行；启动失败立即按异常流程处理。任务包含验收正文时直接使用，否则按分页读取全部 scopeIds。Verifier 独立判断全部验收项，复用与当前实现、工作区和输入匹配的 Runtime 检查，只补缺失或失效证据；文件和日志正文按需读取。

等待工具超时后，继续等待同一个 Verifier。回执未到且子代理无响应时，先核实启动是否成功；只有平台确认执行失败、超时、任务丢失或结束后无结果时才登记错误。Runtime 接受完整结果后，按最新状态继续。只有用户明确接受结果后才执行 `--accept-result`，仅完成自动检查的结果也须明确接受。隔离工作区可在同一回复中接受结果并选择交付方式，执行带 `--finish` 的备选命令；用户未选择时再询问。

完成标准：Runtime 接受每项验收结论并给出下一步；返回 Build 就继续修复，返回等待或阻塞就处理对应条件，不把阶段结束当任务完成。

## Archive

`continuation` 允许 Archive 时，必须先读[Archive 收尾](reference/workspace.md#archive-收尾)，使用已接受的验收结果，执行最新 continuation。用户明确选择收尾方式后，可执行对应的 `--confirmed --finish` 完整命令，由 Runtime 完成预检和事务内复查；返回 dry-run 时先运行预览，`ready: true` 后执行返回的唯一 confirmed 命令。只处理同一响应列出的阻塞。

只提交本 change 的实现和正式产物，保留无关修改。检查 `workspaceFinishResult`，阻塞时按 `recoveryArgs` 保留现场并恢复。已有授权足以处理的提交说明和本地阻塞由 Agent 修复后继续，不要求用户再次说“重试”；需要新增授权或外部信息时才询问。

完成标准：状态为 `done`，用户授权的工作区收尾为 `completed` 或 `kept`，并按记忆接入协议记录任务完成；其他结果继续处理。

## 后续指令

响应带有 `continuation.mode` 时，以它决定当前动作：`execute` 使用返回的完整参数、输入模板和任务包；`wait` 等待原任务；`ask` 展示当前提案并等待用户决定；`reconcile` 按返回证据核对原执行或处理阻塞；`done` 核对本次完成或取消的条件后结束。`commandArgs` 中的占位值必须按 `requiredInputs` 和输入模板填写，不能把模板当成已经完成的输入或用户批准。`inputRef` 指向同一响应内的完整输入，直接读取，不另查状态。每次写入后只使用新响应的身份、版本和工作目录；需要详情时执行同一响应给出的读取命令，不为寻找下一步再查询。

旧响应没有 `mode` 时，按原 `disposition` 继续：

- `continue`：在返回的工作目录执行完整 `commandArgs`，按 `inputOptions` 模板填写输入。
- `await-user`：先转述 `userCommunication.message` 和 `suggestedReply`，等待列出的决定；按用户选择执行 `commandAlternatives`，保留 `--expected-state-version` 和 `--expected-action`。过期时读取最新状态，不自行拼接无保护命令。
- `blocked`：处理列出的阻塞或恢复动作；仅暂停依赖该条件的工作。
- `done`：核对 Archive 完成标准后结束。

命令成功且响应包含 `agent` 时，直接复用共用 workflow guard 的轻量所有权读取结果和 `continuation` 继续。只在字段缺失、命令因版本或所有权被拒绝，或需要额外正文时读取详情；新会话或上下文压缩恢复缺少响应状态、仓库/分支/change 切换或有明确外部变化迹象时，才重新查询 `status`。不因等待工具超时重复派发已有的 Verifier 或子任务。

当前动作需要验收文字、交接摘要或历史详情时，才加 `--details`，并按 `nextPageArgs` 读取 `scopeIds` 涉及的全部页面。需要正式文件的正文时，才运行 `show`。阅读 CLI 文本时，先看 `summary`、唯一的 `NEXT:` 和可选转述消息；程序解析使用 `--json`，排查本机执行状态时才用 `--verbose`。
