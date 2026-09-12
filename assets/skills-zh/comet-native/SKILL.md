---
name: comet-native
description: 'Comet Native 工作流。当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用。'
---

# Comet Native

Native 将完整需求、进度和验收结论保存在项目中。只处理 Runtime 指定的当前阶段；完成当前动作后消费最新 `continuation`，持续推进到完成或明确的用户决定、外部阻塞。

## 硬性边界

- 磁盘中的 `.comet/config.yaml`、当前 change、`comet-state.yaml` 和正式产物是工作依据，聊天记忆只作辅助。工作流正式产物中，Agent 只编辑 brief、完整目标 Spec 和 `children.yaml`；状态、检查证据、报告、锁和事务由 Runtime 管理。
- 通过 PATH 中公开的 `comet native` 命令推进，用户不手工执行命令。命令不可用时报告安装不完整并停止；参数以 `comet native <command> --help` 为准。
- Builder 提交候选，由新的只读 Verifier 独立判断全部验收项。失败、阻塞、未执行和超时不能算通过。
- 只有用户明确确认完整 Shape、接受最终结果或选择相应交付方式后，才执行对应确认动作；沿用已确认范围及持久化选择。归档、merge、push、PR 和工作区清理分别遵守其授权。
- Native 主流程由本 Skill 和 Runtime 完成，不依赖外部 Skill；不改变已确认结果的工程方法由 Agent 自行选择。

## 开始或恢复

1. 已知名称时运行 `comet native status <change-name> --json`；未知时先运行 `comet native status --json` 确定目标。
2. active change 已存在时，进入返回的 `workspace.projectRoot` 并 `select`；工作区定位交给 Runtime，多个同样匹配的候选才让用户选择。
3. 没有对应 active change 时，按[工作区选择参考](reference/workspace.md#创建-change)确定隔离方式并创建，再进入 `preparation.projectRoot`。准备失败时保留资源并处理返回原因。
4. 进入工作区并取得 `phase` 后，按[记忆接入](reference/commands.md#记忆接入)检索一次上下文；该章节也定义按需展开、实际应用回写和任务结束的 `comet task --complete`。

## 按需读取

只读取当前动作对应的章节，章节内的条件指针满足时再继续读取；不一次加载整份命令参考或所有参考。

- Shape：必须读取并执行[澄清](reference/clarification.md#澄清)，按项目配置选择 Sequential 或 Batch 的实际步骤；大型需求在最终确认前必须读取其中的 Supervisor 拆分检测指针。
- 编辑 brief/Spec/`children.yaml` 或核对验收报告前，必须读取[正式产物](reference/artifacts.md#正式产物)。文件、附件、链接或本地路径作为需求来源时，必须进入[源文档完整覆盖模式](reference/artifacts.md#源文档完整覆盖)；仅用于排错、取证、审查或实现参考的材料不自动触发。
- 首次填写 Runtime 模板或通过 `returnAction` 回传结果前，必须读取[填写命令输入](reference/commands.md#填写命令输入)。提交 Builder 候选前必须读取[Builder 交接](reference/commands.md#builder-交接)；启动、补充检查或等待 Verifier 前必须读取[Verify 协议](reference/commands.md#verify-协议)。状态包含 `childSummary` 时，必须在派发、回报或集成前读取[Supervisor 协作](reference/commands.md#supervisor-协作)，只处理 `readyChildren` 与 Supervisor 统筹动作。
- 字段含义不清、命令输入被拒绝、Verifier 不可用、执行错误或缺少外部信息：读取[命令输入与异常](reference/commands.md#命令输入与异常)。正常动作直接使用 Runtime 返回的命令和模板。
- 等待外部输入时，按恢复参考中的[等待外部输入与监控](reference/recovery.md#等待外部输入与监控)处理；独立工作继续。进程中断、换设备、连续无进展、并发冲突、迁移失败或状态损坏时，读取[故障恢复](reference/recovery.md#故障恢复)。

## Shape

调查可确定的事实，只询问会改变用户可见结果且无法可靠推断的决定。简单问题维护未决项和依赖；复杂分歧才建立决策树。按 `native.clarification_mode` 在提问前持久化本轮真实未决问题，确认结论立即同步到 Decisions、brief 和完整目标规格；未明确回答的部分保持 `[blocking]`。

完成标准：需求来源已按用途完整覆盖，所有影响结果的决定和假设已处理，没有 `[blocking]`，用户明确确认目标、范围、关键决定、全部验收项和非目标，并且 Runtime 已进入 Build。

## Build ↔ Verify Loop

Builder 提交候选，Runtime 执行必要检查，新的只读 Verifier 验收；未通过则回 Build 修复并重新提交，通过则进入结果接受边界。`iteration` 表示实现候选的轮次，`attempt` 表示同一候选启动 Verifier 的次数；所有计数都由 Runtime 更新，失败或停滞达到预算时处理最新等待或阻塞动作。

## Build

首次实现读取当前 brief、完整目标规格和全部验收项，在已确认范围内修改项目代码和测试。修复时优先处理 Verifier 未通过项、无法验证原因及失败检查；提交前核对其他已确认行为。`previous_unresolved_ids` 只提示重点，下一次正式验收仍覆盖全部验收项。

需求变化时先判断归属，再执行当前 `continuation` 返回的合法动作：实现遗漏可从 Verify 使用 `--revise-implementation` 保留确认范围；用户可见行为或验收标准变化可从 Verify 或 Archive-ready 使用 `--revise-requirements`，更新产物并重新确认 Shape；无关需求留给另一个 change。用户明确补充当前范围时，按同一规则处理。

一次 Supervisor Shape 确认授权全部同范围子任务；按 Runtime 派发和集成后自动继续父级最终全量验证，覆盖全部验收项。按[Supervisor 协作](reference/commands.md#supervisor-协作)区分统筹、Builder 和 Verifier 角色，子任务完成以 Runtime 接受验收与集成证据为准。

完成标准：实现和相关检查可供验收，Runtime 接受 Builder 交接并进入 Verify。

## Verify

按 Verify 协议立即启动独立的只读 Verifier，核对当前候选、工作区和输入绑定的证据，只补充缺失或失效检查；独立判断始终覆盖全部验收项。Builder 交接只传候选、验收范围、证据位置、限制和相关文件位置，日志正文按需读取。

等待工具超时后继续等待同一个 Verifier；只有平台确认执行失败、执行超时、任务丢失或结束后没有可用结果时才登记错误。Runtime 接受完整结果后按最新状态继续；最终结果等待用户接受时，只有用户接受当前结果才执行 `--accept-result`，降级结果也须明确接受。

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

成功响应含 `agent` 时直接消费其阶段、状态版本、`workspace.cwd` 和 `continuation`；恢复会话、响应缺失或有外部变化迹象时才查询 `status`。当前动作需要长字段时才加 `--details` 并按 `nextPageArgs` 读取覆盖 `scopeIds` 的页面，需要正式正文时才运行 `show`。CLI 文本先读 `summary`、唯一 `NEXT:` 和可选转述消息；稳定解析用 `--json`，机器状态排查才用 `--verbose`。
