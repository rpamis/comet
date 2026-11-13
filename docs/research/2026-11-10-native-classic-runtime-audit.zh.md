# 053 的 PID、锁与 Native/Classic Runtime 减负审计

2026-11-10，分支 `053`，HEAD `630ce380787f446e803f94b4b90cbbdbf8663364`，包版本 `0.5.3`。工作区包含前一任务 #545 的未提交修改，本轮保留这些修改，只新增审计文档。下文 Native v4、Classic v2 指内部 workflow 定义版本。

## 结论

PID 机制没有完全移除。Native 主锁与 SDK Run 写锁已经使用无 PID 的 SQLite 事务，但 Classic 新 v2 仍通过四个生产模块调用另一套旧 PID 文件锁。旧实现仍会记录 PID、机器名、进程创建身份，并在争用时探测原进程。两套函数都叫 `withRecoverableFileLock`，不能只检查 Native 锁文件或搜索业务目录里的 `pid` 就断言完成。

新 Native v4、Classic v2 已把普通检查交给 Agent。下一轮优先处理旧 PID 锁、Native 的纯内部结果转交 Action，以及 Run 外的重复状态对账。复核历史设计后，撤回整体删除 Classic 任务 CLI 和执行方法状态的建议；任务准确勾选、恢复和用户已确认的执行方式应保留。旧受管检查和内容快照的整段删除仍须先明确兼容退休政策。

Classic 的完整证据见[Classic 专项审计](2026-11-10-classic-runtime-audit.zh.md)。

## PID 与锁的真实状态

| 范围                                        | 当前实现与证据                                                                                                                                                                                                                                                | 判断                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Native 主锁、Run-store 写锁、检查活动锁     | `platform/fs/recoverable-file-lock.ts:104` 获取 SQLite `BEGIN IMMEDIATE`，新 metadata 只有协议版本、nonce、时间和可选操作说明；`domains/engine/runtime-store.ts:990` 使用该实现                                                                               | 新锁不绑定历史 PID；写入互斥仍保留                                                 |
| Classic 创建、路径准备、状态写入与 Run 投影 | `classic-runtime-ownership.ts:13`、`classic-runtime-paths.ts:11`、`classic-store.ts:23`、`classic-sdk-state-store.ts:23` 导入 `platform/fs/plugin-store.ts` 的旧实现                                                                                          | 当前新 v2 也执行，PID 退役遗漏                                                     |
| 旧 PID 锁本身                               | `platform/fs/plugin-store.ts:94`；第 105 行读取本进程创建身份，第 107 行写 PID，第 155 行探测旧 owner 存活；无有效 owner 时还按文件年龄回收                                                                                                                   | 应统一委托现有无 PID 锁，删除这套独立实现；迁移旧记录仍需核对原操作是否停止        |
| Native 旧锁协调与诊断协议                   | `native-lock.ts:16` 的未知 owner 年龄常量已为 0；第 36–37 行仍有 publication/coordinator 字段；第 157 行扫描 `.coordinator/*.claim`；`native-sdk-cancellation.ts:244` 仍输出最小等待年龄；新锁诊断类型仍有 coordinator，`malformedLockStaleMs` 只保留输入兼容 | 历史协议与空壳字段仍在；停止支持旧格式后可整段删除，不能算成当前 PID 探测          |
| Native 检查旧记录                           | `native-sdk-check-execution.ts:139` 读取旧 PID/identity 只为兼容原停止记录，第 155 行后移除旧 owner；`native-local-execution.ts:159`、`native-supervisor-state.ts:324` 也处理旧字段                                                                           | 是兼容读取，不是恢复方按 PID 接管进程                                              |
| 本次启动命令的退出和终止                    | `native-check-executor.ts:431`、`native-snapshot.ts:340`、`platform/process/terminate-process-tree.ts` 使用当前 child/PID；`platform/process/comet-daemon.ts:61` 提供进程诊断 PID                                                                             | 不等于历史流程 PID 绑定；只要 Comet 仍启动真实子进程，就不能机械删除所有 PID 字样  |
| Eval 与应用安装等其他产品能力               | `platform/process/run-owned-command.ts:71`、`eval-worker.ts:22` 仍读取创建身份；`domains/workflow-application/delivery.ts:44` 仍用旧锁保护应用安装                                                                                                            | 不属于 Native/Classic 普通检查，但说明整个产品远未做到无 PID；保留能力时需分别处理 |

