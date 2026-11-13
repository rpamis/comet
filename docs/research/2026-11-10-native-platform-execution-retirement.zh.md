# Native 普通工作流执行机制的完整撤下范围

**最新兼容要求：用户随后明确要求“自动兼容旧版本，用户无感升级”。第 11 节取代下文第 2、3、8 节中“拒绝旧 Run、创建新 Run”的建议。删除执行器、旧 factory 和受管检查仍然适用；旧业务数据在已知加载边界一次转换，继续原需求。**

本轮为只读实现调查。基线为 `053` / `630ce380`，同时读取了当前未提交的 Runtime 优化；未修改产品和测试，未构建、运行测试或 Eval。本文的删除方案取代此前“保留旧执行恢复、修复监管器 deadline”的建议：用户现已明确要求删除整套普通工作流受管执行机制，并接受旧 Run 不再执行的兼容影响。

本文第 1–10 节保留最初的删除调查；后续各节记录实际实现、测试迁移与验证，不能把早期只读结论当作当前完成状态。旧执行器不再续跑，旧业务数据仍须自动适配并保留原批准和任务。

## 结论

不能只停止新建 Runtime 检查，也不能把旧执行器留在旧版本 factory 或 Compat 下。当前删除闭包包含 SDK 检查、Compat Runner、Supervisor 检查和旧内容快照收据四条路径；同时要改固定应用扩展和公共 `runtime dispatch`，否则仍能绕过新 Native 入口执行旧检查。

保留的职责是：需求及 Shape 批准、业务候选、Builder/Verifier 任务及真实平台领取身份、逐项验收、用户接受、Archive/Delta 的确定性文件提交、SDK Run 权威及其投影。Agent 在平台工具中选择并运行测试，Comet 接受具体检查报告和验收结论，不再启动测试进程、建立进程身份、监督超时、生成停止证明或恢复旧检查。

## 1. 可以直接整模块撤下的执行核心

以下模块在新工作流中没有留存理由；移除它们的调用方和导出后，应物理删除源码，而非保留不调用的实现。

| 模块                                            | 当前职责与引用                                                                                                                                        | 删除后的去向                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `domains/comet-native/native-check-executor.ts` | `:10` 调 `spawnOwnedCommand`；`:49` 本次进程实例；`:53` `NativeCheckPlan`；`:300–305` 启动并要求停止确认                                              | 全部删除。普通检查由 Agent 平台工具运行                                                                             |
| `native-sdk-checks.ts`                          | `:62` 刷新检查；`:237` 计划解析；`:789` 执行器；`:1229` 汇总；`:1473/:1528` 恢复                                                                      | 删除计划、执行、复用、刷新、恢复和配套 validator，不留空计划执行器                                                  |
| `native-sdk-check-execution.ts`                 | `:33–39` 五种检查 Action ref；`:58–77` execution 记录；`:90` `.active.lock`；`:271` 停止回执；`:298` 创建记录；`:475` 对账；`:618/:672` 停止请求/终止 | 执行记录、claim/process stop 绑定、active lock、stop request、receipt 全部删除                                      |
| `native-portable-checks.ts`                     | `:90` 从 overlay 重建命令；`:151` 运行状态；`:294` 证据重绑；`:534/:675` 执行/重试；`:768/:979` Verifier 请求检查                                     | 整模块删除，不让 Compat 保留运行器                                                                                  |
| `native-check-stop-evidence.ts`                 | `:6–9` 读取 overlay、保留原检查并登记停止                                                                                                             | 删除；旧检查不迁移为成功、失败或“已停止”                                                                            |
| `native-local-execution.ts`                     | `:223` 本地 overlay parser；`:374` 重建；`:422` 从 overlay 推断 Verifier 身份；`:463` 写入                                                            | 整模块删除。平台任务身份从 SDK Action claim 读取                                                                    |
| `native-local-execution-binding.ts`             | `:8` 版本间保留检查；`:47` 根据候选/Action 读取 overlay                                                                                               | 删除；业务候选绑定直接使用 SDK Run/Action                                                                           |
| `native-supervisor-check-binding.ts`            | `:18` 计划；`:39/:59` 运行证据；`:87` 机器绑定；`:105/:119` 检查回执                                                                                  | 整模块删除                                                                                                          |
| `native-supervisor-evidence.ts`                 | `:156` 执行子任务/集成检查；`:468` 读取检查证据                                                                                                       | 删除执行和收据。`:38` `NativeSupervisorMaterial` 如仍被业务归档使用，移到现有业务材料模块，而非为一个类型保留执行器 |

这里的 `native-*` 简写路径均在 `domains/comet-native/`。`native-check-command.ts` 目前本来只是“内容证明已移除”的报错入口；它不是实际命令执行器。见 `native-check-command.ts:7–20`。若产品不再保留该废弃别名，删除 `native-cli.ts:8/:74` 的 import/路由；若需要清晰的升级错误，只保留一个不加载任何旧实现的报错分支即可。

## 2. Factory 必须删除的定义与语义分支

`native-sdk-application.ts:1146–1149` 仍公开构造 v1–v4；`:174–209` 可精确选择旧 v4 和历史定义；`:1348–1484` 即使 v4 普通入口不收命令计划，仍声明了完整检查步骤。

必须同时删除：

- `build.checks`、`verify.checks`、`verify.requested-checks`、`verify.checks-stop`。
- `supervisor.child.checks`、`supervisor.child.checks-stop`、`supervisor.child.integration-checks`、`supervisor.child.integration-checks-stop`。
- `refresh-checks` command、相应 validators/executors、ref 注册、所有进出上述步骤的 transitions、Action outcome/失败恢复分支、检查计划/命令参数模板。
- Builder 的 `verificationChecks`、`response.kind=request-checks`，Verifier 的 `request-checks` 回合，`retry_check_ids`、`retry-checks`、repeatable/reusable/output 计划、检查执行计数上限。
- `native-sdk-definition.ts:145` 的历史可执行定义合成器、`:193` 起的旧 transition handler，以及仅为这些定义恢复服务的 hash 常量/步骤恢复列表。不能在新 selector 中继续匹配旧检查定义。

保留 Builder、Verifier、Supervisor builder/verifier、集成修复的真实平台任务；失败、阻塞和独立验收属于业务，不等于命令进程执行。`native-sdk-application.ts:942–947` 已经让当前 v4 Builder 使用平台工具并只报告检查，这可以作为唯一的新语义，删除它周围旧版本分支。

### 推荐的定义边界

最清楚的实现是发布新的业务工作流定义版本（例如 `comet-native` v5），新 factory 只生成该定义，公开工厂不再提供 v1–v4 可执行参数。这里是工作流定义版本，不要求另起 npm 产品版本。

如果最终仍沿用 v4 名称，也必须仅接纳本次精确定义，拒绝旧 hash，固定应用另有明确的新格式标记；不能默认为所有 v4 都安全。相比维护旧格式识别变体，单一的新版本更直接，也避免误执行旧定义。

`native-sdk-create.ts:58–60` 的内部默认仍是 v1，`:255` 新建才显式选择 v4；`native-application.ts:162` 组合 factory 直接调用默认定义。因此必须一起改默认值、恢复起点、内置 Runtime 注册、新建和公开扩展 factory，不能只改 `native new`。

## 3. 固定应用扩展不能靠保留空检查步骤维持

`native-application.ts:69–72` 把 candidate/parent/child/integration 四个 scope 绑定到受管检查 Action，`:88–140` 要求原检查成功及其 candidateId，`:308–312` 将扩展串在检查之后。直接删 checks 会让扩展不再执行，或者一直拒绝结果。

应改成绑定实际业务候选和当前任务：

- candidate：本轮成功 Builder Action、候选 ID 和 outcome ID。
- parent：本轮成功 `supervisor.parent.builder`、集成提交和父候选。
- child：本轮成功 Child Builder 及对应 child/candidateCommit；扩展通过后继续当前 Child Verifier。
- integration：实际 `supervisor.child.integrate` 成功后的集成提交/子候选；扩展和必要的 Agent 验收后才允许归档子任务。

扩展依旧必须核对当前 Action、候选、Shape 批准、输出、Scope 和转移绑定；保留其失败回 Builder/集成修复及需求修订批准。检查执行 ref 不再是业务扩展的必要中介。不能用 `checks: []` 的自动成功 Action 给旧扩展垫桥。

旧固定应用的定义/模块/依赖已固定，直接换新 base 不等于原应用兼容；新 Runtime 应明确拒绝旧应用继续执行。需要重新生成/安装应用并创建新 Run，原文档和历史仍保留。不要悄悄改旧 application identity、workflow hash、Action inputHash 或批准。

## 4. 活跃调用方的收口清单

以下都是已查到的活跃源码引用；需要删相关分支或改为业务数据，不能仅删核心文件后通过类型绕过。

