# 普通工作流与 CLI 自有任务的执行责任

日期：2026-11-10。调查分支 `053`，HEAD `630ce380787f446e803f94b4b90cbbdbf8663364`；工作区含父任务和其他执行者的未提交修改。本报告引用调查时的当前源码，后续实施会改变行号。未修改产品或测试，未运行测试、构建、全量或 Eval，也未启动额外 Agent。

## 结论

普通 Native/Classic 开发与测试命令交给 Agent 平台后，可以删除对应 runner、进程登记、停止回执、重试/恢复执行记录及检查快照绑定的闭包。不能把这些入口改成另一种裸 `spawn` 继续执行，再声称已经交还执行责任。

同一批底层模块还被 CLI 自己启动的 Eval、数据集下载及 Dashboard 后台 Eval 使用。因此普通路径断开以后，`owned-command.ts`、`run-owned-command.ts`、进程身份和整树停止模块尚不能全部删除。普通 Git/rg 探测也使用独立的轻量进程调用和超时清理；它们不通过 Native/Classic 受管检查协议。

工作区身份、跨 worktree 搜索和布局迁移是另一组成本。优先删除普通命令的自动搜索、自动修复和自动搬迁；用户选择、审批、当前 change、实际数据存放路径和文件写入安全仍需表达。不能以取消进程管理为理由顺带移除这些规则。

## 已核对的进程调用图

### 普通 Native / Classic：切断运行命令的入口

| 当前入口                                                                                                    | 实际责任                                                                                     | 本轮删除闭包                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domains/comet-native/native-check-executor.ts:300`                                                         | `spawnOwnedCommand` 启动检查，登记 instance、汇集日志、超时停止；`:320` 等整树确认           | 改为 Agent 平台执行和回报后，删除 executor 的启动、进程记录、终止确认及围绕它的历史恢复，不保留换名后的内部 runner                                                    |
| `domains/comet-native/native-sdk-checks.ts`、`native-portable-checks.ts`、`native-portable-verification.ts` | 调用 executor、创建检查尝试/回执并把状态交回 Run                                             | 拆掉命令执行及其恢复分支；保留能表达 Agent 实际验证结果、失败和未执行的最小领域输出，不能把“无需 CLI 自执行”当作“检查已通过”                                          |
| `domains/comet-native/native-sdk-check-execution.ts:58,162`                                                 | 保存检查执行状态和 `comet.native.sdk-check-termination.v1` 回执，含 `terminationUnconfirmed` | 普通路径不再创建进程后，这些停止证明和历史执行恢复不再有生产者，应随调用者一起删除；旧记录只供显式诊断，不在 next/status 自动复活                                     |
| `domains/comet-classic/classic-sdk-check.ts:98,158`                                                         | 自己启动命令、等待停止并形成 SDK 检查绑定                                                    | 删除 runner、准备/refresh/recovery 与进程证明链；`app/commands/runtime.ts:1058` 及应用工厂中的 executor 装配也必须断开                                                |
| `domains/comet-classic/classic-command-checks.ts:661`                                                       | 另一条 `spawnCommand` 执行链，输出日志/快照/`command_check_executed`                         | 不能只删 SDK executor；这里也要退役自动执行。其 `latestCommandCheck` 被 status/Entry 读取，先将只读摘要或 Agent 回报职责拆出，避免只读 CLI 因历史格式继续牵入执行模块 |
| `domains/comet-native/native-verification-receipt-runtime.ts:8-9`                                           | 另一条 `spawnCommand` + `terminateProcessTree` 验证命令执行链                                | `native-check.ts` 和 `native-verification-runtime.ts` 的执行入口一起处理，防止主 runner 删除后仍通过旧 verification 路径启动测试                                      |

以上 Native executor 的静态导入还出现在 `native-runner-input.ts`、`native-sdk-application.ts`、`native-sdk-supervisor-child.ts`、`native-sdk-supervisor-integrate.ts`、`native-sdk-supervisor-integration-repair.ts` 和 supervisor evidence/binding 模块。部分只复用计划类型或校验函数：不能为保留一个类型继续导入已退休执行实现；类型按仍存在的用户语义收敛，过时的 preflight/planKey 也一起删除。

普通工作流的“Supervisor”领域角色与 OS 子进程 supervisor 是两个概念。此处删除的是 CLI 执行与进程监管；并不据此自动删除用户选择的协作方式或父子任务归属。

### CLI 自有 Eval / 下载：当前仍有真实进程责任

| 调用者                                      | 实际启动内容及责任                                                                  | 最小保留理由                                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/commands/eval.ts:458`                  | `runOwnedCommand('uv', ...)` 启动 Python harness，部分入口登记 Eval child、停止结果 | 这是 CLI 自己发起的模型/容器评估；时限、取消、调用者退出后清理不能交给一个并未启动它的 Agent 工具                                                                           |
| `app/commands/eval.ts:649`                  | `uv run ... dataset_fetch.py` 下载数据集                                            | 下载会创建 uv/Python 后代；必须管理实际任务结束、失败与清理，不能改成 fire-and-forget                                                                                       |
| `app/commands/eval.ts:754`                  | Application Eval 的命令执行适配                                                     | 保留 CLI 自有执行边界；普通 Native/Classic 不应通过此入口重新获得自动执行测试能力                                                                                           |
| `domains/eval/application-eval.ts:829-845`  | `runOwnedCommand` 启动应用评估子 CLI，记录执行实例和停止结果                        | 自己负责启动，就需在失败和停止时清理自己启动的子树及标记的 Eval 容器；`:882-889` 清理失败仍保持 stopping                                                                    |
| `domains/eval/eval-run-entry.ts:147,197`    | Dashboard Eval worker 内启动受管命令并核对整树停止                                  | worker 与 HTTP 请求生命周期不同；停止请求、时限与落盘的清理状态必须可操作                                                                                                   |
| `platform/process/eval-worker.ts:11-24`     | detached 启动 Eval worker 并记录创建身份                                            | 后台 worker 明确允许越过 Dashboard 请求生命周期；只删登记会让后续 Stop/恢复找不到实际任务。若要彻底删除这层，必须同时改变后台运行产品能力，不能在普通 runner 清理里静默删除 |
| `domains/eval/dataset-downloads.ts:163-202` | Dashboard 发起下载子 CLI，小时级时限，写 completed/failed/progress                  | 需要活跃任务生命周期与父进程退出清理；返回 downloading 不是成功完成，不应丢弃执行 Promise 的清理责任                                                                        |

### 不能从 platform 整包删除的部分

- `platform/process/owned-command.ts:144` 只给 Windows、`confirmTermination` 的真实 ChildProcess 对象注册 preparation；`terminate-process-tree.ts:7,48` 的 WeakMap/IPC 用于先等待自有 helper 收尾，再运行原整树确认。普通路径退出后，这套机制仍被上表的 Eval/下载使用。它不是普通工作流必须保留的协议，而是尚存 CLI 自有进程实现的一部分。不能只删握手、恢复已复现的双 taskkill 竞争。
- `platform/process/run-owned-command.ts:65-103` 仍读取进程身份并形成停止确认；调用者是上述 Eval/下载。它不应再出现在普通 Native/Classic 的依赖闭包里。可后续按责任移动/缩窄公开入口，但单纯换名不算删除机制。
- `platform/process/process-identity.ts:174` 的 `terminateRegisteredProcessTree` 只被 `domains/eval/eval-run-cleanup.ts:206` 和 `eval-run-manager.ts:411,427` 使用。跨 worker/重启的历史进程停止仍需确认身份，不能把未知 PID 当作旧任务去杀。若去掉这类自动历史停止，改成显式核对/停止且不自动重放，再评估删除对应身份探测；这与保留当前 ChildProcess 句柄清理是独立决策。
- `platform/process/windows-process-identity.ts:191` 仍由 process-identity 调用，当前不能全删。其 `inspectWindowsProcessPresence` 以及 `processInstanceMayBeAlive` 在本次源码搜索中没有产品调用者，仅有定义和测试，可单独移除未使用出口，不影响上面的 Eval 语义。
- `platform/process/windows-process-broker.ts` 保留。2026-11-11 补查发现原搜索漏了 `bin/`：实际入口 `bin/comet.js` 经过 `comet-daemon-router.js` 动态加载该模块，并在 Windows 启动 CLI 自有 daemon 时调用它；默认查询路由与明确 daemon start 均可到达。它不属于无人调用的旧检查执行器，不能删除其启动与清理责任。