现有 SQLite 锁仍有 metadata 文件和 `.sqlite` 数据库，获取时重试事务，诊断时尝试获取事务；旧记录、修复 token 和停止确认仍有兼容分支。因此“PID 退役”不等于“锁与恢复协议全部删除”。

## 局部实测

Windows、Node 22.20.0，系统临时目录。每次锁测量使用独立进程，先导入当前源码，再计时一次无争用调用；不含模块导入、Node 启动和 Agent 工具往返。

| 调用                    | 三轮耗时                 | 实际 metadata 字段                               |
| ----------------------- | ------------------------ | ------------------------------------------------ |
| 旧 `plugin-store.ts` 锁 | 83.16 / 83.38 / 82.76 ms | pid、nonce、createdAt、hostname、processIdentity |
| 新 SQLite 锁            | 10.92 / 10.17 / 10.73 ms | protocolVersion、nonce、createdAt                |

这证明旧 PID 锁仍执行且有局部开销，不能推算一整条 Classic 命令必定多耗数次 83 ms。

另外通过生成的 Native init/new 创建隔离 v4 Run，关闭 daemon 后测三次生成 status 命令：397.47 / 404.94 / 397.19 ms，JSON 为 7,446 字节。同一进程直接读其状态文件为 0.56 / 0.46 / 0.43 ms、3,003 字节。直接读取的是便携状态材料，不提供与权威 Run 查询相同的保证；该对照仅说明普通阅读不应反复要求完整 status，不能据此证明 Agent 的整个工具调用快多少。

## 可以删除或合并的职责

### 1. Classic 任务 CLI 保留，优先消除重复成本

`assets/skills-zh/comet-build/SKILL.md:29-30` 仍要求计划与 task authority/task ID 映射，任务勾选和协调进度经 `state tasks`、`state task-complete`、`state checkpoint` 完成，且明确这些命令不推进 SDK Run。`classic-state-command.ts:1310-1399` 对 SDK 也维护任务解析、计划同步、状态锁和分支检查。

复核 `2026-09-09-optimize-classic-efficiency` 的已确认 brief、提交 `7b05435a` 和当前实现后，这些机制有明确职责：唯一 tasks.md 完成状态、稳定任务身份、重排/恢复时准确勾选，以及 Build 结束前拒绝未完成项。新计划已禁止第二套 checkbox 账本，旧计划才同步显式 ID 映射。应保留这些能力，优先消除旧 PID 锁、重复查询和已完成项重复写入。不能仅凭工具调用数认定 Agent 手工编辑同样可靠且更便宜。

已登记的 `classic-completed-task-progress-guidance` 就记录了任务全完成后仍重复 task-complete、取错 ID 的真实轨迹；这支持优化恢复指导与避免重复写入，不支持删除整个任务 CLI。没有找到最初用户关于“Agent 忘记打勾”的原话，不能将该动机当作已核实的唯一历史原因。CLI 本身也不能证明代码实际完成，仍需 Agent 实施和验收。

该 Skill 还写着 complete-build 后进入检查 Action，与新 v2 已移除普通受管检查不一致。下一轮应按中文先确认、再同步英文的规则处理。

### 2. Native 的纯内部转交 Action，可从新定义删除