| 路径/模块                                                                                                                                                                                                  | 调整范围                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-next-command.ts`、`native-runner-input.ts`、`native-runner-protocol.ts`                                                                                                                            | 撤下 Compat 的 check dispatch/retry/request/started overlay 流程；`native-runner-input.ts:267` 解析计划，`:1567` 实际执行 portable 检查，`:1210` 执行 Supervisor 检查。若整体撤下 Compat，Runner 输入入口直接报兼容错误，不保留其执行实现 |
| `native-sdk-next.ts`                                                                                                                                                                                       | `:82–125` refresh-checks 迁移/重绑及后续 execution stop reconciliation 删除；正常任务领取、回报、批准继续                                                                                                                                 |
| `native-sdk-continuation.ts`、`native-sdk-status.ts`、`native-sdk-diagnostics.ts`                                                                                                                          | 去掉 checkExecutionObservation、检查恢复/停止模板及运行器状态；当前 business action/acceptance/wait 输出保留。`native-sdk-status.ts:59–77/:104–116` 是观测入口                                                                            |
| `native-doctor-command.ts`                                                                                                                                                                                 | 删除 SDK check recovery、portable local execution 恢复、`--stopped-actions`、旧快照/检查迁移；`:763–765` 的业务 Archive 完成收尾保留；旧 Run 只显示兼容说明                                                                               |
| `native-cancel-command.ts`、`native-sdk-cancellation-cleanup.ts`                                                                                                                                           | 删除受管检查终止/停止请求；取消仅操作业务状态和平台任务。不得把取消业务状态写成“操作系统进程已停”                                                                                                                                         |
| `native-sdk-cancellation.ts`                                                                                                                                                                               | `:63–89` managed execution 检查移除；`:90–143` 平台 Action 的停止握手模板若依本轮要求一并退役，也不再作为普通 Native 的必经步骤。保留 pending/running/unknown 平台任务本身及 children/wait 状态，未知结果不自动当成功                     |
| `native-sdk-archive-command.ts`、`native-sdk-archive.ts`、`native-sdk-history.ts`                                                                                                                          | 移除检查停止对账和 check receipt 前置条件；`:388` 的 quiescence 改为业务任务尚未结束/批准缺失等状态，不探测进程；Archive receipt/文件事务验证继续                                                                                         |
| `native-sdk-revise.ts`、`native-sdk-review.ts`                                                                                                                                                             | 去掉检查计划复用/检查输入刷新路径，保留当前候选、独立验收、用户修订授权                                                                                                                                                                   |
| `native-sdk-supervisor-child.ts`                                                                                                                                                                           | `:74–77` 旧计划 preflight，`:156/:172` 子任务/集成报告的计划分支移除；逐项验收和真实 Builder/Verifier 身份保留                                                                                                                            |
| `native-sdk-supervisor-integrate.ts`                                                                                                                                                                       | `:104–106` 集成检查计划校验删除；Git 合入、冲突现场和集成提交仍保留。合入后的必要验证交由当前 Agent 任务报告                                                                                                                              |
| `native-sdk-supervisor-integration-repair.ts`                                                                                                                                                              | `:137–139` 命令计划校验移除；保留修复工作区、修复 Action、候选提交和批准                                                                                                                                                                  |
| `native-sdk-supervisor-plan.ts`、`native-sdk-supervisor-parent.ts`、`native-sdk-supervisor-transfer.ts`、`native-sdk-supervisor-recovery.ts`                                                               | 删除检查 Action/执行记录、检查结果迁移和旧步骤恢复；当前轮 child contract、worktree、Git commit、父子任务及候选绑定仍保留                                                                                                                 |
| `native-supervisor-model.ts`、`native-supervisor-workspace.ts`、`native-supervisor-coordinator.ts`                                                                                                         | model 的 `checkExecution/checkStates/receiptRef` 和 workspace 中执行检查的分支移除；纯业务工作区准备、合入、冲突、交付不删。`native-supervisor-model.ts:75–88/:419–458/:766–781` 是旧状态和模板                                           |
| `native-portable-requirements.ts`、`native-portable-storage.ts`、`native-portable-shape-coordination.ts`、`native-portable-transitions.ts`                                                                 | 删除 local overlay 读取/重建；正式文档、Shape 批准、Delta、workspace、状态序列化仍用现有业务接口                                                                                                                                          |
| `native-portable-verification.ts`、`native-portable-verifier-coordination.ts`、`native-portable-recovery.ts`、`native-portable-status.ts`、`native-portable-archive.ts`、`native-portable-coordination.ts` | 移除只供 Compat 的执行/恢复闭包；新 SDK 所需纯业务能力从现有 loop/acceptance/report 模块取用，避免为了旧流程继续引入执行器                                                                                                                |
| `native-portable-runtime.ts`、`native-supervisor.ts`、`index.ts`                                                                                                                                           | 删除旧执行、旧快照及旧恢复再导出；`index.ts:4–27/:57–70` 当前仍暴露大量旧入口                                                                                                                                                             |
| `domains/dashboard/native-collector.ts:14/:223–231`                                                                                                                                                        | 删除 local-execution 读取和展示；展示 Run/Action/业务状态。不能留下“本机检查仍运行/停止”的视图                                                                                                                                            |
| `domains/comet-entry/resume-probe.ts:370/:689`、`project-status.ts`、Hook Router                                                                                                                           | 旧状态只给兼容阻止说明，不自动恢复旧 Runtime；不能把旧未知执行降成“可自动继续”                                                                                                                                                            |
| `app/commands/runtime.ts:1062–1073`                                                                                                                                                                        | 内置 Native 的通用 SDK dispatch 同样做新定义边界判断，不能通过 `runtime dispatch --application native` 继续旧 checks                                                                                                                      |
| `app/commands/runtime.ts:834–866`、`domains/workflow-application/application.ts:496/:646–655`                                                                                                              | 固定应用通用 dispatch 直接加载原实现，必须在 Native base 的定义/Run边界阻止旧版本，而不仅在 `loadOwnedNativeSdkRuntime` 加判断                                                                                                            |

`native-runtime-ownership.ts:77–91` 的 `registerNativeSdkRequestInput` 当前实际只再次读请求文件并解析，并未登记进程或快照；它不是 PID 机制。可合并至已有请求边界以减少重复读取，但不应误称进程恢复。`native-runner-input-artifacts.ts` 仍实现摘要登记（`:10–22/:124–129`），本次检索未找到实际消费/注册调用；这是可删除的旧排除快照输入登记，不是业务候选材料。

## 5. 快照和旧内容收据闭包

### 可删除

`native-snapshot.ts` 是旧源码内容快照实现，含文件/字节/枚举预算、Git/物理采集、baseline 和 manifest。其入口为 `:1406` health、`:1999` parser、`:2365` capture、`:3359` current、`:3381/:3391` baseline。它不同于 Shape 的业务语义快照。

撤下旧 Runtime/Compat 后，可删除其调用链：

- `native-check.ts`、`native-check-receipt.ts`、`native-check-receipt-model.ts`、`native-check-receipt-storage.ts`。
- `native-build-evidence.ts`（`:17–21` 直接采集内容快照）、`native-verification-scope.ts`、`native-verification-runtime.ts`、`native-verification-receipt-runtime.ts`（`:607` 自动检查收据）、`native-verification-receipt.ts`。
- `native-evidence-command.ts` 当前已是废弃接口；旧 evidence storage/projection/retention 仅为上述收据保留的部分一并删除。
- `native-schema-migration.ts`、`native-portable-migration.ts`、`native-portable-migration-runtime.ts` 中将旧 snapshot/receipt/overlay 恢复成可执行流程的全部路径。
- `native-change.ts` 的旧 snapshot-based creation/读写/CAS，`native-transitions.ts` 的旧 `advanceNativeChange`，`native-guards.ts`、`native-diagnostics.ts`、`native-doctor.ts`、checkpoint journal/recovery 等仅支撑旧格式执行的实现。在删除前把仍被新流程用到的 `nativeChangeDir`、名称校验、workspace 冲突错误/列表等小型业务帮助留在已有对应模块，不为这些符号保留整个旧状态机。
- `native-cli-shared.ts:365–400` 的 snapshot budget/receipt 错误包装，`native-runtime-errors.ts:49` 建议修改 `native.snapshot` 的错误提示，以及旧状态类型中的内容快照/证据/receipt字段。

还有共享配置残留，不能只删 Native 目录中的采集器：`domains/workflow-contract/project-config.ts:169` 的快照默认值、`:208–214/:270–282/:340–348` 的注释/字段说明、`:740` 的 parser、`:922` 的 native.snapshot 标准化、`:1567` 的默认配置生成；`domains/workflow-contract/index.ts:17` 和 `native-config.ts:5/:36–38` 的相关重导出；`native-init-command.ts:47–48` 的 snapshot.exclude 合并；`native-root-move.ts:919/:1089` 的 snapshot 传递。撤下旧内容快照后同步删除这些行为和对应配置类型，旧配置中的 retired 字段可明确忽略或在一次边界报不再使用，不应继续生成预算、扫描范围或换名恢复同类公开限额。普通 artifact_root、workspace/finish、用户构建和验收选项保留。

这里不能继续承诺“旧内容证明命令虽然不公开但内部还可执行”；用户本次授权删除的是执行闭包，旧实现不再需要靠隐藏 API 留存。

### 必须保留，或明确属于另一项业务决策

- `shape_semantic_snapshot` 与 `shape_confirmation_hash`：`native-portable-types.ts:172–174`；它们记录用户批准的需求契约，不能因为叫 snapshot 就删除。`native-portable-requirements.ts:1049–1060` 读取此批准语义。
- `children_contract`/`children_contract_ref` 和当前轮任务绑定：`:175–177`，防止错误 Child 进入父候选。
- `run_checkpoint` / application checkpoint：`native-sdk-state-store.ts:275–300/:418–450/:527`，用于恢复业务状态、Action、批准和固定应用身份；不是进程快照。旧执行型 checkpoint 可只读展示且禁止执行，但新业务 checkpoint 继续可恢复。
- `NativeBuilderHandoff.candidate_id`、`builder_execution_ref`、`reviewer_execution_ref` 以及 `verification.verifier_execution_ref`（`native-portable-types.ts:83–103/:129–143`）：这些值是平台会话/任务身份，不是 PID/进程创建时间。独立 Builder/Verifier、候选绑定仍要靠它们。
- Archive finalization receipt、Delta 重合并输入、Git worktree/branch/commit：保护批准后的交付和冲突恢复，不属于命令进程管理。
- 用户构建方式、TDD/review/acceptance 选择、Task stable ID/完成检查：不在受管检查删除范围内。

## 6. 字段删除表与最小留存接口

| 删除的执行字段                                                                                                                                                  | 保留的业务事实                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `NativeCheckPlan` 全部命令参数、timeout、repeatable/reusable/outputs、执行次数                                                                                  | `checks: [{name, result: passed/failed/not-run, note}]` 等具体 Agent 报告，附实际未运行原因 |
| `NativeLocalExecutionState` 的 inputFingerprint/gate/machineId/checks/execution/rawInputRef；`NativeLocalCheckState` 全部 activeProcess/evidenceDigest/rawInput | 当前 candidateId、state_version、Builder/Verifier Action、平台真实 claim/sessionId 和结果   |
| SDK check record 的 child/instanceId/managed/phase/terminationUnconfirmed/stop-request/stop receipt/active lock                                                 | Run/Action/attempt 的业务归属；业务未知结果仍未知，不自动变成成功                           |
| `NativePortableCheckSummary` 中 Runtime 专用 argv_display/cwd_ref/exit_code/duration_ms 与自动复用前提                                                          | 报告检查名称、结果、说明；需要时 Agent 在报告中列命令/耗时作为描述，CLI 不执行或证明它们    |
| Compat `requestCheckRounds`、`verifierStartedAt` 本机 overlay、`verification_checks`、`retry_check_ids`                                                         | SDK Action 自身的 pending/running/unknown/succeeded/failed，以及当前平台任务的真实回报      |
| 旧源码快照、环境指纹、原始输入/输出摘要和检查回执引用                                                                                                           | Shape 业务契约、需求/验收项、候选、批准、Archive 业务提交回执                               |

`NativeVerifierResponse` 的 `request-checks` 联合分支（`native-verifier-protocol.ts:32–59`）可删，Verifier 保留 `final-result`、逐项 acceptance、risks、summary。Verifier 缺少验证时自行在平台运行或如实回报 blocked，不能由 Runtime 接受任意 command 计划。

最小公开边界维持现有名称：定义当前 Native application；创建/读取 Run；领取/回报平台任务；确认当前 proposal；读取验收/报告；确定性 Archive/Delta/工作区提交。不新增第二套执行状态、后台 owner、停止 receipt，也不需要新的 hash/配置预算。

## 7. 锁的具体区别

可以随检查删除的锁包括 SDK check execution `.active.lock`（`native-sdk-check-execution.ts:90–102`）、check record/stop-request 写入锁和仅为本机 overlay/旧 snapshot 恢复服务的锁。用户不再要求旧记录恢复时，`native-lock.ts:226–258` 中旧 lock protocol/coordinator 升级路径也不必留作运行兼容。

**不能直接删除整个 Native mutation lock 或 SDK projection lock。** `native-mutation-lock.ts:75–113` 用于业务状态/Archive/Delta 变更、待恢复事务和 root move；`native-sdk-projection-lock.ts:19–45` 保护权威 Run 到 YAML 的投影；`native-sdk-state-store.ts:494–527` 锁内从当前 authority 发布 checkpoint，避免回写旧状态。这些锁不证明检查进程存活，不属于仅为检查服务的机制。

`native-lock.ts` 当前已委托 `recoverable-file-lock`，它的 file identity 是锁文件身份，不是进程创建身份。可以在删除旧兼容分支后缩小 wrapper，但不能只按 `identity`/`owner` 名称删掉文件事务保护。也不应在本任务顺手重做共享 SQLite 锁；共享锁还服务其他业务。

## 8. 旧 Run 的统一阻止点和兼容影响

必须在以下边界禁止执行旧流程：

1. 内置定义选择：`native-sdk-application.ts:174` 仅返回当前新定义，旧版本/旧 hash 返回明确不支持；删除历史可执行定义列表。
2. Native 所有入口的 ownership 加载：`native-runtime-ownership.ts:543–613`，在恢复/调用 runtime 前检查 Run 新业务定义；`:94–157` 不再因为 local execution 是否存在而注册 Compat owner，也不自动把旧文件升级为新 SDK。
3. 通用内置 dispatch：`app/commands/runtime.ts:1062–1073`。
4. 固定 Native application 加载/启动：`workflow-application/application.ts:496/:646–655` 及通用应用 dispatch；新建和旧 Run 均不能通过固定模块把旧 executor 带回来。
5. Portable checkpoint 导入：`native-sdk-state-store.ts:418–450` 恢复前检查定义，不允许先导入旧检查 Run再由 Doctor 标记 stop 来“迁移”。
6. `native next/status/archive/doctor/transfer/spec/root` 的旧 Compat/legacy fallback，以及 Entry resume-probe、Dashboard 的自动恢复入口。只读观测旧记录可保留少量 schema/name/phase/版本信息，不载入旧执行器。

输出应明确：该 Run 使用已撤下的受管检查流程，本版本不能继续；保留原 Run、文档和原结果；可在对应旧版本中完成，或让 Agent 根据已有材料创建新 Run 并重新获得必要批准。不能静默放弃旧 Run 再创建同 ID 的新状态；不能宣称原进程已停止或原检查通过；也不能暗示 `doctor --repair` 会恢复已删除功能。

无需为了显示旧历史保留整个旧 factory/validator。若暂时无法提供旧历史详情，明确标记为旧记录、保留原文件及原始 JSON 就可以；“旧 Run 可不再执行”不授权删除用户工作目录或原证据。

## 9. 构建、CLI、Skill 和仓库契约

- `config/repository-layout.json:60–92` 当前 Native 发布入口不含 check/evidence/checkpoint 独立 bundle，只有聚合 CLI 仍路由 `check`。删除源码后重建当前全部 Native bundles；不能只改 `comet-native-runtime.mjs`。
- `scripts/build/build-native-runtime.mjs:20–34/:100–129` 从 layout 构建所有独立命令。`assets/manifest.json:52–65` 同步产物清单；这里没有必要新增新脚本。
- `domains/skill/platform-install.ts:75–77` 和 `test/repository/native-runtime-assets.test.ts:115–116` 的旧 check/evidence/checkpoint 名称是旧安装产物清理/不得恢复契约，**应保留删除旧安装文件的行为**，不能因源码删除连升级清理一起去掉。
- `config/repository-layout.json:164–174` 删除 portable-checks compatibility facade 关系；`:191` 的 receipt pure model、`:504` 的 local execution 登记、`:585–624` 的旧执行模块 mutation-lock importer 等随真实删除同步收敛。不要扩容依赖许可来保留错误层级。
- `native-cli-help.ts:192/:216–221` 删除 Runner/Runtime检查计划；`:277–281` 删除检查进程停止证据参数；保留真实业务锁修复参数时说明对象是文件事务。`native new --runtime compat`（`native-new-command.ts:160–164`）不能继续创建旧执行流程。
- 中文 Skill `assets/skills-zh/comet-native/reference/commands.md:144–299` 是完整 Compat Runner/受管检查/检查回执协议，需撤下；`:61` 附近 SDK `request-checks` 说明也应删除。主 Skill、recovery/workspace、英文对应版本一并核对。中文先完成再同步英文，最终不再要求交给 CLI 跑计划、领取停止证明或用 PID 恢复。
- 业务 `runtime dispatch` 的 claim/outcome、真实平台 sessionId、逐项验收与未批准不 Archive 的指令保留；不要把“执行引用”统一改写为进程身份。

共享平台源码不能随 Native 直接删除：`platform/process/owned-command.ts`、`run-owned-command.ts`、`terminate-process-tree.ts` 仍被 `domains/eval/eval-run-entry.ts:147/:197` 及其他域使用。普通 Native/Classic应彻底断开依赖，但 Eval 的实际模型/容器进程管理是另一范围。普通 Git 命令、Archive 安全提交也不是任意命令检查运行器。

## 10. 测试和受保护案例的迁移

用户已明确撤下功能，适用现有 `docs/architecture/badcase-maintenance.zh.md:48` 的 `testMigration.kind = feature-removed`，不是把旧测试改成空成功。登记需要保留原来源/ID、旧测试完整正文/差异归档、具体授权、逐行为说明、精确替代 selector，以及实际新旧证据；此前未完成的 Eval/测试不得改成已通过。

### 可以退休的旧执行专属测试

`native-check-executor*.test.ts`、`native-check-registration.test.ts`、`native-check-owner-recovery.test.ts`、`native-check-without-pid.test.ts`、`native-sdk-check-termination.test.ts`、`native-portable-check-termination.test.ts`、`native-local-execution.test.ts`、`native-supervisor-check-process.test.ts`、`native-check-receipt.test.ts`、`native-snapshot.test.ts` 及 SDK application 中旧检查计划/重试/停止恢复/复用用例。仅当产品执行功能确实物理删除且新入口拒绝测试通过后，才能按登记迁移；不能因为其中 deadline 失败就先跳过它。

`test/platform/process/owned-command-termination.test.ts` 等共享平台测试仍需保留，因为 Eval 仍使用它们。Native 专属 deadline 案例可以退休，平台 deadline 行为若仍受支持则应在平台测试继续覆盖，不能借 Native 删除悄悄放宽。

### 必须保留并改接新业务路径的断言

- 未批准 Shape/验收不推进、不归档；用户选择的构建/验收方式继续生效。
- 当前候选、当前 Builder/Verifier、真实领取 session、逐项验收恰好完整覆盖；陈旧候选/旧 proposal/跨 workflow/错误 Child 不得混入。
- 检查报告中存在失败/未运行时不能伪造成通过；Agent 的合法通过和批准路径可以完成。
- 当前轮 children contract、集成提交/目标工作区绑定，冲突可修复且不重复 Git/Archive 副作用。
- 新业务 checkpoint 恢复后保留 Action/批准/业务结果；旧执行型 Run 则明确拒绝且不启动命令、不标记已停止、不改写原结果。
- 取消/未知平台任务不凭进程推断自动重放。若退役停止握手后改变取消后新任务的准入条件，要按用户新授权明确记录这一行为变化，不能拿旧 assertion 继续声称语义相同。

### 当前 registry 中直接受影响的登记与既有迁移

本次读取 `config/workflow-regressions.json` 的 `cases`，按 Native 执行测试文件及 SDK application 检查行为筛选，发现 39 项：**21 项已存在 testMigration，18 项尚无迁移**。该筛选包含历史原 selector，不能把所有 39 项都称为当前仍执行的测试。已有迁移应继续检查其有效末级替代测试是否仍引用这轮要删除的执行器；不能重新退休历史已删除的功能，也不能把业务恢复/取消一类整体删除。如下是逐条复核清单：

```text
native-invalid-completed-check-recovery
native-invalid-completed-check-guidance
native-confirmed-stop-probe-reuse
local-native-check-refresh-fixture-order
local-native-one-shot-reverify-proof
native-531-supervisor-startup-errors
native-531-supervisor-ready-handshake
native-531-check-failure-facts
native-531-check-pipe-settlement
native-531-legacy-eperm-stop-recovery
native-531-declared-check-outputs
native-509-environment-candidate-binding
native-user-input-filename-hashing
native-docker-syntax-scope
native-rejected-check-request-no-baseline
native-generated-input-literal-query-scope
native-single-character-dirty-input-snapshot
manual-recovery-native-archive-check-history
manual-recovery-native-running-revision
native-ignored-parent-generated-input-binding
native-cancellation-pending-cleanup-diagnostic
native-ignored-cache-link-boundary
ci-python-loader-environment-isolation
native-language-neutral-raw-edit-observation
native-raw-final-cache-directory-fence
native-all-reused-checks-without-child
native-rejected-check-proof-original-claim-correction
native-517-utf8-bom-check-receipt
native-lightweight-settled-check-inspection
native-normal-stop-reconciliation
native-portable-explicit-empty-check-plan
native-supported-version-cancellation-ownership
native-portable-orphan-interruption-persistence
ci-native-process-regression-worker-isolation
native-generated-input-metadata-concurrency
native-proven-orphan-check-explicit-retry
native-pid-free-check-stop-and-legacy-receipt
native-v4-cancellation-workspace-release
owned-command-timeout-independent-deadline
```

尚无迁移的 18 项为：`native-invalid-completed-check-recovery`、`native-invalid-completed-check-guidance`、`native-531-supervisor-ready-handshake`、`native-531-check-failure-facts`、`native-531-check-pipe-settlement`、`native-rejected-check-request-no-baseline`、`manual-recovery-native-archive-check-history`、`manual-recovery-native-running-revision`、`native-cancellation-pending-cleanup-diagnostic`、`native-rejected-check-proof-original-claim-correction`、`native-lightweight-settled-check-inspection`、`native-normal-stop-reconciliation`、`native-portable-explicit-empty-check-plan`、`native-supported-version-cancellation-ownership`、`ci-native-process-regression-worker-isolation`、`native-pid-free-check-stop-and-legacy-receipt`、`native-v4-cancellation-workspace-release`、`owned-command-timeout-independent-deadline`。

其中前两项来自 #545：本轮最终交付不应再宣称“旧 Build 检查可经 Doctor 恢复”的原修复已完成，应明确该执行功能已撤下，替代断言是旧 Run 不执行/不重放、不篡改旧结论并提供升级说明。保留 issue 来源及此前复现证据。

`historicalTestMigrations` 已有 content-proof feature-removed 记录及冻结证据，不应重写它们；本轮新增迁移要沿用支持的字段，不能改旧 ID 或删清单绕过历史覆盖。`native-sdk-definition-selection.test.ts` 和旧 v4 fixture 也应保留原定义数据作为“不支持旧执行定义”的输入，改为明确拒绝的替代契约，不把 fixture 换成新定义冒充兼容。

### 最小替代测试建议（本调查未执行）

1. 新内置 Native 与新固定扩展应用的 workflow/validators/executors/commands 中没有上述受管检查 ref、step 或刷新命令；旧版本 factory 参数不能生成可执行定义。
2. 从公开 CLI 和生成 command bundle，提交旧 check plan/Compat Runner/stop proof 被明确拒绝，Run/批准/原执行记录不变，命令 marker 不产生。
3. 准备旧 v1–v4/旧固定应用/portable checkpoint，分别经 Native next/doctor/archive/transfer 和通用 runtime dispatch 尝试继续：全部明确拒绝、无执行副作用，原记录不被伪造为“停止”。
4. 新普通 Native：平台 Builder 报告定向检查，Verifier 完整验收，用户接受后 Archive；无独立检查进程或 execution/stop/active-lock 记录。包含失败报告和未批准反例。
5. 新 Supervisor：child Builder→扩展→Verifier→Git集成→平台集成验收/扩展→child Archive→parent最终验收；验证当前轮候选/contract/commit，合法路径完成。
6. 新业务 checkpoint 在无旧 local execution overlay 的新设备恢复，保留业务 Action/批准/结果；不询问 PID，不生成检查停止握手。
7. 生成资产、Skill 契约、旧安装脚本清理及架构许可清单保持一致；Eval 共享进程模块仍有原定向覆盖。

## 本轮证据边界

仅做当前源码、factory、public dispatch、构建配置、Skill 和回归 registry 的静态核对。未修改任何产品/测试文件，未启动进程探针、测试、构建或 Eval；本文方案尚无实现后的通过证据。原 deadline/取消/Archive 的前轮隔离记录是独立调查结果，不能当作本轮“删除后通过”。

## 11. 最新补充：删除旧执行器，同时自动转换业务数据

用户最新要求覆盖前述拒绝升级方案。本节采用根 Agent 正在实施的边界：wrapper 只构造当前 v4，删除旧 executor/factory；一个业务数据适配器负责已知旧 Run/文档的自动接续。普通可转换记录不要求用户执行迁移命令或额外批准升级；原业务中本来尚未取得的批准仍不能代替用户作出。

### 11.1 SDK 允许什么，不允许什么

源码证据：

1. `domains/engine/portable-run-checkpoint.ts:227–233` 的 `preserveRuntimeExecutionOrigins` 只复制 Run，并为已有 claim 的 Action 保存原 workflow 来源。它不改图、不删步骤、不重建 ready，也不证明执行停止。`:236–244` 的执行绑定继续使用这个原来源，所以定义升级不能重绑旧 claim。
2. `workflow-run-validation.ts:508–522` 要 Action/Wait 的序号无缺口，`:524–588` 要 actionContexts 一一对应且 results 的来源序号仍存在。**删中间 check Action 会破坏序号和引用；保留原业务 Action/批准时不应重编号。**
3. `runtime-service.ts:595–630` 核对注册定义和 commands，`:631–705` 核对 ready 的当前图边，`:706–713` 核对 evidenceWait。它**不要求每条普通历史 Action 或普通历史 Wait 的 stepId 还存在于新定义**。因此旧 check Action 可以作为只读历史数据保留，不需要旧 executor 或旧 factory。
4. `runtime-action.ts:307–310` 的 `cancelRuntimeAction` 只是停止调度：保留原 claim、输入和记录，不创建成功 outcome，不创建 cancellation/executionStop。它适合把已撤下的 pending/running/unknown 检查改为“不再由工作流调度”；不能把这个状态描述成原操作系统进程已停止。
5. `runtime-store.ts:175–212` 的 `restoreCheckpoint` 仅支持缺失 Run 或相同的初始 rev1 导入，不能覆盖一般已存在旧 Run。已存在记录应以原 revision 做 **CAS 到 revision+1**；`:1185–1193` 是文件 store 的恢复实现，`:1201–1216` 是 CAS 实现。
6. `runtime-service.ts:1893–1924` 只把 running/unknown 当执行阻塞，并只选 pending Action 调度；cancelled 的旧检查不会再次执行。普通 Native 的当前视图也应仅展示当前业务工作，不能继续展示被撤检查的领取或停止模板。

### 11.2 最小转换算法：同一个 Run，保留历史，只改当前推进位置

适配器接收 `oldRun + currentDefinition + 当前业务 state`，不加载旧定义，不读进程记录，不调用 executor。

1. 在首次持久化转换前保存原 Run 的完整不可变副本，包含原 workflow、revision、Action、Wait、commands、outputs。使用当前需求/源 revision 的固定记录路径即可，不增加内容摘要、PID、后台锁或新执行日志协议。
2. 对旧记录做 SDK 数据校验（`parseWorkflowRun`，或 definitions 为空的只读 runtime inspect）；不需要构造旧 factory。现存业务状态仍用 Native 业务 parser 校验。
3. `next = preserveRuntimeExecutionOrigins(oldRun)`。保留 RunId、input、owner/selected change、完整 sequence、业务 Action 的 ID/inputHash/attempt/claim/outcome/receipts、所有原批准和历史结果。
4. 已终态的旧检查数据原样保留。仅对已撤下步骤的 pending/running/unknown Action 调用 `cancelRuntimeAction`，原因明确为“该工作流步骤已撤下；原进程是否停止未由本次转换证明”。不填 outcome、executionStop、cancellation，不清 claim，不声称原工作未执行。
5. 旧 `checks-stop` 等已经撤下的**普通** pending Wait 标记 cancelled，不写 decision；resolved 的旧普通 Wait 原样保留。当前业务 pending Wait 也原样保留，尤其原 proposalHash/decision 不能换成新批准。
6. 将根 workflow ref/hash 绑定当前 v4。根 `definitionHashes` 仅留下当前根定义，旧根版本/hash 保存在 Action executionOrigin 和原始副本里。否则 SDK 会要求注册旧 definition，见 `runtime-service.ts:600–603`。真实 child workflow 的固定引用另见下文，不能无差别清空整个映射。
7. 删除只属于已撤 command 的 `run.commands` 活跃绑定，保留其完整原记录于副本；不能只保留旧 `refresh-checks` ledger，因为 `runtime-service.ts:609–620` 会要求新定义仍声明同名 command。现存业务 command 的名称、Action 目标及 activation.inputHash 仍匹配时保留。
8. 保留仍与新图一致的 ready。仅删除旧检查路径的 ready/join token，并从真实原业务来源重建到当前业务节点。当前业务 Action 已经 pending/running/unknown 或相应 Wait 已 pending 时，不再激活第二份；原平台任务继续沿原 claim 回报。
9. 对转换后的快照创建**只有当前定义、没有 executor**的临时 runtime 并 `inspect` 校验；成功后 CAS。定义不匹配、序号、来源或批准不成立时，不落盘半成品。
10. 复用既有 projection/checkpoint 发布逻辑。源 Run 副本先保存、CAS 再发布投影；如果 CAS 已成功但投影发布中断，下次只在旧 checkpoint 与保存的源 Run、当前已迁移 Run相互匹配时补投影，不能又转换/又激活新任务。命中当前 workflow/hash 后直接返回，确保幂等。

这保留了旧执行**数据**，没有保留旧执行**能力**。无需 SDK 新增“忽略历史验证”的开关，也不应放松全局 sequence、claim 或 proposal 校验。

### 11.3 ready 的精确合法结构

SDK `runtime-service.ts:646–700` 要 ready.results 完全等于真实源上下文加上该源本次结果，还要新定义确实声明同一事件的 from→to。不能把 from 改成旧检查、凭空输出成功，或用 `from:null` 绕过图：`:636–643` 限制 null 只能是 sequence=0 的 entry（另有明确 transition-limit 恢复例外）。

成功业务 Action `a` 到 `target`：

```ts
const context = run.actionContexts[a.id];
const token = {
  from: a.stepId,
  to: target,
  results: {
    ...context.results,
    [a.stepId]: { sequence: context.sequence, value: a.outcome.output },
  },
  // 若新业务节点需要当前 Child/commit/contract 激活，提供匹配的 activation。
};
```

已解决批准 Wait `w` 到 `target`：

```ts
const token = {
  from: w.stepId,
  to: target,
  results: {
    ...w.results,
    [w.stepId]: {
      sequence: w.sequence,
      value: { choice: w.decision.choice, proposal: w.proposal },
    },
  },
};
```

保留 results 中已有的旧检查来源是合法的，因为对应历史 Action 和序号仍在；这里引用的是历史结果，不是再次执行或新证明。不要为“清理旧字段”重写业务 Action 的旧 input/output。

| 当前业务推进位置                                            | 原事实                                                        | 新推进位置                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Build 已交接，旧检查 pending/running/unknown                | 当前候选的成功 `build.builder` 或 `supervisor.parent.builder` | 取消旧检查调度，从该 Builder 沿新图到 `verify.verifier`；若 verifier 已存在，则保留原任务，不再激活 |
| 已有明确失败的检查                                          | 原 failed outcome                                             | 保留失败，转正常 Builder 修复，不得因功能退休把这轮结果改成通过；Shape 批准和原失败历史保留         |
| Verifier 已成功，旧 report/revalidate 阻住确认              | 当前候选成功 `verify.verifier`                                | 从真实 verifier outcome 到 `verify.confirm`；已有 pending verify Wait 则保留原 Wait                 |
| 用户已接受当前验收                                          | 原 resolved `verify.confirm`，choice=approved                 | 从该原批准沿新图到 `archive.prepare`；不能重复请求已经作出的同一批准                                |
| Archive prepare/execute/finalize 已 pending/running/unknown | 当前原业务 Action及事务/回执                                  | 保留原 Action/claim，继续原 Archive 恢复能力，不重新激活或把 unknown 改成功                         |
| 已归档 completed/cancelled                                  | 真实业务终态及回执                                            | 保持终态，不造 ready；去掉旧检查能力不等于重做 Archive                                              |
| Shape 尚未批准                                              | 原 pending Shape Wait/当前正式材料                            | 保留正常 Shape 批准步骤，自动数据升级不能代替尚未作出的批准                                         |

旧 `shape.revalidate`、`verify.revalidate` 虽名字像纯内部步骤，仍须按具体前后事实迁移：已完成历史保留，未完成时跳到新图本来合并进去的业务节点，而不是写一个 succeeded outcome。

### 11.4 三类旧输入的自动入口

**SDK v1–v3、v4 旧 hash：** 在已知 Run 的 raw store/read-load 边界、尚未调用当前 runtime.inspect 前转换。新 v4 factory 不接受旧参数没有问题：数据 parser 不需要旧 factory。`loadOwnedNativeSdkRuntime`、通用内置 `runtime dispatch`、checkpoint 导入共享同一纯适配器，避免三个迁移算法。当前 workflow/hash 已匹配则零转换；不枚举其他项目或 worktree。

已有 Run 用 CAS；本地记录缺失但有 portable checkpoint 时，先用 SDK 的 `readPortableRunCheckpoint` 校验原 checkpoint，再转换该返回快照，使用缺失记录的 `restoreCheckpoint(null)` 导入。不得先靠旧 factory 自动执行。Portable reader 可能把 running 转为 unknown（`portable-run-checkpoint.ts:87–89`），该状态不能当作进程结束。

**Compat portable v4 文档：** 它本来就没有完整 SDK Action/Wait 历史，不能伪造“Builder/Verifier 已经成功执行”的 Action 来凑图。直接导入已有 `NativePortableState` 中的候选、语义批准、验收、verification/history、workspace；创建当前业务节点的 **pending** Action 或 pending Wait，把导入前原 YAML/local overlay 作为原始历史材料保存。可以用 SDK `createRuntimeAction`（`runtime-action.ts:110–150`）和标准 Action input/context 结构创建待执行任务；这只是数据接续，不是冒充执行成功。

初次导入 Run 可从 sequence=1 的当前 pending 业务 Action 开始，SDK 不要求它一定由 entry 激活过的历史 Action 证明（需要通过 parse + 当前定义 inspect）。不应把 `from:null` 的 ready 指向非 entry，也不应伪造已成功的 Shape/Builder Action。新 state 的实际批准值继续来自旧权威文档。

Compat 已在 `archive-ready` 时，需要处理当前 Archive validator 要求的 SDK批准记录：`native-sdk-archive.ts:80–97` 仍要求 resolved `verify.confirm`。对于旧文档中明确已接受的业务状态，可把**已有的决定事实**导入为带来源说明的历史 Wait（保存原 YAML 和 state_version，decision.reason 明示从哪份旧状态导入），不把新的 `verification_result=pass` 自行当作用户接受。`native-loop-runtime.ts:493–514` 表明 portable 的当前 `archive-ready` 是验收接受后的业务转换；但更老 v1–v3 文档只存 phase/pass、缺少这项决定时，保留报告并进入正常接受步骤，不能捏造批准。

Compat 若已有真实 Verifier 平台任务还在进行，保留文档里的原 `verifier_action`、candidate/attempt/executionRef；迁移后应让原任务领取/关联当前待办并回报，不再派发第二个任务。`native-verifier-action.ts:61–78` 的 Compat Action ID/stepId 并非 SDK 的 `<runId>:<sequence>` 结构，不能硬塞进 SDK actions。原对象保留为业务来源，新 SDK pending Action 的输入带原任务引用；原平台领取方的下一次正常调用确认关联，不伪造 claim/成功/停止。没有真实任务引用则保持未知事实，由当前 Agent查看原平台任务，不探 PID。

**更老 Native v1–v3 文档：** 这些状态有 `approval`/`approved_contract_hash`，但没有完整 Loop 候选/独立验收记录（`native-types.ts:78–114`）。只搬运确实保存的批准/材料/结果到对应业务步骤；缺失当前候选或验收事实时进入正常的实现交接或验收，不能把所有状态退回 Shape，也不能把旧 pass 包装成新的独立通过。数据转换本身自动进行，没有额外“同意迁移”步骤；尚未完成的业务工作照常完成。

`native-portable-migration.ts:139/:196–214` 当前旧迁移会丢弃 Loop/verification 等并重建；它不满足这次“保留业务进度”要求，应被上述字段转换替代，不能继续复用它的重置语义。

### 11.5 Wait、commands、children 的真实限制

- 普通 resolved/pending Wait 数据不要求旧 step 存在，但 pending Wait 若属于已撤步骤必须 cancelled，否则 SDK 会继续等它。原 resolved 的 proposal/decision可原样保留；`workflow-run-validation.ts:218–250` 继续检验提案和决定一致性。
- command ledger 必须与新定义 command/目标 Action 及其 activation hash 一致；不能为了保留已撤 command 而保留旧图。完整 ledger 归档，当前可执行 ledger 仅留仍存在的业务命令。
- `evidenceWaits` **全部**要求新定义仍声明同 kind 的 await_evidence，连 cancelled 历史也会检查（`runtime-service.ts:706–713`）。这不同于普通 Wait。内置 Native factory/公开扩展工厂没有 await_evidence，通常为空；自定义应用若有这种结构，不能套“所有旧 Wait 都能留”的规则。
- `children` 要与 child_workflow Action 一一对应并在 definitionHashes 有固定引用（`workflow-run-validation.ts:623–647`）；新 runtime inspect还会要求映射内定义存在。内置 Native 的 Supervisor 是 handoff/业务 Child，不是 SDK child_workflow，所以不能混淆这两种 children。定制应用真正包含 SDK child workflow 时，只转换已知精确子 Run，并保留不变的业务子定义；不能清空 children、丢掉其 Action 或扫 worktrees。
- `runtime-service.ts:1085–1088` 会跳过终态 child Action，但 definitionHashes 的注册仍要成立。若某定制应用的固定子定义本身也变了，需该应用的数据映射；不能用内置 Native 适配器猜测任意定制业务。未掌握的自定义结构不代表可以重派外部工作。
- 已取消并带 claim 的旧检查仍会出现在 SDK generic currentRun（`runtime-service.ts:185–191`）中，因未创建停止回执。Native 的工作视图/continuation要把已撤步骤的这类记录当历史，并展示简短升级说明，不能重新暴露 claim/ack-stop 指令。完整 SDK inspect 仍可查看原事实。

### 11.6 已执行的 SDK 纯内存探针

新增诊断脚本：`coverage/native-retirement-data-migration-probe.mjs`。运行 `node coverage/native-retirement-data-migration-probe.mjs`，使用 esbuild **write:false** 在内存装载 SDK；不构建产品/根 dist，不注册任何 executor，不执行检查命令，不操作真实项目，不运行 Eval。

探针用模拟平台 claim/outcome 和真实 SDK APIs 构造三个旧业务状态，在同一个 memory store 里迁移到只含当前图的 Runtime。真实结果：

| 推进位置                           | 原/新 sequence | 旧运行器状态                      | 停止回执 | 新业务待办                    |
| ---------------------------------- | -------------- | --------------------------------- | -------- | ----------------------------- |
| Builder 后旧检查正在运行           | 4 → 5          | cancelled，claim 保留，无 outcome | 无       | `verify.verifier` pending     |
| Verifier 后旧 report 待执行        | 6 → 7          | cancelled，无 outcome             | 无       | `verify.confirm` pending Wait |
| 原验收已批准后旧 revalidate 待执行 | 8 → 9          | cancelled，无 outcome             | 无       | `archive.prepare` pending     |

三项均断言：RunId不变；原业务 Action/claim/inputHash/attempt/outcome原样；已有批准Wait原样；state原样；executionOrigin保存旧 workflow；原始快照不变；`restoreCheckpoint(null)`不能覆盖现存Run；CAS+1成功；当前定义 inspect通过；当前 runtime.next只创建新待办、没有执行任何工作。反例直接删除中间旧 Action，三次均得到 `INVALID_RUN: WorkflowRun.sequence 与已激活步骤数量不一致`。

这是 SDK 图和持久化契约证据，不是 Native 产品迁移已实现的证据。Compat批准导入、既有平台任务关联、原Run/投影中断恢复及自定义应用仍须产品实现后的定向验证；本文未运行这些测试。

### 11.7 已领取业务 Builder/Verifier 可以沿原 claim 回报

补充实测了最容易误判的边界：旧 hash 的业务 Action 正在 running/unknown，定义升级后 `executionOrigin.workflow` 仍为旧 v3/hash，而 `run.definitionHashes` 仅有当前 v4/hash，是否必须加载旧 factory。

**不需要。** SDK 没有按 Action.executionOrigin 查找旧定义的 `definitionForAction` 路径。`runtime-service.ts:1237–1249` 从当前 Run 取原 Action，`:1269–1276` 用当前根定义同 step 的 schema/validator。`runtime-action.ts:224–234` 只核对原 Action 的 id/attempt/inputHash/claimToken，明确允许 running 或 unknown 回报。`executionOrigin` 用于保留原执行身份，不要求注册旧 workflow；parse 只检查其 workflow.id 与当前根一致（`workflow-run-validation.ts:473–474`）。

同一个纯内存脚本又执行四种情况：

| 原业务任务        | 原状态  | 注册的定义  | 回报结果                                              |
| ----------------- | ------- | ----------- | ----------------------------------------------------- |
| `build.builder`   | running | 只有当前 v4 | 原 claim 回报成功，sequence 3→4，新 Verifier 待办产生 |
| `build.builder`   | unknown | 只有当前 v4 | 同上；不自动重派 Builder                              |
| `verify.verifier` | running | 只有当前 v4 | 原 claim 回报成功，sequence 5→6，新确认 Wait 产生     |
| `verify.verifier` | unknown | 只有当前 v4 | 同上；不自动重派 Verifier                             |

四例均另外断言：错误 claimToken 被 `STALE_ACTION` 拒绝；Action ID/attempt/inputHash/claim 完全保留；origin仍为原 v3/hash；既有 Shape 批准原样；重复相同 outcome 不再次激活且只保留一条接受收据。没有注册旧定义/旧executor，没有把 origin改成当前 workflow，也没有转交新平台任务。

因此自动适配器应优先**保留现存业务 Action 和原领取**。若 Native 当前业务 validator 的报告结构与旧模板不同，可在真实结果输入边界归一化已经提交的事实（例如把旧检查摘要转成当前报告结构、丢弃不再执行的计划字段），但不生成原本没有的 pass、验收结论或用户批准。该 SDK 探针不等于所有 Native 历史 output schema 已验证兼容，实施需对业务 validator 做精确字段映射。

## 12. 九个核心文件删除后的最短收口清单

本节针对 `coverage/platform-execution-current-types.log` 的当前错误补查；行号来自本次读取时的未提交工作区，根 Agent 后续编辑可能移动行号。本次只读取源码并使用 TypeScript AST 解析 import/re-export 和函数调用，未运行 tsc、产品测试或执行器。下列“当前调用者”是生产源码的实际 import 来源，而非同名文本匹配。

最短路径是**让 CLI 旧分支先经一次业务转换进入 SDK，再删 Compat 整个执行分支**，而不是逐个为缺失模块补空实现。保留少量共享业务函数，移除它们内部附带的 overlay 更新即可。尤其不要恢复 `NativeCheckPlan`、local-execution 或 checks executor 只为暂时让类型通过。

### 12.1 native-portable-requirements.ts

| 函数及读取时行号                                                                                     | 最短处理                                                                                                                                                                                            | 实际生产调用者                                                                                                              |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `formatNativeDocumentConstraintFindings` `:86–98`                                                    | 保留，文档错误格式化                                                                                                                                                                                | 本文件 `assertNativePortableDocuments` 内部调用                                                                             |
| `validateNativePortableDocuments` `:100–177`                                                         | 保留，正式材料校验                                                                                                                                                                                  | portable-archive `:612`；本文件 assert                                                                                      |
| `assertNativePortableDocuments` `:179–195`                                                           | 保留                                                                                                                                                                                                | sdk-application `:257`；next-command `:645` 是待删 Compat 调用                                                              |
| `assertNativePortableExpectedContinuationLocked` `:214–232`                                          | 保留小型业务状态版本/动作核对                                                                                                                                                                       | **sdk-disassociate-command `:15` 直接调用**；其他是待删 portable 执行包装                                                   |
| `createNativePortableChange` `:234–322`                                                              | 可整删；新建统一 current SDK                                                                                                                                                                        | new-command `:209` 的 `--runtime compat` 分支                                                                               |
| `discoverNativePortableSpecChanges` `:324–395`                                                       | 必须保留                                                                                                                                                                                            | sdk-application `:242`；portable-delta-rebase `:34`                                                                         |
| `readNativePortableAcceptance` `:397–442`                                                            | 必须保留，包括语义批准数据读取                                                                                                                                                                      | sdk-application `:265`；portable-delta-rebase `:113`                                                                        |
| `prepareNativePortableShapeConfirmation` `:444–569`                                                  | 可整删 Compat 磁盘推进包装                                                                                                                                                                          | 只有 next-command `:944`                                                                                                    |
| `recoverNativePortableShapeConfirmationDrift` `:571–585`                                             | 目前仅只读返回 state，已不做恢复；Doctor旧分支删后可删或直接读文档代替                                                                                                                              | doctor-command `:1291/:1647`                                                                                                |
| `syncNativePortableSpecReferences` `:588–776`                                                        | 是业务引用修改，非执行器。若保留该旧公开行为，仅删除其 `:750–760` overlay 重建，保留替换范围/验收不变/写入前置校验；若统一SDK后不再提供旧包装，必须有对应业务入口再删，不应以清理运行器为由静默撤下 | spec-command `:79`；该CLI当前对SDK明确拒绝旧sync，不能假装已有SDK等价实现                                                   |
| `markNativePortableSpecRemoval` `:778–853`                                                           | 旧YAML包装可删，CLI转换后使用已有 `removeNativeSdkCapability`；不要删除实际Spec remove能力                                                                                                          | spec-command `:149`；保留SDK remove-command/remove实现                                                                      |
| `disassociateNativePortableCapability` `:856–894`                                                    | 旧YAML包装可删，CLI转换后使用已有 SDK disassociate                                                                                                                                                  | spec-command `:119`；SDK counterpart独立实现                                                                                |
| `setNativePortableWorkspaceFinish` `:896–953`                                                        | finish是用户选择，应保留该业务行为；当前可最小删除 `:930–943` local读取/保留/重建，留下选择校验、state mutation和报告版本同步。若迁到SDK，需从Run提交，不得直接改其YAML投影                         | archive-command `:434/:475`（Compat）。SDK archive-command当前明确拒绝Compat finish选项；不能直接删掉业务选择而声称行为保留 |
| `returnNativePortableChangeToShape` `:955–985`、`returnNativePortableStateToShapeLocked` `:987–1046` | 可删除Compat包装，SDK revise已有自己的状态和批准流程；如保留纯业务函数，删 `:1036–1044` overlay写入，不能删除撤回Shape批准/验收失效本身                                                             | next-command `:841`；其余仅本文件内部                                                                                       |
| `readNativeApprovedShapeSemanticSnapshot` `:1049–1062`                                               | 目前无外部生产调用，只返回state字段；可留小型只读函数或调用点直接读字段；不能删除字段中的用户批准事实                                                                                               | 无外部调用                                                                                                                  |

**同名陷阱：** SDK/loop 中的 `prepareNativePortableShapeConfirmation` 来自 `native-loop-runtime.ts` 的纯状态函数。它不是 requirements `:444` 的磁盘包装。不能因 SDK 搜到同名调用而保留 requirements 的整段旧调度。

删除上述包装后，本文件 `local-execution-binding`、`local-execution`、`nativeLocalExecutionFile`、`currentBranch`、Compat owner注册等 import 可整批删除。保留的业务函数若仍写入 portable 文档，也只删除附带的 local overlay；不要给旧 overlay 回填假字段。

### 12.2 native-portable-storage.ts

| 函数/常量                                                                                                        | 处理及实际依赖                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NAME_PATTERN` `:29`、`NATIVE_PORTABLE_STATE_FILE` `:31`                                                         | 保留。命名和文档格式仍是SDK投影/导入边界                                                                                                                                                                                                                              |
| `nativePortableChangeDir` `:35–40`、`nativePortableStateFile` `:42–44`                                           | 保留。sdk-create `:118/:170/:237`、sdk-state-store `:385/:506/:639`、SDK transfer/history、Shape、Archive、Delta仍调用                                                                                                                                                |
| `isNativePortableChange` `:50–61`、`readNativePortableChange` `:122–127`                                         | 保留只读文档识别/读取，供一次转换、Entry/Hook与历史观测；它们不创建执行器                                                                                                                                                                                             |
| `portableWorkspace` `:63–70`                                                                                     | 保留，sdk-create `:259` 使用                                                                                                                                                                                                                                          |
| `assertPortableWorkspaceBindingCurrent` `:103–120`                                                               | 保留，sdk-create `:188/:222`、sdk-state-store `:421/:826` 使用；这是工作区/分支业务归属，不是PID探测                                                                                                                                                                  |
| `lateBindPortableCurrentWorkspace` `:84–101`                                                                     | 旧Shape包装移除后无当前SDK直接调用。若自动导入需要补齐旧null分支，可只在已知当前工作区复用；不扫描其他worktrees                                                                                                                                                       |
| `writePortableMutation` `:129–166`                                                                               | **不能整删**：portable-delta-rebase `:131`仍调用。保留CAS/state_version、报告失效处理。其 `:134–151` 撤销离开的真实Verifier任务是业务Action状态，不是检查进程；如已统一SDK，应使用当前Run的相应业务状态更新，避免第二权威                                             |
| `currentBranch` `:72–74`                                                                                         | 当前外部调用全来自将删的旧overlay包装；删完可去掉该冗余包装，不影响平台Git工具                                                                                                                                                                                        |
| `NATIVE_LOCAL_EXECUTION_FILE` `:33`、`nativeLocalExecutionFile` `:46–48`、`readNativePortableRuntime` `:168–197` | 活跃读取/重建接口删除；一次导入如果要保留旧state.json原件，在适配器中读取已知旧路径归档即可，不恢复这些Runtime API。它们当前仅供next/show/status旧分支，另 sdk-create/runtime-ownership/status-discovery把路径存在性当旧格式判定，也应改为业务文档/Run/checkpoint判定 |