## Git、rg 和工具适配不应混入开发检查 runner

`platform/process/external-command.ts:18-108` 是 CLI 自己为文件/仓库能力发起的有时限操作。它没有 owned-command supervisor，但会在超时、AbortSignal 或超输出时调用 `terminateProcessTree`，等待清理后拒绝。`platform/process/ripgrep.ts:131` 同样会终止自己创建的 rg；`spawn-command.ts:183` 保留 Windows 可执行文件与 batch 参数适配。

例如 `domains/comet-memory/repository.ts:297` 通过这个入口调用 Git，保留独立 Git 环境和总时间预算；项目路径身份、Git worktree 与文件读取也调用 Git。它们是 Comet 文件与状态操作的实现，不是替用户执行开发测试。若保留这些 CLI 能力，仍需保留当前进程句柄的失败清理，不需要为它们补上普通工作流的 PID 持久化、停止回执或历史恢复。

`domains/workflow-generation/artifact-verification.ts:214,237-245` 另有直接 spawn 的隔离验证子进程与 timeout/abort kill。它没有引用 owned-command，不能通过删除前述模块来证明“产品里已没有自执行验证”。是否也交给 Agent，需按用户本轮对普通开发验证的范围一起明确；若保留 Creator 的确定性隔离装配验证，其子进程清理仍由 CLI 承担。

## 下载的额外 PID 残留与责任缺口

`dataset-downloads.ts:83-99` 对旧 downloading 状态先看当前进程内 `active` Set，然后对持久化 `ownerPid` 调用 `process.kill(pid, 0)`；`:158` 写入的是调用者 PID。这个 PID 表示 Dashboard/CLI 调用进程，并不能证明实际下载仍活跃；PID 被复用也可能一直显示 downloading。它不是进程创建身份保护后的下载任务记录。

删除此推断时必须同时处理跨进程启动：`:145` 的 SQLite 锁只包住启动事务，下载 Promise 没有在该锁内等待完成。若另一 Dashboard 仍有真实下载，简单把外部记录改成 failed 然后自动重试，会启动第二个写同缓存的任务。

建议最小边界：当前进程的 active 任务由真实 Promise 管理；跨进程旧记录不根据裸 PID推断活跃或停止，也不因 unknown 自动重启。可以由实际下载 worker 持有覆盖整个任务的协调锁，或保留显式“确认旧任务已停止后重试”的路径。无须引入新的通用调度框架，但不能同时撤掉身份和互斥后继续后台启动。无论选择哪种，完成仍须校验当前缓存结果，失败/中断不得复用未完成目录冒充 cached。

## Workspace / Runtime / discovery / migration 的可删闭包

### 1. 普通路径停止自动迁移

`domains/workflow-contract/workspace-runtime.ts:1418` 的异步 `resolveWorkspaceRuntimeRoot` 调用 `prepareWorkspaceRuntimeRoot`，后者不仅解析路径，还在 `:1470-1536` 修复 journal、迁移旧树、创建兼容 fence；`:42` 的 `readWorkspaceRuntimeRoots` 还会同时发现新旧两个存储根。模块包含快照 manifest、quiescence、repair failure、recovery lock 等整套搬迁协议。

最小切口：普通读写只使用明确的当前 Runtime 位置，发现旧树/未完成迁移时给出具体诊断和显式迁移入口；显式 migration/doctor 才加载迁移实现。新项目准备当前数据目录与搬迁旧数据分开。随后可以从普通 bundle 删掉 migration journal、fence repair、扫描旧进程记录及 snapshot-tree 校验闭包；迁移功能是否最终退休是单独决定，不能在普通解析时继续隐式执行。

`domains/comet-native/native-paths.ts:140-175` 除调用上面的通用准备，还会自动 `migrateNativeChangeRuntimeDirectories`；`:180-217` 在没给单个 change 时遍历全部 change 并搬迁。该二级自动迁移也必须断开，不能只替换最外层 resolver。`nativeResolvedChangeRuntimeDir` 的旧布局检查可以保留一次明确的“需要显式迁移”提示。

`domains/comet-classic/classic-layout.ts:246` 当前已经按配置读取/写入，并将显式 root move 与旧配置自动升级区分；不要再把这里说成仍在每次读时自动搬目录。其待完成 `classic-root-move.json` 应由显式恢复处理，普通写入不能擅自接管未完成搬迁。

### 2. 删除普通命令的自动跨 worktree 搜索与切换

`native-runtime-ownership.ts:648-704` 的 `findNativeSdkWorkspace`、`resolveNativeSdkCommandRoot` 会在当前根找不到 owner 时，遍历 Git worktrees、读取其他 Run，唯一匹配后改到另一根。`native-change.ts:629` 的 `hasForeignRegisteredWorkspaceOwner` 也会遍历兄弟 worktree；`native-children.ts:119` 的 `workspaceSources` 让旧 v1 父子发现跨根读取。

最小切口：普通命令只接受调用根和显式 `--project`；找不到给出找不到及如何切根，不自动跳转。移除这些 fallback 后，其 branch/physical identity 对账、跨根候选去重、外部损坏 owner 防御与重复路径解析可以随之收敛。父子任务若仍明确声明其他工作区，只访问已声明的目标，不扫描整个 worktree 列表推断。

`comet-entry/hook-project-root.ts:61-94` 也会列出全部 worktrees并对每个根解析 runtime，按 targets/cwd 重新选项目。Hook 的最小边界应使用显式安装根与本次 cwd/targets；越界目标给出清楚结果，不从其他 worktree 自动挑一个接管。Dashboard 用户主动列举 worktrees（`domains/dashboard/workspace.ts:133`）是观测能力，不因取消普通命令 fallback 就必然删除。

向上寻找当前项目（`native-paths.ts:71`、`classic-layout.ts` 的 `discoverClassicProject`）与横向遍历其他 worktrees不同。若命令已提供显式根，直接用该根；未提供时是否允许从子目录向上找到本项目，可作为一项保留的便捷行为，不需要整套横向恢复。

### 3. 工作区身份：收敛重复证明，保留实际存储归属

`platform/paths/workspace-runtime.ts:38-93` 根据 canonical root、inode/birthtime 与 `.git` 目录生成 workspaceId，决定用户级 Runtime 分区；它与 `platform/paths/project-identity.ts:43-98` 按 origin/common-dir 生成项目聚合身份是不同职责。不能只因都叫 identity 就合并，否则可能把不同 checkout 的可变 Runtime 合并。

`domains/comet-native/native-workspace.ts:154-175,342-405,709-771` 还维护 Native 自身 physical/path identity、绑定 branch、检查 worktree 隔离。普通执行交给 Agent 后，删除进程/快照的历史恢复和自动跨根搜索，就能删除为那些策略服务的重复对账。当前用户显式选择 worktree/isolation 的要求仍需在创建或真实跨根操作的边界表达，不能改成每次 status/next 全量重验。

若进一步取消 inode/birthtime 的 checkout 世代身份，必须同时给现有用户级 Runtime 一个明确迁移/重绑方案；不能仅替换 workspaceId 算法让当前 Run 看起来丢失，也不要再添加另一层 hash 来补这个问题。

### 4. 重复投影与专用快照/锁兼容

