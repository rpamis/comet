# Classic 0.5.3 Runtime 成本审计

审计时间：2026-11-10。分支 `053`，HEAD `630ce380787f446e803f94b4b90cbbdbf8663364`。本轮只读核对 Classic 生产源码与内置 Skill；不修改产品实现，不覆盖工作区已有的 #545 修改。结论区分新 v2、旧 v1/Compat 和固定应用；不能因为某文件在 bundle 中存在，就推断新流程一定执行它。

## 结论

Classic 的 PID 机制没有完全移除。新 v2 已不再执行普通受管检查，但创建、状态投影和部分任务命令仍调用 `platform/fs/plugin-store.ts` 中的旧 PID 文件锁。这不是只读兼容字段，也不是 SQLite 锁的转发。应先消除这条活跃路径，再考虑删旧协议和重复材料管理。

复核历史设计后，撤回“整体删除任务勾选 CLI”和“删除执行方法选择状态”的建议。前者承担稳定任务身份、准确勾选、恢复及完成检查；后者记录用户已经确认的执行约定。应优化重复提交、旧 PID 锁和多份状态对账，不以减少命令数量为由撤下这些职责。

## 1. 新 v2 仍使用旧 PID 锁

当前存在两套同名锁实现：

- `platform/fs/recoverable-file-lock.ts:104` 使用 SQLite `BEGIN IMMEDIATE`，进程退出释放事务。
- `platform/fs/plugin-store.ts:94` 每次获取锁前都在第 105 行调用 `readProcessIdentity(process.pid)`，随后写入 `pid`、`nonce`、`createdAt`、`hostname` 和可选 `processIdentity`。有旧锁时，第 155 行按记录 PID/创建身份探测；还保留 10 秒空文件宽限和 5 分钟损坏文件宽限。

Classic 的四个生产模块仍导入第二套实现：

| 模块                           | 活跃用途                                                    | 当前调用位置                       |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------- |
| `classic-runtime-ownership.ts` | 创建或恢复 change 时串行登记所有权                          | 导入第 13 行，获取锁第 167 行      |
| `classic-sdk-state-store.ts`   | SDK Run 提交后同步 YAML、checkpoint 和投影 marker           | 导入第 23 行，获取锁第 631 行      |
| `classic-runtime-paths.ts`     | 缺少 change ID 时分配身份；路径绑定建立或变更时检查重复身份 | 导入第 11 行，获取锁第 121、268 行 |
| `classic-store.ts`             | Compat 状态操作；SDK 设计任务 ID 和任务进度命令也会使用     | 导入第 23 行，获取锁第 90 行       |

这不是只有旧 v1 才能触发：`classic-state-command.ts:773` 的 init 先进入所有权锁，第 824 行创建 SDK Run；`classic-sdk-create.ts:14` 导入并在第 38 行调用 `defineClassicAgentWorkflowApplication`，新建的就是 v2。它使用的 `createClassicSdkStateStore` 在正常 CAS 后仍可进入上述投影锁。

局部成本证据由本轮主审计的 Windows 隔离探针取得：每轮使用独立进程，模块导入完成后计时单次无争用锁调用，三轮旧锁为 83.16/83.38/82.76 ms，新 SQLite 锁为 10.92/10.17/10.73 ms。旧锁实际 owner 字段含 PID/主机/创建身份，新锁没有。该结果不含 Node 和模块冷启动，不是端到端流程提速比例，也不能推断一条命令必定消耗数个 83 ms。

建议：让 `plugin-store.ts` 的文件存储保留存储职责，锁统一委托无 PID 的实现；删除它自身的 `PluginStoreLockOwner`、`recoverAbandonedLock`、创建身份探测、旧 PID 存活判断和按年龄回收规则。迁移旧锁时确认实际操作停止，不能把“探测不到 PID”改成“可以重放副作用”。锁本身仍保护真实的并发写入，不应改成由 Agent 口头承诺串行。

## 2. 普通受管检查已经退出新 v2，不能重复计算收益

`classic-sdk-application.ts:2373` 的 v2 工厂先构造 v1 应用，第 2378 行移除 `.build.check`、`.verify.check` 及对应 evidence 步骤。Build 结果直接进入 Verify；Verify 使用 Agent 提交的 `checks`/`checksReason`。`classic-check-command.ts:167` 明确拒绝对 v2 调用旧受管检查，要求 Agent 通过平台工具执行。

因此，不能再把“由 Agent 自己跑普通测试”列成 v2 尚未实现的优化。当前残留成本主要是 v1/Compat/固定应用的兼容源码、工厂装配和 bundle 内容，以及 v2 尚存的外围状态管理。

