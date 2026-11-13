# Classic Guard 的顺序转换验收

来源：`report:2026-11-10-agent-platform-execution`。

用户已明确每个 workspace 只有一个写入者，不保留普通流程的多写入者互斥。此次只迁移 `classic-executed-checks.test.ts` 中一条参数化声明，对应 source/generated 两个入口；未修改产品代码，也未恢复锁。

原完整文件保存在 `original/` 和 `tests.json`。`mapping.json` 逐条保存原文和当前正文，确认 15 条声明中的其余 14 条完全不变；展开仍为 17 项测试。改动在 `tests.patch`。

原测试的最小复现为 source 失败、generated 通过：source 两个并发请求都返回成功；generated 本次隔离运行未复现。根 Agent 的完整 Classic 模块报告中两项均失败，原日志为 `coverage/final-diff-domain_comet-classic.log`。这属于用户已撤下的并发协议，不宣称产品已修复并发排他。

当前测试沿用原两个 `guard demo verify --apply` 请求，依次提交：第一个必须成功，第二个必须拒绝。保留原 Guard 的 phase/action 参数、恰好一个成功、响应 phase/configuration 都为 Archive、持久 phase 为 Archive 和 `check_epoch` 只消费一次的断言；新增第二次拒绝后原 YAML 字节不变的检查。source/generated 两项实际通过，另外 15 项未选中，没有新增 skip。

核对当前及冻结历史 registry 后，没有有效 selector 指向本次改名的并发声明，因此无需追加迁移节点。共享该文件的三个有效登记保持原样。核查同时发现两个更早的 worker 退休目标已失效，已在 `mapping.json` 单独列出并交给根 Agent；它们并非本次删除或改名，不能以此次迁移掩盖。

实际执行了最小原复现、两个边界的顺序转换测试及受影响文件 Prettier 检查。未运行全量、build、Eval 或实际平台 Hook；本次没有产品变更，不需要重建产物。