`native-sdk-state-store.ts:263,290,440` 维护 Run 与 Native projection 的同步/恢复；`classic-sdk-state-store.ts:435-449,598-650` 维护投影 marker、checkpoint 对账和投影锁。普通 CLI 不再运行检查后，专门为了“检查进程尚活跃所以不能换 snapshot/projection”的记录和锁可以删除；不能因为它们位于同一目录就删除真实状态提交互斥。

收敛方向是让一个已存在的权威状态保存推进结果，CLI 读取时按需生成展示内容；不再为了进程执行协议同步三份相同进度。先逐写入口列清 Run、便携文档与 local projection 哪一份仍承担恢复/交付，再删除其余生产者和恢复支路。SDK Run 的推进权威与用户审批不能由“Agent 更方便”替换掉。

`native-command-recovery.ts:23,99-165` 的命令包装会补充 SDK/项目锁诊断及恢复信息；`:242` 还检查 Git index.lock。拆普通进程恢复时，应删掉已退休专用检查/快照锁的映射及提示，保留真实写入互斥的一次诊断。旧版专用快照锁不能在每次 next/status 中继续自动识别、接管或重建；旧数据只进入显式迁移/诊断。

快照存储代码还服务 archive/delta、候选材料和旧 Run，不应仅凭文件名批量删整个 `native-snapshot.ts`。应先删除普通命令“为了运行测试而采集/绑定快照”的所有调用，再确认剩余能力是否已由 Agent 文件读取或已有交付数据替代。没有新的性能测量前，不把减少源码装配表述为已证实端到端提速。

## 根任务建议实施顺序

1. 先断普通 Native/Classic 所有实际命令启动路径，以及对应进程、停止回执、重试和历史恢复；包括旧 spawnCommand 路径，防止只移除一个 runner。
2. 保留 Eval/下载及 daemon 当前自有任务的清理，隔离其依赖；仅在确认整个发布入口均无调用后删除未使用 API。Windows broker 有 `bin/` 调用者，保留。专用 Eval 历史身份能力按后台 Stop 契约独立决定。
3. 普通路径只解析显式工作区与当前数据根；将自动跨 worktree 搜索、通用/Native 二级迁移和专用旧锁兼容移出普通命令。
4. 清点状态写入口后再收敛投影，保留真实数据提交与用户审批；不要用另一套 stop/receipt/registry 替换刚删除的协议。
5. 历史测试按用户明确退役的行为归档并映射，保留合法流程与禁止行为的断言；选择受影响普通 CLI、Eval 自有任务清理和下载相关定向检查。此研究不启动验证，最终全量已停止且默认不再运行。

## 补充：自动兼容旧数据的升级边界

用户随后明确要求旧版本自动兼容、升级过程不增加日常操作，同时禁止恢复旧执行器。以下补充取代前文中“所有旧数据均需用户显式迁移”的建议；普通路径仍不恢复全树扫描、旧进程监管或旧锁接管。

本轮核对时，`workspace-runtime.ts:1411` 已将普通 resolver 改为纯路径返回，旧实现移为 `migrateWorkspaceRuntimeRoot`；`native-paths.ts:107-155` 已不再自动迁移旧目录。这些改动应保留，自动兼容由明确的升级/恢复边界接入。

### 最小接线

