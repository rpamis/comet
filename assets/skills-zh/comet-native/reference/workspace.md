# Native 工作区参考

## 创建 change

先确定 change 名称，使用小写字母、数字和连字符（kebab-case），并采用配置指定的产物目录。创建前，CLI 会关联分支或 worktree，复用或重建已登记的 change worktree，维护仓库本地排除规则，并核对配置。准备失败时，保留已创建的分支和目录，按 `preparation` 返回的原因和恢复建议处理。

只在创建 change 时读取本节，确定使用哪个工作目录。创建后进入 `preparation.projectRoot`。`comet init` 会按所选 Skill 的语言初始化 `native.language`；后续文档使用项目配置中的语言，只有用户明确要求改用其他语言时，才传入 `--language`。

Supervisor Change 中由 `readyChildren` 返回的子任务固定使用独立 `worktree`，并以 Supervisor Change 的 `workspace.changeBranch` 为目标分支；其他 change 在用户已经指定 `current`、`branch` 或 `worktree` 时直接采用。

明确表达并行、同时处理或多个会话时，直接使用 `worktree`，不再询问三种方式。未指定隔离方式且没有明确并行意图时，出现以下任一情况才询问用户：

- 当前目录有未提交工作；
- 已有其他 active Native change；
- 用户要求并行开发或隔离工作，但没有指定方式。

没有这些情况时使用 Runtime 默认的 `current`。

需要询问时，用单选题让用户选择工作区隔离方式：

| 选项 | 方式                      | 实际影响                                                               |
| ---- | ------------------------- | ---------------------------------------------------------------------- |
| A    | 当前目录（`current`）     | 沿用当前分支和目录，不创建新的 Git 分支或工作目录                      |
| B    | 新分支（`branch`）        | 在当前目录切换到新的 change 分支；要求当前工作区干净                   |
| C    | 新 worktree（`worktree`） | 创建或复用独立分支和工作目录，适合并行 change 或当前目录已有未提交工作 |

展示符合当前状态和用户要求的全部选项，不要仅凭推测后续命令可能失败就删去选项。用户明确要沿用当前分支时推荐 A；需要独立分支且无需并行工作时推荐 B；需要并行开发、当前目录已有工作，或已有 active Native change 时推荐 C。

推荐不能代替用户选择；用户选择后再创建工作区。已登记的 `worktree` 仍与 change 分支关联时，Runtime 会复用它；分支仍存在但对应 `worktree` 已移除时，Runtime 会重建它。

只有分支已重命名、被用户接管或无法确认归属时，必须先读取[工作区恢复](recovery.md#工作区)，再按 Runtime 指令请求用户重新绑定工作区（rebind）。提问前必须读取[提问方式与模式](clarification.md#提问方式与模式)：优先使用结构化单选工具；工具不可用时使用编号文本并等待回答。只有一个符合当前条件的选项时，说明原因并直接采用。

## Archive 收尾

只有 `continuation` 允许 Archive 时才继续。归档直接使用已接受的验收结果。使用 `current` 工作区时，不需要选择收尾方式：展示当前分支和目录，说明不会执行 merge、push 或创建 PR，再按最新 `continuation` 继续。

使用 `branch` 或 `worktree`、且需要选择收尾方式时，一次展示实际 change 分支、目标分支和目录，用单选题提供以下全部选项。文本提问必须使用下表；结构化提问必须将“方式”作为短标签、“实际影响”作为说明，不得只显示 `merge`、`push`、`pull-request` 或 `keep`。

| 选项 | 方式                                  | 实际影响                                                                            |
| ---- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| A    | 仅归档并保留工作区（`keep`）          | 完成归档并在 change 分支创建归档提交；不合并、不推送、不创建 PR，保留当前分支和目录 |
| B    | 本地合并（`merge`）                   | 完成归档并创建归档提交，再把 change 分支本地合并到目标分支；不推送、不创建 PR       |
| C    | 归档并推送（`push`）                  | 完成归档并创建归档提交，再推送 change 分支；不合并到目标分支、不创建 PR             |
| D    | 归档、推送并创建 PR（`pull-request`） | 完成归档并创建归档提交，推送 change 分支，再以目标分支作为基础分支创建 PR           |
| E    | 暂不归档                              | 不执行归档或工作区收尾，保留当前仍在进行的 change 和工作区，等待稍后继续            |

用户选择 A、B、C 或 D 后，分别按 `keep`、`merge`、`push` 或 `pull-request` 执行 Runtime 返回的完整命令；选择 E 后停止。Archive-ready 时按以下顺序操作：

1. 先执行 Runtime 返回的完整 `archive --dry-run` 命令。隔离工作区尚未选择 finish 时，等待用户选择，再使用 `commandAlternatives` 中对应的 `--dry-run --finish` 命令；不得自行补参数或直接执行 `--confirmed`。
2. dry-run 返回 `ready: false` 时，只处理同一响应列出的阻塞。不要先额外运行 `status`、重复 Archive，或手工提交 Native 的状态和 verification 文件。
3. 只有 dry-run 返回 `ready: true` 后，才执行它返回的唯一 `archive --confirmed` 命令。
4. dry-run 或 confirmed 失败时，只按最新结构化 `continuation` 和 `workspaceFinishResult.recoveryArgs` 继续，不从错误文本猜测下一步。

选择 A 表示保留当前分支和目录，同一次归档不得删除该 worktree。其他普通 change 归档后，如果该 change 的 worktree 已没有未提交修改，向用户提供清理选项；Runtime 已清理的无需再次询问。只有用户确认后才执行 `git worktree remove`，存在未提交修改或仍在使用的 worktree 必须保留。

Supervisor 最终交付后，Runtime 只自动清理没有未提交修改、且不再使用的子任务 worktree、集成 worktree 及其分支。发现未提交文件、当前进程仍在其中或 Git 步骤未完成时，保留现场并返回阻塞原因，绝不强制删除。

只提交属于当前 change 的实现和正式文件，保留其他用户改动。执行 Runtime 返回的 `commandArgs` 后，检查工作区收尾结果 `workspaceFinishResult`。结果为阻塞（`blocked`）时，保留现场，并执行 `recoveryArgs` 中的恢复命令。

完成标准：状态为 `done`，用户授权的工作区收尾结果为已完成（`completed`）或已保留（`kept`）；其他结果按 `continuation` 继续。任务结束时，用启动时保存的原始请求、workflow、change 和同一个 session 调用 `comet task --complete`。不要运行 `printenv COMET_TASK` 或读取其他未声明的环境变量来猜测任务内容。
