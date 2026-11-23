# 撤下项目记忆的来源内容校验

授权来源 `report:2026-11-23-retire-stale-source-ci`。用户在 PR #585 的 CI 排查中明确要求撤下旧断言。行为变更见 [#584](https://github.com/rpamis/comet/issues/584)，原始 CLI 错误报告见 [#506](https://github.com/rpamis/comet/issues/506)。

旧测试要求任意来源内容改动都让已保存的记忆回执失效。当前约定允许来源文件继续演进，记忆仍以保存的内容和归属供 Agent 读取。删除已保存的记忆后，相同回执必须失效。请求展开不存在的记忆时，CLI 仍须返回 `TASK_FAILED`，并避免输出 Node 异常栈。

原登记、改动前的完整测试文件、测试差异和新的选择器随本文归档。`task-unavailable-context-cli-diagnostic` 继续在真实 helper 进程中执行上述两条回归。旧的内容变更拒绝断言仅保留在归档，供 PR Review 核对。