| 边界                                                         | 项目与 source 的确定方式                                                       | 执行动作                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/commands/update.ts:1243` 的 `updateSingleProject`       | 已发现并读取配置的 `projectPath`；仅 project scope，或用户明确选择的已登记项目 | 在更新完成判定前导入这个项目的旧业务数据。`updateAllIndexedProjects:2137` 只处理本来就在本次更新范围的项目，不扩成磁盘/worktree 搜索；失败计入 incomplete |
| 插件 SessionStart，`plugin-hook-entry.ts:109-128`            | 本次 `request.cwd` 所属且已有 Comet 配置的项目                                 | 与旧安装迁移分开接一个项目数据升级调用；无 Comet 项目则直接跳过。PreToolUse 不迁移，启用全局插件也不枚举全部项目                                          |
| `project-activation.ts:165` 的 `resolveOrActivateCometEntry` | 当前显式 Comet 入口解析出的项目                                                | 新项目初始化后或已存在项目配置分支都进入一次升级判断。只接 `activateCometProject` 会漏掉已有配置的旧项目                                                  |
| 首次恢复已知 Run/change                                      | 当前 selection 或显式 name/runId，当前目标不存在且存在精确旧 source            | 只导入这个 Run/change，完成后进入当前 Runtime；不用普通路径 resolver 反复扫描，也不横向寻找其他工作区                                                     |

可以复用一个小型项目升级函数，接收已确定的 `projectRoot` 和可选 `change/runId`，动态加载旧数据读取适配器。无需新通用调度框架。成功依据应为当前业务格式已发布且必需数据齐全；项目升级记录只需格式版本与已完成范围，不增加内容 hash 或 fingerprint，也不以包版本等同数据已导入。

升级只需读取几个固定旧 source 或已知 change。SessionStart/activate 看到成功记录直接结束；首次旧 Run 的补漏只检查该 Run 对应的位置。无 source 是正常无操作，不创建假成功的 Run。目标已存在时不按 mtime 覆盖；同一业务身份发生冲突要保留两边并给出具体问题，不能通过扫描另一 worktree 规避。

### 已知旧布局的业务导入清单

| 旧位置/记录                                                                                                               | 窄导入内容                                                                                                                      | 不导入为执行依据的内容                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 项目 `.comet/runtime/sdk-runs/native`、`sdk-runs/classic`                                                                 | 已知 runId 的 Run 状态、revision、审批、任务结果、交付及业务历史。通过对应 RuntimeStore 的旧格式读取器转为当前数据，再原子发布  | `.write.lock`、SQLite 协调器、临时文件、进程登记、停止握手/回执、待重新执行命令         |
| `.comet/runtime/change-owners/<workflow>/<change>.json` 与 `change-owner-history/...`                                     | 已知 change 的 owner、runId、active/history 归属，核对其业务 Run 确实存在                                                       | 分区锁、事务 token、inode 身份不作为永久业务数据复制；必要索引按已导入业务数据重建      |
| Native `<artifact_root>/comet/changes/<change>/runtime/state.json`                                                        | 兼容读取旧 local 数据里尚无其他来源的业务进度。以便携 `comet-state.yaml` 和 SDK checkpoint/Run 为优先来源；只转换仍有意义的字段 | PID、创建时间身份、旧命令 running/termination 状态和专用检查快照绑定不进入新的执行闭包  |
| Native change 中的 `comet-state.yaml`                                                                                     | 原地保留正式便携状态；其 portable Run checkpoint、审批及 archive/application 身份可用于恢复缺失 Run                             | 不为升级搬走正式材料，不加载旧 action executor 来“完成恢复”，不把旧 running 转成 passed |
| Classic change 的 `comet-state.yaml` 或 `.comet.yaml`                                                                     | 原地读取并保留现有文件名，利用便携状态和 checkpoint 恢复 Run；`classic-state-file.ts:5-6` 已支持两种名称                        | 两个真实文件同时存在仍是歧义，不能默选最新；不靠恢复旧 writer 取得兼容                  |
| Classic change 下 `.comet/run-state.json`、`pending-action.json`、`trajectory.jsonl`、`artifacts.json`、`checkpoint.json` | 仅在该旧 compat Run 需要时保留业务状态、待处理事项、审计和产物引用。pending 动作保留“结果未知/需核对”的业务语义，不自动执行     | 旧进程完成推断、command check 的执行权、为旧 runner 重新创建的日志/快照/锁              |
| Classic `context.md`、`coordination.json`、`subagent-progress.md`                                                         | 按是否仍被当前业务引用决定保留或留原地作历史；不影响已确认任务的用户选择                                                        | 可重建上下文不作为强制升级前置条件，不为普通读取恢复旧协调器                            |
| Classic `.comet/checks`、`skill-snapshots`，Native 旧检查日志/快照                                                        | 原地保留审计材料；若正式交付仍引用某个文件，仅迁移具体被引用材料                                                                | 不整目录恢复检查 executor、专用 snapshot/停止回执及其接管兼容                           |

`engine/runtime-store.ts:325-333` 同时识别当前 `.runtime-store-v2`、`.runtime-store-history` 和旧逐 revision JSON。不能只复制某个猜测的 `checkpoint.json` 就宣称所有业务历史已迁移；应该用该 store 的既有格式读取/恢复能力，按已知 runId 处理。若保留完整审计历史，应单独导入该 Run 的业务历史，不复制整个 store 的锁和协调目录。

现有整树 `migrateWorkspaceRuntimeRoot` 含旧进程 quiescence、snapshot manifest、fence/journal 及修复链，不能仅因为它已导出就直接挂到所有 SessionStart。可复用其必要的原子搬运能力，但新升级入口只加载明确业务数据。旧未完成搬迁事务属于具体 source 的恢复，不是扫描全部工作区的理由；自动处理不了时保留旧数据并报告升级未完成。

### Classic 仍需接线的深层自动迁移

`classic-runtime-paths.ts:322` 的 `resolveClassicRunDirectory` 当前仍在 `:357-370` 遍历 `.comet-state-transaction.json` 与 `CLASSIC_LOCAL_RECORDS` 并调用 `migrateWorkspaceRuntimePath`；`:417` 的 `resolveClassicLocalTarget` 默认也会搬旧 Runtime/local 数据。仅改通用 resolver 还没有移除全部普通调用迁移。

将实际数据导入提取到上述已知 change 升级入口，普通 resolver 只返回当前目标；升级完成后无需每次检查所有本地记录。`.comet-state-transaction.json` 是未完成提交记录，不能当普通业务状态随意搬入；它应由该 source 的定向恢复决定如何合并或保持待核对。`protectClassicLegacyStateWriter`、旧 `.comet-state.lock` fence 和 quiescence 不应再是每次读取/投影的必经路径。

### 双状态投影的最小删法

当前 Native `createNativeSdkStateStore` 在 `native-sdk-state-store.ts:327-338` 每次检查 namespace，首次写又通过异步 resolver 检查同一根；现在异步 resolver 仅返回同一个同步结果，第二轮准备与 `runtimePrepared` 不再提供迁移价值。可以删除这层重复准备，只保留实例绑定的当前根与实际写入边界所需的一次检查。Classic 的 `boundRuntimeRoot/runtimePrepared` 有相同冗余。

Run 为推进权威、YAML 为便携状态/checkpoint 是不同用途，不能因为都包含 phase 就删掉恢复材料。第一步可去掉单独 `state-projections/{native,classic}/<runId>.json` marker 作为另一份权威的角色：正常读取直接读取权威 Run；缺失 Run 时只在升级/已知恢复入口解析便携 checkpoint。旧 marker 留作兼容读取或由升级清理，不在每次只读 inspect 中要求三者一致，也不补写它。

提交后仍需把最新 Run 发布到便携 YAML 时，只保留一个明确的投影写入口，不在 inspect、next 输出和恢复各写一遍。Native 当前投影锁内会重新读取最新 Run，防止较早提交晚发布（`native-sdk-state-store.ts:497-501`）；如果两次提交仍可能并发发布同一 YAML，不能直接删锁制造旧投影覆盖。可以在已有权威 Run 的提交串行边界内完成一次发布，再删除重复的投影锁；未统一写入边界前，保留实际串行化比另造恢复协议更小。

### Native workspace binding 的最小删法

`native-workspace.ts:154-175` 重复生成 physical/path hash，之后与平台 namespace、Git worktree/branch 再作对账；`native-change.ts:616-622,669-676` 的发现路径使用这些身份排除/跨根寻找候选。当前项目和 change 已由显式入口确定后，可删除为自动跨根发现、旧进程/快照恢复服务的 physical generation 对账，以及 `status/next` 的重复 root 比较；旧 schema reader 可继续解析这类字段，但不据此恢复旧执行权。

用户选择的 `isolation`、`change_branch`、`target_branch` 保留在便携 workspace 数据（`native-portable-storage.ts:67`）。创建/明确变更隔离方式时验证一次；真正交付、Git merge 等修改分支的边界再核对需要的事实。不要在每次只读列表和 next 输出时重新调用 `resolveNativeWorkspaceBinding` 执行整套 Git 探测。

平台 `platform/paths/workspace-runtime.ts:38-93` 的现有 workspaceId 仍包含 root/git generation 输入。保留现有 namespace 的最小修改是不动此算法，仅删 Native 重复身份证明与重复 resolver 调用；直接删 generation 输入会改变 ID，令既有用户级 Run 看起来丢失。若今后取消 generation 输入，需要先一次性绑定旧 ID，那是额外的数据寻址迁移，不属于本轮“删除重复检查”。

本补充只写研究文档并检查格式，没有修改产品/测试、运行测试或 Eval。表中是最小实施建议，不代表这些升级接线和投影调整已经完成。

## 补充：用现有 FileRuntimeStore 直接导入业务记录

本节针对“旧 source 保留，不 move，不重装旧进程机制”的具体切口。它可以替代把约 1,500 行整树迁移换名后继续装配的方案。

### 可直接调用的现有 API

| API 与源码                                                                                    | 实际能力与限制                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listFileRuntimeStoreRunKeys(options)`，`engine/runtime-store-discovery.ts:30`                | 只枚举指定 store 根的身份键；识别顶层旧布局、`.runtime-store-v2` 和 `.runtime-store-history`。不遍历其他项目/worktree                                                      |
| `readFileRuntimeStoreRunSources(options, storageKeys)`，同文件 `:321`                         | 只解析选中的身份键并返回 runId/error，不生成 fingerprint。优先用于已知 Run 或分页升级；不要使用需要 fingerprint 的列表 API 再添一层升级指纹                                |
| `listFileRuntimeStoreRuns(options)`，同文件 `:278`                                            | 默认发现并通过 store.read 读取所有记录，包括 closed；适合升级整个已知项目的指定业务 store。`excludeClosed:true` 不是完整迁移                                               |
| `createFileRuntimeStore<T>({rootDir, mirroredRevisionPaths?})`，`engine/runtime-store.ts:286` | 直接读取业务 record，不创建 Runtime、不加载应用执行模块。其 `read(runId)` 是只读，识别旧格式、当前分区和历史分区，并解码当前 checkpoint 的共享值池                         |
| `store.readDisposition(runId)`，`:1177`                                                       | 区分 active/closed/closing/reopening/missing。不是“历史 revision 列表”API                                                                                                  |
| `store.restoreCheckpoint(runId, null, record)`，`:1185`                                       | 目标缺失时保留原 record.revision 导入，不从 revision 1 重演。`expectedRevision:1` 只允许内容相同的初始导入，不用于覆盖已有更新。成功仍由目标 store 的现有原子提交/写锁保证 |
| `store.closeRun(runId, record.revision)`，接口 `:255`                                         | 对明确 closed 的已导入 Run 保持历史分区；不改变 record/revision，也不会执行 action。closing/reopening 是未完成存储事务，不能默认为 closed 后伪造完成                       |

这些 API 通过 `engine/runtime.ts:47-62` 已公开。业务导入可直接依赖窄的 `runtime-store.ts`、`runtime-store-discovery.ts` 与对应纯 schema parser，避免加载 application 工厂和 executor。

### “全历史”的精确边界

`engine/workflow-run.ts:51` 的完整 WorkflowRun 包含所有 actions、commands、actionContexts、waits/evidenceWaits、outputs、children、lineage 等业务历史。`store.read` 返回完整记录；不应换成 status summary、compact output、`readProjection` 或只取当前 action。`restoreCheckpoint` 使用完整记录，目标写入会重新序列化共享值池，不要求复制旧 snapshot envelope。

