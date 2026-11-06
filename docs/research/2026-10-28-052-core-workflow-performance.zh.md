# 052 Native 与 Classic 核心流程性能建议

日期：2026-10-28。源码基线：`35c9860b77b42bafa0c2d80d8d695889f888a924`，版本 `0.5.1`。本地 `052` 从刷新后的 `origin/master` 建立；建分支后再次通过 `ls-remote` 核对远端提交。没有修改产品源码、Skill、版本、Changelog、生成资产或 `website` 子模块，也没有提交和推送。

本次按用户的研发原则重新审查后，052 应先减少普通编辑引起的证据失效、重复确认和恢复步骤，再缩短剩余检查的 Runtime 成本。最新优先级和编辑场景证据见[编辑后续行复核](2026-10-28-052-edit-continuation-review.zh.md)。本文保留已有性能测量；下文的“第一批、第二批”只表示 Runtime 实现优化内部的顺序，不再表示 052 的整体投入顺序。

## 产品原则与优化目标

用户于 2026-10-28 明确补充：Comet Skill 帮助用户更好地研发，用户可以自由修改文档、代码和执行其他操作，通常不会移动或破坏 Comet 的结构和产物。整个流程应轻量、可靠、极致快速；不能因为一点修改就需要付出很大的恢复成本。

因此，052 的工作顺序应先审查哪些阻塞、证据失效和恢复步骤确有必要，再优化剩余检查的执行成本。后文的微基准用于定位实现开销，不能单独决定产品体验。

- 日常文档和代码编辑作为正常使用路径。只影响展示或未改变需求含义的文档编辑应尽量直接续行；实现修改只刷新受影响的候选和检查，保留仍有效的需求确认与其他证据。
- 已确认需求或授权范围确实变化时，说明实际变化，并对受影响部分重新确认。小幅编辑不等于语义变化；必要的新批准仍由用户作出。
- 原执行记录、已完成工作和仍有效检查尽量保留，优先由 Runtime 自动衔接。避免因文件字节或时间戳变化而要求完整重开、全量重验或重新构建上下文。
- 内容检测保持语言无关，不依赖语言解析、AST、注释规则或编译。Runtime 提供原始变化，当前 Agent 判断含义、影响范围及需要执行的检查；判断融入当前工作，不因每次编辑额外启动独立审查或批准流程。
- 普通编辑与实际结构、机器状态或产物损坏分别处理。损坏恢复检查不应机械地成为每一步日常操作的固定成本；复用依据必须能证明与当前输入相符。
- 衡量完整推进和编辑后续行的耗时、命令往返、用户操作次数及重跑范围，同时核对正常完成、失效证据拒绝和恢复结果。不能以放行旧检查代替可靠性，也不能仅用防御性检查数量衡量可靠性。

以上是设计与验收目标，本轮没有实现这些行为变化。后续复核已核对当前分支对正式文档、普通说明、源码注释、暂存和空提交的不同处理，证据与未覆盖边界见[编辑后续行复核](2026-10-28-052-edit-continuation-review.zh.md)。

下一轮验收应补充这些编辑在 Build、Verify 和待归档阶段的完整公开 CLI 续行场景，分别检查保留了哪些决定和证据、重跑了什么、是否要求用户操作以及新增耗时；域 API 对照不能代替完整流程验收。

## 当前测量

环境为 Windows、Node `v22.20.0`。先运行 `pnpm exec tsc` 从当前源码更新本地 `dist`。CLI 基准关闭 daemon，每个计时样本启动新 Node 进程，文件系统已预热；每项三次预热、五次正式采样，fixture 准备和恢复不计时。单独插桩样本用于观察 Git 和文件操作，不与正式计时相加。

| 场景                                   |       中位数 | 插桩观察到的文件操作 | 解释                                                  |
| -------------------------------------- | -----------: | -------------------: | ----------------------------------------------------- |
| 空 Node 进程                           |       106 ms |                    0 | 启动成本参考                                          |
| CLI 版本                               |       161 ms |                    0 | 当前快速入口参考                                      |
| Classic Compat current / next          | 478 / 387 ms |            258 / 481 | 简短读取也存在固定封装成本                            |
| Native SDK status                      |       581 ms |                  550 | 小 Run 的当前状态查询                                 |
| Classic SDK next                       |     1,153 ms |                  858 | 小 Run 的 Open 阶段下一步输出                         |
| Native Compat Shape next               |     2,078 ms |                  738 | 准备 Shape 确认，不能代表 Build、Verify 或 Archive    |
| Classic Compat 执行短检查              |     5,237 ms |               12,177 | 实际检查只打印一行；不是项目测试本身耗时              |
| Classic Compat 复用短检查              |     2,083 ms |                4,070 | 已命中复用，仍有明显固定成本                          |
| Classic SDK Build → Verify，跨阶段复用 |    11,179 ms |               17,317 | 两阶段组合；实际检查只执行一次，不是单条 SDK 检查耗时 |

