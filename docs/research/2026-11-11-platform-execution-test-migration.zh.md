# 普通执行机制测试迁移

report:2026-11-10-agent-platform-execution

授权来自用户本次明确要求：撤掉普通工作流受管检查运行器、监管进程、PID 绑定、停止握手/回执和历史恢复，并物理删除相关快照与兼容分支。保留业务状态、批准、任务及验收；CLI 自己启动的 Eval、下载保留真实清理责任。

本记录只撤下已删除机制的断言，不将其历史问题标记为修复。原来源、case ID、登记和断言全文保存在同目录的 registry.json / tests.json，原未完成验收不改写为通过。所有保留业务测试继续迁移，不能据本表关闭批准、Archive、恢复或跨 workflow 的业务缺陷。

下表为首批迁移记录；后续节点按 `testMigration.supersededBy` 追加，最终可执行目标以当前登记为准。单写入者与锁退役、配置 PID、归属、旧内容证明和实际 Git 清理的追加审阅保存在 [证据目录](2026-11-11-platform-execution-retirement/)，整体实现与实际验证见 [交付记录](2026-11-11-platform-execution-final.zh.md)。普通工作流锁和 PID 监督已移除；通用 SDK 的实际异步提交、全局安装存储与真实文件事务按各自职责保留。

| 案例                                            | 处理            | 当前契约                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| classic-short-timeout-supervisor-startup        | feature-removed | routes a legacy check invocation to platform work without executing it or claiming a pass；受管命令的整树终止证明 短命令时限不让尚未启动命令的监管器抢先自清理；受管命令的整树终止证明 Windows 等待调用方核对整树终止时保留原监管器身份                  |
| native-531-supervisor-startup-errors            | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| native-531-supervisor-ready-handshake           | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| native-531-check-failure-facts                  | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| native-531-check-pipe-settlement                | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| ci-native-process-regression-worker-isolation   | feature-removed | CI workflows runs CLI-owned process cleanup regressions without competing test workers；does not ship retired Native execution and snapshot implementations                                                                                              |
| native-all-reused-checks-without-child          | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| owned-command-timeout-independent-deadline      | tests-moved     | keeps its deadline when the owner event loop cannot run its timeout timer                                                                                                                                                                                |
| native-pid-free-check-stop-and-legacy-receipt   | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| native-portable-explicit-empty-check-plan       | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| native-portable-orphan-interruption-persistence | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| native-proven-orphan-check-explicit-retry       | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| native-confirmed-stop-probe-reuse               | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| native-lightweight-settled-check-inspection     | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |
| native-normal-stop-reconciliation               | feature-removed | does not ship retired Native execution and snapshot implementations；exposes Agent tasks and acceptance without any managed-check executor or refresh command；preserves real approvals and completes Native platform reports through authorized Archive |

## 完整归档的纯机制文件

- `test/domains/comet-classic/classic-check-defaults.test.ts`
- `test/domains/comet-classic/classic-check-index.test.ts`
- `test/domains/comet-classic/classic-check-manifest.test.ts`
- `test/domains/comet-classic/classic-check-policy.test.ts`
- `test/domains/comet-classic/classic-sdk-execution-origin.test.ts`
- `test/domains/comet-native/native-build-evidence.test.ts`
- `test/domains/comet-native/native-check-branches.test.ts`
- `test/domains/comet-native/native-check-executor-termination.test.ts`
- `test/domains/comet-native/native-check-executor.test.ts`
- `test/domains/comet-native/native-check-owner-recovery.test.ts`
- `test/domains/comet-native/native-check-receipt.test.ts`
- `test/domains/comet-native/native-check-registration.test.ts`
- `test/domains/comet-native/native-check-without-pid.test.ts`
- `test/domains/comet-native/native-confirmed-transition-helper.test.ts`
- `test/domains/comet-native/native-conflict-radar.test.ts`
- `test/domains/comet-native/native-evidence-command-branches.test.ts`
- `test/domains/comet-native/native-evidence-command.test.ts`
- `test/domains/comet-native/native-evidence-projection.test.ts`
- `test/domains/comet-native/native-evidence-retention.test.ts`
- `test/domains/comet-native/native-git-provenance.test.ts`
- `test/domains/comet-native/native-local-execution.test.ts`
- `test/domains/comet-native/native-portable-check-termination.test.ts`
- `test/domains/comet-native/native-repair-runtime.test.ts`
- `test/domains/comet-native/native-repair-stagnation.test.ts`
- `test/domains/comet-native/native-repair-transitions.test.ts`
- `test/domains/comet-native/native-sdk-check-termination.test.ts`
- `test/domains/comet-native/native-shape-review-evidence.test.ts`
- `test/domains/comet-native/native-snapshot.test.ts`
- `test/domains/comet-native/native-supervisor-check-process.test.ts`
- `test/domains/comet-native/native-supervisor-integration-execution.test.ts`
- `test/domains/comet-native/native-verification-receipt.test.ts`
- `test/domains/comet-native/native-verification-scope.test.ts`

