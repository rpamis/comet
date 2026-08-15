# 目标

# 范围

# 非目标

# 验收示例

# 约束与不变量

# 决策

# 待解决问题

# 验证预期
# Supervisor Agent Coordination

## 目标

补齐 Supervisor 的 Builder/Verifier 任务协调协议：每个 Child 任务都携带稳定的角色、Child、projectRoot、baseCommit 与 runId，支持有限并行、串行降级、重连、取消和重试，同时保持父级 Runtime 对生命周期的单一事实来源。

## 范围

- 生成可验证、可重连的 Builder/Verifier 任务包。
- 按 `maxParallel` 派发无依赖阻塞的 Child，并在容量或宿主能力不足时安全串行。
- 对重复 dispatch、过期 runId、错误角色、错误 worktree/baseCommit 做拒绝或幂等处理。
- 记录取消、重连、失败重验证等审计事件，保留待恢复现场。

## 非目标

- 不实现外部 Agent mailbox、调度服务、供应商证明或远程执行。
- 不改变当前 `children.v1` 的父级兼容边界。
- 不允许 Child 直接写入真实 target，也不绕过父级 integration workspace。