来源为 [`runtime-coldstart-benchmark.mjs`](../../scripts/benchmark/runtime-coldstart-benchmark.mjs)。完整本地 JSON：`C:/Users/BENYM/AppData/Local/Temp/comet-052-coldstart-20261028.json`，`complete: true`，绑定源码提交和构建摘要。该临时文件不随仓库交付。

复现命令（在仓库根运行，输出路径可自行替换）：

```powershell
pnpm exec tsc
node scripts/benchmark/runtime-coldstart-benchmark.mjs --runs=5 --worktrees=1 --targets=node-empty,cli-version,classic-current-public,classic-next-public,native-sdk-status-public,classic-sdk-next-public,native-next-public,classic-check-execute,classic-check-reuse,classic-sdk-build-verify-reuse --output=C:/Users/BENYM/AppData/Local/Temp/comet-052-coldstart-20261028.json
node scripts/benchmark/workflow-scale-benchmark.mjs --runs=3 --warmups=1 --file-counts=1000,10000 --dirty-counts=0,300 --acceptance-counts=none --history-counts=10,100 --snapshot-max-files=20000 --output=C:/Users/BENYM/AppData/Local/Temp/comet-052-scale-20261028.json
```

`snapshot-max-files` 仅控制隔离基准的合成输入，并未在项目配置中新增预算字段。

文件计数只覆盖 `fs.promises` 的 `readFile/stat/lstat/readdir`，没有覆盖所有 `realpath/open`、流读取、同步调用和后代进程。Git 插桩只覆盖本进程的同步调用，不能视为 Native 异步 Git 或整个进程树的总量。插桩时长含重叠或并发，不能用累计值除以正式样本总时长推断占比。各场景既有行为校验、退出状态和复用断言均通过。

