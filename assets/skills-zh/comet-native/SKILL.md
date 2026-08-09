---
name: comet-native
description: "Comet Native 工作流。当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用。"
---

# Comet Native

Native 在磁盘上保存需求、完整目标规格、可携带状态和验收结果。你的职责是澄清、实现并根据 Runtime 指令组织独立验收；状态、Loop、边界和恢复由 Runtime 掌管。

## 硬性边界

- 磁盘中的 `.comet/config.yaml`、当前 change、`comet-state.yaml` 和正式 Markdown 优先于聊天记忆。
- 不要直接编辑 Runtime 管理的状态、本机 execution、日志、锁或事务。
- 只调用 PATH 中公开的 `comet native`。命令不可用时说明 Comet 安装不完整，不搜索或直接调用内部脚本。
- 需要参数或输出说明时运行 `comet native <command> --help`；不要在 Skill 中猜测或重建命令。
- Builder 的完成声明不是验收结论；Skill 必须启动新的 Verifier subagent 或独立 Agent execution，不能让 Builder 直接生成 Verifier 结果。
- Native 主流程不依赖任何外部 Skill。

## 开始或恢复

1. 运行 `comet native status --json`。CLI 会发现已登记 Git worktree，返回每个 change 的实际 workspace、phase、Loop 和后续指令。
2. 有目标名称时运行 `comet native status <change-name> --details --json` 和 `show`。跟随 `nextPageArgs` 读取全部验收项或后续状态页。
3. 同名 active change 已存在时，在返回的 `workspace.projectRoot` 上恢复并 `select`，不重复创建。多个合理候选才让用户选择。
4. 只有没有对应 active change 时才创建。只使用配置指定的 artifact root。

### 创建 change

先确定一个小写 kebab-case 名称；用户未命名时给出简短推荐，展示后再创建。

隔离方式只在会影响用户目录时询问，并一次展示适用选项及推荐：

- `current`：当前目录干净且未被其他 active Native change 占用时的默认值；
- `branch`：需要独立分支但继续使用当前目录；目录必须干净；
- `worktree`：当前目录已有其他 active change，或需要独立工作目录。

用户可同时覆盖 change 分支、目标分支和 worktree 路径。默认分别是 `comet/<change-name>`、当前分支和 `.worktrees/<change-name>`。明确展示最终选择；冲突时停止，不追加随机后缀或接管已有资源。

执行 `new` 时传入选择结果。CLI 负责创建或复用合法绑定的 branch/worktree、维护仓库本地 exclude、核对目标配置，并创建可携带状态与本机 execution overlay。使用返回的 `preparation.projectRoot` 继续；若只完成部分准备，报告错误和 preparation 中已创建的资源，不删除归属不明的目录、分支或文件。

旧 workspace 元数据保持兼容，不为启用隔离而手工迁移或移动 change。

## 按需读取

确认 phase 后只读取需要的一份 reference：

- Shape：必须读取并执行[澄清参考](reference/clarification.md)；
- 编辑 brief、完整目标规格或查看验收报告：[产物参考](reference/artifacts.md)；
- Runtime 要求 `runnerAction`、构造 `--runner-input`、Verifier 分派或诊断动作：[命令参考](reference/commands.md)；
- execution 中断、本机 Runtime 缺失、停滞、冲突、迁移或损坏：[恢复参考](reference/recovery.md)。

## Shape

先调查仓库、工具和运行环境可确定的事实。可以使用 subagent 调查彼此独立的事实，不把可调查事实交给用户。

严格按 `native.clarification_mode` 和澄清参考维护决策树：Sequential 每轮只问一个当前可提问节点；Batch 每轮询问全部当前可提问节点。只有会实质改变用户可见结果且无法可靠推断的决定才问用户。

每个结论立即同步到 Decisions、brief 和完整目标规格。把验收标准写成非空、可观察且互不重复的条目。未解决问题保持 `[blocking]`；有阻塞项时不修改项目实现。所有分支和静默假设检查完成后，向用户给出目标、范围、关键决定、验收标准与非目标摘要。只有用户明确确认后才使用后续指令中含 `--confirmed` 的命令推进。

## Build

实现满足 brief 和完整目标规格的最简单可靠方案。需求变化时先判断归属：

- 属于当前 change 的实现补充：Verify/Archive 先使用后续指令返回的 `--return-to-build` 动作，确认回到 Build 后再写实现；
- 改变用户可见行为或验收标准：回到 Shape 更新正式产物和验收项，重新取得确认；
- 与当前 change 无关：保留当前 change，创建或选择另一个 change。

用户明确要求当前 change 增加文件或行为时，不得仅因旧计划未列出就拒绝；应按上述归属更新正式范围。确认前仍保持阻塞。

候选实现完成后，对照完整规格和全部验收项复核遗漏，并按 `continuation.commandArgs` 用 `next --runner-input <file>` 提交精简 Builder handoff：本轮实现摘要、上一轮失败项的处理、实际运行或未运行的开发期检查、已知限制。公共 JSON 不填写 candidate、identity、provider 或 execution ref；这些关联值由 Runtime 分配。输入文件放系统临时目录并在调用后用 `finally` 删除，不留在项目或 Runtime 目录。不要写验收结论，不复制完整命令输出，也不要用自述完成代替后续 Verify。

