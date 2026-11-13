# Runtime 命令依赖收窄：实施依据与局部验证

2026-11-10，`053` 工作区，基线 HEAD `630ce380787f446e803f94b4b90cbbdbf8663364`。本报告只研究实现切口，不修改产品文件。工作区另有 #545 与当前父任务的修改，因此下列配对数据是本轮构建快照，不是发布 tag 的性能承诺。

## 最小可实施方案

### 1. 使用现有窄公开入口，不再从总 index 加载 Runtime 能力

`domains/workflow-application/index.ts:1-10` 将 Run 读取、应用加载等导出自 `application.ts`，第 35 行将 `applicationSkillWork` 导出自 `skill-work.ts`，第 38 行后同时导出安装和 delivery。

建议将 Native/Classic/Entry 中这些运行时导入直接指向已存在的公开 `application.ts`：

- `native-runtime-ownership.ts:25`：`loadWorkflowApplication`、`resolveWorkflowApplicationFile`。
- `native-sdk-diagnostics.ts:4`、`classic-sdk-diagnostics.ts:8`：`readWorkflowApplicationStorageDisposition`。
- `native-change.ts:18`、`native-doctor-command.ts:5`、`native-sdk-cancellation.ts:5`：`readWorkflowApplicationRun`。
- `native-sdk-projection-lock.ts:12`：应用锁 inspect/repair。
- `native-selection.ts:18`、`native-sdk-supervisor-transfer.ts:24`：应用加载与定位。
- Entry 的 `hook-router.ts:35` 及 `project-status.ts`：选中应用与 Run 读取。

`native-sdk-status.ts:5` 的 `applicationSkillWork` 直接使用 `skill-work.ts`。仅类型的 import 无运行时装配成本，可保持原公开类型入口，避免没有收益的改名。

架构配置：`config/repository-layout.json` 的 `dependencyRules.crossDomainEntrypoints` 已允许 `workflow-application/application.ts`；应将具有明确跨领域用途的 `skill-work.ts` 加入清单。不要另建一个只转发同样能力的新 barrel，也不要放宽为允许整个目录任意内部导入。

### 2. 将 Native CLI 识别的错误类型从重实现中移出

`native-cli-shared.ts:15-29` 为执行 `instanceof` 而导入 Archive、change、verification 与 workspace preparation 实现。这使所有使用 CLI 共有参数、错误和输出函数的命令都装配旧 Runtime 模块。

最小切口是新增一个只定义错误值的 `native-runtime-errors.ts`，迁移下面七类；源模块重新导出同一个类并在自身需要时导入它，保留旧公开路径和 `instanceof` 身份：

| 原模块                                   | 类                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `native-change.ts:90-134`                | NativeChangeRevisionConflictError、NativeWorkspaceIsolationRequiredError、NativeBaselineIncompleteError |
| `native-archive.ts:73-100`               | NativeSpecConflictError、NativeArchivePreflightError                                                    |
| `native-verification-runtime.ts:106-123` | NativeVerificationReceiptBindingError                                                                   |
| `native-workspace-preparation.ts:42`     | NativeWorkspacePreparationError                                                                         |

新的错误模块只需类型引用：`NativeContentSnapshotManifest`、`NativeWorkspaceBinding`、`NativeArchivePreflight`、`NativeReceiptBindingFailureDetail`、`NativeWorkspacePreparation`。不要把实际文件读取或恢复函数移入此模块。错误类消息、code、name、details 和构造参数保持一致。

`native-cli-shared.ts` 改为从该模块取得错误类。原路径 re-export 可以使现有 `native-cli-shared.test.ts:23-30` 从旧模块创建错误后仍被 CLI 正确识别，正好验证兼容性。

新增模块属于现有 Native domain，无需新顶层目录、Runtime 入口或生成 bundle；如将其登记为纯模型，须确保只使用类型导入并同步 `pureModelModules`，不能让纯错误模块反向加载执行器。

## 配对构建试验

使用 esbuild 的内存 onLoad 改写模拟上述候选，未写产品源码。构建参数匹配当前 Runtime：`bundle:true`、`packages:bundle`、`platform:node`、`format:esm`、`target:node20`、`minify:true`、`treeShaking:true`、UTF-8、无 legal comments。Native 同样使用当前 `excludeClassicRuntimeSchemas()` 插件。测量输出省略正式 shebang/banner，故绝对大小与仓库产物略有差异；同组差值可比较。