本文件删除 `readNativeLocalExecution` 和 `NativeLocalExecutionState` import 即可断开丢失模块；无需让读取函数继续返回假的 `local:null` 来维持旧调度调用链。

### 12.3 native-portable-archive.ts

必须保留五个当前SDK函数：

- `inspectNativePortableArchive` `:584–686`：sdk-archive 当前预检直接调用，检查正式文档、真实验收状态、Delta/Spec冲突、报告与归档路径。
- `applyNativeSdkArchiveSpecs` `:689–749`：sdk-archive 的真实Spec事务提交和恢复调用。
- `inspectNativeSdkArchiveSpecs` `:751–774`：核对已提交Spec，不能改成简单成功。
- `finalizeNativeSdkArchive` `:838–946`：完成归档目录/状态/回执，不重放Spec写入。
- `inspectNativeSdkArchiveFinalization` `:948–986`：sdk-archive、sdk-archive-command、sdk-history共同使用。

这些函数的内部依赖也必须留：`archiveRef`、`archiveDirectory`、`exists`、`readTransaction`、`writeTransaction`、`readOptionalCanonicalSpec`、`applySpecChange`、`assertArchiveReady`、`freezeArchiveSpecChanges`、`assertTransactionState`、`inspectNativePortableDeltaChanges`、`writePortableArchiveReceipt`、`readPortableArchiveReceipt`、`sdkArchiveReceiptFile`，以及对应SDK finalization receipt类型。不要按“Portable”名字整文件删除。

可物理删除的执行/旧流程：

- `assertPortableChecksCompleted` `:572–582`；同时删除 `inspectNativePortableArchive :624–630` 只给非SDK调用者核对local检查的分支及其缺失模块 import。当前SDK明确传state，原本不走该分支。
- `archiveNativePortableChange` `:988–1302` 整段；它只有 archive-command `:739` 和 doctor-command `:1132/:1628` 的Compat调用者。SDK的apply/finalize不是它的调用者。
- 上述入口删后，`findArchivedPortableChange` `:146–173`、`hasNativePortableArchiveRecovery` `:183–191`、`nativePortableArchiveDirectory` `:121–126` 只剩旧CLI使用，可改由当前SDK/历史文档定位器替代后删除。
- `normalizeSerialDecision` `:271–277` 与旧 `serialFirst` 流程只供旧archive入口。`otherPortableCapabilityOwners` `:207–269` 会枚举其他worktrees；当前SDK预检明确 `checkCapabilityOwners:false`，可连该检查分支删除，继续依赖当前SDK真实Spec事务冲突检查。
- `NativePortableArchiveOrderRequiredError` 及 `NativePortableArchiveRequiresReverificationError` 只跟旧CLI循环转Verify/serial决策相关；去掉该CLI后不必留错误壳。
- 删除仅旧入口需要的 `recoverNativeSupervisorFinalVerificationLocked`、`returnNativePortableStateToFinalVerificationLocked`、`finalizeNativeSupervisorDeliveryLocked`、`readNativeSupervisorState`、portable YAML直接CAS、旧selection清理等 import；SDK事务自己的同类能力保留。

旧Archive transaction、workspace finish journal属于已发生业务副作用。自动兼容应将已知journal映射到SDK恢复，不得因为删了 `archiveNativePortableChange` 就当归档没发生或重新写Spec。可以保留journal数据parser，不需要保留其旧受管检查/旧状态机执行器。

### 12.4 Delta 的一个必须保留的小混合函数

`native-portable-transitions.ts` 只有 `returnNativePortableStateToFinalVerificationLocked` `:16–74`，但 **portable-delta-rebase.ts:174 仍调用**。最小修改是：

- 删除 `:26–35` local execution/raw_input_ref 约束、`:36` executionRoot、`:65–74` overlay重建；删除相应import。
- 保留 `:23–25` 已归档/原验收状态约束、`:37–63` recovery历史和业务state回Verify、`:64` CAS提交。
- `native-portable-delta-rebase.ts:29–159` 的实际Delta重合并、原输入校验/rollback、验收范围不变检查仍保留；`:162–182` 的显式业务重合并包装不能因overlay报错直接删除。统一SDK后将其state提交接SDK Run，不恢复第二套执行状态。

### 12.5 native-supervisor-workspace.ts

当前SDK直接需要的只有文件前部五个函数：

| 必留函数                                              | 当前SDK调用者                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `nativeSupervisorIntegrationBranch :57–62`            | sdk-application、sdk-supervisor-prepare/integrate/integration-repair/deliver/cleanup/revision |
| `nativeSupervisorIntegrationWorktree :64–69`          | 上述模块另加sdk-state-store、SDK transfer                                                     |
| `nativeSupervisorChildWorktree :71–83`                | sdk-state-store、sdk-supervisor-archive/child/cleanup/integrate/prepare/revision/transfer     |
| `prepareNativeSupervisorIntegrationWorkspace :85–101` | sdk-supervisor-prepare `:140`                                                                 |
| `prepareNativeSupervisorChildWorkspace :103–125`      | sdk-supervisor-prepare `:231`                                                                 |

后半旧执行闭包可以整体删除：

- `supervisorRetryIds :127–134`、`assertSupervisorRetryableStates :136–158`。
- `refreshNativeSupervisorBuilderWorkspace :160–207`、`assertNativeSupervisorIntegrationWorkspace :209–224`、`assertNativeSupervisorVerifierWorkspace :226–242`：仅旧supervisor-coordinator调用；前两个还被本文件后半旧函数调用。
- **`integrateNativeSupervisorChildWorkspace :251–682` 整函数**：实际外部调用者只有 runner-input `:1488`。不必在它内部逐段挖checkPlan/execute/check receipt；SDK `native-sdk-supervisor-integrate.ts` 已有独立Git集成实现。
- `assertNativeSupervisorTargetUnchanged :688–699` 无外部调用；`refreshNativeSupervisorTarget :701–737` 只给下面旧finalize使用。
- **`finalizeNativeSupervisorDeliveryLocked :739–871` 以及 `finalizeNativeSupervisorDelivery :1052–1061`**：只有portable-archive旧入口调用。SDK deliver/cleanup使用独立实现，并不依赖这套旧finalize。
- 随旧finalize删除内部 `nativeSupervisorCleanupJournalFile :881–886`、`preflightNativeSupervisorCleanup :888–975`、`loadOrPreflightNativeSupervisorCleanup :977–1014`、`executeNativeSupervisorCleanup :1016–1043`、`clearNativeSupervisorCleanupJournal :1045–1050` 及旧cleanup journal类型；这不删除 `native-sdk-supervisor-cleanup.ts` 的当前真实清理。

这样文件只留前125行中业务路径和准备工作区所需import，就能彻底移除该文件对 check-executor/check-binding/supervisor-evidence 的全部依赖，无需重写四百行旧集成执行器。

### 12.6 native-supervisor-model.ts 与旧state/coordinator

当前SDK真正使用的导出是 `supervisorAcceptanceScope :282–290`：sdk-application `:1522`、sdk-supervisor-archive `:255`、sdk-supervisor-child `:114`、sdk-task-command `:102`。它是纯验收项投影，必须保留；可直接留在原文件，减少不必要的跨模块移动。

其余生产调用来自旧Portable调度/只读旧状态：

| 可撤下的旧推进函数                                                                                                                                    | 实际调用者                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `createNativeSupervisorState :229`、`reconcileNativeSupervisorState :293`                                                                             | portable-shape-coordination；旧supervisor-coordinator |
| `projectNativeSupervisorTask :413`                                                                                                                    | next-command和runner-input                            |
| `createNativeSupervisorTask :491`、`reconnectNativeSupervisorTaskWithState :555`、`cancelNativeSupervisorTask :571`、`blockNativeSupervisorTask :610` | runner-input/旧coordinator                            |
| `applyNativeSupervisorBuilderResult :632`、`applyNativeSupervisorVerifierResult :660`、`retryNativeSupervisorBuilder :722`                            | 仅runner-input                                        |
| `integrateNativeSupervisorChild :761`、`stableSupervisorIntegrationOrder :209`                                                                        | 仅旧supervisor-workspace集成函数                      |
| `cloneState :166`、`recordEvent :170`、`assertChildDependenciesIntegrated :178`、`supervisorDependenciesIntegrated :201`                              | 旧coordinator/workspace及Doctor Compat                |
| `markNativeSupervisorChildVerified :363`、`reconnectNativeSupervisorTask :543`                                                                        | 无外部生产调用                                        |

`projectNativeSupervisorChildren :804`、`assertCommit :16`、旧state相关业务interfaces仍被 `native-children.ts` 的旧状态只读展示及 `native-supervisor-state.ts` parser引用。最短处理二选一：暂留只读投影+业务类型但删除 checkExecution 子结构；或让只读状态统一使用自动转换后的SDK投影，再删除整套旧state/coordinator。**不要把这些只读引用错当成当前SDK必须保留旧调度器。**

应物理删除 `NativeSupervisorCheckExecutionState`、`NativeSupervisorTask.checkExecution`（含plans/machineId/fingerprint/activeProcess）、`NativeSupervisorState.integration.checkExecution`，并移除 parser 中相应执行字段解释。原始旧JSON完整保存供迁移取业务事实，没必要把进程执行字段继续放入当前模型。`NativeSupervisorVerificationEvidence.checks/acceptance` 若作为旧业务报告搬运可保留；receiptRef不再授权当前执行。

`native-supervisor-coordinator.ts` 的 dispatch/reconnect/final-verification推进全部只被Compat闭包使用；当前SDK没有调用。`native-children.ts:448` 会在只读children检查里调用 `rebuildNativeSupervisorStateFromFacts`，应先删掉该“读时重建旧执行状态”分支，再删旧coordinator。当前SDK需要的 children contract读取、校验、acceptance scope不受影响。

### 12.7 其余可整删的 Compat 执行文件

CLI经自动业务转换只走SDK后，可一起物理删除以下模块及facade再导出：

- `native-runner-input.ts`：所有 builder/dispatch/checks/retry/Verifier-started/Supervisor Runner执行；SDK平台claim/outcome来自 `native-sdk-task-command.ts`，不依赖它。
- `native-portable-shape-coordination.ts`：`confirmNativePortableShape`，只用于旧直接写YAML推进；SDK Shape批准走当前factory/loop。
- `native-portable-verification.ts`：全部导出，包括 submitBuilder/dispatchVerifier/confirmVerifierStart/submitVerifierResult/recordFailure/unavailable/retry/returnBuild/ensureReport，以及 assertCurrentVerifierAttempt/Envelope/responsePosition；当前SDK使用 loop-runtime 和 sdk-report，没有生产调用这些函数。
- `native-portable-verifier-coordination.ts`：旧Skill pass确认；新SDK确认在当前Run中执行。
- `native-portable-recovery.ts`：`recoverNativePortableChange` 只有next/archive/doctor Compat调用；其中 `nativePortableWorkspaceMismatch` 也只有Compat next使用，当前SDK有独立workspace绑定检查。
- `native-portable-coordination.ts`：inspectParentReadiness/tryAutoAdvanceV1Parent/recoverFinalVerificationLocked/OnResume，全部只有旧next/archive/Runner/Portable verifier调用。
- `native-portable-migration-runtime.ts`：会重建local execution并重置业务状态，替换为第11节一次数据适配，不保留旧执行“迁移后再运行”。

`native-portable-status.ts` **不能整删**：`projectNativePortableWorkspace :265–294` 被 sdk-status `:134` 和status-discovery调用，是当前业务workspace投影。保留它及所需类型/纯helper；`projectNativeArchivedStatus :296` 可保留纯历史观测。`inspectNativePortableStatus :464` 和list函数应改由当前SDK/业务导入视图，不再调用 `readNativePortableRuntime` 或推断Verifier/检查进程；Entry project-status/resume-probe和status-discovery是外部调用者，必须一起收口。

### 12.8 CLI 的具体切断点

| 文件                                             | 必留                                                                                                                             | 可以删除/替换的旧分支                                                                                                                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `native-next-command.ts`                         | `nativeNextCommand`、参数边界、SDK task执行/用户决定、`expectedContinuationOption :88`（SDK也使用）                              | 自动导入后保留 `:184–447` 中SDK分支，删 `:448–974` Compat执行；删 `portableParentView :111`、compactRunnerResult `:163`、compactRecoveryResult `:176`、旧workspaceMismatchResult `:975`。Runner请求只做一次数据/结果适配，不再调用Runner执行函数 |
| `native-new-command.ts`                          | 工作区准备、语言/capability/brief初始化和 `createNativeSdkChange`                                                                | `--runtime compat` 创建分支 `:158–164/:198–215`；旧参数可自动映射sdk以照顾历史脚本，不生成local state                                                                                                                                            |
| `native-show-command.ts`                         | 材料读取 helper `portableShowResult :33` 中brief/Spec内容、SDK continuation；当前SDK show路径                                    | 去掉helper的local参数和 `:69–84` 旧continuation/checkPlan回填；导入旧文档后进入同SDK路径；不再readNativePortableRuntime                                                                                                                          |
| `native-status-command.ts`                       | SDK状态输出、已知文档/归档发现、分页                                                                                             | 它本身不直接管理进程，重点删status-discovery/portable-status下游local读取；不能为修types去掉所有旧记录可见性                                                                                                                                     |
| `native-spec-command.ts`                         | SDK remove/disassociate；正式材料操作与状态版本校验                                                                              | 旧markRemoval/disassociate直接写YAML、legacy migrate→Compat执行路径删除，先自动转SDK；sync能力另见12.1，不以清执行器为由随手删业务                                                                                                               |
| `native-cancel-command.ts`                       | SDK业务cancel、保留代码、Archive事务未结束时的真实阻塞、选择清理                                                                 | 删除check-executions/reconcileStops、activeExecutions和managed-stop指引；当前业务running/unknown任务事实不能因清理运行器改成已成功或已停止                                                                                                       |
| `native-doctor-command.ts`                       | 当前SDK读/恢复、业务文件锁、Run投影/checkpoint修复、Archive事务/finalization、workspace finish journal诊断、当前选择/owner一致性 | 删除portableCheckExecutionFinding `:137`、SDK检查对账/stop文件、所有local overlay恢复、旧Supervisor tasks/依赖“读时修复”。旧文档先单次数据转换，不走recoverNativePortableChange。不要为了编译删Archive journal和受保护文件锁                     |
| `native-archive-command.ts`                      | 解析业务archive请求后调用现有 `archiveNativeSdkChange`，旧归档数据/finish journal恢复需适配当前业务恢复                          | 先统一owner/业务转换，再删 `archiveNativePortableChange`、旧serial能力安排、旧supervisor automatic parent、local复验循环等Compat分支；workspace finish选择/merge/push/PR以及已发生Git副作用的恢复不能消失                                        |
| `native-root-command.ts`                         | 整个show/move业务入口；无检查执行依赖                                                                                            | 不需要为本次执行清理删除它，root move仍要保护业务文件事务                                                                                                                                                                                        |
| `native-transfer-command.ts`、select、hook-guard | 当前业务owner/选择、固定工作区/contract/候选和已知路径的转移校验                                                                 | 只移除旧check execution/overlay附加事实，不移除真正worktree/commit/业务材料绑定；无worktree扫描迁移                                                                                                                                              |

### 12.9 推荐一次完成的顺序

1. 先完成一个旧业务→当前SDK适配器，并让next/show/spec/archive/doctor等已知需求入口调用它；保留原Run/文档和原批准。
2. 删除next/Runner/Portable verifier/旧supervisor调度这整圈入口和再导出，避免每个混合文件继续被迫解释旧检查。
3. 按上表把requirements/storage/archive/workspace缩至真实共享业务函数；portable-transitions去overlay但保留Delta业务；status保留workspace/历史投影。
4. 当前SDK模块逐项去掉缺失执行模块的import、观察类型、stop/recovery分支；旧历史Action数据由适配器保留，不需要重新恢复这些类型/执行器。
5. 最后按剩余实际调用删除旧model/state/coordinator和架构许可。此时再运行最小类型检查，剩余错误应集中于真实业务边界，而不是靠any/空执行器遮住闭包。

本节未执行类型检查或产品测试，也没有修改上述产品文件；只补充当前源码的函数/调用者证据。

## 13. npm 0.5.2 发布产物的真实前沿数据

### 来源与隔离边界

实际读取并使用的发布包：

```text
C:/Users/BENYM/AppData/Local/Temp/comet-052-cli-package-626acda290b5479fb72b05334de5c0e5/package
package.json version = 0.5.2
```

使用该包的 `dist/domains/comet-native/native-sdk-application.js`、`native-portable-state.js`、`native-config.js`、`native-paths.js` 和 `dist/domains/engine/runtime.js`；未使用当前产品 `upgradeNativeRun` 生成基线。0.5.2 factory实际只接受 workflow version 1/2/3，未包含v4定义。

诊断脚本为 `coverage/native-052-published-data-probe.mjs`。它在独立Temp创建正式材料和独立 COMET_DATA_DIR，使用真实发布包 factory/validators/state validators/transition handler/SDK协议，runtime的 `executors: []`。没有调用 `runtime.execute/runUntilBlocked` 或任何检查执行器，没有命令计划（Builder的 `verificationChecks: []`）。

所有 Agent 候选报告、用户批准以及检查 Action 的“仅claim、不执行”请求均明确标注为模拟。Shape输出由真实包的 `collectNativeSdkShapeProposal` 读取实际隔离材料得到，随后通过真实 validator提交；用户批准必须先有真实SDK创建的 pending Wait，使用其 proposalHash `resolveWait`，没有修改状态绕过批准。

额外把本进程 `child_process` 的 spawn/exec/fork及同步变体全部替换为抛错函数，再 `syncBuiltinESMExports()`。本轮记录9次被拦截的Git元数据尝试，**0个子进程启动**；没有监管进程、PID探测、模型或Eval。Git只读探测被拒后的非Git路径仍能完成这三个版本的数据协议。

### 生成的实际JSON

所有文件位于：

```text
C:/Users/BENYM/AppData/Local/Temp/comet-052-native-business-data-tz7Oxy/
  summary.json
  protocol-requests.json
  v1-shape-revalidate-pending.json
  v1-verify-checks-pending.json
  v1-verify-checks-claimed-not-executed.json
  v2-shape-revalidate-pending.json
  v2-verify-checks-pending.json
  v2-verify-checks-claimed-not-executed.json
  v3-shape-revalidate-pending.json
  v3-verify-checks-pending.json
  v3-verify-checks-claimed-not-executed.json
```

单个fixture结构是 `{provenance, run, frontier}`，其中 **`.run` 是原发布SDK生成的完整Run**；外层provenance不是产品协议字段。`protocol-requests.json`逐次保留实际SDK请求及模拟角色标记。每个版本的独立项目位于同目录 `project-v1/2/3`，COMET_DATA_DIR为 `data/`。

9份Run均由公开SDK正常推进和真实发布Native validator生成，未修改Action、Wait、state以创建所需前沿。最后“claimed-not-executed”只证明已登记领取；不能将该名字/模拟provenance当成生产上原进程已停止的证据。

### 实际观察：三个版本的状态相同，但不能靠阶段猜是否批准

| 实际SDK前沿（v1/v2/v3均如此）     | 业务state                                                               | loop                                                                                              | 原批准/待办                                                                |
| --------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `shape.revalidate` pending        | phase=shape，status=await-user，state_version=2                         | stage=await-user，iteration=0，attempt=0，next_action=confirm-shape                               | `shape.confirm` 已resolved/approved；`shape.revalidate` 已是pending Action |
| Builder后 `verify.checks` pending | phase=verify，status=active，state_version=4，当前builder_handoff已存在 | stage=verify-ready，iteration=1，attempt=0，next_action=run-required-checks-and-dispatch-verifier | 原Shape批准保留；Builder成功报告已接受；checks尚未领取                     |
| `verify.checks` claimed，不执行   | 与上一行业务state完全相同                                               | 与上一行完全相同                                                                                  | checks Action变running并保存claim；没有outcome、executionStop或实际进程    |

三类前沿的 `run.ready` **均为空**：SDK已把token调度成Action。适配器不能只扫描ready判断有没有旧步骤。

每个Run序号均为：`shape.prepare :1`、Shape批准Wait `:2`、`shape.revalidate :3`、`build.builder :4`、`verify.checks :5`（到达相应前沿时才出现后续项）。`actionContexts` 中仍保留原上游结果；原Shape Wait的decision id/proposalHash必须原样保留。

### 迁移必须读取/保留的字段

- `workflow.version/hash` 与 `definitionHashes`：三个旧定义不同，不需要旧factory才能读取数据，但要知道它尚未是当前图。
- 原Shape resolved Wait：`id/sequence/stepId/decision.choice/decision.proposalHash`；`shape.prepare` 的真实成功 `outcome.output` 中 `acceptance/specChanges/formalHash/semanticSnapshot/shapeConfirmationHash/children`。
- `state.shape_confirmation_hash`、语义快照与acceptance：shape.revalidate待办时虽然已经批准，state仍在Shape，迁移要应用原批准对应的当前**纯业务确认**，不能重新问用户，也不能只改ready。
- 成功Builder Action的id/claim/attempt/inputHash/outcome、`state.builder_handoff.candidate_id/builder_execution_ref/iteration`。**不要再次调用Builder候选生成函数**；此时候选已经存在。
- checks待办时 `state.loop.attempt=0`、next_action仍是 `run-required-checks-and-dispatch-verifier`。跳过旧受管检查后，用当前 `reserveNativeVerifierAttempt` 等纯状态路径把原候选预留到Verifier（attempt=1、await-verifier-result），不能直接创建Verifier Action但保留旧loop状态。
- 检查已claim时保留原claim和完整旧Action，仅取消该旧检查的调度；没有任何理由生成停止/成功回执。不能覆盖原Builder和Shape记录。

### 尚未实际到达的前沿及发布源码结论

**`verify.report` 和 `verify.revalidate` 未作为实际Run生成。** 发布Native的 `verifierResultState` 强制要求当前成功 `verify.checks` outcome；发布检查validator又要求输入/检查执行证据。为了得到后续前沿而伪造成功收据会混淆证据，因此脚本在原checks领取后停止，并在summary明确 `NOT_REACHED`。本轮没有执行旧runner，也没有让空检查执行器偷偷经过这些步骤。

仅从真实发布源码可以确定：

- `native-sdk-application.js:1218/:1234`：v1/v2 Verifier成功后经过 `verify.report`；v3普通流程直接进入 `verify.confirm`，不能要求v3一定存在report Action。
- `native-loop-runtime.js:273–301`：Skill协调的Verifier通过后，业务state保持 verify/await-user/pass，next_action=`confirm-skill-coordinated-pass`。
- `native-sdk-application.js:2181–2185`：旧report成功只创建确认Wait，不改变上述state。
- `native-sdk-application.js:2218–2224`：v1/v2以及带children的v3，在原 `verify.confirm` approved后仍保持原业务state，只调度 `verify.revalidate`；普通v3则已应用业务接受并直接archive.prepare。
- `native-sdk-application.js:2309`：旧revalidate成功才调用 `confirmNativeSkillCoordinatedPass`。因此**迁移已批准的旧verify.revalidate前沿还需应用业务接受状态**，不能只把下一个节点改为archive.prepare，也不能重复请求同一批准。

最后两条是源码证据，不是实际后续Run已运行的证据。后续若要补真实更晚的发布Run样本，仍必须取得合法旧检查结果来源；这份数据探针没有也不制造该来源。

## 14. 当前 upgradeNativeRun 与固定扩展的只读复核

本节读取已落地但仍在编辑中的 `native-sdk-run-upgrade.ts`，未修改产品/测试、未运行测试。现有9份发布样本覆盖的是单任务普通流程，不能证明并行Child、修复Wait、固定扩展和已批准revalidate均已完成兼容。

### 必须修正的具体接续缺口

1. **全局active/latest会丢并行分支。** `native-sdk-run-upgrade.ts:37–39` 只有没有任何active时才恢复，且只取一个最新成功业务Action。两Child旧checks均pending时只恢复最后一个；另一个Child仍running时，已被撤销旧checks的Child一个也不恢复。应逐个退役前沿按当前轮contract/child/candidate找到真实业务前驱，独立补齐其后继；保留其他Child的running/unknown，不重新派发已有同前沿后继。不要用全局最后一个Builder代表全部Child。
2. **手写child激活缺字段。** `:55–57` 只复制Builder原input.activation并加builderActionId，而当前真实 handler（`native-sdk-application.ts:1227–1255`）会从Builder outcome补candidateCommit、从claim补builderSessionId、从本轮contract补acceptance并传checks报告。当前Child Verifier validator要求这些字段。集成后升级则写了integrationActionId，而真实归档activation需要mergeActionId、integrationCommit及contractRef（`:1388–1394`，`native-sdk-supervisor-archive.ts:89–98/:142–156`）。最小修复是使用当前handler对原真实成功Action的纯 `action-outcome` 计算next/activation，避免手写近似模板；不得执行该Action或重写原outcome。
3. **旧Supervisor hash不能直接改名为ref。** portable-state parser把children_contract_hash当children_contract_ref别名，但旧值仍是hash；当前handler按该ref寻找真实Shape Action（如`:1234`）。需要从该前沿原results/批准Wait找到本轮已批准Shape来源，建立实际Action ID和原children contract。只改字段名会导致有active Child时读不到计划；原Action输入/claim不应随之改写。
4. **已批准revalidate补业务状态的方向正确，但要绑定原来源。** 当前 `:43–49` 已对Shape/Verify原批准调用纯handler，能解决“有批准但state未进下一阶段”。不要从全历史中取任意最近approved Wait：应匹配待退役Action上下文中的批准sequence/proposal和当前候选。普通v3已在archive时不应再次接受；v1/v2旧verify.revalidate待办需要接受后的state，保留原批准。
5. **旧等待不能直接取消后自动派Verifier。** 当前`:25–28`取消已撤Wait后，`:50–57`可能退回成功Builder并继续Verifier；这会绕过原checks-stop上等待的用户repair选择，也没有把fail/await-user业务状态转换为新Verifier状态。按第15节保留等待并映射业务步骤。
6. **旧command ledger仍需收口。** 当前适配器没有处理commands。原refresh-checks command指向保留的旧Action，但当前定义已无此command，SDK inspect会拒绝（`runtime-service.ts:609–620`）。完整原ledger保存到原记录副本，当前ledger只保留仍存在的业务command；不恢复旧command执行能力。