若决定不再执行旧 Runtime 协议，可以删除下列旧检查链，而不是继续扩展其收据、准备动作和恢复分支：

- `classic-check-command.ts` 中的 v1 prepare/执行/evidence 流程；
- `classic-command-checks.ts`、`classic-sdk-check.ts`、`classic-sdk-check-preparation.ts`、`classic-sdk-check-record.ts` 等检查执行与结果证明链；
- v1 应用中的 build/verify check 步骤和固定定义兼容装配；
- 仅为这些检查提供的命令入口、生成 bundle、文案和历史迁移分支。

条件：先规定旧 v1、Compat 和已固定的应用包如何继续或退出。v2 的新建默认值不等于旧 Run 自动升级。保留历史只读记录和一次性迁移通常比长期携带多套执行器更合适，但这是公开兼容承诺的变更；不能直接删掉原执行器并声称旧 Run 保持可恢复。

## 3. 保留任务勾选 CLI，优化重复调用与兼容投影

内置中文 Build Skill `assets/skills-zh/comet-build/SKILL.md:30` 仍要求任务 ID、勾选和协调进度使用 `state tasks`、`state task-complete`、`state checkpoint`。这些命令不推进 SDK Run。

`classic-state-command.ts:1307` 起的 `taskState` 即使面对 SDK Run，也会重新读取状态、检查分支与阶段、读取解析 tasks.md、分配或校验隐藏任务 ID、同步另一个计划文件，最后获取状态锁写入。第 1495 行起还另行维护任务 checkpoint。`classic-sdk-design.ts:117` 起的提案准备也先锁定并给 tasks.md 写入自动 ID。

历史来源 `docs/comet/archive/2026-09-09-optimize-classic-efficiency/brief.md` 的 Scope 7 和 A7 明确要求统一完成状态与稳定身份，避免新增、重排、重命名或恢复时勾错任务；该 change 保留了用户确认。提交 `7b05435a` 同时加入 task/progress 模块与恢复指引，明确“任务未勾选不等于尚未实现”，先核对已有实现再补记，避免重复实施。现有 `validateClassicTaskPlan` 也禁止新计划建立第二套 checkbox 账本，只有旧计划才同步明确的 ID 映射。

保留 task CLI、稳定 ID、唯一 tasks.md 权威和 Build 完成检查。`classic-sdk-application.ts:730` 的 `assertClassicBuildReady` 实际拒绝空任务列表或任一未完成项。CLI 支持准确、幂等勾选，完成检查阻止漏更新后继续推进；CLI 本身不能保证 Agent 总记得调用，也不能证明实际代码已完成。

可优化的是已完成项重复提交、无变化时重复列举、旧 PID 锁以及只为旧计划保留的兼容投影。`classic-completed-task-progress-guidance` 已登记“全部完成后仍重复 task-complete、从错误字段取得 None ID”的真实轨迹，适合按该具体问题减调用。没有测量证明手工编辑同样可靠且更便宜，不再据调用数量推荐整体撤下。未找到当初用户以“Agent 忘记打勾”为原话的记录，不能将该动机写成已证实的唯一来源。

同一 Skill 行还说 `complete-build` 后“由 Run 进入检查 Action”，这与新 v2 已移除普通受管检查不一致。后续应同步新旧流程描述，避免 Agent 因旧指令多走无效 CLI。

## 4. 重复状态投影应收缩为外部交接快照

`classic-sdk-state-store.ts` 约 740 行承担了 SDK Run 与可编辑 YAML 的双向同步、portable checkpoint、本地投影 marker、遗留恢复和分支补绑定。

- 第 61 行仅允许 YAML 导入 language、contextCompression、autoTransition、reviewMode 四类用户配置。
- 第 357 行的 `syncStateFile` 同时核对权威 Run、YAML 字段和 marker；第 471 行起计算导入字段与冲突，必要时新增一次 CAS；第 549 行起核对 checkpoint。
- 第 587 行起将完整 checkpoint 编码进 YAML，随后另写 marker；第 631 行持有旧 PID 锁。
- 第 636 行起普通 store.read 会先尝试 marker 快路；不匹配再同步。第 717 行的 v2 内部投影延后已经减少重复写入，不能忽略这项已实现的优化。

建议保留单一 SDK Run 为推进权威；用户针对当前 change 选择的配置与批准必须原样持久化，不能一概搬成项目默认值。配置修改可通过明确入口更新该 Run，YAML 可评估改为只读摘要；portable checkpoint 保留真实交接和恢复需要。删除正常读取中的配置反向导入与自动修复投影职责前，需先明确可编辑 YAML 的兼容变化。

