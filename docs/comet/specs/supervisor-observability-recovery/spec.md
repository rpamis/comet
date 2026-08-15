# Supervisor Observability and Recovery

## 状态投影与恢复边界

- **Given** Supervisor 存在多个 Child、任务和 integration head
- **When** 用户调用 status/show/next
- **Then** 默认输出提供 Child 状态、ready/blocker、任务角色和继续动作，details 才展开分页历史
- **And** 用户可见投影不泄露 runId、commit、绝对路径或内部 mailbox 信息
- **And** continuation 与 Runtime phase/stateVersion 保持一致，v1 children contract 仍可读取

## Runtime 丢失与 Git 对账

- **Given** Supervisor Runtime 文件缺失、中断或版本落后
- **When** Native recovery/doctor 运行
- **Then** 只能从 Git branch/worktree/HEAD/ancestor 事实恢复 integration 绑定
- **And** 没有可移植 Child 验证证据时不得伪造 verified/integrated/archive 状态
- **And** 已完成的 Git merge 不应因状态写入中断而重复合入

## Target 漂移与交付

- **Given** target branch 在 Child 集成期间发生漂移
- **When** Supervisor 刷新或最终交付
- **Then** 漂移只进入隔离 integration branch，target branch 不被修改
- **And** final verification 绑定当前 integration HEAD，漂移后必须回到 pending 并重跑父级检查
- **And** 交付拒绝未集成、未验证、脏或错误 branch/worktree，并在可恢复 blocker 中保留现场

## 冲突、清理与重复执行

- **Given** merge 冲突、dirty/current/subdirectory worktree、未集成分支或进程中断
- **When** integrate/archive/cleanup 重试
- **Then** 返回明确 blocker，不 reset、覆盖或在预检失败时删除任何 Child 文件
- **And** cleanup 先完整预检所有候选，再执行；执行中断必须保留 journal，并可幂等续跑剩余清理
- **And** 重复执行依据 Git ancestor/target 已包含 integration head 的事实安全恢复