| 入口          | 原输入数 | 仅窄公开导入 | 窄导入 + 纯错误模块 |      原包体 | 完整候选包体 |
| ------------- | -------: | -----------: | ------------------: | ----------: | -----------: |
| Native next   |      414 |          397 |                 367 | 1,715,079 B |  1,711,699 B |
| Native status |      408 |          391 |                 372 | 1,533,137 B |  1,531,579 B |
| Classic state |      375 |          358 |                 358 | 1,131,705 B |  1,131,558 B |

单独消除 umbrella import 只减少约 147–202 字节，因为 esbuild 原本已摇掉绝大部分 delivery 实现。metafile 中的安装 delivery 文件约 15 字节，与完整安装能力执行量无关。旧审计里的“静态依赖包含安装/PID”只能说明源码装配耦合，不能据此声称产品命令每次执行安装或带有整段安装代码。

完整候选减少 Native next 的 47 个静态输入、status 的 36 个、Classic state 的 17 个。实际包体收益分别约 3.38 KB、1.56 KB、147 B。它可作为依赖职责与源码加载收窄交付，不应宣传为大幅缩包。

## 真实冷 CLI 对照

把同组内存候选编译到系统临时目录，加入 Node ESM `createRequire` banner，用已有隔离 Native v4 项目执行 status。关闭 daemon，每轮启动新 Node，五轮交替顺序；输出 JSON 均为 7,446 字节。

| 轮次   |  baseline |      候选 |
| ------ | --------: | --------: |
| 1      | 442.45 ms | 399.04 ms |
| 2      | 394.21 ms | 399.61 ms |
| 3      | 395.03 ms | 412.65 ms |
| 4      | 405.98 ms | 390.93 ms |
| 5      | 391.59 ms | 392.15 ms |
| 中位数 | 395.03 ms | 399.04 ms |

本次没有观察到稳定的冷 CLI 提速。不能把源码输入数量下降直接换算成用户耗时收益。父任务应在产品候选完成后按相同条件重测，不预填收益。

## 更大范围的候选及边界

当前 bundle 中真正较大的 Native 业务内容是 `native-portable-continuation.ts`（约 46 KB）、`native-runner-input.ts`（next 约 35 KB）、`native-sdk-checks.ts`（next 约 33 KB）以及同一应用工厂内的新旧定义；status 的旧 snapshot 实际约 15 KB。前两项在当前新 Run 大多不执行，但通过公开 Compat 和恢复路径保留。

在“每命令自包含 bundle”的现有契约下，将相对静态 import 改成动态 import，esbuild 仍把模块内联在同一文件；只延迟初始化，不会自动让包体下降。若另发 compat bundle 并在运行时加载，则是发布资产及安装依赖契约变更，须明确设计、配置登记和安装恢复测试，不能把一个 dynamic import 当作完成。

本轮不建议为获得夸大的包体数字退休旧协议，也不建议另造通用路由/缓存框架。先落实窄公开入口与纯错误边界，再由端到端计时决定是否进行兼容装配拆分。

## 推荐验证

- `native-cli-shared.test.ts`：保留从原模块导入错误类的测试，确认 JSON 错误 code/details 和 `instanceof` 不变。
- `native-cli-entry.test.ts`、`native-command-modules.test.ts`、`native-sdk-status-observation.test.ts`、`native-sdk-read-performance.test.ts`：正常 CLI、源码模块边界、只读状态和同 Run 恢复。
- `test/repository/native-runtime-assets.test.ts`：生成物新鲜、自包含和逐命令独立运行。
- 相关 Classic/Entry 的状态、固定应用和 Hook Router 定向测试；源导入和生成 Runtime 分层报告。
- 构建 metafile 对实际输出作比较；可以断言 CLI 共有错误帮助模块的传递依赖不再包含旧快照/归档执行器，但不要对所有 next/status 入口断言完全没有旧模块，因为公开 Compat 仍需要它们。
- architecture、类型、Prettier、三类 Runtime 构建及 `check:generated`；不通过扩大跨领域白名单隐藏不合理依赖。

本研究没有修改产品、运行 Eval、全量测试或真实平台 Hook；只生成临时试验 bundle 并运行隔离 status。