## Completion Loop

1. 读取当前 Loop、全部验收项、阻塞项和下一动作；失败后的 Build 优先处理 failed/blocked 项与失败检查。
2. 完成一批相关修复并复核完整规格，把 `builder-handoff` JSON 交给后续指令中的同一个 `next --runner-input`。
3. 显式解析本候选的命令检查计划，把 `dispatch-verifier` JSON 交给同一选项；确实没有适用的项目命令检查时明确使用 `checks: []`，不得用空数组隐藏未知检查。
4. 读取返回的完整 `verifierDispatch`，把 candidate、iteration、attempt、验收清单、brief/Spec 引用、Builder handoff 和 Runtime 真实检查结果交给新的只读 Verifier subagent；平台不支持 subagent 时启动新的独立 Agent execution。若两者都不可用，只在检查计划已显式完成且全部通过后提交 `verifier-unavailable`，由 Runtime 停在降级用户确认，不得伪造 Verifier 结果。
5. 把 Verifier 的 `verifier-response` 或 `verifier-execution-error` JSON 交给同一选项。对于执行错误或 Verifier 不可用，必须原样复制当前 `verifierDispatch` 的四个绑定字段，防止迟到的旧 execution 修改新的 attempt。`request-checks` 返回后继续当前 attempt；最终结果必须覆盖每个验收 ID。`fail` 回 Build；semantic `blocked` 若无需改实现，等用户选择后执行 `--resolve-verifier-blocker`，复用已完成检查并分派新 attempt，需要改实现则仍回 Build；`skill-coordinated` 的 `pass` 先停在 `await-user`，向用户说明通用 CLI 无法强证明独立 execution 并只询问一次是否接受该边界，确认后执行返回的 `next --confirmed --summary` 才进入 Archive。

持续执行 Runtime 返回的有界 Loop。只有 `done`、`await-user`、`blocked` 或用户明确要求停止才结束；一次 turn、一次实现提交或 Agent 自述完成都不是终态。

## Verify

Verifier 不信任 Builder handoff 中的完成声明。它只读检查 brief、完整目标规格、实际实现、Runtime 检查结果和全部验收项；handoff 仅作为调查线索。

Verifier 需要额外检查时一次批量提出，由 Runtime 执行并记录真实退出状态、超时和日志；不要把自由文本结果当作检查已执行。Verifier 最终必须对每个已知验收 ID 恰好返回一次 `passed`、`failed` 或 `blocked`，并给出下一轮 Build 可以直接处理的原因。

Verifier 不修改实现、不自行推进状态，也不在响应或 CLI 中填写 candidate、provider 或 execution identity。通用 CLI 输出必须标记为 `skill-coordinated`：它能程序化绑定候选和 attempt，但任何本地调用者都能调用 CLI，因此不能证明恶意调用者确实启动了独立 Agent，也绝不能称为 trusted、runner-attested 或 host-attested。可靠性来自 Skill 的新 subagent 协议、Runtime 真实执行检查以及全部验收 ID 恰好覆盖一次；只有从平台调度器取得身份并调用 in-process Runtime API 的 host adapter 才提供强身份边界。平台没有独立 execution 时的 fallback 必须保留 `semantic-verification-unavailable` / `user-confirmed-degraded` assurance，不能写成正常独立 pass。

Verify fail 后实际修复缺口再重试。Runtime 根据未解决验收项和失败计数判断进展；达到停滞或执行失败上限时遵循其 `blocked` 或 `await-user` 处置，不盲目重试。

## Archive

只有 Runtime 接受最终 Verify pass，或用户明确接受语义验证不可用的降级边界后，才准备归档。Archive 不重复执行检查，也不再次分派 Verifier。

`current` 不需要分支收尾选择。使用 `branch` 或 `worktree` 时，一次性向用户展示实际 change 分支、目标分支和工作目录，并让用户选择本地合并、推送 change 分支、推送并创建 PR、保留，或暂不归档。选择“暂不归档”时停止。

执行前只提交属于该 change 的实现和正式 active-change 产物，保留其他用户改动；CLI 会拒绝夹带未提交路径。用 Runtime 返回的 `commandArgs` 和当前状态版本执行获授权的 Archive；需要确认时展示摘要并等待明确确认，不重用旧动作。

归档命令负责应用完整目标 Spec、移动 change、清理本机 per-change Runtime，并执行获授权的 merge、push 或 PR 动作。检查 `workspaceFinishResult`：`completed`/`kept` 表示已执行；`blocked` 表示归档或外部收尾尚需恢复，保留现场并按 `recoveryArgs` 诊断。不得静默解决语义冲突。

## continuation（后续指令）

每次命令后以 Runtime 返回值为准：

- `continue`：使用 `commandArgs` 和 `inputOptions` 补齐真实输入后继续；
- `await-user`：只等待列出的用户决定；
- `blocked`：暂停正常循环，处理 blocker、findings 或恢复动作；
- `done`：change 与所选收尾均达到命令报告的终态。

不要从 `command` 文本拼接 shell；优先使用结构化 argv。执行后重新读取状态，确认 phase、Loop、状态版本和 workspace 仍与预期一致。