### 固定扩展锚点的最小改法

`native-application.ts:68–72` 的CHECKS仍全部指向已删除步骤。应改为四个真实业务来源：candidate=`build.builder`、parent=`supervisor.parent.builder`、child=`supervisor.child.builder`、integration=`supervisor.child.integrate`。

这不仅是改四个字符串：

- `sourceFor :89–129` 的candidate/parent ID来自原Builder Action+outcome的现有候选规则；child候选来自Builder outcome.candidateCommit；integration候选来自merge outcome.integrationCommit。不要继续要求所有outcome都有candidateId。
- source.activation保留真实工作区/Child/contract/commit；formalHash改从该Action上下文中本轮Shape来源取得，不能继续全局读取旧shape.revalidate output。
- `:308–312/:431–452` 继续把扩展串在对应业务成功事件上。业务结果只能应用一次：若扩展前暂不提交base业务转移，最后扩展通过再调用base；若扩展前已应用base，则最后只恢复保存的next，不能再执行一次Builder状态提交/候选生成。
- `validateOutcome :548–600` 不能再按checkActionId推断child并查找原checks，应按真实业务来源Action ID和当前scope绑定；多个Child逆序回报仍需精确匹配，不拿另一个Child的通过代替。
- 旧扩展Action已有claim时，原inputHash和reviewSource不可直接改写。可把旧checks来源视为只读历史，沿其原context解析真实Builder/merge来源，核对其候选/批准与当前业务来源等价后继续原claim；不能为适配新锚点取消并重派已运行扩展。旧bindingHash代表的原reviewSource也需保留对应关系，不能把未通过扩展当已通过。

### 物理删除 native-sdk-definition.ts 的剩余调用点

生产还剩五处import：`native-application.ts`、`native-sdk-application.ts`、`native-sdk-history.ts`、`native-sdk-continuation.ts`、`native-sdk-supervisor-transfer.ts`。

- application删除 `:474–482` 的旧定义fallback和相关Before/Legacy handler imports，采用当前业务图加一次数据转换。
- supervisor-transfer删除 `:630–653` 的旧定义重建分支；对已校验旧转移Run先调用同一纯适配器，再在只有当前定义的memory store inspect。不应先按旧hash要求当前factory匹配，也不应恢复旧factory。
- `nativeSdkMatchesRun` 只是当前定义精确比较，可保留该小函数于当前application/数据适配器已有模块，供application/history使用；不为它保留整份旧定义合成器。
- continuation的 `nativeSdkRecoverableFailureReason` 只保留当前实际业务失败（Archive/当前Verifier等）的判断；已删除checks/revalidate失败由适配器转业务状态，不再作为当前执行恢复步骤。
- 再删除该文件、架构登记和历史可执行定义测试。旧fixture数据继续用于自动升级测试，不改成新定义冒充兼容。

### 当前已经存在的精确测试选择器（未执行）

直接覆盖本轮普通自动升级基线：

```text
npx vitest run test/domains/comet-native/native-published-business-upgrade.test.ts -t "automatically resumes published"
npx vitest run test/domains/engine/runtime-business-upgrade.test.ts -t "automatically imports native history, approvals and live business claims"
```

这些现有测试不含双Child/checks-stop/已批准verify.revalidate，不应拿它们通过代替缺失场景。现有业务回归可用以下精确selector保留对应断言；涉及旧factory/检查执行fixture的测试需先按本次功能撤下规则迁移fixture，不能直接降低断言：

```text
npx vitest run test/domains/comet-native/native-application.test.ts -t "binds reverse Child reviews, repairs integration in its worktree, and reviews the parent candidate"
npx vitest run test/domains/comet-native/native-application.test.ts -t "does not discard an unknown Child when another review requires Shape revision"
npx vitest run test/domains/comet-native/native-application.test.ts -t "rejects fake loaded/pass evidence and stale artifacts while preserving the claimed Action"
npx vitest run test/domains/comet-native/native-sdk-supervisor-verifier-recovery.test.ts -t "preserves a sibling ready token after the original running Builder truthfully reports failure"
npx vitest run test/domains/comet-native/native-sdk-supervisor-verifier-recovery.test.ts -t "creates one recovery Wait per original failed Verifier when both independent children failed"
npx vitest run test/domains/comet-native/native-agent-checks.test.ts -t "waits for user acceptance and rejects another session reporting the original task"
```

## 15. 旧 checks-stop 用户等待的最小业务映射

### 原Wait的真实契约

0.5.2发布包 `native-sdk-application.js:961–969/:1071–1075`：

| 旧step                                     | choices      | 原proposalFrom                        |
| ------------------------------------------ | ------------ | ------------------------------------- |
| `verify.checks-stop`                       | `['repair']` | `verify.checks`                       |
| `supervisor.child.checks-stop`             | `['repair']` | `supervisor.child.checks`             |
| `supervisor.child.integration-checks-stop` | `['repair']` | `supervisor.child.integration-checks` |

SDK scheduler的proposal是 `{input, outputs:{[原proposalFrom]: 原真实结果}, activation}`。根verify stop activation含failedCheckActionId；Child stop activation是原已验证Builder上下文加failedCheckActionId；integration stop是原integration-check Action activation加failedCheckActionId。发布handler `:1502–1536/:2084–2118` 均要求该原check确为failed并与原activation一致，只在用户repair后继续Child Builder、integration-repair或根Builder。

### 可以只改pending Wait的stepId

可以映射：根 `verify.checks-stop → verify.stop`，两个Child stop映射 `supervisor.child.verifier-retry`。保持**id、proposalHash、proposal、choices、sequence、results完全不变**，也不写decision。SDK普通Wait校验其自身proposalHash/决定一致性（workflow-run-validation `:170–252`），不要求已保存proposal必须重建成当前step.proposalFrom；因此旧proposal中的check输出可以作为只读历史保留。

此映射只适用于尚未决定的Wait，不能改名已resolved历史Wait，否则历史results来源stepId会变。当前新factory不新增旧checks-stop，也不重新接受command计划。

### 还必须补齐三个业务路径

1. 根 `verify.stop` 的repair分支目前强制找成功Verifier（`native-sdk-application.ts:1656–1660`），旧checks失败时可能根本没创建Verifier。对 `wait.proposal.activation.failedCheckActionId` 增加窄分支：核对原Action为verify.checks/requested-checks真实failed、原候选/Shape/Wait绑定仍匹配；使用原Builder来源构造新Builder修复输入，保留failedCheckActionId及失败说明。不得伪造成功或失败Verifier。用户选择repair后才正常 `returnNativeCandidateToBuild` 并推进。
2. Child `verifier-retry` 目前强制 `failedVerifierActionId`（`:1282–1304`），helper `native-sdk-supervisor-verifier-recovery.ts:37–47` 和SDK next `:175–183` 同样如此。应识别原failedCheckActionId来源：child-check失败仍repair到该Child Builder；integration-check失败repair到该Child **integration-repair**，保留原merge/worktree/candidate/contract，不回退成另一个Child或重新合入。
3. 当前定义需要声明 `supervisor.child.verifier-retry → supervisor.child.integration-repair` 的repair业务边（现有仅repair→child.builder）。这是已有当前业务步骤之间的一条修复边，不是恢复旧检查步骤。handler只在已映射的原integration-check失败Wait上选这条边。

`nativeSdkChildVerifierRetryWaits` 可扩展为识别这两种具体旧失败来源，但不应让任意call_tool失败冒充Verifier失败。SDK next只有用户选择retry时才需要真正failedVerifier并运行其独立验收校验；旧Wait的choices只有repair，不能向它提供retry。

当前continuation `:812–824` 无条件列出retry-verifier和revise-implementation两选项，映射后应按**原Wait.choices**过滤。旧repair-only Wait只展示revise-implementation，不新增用户从未拥有的重跑检查选项；错误信息应说明是旧检查失败后的实现/集成修复，不能仍说“Child Verifier失败”。

### 不涉及停止证明

上述转换只保留原失败事实及尚未作出的业务决定，不代表检查进程已停止。原checks Action的claim/outcome/interruption与原始副本不改；unknown不能写成failed、passed或已停止。原未决Wait不会自动解决。用户repair授权的是业务修复，当前Agent按平台实际任务状态继续工作，CLI不探PID、不启动或重试旧检查，也不生成cancellation/executionStop。

可复用历史测试的**用户等待行为** selector 是 `native-sdk-application.test.ts` 的 `keeps an interrupted Runtime check stopped until a proposal-bound repair decision`；应把fixture改为真实旧Wait导入并通过当前业务repair，而非重新运行已删除的检查执行器。新增迁移断言应验证映射前后上述7个Wait字段逐字不变、未决定不推进、错误proposal拒绝、repair后只产生正确业务任务、原失败/unknown记录不被改成成功或停止，且其他Child继续保留。

## 16. 真实 0.5.2 Supervisor 并行前沿与失败等待样本

本次根据追加授权，在独立 Temp Git 项目中使用真实 0.5.2 Factory、状态函数、validator、Supervisor 工作区准备器及 SDK 协议生成样本。Agent Builder 报告和 User Shape 批准明确标为 **SIMULATED**。仅选择执行两次无副作用的 `node -e "process.exit(1)"` 检查，均真实退出 1；没有运行模型、Eval、真实实现命令、成功检查或伪造停止收据。脚本为忽略的诊断文件 `coverage/native-052-supervisor-data-probe.mjs`，不修改产品/测试。

样本目录：`C:/Users/BENYM/AppData/Local/Temp/comet-052-supervisor-upgrade-IZ8VtH/`。每份 JSON 的 `run` 为真实发布 SDK Run；`provenance` 记录包位置和模拟范围。完整请求日志为同目录 `protocol-requests.json`。

| 文件                                                   | 实际前沿及用途                                                                                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v3-child-checks-pending-sibling-builder-running.json` | `published-supervisor:9` 是 api checks pending；`:8` 是 ui Builder running，保留原 claim、inputHash、session。验证迁移 api 后 ui 原任务仍能使用同 claim 回报。                                                                   |
| `v3-two-child-checks-pending.json`                     | api `:9` 和 ui `:10` checks 同时 pending，来源 Builder 分别 `:7/:8`。验证迁移为两个独立 Verifier，不丢分支、不串候选。                                                                                                           |
| `v3-child-checks-failed.json`                          | api `:9` 检查真实退出 1；ui `:10` checks 仍 pending，api 自然派发新的 Child Builder。此样本**没有** Child checks-stop Wait。                                                                                                     |
| `v3-root-checks-stop-pending.json`                     | 普通 v3 Run 设置合法 `maxVerifyFailures=1`；checks `published-root-stop:5` 真实退出 1，原 SDK 自然生成 `verify.checks-stop` Wait `:6`，choices 仅 `repair`，activation.failedCheckActionId 指向 `:5`。该 Run 从未创建 Verifier。 |

普通 Child 检查失败不会产生 Child checks-stop：发布 `native-sdk-application.js:1539–1553` 仅在真实失败输出具有 `interruption` 时派发它，普通失败直接回 Builder。此次没有制造 interruption，也没有把普通失败改成中断；Child/integration stop 原始样本仍未到达，不能声称已覆盖。

根 stop 样本最少应覆盖：导入后原 Wait 仅 stepId 映射、其余字段不变；未决定仍等待；错误 proposal 拒绝；原 repair 决定可推进一个 Builder，且无需虚构不存在的 Verifier；原失败检查仍失败、无新 stop/成功收据。

### 旧活跃 Child 的 contract 只读映射

当前 `native-children-contract.ts:404–409` 的 helper 只返回 `contractRef ?? contractHash`；`native-sdk-supervisor-child.ts:39/:93` 随后与已迁移 state 的 Shape Action ID 比较。因此保留原 input/claim 的旧 Builder/Verifier 会遭拒绝，不能靠改写原 Action activation 解决。

真实 ui Builder `published-supervisor:8` 数据提供无需新 hash 的来源链：

1. `input.activation.contractHash` 是 `1b9983ddb3f54568fb94cc9212cca3b175ed0113029c70c5c92e9e34fc9a3aed`。
2. 同 Action 的 `actionContexts[id].results['supervisor.prepare'].value.contractHash` 是同值；其 sequence 为 4，可定位原真实成功 prepare Action。
3. 同 context 的 `results['shape.prepare'].sequence=1`，可定位真实成功 Shape Action `published-supervisor:1`；它正是当前 state 应保存的 `children_contract_ref`。
4. Shape 输出 `children.hash=132c5a45e05851832f72627fbae86afec87d8537bb5f659af12715144f04644d` 与 activation.contractHash **不同**。不能直接拿 children.hash 作映射。

最小实现是给既有 contract helper 增加可选的 Run/原 Action context：新值直接读 contractRef；旧值仅当其原 context 中的 supervisor.prepare 原结果 contractHash 相等，并且 context 中 Shape sequence 定位到当前 state.children_contract_ref 对应成功 Action 时返回该 Action ID。保留原 activation、inputHash、claim、outcome；不加载旧 definition、不重算旧 hash。原 Action context 的来源绑定同时防止把另轮 Shape 的旧任务当成本轮任务。

需要该上下文的调用者已在 `native-sdk-supervisor-child.ts`（Builder/Verifier）、`native-sdk-supervisor-prepare.ts`（Child prepare）、`native-sdk-supervisor-integrate.ts`、`native-sdk-supervisor-archive.ts`、`native-sdk-supervisor-deliver.ts`、`native-sdk-supervisor-cleanup.ts`、`native-sdk-supervisor-verifier-recovery.ts` 和 `native-sdk-application.ts` 使用 helper；纯 activation 解析可继续保留原字段，不要在解析时擅自更改原绑定。至少用 running ui Builder 实样本证明同 claim 回报被当前 validator 接受，并增加旧 Shape context 不匹配仍拒绝的反例。

本轮实际执行的是上述发布包数据探针与文档格式检查；未执行产品测试、全量测试、build、平台 Hook 或 Eval。当前迁移源码仍由主 Agent 实施，本节不宣称迁移验证已经通过。

## 17. Snapshot 捕获闭包的物理删除范围（2026-11-11）

本节仅依据当前源码只读核对，不新增探针，不编辑产品或测试。结论是 **自动业务数据导入、既有 Archive 事务恢复、root-move 恢复均不需要 `native-snapshot.ts`**。该文件可以在解除下述旧调用后整体删除，无需保留 Git 子进程、PID 终止、baseline/current 捕获、物理遍历或投影扫描。

### 直接删除旧执行及其调用

| 文件                         | 可删除部分与实际调用关系                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-change.ts`           | 删除 `createNativeChange`/`createNativeChangeLocked`（146–307），没有生产调用者；仅取消 index export 并未移除其内部 Snapshot 引用。删除 `assertNativeVerificationProtocolBinding`（367–376）及 `inspectNativeChange` 对它的调用，该函数仅为读 baseline 后重复检查已由 state parser 校验的 `legacy-v1`。 |
| `native-schema-migration.ts` | 整模块旧 v1→v2→v3 执行迁移可删。`ensureMigrationBaseline`（560–589）会扫描当前项目、补造 baseline，并非旧数据读取。其执行入口 `migrateNativeChange`（1093）唯一生产调用在旧 `native-doctor.ts:684`。当前 Portable 导入不经过它。                                                                        |
| `native-doctor.ts`           | 整模块可删；`doctorNativeProject`（855）无生产调用者，只有 `index.ts:30` 的公开转发。当前 CLI 使用 `native-doctor-command.ts`，直接导入 Portable 迁移、锁诊断和 root-move 恢复。                                                                                                                        |
| `native-guards.ts`           | 整模块可删，`inspectNativeGuard`（76）无生产调用者，仅 `index.ts:35` 转发。里面 baseline/filter 扫描属于已删除旧阶段执行。当前 Hook Guard 是另一个模块，不能混删。                                                                                                                                      |
| `native-diagnostics.ts`      | 保留状态投影/发现接口；只删 `statusFindings` 的 baseline 读取和 `filterNativeContentSnapshotToProjectScope` 分支（87–120）及对应 imports。`native-status-discovery.ts:732/:926`、Entry `project-status.ts:171`、`resume-probe.ts:783` 仍实际使用该模块。                                                |
| `native-snapshot.ts`         | 上述依赖及下述纯 parser 拖入链解除后整删。`filterNativeContentSnapshotToProjectScope`（2210）并非纯历史 reader：它重新运行 Git selection/check-ignore/final fence，所以不能以“兼容读取”名义留下。`createNativeCurrentContentSnapshot`（3359）已经没有生产调用者。                                       |

`index.ts` 同步删除 `native-doctor`、`native-guards`、`native-schema-migration` 转发及 Snapshot 三个 reader/health 导出（57–61）。不是保留一份隐藏旧定义来维持编译。

### 最小必须保留的数据读取边界

1. **旧 change 文档**：`native-change-model.ts` 的 `parseLegacyNativeChangeValue`、`parseV2NativeChangeValue`、`parseNativeChangeValue`、`inspectNativeChangeValue`；`native-change.ts` 的 `nativeChangeDir`、`readChangeDocumentFile`、`inspectNativeChangeStateDocument`。`native-portable-migration-runtime.ts` 的 `inspectLegacyState` 正在使用它们；该路径明确不读取 baseline/trajectory/scope receipt。旧 state 的 `implementation_scope` / `verification_evidence` 只按引用字符串解析（`native-change-model.ts:333–340`），不要求打开对应证据。
2. **既有 Archive 状态**：保留 `readNativeChange`、`readNativeChangeFile`、`writeNativeChangeFile` 及仍实际使用的 CAS、workspace 绑定；`native-archive.ts:261` 在已有 v2 事务移动前检查原业务状态，`:119–123` 在已归档目录读取状态。无需 baseline。既有 `readNativeTransaction` / `readNativeArchiveTransactionV2`、事务事件和受保护文件身份核对继续保留。
3. **已发生 root-move**：保留 `readRootMoveJournal`、`readCleanupManifest`、`parseCleanupManifest`、`assertCleanupManifestMatch`、`walkTree` / `assertEquivalentTrees` 和精确清理子集逻辑。它们只围绕显式 `pending_root_move` / 原 journal 的源、目标、staging 与 cleanup manifest，核对需要继续或回滚的实际文件；没有导入 `native-snapshot.ts`。其名为 `snapshot` 的局部变量来自 protected-file 的文件字节身份，不能因同名删除。config 中原 `snapshot` 设置的透传不是捕获执行，也不是保留整个 Snapshot 模块的理由。

`native-portable-migration.ts:142–149` 已说明其输出不受缺失 Snapshot、旧证据或 Runtime 记录影响。自动 Portable 数据导入没有理由先完成 `ensureMigrationBaseline`。

### 解除 scope/evidence 的纯 parser 拖入链

`native-verification-scope.ts` 的 Snapshot parser 调用仍会把整模块拖进来；实际链为：

```text
native-transition-journal.ts
  → native-repair-runtime.ts（仅 parseNativeRepairTrajectoryProjection/type）
  → native-verification-evidence.ts / native-verification-scope.ts
  → native-snapshot.ts
```

`native-transition-journal.ts:27/:255` 只需读取原 WAL eventData 的修复投影。将 `native-repair-runtime.ts:319–375` 的该 reader、其投影类型及小型字段校验收进原 transition journal 或既有纯模型即可；保留旧/新字段集合、原 disposition、失败 ID、已保存 hash 文本的合法性校验，不重新计算签名、不重建 scope、不运行修复预算。原 eventData 是已经写入的事务历史，不能因删除执行器而静默删掉它的字段或降低断言。

这样可物理删除以下独立模块：`native-verification-scope.ts`、`native-verification-evidence.ts`、`native-repair-runtime.ts`、`native-repair-stagnation.ts`。`native-git-provenance.ts`、`native-conflict-radar.ts`、`native-evidence-command.ts` 当前无生产调用者，也可连同旧 scope 执行闭包删除。

`native-archive-preflight.ts` 的 `buildNativeArchivePreflight` 也无生产调用；只被 `native-runtime-errors.ts` 的 `NativeArchivePreflightError` 类型和 CLI 错误分支拖住。删除该无 throw 来源错误类、`native-cli-shared.ts:323` 分支、`native-archive.ts` 残留 import/export 后可删模块。`NativeBaselineIncompleteError` 同理，仅旧创建/旧 schema migrator 会 throw；删除这两个入口后删其类、`native-cli-shared.ts:364` 分支和残留转发。

### 仓库调用与检查限制

`scripts/benchmark/workflow-scale-benchmark.mjs:130/:193–215` 仍直接导入并执行旧 Snapshot capture/incremental capture。删除产品 API 时同时删除该 benchmark 的旧场景及对应产物引用；不要为了这项旧基准保留捕获器。历史 benchmark JSON 是结果证据，未必需要改写。

本节只列实际生产依赖和删除条件。旧测试/registry 的来源与行为映射仍须按本任务历史断言规则处理，不能用删模块为由静默删业务恢复断言。未执行源码测试、build、Hook 或 Eval；文档已运行 Prettier。

## 18. 0.5.2 真实 Supervisor 前沿与当前公开 CLI 验证（2026-11-11）

本轮使用已验证的 npm 0.5.2 发布包生成完整 Run，再使用主 Agent 已构建成功的 `dist/app/cli/index.js` 验证升级。没有修改产品/测试源码、运行 build、模型或 Eval，没有执行 Parent Builder、deliver 或 push。

### 创建方法与材料

创建脚本为 `coverage/native-052-supervisor-late-data-probe.mjs`；每个 Temp 目录另存其当时的完整 `creation-script.mjs`。使用真实发布 Factory、validator、SDK claim/recordOutcome/resolveWait、Git/worktree 准备与集成。明确模拟 User Shape 批准、Agent Builder/Verifier/repair 报告；检查只运行真实 `node -e "process.exit(0)"` / `process.exit(1)`。修复阶段在隔离 integration worktree 创建一个明确标为模拟材料的文件，并实际提交为原集成提交的后代。

脚本通过 `COMET_PROBE_FRONTIER=prepare|mixed|repair-checks|archive` 停在指定前沿。JSON 的 `run` 是完整原 Run，另有原请求日志 `protocol-requests.json`、实际 tracked 文件字节/分支/提交 `materials.json`。实际 Git objects、工作区、配置与检查收据保留在同目录的 `published-late/` 和 `data/`。原创建脚本的早期 Oymnlv/4Dupfa 样本采用旧协议默认允许的同一模拟 Builder/Verifier session；其输出中的“independent”文本不是独立会话证据。KDsP9z 样本改用不同模拟 Verifier session。

`coverage/native-052-seed-current-cli.mjs` 通过发布包 FileRuntimeStore 的 `restoreCheckpoint` 将真实 SDK Run 物化到其原用户级存储，登记同一 SDK owner，并通过发布包 `writeNativeManagedRunState` 写入原 portable checkpoint。此步骤是隔离 fixture 的数据入库，不是假冒一次新的正常业务推进。当前 CLI 运行前，完整 authority 备份到各目录 `before-current-legacy-store/`，portable 文件备份为 `before-current-comet-state.yaml`；备份名称虽然含 legacy，实际来源是原用户级 Runtime。

发布包准备过程中已经创建 `.comet/runtime` 迁移 fence，实际 authority 在每个目录 `data/workspaces/<原工作区标识>/runtime`。第一次尝试把 fence 当目录物化 fixture，被发布 store 正确拒绝为“must be a real directory”；随后沿原用户级 authority 入库。无需也没有删除 fence、扫描其他 worktree 或重新导入旧物理目录。

### 实际结果

以下路径共用前缀 `C:/Users/BENYM/AppData/Local/Temp/comet-052-supervisor-late-upgrade-`。