## 后续 Review：Plugin Store PID 锁迁移

### 范围与结论

按父任务要求追加复核当前 `platform/fs/plugin-store.ts`、共享 SQLite 锁、`app/commands/doctor.ts:1857` 的 `--lock-file` 路径，以及历史和候选测试。

在本次核对的范围内，未发现需要阻止交付的功能缺陷。旧 PID/年龄自动回收策略的退休与用户要求完成 PID 退役相符；当前实现没有通过删除正常互斥、读取边界或 nonce 保护来换取测试通过。全量与生成 CLI 的最终结果仍由父任务汇总，本 Review 不代替那些结果。

### 归档完整性

将 `docs/research/2026-11-10-plugin-store-pid-lock-tests.before.ts.txt` 与基线 `630ce380787f446e803f94b4b90cbbdbf8663364:test/platform/plugin-store.test.ts` 直接作 Buffer 比较：两者均 8,501 字节，逐字节一致，没有仅保留测试名或片段。

当前测试从 `describe('bounded receipt reads'` 开始到文件结束，与基线正文逐字一致。UTF-8 读取上限、无效上限、FIFO 不阻塞、符号链接拒绝及各平台条件均未被修改。平台条件跳过不能当作执行通过。

### 逐行为映射

| 旧行为/断言                               | 当前去向                                                                                                                                              | Review 判断                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| PID 不存在时自动移除旧 owner 并继续       | `requires explicit stop confirmation before recovering a legacy PID lock` 先拒绝无确认/错误 token，再确认清理并继续；新增真实子进程退出后重新获取新锁 | 自动 PID 推断是有意退休的策略；原“退出后可继续”由真实 SQLite 持有进程退出覆盖        |
| 活 PID 的创建身份不同则自动接管           | `does not infer stop permission from a legacy PID or process identity` 保留原锁并要求确认                                                             | 与移除历史 PID/创建时间推进权威一致；不是保留旧自动接管的等价声明                    |
| 新锁必须记录 host、PID、创建身份          | `records transaction metadata without a host or process identity` 断言协议、nonce 且无三种身份字段                                                    | 明确退休的记录策略，替代断言方向正确                                                 |
| 缺少创建身份的 live legacy owner 不可抢占 | 保留同名保护测试，改为明确 `Legacy lock requires confirmation`，原记录不变                                                                            | 不抢占保护保留；旧测试从未允许“缺少身份就自动接管”                                   |
| nonce 被替换后 release 不删除新记录       | 当前同名测试仍存在；共享锁另覆盖 metadata 变更、原 owner 已消失和不能读取等情况                                                                       | 未削弱原记录保护                                                                     |
| 空锁超过宽限年龄可自动回收                | `requires stop confirmation for an old empty lock regardless of age`，先保留原空文件，再正确停止确认清理并重新获取                                    | 按年龄自动回收已退休，未知旧锁的合法恢复仍有正向证据                                 |
| 新鲜空锁不能在 owner 写入期间被抢占       | `preserves a fresh empty legacy lock until the original operation is confirmed stopped`                                                               | 保留不抢占语义；当前新事务先持有 SQLite，再发布 metadata，不靠空文件年龄判断活跃操作 |

实施记录中曾把“缺少进程身份就自动抢占”一并列为旧策略，这是表述错误，应修正为 PID 不存在、PID 被复用或老空文件按年龄自动回收；不能把原有保守保护说成被撤下的策略。该更正已反馈父任务。

### 当前实现及公开恢复入口

`plugin-store.ts:5-10` 导入并重新导出现有共享锁，不再维护另一套 owner/PID 检测实现。`JsonFileTextStore.withLock` 仍在同一个数据文件旁取得锁；原 JSON 读取和原子临时文件 rename 保持，临时文件改用 UUID 不依赖 PID。

共享锁先获取 SQLite `BEGIN IMMEDIATE` 再读取/发布 metadata；活动事务使另一个获取或 repair 失败。release 只有 nonce、createdAt 和 operation 仍为自身记录时才删除 metadata，事务在 finally 关闭。原操作抛错且清理也失败时，仍保留原操作错误。

