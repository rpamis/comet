---
name: comet-native
description: 'Comet Native 工作流。当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用。'
---

# Comet Native

Native 将完整需求、进度和验收结论保存在项目中。Agent 只处理 Runtime 指定的当前阶段。完成当前动作后，读取最新 `continuation` 并按其中的指令继续，直到任务完成、需要用户决定，或遇到外部阻塞。

## 必须遵守的规则

- 以磁盘上的 `.comet/config.yaml`、当前 change、`comet-state.yaml` 和正式文件为准，聊天记忆只作辅助。工作流保存的正式文件中，Agent 只编辑 brief、完整目标 Spec 和 `children.yaml`；状态、检查结果、报告、锁和事务由 Runtime 管理。
- 通过 PATH 中公开的 `comet native` 命令推进，用户不手工执行命令。命令不可用时报告安装不完整并停止；参数以 `comet native <command> --help` 为准。
- Builder 提交本轮待验收的代码和相关文件，称为“候选实现”。每轮都由新的只读 Verifier 独立判断全部验收项。失败、阻塞、未执行和超时不能算通过。
- 只有用户明确确认完整 Shape、接受最终结果或选择相应交付方式后，才执行对应的确认命令。沿用已确认的需求范围和 Runtime 保存的用户选择。归档、merge、push、PR 和工作区清理各自需要的授权不能互相代替。
- Native 主流程由本 Skill 和 Runtime 完成，不依赖外部 Skill；不改变已确认的需求和约束时，实现方法由 Agent 自行选择。

## 开始或恢复

1. 已知名称时运行 `comet native status <change-name> --json`；未知时先运行 `comet native status --json` 确定目标。
2. active change 已存在时，进入返回的 `workspace.projectRoot` 并执行 `select`。由 Runtime 查找工作区；只有多个工作区同样匹配时，才让用户选择。
3. 没有对应 active change 时，按[工作区选择参考](reference/workspace.md#创建-change)确定隔离方式并创建，再进入 `preparation.projectRoot`。准备失败时，保留已创建的分支和目录，按返回的原因处理。
4. 进入工作区并取得 `phase` 后，按[记忆接入](reference/commands.md#记忆接入)检索一次上下文。需要详情时再展开；实际使用后记录使用结果，任务结束时调用 `comet task --complete`。具体操作见该节。

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

Agent 先调查能够查明的事实，只询问会改变用户可见结果、又无法可靠推断的决定。简单问题列出未决项及其依赖关系；多个决定相互影响时才建立决策树。按 `native.clarification_mode` 提问前，先把本轮尚未解决的问题写入 brief。用户确认的结论立即同步到 Decisions、brief 和完整目标规格；未明确回答的部分保持 `[blocking]`。

完成标准：需求来源已按用途完整覆盖，所有影响结果的决定和假设已处理，没有 `[blocking]`，用户明确确认目标、范围、关键决定、全部验收项和非目标，并且 Runtime 已进入 Build。

## Build ↔ Verify Loop

Builder 提交候选实现后，由 Runtime 执行必要检查，再交给新的只读 Verifier 验收。未通过则回 Build 修复并重新提交；全部通过后，等待用户接受验收结果。

`iteration` 表示提交实现的轮次，`attempt` 表示对同一份候选实现启动 Verifier 的次数。所有计数都由 Runtime 更新。连续验收失败或没有进展的次数达到配置上限时，按最新指令等待用户决定或处理阻塞。

## Build

首次实现前，读取当前 brief、完整目标规格和全部验收项，在已确认的需求范围内修改项目代码和测试。修复时优先处理 Verifier 指出的未通过项、无法验证的原因和失败检查；提交前仍要核对其他已确认行为。`previous_unresolved_ids` 只提示本轮修复重点，下一次正式验收仍覆盖全部验收项。

需求变化时，先判断变化属于哪种情况，再执行当前 `continuation` 允许的动作：

- 已确认的功能有实现遗漏：从 Verify 使用 `--revise-implementation`，保留已确认的需求范围，回 Build 修改。
- 用户可见行为或验收标准发生变化：从 Verify 或 Archive-ready 使用 `--revise-requirements`，更新正式文件并重新确认 Shape。
- 与当前需求无关：交给另一个 change。

用户明确补充当前范围时，按同一规则处理。

用户确认一次 Supervisor Shape，就授权执行该范围内的全部子任务。按 Runtime 的指令分配和集成子任务，随后自动进行 Supervisor 主任务的最终验收，覆盖全部验收项。按[Supervisor 协作](reference/commands.md#supervisor-协作)区分统筹、Builder 和 Verifier 的职责；只有 Runtime 接受了子任务的验收结果并确认集成成功，才算完成。

完成标准：实现和相关检查可供验收，Runtime 接受 Builder 交接并进入 Verify。

## Verify

按 Verify 协议立即启动独立的只读 Verifier。Verifier 核对检查记录是否对应当前实现版本、工作区和输入，只补充缺失或失效的检查，并独立判断全部验收项。Builder 交接时，只传本轮实现的位置、验收项的编号与引用、检查记录位置、已知限制和相关文件位置；日志正文按需读取。

等待工具超时后，继续等待同一个 Verifier。只有平台确认执行失败、执行超时、任务丢失或结束后没有可用结果时，才登记错误。Runtime 接受完整结果后，按最新状态继续。需要用户接受最终结果时，只有用户明确接受，才执行 `--accept-result`；仅完成自动检查、没有独立验收的结果也须由用户明确接受。

完成标准：Runtime 接受每项验收结论并给出下一步；返回 Build 就继续修复，返回等待或阻塞就处理对应条件，不把阶段结束当任务完成。

## Archive

`continuation` 允许 Archive 时，必须先读[Archive 收尾](reference/workspace.md#archive-收尾)，使用已接受的验收结果，执行 Runtime 返回的完整 `archive --dry-run`。只处理同一响应列出的阻塞；`ready: true` 后才执行返回的唯一 `archive --confirmed` 命令。

只提交本 change 的实现和正式产物，保留无关修改。检查 `workspaceFinishResult`，阻塞时按 `recoveryArgs` 保留现场并恢复。

完成标准：状态为 `done`，用户授权的工作区收尾为 `completed` 或 `kept`，并按记忆接入协议记录任务完成；其他结果继续处理。

## 后续指令

- `continue`：在返回的工作目录执行完整 `commandArgs`，按 `inputOptions` 模板填写输入。
- `await-user`：先转述 `userCommunication.message` 和 `suggestedReply`，等待列出的决定；按用户选择执行 `commandAlternatives`，保留 `--expected-state-version` 和 `--expected-action`。过期时读取最新状态，不自行拼接无保护命令。
- `blocked`：处理列出的阻塞或恢复动作；仅暂停依赖该条件的工作。
- `done`：核对 Archive 完成标准后结束。

命令成功且响应包含 `agent` 时，直接使用其中的阶段、状态版本、`workspace.cwd` 和 `continuation` 继续。只在字段缺失、命令被拒绝或需要额外正文时读取详情；恢复会话、响应缺失或有外部变化迹象时，才重新查询 `status`。不因等待工具超时重复派发已有的 Verifier 或子任务。

当前动作需要验收文字、交接摘要或历史详情时，才加 `--details`，并按 `nextPageArgs` 读取 `scopeIds` 涉及的全部页面。需要正式文件的正文时，才运行 `show`。阅读 CLI 文本时，先看 `summary`、唯一的 `NEXT:` 和可选转述消息；程序解析使用 `--json`，排查本机执行状态时才用 `--verbose`。
