# Native / Classic 正常流程的删减机会

来源：`report:2026-11-08-native-classic-fast-path-simplification`。本轮只分析，不改产品和 Skill，不启动 Eval，不提交或推送。

用户随后明确要求保护核心使用体验。后续实施以 [审核后的待办](2026-11-08-native-classic-simplification-todo.zh.md) 为准，31 项中有 8 项可优先优化、15 项需等价验证、8 项撤回删除建议。本文保留初轮微测与调用路径。本文早期提出的立即 busy、强制手动选择/恢复、功能退役等方向，均须按审核版的具体结论处理。

## 结论

当前仍有值得做的删减，优先减少**一次命令中重复读取、装配和投影**，再决定是否收缩并发、兼容和自动恢复的产品能力。不能从“锁、恢复、Supervisor 文件很多”推断它们就是普通流程的主要耗时；有些已不在正常路径，有些只有竞争或故障时才执行。

当前微测把更直接的优先项指向了路径检查和查询附带的学习处理：小型 fixture 的具名 Native status 也执行了 482 次异步 lstat 和 442 次 realpath，Classic 单字段读取存在额外 Node 子进程。建议先去掉同次只读观察中重复的祖先路径核对和不必要的命令进程，再合并高层 `next` 的 Runtime/Run 读取。Classic 的结构性删减是参照现有 Native v3，把 SDK Run 作为推进依据，Portable 文档只在明确边界生成 checkpoint；这会改变恢复和手动编辑契约，需完整迁移消费者。

如果希望大幅减少模型轮次，还应分析 Classic 的逐阶段 Skill 交接能否合并，以及是否继续提供自动 Supervisor 调度。普通 Native v3 已经把“提交 Builder → 执行必要检查 → 领取 Verify”和“提交 Verify → 已获授权的接受 → Archive”合并，不应重复提出已经完成的优化。确定性 CLI 时间也不能直接代表真实 Agent 的阅读、推理和工具调度时间。

## 核对范围与证据

- 当前分支 `053`，HEAD `2999b60d0b1a373a158a238fba126bb03ac3c98c`；源码位置以该工作区为准。
- 开始时有无关修改：`docs/comet/archive/2026-10-06-comet-any-sdk/comet-state.yaml` 和 `website` 子模块。本轮保留它们，只新增本文。
- 主要依据是当前生产源码、`config/workflow-regressions.json` 中的来源与行为登记，以及仓库已有的实验报告。历史报告只证明其当时冻结的版本，不证明当前性能。
- 本轮不是用户行为修复，不声明关闭 Issue，不新增虚构 badcase。这里的候选需要实施时再按实际改变的行为登记、复现和验证。

## 先排除已经完成的优化