`doctor --lock-file` 先诊断指定记录，只在 `--repair`、`--confirmed` 和 token 同时提供时尝试修复。底层 repair 在取得同一事务后再次比较 token，缺少停止确认或 token 不符均不清理；真正活跃事务即使提供正确 token 和停止声明也保持锁定。清理后再诊断，重复清理缺失记录可成功返回，不重放被锁操作。

`test/app/doctor-lock.test.ts` 分别覆盖 source 与真实 CLI 的旧锁诊断、缺确认、错误 token、正确恢复及重复恢复，并覆盖活跃事务不可清理。这些是公开恢复行为的正反例，不能只由低层锁测试代替。

### 独立执行的 Store 探针

通过当前源码公开 `JsonFileTextStore` 在系统临时目录运行一个探针：同一 Store 并发发起 16 次 `withLock(read -> increment -> write)`，最终值精确为 16；随后在锁内抛出指定 Error，捕获的仍是同一个 Error，下一次重新加锁读取仍成功且值为 16。这是一次探针中的 16 次更新，不计作 16 项 Vitest 测试。

未修改产品或测试，未启动 Eval、全量测试或额外 Agent。该探针与源码 Review 不证明跨平台行为，Linux FIFO 等执行结果仍以对应平台测试为准。

## 后续 Review：共享锁迁移对 CLI 构建夹具的影响

### 归档、登记与行为映射

`docs/research/2026-11-10-cli-build-fixture-pid-lock-tests.before.ts.txt` 与基线 `630ce380787f446e803f94b4b90cbbdbf8663364:test/repository/cli-build-fixtures.test.ts` 逐字节一致，两者均为 5,567 字节。

`test/helpers/ensure-cli-built.ts` 的差异只有说明共享事务锁的注释；检查所有源码对应的 `.js`、`.js.map`、`.d.ts`、`.d.ts.map`、构建后再次核对完整性，以及“产物新鲜且没有 metadata 锁时直接返回”的控制逻辑未改。

`cli-build-fixtures.test.ts` 前两项测试正文保持完整相同；第三项原断言完整保留，并在 Review 后补充新 SQLite 写入方式的只读拒绝探针。它们覆盖：新鲜 CLI entry 不能掩盖缺少 SDK 编译产物、成功退出的 build 不能掩盖不完整输出、完整新鲜产物支持只读候选。后四项迁移如下：

| 原夹具                               | 候选行为                                                                           | 判断                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| 模拟 alive owner，即使产物新鲜也等待 | 使用真正持有的 SQLite 事务，确保新鲜产物也等待并保留原记录                         | 从 PID mock 改为真实互斥，保护不弱化               |
| 模拟老时间戳的 alive owner 不可接管  | 真事务保持活动，把 metadata mtime 改老，仍超时且不执行 build                       | 不以年龄接管的断言保留                             |
| 模拟 dead PID 自动恢复               | 旧记录先拒绝且不构建，精确 token 加停止确认后清理并正常构建；断言从未调用 PID 探针 | 原自动 PID 回收策略明确退休，替代恢复有正向路径    |
| 模拟 unknown 身份不接管              | 立即要求旧操作停止确认，原记录不变                                                 | 不抢占语义保留，错误由等待超时变为可操作的恢复要求 |

受保护 case `release-core-read-only-cli-build` 的完整 JSON 与基线相同。它在 fixture 文件中的两个 requiredNames 都保留且在 `coverage/runtime-cleanup-build-fixtures.json` 通过。该报告记录 7 项通过、0 失败、0 pending。

注意：这个 case 还关联 `test/app/cli-help.test.ts` 的 `CLI help text uses consistent English guidance in root help`。7 项 fixture 报告不包含这一断言，不能单独据此宣称整个受保护 case 已执行通过；应由另一个报告或最终全量结果覆盖。

### 已修复的验证缺口：只读模拟覆盖新锁的写入方式

当前 `ensureCliBuilt` 只读 fastpath 源码仍正确；本次没有发现生产功能错误。但原测试仅将 `fs.promises.open` 替换为抛出 EROFS，断言该函数未被调用。旧锁通过 `fs.open('wx')` 创建记录，该模拟能检出写入；共享 SQLite 锁使用 `DatabaseSync` 及 `mkdir/writeFile`，不必调用公开的 `fs.promises.open`。