`runtime-store.ts:281-284` 明确 checkpoint 内业务历史由调用者维护，旧磁盘 revision 快照不是另一份公开事件日志。该 store **没有公开读取任意 revision 或逐 revision 导入的 API**。旧 revision 文件正文全校验位于私有 `readState(..., validateLegacy=true)`；普通 `read` 不会逐一验证所有旧正文（`:542-550`）。所以不能声称 `read -> restoreCheckpoint` 迁移了每个旧 revision 文件。

最小方案可以完整保存当前 Run 对象携带的业务历史，同时原 source 目录保留每份旧 revision 文件。若验收还要求在目标 store 查询所有过去的整份 record 快照，现有 API 不够，需要单独的只读历史导出契约；不能绕过 CAS、伪造 revision 1 或反复运行 action 补齐。原 source 保留也不能被描述为“目标已具备逐 revision 查询”。

### 文件格式约束：交给 store 读取，不再复制框架文件

- 身份目录键是既有 `sha256(JSON.stringify(runId))`，由 store 自己解析；迁移不新增 hash。已知 storageKey 可以交给窄发现 API 得到真实 runId。
- 旧布局为身份目录中的 16 位十进制 revision JSON，允许既有 `comet.runtime-store-checkpoint.v1` 恢复基线；新布局使用顶层 `comet.runtime-store-format.v2/v3` marker，当前或历史分区中的 `checkpoint.json` 是 `comet.runtime-store-snapshot.v2/v3` envelope。v3 可能包含 pool，不是裸 WorkflowRun（`runtime-store.ts:325-333,471-516,562-615`）。
- `applications/<applicationId>` 的外层 ApplicationRunRecord 需要 `mirroredRevisionPaths:['run.revision']`；默认 Native/Classic WorkflowRun store 不套这个选项。以当前 `workflow-application/run-observation.ts:73` 的既有装配为准。
- 顶层 marker 与当前/历史分区冲突、缺 marker 或未完成 lifecycle 仍会报错；业务导入不调用旧 source 的 `settleRun`、compareAndSwap 或 restoreCheckpoint 来“修好再读”，因为这些会写旧目录。出错保留现场，不能降级复制一个猜测的旧快照。
- 新目标由目标 store 正常生成它自己的 marker、checkpoint、协调文件。源 `.write.lock`、SQLite、`.runtime-store-coordination`、临时文件及旧迁移 journal/fence 一概不复制。

### 最小 known-project 导入顺序

1. 只取明确项目下的 `.comet/runtime`，以及明确 Native change 的 `<artifact_root>/comet/changes/<change>/runtime`。用现有受保护路径读取确认 source 是普通目录/文件；不跟随旧 fence 声明的其他路径，不列出全 worktree。当前 namespace 算法不变。
2. 对旧 `sdk-runs/native`、`sdk-runs/classic` 按已知 runId 读取；项目升级需要覆盖全部业务时才对这两个明确 store 枚举。固定应用存储如在本次范围内，逐个明确 `applications/<applicationId>` 用同样 store API，不加载应用代码。获取完整 record 和 disposition。
3. 目标为空则 `restoreCheckpoint(runId,null,record)`；并发导入返回 false 时重读目标，仅目标与完整源业务记录相同时视为幂等完成，已有更新不覆盖。已知 closed 记录再按原 revision 封存；未知 lifecycle 不擅自恢复。
4. 对 `change-owners/native|classic` 和 `change-owner-history/...` 只读指定 JSON，复用纯 owner schema 校验，并核对 runId/application/workflow/change 与已导入 record。当前 owner parser 是 `change-runtime-owner.ts` 的私有 `parseOwner`，没有可指定 sourceRoot 的公开读取函数；最小调整是公开这个纯 parser 或抽到已有纯模型入口，不使用会再次发现旧树的 `readChangeRuntimeOwner(...,{readOnly:true})` 当导入器。目标按现有 owner 发布规则写入，历史 owner 保持历史身份。
5. Classic 对已知 change 的 `.comet/run-state.json`、`pending-action.json`、`trajectory.jsonl`、`artifacts.json`、`checkpoint.json`，用 `readProtectedProjectFile` 读取、按既有业务 schema 校验，再用 `atomicWriteContainedText` 发布目标；JSONL 审计保留全部行和原顺序，不截取末尾。路径引用保持或按现有目标规则一致重写。源保留、不 rename、不 unlink。context/coordination 材料只有仍被业务引用时导入，不导入 checks/skill-snapshots 执行机制。
6. 旧 Native local state 只用纯旧 schema reader 转换业务字段；不把已退休进程字段转成新执行权。既有业务完成记录保留；执行结果未知的 action 等 Agent 核对，不自动完成或重放。直接保留原始 record 作数据导入与将其转换为新 workflow 格式是两个阶段；后者要保留原 actions 等业务历史，不能为通过新 schema 清空历史。
7. 只在所需业务记录、owner 和引用材料发布完整后记录本次升级完成。部分成功可按单 Run/已知 change 重试；已有成功目标不重写，失败 source 保留。无需 source 全树快照、全树静止证明、旧 writer fence 或旧 PID 恢复；目标仍使用其真实提交互斥。

需要保留的 Classic 实际业务历史不止 `run-state.json`。`classic-runtime-paths.ts:33-45` 已列本地记录，`engine/state.ts:55-108` 的 RunState 也携带 pending/trajectory/context/artifacts/checkpoint 引用。不能仅导 YAML 的 phase 就宣称旧 Run 无感恢复。现有交付收据亦可能位于 `.comet/classic-deliveries/<identity>.json` 或明确 Git common-dir 的 `comet/classic-deliveries`；若当前已归档/交付恢复引用它，要按已知 identity 导入业务收据，不自动找其他工作区或重新执行交付。

### 当前仍把旧框架带入普通路径的余项

1. `classic-runtime-paths.ts:49-69` 的 `protectClassicLegacyStateWriter` 仍在普通状态写入前执行旧 quiescence/fence；`:124` 的 `changeIdentity` 重复检查静止；`:322-370` 的目录解析仍逐条迁移。改成上述窄业务导入完成后的普通目标解析。
2. `classic-runtime-paths.ts:417` 的 `resolveClassicLocalTarget` 仍以默认 migrate 路径进入 change resolver；`:397` 的只读 fallback仍解释旧 fence。普通目标与升级 source 的读取函数分开后，可删除这些旧框架依赖。
3. `classic-progress.ts:687,714` 的收据迁移在 `writeReceipt:833` 通过 `{migrate:true}` 触发；即使顶层 Runtime resolver 已纯化，普通交付写入仍可加载整树迁移。改成升级时按明确 identity 复制业务收据，普通写入仅当前目标。
4. `native-portable-migration-runtime.ts:48,150` 在已知 change 的 schema 迁移前仍搬整个旧 runtime 目录。将旧 schema 业务转换保留，改从明确 source 只读提取需要的业务记录，不调用 `migrateWorkspaceRuntimeDirectory`。
5. `native-doctor.ts:575` 仍提供整目录迁移修复；这是显式入口，但若目标是删除旧框架，也应改为窄导入/诊断，不能仅因“显式”就留下原实现。
6. `readWorkspaceRuntimeRoots` 仍被 change-owner、Creator、application observation/trace 使用；`workflow-application/application.ts:171`、Classic store/runtime-ownership、Native paths、supervisor transfer、uninstall 仍解释 fence。这些有的是只读兼容而非迁移写入，但都会继续牵入原模块。升级完成后普通读取仅查当前根；历史 source 的只读发现留在升级模块，不让普通 observer装配整树迁移。

本节仅源码读取与文档补充；未运行迁移探针、测试、构建、外部任务或 Eval。建议中的新增窄导入入口、纯 owner parser 与完成记录尚未实现。

## 最终实施清单：删除整树迁移框架

### 只保留五个小接口

`workflow-contract/workspace-runtime.ts` 可整体重写为路径与当前目录能力，保留原名称以减少调用者改动：