## 验证与 Review

替代定向测试的实际报告位于 coverage；未执行项不能记为通过。物理退休补丁和逐行为映射仍需独立 Review，业务混合文件不包含在本次整文件退休中。未启动 Eval。

## 冻结历史登记中的旧机制

- `native-portable-incremental-projection-soundness`：退休已撤下的快照/普通执行入口；改验物理删除及保留批准的真实平台报告流程。
- `native-projection-baseline-reuse-boundaries`：退休已撤下的快照/普通执行入口；改验物理删除及保留批准的真实平台报告流程。
- `issue-410-orphan-check`：退休已撤下的快照/普通执行入口；改验物理删除及保留批准的真实平台报告流程。
- `issue-502-timeout-and-inputs`：退休已撤下的快照/普通执行入口；保留全部未删除文件中的原批准、输入范围和业务断言。

迁移链的旧执行文件允许物理删除，但必须由下一段证据保存完整原断言。当前最终测试文件仍须存在，旧登记、原文摘要和逐行为映射继续逐段校验。专门临时项目测试保留“归档缺失或篡改仍拒绝、最终测试缺失仍拒绝”的反例。

`native-231-manifest-cap` 原状态为 excluded，保持冻结清单原状，不新增覆盖或迁移声明、不视为已解决；其原测试正文仍完整保存在归档中。

## Review 修正

Standards Review 指出的 CI 原文归档缺口已修正：CI 测试正文改为比较基线原文件，保留原测试名及两条旧 checker 路径断言，刷新证据摘要。随后逐文件核对了附加快照；Standards 复核已批准这 32 个机制文件的退休切片。

Spec Review 指出的旧事务 parser 业务断言已拆出：`native-legacy-repair-journal.test.ts` 通过实际 `parseLegacyNativeTransitionJournalValue` 读取入口覆盖 legacy、扩展字段、override 阶段约束和未知字段拒绝，实际 2 项通过，登记 `native-legacy-repair-journal-projection`。没有恢复旧修复运行器。Spec 复核已批准这 32 个机制文件的退休切片。两轴批准不涵盖下面继续迁移的混合业务文件，也不代表整个任务完成。

## 混合业务文件的迁移进度

来源继续为 `report:2026-11-10-agent-platform-execution`。完整旧测试正文保存在本报告关联的 before 文件中，不能只凭新测试名存在就认定等价。

- Archive CAS：原 9 项展开行为通过当前 V2 apply/rollback API 验证，Doctor 恢复改经公开 CLI；原对象替换、隔离副本、外部内容、继续与回滚断言保留。实际 9 项通过。
- Archive 恢复：加载真实 0.5.2 prepared 事务的原字节，使用当前 apply/finalize/recover API 注入中断；保留 15 项崩溃、截尾、内容变化、不可回滚标记与 v1 读取行为。已退休 planner 的 source-copy hook 改在实际 protected-copy 边界注入父目录替换，仍断言原文件、替换文件、未发布目标和 canonical 内容。实际 15 项通过。
- Archive 基本业务：保留 create/replace/remove、无 Spec 归档、其他当前选择、目标已存在、越界 junction 和 canonical 冲突。旧预检指纹、自动刷新检查和递归 Runtime 清理的断言单独退休；当前测试明确保留 Run 历史。实际 7 项通过，不能将旧错误类或旧 evidence.md 投影视为仍受支持。
- Native 文档存储：parser/CAS 使用明确标注的历史文档数据样本；可见布局测试改经当前公开 `new` 入口，不再调用旧创建器。内容基线测试随已删除的快照机制退休。与 Archive、取消业务合跑实际 60 项通过。
- Native Spec 元数据：4 项读取与 mutation 测试使用存储样本；另 1 项加载真实发布版 prepared Shape → Build WAL，核对原批准恢复后才记录删除意图。实际 5 项通过。
- 取消业务：不再核对进程组停止收据；保留未启动子 Run 与已启动后记录丢失的区别。旧原断言先在当前实现得到失败，再恢复业务子 Run 读取，实际 2 项通过。没有新增 PID、进程探测、停止握手或进程恢复。
- 只读查询：不再对账旧布局或第三份投影；测试保留 SDK authority、不改写旧文件、不访问 marker 指向的外部目录、缺失 home 不创建目录、真正 writer 锁、原 Run 身份和 Guard 缺少计划时禁止实现。Classic 与 Native 状态观察合跑实际 30 项通过。由这些测试发现并修复了 Classic 旧本地记录和缺失 home 读取的回归。

Classic 与 Native 主应用的大文件仍在迁移；尚未执行完的名称、旧机制替代映射和独立 Review 必须继续补齐。没有启动全量或 Eval，不宣称本地全部通过。
