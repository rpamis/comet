# 目标

为 Supervisor 父级提供 integration-first 的集成核心：父级拥有独立 integration branch/worktree，Child 在准确的 integration HEAD 上实现和验证，父级串行集成已验证提交，并在最终交付前保护真实 target。

# 范围

- 支持精简 `children.v2` 计划的确定性校验，同时保持现有 `children.v1` 读取兼容。
- 创建并维护父级 integration workspace，记录 target 起始提交、integration HEAD 和 Child 依赖基线。
- 分离 Child 的 `verified`、`integrated` 与最终 `archived` 生命周期。
- 绑定 verified commit、Child 验证证据、集成检查和 integration commit；冲突或事实不一致时保留现场。
- 在全部 Child 集成且父级验证通过后一次性交付真实 target，并安全清理不再使用的工作区。

# 非目标

- 不实现通用 Worker scheduler、Agent Team、mailbox 或嵌套 Supervisor。
- 不自动解决 Git 冲突，不修改平台 canonical registry。
- 不改变 Classic workflow，也不复制 Issue #313 的 Archive preview 修复。

# 验证

- 覆盖真实 linked-worktree 的父级 workspace、依赖基线、Child Verify、串行集成、target 保护、最终交付和中断恢复。