| 目录后缀 | 旧前沿                                                                                                   | 当前公开 CLI 实际结果                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Lz1UPD` | `v3-supervisor-prepare-running.json`，原 `:4` running                                                    | 当前 inspect 自动展示 v4 并保留 v3 executionOrigin；用 `running-prepare-actual-result-request.json` 的真实准备结果、同原 claim 回报成功，派发 api/ui 两个 child.prepare。完整结果在 `current-after-report-inspect-response.json`。                                                                                                                                                    |
| `fPXSeU` | `v3-late-child-checks-pending-sibling-builder-running.json`，api checks pending、ui Builder `:8` running | 使用 `mixed-ui-original-claim-result-request.json` 的原 claim 回报成功，api/ui 各有一个 pending Verifier；原 input、inputHash、claim、Wait 保持。完整结果在 `current-original-result-response.json`。                                                                                                                                                                                 |
| `4Dupfa` | `v3-integration-repair-success-checks-pending.json`，repair `:13` 成功、checks `:14` pending             | 当前 next 将旧 checks `:14` 调度取消，没有写 outcome、executionStop 或 cancellation；归档绑定原 repair `:13`。公开 native next 完成 api archive `:15`；随后 ui `:8` 原 claim 回报、不同模拟 session 的当前 Verifier 回报，再 native next 完成 ui integrate `:17`、ui archive `:18`，最终 parent.builder `:19` pending。完整 Run 在 `current-after-next-child-inspect-response.json`。 |
| `KDsP9z` | `v3-child-archive-pending-after-repair.json`，旧 archive `:15` pending                                   | 原输入只有 checksActionId/contractHash，没有 mergeActionId/repairActionId。当前 native next 成功完成同一 `:15`，原输入保持不变；完整 Run 在 `current-after-archive-inspect-response.json`。                                                                                                                                                                                           |

还保留首次失败目录 `Oymnlv`：旧 Child Verifier 的 `evidence.checks` 是真实旧协议的字符串 ID 数组，首次当前归档把它直接传入新对象报告 parser，得到 `Native reported checks[0] must be an object`。公开 next 返回 exitCode 65 / EXECUTION_UNKNOWN，原 archive `:15` 记录 unknown；binding 阶段尚未写 Archive，两个实际工作区干净。该现场和 `current-after-archive-inspect-response.json` 保留，**未重派、未修改 unknown、未伪造 stop**。主 Agent 修复 parser 分流并构建后，使用上述两个新的独立目录验证成功，没有覆盖首次失败证据。

### 实际命令形态

对每个独立目录设置 `COMET_DATA_DIR=<该目录>/data`，传入对应 `<project>=<该目录>/published-late`。记录文件均位于项目外的该 Temp 目录：

```powershell
node coverage/native-052-seed-current-cli.mjs <原Run样本.json>
node dist/app/cli/index.js runtime dispatch --application native --request <current-inspect-request.json> --project-root <project> --json
node dist/app/cli/index.js runtime dispatch --application native --request <current-original-result-request.json> --project-root <project> --json --details
node dist/app/cli/index.js runtime dispatch --application native --request <current-next-request.json> --project-root <project> --json --details
node dist/app/cli/index.js native next published-late --project-root <project> --json
```

4Dupfa 的后续当前 Verifier 使用 `current-ui-verifier-claim-request.json` 和 `current-ui-verifier-result-request.json`，均通过同一公开 runtime dispatch 提交。其验收文字明确为模拟协议输入，另实际运行一次无副作用 Node0；不能据此声称真实代码或模型质量通过。

`coverage/native-052-current-cli-assertions.mjs` 已实际通过四组深比较：保留全部原 Action input/inputHash、原 claim、原已有 outcome、原批准 Wait 和原 Run input；核对新流程到达上述实际业务步骤。结果保存在 `KDsP9z/current-verification-assertions.json`。原 Oymnlv unknown 现场也单独确认仍在。断言证明的是本轮真实发布数据和公开 CLI 边界，不能代替全量测试、真实 Hook、安装包验证或模型 Eval；这些均未执行。

## 19. 真正 0.5.2 Native@1 根归档数据与当前 CLI 续行（2026-11-11）

本轮只在 Temp 创建/验证旧数据，未修改产品或测试源码。0.5.2 发布包公开 `defineNativeWorkflowApplication('1')` 确实可用；完整走原 SDK Shape 报告与批准、Builder、真实无副作用 Node0、不同模拟 Verifier、原报告步骤、原结果批准、原 revalidate，再进入 Archive。没有合成旧 definition、伪造检查成功、停止收据或用户批准。Agent 报告、用户决定均明确标为 SIMULATED；Node0、SDK 状态推进、旧检查进程收尾及 Archive 执行器是真实发布实现。

### 冻结数据与控制器精确位置

完整源目录：`C:/Users/BENYM/AppData/Local/Temp/comet-052-sdk-v1-archive-freeze-da3596b9/`。

四份冻结文件：

1. `C:/Users/BENYM/AppData/Local/Temp/comet-052-sdk-v1-archive-freeze-da3596b9/archive-prepare-pending/frozen.json`
2. `C:/Users/BENYM/AppData/Local/Temp/comet-052-sdk-v1-archive-freeze-da3596b9/archive-applied-finalize-pending/frozen.json`
3. `C:/Users/BENYM/AppData/Local/Temp/comet-052-sdk-v1-archive-freeze-da3596b9/archive-finalize-running-before-move/frozen.json`
4. `C:/Users/BENYM/AppData/Local/Temp/comet-052-sdk-v1-archive-freeze-da3596b9/archive-moved-finalize-result-unreported/frozen.json`

同目录文件：

- `creation-script.mjs`：真实 0.5.2 数据创建器；包位置固定为 `C:/Users/BENYM/AppData/Local/Temp/comet-052-cli-package-626acda290b5479fb72b05334de5c0e5/package`，脚本核对 version=0.5.2。
- `current-validation.mjs`：在四个新 Temp 副本中恢复 Git/材料、物化原 Run/owner、通过当前公开 CLI 升级续行并深比较原事实。
- `current-repeat-validation.mjs`：对完成后的四个副本再次公开历史恢复，核对 canonical 字节及 bigint dev/ino/mtimeNs/size、归档目录身份未变。
- `original-finalize-result-request.json`：真实旧 finalize executor 返回的原结果和原 claim，可直接通过当前 runtime dispatch 补记；不是手写成功收据。
- `protocol-requests.json`、`summary.json`、`original-git.bundle`。

每份冻结 JSON 包含原 `run`、实际 portable checkpoint 全文 `portableText`、相对项目材料 `projectMaterials`、原用户级 Runtime 材料 `runtimeMaterials`、目录清单、Git branch/HEAD/status 和来源说明。各子目录另存 `comet-state.yaml` 与完整 `runtime-records/` 便于审计，**后者不能整目录复制到自动回归当前 authority**。

原 Run 的 input.projectRoot、检查计划等可能保留旧绝对路径，这是不可改写的原历史。实际装载使用新上下文 projectRoot 和相对材料，未修改这些 Run 字段。相对文件清单、portable Archive 事务/收据可复制；原 `.comet/runtime` fence 不复制，由当前 namespace API 生成实际新目录归属。

### 最小业务 Runtime 物化白名单

原 `sdk-runs` 文件、owner/index、state-projection 不复制。控制器使用当前公开 SDK 数据边界：

```typescript
const store = createFileRuntimeStore({
  rootDir: path.join(paths.workspaceRuntimeRoot, 'sdk-runs/native'),
});
await store.restoreCheckpoint(original.runId, null, original);
await registerSdkChangeOwner(projectRoot, {
  schema: 'comet.change-owner.v1',
  workflow: 'native',
  change: original.runId,
  format: 'sdk',
  application: 'native',
  runId: original.runId,
});
```

这只是经校验的测试数据入库；原 revision、Action、claim、inputHash、outcome、批准原样保留。业务副作用材料仅复制以下实际存在的精确文件：

| 前沿                                   | 原用户 Runtime 中必须复制的额外业务文件                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| archive.prepare pending                | 无                                                                                                  |
| Specs 已应用、archive.finalize pending | `native/transactions/portable-archive-published-v1-archive.json`                                    |
| archive.finalize running、尚未移动     | 同一 `native/transactions/portable-archive-published-v1-archive.json`                               |
| 已移动、原 finalize 结果未提交         | `native/sdk-archive-receipts/b6a7f7853e5d04d4cd10a62a2aa938d053ee696bcd3f19f41776b289b8e63cab.json` |

无需复制旧 process、check cache、locks、snapshot、旧 owner 索引或执行恢复记录。原项目材料保留空目录、普通文件和 portable checkpoint 原字节，但排除 `.comet/runtime`。本次没有使用旧 checker 源码或旧执行器来推进当前副本。

### Git 重建

`original-git.bundle` 为 **1489 字节**，保存真实 main 分支及原提交对象；原 HEAD 为 `b1513dbacec26289d077d707e8c9276cbbc86640`。在新 Temp 项目执行：

```text
git init -b main
git fetch <original-git.bundle> main
git update-ref refs/heads/main <frozen.git.head>
git read-tree <frozen.git.head>
```

随后逐文件恢复 frozen.projectMaterials，保留其实际活动/已归档目录布局。`read-tree` 只还原原索引，不 checkout 出冻结时已经移动或删除的旧文件；这样 Git commit/branch/index 与材料布局可以共同保留。没有 reset 原项目或改写提交；四个当前副本续行前后 Git HEAD 均相同。

### 当前公开 CLI 实际结果

通过的副本目录：`C:/Users/BENYM/AppData/Local/Temp/comet-current-sdk-v1-archive-validation-BwGzCa/`。各前沿子目录保存实际 argv、stdout、stderr、原业务存储备份、原 Run、最后原始 Run。汇总为 `results.json`。

| 原前沿                               | 实际公共操作                                                          | 结果                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| prepare `:10` pending                | 普通 `native archive`                                                 | 同一 `:10` 及后续业务 Action 完成，最终 completed。                                                         |
| Specs 已应用，finalize `:12` pending | 普通 `native archive`                                                 | 原 prepare/execute outcome 完全不变；只完成原 `:12`；canonical 文件身份/时间/内容不变，没有重复应用 Specs。 |
| finalize `:12` running、尚未移动     | `runtime dispatch mark-unknown`，再 `native archive --recover`        | 原 claim 保留，只记录原结果未提交的事实，不声称已停止；继续原事务并完成同一 `:12`，没有重放 Specs。         |
| 已移动，finalize `:12` 结果未提交    | `runtime dispatch record-outcome`，使用真实旧 executor 结果与原 claim | 同一原 Action 直接 succeeded，最终 completed；没有再次执行 Archive，原归档目录身份和 canonical 内容保持。   |

主要命令形态如下；`COMET_DATA_DIR` 设为上述副本目录的 `data/`，每个 projectRoot 是对应前沿子目录下的 `project/`：

```text
node D:/Project/Comet/dist/app/cli/index.js runtime dispatch --application native --request <inspect-request.json> --project-root <project> --json
node D:/Project/Comet/dist/app/cli/index.js native archive published-v1-archive --project-root <project> --json
node D:/Project/Comet/dist/app/cli/index.js runtime dispatch --application native --request <mark-unknown-request.json> --project-root <project> --json
node D:/Project/Comet/dist/app/cli/index.js native archive published-v1-archive --recover --project-root <project> --json
node D:/Project/Comet/dist/app/cli/index.js runtime dispatch --application native --request <original-result-request.json> --details --project-root <project> --json
```

四份结果均通过深比较：原 Run input、全部原 Action input/inputHash、原 claim、原已有 outcome、原批准 Wait 保持；没有手工修改 Run、补批准、伪造 stop 或改变 outcome。唯一新增的 unknown 状态通过公共协议记录，再由原实际事务收尾。

完成后四个副本均再次调用 `native archive --recover`，全部返回 `alreadyArchived=true/historicalRecovery=true`。`content-and-repeat-assertions.json` 证明 canonical 字节与冻结材料一致；重复调用前后 canonical bigint 文件身份/纳秒时间/长度和归档目录身份/时间均未改变。已移动案例的最终 outcome.output 与真实旧 executor 返回值深比较一致。

### 保留的调查失败与限制

- `e9daeca7` 是首次冻结工具自身的材料缺口：Git init 前取得的 paths 指向旧非 Git namespace，Runtime 材料捕获为空。其原 Run/便携checkpoint是真的，但不能用于“完整 Runtime 材料”回归；已保留现场并重新真实生成 `da3596b9`，不是手工补造事务。
- `GciweJ` 首轮误传 SDK 不接受的 `--confirmed`，被 usage 拒绝；`DatUVk` 对 pending/running 直接传 `--recover`，按当前契约返回没有唯一 unknown Action。这两轮均未推进，不算产品兼容缺陷。最后按原返回状态选普通 archive、公开 mark-unknown 或同 claim record-outcome 后四组成功。
- 本轮未启动 build、仓库自动测试、全量测试、真实平台 Hook、安装验证、模型或 Eval，没有 deliver/push。证据范围是实际 0.5.2 公开 Factory/原协议生成数据，以及当前已构建公开 CLI 在隔离副本中的升级与原事务续行。

## 20. 旧合成兼容工厂测试的去向与实际替代证据（2026-11-11）

本轮仅修改本研究报告并在独立 Temp 编写探针，没有修改产品或测试，没有 build、Eval、deliver 或 push。目标原测试全文为 `coverage/native-sdk-application.pre-current-fixture.txt`；以下行号属于这份冻结全文。`coverage/native-current-application-failure-index.json` 是主 Agent 首次整文件 95 通过、58 失败、2 跳过的失败索引，本研究没有把这次运行或 Temp 探针写成主文件已通过。

### 20.1 不能把更早的合成定义当成 0.5.2 数据

`preCheckRecoveryApplication`（冻结全文第 226 行）删旧 checks-stop；`preChildArchiveApplication`（第 243 行）再删 Child archive 并改 integration-check 推进；`legacyArchiveApplication`（第 8054 行）删 candidateBinding/recoveryBinding。这些是测试合成的更早协议，不是 npm 0.5.2 原 Factory 的输出。第 19 节四个真实 SDK Archive 样本及十五个业务样本能证明已发布 0.5.2 的自动迁移、原批准/claim 保留和已发生副作用续行；不能冒称它们覆盖“原字段不存在”的更早合成数据。

用户现已要求删除旧执行器、旧定义和专属恢复。应显式退休“只认一个旧 hash、claimed 一律禁止升级、固定旧定义先执行停止收据对账、旧内容摘要自动失效”等机制；业务身份、原批准、真实失败、原 claim 补记、实际 WAL 和禁止重放必须继续覆盖。当前适配器 `domains/comet-native/native-sdk-run-upgrade.ts:7` 在同 Run 保留 execution origins，已删除的旧检查 Action 仅 cancelled 并明确结果未确认（第 20 行）；不写 executionStop 或成功 outcome。批准前沿匹配依据原 results 与原 Wait sequence（第 46 行），不生成批准。

### 20.2 精确标题映射

Temp 中可审查的完整机器映射：`C:/Users/BENYM/AppData/Local/Temp/comet-native-compat-replacement-17accae1/registered-title-mapping.json`。脚本 `registered-title-mapping.mjs` 读取当前 registry 的所有原 tests、testMigration 和 supersededBy tests，保留 case ID，按原标题模板展开匹配 requiredNames；文件同时列出实际失败索引中的完整标题。没有直接登记 ID 的标题仍须逐行为 Review，不能因没有登记而静默删断言。

| 冻结行号与原标题                                                                                          | 登记 ID / 最小迁移                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1423 `repairs only the known pre-Child-archive definition and preserves Run facts (%s)`                   | 无直接 case ID。pending/claimed/definition-drift 的旧 hash 白名单和 claimed 拒绝机制退休；原事实保留迁至真实 published business 适配用例。不可把任意篡改定义当作真实历史版本。                                                                                           |
| 1952 `repairs failed Supervisor Children and serializes integration after a definition upgrade`           | `native-299-real-integration-parent-verify`。只退休合成 upgrade 子分支；保留当前 v4 Child 真实失败、修复、串行集成、Parent Verify 完成，以及真实 052 integration-repair→archive 升级。                                                                                   |
| 4597 `continues a healthy previous-definition Run without an upgrade or replacing its claim`              | 无直接 case ID。原 workflow hash 不变的要求退休；保留同 Run/Action/claim 与原业务结果续报，使用真实 running Supervisor/Child 样本。                                                                                                                                      |
| 4639 `upgrades a stopped check Run without replaying its execution (tampered=%s)`                         | 无直接 case ID。旧 doctor 停止对账及日志篡改专属分支退休；真实旧 pending/claimed check 的业务迁移仍保留原记录，不重放、不伪造已停/成功。                                                                                                                                 |
| 4696 `repairs a real failed Runtime check with a new candidate and preserves receipts through Archive`    | 无直接 case ID。受管检查/收据机制退休；当前 Agent 报实际失败→Verifier fail→新 Builder 候选→重新验收与批准仍需当前业务测试。                                                                                                                                              |
| 5711 `reconciles %s check receipts under the fixed old definition before upgrading it`                    | 无直接 case ID。missing/complete 的旧 runner 对账机制退休；缺失证据不能由迁移补造，原已有 outcome 只读保留。                                                                                                                                                             |
| 5814 `keeps an interrupted Runtime check stopped until a proposal-bound repair decision`                  | 无直接 case ID。旧检查停止握手机制退休；原 repair-only Wait 的 ID、proposalHash、proposal、choices、sequence、批准后才回 Build 保留，已有真实 052 repair Wait 用例。普通业务 unknown claim 仍保留。                                                                      |
| 8228 `recovers an old Archive %s transaction by matching its original candidate evidence`                 | 无直接 case ID。旧 binding 字段缺失兼容机制退休；create/tracked-update/untracked-update/non-git-update 的实际 WAL/CAS 行为须用真实 052 prepared WAL 与当前事务 API 分别保留，四个 SDK 样本本身只有一个真实 create，不能声称已覆盖全部操作类型。                          |
| 8334 `requires fresh verification instead of trusting a legacy check without a candidate digest`          | `native-rejected-check-proof-original-claim-correction`。旧 check digest 验证机制退休；业务“错误候选结果拒绝、原 claim/拒绝历史保留、同 claim 补正确结果且不重跑”已由 20.4 当前 v4 公共 CLI 原型完整保留。                                                               |
| 8417 `records an already-finalized %s receipt as history without revalidating changed implementation`     | 无直接 case ID。legacy/current 两种旧工厂来源可退休；真实已移动原 finalize 结果可同 claim 补记、后续实现变化不导致重新验收，已由第 19 节及 20.3 覆盖。                                                                                                                   |
| 8576 `resumes the original finalize after interruption at %s without replaying applied side effects`      | 无直接 case ID。report/report-journal/move/move-journal/portable-receipt/runtime-receipt/cleanup 七个故障点仍是独立断言；四个真实冻结前沿不是七点等价证明。保留当前真实 finalization 的文件写入/rename/rm 故障注入，使用实际 owning module spy，不能通过合成旧定义恢复。 |
| 8694 `resumes a legacy finalize after rename using the original candidate evidence`                       | 无直接 case ID。旧缺字段定义机制退休；同原 Action/attempt/inputHash/claim、原 WAL/真实 receipt、已搬迁不再次搬迁由真实冻结样本覆盖。                                                                                                                                     |
| 8718 `does not overwrite a changed pre-finalization report while resuming the original finalize`          | 无直接 case ID。当前业务仍保留；20.3 尚未替代此报告保留断言，应在当前 finalize 注入准备 helper 上测试。                                                                                                                                                                  |
| 8740 `rejects a rewritten frozen transaction even when the canonical Spec matches that rewrite`           | 无直接 case ID。20.3 真实 WAL 原型已修改 content、既有 result_hash、capability 并同步改 canonical，公开 CLI 拒绝且不覆盖，原材料恢复后同 claim 可完成。                                                                                                                  |
| 8764 `keeps recovery blocked when neither the original transaction nor a complete receipt survived`       | 无直接 case ID。20.3 已用真实 moved 原 Run，同时移除 Runtime 与 portable 两处真实 receipt，原 WAL 已在真实完成时清理，公开 CLI 拒绝；还原真实 receipt 后同 claim 可完成。                                                                                                |
| 9147 `recovers an applied unknown Archive without replay after %s edits and rejects foreign transactions` | 当前多处登记复用本标题，不能只改一个 case ID；完整 21 个 ID 见机器映射。保留已应用 Specs 不重放、原 claim、原批准、foreign transaction 拒绝与历史完成语义；已撤销的自动内容漂移判断按现有 feature-removed 记录处理。                                                     |

第 9147 行的 21 个 ID 是：`native-archive-rejected-apply-recovery`、`native-531-transient-snapshot-preserves-acceptance`、`native-531-declared-check-outputs`、`native-509-environment-archive`、`native-dirty-gitlink-archive`、`manual-recovery-native-applied-comment`、`manual-recovery-native-repeat-edit`、`manual-recovery-native-large-crlf`、`manual-recovery-native-compat-edit`、`manual-recovery-native-build-edit`、`manual-recovery-native-archive-ready`、`manual-recovery-native-archive-report-edit`、`manual-recovery-native-archive-requirements-edit`、`manual-recovery-native-archive-formal-comment`、`manual-recovery-native-reviewed-requirements`、`native-missing-shape-fingerprint-recovery`、`native-archive-formal-requirements-judgment-route`、`native-528-applied-archive-recovery`、`native-528-recovery-original-evidence-guards`、`native-528-legacy-archive-recovery`、`native-archive-shared-input-observation`。这是 registry 引用关系，不等于每项旧行为均被一次通用恢复覆盖。

### 20.3 可执行的真实 052 Archive 反例替代原型

控制器：`C:/Users/BENYM/AppData/Local/Temp/comet-native-compat-replacement-17accae1/prototype.mjs`，输入第 19 节 `da3596b9` 原冻结目录。沿用 Git bundle、原 Run restoreCheckpoint、原 owner 注册和精确业务材料白名单，不加载旧 Factory 或执行器。所有推进通过当前 `dist/app/cli/index.js runtime dispatch` / `native archive --recover`。标记 unknown 仅记录原结果未提交的事实，不声称原进程停止。

真实运行结果：`C:/Users/BENYM/AppData/Local/Temp/comet-native-compat-replacement-results-vNOL4B/results.json` 前六项通过；第七项首轮只删 Runtime receipt 的“应拒绝”预期失败，现场保留。原因是原 archived portable YAML 仍有有效 `archive_receipt`，当前正确使用 fallback 历史恢复。控制器后续补齐同时移除两处真实 receipt，单跑此项结果为 `C:/Users/BENYM/AppData/Local/Temp/comet-native-compat-replacement-results-yaUh29/results.json`，通过。

实际通过的七项：WAL 缺失、transaction ID 不符、Spec cursor 未完成、WAL 与 canonical 一同改写、错 claim token 拒绝后原 token 补记、已移动后实施后续编辑仅补历史、已移动且 WAL/两处 receipt 全部缺失拒绝。四项原 WAL 拒绝及双 receipt 缺失都断言原 Action/批准与故障材料不被覆盖，再只还原注入的原材料，证明合法原 claim 仍可完成。首项未移动 WAL 缺失的错误为找不到归档目录；第七项才精确返回 `Native SDK Archive completion record does not match its Run or transaction`，不能混称同一断言。

真实改写反例重算旧协议既有 `result_hash`（SHA-256），与原历史测试完全一致；不新增产品 hash 机制。拒绝不是仅因 hash 与内容不符。当前业务依据保留的原操作/事务对应，代码见 `domains/comet-native/native-sdk-archive.ts:251`、`:364`、`:411`；持久收据从 Runtime→portable fallback 的来源见 `domains/comet-native/native-portable-archive.ts:795`，原 Run/transaction/Spec 项对应检查在 `:803`，缺失或不符在 `:819` 拒绝。

再次运行单项：

```text
node C:/Users/BENYM/AppData/Local/Temp/comet-native-compat-replacement-17accae1/prototype.mjs C:/Users/BENYM/AppData/Local/Temp/comet-052-sdk-v1-archive-freeze-da3596b9 missing-after-move-completion
```

省略最后参数运行七项；脚本每次创建独立 Temp，保留原 fixture。

### 20.4 当前 v4 原 claim 拒绝历史与纠正完整证明

控制器 `C:/Users/BENYM/AppData/Local/Temp/comet-native-compat-replacement-17accae1/current-claim-correction.mjs` 通过当前公开 CLI 实际执行 Shape→显式 Shape 批准→Builder→Verifier→显式结果批准→Archive。Agent/User 均标明 SIMULATED；实际只运行 harmless Node exit 0 与 Git，没有模型或 Eval。成功现场为 `C:/Users/BENYM/AppData/Local/Temp/comet-native-v4-fixture-prototype-v1XnV4/`。

在真实已领取 Verifier 上，以原 claim token 和原 inputHash 提交 foreign candidate 结果。当前 transitionHandler 拒绝候选绑定（`domains/comet-native/native-sdk-application.ts:441`），公共响应为 `OUTCOME_PROCESSING_ERROR`，SDK 仍持久保留 `rejectedOutcomes` 和 receipt。探针断言原 Action running、原 claim 未变、唯一一次 Verifier、验收 pending、无 Archive；再沿原 claim 提交正确结果后同 Action succeeded，拒绝历史逐字段保留。最后显式结果批准才完成 Archive。

首次探针误预期旧 validator 的 `OUTCOME_REJECTED`，保留在 `7EGww7`；第二次误预期拒绝后 Action 完全不变，实际 diff 正是增加 rejectedOutcomes/receipt，保留现场。纠正预期后完整通过。这证明可保留 `native-rejected-check-proof-original-claim-correction` 的关键业务安全和合法纠正行为，同时明确撤掉旧 check digest 验证和旧错误码专属断言；无需旧执行器。这是现有当前业务行为的替代证明，不是发现并修复了新的候选绑定缺陷；主 Agent 已按同一实际错误码和原 claim/Wait/纠正链完成对应新测试。相关 JSON：`before-rejected-business-result-run.json`、`foreign-result-request.json`、`foreign-result-response.json`、`after-rejected-business-result-run.json`、`after-corrected-business-result-run.json`、`awaiting-result-run.json`、`completed-run.json`。

本轮未把 Temp 原型自动变成仓库测试，未修改 registry。主 Agent 可将其物化/公开 CLI 逻辑收敛到现有 `native-published-archive-upgrade.test.ts` 或独立业务回归，保留明确的原标题/case ID 映射后由 Review 确认。当时尚未覆盖的七点 finalize 故障、旧 WAL 操作类型/备份 symlink、改报告保留等不能用七项通用恢复代替；后续逐点迁移实证见第 23 节。

## 21. 真实旧 v4 Supervisor 已批准结果的当前业务适配（2026-11-11）

结论：真实旧 v4 的 `verify.revalidate` pending/unknown 两种已批准前沿均由当前适配器直接恢复到唯一 `supervisor.parent.deliver`，没有重复询问批准。未复现“退回 verify.confirm 再问一次”的问题，因此不建议新增生产补丁或额外旧步骤别名。

### 真实历史来源与生成

`test/fixtures/native-v4-internal-actions/` 仅有 `workflow.json`，没有原 Run。末尾历史测试 `continues the original v4 Supervisor accepted-result Action after compact definitions ship (%s)` 原先依靠已删除的 selector 重新构造旧图并推进；不能直接把当前新 Factory 传给它，或把当前 Run 改 hash 来冒充原数据。

本轮读取本机实际已安装旧包 `D:/nodejs/node_modules/@rpamis/comet`，version=0.5.3，未修改安装目录。其公开 `defineNativeWorkflowApplication('4')` 与仓库冻结 workflow 经 SDK 正式归一化后的 hash 完全一致：`26c4e50c65dcb5e1280529642a73b650400e3109ba6fa2efded90e03ad790443`，共有 30 个步骤。该比较只用于证明实际历史来源，不增加产品指纹机制。校验脚本为 `C:/Users/BENYM/AppData/Local/Temp/comet-old-v4-approved-frontier-7f3e61b5/verify-source.mjs`。

同一 Temp 的 `generate.mjs` 使用该真实旧包公开 Factory 和 SDK，通过实际 Shape 材料收集、SIMULATED User 多会话批准、两个 Child Git 实现提交、真实 Child 集成和归档、Parent Builder/Verifier、SIMULATED User 明确接受结果，冻结：

- `pending-run.json`：原 `verify.revalidate` Action `old-v4-supervisor:18` pending。
- `unknown-run.json`：该原 Action 经正式 claim `comet-native-report-revalidate`、token `original-result-read` 后，通过 SDK markUnknown 记录原结果未提交；没有声称原进程已停止。
- `protocol-requests.json`：明确标记 SIMULATED Agent/User 的原请求；`last-run.json` 保留最后原 Run。
- `project/` 与 `data/`：真实隔离 Git、原 Child/Integration worktree 和业务材料，保留生成现场。

没有执行旧受管检查器、`report-revalidate` executor、Parent delivery、模型、Eval、deliver/push。旧 Factory 仅在 Temp 调查程序中作为真实历史来源使用，没有加入产品或测试。

### 原批准与前沿关系

冻结旧图没有 `supervisor.parent.accepted` 步骤；“accepted-result Action”是测试标题，真实 step 是 `verify.revalidate`（冻结 workflow 第 296 行）。旧图 `verify.confirm --approved--> verify.revalidate` 位于第 529 行，后者到 `supervisor.parent.deliver` 的边位于第 552 行。

真实两个样本均有同一已解决 `verify.confirm` Wait `old-v4-supervisor:17`，sequence=17、choice=approved。原 `:18` 的 `actionContexts[:18].results['verify.confirm'].sequence` 同样为 17；因此可精确复用这项原批准，不需要猜测或构造批准。原状态仍是 Verify/await-user，当前 `confirmNativeSkillCoordinatedPass` 可以合法执行一次纯业务确认。

### 当前源码适配实证与最小测试改法

`verify-current.mjs` 使用 esbuild write:false 在内存装载当前源码的 `upgradeNativeRun`、公开 `defineNativeWorkflowApplication('4')` 与 SDK，不写根 dist。每种状态直接转换其原冻结 Run，使用 SDK store.restoreCheckpoint 原 Run ID 入库，再由当前 SDK `next` 激活 ready；没有注册旧定义或旧 executor。结果文件为 `current-results.json`、`pending-converted.json`、`pending-resumed.json`、`unknown-converted.json`、`unknown-resumed.json`。

实际断言两项均通过：

1. 原 Run ID 不变；全部原 Wait 深比较相等，只有原来的一个 Verify 确认，不存在新的 pending Wait。
2. 原 `:18` 仅 cancelled；input/inputHash/claim 原样保留，没有 outcome 或 executionStop，不伪称原读操作完成。
3. 当前 ready/from 为原 `verify.confirm`，目标为唯一 `supervisor.parent.deliver`，其 activation 由当前业务 handler 基于原成功 Parent Builder 和集成提交生成。
4. 原全部成功业务 Action 的 input/inputHash/claim/outcome 深比较保持；Child 与 Parent 工作没有重放。
5. 重复 inspect 完全相等，重复升级当前图直接返回同一对象，不新增第二个 delivery。

当前实现已在 `domains/comet-native/native-sdk-run-upgrade.ts:46` 将 `verify.revalidate` 关联原 `verify.confirm`，第 47 行用前沿 results 的 sequence 绑定原已解决批准，第 51 行调用当前纯业务 handler。当前 handler 的 `verify.confirm` approved 分支位于 `domains/comet-native/native-sdk-application.ts:2157`，经 `acceptedSdkResult`（第 933 行）选择 Parent delivery。真实原输入命中了这条现有路径，因此没有可报告的红输入。

最薄测试迁移是直接消费两份真实冻结 Run，走当前 load/upgrade→current SDK next，保留以上同 Run/原批准/原 claim/不重放断言。旧 `verify.revalidate` succeeded、workflow hash 不变、旧 report recovery executor 再次执行等要求随内部步骤退休显式移除；不能为了保留这些机制恢复旧 Factory。Parent delivery 的真实 Git 副作用继续由当前正常 Supervisor 业务测试覆盖，本轮没有再次交付这些 Temp 项目。

首轮探针调用 inspect 后期待新 Action，得到仍为原 cancelled `verify.revalidate` 的断言失败；保存的 converted ready 已正确指向 Parent delivery。SDK inspect 本来只观测，改用正式 next 激活后两项通过，这是探针调用错误，不是产品缺陷。实际未运行仓库测试、build、安装/Hook 验证或 Eval；证据层是旧实际安装包生成原数据 + 当前源码数据边界和当前 SDK 激活。

## 22. 当前 v4 Supervisor 八变体与审查策略的 Temp 迁移原型（2026-11-11）

本轮只写 Temp 与本报告，没有修改仓库产品或测试。主 Agent 指定的 `handles parent repair, delivery, and cleanup after Supervisor DAG restart (%s)` 八变体已在当前源码上全部通过；另将旧版本 review fixture 转为当前 v4 的三个真实业务选择，三项通过。没有全量、build、模型或 Eval。

### 可整体审查的原型

目录：`C:/Users/BENYM/AppData/Local/Temp/comet-supervisor-current-group-d60160e4/`。

- `supervisor-business.test.ts`：完整最小可运行测试，包含原组、当前公共 Factory、必要准备 helper；源码绝对 import 当前仓库。
- `current-group.txt`：可整体替换原八变体的完整 group；`original-group.txt` 与 `business-group.patch` 保留逐行差异。
- `original-main.txt`：准备时的原 main 全文；`prepare.mjs` 为首轮提取/转换记录，首轮之后的 UI evidence 修正与格式整理以最终 `supervisor-business.test.ts` 为准。
- `vitest.config.mts`：仅包含该 Temp 单文件，独立 root，maxWorkers=1，沿用仓库 Runtime HOME 隔离 setup。
- `normal-results-2.json`：normal 1 通过、0 失败，约 29.5 秒。
- `remaining-results.json`：其余 7 通过、0 失败，各约 26–34.6 秒，总用例耗时约 220 秒。
- `supervisor-review.test.ts`、`current-supervisor-review-helper.txt`、`review-results.json`：当前审查策略原型及 3 通过、0 失败结果。

实际最小命令：

```text
pnpm exec vitest run --config C:/Users/BENYM/AppData/Local/Temp/comet-supervisor-current-group-d60160e4/vitest.config.mts -t 'DAG restart \(normal\)' --reporter=json --outputFile C:/Users/BENYM/AppData/Local/Temp/comet-supervisor-current-group-d60160e4/normal-results-2.json
pnpm exec vitest run --config C:/Users/BENYM/AppData/Local/Temp/comet-supervisor-current-group-d60160e4/vitest.config.mts -t 'DAG restart \((partial|branch|delivery|target|child|parent)' --reporter=json --outputFile C:/Users/BENYM/AppData/Local/Temp/comet-supervisor-current-group-d60160e4/remaining-results.json
pnpm exec vitest run --config C:/Users/BENYM/AppData/Local/Temp/comet-supervisor-current-group-d60160e4/review-vitest.config.mts --reporter=json --outputFile C:/Users/BENYM/AppData/Local/Temp/comet-supervisor-current-group-d60160e4/review-results.json
```

这些是 SDK/真实临时 Git 与组内公开 Native CLI 恢复的确定性测试，不是模型验收。Agent/User 结果输入在原型中明确 SIMULATED；Node 检查和 Git 副作用实际运行。

### 业务保留与旧机制退休的精确区别

`native-299-real-integration-parent-verify` 的 registry 复用该组标题。八个原变体名称全部保留：normal、partial-recovery、branch-lock-recovery、delivery-recovery、delivery-ref-lock、target-drift、child-builder-failure、parent-builder-failure。

保留的行为包括：Child Builder 实际失败后原内容与重试批准；DAG 重启后继续正确 UI 前沿；实际 Git 候选及祖先关系；Parent Verifier 实际失败→原 Parent Builder 修复；Parent Builder 实际失败后继续；用户拒绝结果后回原 Parent 修订，再次验收且批准后才能 delivery；目标分支漂移拒绝、不覆盖并发提交；Git ref 锁导致 unknown，证据证明未交付前不得历史补记；无关未提交工作保留；真实 delivery 已完成但原结果未提交时原 Action 历史恢复；真实 Archive；cleanup 对漂移、未跟踪工作、已删除一个 Child worktree 的部分清理和 Git branch 锁的恢复；最后工作区/分支全部清理且 API/UI/Parent 修复文件保留。

旧自动检查触发机制有明确变化，不能宣称步骤完全相同：

- 原 API merge 后由 `supervisor.child.integration-checks` 自动执行 Node 并创建 integration-repair 已退休。当前裸 Factory 成功 merge 直接 child.archive；不能伪造旧 failed check 来制造修复 Action。
- 本组改为测试控制器扮演 Agent，通过平台 Node 在 Child 实际读取 marker，先观察 exit 1，以 checks 对象和 Child Verifier fail 报告真实失败；进入原 Child Builder 后实际改文件、Git commit，Node exit 0，再报告 Builder/Verifier 成功并进行真实 merge。merge 后再次在 Integration worktree 观察相同行为，直接走当前 Child archive。
- 旧“由 integration 检查失败自动创建 repair”的触发机制 feature-removed。当前组合应用仍有明确 integration review extension→integration-repair→再次 review 路径，保留去向为 `test/domains/comet-native/native-application.test.ts:484` 的 `binds reverse Child reviews, repairs integration in its worktree, and reviews the parent candidate`（失败与原 repair 绑定见约第 581–610 行）。原型没有为裸 Factory 新增检查框架，也没有把该组合测试写成本轮已运行。
- Parent `request-checks`→`verify.requested-checks` 调度退休。测试 Agent 直接执行真实 Node 检查 API/UI 存在性，再实际观察缺少 parent-repair.txt 导致 exit 1；保留 Parent Verifier fail 和原 Parent 修复、用户决定的完整行为。
- `verify.report` 内部 Action 退休；保留当前结果等待、用户拒绝及最终批准，不再期待不存在的 report Action。报告视图写入不充当批准。
- 原 UI evidence 的 `checks: ['ui-check']` 不是当前 v4 对象报告；改成实际 Node 文件观察和当前 checks 对象。首轮 normal 在这里 OUTCOME_REJECTED 的结果保留于 `normal-results.json`，修正 fixture 后原八变体全部通过，没有放宽生产校验。

这组源测试本身没有设置 Git commit hook；本轮保留其实际 Git commits，但没有新增或宣称覆盖 commit-hook 故障。主文件其他 Hook 测试不在本 Temp 原型范围，不能由该组通过推断。

### current v4 review helper 最小修正

原 `nativeSupervisorReviewFixture` 在结果为 shape.revalidate 时才执行 prepare，当前 v4 已无该内部 Action，因此 prepare 被整个跳过。原型删除这一旧条件，在真实 Shape 批准后正式执行 `native-supervisor-prepare`、`native-supervisor-child-prepare`；随后按 current v4 真实任务推进，检查由 Agent 实际 Node 执行并报告。

`native-supervisor-adaptive-review` 原登记使用版本 2/3 新建 Factory。当前公开新建仅版本 4，因此不能将版本号参数传入新工厂并声称旧策略仍执行。当前原型保留三个实际选择：

| 当前选择                                          | 预期与实测                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| requireIndependentReview=false，同 Builder 会话   | 允许；真实 Child archive 的 assurance=self-reviewed。通过。                                |
| requireIndependentReview=true，同 Builder 会话    | 拒绝；原 Child Verifier 仍 running。通过。                                                 |
| requireIndependentReview=true，不同 reviewer 会话 | 允许；真实 Child archive 的 assurance=skill-coordinated，原 reviewer identity 保留。通过。 |

`requireIndependentReview: 'false'` 非法类型的拒绝反例也在 current v4 helper 中保留；纠正后沿原 Builder claim 推进。旧版本固定独立策略与当前用户/Builder 显式选择的差异需在迁移说明中标清，真实旧数据兼容由已冻结发布包样本继续覆盖，不能把三个当前 v4 选择冒称 v2/v3 Factory 的再次执行。

完成格式检查仅覆盖本研究报告及 Temp 原型；未运行主仓库整文件、全量、build、安装包/真实平台 Hook 或 Eval。主 Agent 将原型并入仓库后仍应执行同名精确定向测试与原 registry 迁移检查。

## 23. 剩余人工旧定义与 Archive 失败面迁移实证（2026-11-11）

当前最小 Temp 原型已覆盖七类 finalize 边界、原 claim 纠正、事务保护、跨 capability 多操作和文件符号链接。没有恢复旧 Factory、检查执行器或 stop 协议；没有修改产品、仓库测试或 registry。

### 23.1 最小可应用原型与实际结果

目录：`C:/Users/BENYM/AppData/Local/Temp/comet-archive-current-failures-23fc53a4/`。

| 文件                                                                        | 作用与实际结果                                                                                                                                                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archive-failures.test.ts`                                                  | 从当前 main 提取公共当前 v4 准备 helper、原七点及五类保护和同 claim 纠正；共 13 个唯一测试已通过。没有 legacy Factory 分支。                                                                 |
| `current-finalize-helper.txt`                                               | 可直接审查的 current-only 故障准备函数；原类型/参数中不再接收 legacy factory。                                                                                                               |
| `seven-results-2.json`                                                      | 六个非 report 故障通过；report 当时仅剩旧 move 次数预期未调整，记录为 6 通过、1 失败。未覆盖该失败记录。                                                                                     |
| `report-and-guards-results.json`                                            | 更正 report 对应的移动次数后，只跑 report 加另六个相关保护，7 通过、0 失败。                                                                                                                 |
| `combined-current-failure-results.json`                                     | 按完整测试名合并以上最小调用的最后结果，唯一 13 通过、0 失败；明确不是一次主文件/全量运行。                                                                                                  |
| `archive-extra.test.ts`、`extra-results.json`                               | 三 capability 的真实部分 apply 恢复、foreign finalize capability 两项通过；另有 1 项当前备份输入循环及 3 项真实旧 WAL 只读材料反例通过；两个 Windows 文件 symlink 因权限跳过，不能记为通过。 |
| `symlink-probe-source.ts`、`symlink-probe.cjs`、`prepare-symlink-probe.mjs` | 将相同当前源码入口仅 bundle 到 Temp，用 WSL Node v24.14.0 建立 Linux 真实文件 symlink。两项通过。                                                                                            |
| `wsl-symlink-results.json`                                                  | 持久保存 WSL 两项真实结果；不是 Windows 文件 symlink 权限证明。                                                                                                                              |
| `original-main.txt`、`remaining-legacy-title-catalog.json`                  | 原 main 全文及逐旧定义依赖的标题/行号/registry ID 目录，便于 Review 核对退休范围。                                                                                                           |

