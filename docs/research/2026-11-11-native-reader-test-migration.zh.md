# Native 文档、Guard 与取消业务测试迁移

授权来源：report:2026-11-10-agent-platform-execution。用户明确要求移除普通工作流受管执行/停止握手和历史进程恢复，并保留业务状态、批准、原Run和实际事务。

本次仅追加3个tests-moved：native-supported-version-cancellation-ownership、native-236-linked-isolation、native-302-prepare-route。原case完整字段、原tests、既有链保留；后两是冻结历史条目，历史文件不改，只向current catalog的historicalTestMigrations追加id/testMigration。其他parallel/isolation/preparation目标逐项原样保留，不把mixed case整体featureRemoved。

11文件113原声明逐条对应113当前声明，130个展开用例均有定向Temp GREEN。保原Run/claim/state/partialwork、late outcome拒绝、重复取消不破坏新选择、原批准与坏数据/WAL/锁/字节保护。普通cancel不再等待Comet停止回执，也不认证平台进程已停止；由Agent平台核对清理。status跨worktree搜索改为显式projectRoot，实际linked-worktree查询、格式合并、过滤与原其他隔离/准备业务保留。

130来自按边界分别执行的实际报告，不是一次仓库130/0；相对imports另有130项仅收集验证，故意130未选不计业务通过。源报告路径与每条精确passed fullName在mapping.json，完整原11文件及每条body均保留。未受本次修改影响的其他parallel/preparation文件未由本Agent重跑，不把旧Linux报告当作本次当前分支证明。

root-lock cleanup原Doctor healthy=true缺口在原case中复现；root复用取消观察补原cleanup issue后，Temp取消完整10/0。held锁原字节/原Run/用户选择不动，只在夹具原持有者释放其锁后沿原Doctor继续。该业务保护未随stop握手机制退休。

registry.json保存追加前3个完整case，tests.json保存所有有效旧target整文件，tests.patch记录本次11文件差异，mapping.json保存113声明逐行为映射与精确选择器。摘要只用于仓库既有迁移审计格式，不引入Runtime指纹或缓存。

子Agent未修改产品、仓库测试或registry，未运行根build、全量、Eval、安装或真实平台Hook。root合并后仍需当前仓库定向验证和必要构建。
