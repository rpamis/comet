# Archive finish 恢复的编排 fixture

来源：`report:2026-11-10-agent-platform-execution`。本组没有退休业务或修改生产代码；只补齐编排单元测试新增的清理依赖边界。

## 实际原因

原四条精确执行结果在 `coverage/native-archive-command-recovery-original-four-results.json`：**2 通过、2 失败**。两个失败分别是完成 journal 清除、finish 准备仍被阻塞；均在业务断言前抛 `path argument undefined`。

当前 command 在确认的 finish 恢复分支读取原归档记录后，会调用 `nativePortableSupervisorCleanupBinding`，有剩余的原 Supervisor 资源时沿原 receipt 补清理。原测试 mock 的 `configuredPaths` 故意只有 `archiveDir/projectRoot/transactionsDir`，归档记录也由 mock 提供，本来没有完整 Runtime 路径。未被 mock 的新依赖于是进入真实 Supervisor 状态路径解析；这不代表真实项目缺清理或应该绕过清理。

## 变更与边界

对原 workspace 模块做 partial mock，仅替换新清理绑定与清理完成查询，其他导出保留实际实现。本组 fixture 明确表示普通非 Supervisor 的旧归档记录，`nativePortableSupervisorCleanupBinding` 默认返回 null。

原完成 journal 清除、原 blocked retry 的 status/message/conflict/continuation/journal 持久化、SDK-only 参数拒绝、dry-run 和 retry 参数约束全部保留；在两个受影响 case 中另核对新清理边界使用原 projectRoot 和原 archived/done 记录。没有将真实 Supervisor 场景默认设为无资源，也没有改写或放宽真实 UserOptions 的清理、中断恢复或生成 bundle 验证。此编排单元证据不能代替那些真实 Git/worktree 清理证据。

修改后同四条在当前源码实际 **4 通过、0 失败、0 未选择**：`coverage/native-archive-command-recovery-current-four-results.json`。

## 原文、登记与 Review

修改前完整文件保存在 `native-archive-command-recovery.test.ts.txt` 和 `tests.json`；`declaration-mapping.json` 保存四条完整旧/新正文和逐行为说明。原四标题和测试文件不变，其他测试没有修改。`tests.patch` 可通过当前树 reverse check。

`registry-target-audit.json` 使用正式迁移链解析器核对全部 current/covered historical 案例，原文件在原链和有效末端均为 **0 引用**。无需 testMigration/CAS 追加，没有修改任何 ID、sources 或其他 target/历史链。

Prettier 与 reverse patch check 通过。未修改生产代码、未构建、未运行其他 Native 测试、真实平台 Hook、Eval、模型或容器。