首次规模基准在文件数和 dirty 文件维度完成采样后，于验收项维度失败：旧 brief fixture 缺少当前 Shape 要求的 `## Directory structure`。没有为整轮生成完整报告；验收项数量维度没有有效结果，不能用它得出性能或正确性结论。位置为 [`workflow-scale-benchmark.mjs`](../../scripts/benchmark/workflow-scale-benchmark.mjs#L290)。本轮没有修改该脚本或绕过 Shape 校验。

随后排除这一个无效维度，按上面的规模命令完成 18 项场景，每项一次预热、三次正式样本；报告 `complete: true`、`snapshotHealth.complete: true`，Native 内容快照各样本均完整且零遗漏。规模测量的 Git 次数来自 Trace2，覆盖相应操作及后代进程；API 操作复用测量进程，不能与新进程 CLI 数字直接比较。

| 规模场景                         | 1,000 文件 / 10 Actions | 10,000 文件 / 100 Actions |
| -------------------------------- | ----------------------: | ------------------------: |
| Native 全量内容快照              |                1,700 ms |                  4,540 ms |
| Native 干净增量快照              |                1,658 ms |                  2,917 ms |
| Native 全部文件 dirty 的增量快照 |                1,669 ms |                  4,722 ms |
| Classic dirty 输入采样           |                  893 ms |                  3,452 ms |
| Native dirty 输入指纹            |                  878 ms |                  3,789 ms |
| SDK 逐 Action 执行并返回完整 Run |                2,126 ms |                 29,902 ms |
| SDK current 批量执行             |                1,981 ms |                 22,561 ms |
| SDK 最终完整读取                 |                   23 ms |                    135 ms |

Native 候选注释比较在零 dirty 文件时为 206 ms，300 个注释修改文件时为 2,377 ms、12 次 Git；基准同时确认这些注释修改保留候选，而真实代码变化不保留候选。这些数字描述现有注释识别路径；后续由 Agent 判断内容含义，Runtime 提供原始差异并绑定判断对应的输入，不继续扩展按语言识别注释的机制。

`snapshotHealth` 只核对 Native 内容快照。`native-input-dirty` 调用仅返回指纹，没有在这一行独立核对底层输入快照的 `complete`；这一组数字用于诊断，不能证明真实检查收据可复用。SDK 历史样本逐项核对所有 Action 执行及 Run 完成，但不代表 Native Supervisor 或 Classic 完整归档。

## 第一批：检查和输入采样

### 1. 缩减路径检查和状态装配的重复工作

优先覆盖 Classic Compat `check run/reuse` 和 Classic SDK Build → Verify，再对 Native 的相同共享基础设施做对照。上述样本的 `lstat` 分别达到 12,106、4,046 和 17,072 次；这足以说明工作量偏大，但不能单凭次数认定全部等待由 `lstat` 造成。

随后单独重建同一 SDK fixture，对一次 Build → Verify 插桩增加 `realpath/open` 和调用栈聚合：观察到 14,412 次 `realpath`、17,072 次 `lstat` 和 839 次 `open`。其中 `inspectExistingChain` 调用 8,540 次 `realpath` 和 8,979 次 `lstat`，`assertRealProjectRoot` 各调用 1,988 次；同一项目根的 realpath 被读取 852 次。这个结果把重复工作定位到受保护路径的祖先链及根目录复查，而不只是泛指磁盘慢。调用栈插桩会影响时长，累计耗时不用于计算可实现的提速比例。原始聚合位于 `C:/Users/BENYM/AppData/Local/Temp/comet-052-fs-profile-20261028.json`；临时诊断程序为同目录的 `comet-052-fs-profile.mjs`，通过公开基准入口注入观察，没有修改仓库脚本。

[`hashProtectedProjectFile`](../../domains/workflow-contract/protected-project-path.ts#L24) 先检查路径和项目根，再在安全读取各检查点核对祖先链；[`readProtectedProjectFileUncached`](../../domains/workflow-contract/protected-project-path.ts#L370) 有同类结构。[`race-safe-read.ts`](../../platform/fs/race-safe-read.ts) 保留读取前、打开后和读取后的身份核对。普通 CLI 写入与收据 hash 不使用 Hook 决策缓存，现有缓存不能直接全局打开。

建议先为项目发现、受保护路径、收据、SDK 投影、输出装配分别计时，沿调用链显式传递当前观察和已解析布局，移除同一阶段重复的封装层读取。若需要批次路径观察，必须明确其有效区间和重新验证点；执行检查、应用写入、用户等待及 Archive 副作用都会结束旧观察的有效期。

验收同时比较调用预算和真实耗时，并保留祖先目录替换、符号链接、同路径文件替换、读取竞争、CAS revision 变化、未知执行结果和正常完成路径。不能用缓存旧批准或只比较 mtime/size 换取提速。

### 2. Native 的变化记录与 Agent 判断共用当前输入

[`native-sdk-checks.ts`](../../domains/comet-native/native-sdk-checks.ts#L706) 在检查前分别调用完整输入快照和候选摘要，检查后又分别执行，结果提交时还会核对当前内容。[前采样](../../domains/comet-native/native-sdk-checks.ts#L706)、[后采样](../../domains/comet-native/native-sdk-checks.ts#L803)、[提交校验](../../domains/comet-native/native-sdk-checks.ts#L904)。候选摘要的 dirty 文件先在 [`readNativeCheckInputObservation`](../../domains/comet-native/native-portable-checks.ts#L1437) 中读实际字节，再在注释语义比较中读取文本。[dirty 读取](../../domains/comet-native/native-portable-checks.ts#L1489)、[语义比较](../../domains/comet-native/native-portable-checks.ts#L1664)。

上述源码描述现有实现。目标方案在必要边界记录文件内容、路径与 Git 状态，共享原始字节和差异；当前 Agent 判断语义、影响范围和需要执行的检查，Runtime 将判断绑定到相应输入并接续流程，不自行派生语言相关的语义摘要。实际检查前后及结果提交时核对输入变化，有新差异则交给 Agent 继续判断。

已有 [`nativeCheckInputGates`](../../domains/comet-native/native-portable-checks.ts#L1850) 已让 Compat 预留阶段共用观察；应扩展已证明的方式，避免重新设计一套跨请求状态缓存。

### 3. Classic 快照 Git 查询有限并发，并复用同阶段交付观察

[`classic-check-snapshot.ts`](../../domains/comet-classic/classic-check-snapshot.ts#L474) 内的文件列表、HEAD、索引和 status 仍使用同步查询。完整快照本身已做 dirty 摘要批量化，不能重复宣称要解决逐文件 Git 启动。

建议先测量串行等待，再并发无数据依赖的只读查询；SDK Verify 收集交付输入时尽量使用当前快照已验证的观察。[交付输入收集](../../domains/comet-classic/classic-sdk-delivery-inputs.ts#L143) 实际执行前后、提交和 Archive 边界仍须新鲜复查，查询失败不能拼接为可复用快照。

## 第二批：归档与长流程规模

### 4. Classic 交付路径索引

[`collectClassicSdkDeliveryInputs`](../../domains/comet-classic/classic-sdk-delivery-inputs.ts#L193) 对每个输入重新执行 `[...changed].some(...)`；[`committedHash`](../../domains/comet-classic/classic-sdk-delivery-inputs.ts#L218) 对每个交付文件线性扫描缓存的提交树。这两处是源码可确认的乘法比较成本，但本轮未测出它们在完整 Archive 中的耗时占比。

建议用路径集合、父级目录匹配和每个仓库/提交的路径 Map 替代反复扫描。保留子模块目录前缀、父提交固定的子模块版本、missing、符号链接和跨提交内容检查。使用大仓库、少量/大量交付文件、多个提交和嵌套子模块样本比较完整交付结果；不能只测数组查找微基准。

### 5. 根据规模曲线选择 Native 快照与 SDK 历史优化

Native 增量快照已经存在，并且不只看 Git status：它核对索引、特殊 index 标志、工作区实际变更和采样期间的目录身份。[增量路径](../../domains/comet-native/native-snapshot.ts#L3011) 待量化的方向是保留这些边界后减少重复枚举与元数据操作，优先覆盖大量 dirty 文件和子模块。

SDK 已有 current 方式和精简状态输出，不能仅因为 Run 历史增长就重做存储。本轮 100 Actions 对照中，已有 current 批量入口为 22.56 秒，逐 Action 返回完整 Run 为 29.90 秒；最终完整读取只有 135 ms。current 的这一组约 24.6% 差异是已有路径之间的对照，不是本轮实现的提速。剩余成本应先沿每 Action 的读取、锁、CAS 提交和收据路径细分，结合第一项的祖先链观察减少重复工作，不能仅以缩短最终 JSON 或缓存一次 inspect 作为主要方案。保持每个 Action 的持久化完成与中断恢复边界。

## 暂不优先投入的方向

- 扩大 daemon、Worker、SEA 或替换 Runtime 语言：空 Node 进程约 106 ms，主要检查样本为秒级；当前证据不足以把进程启动作为第一瓶颈。
- 重复实施已有优化：Native ignored 生成根的字面查询、有限并发 Git；Classic dirty 摘要批处理、SDK 首次 Run 读取复用；CLI compile cache；Hook 轻入口和决策内缓存。这些均已存在于当前源码。
- 直接取消输入核对、独立验收或 Archive 复验：不能据此声称可靠提速。应先按编辑的实际影响判断哪些证据仍有效、哪些检查确实需要执行，再优化必要边界内部的读取；不能默认所有轻微编辑都需要重新完整验收。

减少 Agent 的多余 `status/get/inspect` 往返仍值得观测，但当前 Skill 已要求消费命令返回的 continuation。应先统计真实完整流程中仍存在的重复调用，不能只压缩 Skill 字数或减少验收项来声称提速。真实 Hook 也应单独测量，内部函数耗时不能代替 Agent 平台入口证据。

## 测量与交付边界

当前结果是单台 Windows 机器上的小型隔离 fixture 和合成规模数据；没有完整 Shape → Build → Verify → Archive 重放，没有真实模型 Eval、Agent 平台 Hook、跨平台性能、CPU profile 或 npm 安装验收。真实项目 observability 中最近记录仍来自 2026-10-23，早于已合入的 Git 优化；这些记录仅提供历史线索，没有作为当前 `052` 的性能基线。

建议实施后先用同样的公开入口比较中位数和观测 P95，再用当前候选完成合法归档及相关安全反例。最终是否改善 Agent 的总耗时、命令往返和成功率，需要完整流程和真实模型证据分别确认。

Classic 与共用入口的更多源码线索见[分项调查](2026-10-28-052-classic-runtime-performance.zh.md)。Git 路径索引应保持 [`ls-tree -z`](https://git-scm.com/docs/git-ls-tree.html) 的完整路径和 NUL 分隔语义；阶段耗时可采用 [Node performance APIs](https://github.com/nodejs/node/blob/main/doc/api/perf_hooks.md)。这些官方资料说明接口能力，不提供 Comet 的提速结论。

## 本轮检查记录

- `pnpm exec tsc` 通过；没有运行完整 `pnpm build` 或重建发布资产。
- 十项 CLI 基准通过，每项五次正式样本；SDK 跨阶段复用另有实际执行次数的断言。
- 首轮规模基准因旧 Shape fixture 不合规失败；排除验收项数量维度后的十八项规模基准通过，Native 内容快照完整性检查通过。
- 单独 SDK 调用栈采样通过，用于定位文件操作；不作为正式耗时或 CPU profile。
- `pnpm exec vitest run test/scripts/runtime-coldstart-benchmark.test.ts test/scripts/workflow-scale-benchmark.test.ts`：两文件十二项通过。这些是基准辅助逻辑测试，不会覆盖旧 Shape fixture 的实际运行。
- 研究文档的 Prettier、相对源码/文档链接与行号范围、`git diff --check` 在交付前核对；本次编辑续行复核的额外定向实验与测试见[验证记录](2026-10-28-052-edit-continuation-review.zh.md#验证记录与下一批验收)。
- 没有运行仓库全量测试、真实模型 Eval、真实平台 Hook、跨平台性能、完整工作流重放或 npm 安装验收；这轮是调查，没有实施产品修复，也没有宣称关闭用户行为问题。
