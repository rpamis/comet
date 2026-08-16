# Supervisor 集成与最终交付

## 功能需求

### Scenario: Shape 确认后创建父级 integration workspace

- **Given** 新 Supervisor v2 的 Shape 已确认
- **When** Runtime 开始父级实施
- **Then** Runtime 记录真实 target branch 的起始 commit
- **And** 通过平台 Adapter 创建父级专用 integration branch/worktree
- **And** integration workspace 的身份和基线写入父级 Runtime 状态

### Scenario: 父级最终交付前 target 保持不变

- **Given** integration workspace 已建立
- **When** 任意 Child 实现、验证或集成，或父级 Verify 尚未通过
- **Then** 所有组合结果只进入 integration branch
- **And** 真实 target branch 仍指向父级开始时记录的提交，除非外部产生可识别漂移

### Scenario: ready Child 从当前 integration HEAD 创建

- **Given** 一个 Child 的全部依赖均已 integrated
- **When** Runtime 将该 Child 变为 ready 并创建工作区
- **Then** Child 使用独立 branch/worktree
- **And** 其 base commit 等于当时的 integration HEAD
- **And** 该基线包含所有依赖的 integration commit

### Scenario: 缺少依赖提交时拒绝 Child 执行

- **Given** Child B 声明依赖 Child A
- **When** A 尚未 integrated，或 B 的 base commit 不包含 A 的 integration commit
- **Then** Runtime 拒绝启动、验证或集成 B
- **And** 返回指出缺失依赖事实的可恢复 blocker

### Scenario: Child Verify 绑定准确候选提交

- **Given** Builder 已提交 Child 的候选结果
- **When** 独立 Verifier 通过全部 Child 范围
- **Then** Runtime 记录准确的 verified commit 和结构化 Child 验证记录
- **And** Child 状态变为 `verified`
- **And** Agent 文本结论或未提交工作区不能单独形成 verified 事实

### Scenario: verified 与 integrated 保持分离

- **Given** Child 已在准确 commit 上 verified
- **When** verified commit 尚未合入 integration branch 或合入后的检查尚未通过
- **Then** Child 保持 `verified` 或进入明确 blocker
- **And** 不显示为 `integrated`、`done` 或 `archived`

### Scenario: 父级串行集成 verified Child

- **Given** 一个或多个 Child 已 verified 且依赖满足
- **When** 父级集成器推进队列
- **Then** Runtime 使用短事务锁、Git 引用比较更新和恢复记录逐个处理
- **And** 同一时刻最多执行一个 integration branch 写入
- **And** 每次只合入已记录的 verified commit

### Scenario: 同时完成 Verify 仍按稳定顺序集成

- **Given** 两个无依赖 Child 同时完成 Verify
- **When** 父级选择下一项集成
- **Then** Runtime 使用确定性的稳定顺序串行处理
- **And** Agent 完成先后不改变依赖图或产生并发 merge

### Scenario: 集成检查通过后记录 integrated

- **Given** verified commit 已合入 integration branch
- **When** Git/状态不变量和该 Child 已确认实施责任对应的最小跨模块检查通过
- **Then** Runtime 记录 Child 名称、摘要、verified commit、integration commit、Child 验证记录和检查结果
- **And** Child 状态才变为 `integrated`
- **And** 不在每次 Child 合入后重复运行完整父级检查

### Scenario: 集成冲突保留现场

- **Given** verified commit 与当前 integration HEAD 发生合并冲突
- **When** 父级集成器尝试合入
- **Then** Runtime 停止该集成、保留可诊断现场并返回用户决定 blocker
- **And** 不自动解决冲突、不推进 Child 状态，也不修改真实 target

### Scenario: 全部 Child integrated 前拒绝父级 Verify

- **Given** 至少一个已声明 Child 尚未 integrated 或处于 blocked
- **When** 父级尝试进入最终 Verify
- **Then** Runtime 拒绝进入并指出剩余 Child 与下一动作
- **And** 不以 Child 已 verified 或 Agent 已完成代替 integrated

### Scenario: 父级 Verify 在 integration worktree 验收完整目标

- **Given** 所有当前 Child 已 integrated
- **When** 父级进入最终 Verify
- **Then** Verifier 读取完整 brief、全部目标 Specs、Child 验证记录和最终 integration HEAD
- **And** 在 integration worktree 执行完整父级集成检查
- **And** 对跨 Child、宿主和 workflow 的完整用户目标作出判断

### Scenario: 父级 Verify 失败不污染 target

- **Given** 父级最终 Verify 发现集成结果失败
- **When** Runtime 返回修复循环
- **Then** 真实 target 保持不变
- **And** 允许按已确认范围追加修复 Child 后继续同一 integration workspace
- **And** 已 integrated Child 历史保持不可变

### Scenario: target 漂移触发完整重新集成检查

- **Given** 父级最终交付前真实 target 出现新的提交
- **When** Runtime 检查交付前提
- **Then** Runtime 把最新 target 重新带入 integration workspace
- **And** 重新运行父级 integration checks，不推断只需要验证部分范围
- **And** 新检查通过前不交付

### Scenario: Archive 确认遵循项目配置

- **Given** 父级 Verify 已通过且 integration HEAD 与验证记录一致
- **When** `native.archive_confirmation` 为 `automatic`
- **Then** Skill 不再询问并继续最终交付
- **And** 配置为 `required` 时最多请求一次最终确认

### Scenario: 父级唯一发布最终权威 Specs

- **Given** 父级开始最终交付
- **When** Runtime发布规格和历史
- **Then** 只有父级 Specs 写入 `docs/comet/specs` 成为最终权威版本
- **And** Child scoped Specs、验证记录和 Agent 摘要只保存在父级 Archive 历史中
- **And** Child 不各自发布重叠的权威 Specs

### Scenario: 最终交付一次合入真实 target

- **Given** target 漂移已处理、父级验证仍对应当前 integration HEAD
- **When** Runtime 执行最终 merge
- **Then** integration branch 只合入真实 target 一次
- **And** Runtime 核对 target 已包含最终结果后才继续归档
- **And** 中断重试通过 Git 事实识别已完成步骤，不重复 merge

### Scenario: 父子只在最终交付后统一归档

- **Given** 最终 target 已包含验证通过的 integration 结果
- **When** Runtime 完成 Archive 状态转换
- **Then** 父级和全部 Child 一起变为 `archived`
- **And** 任何 Child 不因自己 integrated 而提前归档

### Scenario: 清理前保护用户工作区

- **Given** Runtime 准备清理 Child 或 integration branch/worktree
- **When** 存在未提交文件、未合入 commit、当前进程位于待删除 worktree 或其他不安全条件
- **Then** Runtime 保留现场并返回明确 blocker
- **And** 不强制删除、重置或覆盖用户文件

### Scenario: Supervisor 依赖修复后的统一 Archive 能力

- **Given** Issue #313 跟踪的 Archive preview 状态一致性能力尚不可用
- **When** Supervisor v2 尝试最终交付
- **Then** Runtime 保持最终交付为 blocked 并指出外部前置能力
- **And** Supervisor 模块不复制一套 Archive preview 或 Portable State 修复

## 非目标

- 自动解决 Git merge conflict。
- 在 Child 集成时修改真实 target 或独立发布最终 Specs。
- 重复实现 Issue #313 的 Archive preview 修复。