实际最小命令：

```text
pnpm exec vitest run --config C:/Users/BENYM/AppData/Local/Temp/comet-archive-current-failures-23fc53a4/vitest.config.mts -t 'resumes the original finalize after interruption at' --reporter=json --outputFile <seven-results-2.json>
pnpm exec vitest run --config C:/Users/BENYM/AppData/Local/Temp/comet-archive-current-failures-23fc53a4/vitest.config.mts -t 'rejects a foreign|preserves the interrupted|pre-finalization report|rewritten frozen|neither.*survived|interruption at report without' --reporter=json --outputFile <report-and-guards-results.json>
pnpm exec vitest run --config C:/Users/BENYM/AppData/Local/Temp/comet-archive-current-failures-23fc53a4/extra-vitest.config.mts --reporter=json --outputFile <extra-results.json>
wsl.exe --exec env PATH=/home/benym/.nvm/versions/node/v24.14.0/bin:/usr/bin:/bin /home/benym/.nvm/versions/node/v24.14.0/bin/node /mnt/c/Users/BENYM/AppData/Local/Temp/comet-archive-current-failures-23fc53a4/symlink-probe.cjs
```

首次 Temp 故障探针漏改动态 import 相对路径，七项都在加载 atomic 模块前失败；现场 `seven-results.json` 保留。更正为当前实际 owning module 后才获得真实注入结果。WSL 首轮错误地只接收 DispatchResult，实际边界抛 RaceSafeReadError，后续按原 `expectArchiveFailure` 一样同时保留返回/抛错两种合法拒绝表达。最后持久结果为上表，未把这些工具准备失败算成产品缺陷。

### 23.2 七点故障逐项保留，不再依赖四份 happy 样本

六个事务边界全部保持原真实故障注入：report-journal、move、move-journal、portable-receipt、runtime-receipt、cleanup。原 helper 经当前 v4 正常 Shape/Builder/Verifier/明确结果批准、真实 apply，领取同一 finalize 后，通过当前 atomicWriteJson/atomicWriteText 与 fs.rename/fs.rm 的实际写入点抛 EIO。恢复仍断言原 Action ID/attempt/inputHash/claim、原 transaction ID、唯一一次 archive.execute、canonical 字节/mtime 不变；移动前的两项只移动一次，已经移动的各项不再移动；原 WAL 清理；重复恢复不增加 revision。

report 点的旧阻塞语义已改变：`domains/comet-native/native-portable-archive.ts` 的 finalize 在生成缺失报告失败时，仅在非 optionalView 才抛错；当前 SDK 在 `native-sdk-archive.ts` 将 derivedReport.optionalView=true。因此该点仍实际注入 EIO 并确认发生，但 executor 可继续移动/落真实 receipt，原结果尚未提交时再 markUnknown，沿真实 receipt 补记同 Action 历史；恢复应 historicalRecovery=true、resumedFinalization=false、移动零次。不能为了保留旧异常预期，把报告重新变成业务批准条件。其他六个事务故障仍要求 resumedFinalization=true、historicalRecovery=false。

用户编辑 pre-finalization report 的独立保护没有退休。当前用 move 故障保持活动材料尚未移动，用户写入的 verification.md 在恢复后原文保留于 archive；同原 claim 完成。原先以 report 写失败制造这个布局的工具方式已不适用，改用真实 move 边界，不减少保护对象或降低“用户原文不覆盖”断言。

另外保留并实际通过：transaction ID 不符、Spec cursor 不完整时原 Action/WAL 不变，还原注入字节后合法原事务可完成；同时改写 WAL 内容/result_hash/capability 和 canonical 仍拒绝；WAL 丢失且没有完整收据时拒绝，不能补造完成；foreign Verifier candidate 拒绝后保留原 claim/拒绝历史、可补正确结果且不新建 Verifier。后三项错误路径均不是重新运行旧检查器。

### 23.3 跨 capability 多操作与 symlink

当前 Factory 通过真实材料发现两项 modify（secondary、workflow）和一项 create（sessions），经过同一真实 Run、原 Shape 与验收批准，再进入实际 Archive：

1. 第二项 canonical 写入前抛 EIO，实际 cursor=1，原 apply Action 成为 unknown。当前公开归档恢复只继续余下项，原 apply claim 完成，第一项 canonical 的 mtime 不变。最终三项内容正确、唯一 archive.execute、全部原批准完全相等。
2. 完成 apply 后，将 WAL 的一个 capability 改成外部业务名。finalize 恢复拒绝，原 Action 和故障 WAL 原字节保留；还原原 WAL 后仍由同一 Run 合法完成。

这两项覆盖当前 SDK 的 multi-operation 业务边界；旧 create/replace/remove 三种事务操作还由真实 0.5.2 `all-spec` WAL 的 `native-archive.test.ts`、CAS 与恢复套件保留。没有拿四份单一 create 的 SDK Archive 样本冒称已覆盖 multi-operation。

symlink 使用相同当前真实多 capability Archive 事务，分别准备 Git 未跟踪 canonical 与非 Git 项目，再把提供给 legacySpecBackup 的文件路径指向真正的文件 symlink。WSL 两例都先断言 lstat.isSymbolicLink()=true，当前边界以 `RaceSafeReadError.reason='not-regular-file'`（`must be a regular file`）拒绝；原 Run 与 WAL 逐字不变。原测试只匹配 symbolic/symlink 字样已不足以表达当前 reader 的实际错误；可断言此 reason，或在确认真实 symlink 的前提下接受 regular-file 拒绝。未把普通 JSON 解析失败冒充 symlink 保护。

### 23.4 剩余人工旧定义：逐业务去向与纯机制退休

以下标题/行号针对本轮 `original-main.txt`，可能与更早第 20 节冻结全文不同。机器目录列出当前 registry 原 tests、迁移及 supersededBy 的直接引用；“无直接 ID”不意味着可以静默删除。

| 原标题与本轮行号                                                                                                                             | 必须保留的业务断言与去向                                                                                                                                            | 单独退休的旧机制                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1350 `repairs only the known pre-Child-archive definition and preserves Run facts (%s)`，无直接 ID                                           | 原 Run/Action/claim/批准保留，迁至真实 052 与旧 v4 published business upgrade。                                                                                     | 已知旧 hash 白名单、claimed 禁止升级、任意 maxTransitions 漂移不匹配旧图这三种 selector 行为；当前 loader 前先适配数据，不构造旧 Factory。                                                                                                              |
| 1871 `repairs failed Supervisor Children and serializes integration after a definition upgrade`，`native-299-real-integration-parent-verify` | Child 真实失败→原候选修复、集成串行与 Parent 通过由当前业务组和真实旧 integration-repair 前沿保留；第 22 节八组有实际结果。                                         | 以 preChildArchiveApplication 合成没有 child.archive 的旧图再选择定义。只移除 upgrade 子分支，不能删整个 Supervisor 业务。                                                                                                                              |
| 4312 `continues a healthy previous-definition Run without an upgrade or replacing its claim`，无直接 ID                                      | 使用真实 running Supervisor prepare、Child Builder 原 claim 当前结果回报，第 18/21 节及 published business upgrade。                                                | 保持旧 workflow hash 不变、doctor 固定 revision+1 的机械要求。                                                                                                                                                                                          |
| 4354 `upgrades a stopped check Run without replaying its execution (tampered=%s)`，无直接 ID                                                 | 真实旧 check 原记录只读保留、不重放、不伪造停止或通过；真实 repair-only Wait 原提案批准后回 Build；当前实际失败由 Verifier 报告并修复。                             | 旧 executor 日志内容摘要、doctor 显式旧定义修复与停止对账。原测试依赖早于真实 052 的人造缺 stop 图。                                                                                                                                                    |
| 5249 `revalidates approved report %s changes without losing valid evidence`，无直接 ID                                                       | 已批准结果、同候选与同 Run、环境/普通编辑不反复要求同批准；报告缺失/失败不能丢决定。当前等待与报告业务测试、真实旧 v4 pending/unknown 适配、第 23.2 report 点保留。 | legacy-definition 选择；自动 report/revalidate/check Actions；非 repeatable 检查或文件变化自动触发重验。unknown 内部只读 Action 由数据适配 cancelled，无成功/stop 伪造。                                                                                |
| 6443 `rejects a file symlink backup for an old Archive %s transaction`，无直接 ID                                                            | 当前实际入口 symlink 拒绝和原 Run/WAL 不变，第 23.3 两种上下文已真实 WSL 通过。                                                                                     | 为制造旧缺 candidateBinding 而装配旧 Factory；不需要它来证明文件边界安全。                                                                                                                                                                              |
| 6458 `recovers an old Archive %s transaction by matching its original candidate evidence`，无直接 ID                                         | 当前 create/modify、多 capability、实际 WAL/原批准/原 claim、不重放由本节与真实 052 frozen/旧事务 CAS 保留。                                                        | 缺 candidateBinding/recoveryBinding 的更早人工协议；手填 expected_target_hash 后依靠原文备份重算历史候选。旧备份摘要重建、重排文件、重复导入、不同原文不可覆盖属于该专属机制，不能冒称当前无内容证明流程仍完成同一重建。输入文件 symlink 安全单独保留。 |
| 6564 `records an already-finalized %s receipt as history without revalidating changed implementation`，无直接 ID                             | 保留 current 分支；legacy 来源改真实 052 已移动/原结果未提交 fixture，原 claim 补记、后续实现保留、历史不重验。第 19/20 节已有真实公开 CLI。                        | 仅退休人工 stripped-binding Factory 这一种来源，不退休历史收据恢复。                                                                                                                                                                                    |
| 6723 `resumes the original finalize after interruption at %s without replaying applied side effects`，无直接 ID                              | 七个真实写入点均有本节当前原型；六事务中断保持原语义，report 可选视图有明确新行为。                                                                                 | 旧 report 写失败阻塞整个已批准 Archive 的要求。                                                                                                                                                                                                         |
| 6790 `preserves the interrupted finalize when %s no longer matches its original evidence`，无直接 ID                                         | transaction-id/spec-cursor 两项原 Action/材料保留与纠正后完成均实跑。                                                                                               | 无业务断言退休。                                                                                                                                                                                                                                        |
| 6841 `resumes a legacy finalize after rename using the original candidate evidence`，无直接 ID                                               | 同原 Action/claim、rename 后不再移动由当前 move-journal 及真实 052 moved fixture 续行保留。                                                                         | candidateBinding 必须不存在、旧 Factory 再执行 finalize；不能伪造该旧字段缺失。                                                                                                                                                                         |
| 6865 `does not overwrite a changed pre-finalization report while resuming the original finalize`，无直接 ID                                  | 同原用户报告字节完整保留，实跑通过。                                                                                                                                | 只换准备故障点到 move；未移除业务断言。                                                                                                                                                                                                                 |
| 6887 `rejects a rewritten frozen transaction even when the canonical Spec matches that rewrite`，无直接 ID                                   | 原拒绝、canonical 不覆盖、原 Action 保留，实跑通过。                                                                                                                | 无业务断言退休；既有 result_hash 在反例里同步改变以避免仅因坏 hash 拒绝。                                                                                                                                                                               |
| 6911 `keeps recovery blocked when neither the original transaction nor a complete receipt survived`，无直接 ID                               | 原缺证据拒绝、Action 不推进、不补造 WAL，实跑通过。                                                                                                                 | 无业务断言退休。                                                                                                                                                                                                                                        |

第 20 节列出的 `native-rejected-check-proof-original-claim-correction` 已由本节同 claim 纠正实际覆盖；旧 check digest 专属字段/错误码机制仍明确退休。`native-528-legacy-archive-recovery` 及共享 applied-Archive 标题的 21 个 registry ID 仍按第 20 节逐项保留来源与当前恢复去向，不能因这里某标题无直接登记就删除共享映射。

本轮对“人工缺字段旧备份重建”没有制造新的成功数据或宣称已在真实 052 上复现。实际 052 preflight 已含 candidateBinding 与 recoveryBinding；真数据的事务/原身份续行保留，更早人造协议的成功重算要求需显式按 feature-removed 经 Review 确认。仍公开的 legacySpecBackup 输入边界已补独立测试：`backup-input-results.json` 为 1 通过、0 失败，循环覆盖未知字段、错误 runId/transactionId、重复 ref、超过 8MiB 与越界备份路径；逐项确认命中相应 schema/唯一 ref/大小/路径拒绝，原 Run/WAL/输入不变，随后不传备份的正常归档仍完成。`original-material-guards-results.json` 为 3 通过、0 失败，直接读取真实 052 WAL 原 bytes，先以该原始 create/null-target 事务证明合法空原文集合可只读重建，再分别拒绝 files[].ref 越界、foreign capability 路径和为原本不存在的目标编造原文；原 WAL/Run 不变且没有创建文件。没有用当前 WAL 缺 hash 的无关错误假装命中了路径校验。这些输入安全没有随旧摘要重建机制一起退休。

本轮未执行仓库主文件整轮、全量、build、安装或真实平台 Hook，也未启动模型/Eval；Windows 文件 symlink 权限仍缺本机证据。Temp 确定性 SDK/Git/公开归档恢复、当前源 WSL file-symlink 的结果分别报告，没有相互替代。

## 24. 最终 repo-ready 交付与并行修复补齐（2026-11-11）

第 23 节后继续逐行为核对，确认旧 `native-299-real-integration-parent-verify` 大组还要求并行 Child 与迟到 Verifier 不得绕过集成修复，以及连续两次 integration-repair 失败后的原工作/批准保护。普通顺序 DAG 八组不能代替这些断言，现有组合应用成功一次 repair 也不能代替。已按主 Agent 要求补完同一当前公开组合应用原型，没有将这些业务标记退休。

`parallel-repair.test.ts` 复用当前 `prepareNativeApplication` 的真正磁盘应用、公开 runtime dispatch、逆序 Child review 与真实 Git 工作树/Node review。以实际 integration extension fail 产生当前 repair，不构造旧 check。完整原型通过 1 项，约 75.4 秒，结果 `parallel-results.json`。

增强的原要求逐项断言：

- 两个独立 Child 原 Builder/Review；迟到的 left Verifier 完成后，在 right integration review/repair 尚未解决时不创建 left integrate。
- 第一 repair 原 claim 真实记录 failed，保留原 Action/outcome 与 Shape 批准，重新通过公开固定应用加载/inspect 后仍等待原提案；批准该 proposalHash 才创建绑定原失败 Action 的后继 repair。
- 第二 repair 再次 failed，未提交的 integration-repair.txt 原文字节保留，新 Wait proposalHash 与第一次不同。
- 用第二 Wait ID 搭配第一 proposalHash 拒绝，Run 深比较完全不变，partial 文件保留；使用第二原 proposalHash 才继续。
- 最终 repair 仍绑定第二个原失败 Action，前两次失败记录、原成功 merge、原 Shape 批准完全不变。提交实际修复后再次 extension review，未解决 review 之前仍不创建 left integrate；随后完成原串行 Child archive/integrate，继续 Parent 修复及 Verifier。

Temp 中为避免 root build，fixture 通过只读 runtime-package junction 指向当前已构建仓库包，并显式使用该现有 helper 的 packaged 路径；未改全局安装或根 dist。实际节点是当前已构建公共应用入口，未使用旧 Factory/执行器。本轮没有执行新的 SDK Doctor 场景；主 Agent 正在修复的 Doctor 归属行为由其单独验证。

最终交付目录为 `C:/Users/BENYM/AppData/Local/Temp/comet-archive-current-failures-23fc53a4/repo-ready/`：

| 文件                                            | 应用方式                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `native-sdk-archive-failure-boundaries.test.ts` | 复制至 `test/domains/comet-native/`；12 项 Archive 失败面，主文件已保留的 sameclaim correction 不重复复制。                                                                                                        |
| `native-sdk-archive-input-boundaries.test.ts`   | 同目录；跨 capability、现行备份输入、真实旧只读材料、文件 symlink；相对 imports/冻结 fixture，无 Temp 观测写入。                                                                                                   |
| `native-application-parallel-repair-group.txt`  | 整体替换现有 `native-application.test.ts` 的 `binds reverse Child reviews, repairs integration in its worktree, and reviews the parent candidate`；保留当前 fixture 与原标题，增强原业务断言，避免新增重复长流程。 |
| `title-behavior-mapping.json`                   | 全部剩余人工旧标题→精确当前文件/selector/保留行为/单独退休机制；记录共享 Archive 的 21 个 case ID。没有将任何整 case 标 feature-removed。                                                                          |
| `README.zh.md`                                  | 路径、isolated HOME、应用范围、实际验证/未执行项。                                                                                                                                                                 |

增强后的组合测试原来属于 `local-native-supervisor-auto-preparation`，原自动准备断言仍保留；同时承担 `native-299-real-integration-parent-verify` 的原并行/迟到/重复 repair 批准安全。实际 Temp 标题为 `preserves parallel Child ordering and original integration repair decisions after repeated failures`，repo-ready 仅恢复上述现有标题，测试主体不变，manifest 明确记录这项映射。

两份 repo-ready 新文件已移除绝对源码路径、旧 Factory 及无用 legacy 参数，使用仓库相对 imports、根 Vitest 的 runtime-home 隔离、仅 mkdtemp 项目及清理。最终实际证据为 22 个唯一通过场景：第 23 节 21 项加本节并行增强 1 项；Windows file symlink 两项仍单列跳过，WSL 真实 link 两项通过不是 Windows 权限证明。该数量是最小多轮证据合并，不是一次主文件/全量运行；root 应在整合后运行 repo-ready 文件与增强组的定向测试及 registry 验证。

## 25. 四份剩余 Native SDK 测试的当前业务迁移矩阵（2026-11-11）

仅在独立 Temp 做当前公开应用/SDK/CLI 原型，没有改产品、仓库测试或 registry。原50声明来自冻结的 remaining-test-retirement-spec-review-20261111.json，四文件分别19/10/11/10；逐声明保留业务，展开65个唯一业务项均取得多轮最小定向通过证据。精确路径：

- 原型、首轮RED与修正GREEN：`C:/Users/BENYM/AppData/Local/Temp/comet-native-remaining-business-944220fe/`。
- 可整体应用的四份同名文件：`C:/Users/BENYM/AppData/Local/Temp/comet-native-remaining-business-944220fe/repo-ready/`。
- 全50条原标题→当前selector→case IDs→业务/退休机制→实际结果：`repo-ready/title-behavior-mapping.json`。没有整case标feature-removed。
- 原始声明/断言备份：`original/`、`spec-declarations.json`、`title-index.json`；原JSON含源码和原断言，不能用当前happy路径冒称旧版本证据。