- `native-sdk-next.ts:865` 的 `shape.revalidate` 直接取已保存的 `run.outputs['shape.prepare']`，没有重新阅读材料。随后仍在 staging Run 中 claim/recordOutcome，再发布一个 revision。可以在批准 Shape 的同一次确定性状态更新里完成这段转换，删除该独立 Action。
- `native-sdk-report.ts:213-240` 的 `acceptedResult` 对 v4 不再核对受管检查，只确认已有 Builder/Verifier/用户批准并返回报告 metadata；`native-sdk-application.ts:1429` 仍为它保留 `verify.revalidate`。可合入接受 Verify 的转换或实际 Archive 预检，删除这段专用 executor、validator 与恢复路径，保留副作用前的一次批准核对。

当前 `native next` 已在一次命令内自动推进，Shape 计算也已用内存 staging 合并 claim/outcome。删除这些步骤节省的是状态复制、CAS、检查点与恢复分支；不能宣称每一步目前都需要额外一次 Agent 工具调用。

### 3. 重复状态权威与正常读取时的自动对账，应收缩

Native `native-sdk-state-store.ts:479` 的 boundary checkpoint 仍获取投影锁、重新读权威 Run、构造 checkpoint 并写便携 YAML；第 877 行在 v3/v4 提交后调用它。Classic 还有更重的可编辑 YAML 配置导入、checkpoint、marker 和投影修复，详见专项报告。

建议只让 SDK Run 推进状态；正文文档由 Agent 维护，摘要按需生成。便携快照仍用于跨工作区/跨设备、外部交接和归档恢复，不能直接删除唯一恢复事实。可以删除的是普通读取中的配置反向导入、必须先修好阅读投影才能继续的分支，以及由第二份可编辑状态衍生的对账锁和 marker。

Native 已只在外部边界导出 checkpoint，不能再把“停止每个内部 revision 都写快照”算作尚未实现的收益。此项主要应先针对 Classic 的双向职责。

### 4. 保留用户选择的执行方法状态

Classic 的 buildMode、tddMode、reviewMode 是用户明确选择或确认的执行约定。`assets/skills-zh/comet-build/SKILL.md:28` 和方法参考第 54–64 行要求展示配置、复用已有决定；`classic-sdk-build.ts:88` 起通过提案及 Wait 保存批准。拒绝配置时不写入，展示值与提案不一致时拒绝批准。因此保留这些状态和用户选择，不能改成 Agent 自行决定。可优化重复展示、再次询问和内部多次落盘；已有 `propose-build --confirmed` 的合并路径应复用。计划目录限制等问题可另行评估，不与删除用户决定混为一谈。

Native 的 brief 检查已经简化：`native-artifacts.ts:178` 只读取非空材料和明确的 blocking 问题，不再判断完整语义。不要把已经撤下的“代码替 Agent 审需求”重复列为现存大头。验收项 ID 与完整覆盖检查仍有稳定契约价值，不建议连同普通文档格式约束一起删除。

### 5. 旧受管检查与内容快照可整段退休，但先决定兼容范围

新 Native v4 在 `native-sdk-application.ts:2992` 删除检查 steps/executor/validator；Classic v2 在 `classic-sdk-application.ts:2373` 先构建旧应用再删除检查 steps。旧定义、受管执行器、逐项回执、停止证据、刷新、重试、snapshot 与旧工作区恢复代码继续随包保留。

尤其 `native-snapshot.ts` 仍有 3,410 行，`createNativeCurrentContentSnapshot` 第 3361 行起仍读取旧 snapshot 配置并采样；`native-new-command.ts:157` 还公开接受 `--runtime compat`，所以这不是纯粹无调用的死代码。

若继续承诺旧 Run 和固定应用原样恢复，当前应将它们隔离到按需加载的兼容入口，而不是直接删除。若用户决定停止执行旧协议，才可移除 Compat 新建入口，保留必要历史只读或一次迁移能力后，整段删除旧检查、快照、receipts、runner channel 和对应专用锁。#545 刚修的路径正属于这段兼容成本，不能一面承诺恢复旧 Run、一面静默撤下。

