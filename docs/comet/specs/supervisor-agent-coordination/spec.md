# Supervisor Agent Coordination

## 任务包保持完整绑定

- **Given** Parent 已确认 Child contract 且依赖满足
- **When** Runtime 派发 Builder 或 Verifier
- **Then** 任务包必须同时包含稳定角色、Child 名称、projectRoot、baseCommit 与唯一 runId
- **And** Builder 的 baseCommit 等于当前 integration HEAD，Verifier 的 baseCommit 等于已记录 candidate/verified commit
- **And** 角色、Child、worktree、分支或 runId 不匹配时拒绝接收结果

## 有限并行与串行降级

- **Given** 多个 Child 已 ready 且互不依赖
- **When** Runtime 派发任务
- **Then** 并行数不超过 `maxParallel`，默认上限为 2
- **And** 宿主不支持并行或容量不足时按依赖顺序安全串行，不改变集成顺序
- **And** `comet native next <change> --max-parallel 1` 明确选择串行，默认值为 2

## 重连、取消与重试

- **Given** 任务进程中断、重连或取消
- **When** Runtime 收到带 runId 的操作
- **Then** 只允许当前 runId 重连或取消，并写入可持久化审计事件
- **And** 旧任务结果不得推进新 runId 的状态
- **And** Builder 失败可回到 ready，Verifier 不完整可进入 needs-reverify 并复用 candidate，不重复构建
- **And** Runtime 通过 `supervisor-reconnect`、`supervisor-cancel` 与 `supervisor-builder-failure` 输入持久化这些操作，而不是只提供内存函数

## 现场保护

- **Given** 任务身份、baseCommit 或 worktree 状态不一致
- **When** Runtime 尝试派发、重连或接收结果
- **Then** 返回明确 blocker，不重置、覆盖或删除 Child 文件
- **And** 所有任务仍通过父级 Runtime 持久化，不依赖外部 mailbox 或调度器
