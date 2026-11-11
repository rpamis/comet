# 第二轮完整测试：归档短暂占用与进程停止期限

第二轮沿同一源码运行，完整日志为 `coverage/platform-execution-full-suite-round2.log`，JSON 为同名 `.json`：731 个文件中 727 通过、2 失败、2 跳过；8755 项中 8639 通过、2 失败、114 跳过。耗时 3248.66 秒，实际退出 1。测试期间没有修改受测源码，没有另起完整测试。

两个失败文件各一项：

- `Native portable Archive repairs the finish receipt after a verified manual commit without creating another commit`。同文件其余 25 项通过；独立单项通过，保持前四项原顺序的检查也通过。相关报告为 `coverage/platform-execution-round2-manual-finish-repro.json`、`coverage/platform-execution-round2-manual-finish-order.json`，不能据此宣称失败已修复。
- `keeps its deadline when the owner event loop cannot run its timeout timer`。同文件其余 21 项通过；独立单项通过，报告为 `coverage/platform-execution-round2-owned-deadline-repro.json`。这是 CLI 自己启动的进程清理责任，不能按普通运行器退休处理或跳过断言。

`original-tests.json` 保存定位和修改前两个测试文件的完整正文。单项重跑通过不作为修复证据。

## 归档目录移动

原失败是 `native-portable-archive.ts` 将 active change 移至 archive 时，Windows 返回 `EPERM`，尚未进入提交消息拒绝及人工提交恢复。不能把它描述成提交恢复缺陷；没有保留下导致占用的外部句柄，无法确定是哪个外部程序临时持有目录。

修复仅复用已有 `platform/fs/transient-retry.ts` 的 `renameWithRetry`，最多四次、总退避 350ms；其他 Native 归档和原子写入已使用相同适配器。没有新增锁、进程监管或恢复框架。持续失败仍抛出原错误，保留 `report-aligned` 事务与原目录；解除占用后继续同一事务。

新增两个真实归档事务边界的故障注入测试：一次 EPERM 后成功；持续 EPERM 保留原事务、解除后续行。首轮 RED 的短暂占用案例确实因原始 `fs.rename` 抛出 EPERM；该轮持续占用测试的事务读取参数写错，属于测试错误，已改为原 API 的 `{ kind, change }` 参数，不能把这一项的首次失败算作产品 RED。修复后两项与原人工提交恢复测试一起实际 3 通过，报告 `coverage/platform-execution-round2-archive-sharing-green.json`。原人工提交、原 HEAD 不变及无重复提交断言保留。Standards 复核未见阻塞。

后续完整归档测试文件 28 项全部通过，报告 `coverage/platform-execution-round2-archive-file-green.json`。Native 及依赖该代码的 Entry Runtime 已重建，`tsc --noEmit`、lint / architecture（9 个已有警告、0 错误）、最终 `check:generated` 和受影响文件 Prettier 检查通过。登记新增 `native-archive-transient-directory-sharing`，537 个案例结构与原迁移证据检查通过。初次直接调用登记模块未带发布专用参数而被正确拒绝，随后使用其结构与迁移校验 API 通过；未把发布附加验收作为已完成。第一次生成物检查指出 Entry 产物陈旧，重建 Entry 后最终检查通过。

官方 `pnpm test:core-regressions --case native-archive-transient-directory-sharing` 实际执行 6 项通过，聚合验证仍退出 1：同文件的旧登记还要求已退休的 `keeps a completed non-repeatable check when an alias or stale Verifier request attempts replay`。旧登记迁移仍需补齐，不能将结构校验或文件测试通过当作官方回归入口通过。只读比对完整第二轮报告与最终选择器的审计保存在 `coverage/platform-execution-round2-registry-missing-audit.json`；其中也包含第二轮之后才新增的两项测试，必须逐项区分，不能按名称缺失批量删除历史要求。已交独立 Spec 复核；本记录不宣称整个回归登记已通过执行验证。

## CLI 自有进程的期限

这个进程适配器当前用于 CLI 自己启动的 Eval 和下载，不在普通 Native/Classic 归档路径中。本次没有启动 Eval。

原失败确实存在 5.5 秒的 `timer-late` 文件。只读诊断通过临时 bundle 记录时间，没有修改产品代码或原断言：4 并发 12 次、12 并发 36 次均未出现 marker；24 并发两轮 48 次中 10 次出现。当前明细 `coverage/owned-deadline-diagnosis.json`，完整日志 `coverage/owned-deadline-diagnosis-24.log`。在失败样本中，监管器超时计时只晚 1–18ms，但 taskkill 整树清理完成需 821–1058ms；marker 在停止已发起、原调用方仍堵塞时写出。证明清理延迟可以产生同症状，不能据此推断首轮未采样的具体 OS 调度。

现有 Node + taskkill 没有 Windows 硬实时停止保证。不能把提前缩短用户 timeout、先杀命令根而丢失后代、或新增 Job/监管框架当作本次修复；也不能只推迟 marker 并宣称原保证已修复。Spec 独立复核明确指出因果测试与固定 500ms 无写入承诺不等价。

### 已获用户确认的具体验收调整

建议保留用户配置的命令时限，语义为“到期独立发起停止；实际整树清理确认之前不能返回已停止”。普通工作流仍完全交给 Agent 平台。本项不新增产品进程机制。

拟将该进程测试调整为以下可观察行为，并显式保留原失败与断言全文、登记迁移并复核：

1. 通过真实 `runOwnedCommand` 启动有真实后代的命令，在开始后让调用方事件循环持续堵塞。
2. 测试进程独立观察命令及后代，在调用方仍堵塞时确认两者已停止，证明并非依赖调用方恢复后才发起清理；失败须收集 PID、心跳与堵塞状态。
3. 调用方恢复后必须收到 `timeout` 且实际清理确认成功；停止确认后心跳不再增长，不能将未确认结果记为已停止。
4. 保留实际 taskkill 失败、后代未停止、PID 已退出不能重用及清理竞态等现有反例。

该调整撤回“固定截止后 500ms 内不产生任何副作用”的量化承诺，属于验收语义变化。用户已明确答复“按建议调整验收，保留真实清理确认”。实际变更、原断言、同一新断言的真实基线 RED、当前 GREEN 和 22 项完整进程测试通过记录保存在 [批准后的验收记录](approved-timeout/README.zh.md)。第三轮完整测试尚未启动，仍须完成最终登记和复核。