这需要调整当前“可编辑 YAML”和便携恢复契约。不能直接去掉 YAML 中唯一的跨设备恢复事实；真正的恢复快照必须仍绑定原 Run、决定和未完成副作用。此项属于设计建议，未实施、未测量端到端收益。

## 5. 执行方法是用户决定，保留选择及批准状态

当前 Full Build 仍把执行方法固化成 `subagent-driven-development`、`executing-plans`、`direct`、`autonomous`，同时配置 tdd/review 模式（`classic-sdk-build.ts:21`）。`classic-plan-readiness.ts:56` 起还将实施计划限制为配置的 plans 目录中的一层 Markdown 文件。

这些状态记录了用户的执行约定。Build Skill 第 28 行和 `reference/sdk-methods.md:54-64` 明确展示选项、复用已确认值并补齐缺失决定。`classic-sdk-build.ts:88` 起保存完整提案，经用户批准后才把方法写入 Run；拒绝时不提交，展示值漂移时拒绝批准。不能改为 Agent 自行选择后绕过用户既有决定。现有 `propose-build --confirmed` 已支持用户明确选择后一次保存，不应把重复确认算成仍未解决的固定成本。

可以合并内部状态写入、减少重复配置展示与再次询问；计划目录和重复证据准备也可单独评估。任务实际完成和文档语义由 Agent 审查，Runtime 保留明确的任务完成检查、当前配置、Action/Run 身份及批准范围校验，不把这些校验整体归为无价值的文档判断。

注意：`classic-sdk-next.ts:16` 起已自动提交内部材料引用，`state next --continue` 也会连续推进内部步骤。删除 evidence 步骤的收益目前主要是少一次 CAS/落盘和较小状态，不应声称每个步骤都还需要 Agent 单独往返。

## 6. 已经简化或应保留的部分

- Design handoff 已在 `classic-handoff.ts:73` 改为引用原 `proposal.md`，默认不再复制全部正文；只有显式 `--full` 才拼接可读视图。不要再把默认手工压缩包当作现存热路径。`contextCompression` 与 handoffHash 的旧格式兼容可随旧协议退休，但单独删除这一字段收益有限。
- `classic-runtime-paths.ts:205` 建立身份前先读已有 binding；匹配即返回，只有首次绑定/迁移才会枚举其他 change 与 archive 核对重复 ID。它可以与旧布局迁移一起退出新路径，但不能描述成每次命令都全量扫描历史。
- `classic-sdk-archive-preflight.ts:79`、`:140` 检查当前 Run、已接受 Verify、用户批准的 local/push/pr 行为与实际分支。这些是副作用执行前的确定性限制，应该保留。
- `classic-sdk-archive.ts:191` 实际调用 OpenSpec archive；后续 Git 提交、push、PR 与交付收据可以遇到“外部已成功、本地未落盘”的中断。这部分保留原 Action、原批准和副作用核对有实际价值，不能交给 Agent 仅凭猜测自动重放。
- Run 的 CAS、原子文件写入、短期事务互斥和受保护路径校验继续承担稳定性职责。可以减少嵌套和重复层数，不能删除最后一道实际写入互斥。

## 建议顺序与验证边界

同日历史设计复核后，相关 16 项定向测试通过：配置批准/拒绝/漂移、Build 未完成任务阻塞及稳定任务 CLI 5 项，任务解析、映射和幂等 11 项。已据此修正第 3、5 节建议；未改变产品机制。

1. 先统一旧 PID 锁实现，核对 Classic 新建、设计提交、任务命令、状态投影和交付路径的间接依赖。
2. 保留任务 CLI、稳定 ID 和完成检查，针对已完成项重复写入、重复查询和旧计划投影减负。
3. 收缩 YAML 双向投影与内部 evidence 微步骤，保留真实外部交接快照。
4. 明确旧 v1/Compat/固定应用退休政策后，整段删除旧受管检查和旧定义装配。
5. 保留用户的执行方法选择及批准；最后评估旧布局、旧 handoff 和仅供退休协议使用的字段，避免把用户决定当作空壳配置删除。

本轮没有运行模型 Eval、全量测试或实际平台 Hook；未实施上述删除，不宣称已证明质量不下降。后续应在隔离项目中通过当前公开 CLI 验证正常推进、未批准不推进、未知副作用不重放、恢复原 Run、有效交付与重复命令幂等。对“交给 Agent 后同样可靠”的结论，需要用户明确授权范围内的真实模型证据。
