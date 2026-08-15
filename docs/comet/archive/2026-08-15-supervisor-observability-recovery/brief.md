# 目标

复核并交付 Supervisor 的可观测状态、故障恢复和最终交付边界，让用户能从 Native status/next 看到 Child、任务、阻塞、集成和最终验证的真实状态，并能在 Runtime 丢失、进程中断或 target 漂移后安全恢复。

# 范围

- 对齐 `supervisor` 父级状态与三层事实：Child verification、integration branch、parent final verification。
- 覆盖 status/show/next/archive/doctor 的 Supervisor 输出、continuation 与恢复提示。
- 覆盖 Runtime 丢失后的 Git 事实重建、target 漂移刷新、重复交付、冲突保留和清理保护。
- 复核 Dashboard/CLI 使用的稳定字段、脱敏规则和 v1 children contract 兼容性。

# 非目标

- 不新增外部调度器、mailbox、供应商证明或新的并行模型。
- 不把父级现有 `comet.native.children.v1` contract 迁移到 v2。
- 不改变已经归档的 Child 实现内容；只修复可观测与恢复语义。

# 验收示例

- status 默认输出只包含可行动摘要，details 才分页展示历史，并隐藏 runId、commit 和绝对路径等内部字段。
- Runtime state 缺失时只能依据 Git 重建 integration branch/worktree 与 pending/reverify 边界，不伪造 Child 通过证据。
- target 漂移只合入隔离 integration branch，target 本身不被修改，final verification 回到 pending。
- merge/cleanup 中断、冲突、dirty/current/subdirectory worktree 或未集成分支时保留现场并返回 blocker，不部分删除。
- 交付必须满足所有 Child integrated/archived、最终验证绑定当前 integration HEAD、target 与 integration clean；重复执行由 Git ancestor 事实恢复。

# 约束与不变量

- 父级 Runtime 是状态、审计和 continuation 的唯一持久化来源；Git 是 branch/worktree/HEAD/ancestor 的事实来源。
- 所有用户可见状态必须与 v1 children contract 兼容，机器文件继续位于 `.comet/runtime`。
- Recovery 不能 reset、覆盖、删除脏或当前 worktree，也不能把未验证提交写入 integration；cleanup 执行中断必须留下可幂等续跑的 journal。

# 决策

- 以现有 Native Supervisor/runtime 实现为交付基线，进行端到端验证和必要的最小修补。

# 待解决问题

- 若既有实现与上述语义不一致，必须补回归测试、生成 Native bundle，并在归档前完成独立只读复核。

# 验证预期

- 运行 Supervisor 状态、恢复、CLI surface、Dashboard/portable status 相关测试，执行 TypeScript、Native runtime generated check；全量测试沿用仓库已知基线并明确记录。