```ts
export { resolveWorkspaceRuntimeRootSync };
export async function resolveWorkspaceRuntimeRoot(projectRoot: string): Promise<string>;
export async function ensureWorkspaceRuntimeRoot(projectRoot: string): Promise<string>;
export async function readWorkspaceRuntimeRoots(projectRoot: string): Promise<string[]>;
export async function isWorkspaceRuntimeMigrationFence(source: string): Promise<boolean>;
```

前两个只解析；ensure 只创建并确认当前目录；readRoots 固定返回当前根单元素，不再读取旧 source。最后一个只为已经存在的旧 fence 提供小型只读识别：检查已知文件或目录 marker 的 schema/字段与文件类型，不跟随记录中的 target/source，不生成 fence、不比较目录 generation、不扫描子树、不修复。它可放在纯兼容读取模块供少数旧文件消费者使用；不必留在普通路径模块中。

另设一个窄升级入口，例如 `importLegacyWorkspaceRuntimeData({projectRoot, change?, runId?})`；名称表达“读源、导入业务数据”，避免沿用 move/repair 语义。它只在 update、SessionStart、activate 和首次明确旧 Run 的升级判断中加载，沿用前两节的公开 store API、源保留、目标原子发布。对普通读者不暴露 legacySource、fence target 或迁移事务。需要跨领域调用时只登记这个窄公开入口。

直接删除原 `WorkspaceRuntimeMigrationOptions/WorkspaceRuntimeFenceOptions`、snapshotTree/contentManifest/unchangedManifest、hash/fingerprint、unfinishedProcess/quiescence、journal/stage/backup、repair failure、迁移锁、fence 创建和全部 migrate/repair 导出。`isWorkspaceRuntimeMigrationFenceSync` 当前产品无调用者，随同步 fd/inode 读取代码一起删除。`migrateWorkspaceRuntimeRoot` 当前也没有外部产品调用者，无须保留兼容别名。

### 调用者精确调整

| 文件/调用点（本轮读取位置）                                                | 最小调整                                                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `classic-runtime-paths.ts:49-69` `protectClassicLegacyStateWriter`         | 删除函数及调用；不再创建旧 `.comet-state.lock` fence，也不做 quiescence                                                         |
| 同文件 `changeIdentity:124`                                                | 删除旧本地记录静止扫描；身份从已有 change_id/Run 业务数据转换，正常身份发布仅保留目标提交逻辑                                   |
| 同文件 `resolveClassicRunDirectory:357-370`                                | 删除 migratePath 循环；升级入口按已知 change 窄导入，普通函数只返回当前 target                                                  |
| 同文件 `selectClassicLocalReadTarget:397`、`resolveClassicLocalTarget:417` | 去掉默认 migrate 和 fence 驱动的双源择址；升级成功后仅 current；少量旧审计读取若仍需要，只在显式历史入口读 source，不跟随 fence |
| `classic-progress.ts:687,714`、`writeReceipt:833`                          | 删除收据迁移与 Git common-dir 自动修复；升级入口按已知 changeIdentity 复制业务收据，普通 writeReceipt 仅写当前路径              |
| `native-portable-migration-runtime.ts:5,40,49,150`                         | 旧 schema 转换保留；删除先搬整个 change/runtime 和 fence 判断，直接读已知旧 schema 业务文件再发布当前业务记录                   |
| `native-doctor.ts:575`                                                     | 替换整目录 move/repair 为同一个窄导入/诊断；输出改为 imported/preserved，不声称 moved，不在此恢复旧 runner                      |
| `change-runtime-owner.ts:28,60,430`                                        | 不再每次读旧/新双根与 fence。升级入口纯解析 source owner；普通 active/history owner 只查当前根                                  |
| `workflow-application/application.ts:171` 的只读 legacy fallback           | 删除逐次旧根读取及双 authority 分支；固定应用的旧记录由升级入口用 `ApplicationRunRecord` store 导入，不加载应用执行模块         |
| `workflow-creation/run-observation.ts:20,36,68,85`                         | readRoots 保留调用但只得到 current；删除旧数据特有去重/冲突扫描。已导入的 closed 记录仍可观测                                   |
| `workflow-application/run-observation.ts:42,130,348`、`run-trace.ts:241`   | 同上；旧物理 revision 文件留在 source，不因为普通 observation 停止扫旧根而删除                                                  |
| `comet-classic/classic-store.ts:318`                                       | 删旧 fence 的状态快照豁免分支；当前状态提交仍识别自身实际持有的锁，不误把旧 fence 当有效 writer                                 |
| `comet-classic/classic-runtime-ownership.ts:34`                            | 可保留单次只读旧 fence 识别，用于忽略老 `.comet-state.lock` 标记，不创建或迁移它；`:115` 的 ensure 当前根保留                   |
| `comet-native/native-paths.ts:243`                                         | 仅保留旧 runtime 为纯 fence 时不是业务目录的识别；不能在普通 paths 中导入数据或恢复目录                                         |
| `comet-native/native-sdk-supervisor-transfer.ts:269`                       | 保留少量只读 fence 识别，避免把旧 runtime fence 当正式 change 文档复制；不触发迁移                                              |
| `skill/uninstall.ts:1647`                                                  | 保留少量只读识别用于保留用户旧 marker/数据，不把它升级成全树修复或删除许可                                                      |
| `change-runtime-owner.ts:811`、`classic-runtime-ownership.ts:115`          | ensure 当前根接口保留；不再由其创建项目内兼容 marker                                                                            |

`protectClassicLegacyStateWriter` 的外部调用也必须一并删除：`classic-sdk-state-store.ts:11,483`、`classic-state-command.ts:34,590`、`classic-store.ts:15,469`；内部调用为 `classic-runtime-paths.ts:110`。这几处不得换成另一份 quiescence/fence 包装。

其余仅使用 resolver 的调用者不需要改成升级入口，原 resolver import 可以保持（下列 state-store 仍须处理上表列明的其他调用）：

```text
app/commands/runtime.ts
domains/workflow-creation/creator.ts
domains/comet-entry/hook-project-root.ts
domains/comet-entry/hook-router.ts
domains/comet-native/native-capability-discovery.ts
domains/comet-classic/classic-run-store.ts
domains/comet-classic/classic-resume-probe.ts
domains/comet-classic/classic-sdk-archive-manifest.ts
domains/comet-classic/classic-sdk-delivery-inputs.ts
domains/comet-classic/classic-sdk-diagnostics.ts
domains/comet-classic/classic-sdk-state-store.ts
domains/comet-native/native-runner-input-artifacts.ts
domains/comet-native/native-sdk-cancellation.ts
domains/comet-native/native-sdk-diagnostics.ts
domains/comet-native/native-sdk-history-discovery.ts
domains/comet-native/native-sdk-history.ts
domains/comet-native/native-sdk-projection-lock.ts
domains/comet-native/native-sdk-state-store.ts
domains/comet-native/native-sdk-status.ts
domains/comet-native/native-workspace-config.ts
```

这份列表表示“路径接口可保持”，不表示文件内普通执行器/历史进程恢复已清理完成。`platform/process/runtime-observability-store.ts` 直接使用平台路径位置，同样无需接入升级。所有仅 resolver 的调用者都不应改成“每次 resolve 前 ensureLegacyImported”。

### 自动升级与旧物理历史同时保留

项目升级只读取明确 source；通过 `listFileRuntimeStoreRuns` 或选定 source keys 读取原完整 record，再对空目标 `restoreCheckpoint`。旧 actions、approvals、waits、outputs 等业务历史全部保留，不通过加载原应用执行器重放；完成发布后目标是普通路径唯一 authority。已 closed 记录保持 closed，不跳过历史分区。

旧 source 中所有原 revision 文件、原日志和材料继续原地保留，导入器绝不 move/unlink。它们只是旧物理历史，不继续作为普通读写的第二 authority，也不再依赖 fence 将旧 writer 阻断。对这些历史文件的显式只读访问可以保留，但目前 store 没有逐 revision 查询 API，不能伪称目标保留了这项接口。