已用临时目录和当前公开共享锁执行探针：令 `fs.promises.open` 永远抛出 EROFS，`withRecoverableFileLock` 仍成功进入并真实创建 `.sqlite` 文件；`fs.open` 调用次数为 0。因此，虽然历史测试正文未动，它对“不可写候选不能创建锁”的故障检出力随依赖迁移降低了。

父任务已保留原 `fs.open` 拒绝和未调用断言，另对共享 `sqlite.openSqliteDatabase` 设置 EROFS 拒绝探针并断言未调用。该函数是共享锁打开 SQLite 的唯一入口；因此错误地进入新锁路径也会使只读测试失败，覆盖原模拟未触达的实际写入方式。没有修改 `ensureCliBuilt` 的正常控制逻辑来绕过检查。

重新读取当前测试与 `coverage/runtime-cleanup-build-fixtures.json` 后确认：原 fs.open 和 build-count 断言仍在，新增 database 拒绝/未调用断言在只读测试的第二次 ensure 前设置；当前报告仍为 7 通过、0 失败、0 pending。该 Review 发现已由父任务修复，本项不再是待处理问题。Review 本身未修改测试。

### 构建锁辅助文件忽略

`.gitignore` 使用精确的 `.comet-test-build.lock*` 模式，已通过 `git check-ignore` 核对 metadata、`.sqlite`、`-journal`、`-wal` 与 `-shm` 都被忽略；没有采用泛化的 `*.sqlite`，也没有为这些文件放宽 `allowedTopLevelEntries` 架构白名单。SQLite 辅助文件持久存在不会让正常构建生成物进入版本控制。

本次只读 Review 不启动额外全量或 Eval；7 项报告来自父任务，独立执行的是归档字节比较、登记比较、gitignore 核对及上述 EROFS 探针。

## 后续 Review：Classic State 锁观察迁移

`docs/research/2026-11-10-classic-state-lock-tests.before.ts.txt` 与基线 `630ce380787f446e803f94b4b90cbbdbf8663364:test/domains/comet-classic/classic-state.test.ts` 直接作 Buffer 比较：两者均为 19,257 字节，逐字节相同。当前文件差异只涉及 SQLite 模块导入和三项测试的锁观察方式，没有修改测试名、状态转换预期或跳过条件。

| 测试及当前位置                                                     | 保留与迁移                                                                                                                                                                                  | Review 判断                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 稳定读取不创建写锁，随后能读到更新，`classic-state.test.ts:199`    | 原 `fs.open('wx')` 零调用断言保留；额外断言 `.comet-state.lock.sqlite` 零次打开；首次完整 before 与更新后 phase/currentStep 断言保留                                                        | 覆盖新旧锁写入入口，稳定读取的无锁要求增强                       |
| 文件身份不可用时串行读取，`classic-state.test.ts:254`              | 仍对目标 YAML 的 bigint inode 返回 `0n`，核对完整 projection；将旧独占文件打开次数改为 SQLite 入口恰好一次                                                                                  | 保留实际触发条件和串行读取要求，只更新实现观察点                 |
| Run 已更新而 YAML 未提交时等待 writer，`classic-state.test.ts:272` | 仍由真实 `writeClassicState` 的 `beforeCommit` 暂停 writer，reader 尝试 SQLite 入口后必须尚未 settle；finally 释放并等待 writer，最终仍核对完整 after，包括 phase、currentStep 和 iteration | 没有把等待断言替换成单纯成功读取；前后状态一致性和互斥要求均保留 |

共享锁在 `platform/fs/recoverable-file-lock.ts:82` 打开 SQLite，随后同步执行 `BEGIN IMMEDIATE`；遇到活动 writer 时关闭本次连接并异步重试。因此，这两处探针确实观察当前串行路径；旧 `fs.open(..., 'wx')` 监听已经无法观察此路径，会导致错误的零次计数或等待旧入口而超时。writer 测试保留了释放前 `settled === false` 和释放后完整状态检查，未通过提前释放来避开等待。

复核父任务输出 `coverage/runtime-cleanup-classic-state.json`：整个文件 31 项通过、0 失败、0 pending。该结果证明此文件当前定向运行通过，不代替最终仓库全量或真实平台验证。本 Review 没有修改产品/测试，也没有另行启动测试或 Eval。在本项范围内，未发现历史断言降低或待修复功能缺陷。
