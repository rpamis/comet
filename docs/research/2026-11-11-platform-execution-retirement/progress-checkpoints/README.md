# 进度内容快照测试退休

来源：report:2026-11-10-agent-platform-execution。

用户要求物理撤掉普通执行所依赖的内容快照和历史恢复。三个原测试文件只验证 `comet.native.progress-checkpoint.v1`、内容 manifest 及其提交 journal；完整原文保存在 tests.json，删除差异保存在 tests.patch。两个回归登记文件没有指向这三个文件的选择器。

当前 `native-platform-execution-retirement.test.ts` 明确检查四个相应实现不再随构建发布。这里没有退休 Native transition WAL、SDK portable Run checkpoint 或 Archive WAL，它们的原批准、事务恢复和写锁反例继续保留。

Spec 与 Standards Review 均已核对上述边界、原文及删除差异。当前构建后的退休契约与发布版业务升级、Doctor 和正文保留测试合计 32 项通过。原测试退休不表示旧内容快照故障已修复，也不提供模型执行效果证据。