### 25.1 实际矩阵和公共业务边界

| 文件                                            | 当前展开项 | 实际证据                                                                                             |
| ----------------------------------------------- | ---------: | ---------------------------------------------------------------------------------------------------- |
| native-sdk-supervisor-verifier-recovery.test.ts |         12 | verifier-results-2.json：12通过，0失败                                                               |
| native-sdk-verification-inputs.test.ts          |         15 | inputs-strong-results.json：15通过，0失败                                                            |
| native-sdk-blocked-recovery.test.ts             |         27 | blocked-all-results.json首轮20通过/7失败；blocked-fix-results.json对应7通过/0失败                    |
| native-sdk-supervisor-revise.test.ts            |         11 | revise-all-results.json首轮8通过/3失败；业务停靠点修正后2通过，最终2通过（其中首项重跑），共11唯一项 |

这不是一次整合后四文件运行。repo-ready相对imports另做collection-only：65项可收集、故意65跳过、0收集失败，不能与上表混为测试执行。Current fixture中平台命令由模拟Agent明确执行，Node/Git和磁盘Skill是真执行；Shape/结果批准、Builder/Verifier协议为明确模拟。当前业务独立claim绑定与恢复Wait由 [native-sdk-application.ts](../../domains/comet-native/native-sdk-application.ts:637)、[同模块Child recovery](../../domains/comet-native/native-sdk-application.ts:1233)承担，未恢复旧检查图。

三个CLI停靠点已按真实当前行为调整，原安全断言完整保留：同commit integration通过公开runtime execute原Action止于Archive前；HEAD漂移通过原Shape Wait公开resolve止于prepare，再验证next/execute/claim拒绝；dirty Child长修订通过原结果Wait公开resolve止于parent.deliver，再检查compact query/status和真实Archive dry-run。额外真实CLI accept-result尝试确实完成Parent deliver和Archive，随后cleanup因测试故意留下的right dirty文件拒绝并unknown；[cleanup源码](../../domains/comet-native/native-sdk-supervisor-cleanup.ts:151)与冻结revise-archive-error.json一致。未删除dirty文件，也未把这个安全拒绝伪称Archive损坏。

### 25.2 历史completed+blocked：独立未复现，不能随当前业务替换关闭

真实npm0.5.2公开Native@1 Factory与原CLI完成Shape批准、真实Git Child Builder、实际无副作用Node0检查、独立模拟Verifier blocked后，原Run为running，原build-revision:9 Child Builder pending。原始完整数据genuine-052-completed-blocked.json及当前纯adapter+factory观察genuine-052-completed-blocked-adapted.json保留；historical-observed-facts.json逐核心字段深比较原Action/claim/input/outcome/receipt/批准不变。初始探针要求completed的断言失败，historical-results.json原样保留，不能写成completed旧Run已验证恢复。

真实052 [旧工厂dist](C:/Users/BENYM/AppData/Local/Temp/comet-052-cli-package-626acda290b5479fb72b05334de5c0e5/package/dist/domains/comet-native/native-sdk-application.js:1613)及本机未改动0.5.3 [对应旧工厂](D:/nodejs/node_modules/@rpamis/comet/dist/domains/comet-native/native-sdk-application.js:1607)均已为Child fail/blocked创建repair Builder。原测试第0项标题虽写completed，却没有断言必须completed；第1项历史防护断言只在before.status===completed时执行（冻结original/native-sdk-supervisor-revise.test.ts:536）。当前矩阵保留真实running分支及全部修复/已集成Sibling/原失败记录；completed-only旧inspect/recovery和基于日志/HEAD指纹生成恢复提案的机制应单列退休审查，真实completed历史状态仍未得到来源。当前 [upgradeNativeRun](../../domains/comet-native/native-sdk-run-upgrade.ts:126)不会把completed Run随意重开；本轮没有伪改Run.status制造成功，也没有恢复旧factory。

### 25.3 原标题逐项映射

以下每行的原声明序号对应冻结title-index；完整原标题、精确可运行selector和逐参数证据在上述JSON。所有共享case的其他安全行为仍需保留，不能因某行无直接case ID就整case删除。

#### blocked-recovery

| 原序号/标题                                                                                                                                  | 当前保留业务                                                                                                                                                              | 单独退休或停靠点变化                                                                                                                                | 直接case IDs                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0 `recovers a branch rename followed by implementation changes without replaying one-shot checks`                                            | 原分支改名+Agent确认实现编辑；同Run明确修订，原检查一次计数不重放。                                                                                                       | 内容指纹和Runtime检查执行收据不再作为推进权威。                                                                                                     | `native-branch-and-archive-repair-combination`                                                 |
| 1 `keeps Archive and Doctor read-only after an Agent-accepted edit without content proof`                                                    | Archive/Doctor只读，候选和实际文件保留，诊断不写Run。                                                                                                                     | 历史内容证明/快照扫描入口删除。                                                                                                                     | `native-archive-readonly-candidate-diagnostics`                                                |
| 2 `repairs an implementation edited after Archive approval through explicit revision and original Shape`                                     | 原Shape批准保留；Archive后经明确实施修订→新Builder/Verifier/新结果批准→实际Archive。                                                                                      | 归档前自动重验旧检查移除。                                                                                                                          | `native-archive-implementation-repair-continuation`                                            |
| 3 `hands the existing user revision to the successor Builder without requiring a rewrite`                                                    | 已有用户修改交给新Builder，真实命令观察原修改，不要求重写。                                                                                                               | 仅删除受管检查Action，命令由模拟Agent平台真实运行。                                                                                                 | `manual-recovery-native-implementation`                                                        |
| 4 `retains business status and candidate details when Archive is rejected before acceptance`                                                 | 未批准不能Archive；业务phase/status/candidate完整且无写入。                                                                                                               | 删除旧检查运行器诊断字段。                                                                                                                          | `native-archive-failure-business-state`                                                        |
| 5 `finishes pending accepted-result revalidation before Archive without consuming another Verify failure`                                    | 原已批准结果进入Archive，失败iteration计数不增；原批准记录保留。                                                                                                          | verify.revalidate内部Action已退休；用原Wait公开resolve停在archive.prepare。                                                                         | `native-archive-awaits-accepted-revalidation`                                                  |
| 6 `ends a misclaimed Verifier as failed and archives through an independent replacement without repeating checks: %s`                        | running/changed-requirements/unknown原误领Verifier，拒绝自验pass/blocked和错claim；原claim真实failed，同请求幂等，新独立Verifier及批准完成Archive，原候选/报告/计数不变。 | 不再补受管检查executionStop；raw SDK明确模拟原错误领取，当前Native领域领取入口仍拒绝自验。                                                          | `native-verifier-failure-original-claim`                                                       |
| 7 `recovers an interrupted Archive through its emitted CLI command after removing an occupied destination without replaying checks or Specs` | 实际Archive目标占用后返回公开--recover命令；去掉占用后原Run恢复并重复幂等；无Specs/检查重播。                                                                             | 只删除旧checker收据复核。                                                                                                                           | `native-interrupted-archive-command-recovery`, `native-completed-archive-recovery-idempotency` |
| 8 `executes the exact advertised %s command from the advertised state`                                                                       | 逐个执行广告的retry/implementation-revise/requirements-revise原命令，原状态前置条件和一次计数保留。                                                                       | 受管check-stopped元数据不作为授权。                                                                                                                 | 无直接匹配；不代表无共享行为                                                                   |
| 9 `retains candidate and one-shot check evidence through cold reopen, retry, and independent acceptance`                                     | 另进程冷重开，原candidate/Action报告保留，原retry决定后独立验收。                                                                                                         | 旧可执行检查模块不再加载。                                                                                                                          | 无直接匹配；不代表无共享行为                                                                   |
| 10 `offers only executable decisions after recovered one-shot checks pass (%s)`                                                              | 原三项批准/实施修订/需求修订逐一真实可执行；陈旧state和不支持choice/forged命令拒绝，原Run不变。                                                                           | 旧repeatable=false禁止独立Verifier重试已退休；当前明确复核重试允许且不自动执行命令。                                                                | `native-one-shot-retry-capability`                                                             |
| 11 `uses only the current ordinary candidate retry capability after leaving Supervisor (repeatable=%s)`                                      | 离开Supervisor后使用当前普通候选、真实Agent命令和当前Wait；两种旧repeatable输入均可独立复核且Builder/一次性操作不重跑。                                                   | 旧计划repeatable标志控制Runtime verifier retry能力已退休；不存在检查executor。                                                                      | `native-one-shot-retry-capability`                                                             |
| 12 `rejects stale proposal, state, and used outcome identities without dispatching a duplicate`                                              | 陈旧proposal/state、原已用claim/outcome身份拒绝，无重复Verifier。                                                                                                         | 无业务断言退休。                                                                                                                                    | 无直接匹配；不代表无共享行为                                                                   |
| 13 `upgrades an existing 0.5.0 blocked Run without rebuilding candidates or replaying checks`                                                | 当前原blocked Run只读重开并retry，原全部Action/Wait/候选/一次计数保留。                                                                                                   | preCheckRecoveryApplication合成0.5.0旧hash与旧factory显式升级按钮退休；不冒称本项证明真实0.5.0自动转换。真实发布数据另由published-upgrade矩阵覆盖。 | 无直接匹配；不代表无共享行为                                                                   |
| 14 `repairs an upgraded 0.5.0 blocked Run across shell changes without repeating original checks`                                            | 当前blocked原Run跨shell实施修订，原Action/候选/一次计数保留。                                                                                                             | 合成0.5.0旧检查器恢复机制退休；真实052跨shell/history另有实际样本。                                                                                 | 无直接匹配；不代表无共享行为                                                                   |
| 15 `executes the advertised Supervisor parent %s without changing completed Child work`                                                      | Supervisor parent retry/implementation修订各自执行，已完成Child全部outcome及原Parent Builder报告不变。                                                                    | 原父checks Action计数改绑定实际Parent Builder报告；不存在旧checks运行器。                                                                           | 无直接匹配；不代表无共享行为                                                                   |
| 16 `executes the exact advertised Runtime decision with its reason and preserves proposal binding`                                           | 广告的SDK decision保留reason/proposalHash，原Wait结果唯一，新Verifier activation引用原Wait和reason，重复决定拒绝。                                                        | 无业务断言退休。                                                                                                                                    | 无直接匹配；不代表无共享行为                                                                   |
| 17 `uses explicit implementation repair after an Agent judges edits without replaying original checks`                                       | Agent确认真实编辑后明确实施修订；读取不暗中推进，原一次操作不重跑。                                                                                                       | 内容快照自动判定编辑范围退休。                                                                                                                      | 无直接匹配；不代表无共享行为                                                                   |
| 18 `keeps the current Supervisor Child blocked repair executable without reusing its Verifier`                                               | 当前Child blocked结果保留，新Builder可领取，重复next不重复Verifier、不复用旧Verifier。                                                                                    | 旧completed分支另行取证，不声称当前v4证明历史恢复。                                                                                                 | 无直接匹配；不代表无共享行为                                                                   |

#### supervisor-revise

| 原序号/标题                                                                                                                                  | 当前保留业务                                                                                                                                                                | 单独退休或停靠点变化                                                                                                                  | 直接case IDs                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 0 `recovers a completed Supervisor Build after an independent Child reports blocked through the public CLI`                                  | 原Child blocked后明确需求修订，原Run/定义/全部已完成Action保留，返回未批准Shape。                                                                                           | 标题completed并无原硬断言；npm052真实Native1运行结果是running+repair Builder。completed-only历史分支单独未复现，不能当已覆盖。        | 无直接匹配；不代表无共享行为 |
| 1 `recovers a blocked Child with a successor candidate without replaying an integrated sibling or reusing historical checks as new evidence` | 失败Builder原Wait继续，独立Verifier blocked→新原Child repair Builder；保留已集成Sibling、原failed/blocked Action；真实修复commit与新Agent命令报告绑定新candidate。          | 旧completed inspect/recovery端口和基于日志/工作区指纹的恢复提案退休；当前pending Builder正常业务保留。历史completed状态来源单独待证。 | 无直接匹配；不代表无共享行为 |
| 2 `revises a quiescent Supervisor Build through the candidate public CLI without changing its original definition`                           | quiescent Build经实际公开CLI需求修订，Run/定义身份原样，原批准不自动重新批准。                                                                                              | 只删除check-stop补证。                                                                                                                | 无直接匹配；不代表无共享行为 |
| 3 `executes the actual returned Shape continuation with summary and guards without implying user confirmation`                               | 实际返回的Shape命令含summary/guards，执行产生待批准提案，未隐含批准。                                                                                                       | 无业务断言退休。                                                                                                                      | 无直接匹配；不代表无共享行为 |
| 4 `reintegrates an already included Child after public Shape reconfirmation (same)`                                                          | 同candidate重新确认Shape后真重验、新独立Verifier、原Git integration receipt/base/head不重做合并，随后实际Child Archive。                                                    | 停止点改公开runtime execute原integration，避开native next自动Archive；原checks运行步骤改Agent实际命令。                               | 无直接匹配；不代表无共享行为 |
| 5 `preserves integrated and uncommitted Child work, then rechecks every Child in the new Shape cycle`                                        | 保留已集成、dirty Child及原Archive五文件/commit字节；新Shape全Child新Builder/Verifier/集成；Parent独立报告、原结果批准、compact query/status上限、dry-run真实delivery绑定。 | 受管检查计数改实际Builder/Verifier/集成各两轮；仅verify.report内部Action/stop proof退休。                                             | 无直接匹配；不代表无共享行为 |
| 6 `rejects Build revision while a Child is %s and retains its original claim`                                                                | Child running/unknown都拒绝需求修订，原claim/Run/Git现场完全不变。                                                                                                          | 不制造或要求历史进程停止回执。                                                                                                        | 无直接匹配；不代表无共享行为 |
| 7 `blocks a retained integration HEAD change without resetting Git or accepting the old checks`                                              | 保留integration HEAD漂移时，公开next/底层execute/claim均拒绝准备，Run/HEAD/worktree/config不变，无新Child Builder。                                                         | 以原Shape Wait公开resolve停在prepare，避免CLI确认自动触发执行；旧checks无效化判断移除。                                               | 无直接匹配；不代表无共享行为 |
| 8 `transfers repeated preparation receipts once per actual workspace without losing history or dirty files`                                  | 重复prepare receipt按实际workspace仅物化一次，传输后原历史/dirty文件保留；已有Archive材料回填和冲突反例保留。                                                               | 无业务断言退休。                                                                                                                      | 无直接匹配；不代表无共享行为 |
| 9 `retains a genuine failed Child outcome and resume decision when Build returns to Shape`                                                   | 原失败Child outcome和resume决定在Build→Shape需求修订时保留，未悄悄继续或改原结果。                                                                                          | 仅历史check停止证明分支删除。                                                                                                         | 无直接匹配；不代表无共享行为 |

#### supervisor-verifier-recovery

| 原序号/标题                                                                                                                 | 当前保留业务                                                                                                            | 单独退休或停靠点变化                                                                | 直接case IDs                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 0 `preserves a real custom application failure and receipts, advances its sibling, and retries only its review`             | 真正磁盘custom Skill失败、同Sibling继续，原failed Action/claim不可变；用户retry只重做review，原candidate review不重做。 | child.checks执行与收据计数退休，当前候选review一次；当前checks对象报告保留。        | `local-native-supervisor-auto-preparation`, `issue-389-child-evidence-retry` |
| 1 `uses the same recovery Wait for the built-in Native Supervisor`                                                          | 内置Native同样原failed Verifier→原verifier-retry Wait→新Verifier。                                                      | 不依赖checker。                                                                     | `local-native-supervisor-auto-preparation`                                   |
| 2 `offers a new Builder repair without changing the original execution failure`                                             | 用户repair创建新Child Builder绑定failedVerifierActionId，原failure不变。                                                | 不依赖checker。                                                                     | 无直接匹配；不代表无共享行为                                                 |
| 3 `keeps an unknown verifier bound to its original task and creates no retry Wait`                                          | unknown原任务不可retry、Doctor不可重放或改unknown；原claim报告实际failed后才出现一个恢复Wait。                          | 不要求旧worker/PID/停止证明；不伪造停止。                                           | `issue-389-child-evidence-retry`                                             |
| 4 `never advertises a pending claim for a failed or completed Run`                                                          | failed/completed Run只读投影不广告pending claim。                                                                       | 纯模型反例，不伪造persisted progression。                                           | 无直接匹配；不代表无共享行为                                                 |
| 5 `transfers an old fixed custom definition without changing its hash or losing dirty Child work`                           | 真实当前fixed app导出/导入，definition identity/hash、dirty Child原字节和历史保留。                                     | 合成pre-verifier-recovery旧工厂与旧内置v2加载机制退休；本项不冒称旧固定包自动兼容。 | `local-native-supervisor-auto-preparation`                                   |
| 6 `diagnoses without writing and explicitly migrates the known failed definition while retaining identity and sibling work` | 当前fixed失败review只读重载/Doctor不写，原identity/Sibling/Wait保留；用户批准原Wait后可继续。                           | 特定旧hash显式migrate/旧factory修图机制退休。                                       | 无直接匹配；不代表无共享行为                                                 |
| 7 `preserves a sibling ready token after the original running Builder truthfully reports failure`                           | 并行running sibling原claim如实failed后，两条原用户Wait同时保留，各自业务可恢复。                                        | 旧deferred-ready-token特定内部实现退休；不把失败Sibling丢弃。                       | 无直接匹配；不代表无共享行为                                                 |
| 8 `creates one recovery Wait per original failed Verifier when both independent children failed`                            | 两个独立Verifier都真实failed，每个原failure仅一Wait，重复next无重复Wait。                                               | 旧修图migrator删除，失败业务不删。                                                  | 无直接匹配；不代表无共享行为                                                 |
| 9 `restores a checkpoint-only old fixed application on the first writable load while read-only inspection stays unchanged`  | checkpoint-only fixed app只读拒绝且无写，首次writable恢复同Run/Action/Wait，不丢失败。                                  | 合成旧factory读取机制退休，当前checkpoint业务保留。                                 | 无直接匹配；不代表无共享行为                                                 |
| 10 `refuses unsafe old-run migration with %s and preserves its Run`                                                         | fixed-package内容被改拒绝且Run原样；running-sibling边界保留原claim/Wait且不重放。                                       | 旧一律禁止claimed迁移策略退休；当前有任务时不切换旧factory、不补check停止收据。     | 无直接匹配；不代表无共享行为                                                 |

#### verification-inputs

| 原序号/标题                                                                                                              | 当前保留业务                                                                                                                                                                                                          | 单独退休或停靠点变化                                                                                                                | 直接case IDs                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 `reports the exact invalid Builder field without misleading claim diagnostics: %s`                                     | 三参数精确字段诊断原正则保留：checks.result / review.evidence / review.note；拒绝值且不误称claim错误。                                                                                                                | Builder submittedAt旧必填生成字段此前已退役，原本参数数组不再含该项；对应case不可整case featureRemoved。                            | `native-builder-submitted-at-diagnostic`, `native-builder-check-result-diagnostic`, `native-builder-review-evidence-diagnostic`, `native-builder-review-note-diagnostic` |
| 1 `retains only the Agent-selected arbitrary check across a repaired candidate without language detection`               | 真实任意后缀文件分别计数；修复只跑选中left、沿用right报告，原候选报告/批准不可变。                                                                                                                                    | logRef/reusedFrom/check fingerprint运行器元数据退休；不按语言探测命令。                                                             | 无直接匹配；不代表无共享行为                                                                                                                                             |
| 2 `completes Archive after the Builder, Runtime checks and Verifier finish normally`                                     | 真实Node检查、Builder/独立Verifier/结果批准和实际Archive，目录/正式Specs/change移除完整断言。                                                                                                                         | verify.report/revalidate内部步骤退休。                                                                                              | 无直接匹配；不代表无共享行为                                                                                                                                             |
| 3 `accepts a final result from another shell with a different %s and unchanged inputs`                                   | HTTP_PROXY/PATH/TEMP三个实际shell环境变化都接受原独立验收并完成真实Archive。                                                                                                                                          | shell变量不再形成内容指纹拒绝。                                                                                                     | 无直接匹配；不代表无共享行为                                                                                                                                             |
| 4 `records a nonzero check that changes source as failed and returns to Build`                                           | 真实Node改源且exit7；独立Verifier失败报告原实际失败，返回原Build修复，不得归档。                                                                                                                                      | 失败checker Action改当前业务Verifier fail，无新执行器。                                                                             | 无直接匹配；不代表无共享行为                                                                                                                                             |
| 5 `does not replay a one-shot SDK command after the Verifier changes its ID and repeatable flag`                         | 退役request-checks别名请求早期拒绝，真实一次操作只一次、原candidate/Builder不变；同原Verifier claim纠正后合法完成Archive。                                                                                            | 请求检查/ID别名/repeatable绕过checker机制退休。                                                                                     | `native-check-no-alias-replay`                                                                                                                                           |
| 6 `accepts a persisted 0.5.0 check receipt in its original execution environment`                                        | 真正npm052冻结Run的原check outcome/input/claim只读保留，批准原样；实际已批准Archive续行由既有published Archive四阶段CLI测试覆盖。                                                                                     | 合成0.5.0 receipt/inputBefore,inputAfter校验器不再作为执行权威；不声称052样本具有更老缺字段。                                       | 无直接匹配；不代表无共享行为                                                                                                                                             |
| 7 `accepts original Runtime checks across shells while reading legacy content-proof fields as history`                   | 真正052原检查历史跨shell保留不重放，原Run/Wait不变；与真正四阶段published Archive CLI完成矩阵共同覆盖。                                                                                                               | legacy content-proof仅历史，旧检查器不恢复。                                                                                        | `issue-500-cross-shell`                                                                                                                                                  |
| 8 `A4 continues an Agent-reviewed behavior change from %s and retains only the unaffected one-shot check`                | Verify/Archive两入口真实行为1→2明确修订；Shape原批准/verification.md/原Builder与Verifier保留；新candidate/新独立Verifier/新结果Wait批准；只跑A两次而B一次，Archive一次完成，running continuation不误广告review-edit。 | 原check log/reusedFrom、verify.report Action及stop补证退休；业务结果记录保留。                                                      | `native-sdk-authorized-implementation-continuation`                                                                                                                      |
| 9 `refreshes an explicitly selected Git check after byte-identical staging and preserves one-time evidence and approval` | 真实git index byte-identical staging后exit1；bytes/HEAD不变、一次B不重做；明确实施修订→新失败Verifier阻止Archive，修复index只重跑Git→新独立Verifier与批准→实际Archive一次；原批准留历史。                             | 旧refresh-checks补充端口和无需新结果批准的latest-check-preflight机制退休；当前明确修订/验收触发与旧步骤不同，不能宣称完全相同步骤。 | `native-sdk-explicit-git-dependent-refresh`, `native-sdk-refresh-failed-preflight-recovery`                                                                              |

### 25.4 登记未匹配项和交付限制

源Spec的fileRegistry中blocked另有8个、verification-inputs另有14个登记引用未匹配本批50声明；这些原值已完整放入mapping.fileRegistry.unmatchedRegistryCaseIds，本批不声称覆盖或退休。Builder submittedAt旧必填字段的单子行为已退役，原参数数组实际只保留三个诊断；同case其他字段诊断仍实际通过。真实旧历史的正常归档完成与 [published四阶段CLI测试](../../test/domains/comet-native/native-published-archive-upgrade.test.ts:124)共同覆盖；不能拿四个happy样本代替本批65个失败/批准/claim/修订隔离分支，也不能拿052样本声称更老缺字段存在。

repo-ready已去掉绝对源码路径、Temp观测写入、旧factory imports和机器runtime-package参数，复用根Vitest [runtime-home隔离](../../test/helpers/runtime-home.ts:15)。本轮未运行根build、全量、安装、真实Hook或模型/Eval；研究原型实际成功不代替root整合后的四文件定向运行与registry Review。

最终另移除了当前 Child Verifier 测试报告中已无作用的旧 `integrationChecks` 可执行计划字段，`revise-no-retired-plan-results.json` 单项 1 通过/0 失败，同候选 integration/Child Archive 原断言仍保留。该重复验证不增加上述 65 个唯一项。

## 26. 最后三份旧 schema/transition/reliability 文件逐声明迁移（2026-11-11）

本轮仅Temp/报告，未改产品、仓库测试或registry。完整32声明及原断言/源码保存在 `C:/Users/BENYM/AppData/Local/Temp/comet-native-final-adjacent-4a1db85e/source-review.json` 与 `original/`。repo-ready含当前四文件、README和逐条JSON映射；旧三文件每项都有去向，没有整文件无声明删除。按原Spec审查明确退休4个纯机制声明，其余28项保留业务。

首轮补齐的18个当前展开项实际通过：schema-reliability-green-results.json为13/0（v1/v2四phase只读与显式导入8、未知/未来拒绝3、可靠性2），supervisor-final-results.json为3/0，transitions-counter-results.json为2/0；reused-guards-migration-results.json另有15/0。复用root已通过的portable29、loop29、transition36+Doctor13、verification20+Archive11和current SDK分组18的具体selector，不把原文件中仍存在但未实际运行的测试当GREEN。根正在运行的四SDK65整体结果不在本轮计绿。

当前Factory Child fixture使用两个Child（core覆盖A1/A2，tail依赖core），通过原Shape Wait明确批准。真实Node exit2不能伪报pass，原A1/A2缺失/重复/失败、错candidate/claim均拒绝；原claim纠正后只创建一次integration，Node0读取实际合并文件，原材料/Builder/批准保留且main不提前移动。原rc5 overlay自动补齐与Runtime checker计划/receipt/材料预算/停止生命周期单独退休；实际post-integration失败、迟到Verifier与两次repair批准安全复用第24节组合应用原型，不能用Child前置失败替代这些边界。

### 26.1 原批准业务旁路的 RED 与修正验证

原native-transitions第8声明要求legacy implicit Build在进入Verify前得到明确确认。本轮发现当前导入旁路：SIMULATED裸v1/v2文档phase=build、approval=implicit经真实Doctor --repair变成当前Build；随后当前submitNativePortableBuilderCandidate实际进入Verify，未发生完整Shape批准。两个红例和原输入/转换/结果分别为implicit-approval-red-results.json、implicit-approval-comet.native.v1.json/v2.json。没有伪造真实旧Run或claim。不能将这项与旧中间schema迁移executor一起退休。

源码根因是修改前的 [native-portable-migration.ts](../../domains/comet-native/native-portable-migration.ts:155)仅按旧phase决定目标Build，当前Builder信任这个业务边界。root现已采用最小修正：只有legacy.approval为confirmed才沿原phase映射到Build；implicit/null恢复Shape等待明确当前确认。已confirmed的八阶段导入矩阵与真实旧Run批准不应受影响。repo-ready红例还要求明确批准后合法Builder可继续Verify，不能用永远拒绝掩盖问题。建议稳定来源report:runtime-cleanup-native-implicit-legacy-approval，case ID native-legacy-implicit-build-approval；产品修正和登记由root处理。

### 26.2 32个原声明逐条去向

完整可运行selector、实际匹配参数结果和证据文件位于repo-ready/title-behavior-mapping.json。下表保留原题、业务和单独退役机制，旧字段格式不冒称等价业务证据。

#### native-schema-migration.test.ts

