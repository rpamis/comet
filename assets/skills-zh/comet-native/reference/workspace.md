# Native 工作区参考

## 创建 change

先确定小写 kebab-case 名称，使用配置指定的产物目录。CLI 在创建 change 前完成分支或 worktree 绑定、复用或重建已登记的 change worktree、维护仓库本地排除规则并核对配置；准备失败时保留已经创建的资源，按返回的 `preparation` 原因和恢复方向继续。

只在创建 change 时读取。本节决定工作目录，创建后进入 `preparation.projectRoot`。`comet init` 会按所选 Skill 语言初始化 `native.language`；之后产物跟随项目配置，只有用户明确要求覆盖时才传入 `--language`。

Supervisor Change 中由 `readyChildren` 返回的子任务固定使用独立 `worktree`，并以 Supervisor Change 的 `workspace.changeBranch` 为目标分支；其他 change 在用户已经指定 `current`、`branch` 或 `worktree` 时直接采用。

明确表达并行、同时处理或多个会话时，直接使用 `worktree`，不再询问三种方式。未指定隔离方式且没有明确并行意图时，出现以下任一情况才询问用户：

- 当前目录有未提交工作；
- 已有其他 active Native change；
- 用户要求并行开发或隔离工作，但没有指定方式。

没有这些情况时使用 Runtime 默认的 `current`。

需要询问时，把隔离方式作为一个单选决策点：

| 选项 | 方式                      | 实际影响                                                               |
| ---- | ------------------------- | ---------------------------------------------------------------------- |
| A    | 当前目录（`current`）     | 沿用当前分支和目录，不创建新的 Git 分支或工作目录                      |
| B    | 新分支（`branch`）        | 在当前目录切换到新的 change 分支；要求当前工作区干净                   |
| C    | 新 worktree（`worktree`） | 创建或复用独立分支和工作目录，适合并行 change 或当前目录已有未提交工作 |

展示与当前状态和用户要求一致的全部合法选项，不因预判后续命令可能失败而额外筛选。用户明确要沿用当前分支时推荐 A；需要独立分支且无需并行工作时推荐 B；需要并行开发、当前目录已有工作，或已有 active Native change 时推荐 C。

推荐只作说明，等待用户选择后再创建。已有登记的 `worktree` 与 change 分支绑定时，Runtime 会复用它；分支仍存在但对应 `worktree` 已移除时，Runtime 会重建它。只有分支已重命名、被用户接管或归属无法确认时，必须先读取[工作区恢复](recovery.md#工作区)，再按 Runtime 动作请求用户重新绑定（rebind）。提问前必须读取[提问方式与模式](clarification.md#提问方式与模式)：优先使用结构化单选工具；工具不可用时使用编号文本并暂停等待。只有一个合法选项时，说明原因并直接采用。

## Archive 收尾

只有 `continuation` 允许 Archive 时才继续。Archive 直接使用已经接受的验收结果。`current` 不需要选择工作区收尾方式：展示当前分支和目录，说明不会执行 merge、push 或创建 PR，再按最新 `continuation` 继续。
使用 `branch` 或 `worktree` 时如果需要选择收尾方式，一次展示实际 change 分支、目标分支和目录，并以单选题提供以下全部选项。文本提问必须使用下表；结构化提问必须将“方式”作为短标签、“实际影响”作为说明，不得只显示 `merge`、`push`、`pull-request` 或 `keep`。Archive-ready 的下一步必须先执行 Runtime 返回的完整 `archive --dry-run` 命令；隔离工作区尚未选择 finish 时，等待用户从 `commandAlternatives` 选择带有 `--dry-run --finish` 的命令，不得自行补参数或直接执行 `--confirmed`。dry-run 返回 `ready: false` 时，只处理同一响应列出的阻塞；不要先额外运行 `status`、重复 Archive 或手工提交 Native 的状态/verification 文件。只有 dry-run 返回 `ready: true` 后，才执行它返回的唯一 `archive --confirmed` 命令。dry-run 和 confirmed 都失败时，只按最新结构化 `continuation` 与 `workspaceFinishResult.recoveryArgs` 继续，不从错误文本猜下一步：

| 选项 | 方式                                  | 实际影响                                                                            |
| ---- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| A    | 仅归档并保留工作区（`keep`）          | 完成归档并在 change 分支创建归档提交；不合并、不推送、不创建 PR，保留当前分支和目录 |
| B    | 本地合并（`merge`）                   | 完成归档并创建归档提交，再把 change 分支本地合并到目标分支；不推送、不创建 PR       |
| C    | 归档并推送（`push`）                  | 完成归档并创建归档提交，再推送 change 分支；不合并到目标分支、不创建 PR             |
| D    | 归档、推送并创建 PR（`pull-request`） | 完成归档并创建归档提交，推送 change 分支，再以目标分支作为基础分支创建 PR           |
| E    | 暂不归档                              | 不执行归档或工作区收尾，保留当前仍在进行的 change 和工作区，等待稍后继续            |

用户选择 A、B、C 或 D 后，按 `keep`、`merge`、`push` 或 `pull-request` 的映射执行 Runtime 返回的完整命令；选择 E 后停止。选择 A 表示保留当前分支和目录，同一次归档不得删除该 worktree。其他普通 change 归档后，如有已经归档且没有未提交修改的 change worktree，向用户提供清理选项；Runtime 已清理的无需再次询问。只有用户确认后才执行 `git worktree remove`，存在未提交修改或仍在使用的 worktree 必须保留。
Supervisor 最终交付后，Runtime 只自动清理确认没有未提交修改且不再使用的子任务 worktree、集成 worktree 及其分支；发现未提交文件、当前进程仍在其中或 Git 步骤未完成时保留现场并返回阻塞原因，绝不强制删除。
只提交属于当前 change 的实现和正式产物，保留其他用户改动。执行 Runtime 返回的 `commandArgs`，再检查工作区收尾结果 `workspaceFinishResult`；结果为阻塞（`blocked`）时保留现场，并执行 `recoveryArgs` 中的恢复命令。
完成标准：状态为 `done`，并且用户授权的工作区收尾结果为已完成（`completed`）或已保留（`kept`）；其他结果按 `continuation` 继续。任务结束时复用启动时保存的原始请求、workflow、change 和稳定 session 调用 `comet task --complete`；不要运行 `printenv COMET_TASK` 或其他未声明环境变量来猜测任务内容。
