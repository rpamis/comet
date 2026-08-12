# Native 工作区选择参考

只在创建 change 时读取。Supervisor Change 的 `readyChildren` 固定使用独立 `worktree`，并以 Supervisor Change 的 `workspace.changeBranch` 为目标分支；其他 change 在用户已经指定 `current`、`branch` 或 `worktree` 时直接采用。

明确表达并行、同时处理或多个会话时，直接使用 `worktree`，不再询问三种方式。未指定隔离方式且没有明确并行意图时，出现以下任一情况才询问用户：

- 当前目录有未提交工作；
- 已有其他 active Native change；
- 用户要求并行开发或隔离工作，但没有指定方式。

没有这些情况时使用 Runtime 默认的 `current`。

需要询问时，把隔离方式作为一个单选决策点：

| 选项 | 方式 | 实际影响 |
| --- | --- | --- |
| A | 当前目录（`current`） | 沿用当前分支和目录，不创建新的 Git 分支或工作目录 |
| B | 新分支（`branch`） | 在当前目录切换到新的 change 分支；要求当前工作区干净 |
| C | 新 worktree（`worktree`） | 创建或复用独立分支和工作目录，适合并行 change 或当前目录已有未提交工作 |

展示与当前状态和用户要求一致的全部合法选项，不因预判后续命令可能失败而额外筛选。用户明确要沿用当前分支时推荐 A；需要独立分支且无需并行工作时推荐 B；需要并行开发、当前目录已有工作，或已有 active Native change 时推荐 C。

推荐只作说明，等待用户选择后再创建。已存在的 change 分支如果已经登记在 Worktree 中，Runtime 会复用它；如果分支仍存在但登记 Worktree 已被移除，Runtime 会重建它。只有分支已重命名、被用户接管或归属无法确认时，才按恢复协议请求 rebind。提问方式遵循[澄清参考](clarification.md)：优先使用结构化单选工具；工具不可用时使用编号文本并暂停等待。只有一个合法选项时，说明原因并直接采用。