这样 workspace-runtime 的普通依赖里不再包含快照、hash、PID 静止检查、迁移锁和恢复框架；自动无感升级由已知项目入口导入一次业务数据完成，而非把原框架换名。该清单为源码 Review，未修改产品/测试或执行验证。

## 测试依赖 Review：退休机制与必须保留的业务断言

本节依据当前测试正文与 registry 的有效 selector（有 `testMigration.tests` 时取该映射，否则取 `tests`），不运行测试。下面的替代项是候选覆盖映射，不代表已经登记或执行通过。

### 明确不再适用的旧机制测试

| 旧测试文件与精确测试名                                                                                                                                                                                                                                                                                                                      | registry case ID                                  | 应如何迁移                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow-contract/workspace-runtime.test.ts`：`retries a transient fence publication observation with a bounded fresh read`；`does not reuse an unstable fence after its bounded publication retries`；`comet-native/native-paths.test.ts`：`migrates only the named legacy runtime without enumerating unrelated changes`                 | `workflow-simplification-t07-named-migration`     | fence 发布协议退休；原“命名访问不扫描其他 change、旧数据可升级”保留。迁到 `workspace-runtime-entrypoints.test.ts` 的 `prepares Native paths without moving a legacy change Runtime`、`resolves the current Runtime path without importing, repairing or fencing legacy storage` 和 `legacy-runtime-import.test.ts` 的导入测试；还需按已知 name 验证升级不会读取无关 change，当前三项未直接证明这一点 |
| `workflow-contract/workspace-runtime-legacy-lock.test.ts`：`recovers a legacy migration recovery lock only after the original operation is confirmed stopped`；`preserves an active migration recovery transaction even when recovery is confirmed`                                                                                         | `runtime-legacy-migration-meta-lock-confirmation` | 旧迁移 meta-lock 本身可登记 feature-removed，原断言全文归档；目标业务 store 的真实活动写事务保护继续由 `platform/recoverable-file-lock.test.ts`、`platform/fs/lock-without-pid.test.ts` 承担，不把真实数据互斥一并退休                                                                                                                                                                               |
| `workflow-contract/workspace-runtime-repair-failure.test.ts`：`recalls the recorded failure only while the source stays unchanged`；`does not recall when the journal itself disappears`；`memoizes a real failed repair through resolveWorkspaceRuntimeRoot`                                                                               | 当前未找到直接有效 case selector                  | repair failure/journal 缓存已无生产者，可归档退休；源数据不丢失、导入失败不覆盖当前记录仍要由窄导入测试保留                                                                                                                                                                                                                                                                                          |
| `workflow-contract/workspace-runtime.test.ts`：`migrates the entire legacy tree, preserves evidence, and leaves only one fence`、`copies across filesystem boundaries and only renames within each filesystem`、`rebuilds a proven partial copy from its unchanged backup`、`seals a missing legacy file lock without creating a home lock` | 除上述 t07 外未找到直接有效 selector              | move/quarantine/copy stage/fence 策略退休，不能靠恢复这些接口修测试；其中“preserves evidence”必须迁成完整业务 record 与原物理历史保留，不是随机制退休                                                                                                                                                                                                                                                |
| `comet-native/native-check-executor-termination.test.ts`：`stops immediately on a supervisor error instead of converting it into a command timeout`；`cancels pending supervisor readiness immediately when its supervisor errors`                                                                                                          | `native-531-supervisor-startup-errors`            | 普通 Native executor 退休，归档原机制。平台仍启动的 Eval/下载监督错误不能误标 timeout，可在平台任务测试保留该风险，不能把旧 Native runner 装回来                                                                                                                                                                                                                                                     |
| 同文件：`waits for supervisor readiness before releasing the registered command`；`never releases a late-ready command after its registration deadline has cancelled it`                                                                                                                                                                    | `native-531-supervisor-ready-handshake`           | 普通 Native 登记启动协议退休。真实平台自有任务仍有 ready 生命周期，保留在 `platform/process/owned-command-termination.test.ts`，不以 Native 公共任务推进模拟替代真实进程边界                                                                                                                                                                                                                         |
| 同文件：`preserves command completion and timeout facts when completed cleanup is unconfirmed`；`preserves command completion and timeout facts when timeout cleanup is unconfirmed`                                                                                                                                                        | `native-531-check-failure-facts`                  | 普通检查执行事实包装退休；新平台报告 failed/not-run 不得被改为 pass，另行保留 CLI 自有任务清理失败事实                                                                                                                                                                                                                                                                                               |
| 同文件：`settles an interrupted check when confirmed Windows cleanup never closes inherited pipes`                                                                                                                                                                                                                                          | `native-531-check-pipe-settlement`                | Native pipe settlement 实现退休；平台自有任务仍需有限收尾。不能以删除 Native executor 为由把共享 supervisor 的管道/清理回归都删掉                                                                                                                                                                                                                                                                    |
| `comet-native/native-check-owner-recovery.test.ts`：`recognizes completed receipt reuse without a child but keeps an unregistered launch unknown`                                                                                                                                                                                           | `native-all-reused-checks-without-child`          | 旧本机执行/收据策略退休；该 case 同时映射 `preserves the original pass and Wait when reverify includes a Verifier-added non-repeatable check`，必须迁移保留原通过结果、批准 Wait 与实际复核的业务语义                                                                                                                                                                                                |
| `comet-native/native-check-executor.test.ts`：`derives failed and interrupted states from exit and timeout`，以及 `repository/ci-workflows.test.ts`：`runs real Native process regressions without competing test workers`                                                                                                                  | `ci-native-process-regression-worker-isolation`   | 普通 Native 进程测试 job 可退休。CI 改为执行仍存的 platform/Eval 自有任务回归；不能继续要求已经删除的测试文件路径，也不能据此删除 Eval 清理覆盖                                                                                                                                                                                                                                                      |

`workspace-runtime.test.ts` 还包含 portable recovery 测试：`recreates a lost current-workspace runtime for portable checkpoint recovery`、`allows portable recovery after a migrated Native change runtime is lost`、`leaves lost Classic run-state and checkpoint files absent for portable recovery`。它们混合“自动建 fence”与“合法 Run 能恢复”；前者退休，后者应迁到业务 checkpoint 恢复测试，不宜按文件整体标记无业务价值。

### 不能退休的共享进程 deadline case

`owned-command-timeout-independent-deadline` 当前仍映射 `native-check-owner-recovery.test.ts` 的 `keeps its deadline when the owner event loop cannot run its timeout timer`。普通 Native 的调用者消失，但 Eval/下载仍使用自有 supervisor；这个 case 的真实风险并未消失。

应把原“owner 事件循环阻塞、命令超过 deadline 后禁止写 late 文件、恢复后清理仍可确认”的断言移到平台 owned-command 测试，保留 case ID。现有新增 `并行命令超时后均能确认整树停止，不与监管器的子树清理竞争` 只覆盖 owner 正常运行时的并发 timeout，不等价覆盖 blocked-owner。`platform/process/process-identity.test.ts`、`owned-command-termination.test.ts` 与 `eval-container-cleanup.test.ts` 仍有真实产品调用者，禁止作为普通 PID 退休的附带删除项。

### 必须保留的业务断言与当前候选测试

| 行为                                                                    | 原 registry / 原测试                                                                         | 当前可复用候选与限制                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原 Run、审批及运行中的业务 claim 原样保留，退休检查不补成功、不重新执行 | 多个旧 executor/恢复案例中的业务部分                                                         | `engine/runtime-business-upgrade.test.ts`：`automatically imports %s history, approvals and live business claims without a process stop receipt`；`engine/runtime-retired-history.test.ts`：`reads retired settled history without restoring execution and preserves current binding checks`。两者证明业务转换/Runtime 层，不能代替磁盘导入或发布 bundle                                                                                |
| 旧发布版本可继续当前 Build/Verify，多个 Child 各自 frontier 不丢失      | 普通 check runner 退休后仍须兼容旧 Run                                                       | `native-published-business-upgrade.test.ts`：`automatically resumes published v$version $frontier with original business history`、`preserves every independent old Child frontier: %s`；`classic-published-business-upgrade.test.ts`：`resumes the published 0.5.2 Build frontier on the original Run without running a check`。目前使用 fixture + memory store，不证明公开 CLI 自动接线                                               |
| 原批准不可伪造，旧失败不变成功；原 repair-only 决定仍有效               | 原 source/reapproval、retry 与未授权推进案例不能整批退休                                     | Native published：`retains the old repair-only decision and returns to Build only after the original proposal is approved`；Classic published：`preserves published acceptance and delivery data at %s`；Native agent checks：`waits for user acceptance and rejects another session reporting the original task`、`retains an explicit independent review requirement`                                                                 |
| 合法平台报告可完成，同一工作流仍能交付                                  | 原 Native/Classic 真实检查完成路径里的业务推进部分                                           | `native-agent-checks.test.ts`：`accepts platform check reports and completes authorized Archive without Runtime check actions (source)` 与 `(bundle)`；`native-platform-flow.test.ts`：`preserves real approvals and completes Native platform reports through authorized Archive`。后者当前仅 source；Classic platform-command 只证明旧调用不执行、不冒充 pass，不能独立证明完整 Classic Archive                                       |
| 不执行传入开发命令、不产生假 pass/receipt                               | 普通执行器明确退役的新边界                                                                   | `classic-platform-command.test.ts`：`routes a legacy check invocation to platform work without executing it or claiming a pass`；`native-platform-execution-retirement.test.ts`：`does not construct the retired managed-check Native definition %s`、`exposes Agent tasks and acceptance without any managed-check executor or refresh command`；Classic：`constructs only the Agent platform Classic %s workflow`                     |
| 当前工作区隔离，不自动搜索/接管其他工作区                               | `native-v4-workspace-isolation-discovery`；`native-workspace-recovery-preserves-reason`      | 原 CLI tests：`requires workspace isolation before creating a second current-workspace SDK change`、`keeps an active SDK Run isolated when its artifact directory is missing`、`replaces acceptance choices with workspace recovery without mutating state` 应适配当前定义，保留禁止写第二 owner/原状态不变。新 entrypoints：`looks for a Classic Run only in the explicitly supplied workspace` 只证明不扫描，尚不证明拒绝跨工作区写入 |
| checkout namespace 隔离与旧 handle 不写入替换后的新工作区               | `classic-sdk-stale-workspace-read-identity`、`classic-sdk-replaced-workspace-claim-recovery` | `classic-sdk-state-recovery.test.ts` 的 `rejects Git identity replacement during read without rewriting the original store`、对应 `readProjection`、`keeps an in-flight claim unknown after replacing Git identity and never rewrites the old store`。generation 的重复 Native advisory 可以删，平台现有 namespace 不变时这些隔离约束仍有意义                                                                                           |
| 源不改写、完整业务历史与 old physical revisions 保留                    | 新窄导入替代旧整树保留行为                                                                   | `legacy-runtime-import.test.ts`：`imports old full business history without copying process files or rewriting the source` 已比较完整 record、owner、源 old.lock 文本与幂等；但尚无真实 legacy revision 目录的逐文件字节/名称比较，因此不能宣称物理历史保留已有完整证据                                                                                                                                                                 |

`platform/workspace-runtime.test.ts` 的 `uses a complete digest and resolves without creating runtime directories`、`shares identity through workspace symlink aliases`、`isolates clones with the same origin and linked Git worktrees`、`refuses broken worktree metadata rather than changing identity silently` 仍覆盖当前保留的 namespace/path 行为，不属于旧整树迁移策略测试。

`classic-current-change.test.ts` 中 `atomically selects an active change and records the selection branch`、`cleans temporary files when atomic replacement fails` 仅有末尾“项目 runtime 必须是 fence”的旧布局断言不再适用；选择原子性、branch、失败清理必须保留。`classic-readonly-state.test.ts` 的 `reads legacy local records without assigning identity or creating home`、`does not read the original home target from a copied foreign fence`、`rejects a symbolic link at an absolute home read target` 要按新只读兼容/当前目标职责适配，不能为了删 fence framework 放宽外部文件读取边界。

### Classic 共享旧执行 selector 影响的 registry 清单

当前有 34 个 case 的有效 selectors 仍包含 `classic-command-checks.test.ts` 或 `classic-executed-checks.test.ts`。前者多数共用下列三项：

- `does not resurrect an older execution over a newer start`
- `returns the newest valid matching record, including failures, for only the current run`
- `refuses both old and new request IDs when the process ran but its completion receipt is unknown`

还有专门的 `retries only a proven prelaunch failure in the same check Action without replaying a process`（`classic-compat-proven-prelaunch-retry`），以及 executed-checks 中重跑 interrupted plan 的测试（`classic-ci539-interrupted-check-plan`）。精确受影响 case ID 如下；只迁移这些已退休 selectors，保留各 case 其余审批、归档或恢复断言，不把整 case 一律 feature-removed：

```text
classic-archive-prepared-input-recovery
classic-delivery-repair-baseline-input-drift
classic-delivery-repair-checkpoint-read-race
manual-recovery-classic-stale-build
manual-recovery-classic-stale-verify
classic-compat-formal-edit-continuation
classic-compat-approved-check-refresh
classic-raw-clean-git-inputs
classic-raw-batch-parent-containment
classic-sdk-accepted-candidate-input-binding
classic-compat-proven-prelaunch-retry
classic-compat-unknown-check-no-replay
workflow-formal-review-source-retirement
workflow-formal-negative-review-reapproval
workflow-implementation-revision-not-acceptance
classic-sdk-canonical-source-edit-continuation
classic-sdk-preset-source-reapproval
classic-sdk-plan-source-edit-continuation
classic-sdk-design-source-edit-continuation
classic-compat-plan-source-edit-continuation
classic-compat-preset-open-source-capture
classic-sdk-revision-report-input-isolation
classic-sdk-refresh-byte-identical-restoration
edit-review-preserve-completed-successive-judgments
edit-review-raw-git-successive-identity-chain
agent-edit-review-check-evidence-versus-implementation
agent-edit-review-no-unauthorized-revision
edit-review-supplement-retained-checks
agent-edit-review-formal-check-retention
classic-sdk-recover-original-input-manifest
classic-sdk-archive-reverification-guidance
classic-ci539-interrupted-check-plan
workflow-simplification-t21-handoff-sources
workflow-simplification-t23-formal-observe
```

当前 registry 的有效 selectors 尚未指向新增 `legacy-runtime-import`、`runtime-business-upgrade`、`runtime-retired-history`、`workspace-runtime-entrypoints`、两类 `platform-execution-retirement`、`published-business-upgrade` 测试。它们可作为替代证据，但必须先按独立业务行为逐项登记，不能只写“新增测试覆盖退休”。

### 本轮最小证据缺口

1. 窄导入测试的 source 由当前 `restoreCheckpoint` 构造，尚未验证真正旧逐 revision 磁盘布局；至少保留一个旧物理历史 fixture，并比较导入前后 source 文件名与逐文件字节，目标完整 Run/owner/原 revision 相等，进程/锁未被复制。
2. 缺 source 损坏/目标已有较新 Run 时不覆盖、不伪造完成的导入反例；重复导入幂等已有一项，但不是这些反例的替代。
3. 新审批/业务升级测试很多停在 memory store 或源码 CLI；旧 case 如果登记 public-cli/runtime-bundle 层，必须对应补公开命令边界，或明确保留该层未验证，不下调 coverageLevel 掩盖缺口。
4. 第三 marker 删除后，原 portable recovery 测试应核对同一 Run、审批与待处理业务 Action；不能只删除“marker 不一致拒绝”断言却不证明合法 Run 仍可恢复。

以上均为只读 Review 结论；未修改测试、registry 或产品，也未启动定向/全量测试、构建或 Eval。