| 原序号/标题                                                                                                | 保留业务                                                                                               | 单独退休/边界调整                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 0 `projects a legacy change read-only and migrates it only during explicit doctor repair`                  | 只读status/show/Doctor及显式Doctor导入，原正文/历史材料不改、重复幂等。                                | 删除v1→v2→v3中间迁移及baseline创建；新导入直达当前v4。                                                          |
| 1 `rejects an incomplete migration baseline before changing legacy state`                                  | 纯baseline不完整/预算拒绝机制退役；当前大Markdown输入合法性已有Portable18证明。                        | 整声明按原审查featureRemoved；无当前快照budget替身。                                                            |
| 2 `projects a v2 change as migration-required in status and show without rewriting it`                     | v2只读status/show保持原字节，明确migrationRequired与Doctor原name。                                     | 旧中间schema版本写回不保留。                                                                                    |
| 3 `migrates a stable v2 %s state to v3 without changing its phase or revision`                             | v2 Shape/Build保持相应稳定业务边界；Verify重置到Build待新验收，保留材料，不自动继承pass。              | v3 phase/revision/Engine checkpoint同步格式退役，当前导入有意不继承旧Run状态。                                  |
| 4 `migrates a stable v1 %s state through v2 without leaving Run/state phase drift`                         | v1四phase按明确导入转换；旧Verify/Archive不继承pass，所有阶段不伪造Run/claim。                         | 旧通过v2的中间迁移、revision格式和失效证据清理器退役。                                                          |
| 5 `retreats a stable v2 Archive state to Build and synchronizes Run history exactly once`                  | Archive旧pass导入后为pending；真实已发生WAL原Run/批准/event/checkpoint通过Doctor恰好一次恢复。         | 原state_migrated/旧Engine再造事件格式退役；不将裸schema样本冒称真Run。                                          |
| 6 `retreats a stable v2 %s change to Build and lets the current runtime complete a fresh verified archive` | 旧Verify/Archive导入为待验收Build，正常当前候选/独立验收/批准/Archive仍能完成。                        | 不恢复旧scope/hash/check执行链；导入文档与真实原Run有不同证据边界。                                             |
| 7 `recovers a v2 Archive retreat interrupted after $label without duplicate migration events`              | 原已发生事务在prepared/yaml-committed和原Run/trajectory/checkpoint写入中断后可显式恢复且不重复原事件。 | 旧中间schema迁移的四个专属hook/新state_migrated事件退休；复用实际052当前portable迁移与普通转换WAL各自真实边界。 |
| 8 `fails closed when a prepared migration target is changed without its content hash`                      | 坏事务/错误推进数据拒绝并保留原业务文档/WAL；不会采纳伪造状态。                                        | 旧schema-migration.nextState内容hash校验器退役，不用新hash机制替代。                                            |
| 9 `does not continue a prepared schema migration over a pending v2 checkpoint journal`                     | 旧中间schema迁移不得越过checkpoint的专属执行流程退休；真实普通pending WAL仍阻止Archive/无消费。        | 按原审查featureRemoved，仅此旧机制；不执行或消耗原WAL。                                                         |
| 10 `recovers a migration journal when the state write completed before interruption`                       | state/YAML先落盘后中断的真实迁移事务可原样重入，原Run/批准/history保留且只恢复一次。                   | 不再恢复旧baseline及中间v2/v3迁移journal执行器。                                                                |
| 11 `fails closed on a schema that requires a newer runtime without rewriting it`                           | 未知schema/较新legacy protocol只读invalid、nextCommand=null，show/next/Doctor repair拒绝且原字节不改。 | 当前v4已是有效新协议；未来用v99或legacy v3 protocol99测试，不将v4误当未来。                                     |
| 12 `fails closed on an unsupported older schema without inventing a migration route`                       | 真正v0+minimum1不能编造迁移路线，原状态不改。                                                          | 无业务断言退休。                                                                                                |

#### native-transitions.test.ts

| 原序号/标题                                                                         | 保留业务                                                                                                               | 单独退休/边界调整                                                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0 `uses the concrete change name in receipt binding recovery guidance`              | 旧receipt refresh特定命令与formatter退役；现行Doctor广告仍包含真实change名。                                           | 按原审查featureRemoved，不恢复旧收据入口。                                       |
| 1 `does not write Run files when Shape guard fails`                                 | Shape空材料/guard失败不推进、不变业务状态，不产生批准。                                                                | 旧createNativeChange/run-state创建时机格式退休。                                 |
| 2 `blocks Shape before Build when a legacy baseline is incomplete`                  | 纯baseline不完整阻断机制退休。                                                                                         | 按原审查featureRemoved；不换名恢复扫描预算。                                     |
| 3 `advances Shape and Build with Engine state and idempotent evidence`              | 原Shape批准后Build、真实当前Builder后Verify；重放批准/结果不重复推进；原真实WAL事件只提交一次。                        | 旧Engine run_id/revision/evidence hash格式退役，SDK Run保持原身份。              |
| 4 `rebuilds a missing Build Runtime without pretending verification survived`       | 缺本地SDK存储用当前checkpoint恢复原Run，外部原claim为unknown而不假装pass；裸旧Build导入pending。                       | 不复建旧baseline、旧Run新ID或检查器。                                            |
| 5 `rebuilds a missing Shape Runtime before applying the requested Shape transition` | 旧Shape材料只在明确Doctor导入后形成当前等待批准边界；无implicit next迁移。                                             | 旧自动重建Shape Runtime/旧Engine身份生成退役。                                   |
| 6 `returns a missing %s Runtime to Build and clears stale verification bindings`    | 缺失Verify/Archive执行信息不能让旧pass存活；原SDK claim/checkpoint保留，旧文档明确重验。                               | 不删历史证据正文，不凭名字重建旧Runtime。                                        |
| 7 `requires explicit shared-understanding confirmation in %s mode`                  | sequential/batch两种用户选择都必须当前完整Shape批准，重复/陈旧决定拒绝。                                               | 无批准业务退休。                                                                 |
| 8 `requires a legacy implicit Build state to be confirmed before Verify`            | 原implicit legacy Build必须重新明确批准才到Verify；v1/v2两条实际RED后由root修正，13项矩阵GREEN含明确批准后的合法推进。 | 不能以Doctor --repair代替业务Shape批准，不能把这项标featureRemoved。             |
| 9 `blocks a changed approved contract until Build explicitly re-confirms it`        | 需求变更须明确回Shape并得到新批准，新candidate新结果绑定，原批准留历史。                                               | 自动内容hash/contractHash观察与scope bundle格式退役；Agent判断变更后走显式修订。 |
| 10 `records explicit confirmation from Shape and rejects it in Verify`              | Shape明确批准可记录；Verify误用Shape确认必须拒绝且不改状态。                                                           | 无批准断言退休。                                                                 |
| 11 `returns Verify failures to Build and preserves report evidence`                 | 失败回Build，原失败报告/历史保留，不因文件编辑或重放变为pass。                                                         | 旧evidence envelope与evidenceHash幂等格式退休。                                  |
| 12 `explicitly returns a fresh Verify change to Build without counting a failure`   | fresh Verify显式实施修订回Build，原Shape批准保留，不计语义失败。                                                       | 旧partial_allowance/implementation_scope/typed verification refs字段退休。       |
| 13 `explicitly returns an Archive change to Build and invalidates its pass`         | 已批准Archive显式实施修订撤销当前pass，保留原批准历史，再独立验收和新批准才能Archive。                                 | 旧typed scope/partial字段退休；同Run候选绑定保留。                               |
| 14 `advances Verify pass to the Native archive command without reasoning fields`    | 正常当前验收与批准后可Archive，不要求reasoning/thought字段；Verify确认误用拒绝。                                       | 旧advanceNativeChange verificationResult/evidence入参和退回专属错误退役。        |

#### native-reliability-regressions.test.ts

| 原序号/标题                                                                                                              | 保留业务                                                                                                                             | 单独退休/边界调整                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 `selects a proven archive across worktrees, preserves duplicate provenance and isolates corrupt archives`              | 显式projectRoot选择真归档；显式Git导入原Archive后本地来源可验证；腐坏档案隔离、等价来源不污染、篡改旧副本仍拒绝。                    | 自动跨worktree查找/选择归档及localExecution overlay状态字段退役。                                                                                                                             |
| 1 `audits reference sync and preserves unaffected passes while rejecting semantic and stale updates`                     | 原issue391全部输入校验/审计/受影响A2重置/未受影响A1保留/Markdown fenced示例不改/陈旧及语义更新拒绝全部保留。                         | ordinary next未知schema改Doctor指引；schema与protocol细节由只读status核对。                                                                                                                   |
| 2 `records %s without a check receipt and rejects unsafe check plans`                                                    | Child fail/blocked无checks收据也如实记录，不生成成功merge，原candidate/批准保留。                                                    | 旧repeatable执行计划校验及ready/needs-reverify overlay标志退役，当前产生原失败Verifier关联的新Builder。                                                                                       |
| 3 `requires Runtime checks and complete child acceptance, retains original material and integrates with executed checks` | 实际exit2不能pass；Child A1/A2缺失/重复/失败矩阵、错candidate/claim拒绝，原材料保留；同claim纠正后只集成原候选一次，main不提前移动。 | rc5受管overlay字段补齐、checker材料预算/PID/停止/receipt replay/执行计划repeatable guard及自动integration-check触发器退役。当前组合应用连续repair/迟到Verifier/批准安全另已有第24节精确实证。 |

### 26.3 应用与证据限制

用expanded native-legacy-schema-import.test.ts替换root已有两条裸schema测试，按13条映射Review后删除旧native-schema-migration混合文件，避免重复；另外替换旧transitions/reliability并新增native-sdk-supervisor-acceptance.test.ts。原唯一直接登记issue-391-reference-sync保留完整输入校验、审计、未受影响A1 pass、受影响A2 pending、Markdown代码块示例不变以及语义/陈旧更新拒绝。归档观测改显式projectRoot或显式Git导入真实原Archive；本地祖先来源证明、旧副本篡改拒绝及腐坏归档隔离保留，自动跨worktree查找和localExecution overlay状态字段退休。

裸v1/v2样本是明确SIMULATED业务文档，不能称真实旧Run迁移。真实原Run/claim/批准/实际WAL不重放由现有公开fixture矩阵分别承担。未恢复旧factory、旧schema/check执行器、baseline预算或partial allowance；未运行根build、全量、模型/Eval或安装。初始2 RED报告保留；root修正后schema-approval-fixed-results.json完整13/0，已confirmed八阶段与未来三个拒绝没有回退，implicit两条均先拒绝无批准Builder，再明确批准后合法继续。新增当前业务共20唯一项全部通过。固定名观察文件在复测时更新为GREEN，另存fixed命名，不将其冒称原RED字节冻结。

第26节最终相对imports收集验证为20项、0收集失败、故意20跳过，不计业务GREEN。四份repo-ready与映射均通过Prettier；根整合后的定向运行与登记由root完成。

## 27. App Native dispatch 最终业务迁移与单次错误聚合（2026-11-11）

App原17声明全部保留对应业务，当前仓库 `coverage/native-builder-aggregate-final-results.json` 实际48通过、0失败：App17、原loop29、公开CLI structured readiness2。原完整17声明冻结在 `docs/research/2026-11-11-platform-execution-retirement/app-dispatch/original-native-runtime-dispatch.test.txt`。最终逐声明/原caseID/当前精确fullName映射位于 `C:/Users/BENYM/AppData/Local/Temp/comet-app-dispatch-prototype-20261111/registry-final-three/final-title-behavior-mapping.json`。未把任何mixed case整条标记featureRemoved。

### 27.1 保留的结果协议、批准和纠正行为

当前v4领取只提供实际 `resultRequest`，receipt绑定原Run/Action/attempt/inputHash/claimToken；compact仍完整保留原Action/state/input，活动索引通过 `outcomeRequestRef: resultRequest` 复用模板，不恢复outcomeRequest/failureOutcomeRequest/checkRequestTemplate重复投影。原始完整SDK outcome协议仍支持，需明确outcomeId的回归只在测试端解析本次真实receipt，不新增领取或产品模板。实现见 `domains/comet-native/native-sdk-continuation.ts:234`、`:295`、`:338` 及 `app/commands/runtime.ts:180`、`:211`。

旧managed Build checks改由模拟Agent实际运行Node并核对真实stdout，通过原receipt回报checks结果，保原候选并创建当前Verifier。只退休build.checks/verify.checks管理任务、旧执行计划和额外Builder循环。报告相关声明仍核对原Verifier结果、显式用户批准、不提前Archive、重复回报幂等、SDK单次操作与CLI details边界，以及真实文件写失败后next补写阅读view。旧report Action pending/unknown与暂停批准的内部调度机制退休；阅读view补写见 `app/commands/runtime.ts:1177`。

同一Builder请求内错误的 `acceptanceReview[0].evidence`、空note、未知B1/缺A1、非法 `checks[0].result` 必须在同一个message全部列出，并包含outcomeId纠正指引，不能拆成多轮提交。回报失败不推进原state或改变原claim，拒绝ledger保留；同outcomeId改内容仍得到OUTCOME_CONFLICT并提示“新的 outcomeId”，原claim用新ID纠正可成功。另保“空review缺A1+坏check”的混合反例，不能因保留incomplete错误类而吞掉检查错误。只有verificationChecks的argv/timeoutMs/repeatable等旧执行计划字段退休。Review期间提出的7次独立请求替代方案已撤回，不属于最终实现或case迁移。

显式 `requireIndependentReview: true` 的Verifier新领取必须在Builder同会话进入running前被拒绝，原Run不变，随后真正独立会话可领取原Action；默认允许同会话的选择仍保留。原错误代码继续为VERIFIER_SESSION_NOT_INDEPENDENT；CAS薄校验见 `domains/comet-native/native-sdk-state-store.ts:521`。错层级结果指引和App断言使用实际 `resultRequest` / `result.output`，保原Action/claim并纠正，不要求重新执行。

### 27.2 解析只在现有业务边界聚合

`native-sdk-application.ts:554` 不再先map检查并遇首错抛出，或先parse review后在loop再parse；它将业务数据交给原 `submitNativeBuilderCandidate`。`native-loop-runtime.ts:194` 在该边界收集review parser和checks字段错误后一次报告；`native-builder-acceptance-review.ts:34` 的原parser收集各字段错误，并补原ID集合未知/缺失信息，没有新建预检层、框架、缓存、快照或指纹机制。

单个原 `NativeBuilderAcceptanceIncompleteError` 且没有其他checks错误时，loop原样抛回捕获的error对象（`native-loop-runtime.ts:229`）；多个业务错误仍合并。该类身份是公开CLI协议的一部分：`native-cli-shared.ts:280` 应继续返回exit65、invalid-data和 `builderReadiness: {ready:false, missingIds, incompleteIds}`，原state不变。新增公开 `runNativeCli next --runner-input` 的缺失review/未完成review两个小临时项目用例，Agent/User明确SIMULATED，未恢复旧factory或检查执行器。

### 27.3 实际失败与通过证据

| 边界                         | 原失败与根因                                                                                                                     | 实际通过证据                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 同一请求全部业务字段诊断     | Temp `aggregate-red-results.json` 0/1，原代码只返回checks.result；先前7个独立请求不能覆盖原用户行为                              | Temp `aggregate-final-class-preserved-results.json` 1/0，原全部坏字段和混合incomplete/check均一次返回，原claim/两拒绝ledger/冲突及新ID纠正保留 |
| 公开CLI incomplete结构化诊断 | Temp `incomplete-cli-red-results.json` 0/2，首版候选包装原错误对象，误变exit73/conflict、丢builderReadiness并给出错误Doctor指引  | Temp `incomplete-cli-green-results.json` 2/0，实际公开next返回原code/missingIds/incompleteIds，原state不变                                     |
| 独立会话claim前拒绝          | Temp `independent-retry-results.json` 0/1；首版普通Error另被包装为RUNTIME_ERROR，保留 `independent-retry-green-results.json` 0/1 | Temp `independent-retry-final-results.json` 1/0，原RuntimeProtocolError代码与原Run不变/独立重试全部保留                                        |
| 合并后完整相关仓库验证       | 没有用单元消息通过冒充公开CLI结构化字段通过                                                                                      | `coverage/native-builder-aggregate-final-results.json` 48/0，App17+loop29+公开CLI2                                                             |

上轮Temp整组 `final-results.json` 的16通过+1失败原报告保留；首项精确失败为root同期build暂时移除dist、fs.access得到ENOENT，不计产品RED。构建完成后 `memory-final-results.json` 原真实CLI selector 1/0；最终仓库48/0又完整覆盖原首次记忆交付、同接收方一次、显式restore、新接收方独立application和未伪造adoption。最初root的一次memory unavailable缺少该真实CLI子进程独立stderr，未确认根因；不能把其他TS源测试的worker MODULE_NOT_FOUND当成它的根因。上下文仍为6000字符、2000ms预算（`app/commands/runtime.ts:446`），没有放宽或重试。

### 27.4 最终登记追加与限制

仅3个改名case追加tests-moved：native-build-managed-check-reuse、native-v3-compact-builder-result、native-v3-report-view-nonblocking。原case字段、既有链和mixed case其他targets全部保留；native-531-builder-batch-validation恢复原聚合标题和一次聚合业务，原精确selector不变，无需append。最终4artifact及hash、授权记录和安全逐ID CAS脚本位于 `C:/Users/BENYM/AppData/Local/Temp/comet-app-dispatch-prototype-20261111/registry-final-three/`；默认dry-run已完成schema和全部3条历史evidence链验证，子Agent未执行apply。混合case原两条静态断言的精确通过证据复用 `coverage/native-retained-business-current-built-results.json` 32/0。

旧Run自动兼容由真实发布冻结样本独立验证，不以当前v4新建夹具冒称旧v1/v3升级证据。子Agent只改Temp和研究记录；产品、仓库测试及后续构建由root整合。普通确定性公开SDK/CLI测试不替代真实平台Hook、安装、全量或Eval，本轮未执行这些项目。

## 28. 剩余 Native 文档、Guard 与业务恢复测试迁移（2026-11-11）

父任务列出的路径实际为11个文件，共113个原声明；最终仍是113个声明，130个展开用例均有真实GREEN，未整组删除或跳过原业务。子Agent只写Temp与本研究记录，产品和仓库测试由root整合。最终11文件、逐声明原文/当前body/行号/断言数/caseIDs/精确passed fullName映射、3项选择器追加建议位于 `C:/Users/BENYM/AppData/Local/Temp/comet-native-remaining-readers-20261111/repo-ready/`。完整原11文件另冻存在 `original/` 和 `source-review.json`，没有格式化原文。

| 文件                       | 原声明→当前声明 | 展开GREEN | 实际替换与保留范围                                                                                                                  |
| -------------------------- | --------------: | --------: | ----------------------------------------------------------------------------------------------------------------------------------- |
| native-artifacts           |             7→7 |         8 | SIMULATED历史原文档用于只读brief/spec/parser，完整brief/阻塞问题/fence/canonical base与两类symlink反例全保                          |
| native-diagnostics         |           17→17 |        17 | 保6个纯continuation模型和原只读状态业务；旧推进夹具改明确SIMULATED外部旧文档或真实052 prepared WAL+当前事务继续                     |
| native-findings            |             5→5 |         5 | 明确SIMULATED文档，保排序、用户决定、预算、坏checkpoint及Doctor能力映射                                                             |
| native-hook-guard          |           34→34 |        42 | 历史phase输入明确SIMULATED，当前正常流程用真实Portable/SDK；原全部Guard断言保持                                                     |
| native-phase1-matrix       |             3→3 |         3 | 保实际公开CLI init、真实root WAL继续/回滚、malformed fail closed与不扫描openspec                                                    |
| native-root-move           |           16→16 |        19 | 真正Portable创建，现有纯workspace identity API记录实际Git身份；原文件等价/branch fence/finish/旧绑定/未来schema/恶意替换/锁断言保留 |
| native-root-recovery       |           10→10 |        11 | 真正Portable创建；原copying/ready/switched/quarantine/manifest部分删除/篡改/超限/junction保护保留                                   |
| native-sdk-cancellation    |             6→6 |        10 | 保各阶段/固定应用/原claim/partialwork/晚回报拒绝/选择清理，退休stop握手与重复CLI整Run投影                                           |
| native-selection           |             3→3 |         3 | 真正Portable创建，保shared selection身份、缺失拒绝、junction前不写选择和外部目录                                                    |
| native-status-v4-discovery |             5→5 |         5 | 保坏authoritative Run、named过滤、Portable named/show/list、SDK与混合格式可查；改显式projectRoot，自动跨worktree搜索退休            |
| native-status-discovery    |             7→7 |         7 | 25项明确SIMULATED历史只读文档语料+真实SDK@4故障边界，原分页/cursor/未到页不读/坏项隔离全保                                          |

### 28.1 夹具不再构造旧流程

只读历史原文档和Guard输入使用已有 `test/helpers/native-change-document.ts:10`，明确SIMULATED，不表示真实旧Run或批准。普通当前业务使用 `native-portable-requirements.ts:218` 的真实Portable创建。root移动涉及原workspace侧文件身份时，另调用现有 `native-workspace.ts:592` 的纯身份写入API；不创建检查器、PID或旧状态机。二进制哨兵位于普通 `payloads/active-change/payload.bin`，不再把无state目录伪装为activechange，从而遵守当前创建隔离，同时保留原字节、事务与恶意替换测试。已退休native.snapshot默认值不恢复，其余配置精确断言保留。

Diagnostics旧advance依赖不恢复。待办普通转换直接加载真实npm052 afterPrepared冻结WAL；缺Run/缺整个Runtime案例先用当前 `continueNativeTransition` 完成原已发生事务再移除对应本机数据，保原状态仍可诊断，不新建Run或重放业务副作用。另一个“历史文档声称pass和旧report”的夹具明确为SIMULATED外部原始数据，读取不能把它当批准或允许Archive。旧格式指引改明确Doctor--repair。原6个纯legacy continuation断言仍完整保留，不拿它们证明当前新Run可以推进或绕过批准。

Status分页使用25个SIMULATED原文档，避免绕过当前同工作区单active需求保护；SDK异常页仍由真实当前4公共入口创建后仅在故障边界破坏workflow身份。v4 discovery的4个旧自动查找声明分别保留在显式root下的实际可查、named过滤及格式合并业务，`listGitWorktrees`不调用；不恢复扫描。当前只发现显式root的源码入口为 `native-status-discovery.ts:257`。

### 28.2 取消业务与清理诊断

业务调度取消后，普通claimed/unknown Agent任务不再要求stop回执才能释放Comet调度；原claim、原state/历史和partialwork保留，晚回报必须RUN_CANCELLED，新需求合法，重复cancel/settle不能破坏新选择。Comet明确不认证原进程已停止，Agent仍须通过平台核对任务与进程清理；测试验证不制造executionStop/cancellation.evidence。固定自定义应用保自己的store和application.id，并核对candidate.txt实际原字节。三阶段unstarted/approval/builder、两种running/unknown以及compact与完整SDK返回全部逐分支保留，只有旧停止握手/重复投影机制退休。

真实事务root锁与未清理选择仍必须阻塞。首轮10个旧取消预期失败中，root-lock case另外暴露了实际诊断遗漏：status为cancelling、cleanupRequired=true，held锁和原选择保留，但Doctor错误healthy=true。root复用已有取消观察，在 `native-sdk-diagnostics.ts:86` 补原 `sdk-cancellation-cleanup-pending`，其他未完成业务用 `sdk-cancellation-business-pending`，普通active不增加取消读取。原held锁字节、原Run/selection/age信息和Doctor healthy=false全部恢复；只在夹具原持有者释放自己的锁后沿原Doctor继续。显式故障状态是基础SDK真实cancel模拟已提交中断，不冒称真实旧发布Run，也不绕过新的正常CAS。

`cancel-current-business-results.json`完整10/0；`cancellation-root-cleanup-observation.json`保存真实status/Doctor/held锁观察。初轮 `hook-cancel-first-results.json` 的取消0/10保留，不能把退休机制的变化全部称产品bug。自定义应用application.id和实际文件原字节补回后，另单跑 `cancel-custom-identity-final-results.json` 1/0，不重复计数。旧createNativeChange第三创建入口物理删除；SDK与Portable两当前入口仍保未清理选择的禁止创建断言。

### 28.3 精确证据与登记

130个唯一GREEN来自按受影响边界分开的定向运行：`readers-first-results.json`中的4个简单文件19条、`status-refined-results.json`12条、`hook-cancel-first-results.json`中的Hook42条、`roots-refined-results.json`30条、`cancel-current-business-results.json`10条、`diagnostics-final-results.json`17条。只引用初轮报告中明确passed的精确文件/selector，不把含其他失败的整份初轮报告称GREEN。相对imports最终版本 `repo-ready-collection-results.json` 为130收集、0失败、130故意未选；只证明可收集，不计业务通过。候选文件及映射通过Prettier。

关联原caseID共10个：native-missing-trajectory-runtime-diagnostics、native-278-shape-brief-permission、native-root-move-released-sqlite-sidecars、workflow-simplification-t11-transaction-history、native-supported-version-cancellation-ownership、native-cancellation-pending-cleanup-diagnostic、native-v4-cancellation-workspace-release、native-236-linked-isolation、native-302-prepare-route、issue-372-isolated-status-error。

仅改名导致3项需要后续tests-moved追加：native-supported-version-cancellation-ownership、native-236-linked-isolation、native-302-prepare-route。后两是历史mixed case，其他isolation/workspace-preparation目标完整保留，不能whole featureRemoved；其他7个ID的精确selector未变不无谓追加。当前只有安全追加计划，未写registry或冻结未经Review的机制退休结论。

Temp自定义应用通过显式runtime-package junction复用现有dist，未执行根build；可复制版本恢复既有标准helper且无机器路径/观测写入。root整合后仍须运行实际仓库相关目标及所需构建，避免helper在并行测试中重建dist。未运行全量、Eval、安装或真实平台Hook，普通确定性公开CLI/生成Runtime验证不能替代这些边界。

## 29. 历史 Run 的共同恢复合同与原19组测试（2026-11-11）

本轮实际测试文件为 `native-sdk-history.test.ts`，发现合同也在该文件中；不存在第二个同名 discovery 测试文件。完整原19声明、原正文及原39展开行为已逐项映射为当前38展开分支。原专用导入日志、projection 发布、自动跨工作树搜索、停止回执及五秒进度定时器明确退休；原 Run、批准、claim、损坏拒绝、实际存储中断、重复恢复及较新本地记录不回滚均保留。普通业务夹具由当前 Native@4 创建，损坏外部数据明确标注 SIMULATED，真实0.5.2取消数据另由冻结发布样本测试覆盖。

交付目录为 `C:/Users/BENYM/AppData/Local/Temp/comet-native-history-current-20261111`。`repo-ready/title-behavior-mapping.json` 保存每个原标题、完整原 body、当前精确 fullName 和退休范围；`repo-ready/native-sdk-history-tests.patch` 是相对 imports、隔离 HOME、无临时观测写入的整文件替换。最终 `history-final-source-results.json` 为37通过、0失败、仅正式 bundle 一项未选；先前整文件 `history-current-proposed-first-results.json` 的37通过、1项真实 bundle 失败原样保留。该 bundle 仍使用未合入第二修正的分支绑定，不能记为通过。最后动态 import 恢复边界另有 `dynamic-boundary-targeted-results.json` 4通过。

三个实际问题已取得最小证据：closed history 正文损坏时 global Doctor 误报成功；同字节 active/history owner 双份无法沿显式恢复闭合；真实已批准 Shape、已领取 Builder 的取消 Run，在 Git merge 后删除原 linked worktree，公共 Doctor 仍因旧分支名拒绝恢复。前两项 Doctor 修正由根 Agent 整合；第三项候选只允许读取已取消原记录，活动 Run 仍不能跨分支恢复。未知当前定义必须在 owner/Run 落地前拒绝；Child lineage 限制只放在具名公共顶层恢复，不全局禁止父任务的 Child 存储。候选源码为 `native-portable-terminal-recovery.patch`，工厂及升级器只在实际便携恢复分支动态加载，不重建旧工厂或旧执行器。

共同恢复的7个实际中断分支分别注入 owner 发布前、发布后、checkpoint 写入后、历史 owner 闭合后、同字节 owner 双份、源改变及本地较新 revision；全部沿公开 Doctor 恢复并重复，核对原 Run、批准、claim 与源字节。原 Store closing/reopening 两项仍保留。便携协议会将 live claim token 转为 `portable-*`，因此恢复的原始存储记录与实际文件 `readPortableRunCheckpoint(..., { preserveSourceRevision: true })` 解码值比较，不错误要求仍等于 live token。

Archive 义务另做真实来源核对：控制器 `probe-published-archive-cancel.mjs` 物化真实 npm0.5.2 的 applied-finalize-pending Run 与已应用 WAL，再调用其公开 Native `runtime.cancel`；实际拒绝要求先完成原归档，原 Run 深等未变，见 `published-native-archive-cancel-attempt.json`。未复现正常 Native 产生的 cancelled 加未完成 WAL 输入，不扩展为绕过 Native 生命周期的 rawStore 场景，也不拿修改步骤名称的 SIMULATED 输入冒称真实归档副作用。既有真实发布 Archive/WAL 的恢复、原批准和不重放矩阵继续保留。

原7个 Native registry targets涉及6个 case ID。只有 guards、resume、preserve-worktree-authority 三个 case 的选择器改变，完整4份证据摘要及逐 ID CAS 追加计划在 `registry-three-case-payload/`；默认 dry-run 的 schema、证据、原字段及原链保留检查已通过，子 Agent 未执行 apply。另 orphan、closed-cancellation-binding、513-CRLF 三个 case 的原 runtime/bundle exact titles 保持，不无谓追加。父任务整合、构建后的正式38项结果应另外记录，不能以本轮37项源码证据代替。未启动 Eval、全量、模型、安装或真实平台 Hook。
