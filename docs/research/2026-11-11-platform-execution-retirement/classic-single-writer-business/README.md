# Classic 单写入者业务测试迁移

来源：`report:2026-11-10-agent-platform-execution`。用户补充的架构前提是每个 workspace 只有一个写入者，Child 只写自己的 worktree，父 Agent 串行提交结果。普通流程不再提供多个调用者同时修改同一状态的串行锁协议。

本组只改两份测试中的三条声明，没有修改生产代码、添加锁、缓存或新的协调机制。两份修改前完整正文保存在同名 `.ts.txt`，`tests.json` 另保存原文件内容；`declaration-mapping.json` 逐一记录全部 13+8 条原声明，三条混合业务声明保留业务、撤下并发写入要求，其余 18 条正文未变。参数展开后原两文件共 34 项，不把本轮只选择三项说成整组通过。

## 三条行为

1. `serializes concurrent evidence sequence allocation` → `preserves successive evidence records and sequence allocation for one writer`。原四个报告输入不变，逐个 await；保留 1/2/3/4 唯一序号及最新报告选择，补核对原 trajectory 中每条 command、exitCode、scope、runId 均已持久化。这里是接收并保存 Agent 报告的内部 API，`check-0` 等文本没有被 Comet 执行；不能把此测试称为真实检查执行证明。相邻平台真实结果测试正文不变。
2. `serializes concurrent updates without dropping unrelated fields` → `preserves unrelated fields across successive updates by one writer`。原两次公开 CLI 配置请求逐个 await，保留全部四项最终值，后次更新不能抹掉先前的 build/tdd 决定。
3. `lists stable tasks and serializes completion without losing another task update` → `lists stable tasks and preserves previous completions for one writer`。保留 Open 阶段完成拒绝、两个任务全部完成、未知任务不改文件的原断言。新增逐次读取核对原稳定 ID 及先前的 checkbox；重复完成原任务成功且任务正文完全不变，禁止重复追加完成内容。当前 `revision` 输出已不存在，原测试中的 undefined 相等不提供内容 revision 证据；旧 `--expect` 参数仍被兼容接收，不能将此测试称为保留旧内容 hash、revision CAS 或多写入者保护。

## 执行证据

- 原三条正文在当前无锁源码实际复现：`coverage/classic-single-writer-original-three-results.json`，**0 通过、3 失败、31 未选择**。分别出现 trajectory 提交前变化、并发配置覆盖无关字段、两个任务只完成一个。这些是已撤下多写入者协议的原用法，不能宣称仍支持并发写入。
- 相同请求改为串行，保留并加强上述业务断言：`coverage/classic-single-writer-current-three-results.json`，**3 通过、0 失败、31 未选择**。证据序号使用内部 `recordCommandCheck`；配置和任务使用源码公开 `runClassicCli`。
- 仅在 Temp 将同两条 CLI 测试的 adapter 换为真实进程调用当前 `assets/skills/comet/scripts/comet-runtime.mjs`，正文和业务断言不变：`C:/Users/BENYM/AppData/Local/Temp/classic-single-writer-business-20261111/coverage/classic-single-writer-generated-two-results.json`，**2 通过、0 失败、11 未选择**。该 bundle 已由父 Agent 构建，本组没有构建或自动触发构建。Temp adapter 将兼容旧参数中的 undefined 转为 argv 文本，不以该被忽略的值证明 revision 语义。内部证据记录 API 不具备相同 generated 入口，本组不宣称它有生成物证据。
- 两份测试的 Prettier 检查通过；`git apply --reverse --check tests.patch` 通过。

## 登记审计与 Review 结论

`registry-target-audit.json` 使用当前正式迁移链解析器核对增量案例，以及所有 covered 历史案例及其已登记后续迁移。两文件在原链和末端共出现 303 个 file target；匹配本次三个原标题的有效末端为 **0**。其他有效目标全部保留原文件、标题和正文，因此不需要追加 testMigration，也不创建新 ID。没有删除、改写或缩短现有 registry 链。历史未覆盖案例没有被本审计改称已覆盖。

Spec 结论：可撤下这三条声明中的多写入者串行化要求；不能撤下原报告留存、递增序号、用户配置、稳定任务 ID、逐条勾选和拒绝错误阶段/未知任务写入的业务边界。本次当前断言和实际执行均保留这些边界。完整原文、逐声明映射及有效 target 审计齐备，可纳入父 Agent 的退休 Review；此记录不替代父 Agent 的独立审查。

未执行：修改后的两文件完整 34 项未重跑，未运行仓库全量测试、真实平台 Hook、Eval、模型或容器，也未执行本轮构建。未改 Changelog/版本号，因为本组只有测试迁移，没有额外用户可见能力变更。