### 6. 先收窄命令依赖，再讨论更多缓存和常驻进程

当前生成文件大小：Native next 1,716,408 字节、status 1,534,466 字节、聚合 runtime 2,302,338 字节；Classic state 1,141,361 字节、聚合 runtime 1,491,040 字节。这些是文件大小，不是每次执行的功能量。

使用 esbuild metafile 追踪静态输入，Native next 有 264 个源码输入、status 258 个、Classic state 235 个。明确的引入路径包括：

```text
Native status -> native-sdk-status -> workflow-application/index
  -> workflow-application/delivery -> platform/fs/plugin-store -> process-identity

Native next -> native-cli-shared -> native-change -> native-snapshot

Classic state -> classic-state-command -> classic-runtime-ownership
  -> platform/fs/plugin-store -> process-identity
```

静态包含不等于每次命令执行了安装或 PID 探测。但这说明只读查询和新入口仍装配安装、旧恢复及旧快照依赖。建议给跨领域调用提供职责明确的窄公开入口，新定义独立装配，旧定义按需加载。不要先增加新的缓存、daemon 协调或文件指纹来补偿不必要的装配。

status 保留诊断价值；普通推进沿现有 next 业务响应即可，正文阅读直接用文件工具。需要诊断时再查询完整历史与模板，不要求 Agent 每步重新查询、解析并复述一份状态包。

## 不建议删除的最后一层能力

- Run 的一次原子更新/CAS 和短期写入互斥。当前文件存储是检查 revision 后发布新文件，完全移除互斥可能让两个进程都认为同一 revision 提交成功；Worktree 隔离不等于同一 Run 永远只有一个工具进程。
- 用户批准、当前 Action 与真正执行者的绑定、用户要求的独立验收。可以少存副本，不能由 Agent 猜测批准已经存在。
- Archive/Git/OpenSpec 等实际副作用的结果核对。命令可能已成功而本地结果未保存；未知结果先检查实际文件、提交和远端，不能自动重放。
- 实际写入路径、目标仓库及批准交付范围的单次校验。可以删除重复层，不能删除真正边界。

## 建议顺序

1. 统一 `plugin-store.ts` 旧 PID 锁，删除重复的存活探测、机器身份和年龄回收；验证 Classic 新 v2 真正的创建、投影与任务路径。
2. 保留 Classic 任务 CLI、稳定 ID、完成检查，优化重复查询和提交；Native 两个纯内部 Action 仍可单独评估删除。
3. 收缩 Classic YAML 双向对账，保留用户按 change 确认的方法配置和批准，保持单一 Run 权威及必要的外部恢复快照。
4. 明确兼容退休范围后，整段删除旧 Runtime 链；若保留兼容，先从新命令 bundle 隔离。同步收窄跨领域 import，减少普通命令装配。

## 验证与限制

同日复核用户指出的历史设计：执行方法的已接受配置、拒绝与提案漂移、任务未完成时阻止 Build、稳定任务完成及任务解析/映射/幂等，共 16 项定向测试通过。使用 `classic-sdk-application.test.ts`、`classic-state-config.test.ts` 的精确名称选择 5 项，再执行 `classic-tasks.test.ts` 全文件 11 项。已撤回任务 CLI 与方法状态的整体删除建议，未修改相应产品代码或 Skill。

本轮执行源码/静态依赖核对、真实锁 metadata 探针、六次锁调用计时、隔离 Native v4 init/new 和三次 status 计时。审计文档执行 Prettier 和差异检查。未修改产品代码，未运行仓库全量、真实平台 Hook、真实模型 Eval 或完整模型流程。

没有把代码行数、单次读取与权威状态查询之差当作质量相同或端到端提速证据。具体删除应先验证未批准不推进、真实失败不通过、原 Run 可恢复、未知副作用不重放和合法流程可完成。将更多判断交给 Agent 后是否保持质量，需要另行获得明确范围的真实模型 Eval 授权；本审计不启动 Eval。
