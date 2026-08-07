---
name: comet-native
description: "Comet Native 工作流。当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用。"
---

# Comet Native

Native 在磁盘上保存需求、完整目标规格、状态和证据。你的职责是理解、实现和验证；状态、边界和恢复由 Runtime 掌管，不要越界。

## 硬性边界

- 磁盘中的 `.comet/config.yaml`、当前 change、状态和正式产物优先于聊天记忆。
- 不要直接编辑 Runtime 管理的状态、workspace、scope、evidence、checkpoint、锁或事务文件。
- 只调用 PATH 中公开的 `comet native`。命令不可用时说明 Comet 安装不完整，不搜索或直接调用内部脚本。
- 需要参数或输出说明时运行 `comet native <command> --help`；不要在 Skill 中猜测或重建命令。
- Native 主流程不依赖任何外部 Skill。

## 开始或恢复

1. 运行 `comet native status --json`。CLI 会发现已登记 Git worktree，返回每个 change 的实际 workspace、phase、`continuation`（后续指令）和翻页参数。
2. 有目标名称时运行 `comet native status <change-name> --details --json` 和 `show`。跟随 `nextPageArgs` 翻页，读取后续的状态或 acceptance（验收项）。
3. 同名 active change 已存在时，在返回的 `workspace.projectRoot` 上恢复并 `select`，不重复创建。多个合理候选才让用户选择。
4. 只有没有对应 active change 时才创建。只使用配置指定的 artifact root。

### 创建 change

先确定一个小写 kebab-case 名称；用户未命名时给出简短推荐，展示后再创建。

隔离方式只在会影响用户目录时询问，并一次展示适用选项及推荐：

- `current`：当前目录干净且未被其他 active Native change 占用时的默认值；
- `branch`：需要独立分支但继续使用当前目录；目录必须干净；
- `worktree`：当前目录已有其他 active change，或需要独立工作目录。

用户可同时覆盖 change 分支、目标分支和 worktree 路径。默认分别是 `comet/<change-name>`、当前分支和 `.worktrees/<change-name>`。明确展示最终选择；冲突时停止，不追加随机后缀或接管已有资源。

执行 `new` 时传入选择结果。CLI 负责创建或复用合法绑定的 branch/worktree、维护仓库本地 exclude、核对目标配置并在目标目录捕获 baseline。使用返回的 `preparation.projectRoot` 继续；若只完成部分准备，报告错误和 preparation 中已创建的资源，不删除归属不明的目录、分支或文件。

旧 workspace 元数据保持兼容，不为启用隔离而手工迁移、移动 change 或刷新 baseline。

## 按需读取

确认 phase 后只读取需要的一份 reference：

- Shape：必须读取并执行[澄清参考](reference/clarification.md)；
- 编辑 brief、完整目标规格或 verification：[产物参考](reference/artifacts.md)；
- Runtime 要求高级输入、receipt、partial scope 或诊断动作：[命令参考](reference/commands.md)；
- 中断、证据失效、repair stop、冲突、迁移或损坏：[恢复参考](reference/recovery.md)。

## Shape

先调查仓库、工具和运行环境可确定的事实。可以使用 subagent 调查彼此独立的事实，不把可调查事实交给用户。

严格按 `native.clarification_mode` 和澄清参考维护决策树：Sequential 每轮只问一个当前可提问节点；Batch 每轮询问全部当前可提问节点。只有会实质改变用户可见结果且无法可靠推断的决定才问用户。

每个结论立即同步到 Decisions、brief 和完整目标规格。未解决问题保持 `[blocking]`；有阻塞项时不修改项目实现。所有分支和静默假设检查完成后，向用户给出目标、范围、关键决定、验收标准与非目标摘要。只有用户明确确认后才使用后续指令中含 `--confirmed` 的命令推进。

## Build

实现满足 brief 和完整目标规格的最简单可靠方案。分批工作可用 checkpoint 保存恢复上下文，但 checkpoint 不是完成证据。

需求变化时先判断归属：

- 属于当前 change 的实现补充：Verify/Archive 先使用后续指令返回的 `--return-to-build` 动作，确认回到 Build 后再写实现；
- 改变用户可见契约：回到 Build 后重新执行澄清、更新正式产物并取得确认；
- 与当前 change 无关：保留当前 change，创建或选择另一个 change。

用户明确要求当前 change 增加文件或行为时，不得仅因旧计划未列出就拒绝；应按上述归属更新正式范围。确认前仍保持阻塞。

候选实现完成后，对照完整规格和全部 acceptance 复核遗漏。使用后续指令的 `commandArgs` 提交真实项目 artifact；确实没有项目文件变化时使用其 no-code 备选输入。不要把未知范围声明为完整。

## Completion Loop

1. 读取 `status <change-name> --details --json` 和分页返回的全部 acceptance；失败后的 Build 优先处理 failed/missing acceptance 与 failed check。
2. 完成一批相关修复并复核完整规格。
3. 运行真实验证，生成当前 receipt 和 verification 报告。
4. `fail` 回到 Build 继续修复；只有 `pass` 才进入 Archive。

`blocked` 进入恢复分支，处理 findings 后重新读取后续指令。只有 `done`、`await-user` 或用户明确要求停止才结束；一次 turn、checkpoint 或自述完成都不是终态。

## Verify

按 acceptance、完整规格和改动风险运行真实验证。报告只记录实际命令、结果和可复核事实；未运行、失败、跳过或超时不能写成通过。

使用 Runtime 返回的 acceptance ID 和 typed receipt。提交 Verify 时，按后续指令的要求提供 `--result` 与 `--report`；不要传入调用方生成的 required-check receipt。规格、实现、报告或证据改变后重新验证。

Verify fail 后实际修复缺口再重试。`repair-stagnation-stop` 时提出一个不同且具体的新修复假设，并使用 Runtime 返回的 override 输入；只有后续指令要求 `repair-continuation-decision` 时才等待用户选择。

## Archive

只有最终 Verify pass 后才准备归档。

`current` 不需要分支收尾选择。使用 `branch` 或 `worktree` 时，你必须一次性向用户展示实际的 change 分支、目标分支和工作目录，并让用户选择：本地合并、推送 change 分支、推送并创建 PR、保留，或暂不归档。选择“暂不归档”时停止。

执行前只提交属于该 change 的实现和正式 active-change 产物，保留其他用户改动；CLI 会拒绝夹带未提交路径。然后用 `archive --dry-run --finish ...` 持久化选择，并使用后续指令返回的精确 `commandArgs`：

- `automatic` 直接执行；
- `required` 展示摘要并等待明确确认；
- 不复用旧 preflight。

归档命令负责提交归档路径并执行获授权的 merge、push 或 PR 动作。检查 `workspaceFinishResult`：`completed`/`kept` 表示已执行；`blocked` 表示归档已完成但外部收尾未完成，保留现场并按 `recoveryArgs` 诊断。合并后清理被延后到合并结果验证完成；不得静默解决语义冲突。

## continuation（后续指令）

每次命令后以 Runtime 返回值为准：

- `continue`：使用 `commandArgs` 和 `inputOptions` 补齐真实输入后继续；
- `await-user`：只等待列出的用户决定；
- `blocked`：暂停正常循环，处理 findings 或恢复动作；
- `done`：change 与所选收尾均达到命令报告的终态。

不要从 `command` 文本拼接 shell；优先使用结构化 argv。执行后重新读取状态，确认 phase、revision 和 workspace 仍与预期一致。
