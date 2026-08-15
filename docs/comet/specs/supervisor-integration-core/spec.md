# Supervisor 集成核心

## 功能需求

### Scenario: 父级拥有隔离的 integration workspace

- **Given** 父级 Shape 已确认且 target branch 有有效提交
- **When** Runtime 开始 Supervisor Build
- **Then** 创建专用 integration branch/worktree
- **And** 记录 target 起始 commit、integration branch、worktree 和当前 HEAD
- **And** Child 不直接写入真实 target

### Scenario: Child 基线遵循真实依赖

- **Given** Child 的所有 `depends_on` 已 integrated
- **When** Runtime 派发该 Child
- **Then** Child worktree 的 base commit 等于当前 integration HEAD
- **And** 未满足依赖或 base commit 不包含依赖集成结果时拒绝执行

### Scenario: verified 与 integrated 分离

- **Given** Child Builder 已提交候选
- **When** 独立 Verifier 在准确 commit 上通过检查
- **Then** Runtime 记录 verified commit 和结构化验证证据
- **And** Child 进入 `verified`，但未合入 integration 前不能显示为 `integrated` 或 `archived`

### Scenario: 父级串行集成已验证 Child

- **Given** Child 已 verified 且 integration worktree clean
- **When** 父级集成器推进 Child
- **Then** 只合入已记录的 verified commit
- **And** 同一时刻最多一个 integration branch 写入
- **And** 集成检查通过后记录 Child、摘要、验证证据、integration commit、检查结果和风险

### Scenario: 集成冲突保护现场

- **Given** verified commit 与 integration HEAD 冲突
- **When** Runtime 尝试集成
- **Then** 保留冲突现场并返回 blocker
- **And** 不自动解决冲突、不推进 Child 状态、不修改真实 target

### Scenario: 最终交付只发生一次

- **Given** 全部 Child integrated，父级验证对应当前 integration HEAD 且 target 漂移已处理
- **When** Runtime 执行最终交付
- **Then** integration branch 只合入真实 target 一次
- **And** 复试从 Git 事实识别已完成 merge，不重复写入
- **And** target 已包含最终结果后父子才统一归档并安全清理 worktree/branch

### Scenario: 交付边界保护用户文件

- **Given** target、integration 或待清理 Child worktree 存在脏文件、未合入提交或当前进程正在其中
- **When** Runtime 尝试交付或清理
- **Then** 保留现场并返回明确 blocker
- **And** 不强制删除、重置或覆盖用户文件

## 非目标

- 自动解决 Git merge conflict。
- 为 Child 单独发布最终权威 Specs。