| 旧分析中的建议                                          | 当前实现                                                                                                                                                                                                                                                                                                    | 不应再承诺的收益                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 普通任务默认允许当前会话验收                            | v3 高层任务支持当前会话；显式 independent 仍约束真实接收方。见 [`native-sdk-task-command.ts:280`](../../domains/comet-native/native-sdk-task-command.ts#L280)、[`native-sdk-application.ts:732`](../../domains/comet-native/native-sdk-application.ts#L732)。                                               | 不能再把“删除固定独立 Verifier”算作本轮新机会。                           |
| 每个 SDK revision 同步 Portable                         | Native v3 读取直接走 `syncBoundaryCheckpoint`，仅 publish 且满足边界时写入。见 [`native-sdk-state-store.ts:467`](../../domains/comet-native/native-sdk-state-store.ts#L467)、[`:544`](../../domains/comet-native/native-sdk-state-store.ts#L544)。                                                          | 不能说普通 Native 仍在每次读取中修复 YAML。Classic 仍有不同实现。         |
| 已停止检查不反复查 PID                                  | 默认 v3 不 includeSettled；完整停止证据匹配时直接返回。见 [`native-sdk-status.ts:68`](../../domains/comet-native/native-sdk-status.ts#L68)、[`native-sdk-check-execution.ts:483`](../../domains/comet-native/native-sdk-check-execution.ts#L483)。                                                          | 不能把“新增终态 PID 缓存”当新发现；details 和旧协议仍可能读终态记录。     |
| 归档预检避免八次输入采集                                | 当前共用 observedInputs/materials；登记已有“执行边界一次、提交边界一次”的断言。见 [`native-sdk-archive.ts:412`](../../domains/comet-native/native-sdk-archive.ts#L412)、[`workflow-regressions.json:9378`](../../config/workflow-regressions.json#L9378)。                                                  | 不能再次声称从八次降到两次。两次跨执行/提交边界不可只凭内存结果合成一次。 |
| 不因其他 change 声明同 capability 阻塞                  | v2/v3 关闭 peer capability 扫描，保留实际 canonical Spec 冲突核对。见 [`native-sdk-archive.ts:468`](../../domains/comet-native/native-sdk-archive.ts#L468)、[`:665`](../../domains/comet-native/native-sdk-archive.ts#L665)。                                                                               | 普通新 Native 已不遍历所有 worktree 只为能力占用。                        |
| 只交付一个结果模板，报告是派生视图，复用 Build 受管检查 | 当前登记分别为 `native-single-result-template`、`native-v3-compact-builder-result`、`native-v3-report-view-nonblocking`、`native-build-managed-check-reuse`。见 [`workflow-regressions.json:9340`](../../config/workflow-regressions.json#L9340)、[`:9440`](../../config/workflow-regressions.json#L9440)。 | 不能把已有合并模板、报告非阻塞和检查复用重复列为待开发能力。              |

旧报告 [`2026-11-05-native-verify-archive-simplification.zh.md`](2026-11-05-native-verify-archive-simplification.zh.md) 是这些改进前后的调查记录；当前结论以上表源码为准。

## 正常调用路径

### Native 新建普通 v3

`native next` 先解析参数、读取 owner/config、准备 paths、解析 Runtime 归属；进入高层任务后，加载固定应用和本地权威 Run，核对真实 session。[`native-next-command.ts:280`](../../domains/comet-native/native-next-command.ts#L280)、[`native-sdk-task-command.ts:287`](../../domains/comet-native/native-sdk-task-command.ts#L287)

结果回报时，先读取结果 JSON，再在 Native mutation lock 下登记结果传输文件，以免把传输文件误算为候选输入；随后 `recordOutcome` 绑定 Action、attempt、inputHash、claimToken。它们对幂等和拒绝错误会话仍有用途。[`native-sdk-task-command.ts:340`](../../domains/comet-native/native-sdk-task-command.ts#L340)、[`:360`](../../domains/comet-native/native-sdk-task-command.ts#L360)

高层入口再调用 `advanceNativeSdkChange`，后者重新 inspect，处理确有 running/unknown Action 的恢复，执行当前需要的内部 call_tool。正常循环已经复用 `owned` Runtime，不是每个内部步骤都重新创建一次；归档也能一次推进 prepare、execute、finalize。[`native-sdk-next.ts:184`](../../domains/comet-native/native-sdk-next.ts#L184)、[`:224`](../../domains/comet-native/native-sdk-next.ts#L224)、[`:746`](../../domains/comet-native/native-sdk-next.ts#L746)、[`:785`](../../domains/comet-native/native-sdk-next.ts#L785)

返回高层入口后再 inspect，若可领取则 claim 下一个 Builder/Verify，生成精简响应；已获明确授权时，Verify 结果可以直接接受并归档。未授权时仍等待用户接受。[`native-sdk-task-command.ts:391`](../../domains/comet-native/native-sdk-task-command.ts#L391)、[`:416`](../../domains/comet-native/native-sdk-task-command.ts#L416)、[`:454`](../../domains/comet-native/native-sdk-task-command.ts#L454)

### Classic SDK

Classic 仍按 Open、Design、Build、Verify、Archive/Delivery 的领域检查点推进；full/hotfix/tweak 有不同方案。SDK 外围保留 YAML 状态文件、嵌入 Portable checkpoint 与 revision marker。正常 read 已有无写锁快速路径，但每个成功 CAS（初始创建除外）继续进入带锁的 `syncStateFile`。[`classic-sdk-application.ts:1639`](../../domains/comet-classic/classic-sdk-application.ts#L1639)、[`classic-sdk-state-store.ts:528`](../../domains/comet-classic/classic-sdk-state-store.ts#L528)、[`:572`](../../domains/comet-classic/classic-sdk-state-store.ts#L572)、[`:642`](../../domains/comet-classic/classic-sdk-state-store.ts#L642)

### Hook

有有效 selection 时，Router 已优先只取所选 change；Native 同次 Hook 有请求内缓存，Guard 复用相同 inspect。没有 selection、所选对象失效或需要归属推断时，才枚举 active candidates。Native active 发现还会核对 history partition 的封存元数据。[`hook-router.ts:202`](../../domains/comet-entry/hook-router.ts#L202)、[`:297`](../../domains/comet-entry/hook-router.ts#L297)、[`native-hook-guard.ts:760`](../../domains/comet-native/native-hook-guard.ts#L760)、[`:862`](../../domains/comet-native/native-hook-guard.ts#L862)、[`native-sdk-history-discovery.ts:17`](../../domains/comet-native/native-sdk-history-discovery.ts#L17)

这说明“每次 Hook 都全仓扫描”不准确；没有 selection 的兼容发现，才是可讨论收缩的产品行为。

## 可实施候选与优先级

优先级综合正常路径频率、行为边界和证据确定性，不表示已测得收益排序。N 为 Run 历史规模，T 为 Native transactions 目录项数，A/H 分别为活动与历史 change 数量。

### P0：同一次只读观察合并祖先路径核对

- **位置与频率：** `inspectExistingChain` 对每一级祖先执行 lstat/realpath；`readProtectedProjectFileUncached` 先 inspect，再重新获取 root，并在 race-safe read 的 verify 回调再核对路径链。很多 owner、marker、checkpoint 共享相同祖先，但每份文件会重新进入这些调用。见 [`protected-project-path.ts:242`](../../domains/workflow-contract/protected-project-path.ts#L242)、[`:251`](../../domains/workflow-contract/protected-project-path.ts#L251)、[`:515`](../../domains/workflow-contract/protected-project-path.ts#L515)。当前已存在 Hook/probe 决策缓存及 `createProtectedProjectReadSession`，因此建议扩展正确的观察边界，而不是再增加一套任意超时缓存。见 [同文件:26](../../domains/workflow-contract/protected-project-path.ts#L26)、[`:229`](../../domains/workflow-contract/protected-project-path.ts#L229)。
- **现测线索：** 小型初始 fixture 的 Native 具名 status 只有 26 次 open，却有 482 次异步 lstat、442 次 realpath；Classic next 为 31 次 open、764 次异步 lstat、647 次 realpath。计数是独立 instrumentation，不证明所有调用都重复或都可删除，但足够把这个方向排在假想争用之前。
- **建议：** 对一批同边界只读 owner/config/checkpoint 使用共享 read session，目录身份先观察一次，叶子每次稳定读取，结束时核对目录身份；写命令将外部执行前后、commit 和实际写入分别作为独立观察边界。用精确计数断言避免祖先核对随调用层数相乘。
- **依赖假设：** 批次期间没有由 Runtime 自己修改相关目录；如果会写入，必须明确结束观察并建立新观察。不能把一般 CLI 写命令整个放进“磁盘不变”的 Hook 缓存作用域。
- **预期收益：** 直接减少高频文件系统 API 与异步 Promise/路径处理；现在的计数足以说明有大量可调查成本，仍须等价正反例与配对测量后才能宣称耗时降幅。
- **失去保证：** 错误缓存可能漏掉 symlink/junction 替换、父目录迁移和读取中的命名空间变化。应保留叶子身份、物理 containment、读前后稳定性和 finish 核对；`workflow-regressions.json:10517` 的 Git 目录替换与中途 workspace 漂移是实际反例，不可只凭 mtime 或“只有一个 Agent”删掉。

### P0：Classic 简单读取停止同步触发生命周期学习

- **现测线索与频率：** `comet classic state get <name> phase status` 的公共 CLI 五次中位为 968ms，快捷前缀 `comet state get` 为 957ms；warm import 同进程 facade 分别为 131/132ms。两种公共前缀都记录额外 `node.exe` 一次和 144 次同步 realpath。不能把前缀是否命中 fast router 作为主要根因。
- **源码原因：** `isReadOnlyClassicStateQuery` 只把 state current/next 算只读，get 被归入需要记录结果；成功执行后 `recordClassicResult` 把它记为 `episode.completed`，并同步等待 `recordCometTaskWorkflowResult`。后者启动 `comet-task-context-worker.js`，包含学习捕获及其模块加载。见 [`classic.ts:94`](../../app/commands/classic.ts#L94)、[`:109`](../../app/commands/classic.ts#L109)、[`:126`](../../app/commands/classic.ts#L126)、[`comet-task-context.ts:55`](../../app/commands/comet-task-context.ts#L55)。这是查询结果触发学习的具体行为，仍需修改后配对测量，不能把公共/同进程全部差值等同于学习耗时。
- **建议：** 把普通 state get 纳入纯查询分类，不产生 `episode.completed`；真正阶段结果、用户明确提供任务上下文或显式学习继续走原入口。优先停止无语义事件，而不是给每次读取加一个后台队列和更多重试状态。
- **依赖假设：** 一次字段查询不是任务完成或新的可学习经验；没有用只读查询附带的集成参数主动请求记忆操作。
- **预期收益：** 省掉无用 worker 启动、学习捕获 I/O 和同步等待。普通读取输出只有231字节时，这比削弱业务校验更值得先做。
- **失去保证：** 查询不再产生完成经验。这是有意收缩的记录语义，不影响 Run 推进；不能用直接读 YAML 代替权威 Run，也不能顺便删除真正阶段完成事件。

### P1：一次高层 next 共用 Runtime 和已提交 Run

- **位置与频率：** `advanceNativeSdkTask` 开头 load+inspect，内部 `advanceNativeSdkChange` 再 inspect/load，返回后再 inspect；接受结果路径也会递归进入 advance。每个普通高层任务调用都会经过部分重复。见 [`native-sdk-task-command.ts:287`](../../domains/comet-native/native-sdk-task-command.ts#L287)、[`:313`](../../domains/comet-native/native-sdk-task-command.ts#L313)、[`:413`](../../domains/comet-native/native-sdk-task-command.ts#L413)、[`:417`](../../domains/comet-native/native-sdk-task-command.ts#L417)、[`native-sdk-next.ts:184`](../../domains/comet-native/native-sdk-next.ts#L184)。`inspectNativeSdkRun` 先读 owner，`loadOwnedNativeSdkRuntime` 又读 owner。见 [`native-runtime-ownership.ts:535`](../../domains/comet-native/native-runtime-ownership.ts#L535)、[`:606`](../../domains/comet-native/native-runtime-ownership.ts#L606)。
- **建议：** 同一命令传递已绑定的 owner、Runtime、最新 Run 和 paths；mutation 返回的新 revision 直接继续，CAS 冲突时才重新读取。保留真正跨异步文件观察、外部副作用或未知结果的边界检查。
- **依赖假设：** 一次命令只操作同一 project/workspace/application；缓存只活在该命令中，不延伸到用户等待或下一次 CLI。
- **预期收益：** 减少正常命令的磁盘读取、固定工作流装配、完整 Run 解析/验证、重复 Git 身份查询；具体墙钟收益需由当前 CLI 与 warm facade 对照确定。
- **失去保证与防线：** 不应丢失保证。若用旧 Run 跳过 CAS 或工作区身份重新核对，会接受陈旧 session、分支或候选；`native-task-recovery-boundaries` 与工作区替换回归要求保留这些反例。见 [`workflow-regressions.json:9608`](../../config/workflow-regressions.json#L9608)、[`:10517`](../../config/workflow-regressions.json#L10517)。

### P1：Classic 取消逐 revision 的 Portable 全量投影

- **位置与频率：** 每次成功 CAS 之后执行 `syncStateFile(runId,false)`；内部取 projection lock、读取 YAML、逐字段比较、创建并编码整个 Run checkpoint、渲染 YAML、写 marker。成本至少与 checkpoint/历史大小 N 有关。见 [`classic-sdk-state-store.ts:520`](../../domains/comet-classic/classic-sdk-state-store.ts#L520)、[`:528`](../../domains/comet-classic/classic-sdk-state-store.ts#L528)、[`:557`](../../domains/comet-classic/classic-sdk-state-store.ts#L557)、[`:642`](../../domains/comet-classic/classic-sdk-state-store.ts#L642)。
- **建议：** 先让 Guard、handoff、status 和外部消费者统一读 SDK authority；只在明确导出、确认、归档等恢复边界保存 Portable checkpoint。Native v3 已有可对照的行为，不必另造两套新状态机。
- **依赖假设：** 同一 Run 只有 SDK 推进权威；用户不通过直接编辑 YAML 推进领域状态；Portable 是恢复/交换材料，允许落后于本机中间 revision。
- **预期收益：** 每个中间 revision 省一次投影锁、Portable 全历史编码/渲染及关联写入。可能是 Classic 当前最明确的结构性 I/O 删减；没有当前配对实测，不能承诺百分比。
- **失去保证：** 搬走项目目录或丢失本机 Runtime 后，不再从最近任意一次 claim/outcome 恢复；只能恢复到最后明确边界。需要说明受管执行途中断的原领取身份如何保存和恢复。
- **历史限制：** `classic-sdk-first-projection-read-budget` 已要求正常读取不重复开文件；`classic-sdk-authoritative-handoff` 要求以 Run 为权威。#530 证明旧 Portable 归档栅栏确实影响已批准交付，旧格式仍需明确迁移。不能直接把投影校验全部删掉。见 [`workflow-regressions.json:9812`](../../config/workflow-regressions.json#L9812)、[`:10563`](../../config/workflow-regressions.json#L10563)、[`2026-11-04-issue-529-530-backport.zh.md:24`](2026-11-04-issue-529-530-backport.zh.md#L24)。

### P1：Native mutation lock 只查未完成事务

- **位置与频率：** `withNativeMutationLock` 每次取得 root-move 锁后枚举全部 transactions，读取每个旧事务和精确命名的 Portable journal。每次高层结果回报登记传输文件都调用它；归档与旧流程也复用。最坏 O(T)。见 [`native-mutation-lock.ts:19`](../../domains/comet-native/native-mutation-lock.ts#L19)、[`:106`](../../domains/comet-native/native-mutation-lock.ts#L106)、[`native-runtime-ownership.ts:61`](../../domains/comet-native/native-runtime-ownership.ts#L61)。
- **建议：** 将已完成事务移入只读历史，活动目录只留未完成项；或以原子更新的未完成 journal 作为正常路径入口，完整重建扫描只放 doctor。首先测量真实 T，目录为空时没有可期待的大收益。
- **依赖假设：** 所有事务创建/结算都经过同一受控入口；不能让旧写入者绕过新索引。升级时须一次性核对旧目录，未知事务仍阻塞。
- **预期收益：** 将每个结果回报的历史扫描从随已完成事务增长，收缩到当前未完成项；不会减少模型轮次。
- **失去保证：** 如果索引可丢、可陈旧或旧版仍写目录，可能漏掉半完成 root move/Spec 更新。不能把“正常情况下没有事务”当成删除检查的理由。#526 的执行已结束但结果拒收，证明 archive 事务和收据恢复是真实要求。见 [`2026-11-05-issue-526-archive-recovery.zh.md:5`](2026-11-05-issue-526-archive-recovery.zh.md#L5)。

### P1：将当前普通工作流与 Supervisor / Compat 装配隔离

- **位置与频率：** 每次 load 当前内置 v3 都重新调用 `defineNativeWorkflowApplication('3')`；同一工厂包含 Supervisor 步骤、validator、transition 与 recovery 引用。见 [`native-runtime-ownership.ts:541`](../../domains/comet-native/native-runtime-ownership.ts#L541)、[`native-sdk-application.ts:1127`](../../domains/comet-native/native-sdk-application.ts#L1127)、[`:1224`](../../domains/comet-native/native-sdk-application.ts#L1224)、[`:1361`](../../domains/comet-native/native-sdk-application.ts#L1361)。`createRuntime` 仍规范化定义并登记 validator/handler，见 [`runtime-service.ts:363`](../../domains/engine/runtime-service.ts#L363)。
- **建议：** 先缓存当前不可变定义及实现对象，避免每次创建结构相同的新对象；再把旧版本和 Supervisor 的代码加载放到明确分派分支。普通路径不需要展示或编译不适用的协议。若确实决定取消自动 Supervisor，可停止给新 Run 创建该类型，旧 Run 走单独兼容入口。
- **依赖假设：** 普通单 change 足够覆盖主流使用，复杂任务交给平台原生子 Agent 做分析/实施，不由 Comet 再承担完整的 Child/worktree/integration/repair/deliver/cleanup 调度。
- **预期收益：** 缩小普通进程的加载、定义构造和协议维护面；取消 Supervisor 才能显著删代码，但不等于普通任务墙钟一定显著下降。需要测冷启动与 warm factory 成本分别占比。
- **失去保证：** 若删产品能力，会失去 Child 固定验收、隔离分支集成、父级汇总与清理恢复。应明确这是功能收缩。普通新 v3 和 Supervisor 共用固定定义 hash，不能按当前 state 临时裁掉步骤却沿用原身份。
- **历史限制：** v1/v2/v3 owner/cancellation 已出现兼容缺陷；Supervisor 的实际执行工作区、归档检查早于 cleanup 也有登记。见 [`workflow-regressions.json:9910`](../../config/workflow-regressions.json#L9910)、[`:10039`](../../config/workflow-regressions.json#L10039)、[`:10058`](../../config/workflow-regressions.json#L10058)。可以迁出普通路径，不能直接删除旧 Run 所需的定义、停止与集成证据。
- **已排除：** `nativeSdkApplicationForRun` 已先比较当前 hash，仅不匹配才构造历史定义；不能把“禁止每次构造所有旧变体”列作尚未实现的优化。见 [`native-sdk-application.ts:168`](../../domains/comet-native/native-sdk-application.ts#L168)。

### P1：没有 selection 时停止逐 Hook 自动推断所有活动任务

- **位置与频率：** 无 selection 的 Router 进入 `listEnabledActiveChanges`；Native 发现遍历 active 和 history partition，再读取当前候选状态，成本与 A/H 相关。每次新的 Hook 请求会重新观察，已有请求内缓存不跨命令复用。见 [`hook-router.ts:297`](../../domains/comet-entry/hook-router.ts#L297)、[`native-hook-guard.ts:760`](../../domains/comet-native/native-hook-guard.ts#L760)、[`native-sdk-history-discovery.ts:17`](../../domains/comet-native/native-sdk-history-discovery.ts#L17)。
- **建议：** 创建/选择 change 时明确登记 selection；普通 Hook 只检查该任务和受保护路径。缺少 selection 时提示先恢复/选择，将全项目发现留给 `status`、选择列表或 doctor；不能在不明确归属时默认放行受保护写入。
- **依赖假设：** 一个工作区一次只有一个明确选中的 Comet change；用户接受取消“只有一个活动任务时自动推断”的便利。
- **预期收益：** 大量历史 change 且没有 selection 时可减少全局发现；对 selection 正常的新任务，现有路径已是具名读取，几乎没有这部分收益。
- **失去保证：** 从旧客户端或手动拷贝恢复后，首次写入不再自动发现唯一任务，需要一次显式选择。未知或 stale selection 仍须失败，不能降级为越权放行。
- **历史限制：** 现有 Hook 保护真实覆盖其他 Classic change 写入拒绝、合法 Native 写入和禁用/卸载行为。优化必须保留归属、防跨 workflow 和禁用语义，见 [`workflow-regressions.json:11077`](../../config/workflow-regressions.json#L11077)、[`:11370`](../../config/workflow-regressions.json#L11370)。

### P2：收缩锁的公平排队、重试与远端所有者模型

- **位置与频率：** `platform/fs/recoverable-file-lock.ts` 的 acquire 与 release 都进入 bakery ticket 协调器；协调器发布 choosing/ticket 并枚举 contenders。即使无竞争也有这些元数据操作，Engine CAS 使用它。见 [`recoverable-file-lock.ts:243`](../../platform/fs/recoverable-file-lock.ts#L243)、[`:409`](../../platform/fs/recoverable-file-lock.ts#L409)、[`:462`](../../platform/fs/recoverable-file-lock.ts#L462)、[`runtime-store.ts:983`](../../domains/engine/runtime-store.ts#L983)。Classic 投影等多处实际使用另一套 [`plugin-store.ts:94`](../../platform/fs/plugin-store.ts#L94) 中的同名短锁，Native 另有专用 claim 协调器；三者不能混算成本或直接互换。Engine 普通 mutation 最多 32 次冲突重试，见 [`runtime-service.ts:733`](../../domains/engine/runtime-service.ts#L733)。
- **建议：** 若承诺只支持本机文件系统、同 Run 一个写入者，第二写入者立即返回 busy/conflict，可研究更短的独占发布协议，取消公平排队和自动多轮抢占。优先减少锁层数和锁内工作，随后才替换锁算法。
- **依赖假设：** 不要求共享网络盘、多机同 Run 公平竞争、任意并发写自动成功。Hook/只读 Dashboard 仍可能同时读取，用户也可能同时启动另一个 CLI，因此写入原子性与 revision CAS 仍不可删除。
- **预期收益：** 可省票据发布与目录枚举；32 次重试上限只影响竞争路径，删除上限不会让无竞争路径变快。不先量化就宣称“删并发框架可大幅提速”没有依据。
- **失去保证：** 公平性、自动等待、部分故障后自动接管；某些动作需要用户重试。简化实现仍必须保证旧持有者不能释放新持有者的锁，崩溃遗留锁可诊断，正常释放失败不能被误写成成功。
- **真实故障要求：** #529 确实复现协调器释放失败后同进程锁泄漏和再次申请超时；登记还覆盖 metadata 改写、foreign owner、不可检查父目录。不能删 nonce/token/创建身份和匹配删除，只留下 `unlink(lock)`。见 [`workflow-regressions.json:8978`](../../config/workflow-regressions.json#L8978)、[`:9022`](../../config/workflow-regressions.json#L9022)、[`2026-11-04-issue-529-530-backport.zh.md:16`](2026-11-04-issue-529-530-backport.zh.md#L16)。这些只证明释放防线必要，不证明当前全部公平性机制必需。

### P2：长 Run 的全量校验与序列化，先测后决定是否换存储

- **位置与频率：** 每次 inspect 读取并解析完整 Run，再验证定义绑定；每次 CAS 验证新值、压缩历史、JSON 编解码，再对新 envelope 算内容 hash 和原子发布。见 [`runtime-service.ts:720`](../../domains/engine/runtime-service.ts#L720)、[`runtime-store.ts:1194`](../../domains/engine/runtime-store.ts#L1194)、[`:1001`](../../domains/engine/runtime-store.ts#L1001)。
- **建议：** 首先利用候选一去掉同命令重复完整 inspect；利用不可变共享子树复用已验证结果。只有确认长 Run 主导耗时后，再考虑把已结算 Action 历史与当前可推进状态分开读取。不要为普通短任务立刻新建复杂增量日志系统。
- **依赖假设：** 已提交历史不可变，关键等待、审批、Action 执行身份仍能内容寻址并校验。当前存储明确使用完整 checkpoint，不使用增量日志，见 [`runtime-store.ts:282`](../../domains/engine/runtime-store.ts#L282)。
- **预期收益：** 长历史反复读取/校验会随 N 增长；可减少 CPU 和字节处理。当前已用 JSON value pool 和不可变子树长度缓存压缩重复历史，不能说每次都先展开数十 MiB 再复制。见 [`runtime-history-storage.ts:13`](../../domains/engine/runtime-history-storage.ts#L13)、[`:45`](../../domains/engine/runtime-history-storage.ts#L45)。
- **失去保证：** 只看“最新状态小文件”会漏掉被篡改的审批、一次性执行和原领取信息；新分区必须能验证历史与当前 authority 的联系。共享存储架构变化影响范围较大，不能用省代码作为单独理由。

## 不建议直接删除的防线

| 防线                                                        | 当前证据与保留理由                                                                                                                                                                                                                                                                                                                           | 可缩减的部分                                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 输入完整性、候选内容、真实检查收据                          | 归档前候选漂移、检查执行后修改输入、不可读输入不是假想并发；同一个 Agent 自己运行的命令也会改文件。输入采集不完整不得复用旧成功。[`native-sdk-checks.ts:1656`](../../domains/comet-native/native-sdk-checks.ts#L1656)、[`workflow-regressions.json:10861`](../../config/workflow-regressions.json#L10861)。                                  | 同一稳定观察内共享读取；不能跨外部命令、编辑、用户等待、执行/提交边界无限缓存。                                               |
| 原子 CAS、Action/attempt/inputHash/claimToken、幂等 outcome | #526 有真实“执行完成但结果拒收”；单 Agent 也会因中断、重复回报、工具超时而重试。                                                                                                                                                                                                                                                             | Runtime 可代填身份；正常 Agent 只提交当前结果，详细恢复模板按需提供。不能把已执行未知当未执行后重放。                         |
| 受管检查的进程树停止确认                                    | Native 检查启动监管进程并登记后才启动命令，Windows 正常退出仍核对整树停止；测试可以启动后台子进程。见 [`native-check-executor.ts:311`](../../domains/comet-native/native-check-executor.ts#L311)、[`:478`](../../domains/comet-native/native-check-executor.ts#L478)、[`owned-command.ts:29`](../../platform/process/owned-command.ts#L29)。 | 已匹配的终止证据不重复探测，当前已经实现。不能改为裸 spawn 然后只看主进程 exitCode。                                          |
| workspace / worktree / 原固定应用身份                       | 项目移动、Git 目录替换、分支切换、归档后的历史查询都有登记。读旧 handle 也不能悄悄初始化新 namespace。见 [`native-sdk-state-store.ts:325`](../../domains/comet-native/native-sdk-state-store.ts#L325)、[`workflow-regressions.json:10517`](../../config/workflow-regressions.json#L10517)。                                                  | 请求内共用已解析身份；关键异步边界重新核对。若取消自动 worktree/Supervisor，可以删对应产品调度，不能取消已有 Run 的归属保护。 |
| 旧版本迁移与拒绝错误格式                                    | #530 的 Git 跟踪迁移 fence 和 v2/v3 cancellation ownership 是已登记故障。                                                                                                                                                                                                                                                                    | 当前格式快速分派；旧入口按需加载。明确停止支持的版本才可删，需给迁移路径，不能直接让历史 Run 失读。                           |

`watchdog` 还出现在 Eval 生命周期，这部分与普通 Native/Classic 不同。本轮不启动 Eval，也不把 Eval watchdog 模块算作每个普通 change 的固有成本。仓库 #529/#530 文档中的 watchdog 修改只是测试收尾等待，不能据此论证普通 Runtime 监管器多余。[`2026-11-04-issue-529-530-backport.zh.md:30`](2026-11-04-issue-529-530-backport.zh.md#L30)

## 已有耗时证据能说明什么

[`2026-11-01-052-continuation-performance.zh.md`](2026-11-01-052-continuation-performance.zh.md) 保留 Windows 冻结 0.5.1→0.5.2 的真实持久化 Runtime、检查和归档记录，模型与用户响应由脚本模拟，不包含公开包 bin/router、真实模型或用户等待。

- 原冻结组 Native 正常完整流程三对中位数 44.220→37.918 秒，Classic tweak 正常 38.445→34.176 秒；最终补充组分别为 47.337→45.295 秒和 41.049→38.511 秒。批次采样条件不同，不能混算一个普遍提升比例。
- 10k 文件首次完整 Native 捕获由 0.782→2.970 秒，是读取契约扩大造成；后续编辑/重复观察较快。旧版只读取 32 份 generated 文件，候选读取 10032 份实际输入，不能为提速恢复旧的漏读。
- 共享 SDK 100 Action 样本方向混合，两边文件 API 次数同为 123730；不能推断通用引擎当时已稳定提速，也不能把共享引擎结果当 Native/Classic 100 Action 流程。

这些结果是历史线索。当前 v3、新插件入口、CLI 装配、锁和历史编码均有后续改动，当前优先级还应结合独立测量确定。未实测的候选均不承诺百分比、token 节省或模型正确率。

## 实施顺序与验收边界

1. 先测并减少同次命令的重复工作：固定普通 v3 fixture，分别计冷 CLI、warm facade、owner/Run 读取次数、定义构造、Git 调用和输出体积。保持候选、检查命令、审批次数和产物一致。
2. 再处理 Classic 逐 revision 投影：先迁移读者，再改变写边界；验证正常推进、旧格式、冷恢复、结果拒收、跨 worktree 历史和取消。保留用户已有文档编辑。
3. 事务目录与无 selection Hook 用 0/10/100/1000 历史规模验证线性增长；只有真实增长明显时才引入活动索引或改变发现策略。
4. 由用户决定能力收缩：是否取消自动 Supervisor、多机共享 Run、公平等待和旧版本支持。代码清理量与普通流程加速分别报告。
5. 每步先跑精确定向普通测试和临时项目公开 CLI，再补对应生成 Runtime。涉及模型遵循、检错能力和端到端 Agent 效率时仍需另获明确 Eval 请求；本报告不授予启动权限。

## 当前无模型微测

父任务在当前 HEAD、Windows、Node 22.20.0 中准备小型初始 phase 的临时 fixture，以公开 CLI 串行各测 5 次，daemon 关闭；下表为中位数。进程内样本在 warm import 后调用已导出的 CLI facade，仅用于分解，**不是现成产品 daemon 能力**。文件 API/子进程计数在另一轮 instrumentation 采集，不把 instrumented 耗时混入计时。

| 入口                                                | 公共 CLI | warm 同进程 facade | 异步 lstat / realpath / open | 子进程                               |
| --------------------------------------------------- | -------: | -----------------: | ---------------------------: | ------------------------------------ |
| Node 空启动                                         |     49ms |                  — |                            — | —                                    |
| Native 具名 status                                  |    392ms |              263ms |               482 / 442 / 26 | git 1                                |
| Native 项目 status                                  |    313ms |              185ms |                130 / 113 / 9 | git 1                                |
| Classic state next（快捷前缀）                      |    562ms |              378ms |               764 / 647 / 31 | git 3                                |
| Classic state next（显式 classic 前缀）             |    564ms |              368ms |               764 / 647 / 31 | git 3                                |
| Classic state get phase status（快捷前缀）          |    957ms |              132ms |               685 / 556 / 30 | node.exe 1；另有 144 次同步 realpath |
| Classic state get phase status（显式 classic 前缀） |    968ms |              131ms |               685 / 556 / 30 | node.exe 1；另有 144 次同步 realpath |

原始记录为本机临时目录 `C:/Users/BENYM/AppData/Local/Temp/comet-simplification-3c83c6b44b1f4c6ba281ad7201faec71/results.json`；同目录 `measure.mjs`、`instrument.mjs` 保存测量脚本。临时数据不随 Git 克隆。本轮已读取 results.json，核对 HEAD、平台、采样值与该表一致。

同一初始 tweak fixture 的外层分解进一步支持学习路径判断：warm `app/commands/classic.js` 的 `runClassicFacade`，state next 五次中位 377ms、get 为661ms；底层 `runClassicCli` 分别约378ms、132ms。next 外层几乎没有增加成本，get 外层约增加529ms。该分解仍是现有两个入口的比较，**不是删除功能后的 A/B 对照**，也不证明529ms全部能无损消除。脚本与记录为同临时目录 `facade.mjs`、`facade-results.json`；本轮已读取后者核对。

该结果支持优先调查祖先路径重复校验、查询学习捕获和同命令重复读取。快捷前缀与显式前缀的耗时接近，不能据此宣称改路由可显著提速。它不覆盖 Verify/Archive 的实际检查、生成 Runtime 完整链、模型阅读、平台工具延迟或用户等待，也未通过移除机制后的对照证明收益。未修改任何防线，不能把现有 facade 与公共 CLI 的差值当成未来保证可实现的节省。

### 无竞争锁的成本分解

同机执行空临界区，一次预热后各采九次：当前 `withRecoverableFileLock` 的取得与释放中位数为 **41.61ms**，范围 39.50–44.05ms。本机独占控制组使用 `fs.open('wx')`、写入 owner、读取并比较自己的记录后 unlink，中位数 **6.12ms**，范围 5.00–10.59ms。原始脚本为上述临时目录 `locks.mjs`，记录为 `locks/results.json`。

控制组不包含公平排队、崩溃恢复及完整竞态保护，与当前锁**不等价**；该结果只提供简化后可能达到的成本下界，不能声称已经实现约六倍提速。它证明 choosing/ticket 等协议即使没有竞争也会增加开销，而不是只有冲突才付出成本。替换仍以明确采用本机、同 Run 单写入者、竞争立即返回 busy 的契约为前提；不同 Run 的并行和并发只读无需取消。

[Node 官方文件标志说明](https://nodejs.org/api/fs.html#file-system-flags)确认 `wx` 在路径已存在时失败，同时指出独占标志在网络文件系统上可能不生效。因此这里的本机文件系统限制是实际支持范围，不能把这个控制组推广为共享网络盘方案。

本轮实际执行了分支/工作区检查与生产源码、回归登记、历史实验记录、上述当前微测结果的只读核对；本文 Prettier 检查、99个本地来源/文档链接的存在性及行号范围检查、`git diff --check` 均通过。没有运行产品测试、真实平台 Hook、模型 Eval、容器评估或全量测试：本轮只新增研究记录，不改变产品行为；测量不替代修复后回归证据。源码分析不是行为修复证明。
