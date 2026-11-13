# Classic 普通检查改由 Agent 平台执行：删除闭包调查

日期：2026-11-10。调查基于当前 `053` 工作树；保留本轮已有差异。用户最终要求：普通工作流撤下受管检查执行器、进程监管/身份、停止握手、命令回执、检查专用恢复与快照兼容；保留业务状态、用户批准、任务权威与验收，并自动转换旧版本业务数据，使合法旧任务继续使用新的 Agent 平台执行方式。此前“旧 Run 可以停止支持”的调查假设已被该要求替代。

本次只读源码与登记，未修改产品、测试、生成物或安装目录，未运行产品测试、产品构建、真实 Hook 或 Eval；追加了一次系统 Temp 内的无执行器 SDK 探针，临时编译探针及两段候选校验替换，没有写入仓库 Runtime。下面区分可整体删除的执行模块与夹带业务能力的模块，避免靠删除文件名含 check 的文件完成表面清理。

## 核心结论

1. 新 Classic v2 已接受 Agent 平台检查报告，普通 Build/Verify 不需要 CLI 执行命令。但其工厂仍先完整构造 v1，再删受管步骤，旧执行代码仍被加载；只停调用不等于撤下闭包。
2. 受管入口不只有 `comet check run`：Guard apply、SDK 自动续行、raw runtime dispatch、旧 factory、组合应用、交付修复和恢复请求均能引入旧 executor。
3. v2 交付修复中名为 `comet-classic-check` 的 executor **不执行命令**，它只接收平台报告与交付路径。应保留这项业务行为并剥离 v1 委托，不能按同一名称一刀删除。
4. 通用 Run/批准/任务 checkpoint、业务 CAS 的短事务锁、Archive/OpenSpec 与 Git 交付的实际结果不属于本次普通检查执行器。它们与检查快照/停止回执须分开处理。

## 可整体退休的执行与检查证据模块

以下模块在切断后文消费者后可从普通 Classic 产品闭包中删除；旧用户文件保留，不在升级时扫描并删除本机历史数据。

| 模块                               | 职责和应移除内容                                                                                                                                           | 当前消费者                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `classic-sdk-check.ts`             | v1 checked argv/cwd、spawnOwnedCommand、监管器 ready/start、超时、确认进程树停止、log/receipt、检查复用与刷新。核心执行 `:93-181`，执行结果绑定 `:369-486` | app runtime、组合工厂、Guard/next、Archive preflight、恢复、修订应用、delivery repair、index 导出                                 |
| `classic-sdk-check-record.ts`      | SDK 命令回执、日志 hash、原执行绑定、辅助记录丢失后的 Portable 兼容；`:29-98` 和 `:110-318`                                                                | SDK executor、state-store、application validator、Archive preflight、prepare/recovery、delivery repair                            |
| `classic-sdk-check-preparation.ts` | prepare-build-check / prepare-verify-check command、绑定与重新装配旧定义；`:27-192`                                                                        | check command、executor、next、output、revision application                                                                       |
| `classic-command-checks.ts`        | Compat 命令执行、start/completed/unknown 轨迹、收据复用、rerun、接受后补检查；执行 `:661-961`，恢复 `:366-499`，接受结果绑定 `:501-659`                    | Guard、state、archive、status、Entry project-status/types                                                                         |
| `classic-check-action.ts`          | Compat 检查的 RuntimeAction claim/outcome 专用适配；`:12-166`                                                                                              | 仅 classic-command-checks                                                                                                         |
| `classic-check-index.ts`           | Compat 检查轨迹索引                                                                                                                                        | 仅 classic-command-checks                                                                                                         |
| `classic-check-command.ts`         | check run/rerun；v1 准备与迁移、执行、记录 Evidence。`:58-142`、`:150-365`、`:368-487`                                                                     | command entry、Classic CLI、SDK Guard、SDK next                                                                                   |
| `classic-check-entry.ts`           | 独立 comet-check.mjs 构建入口                                                                                                                              | build/manifest/layout 以及脚本调用者                                                                                              |
| `classic-check-snapshot.ts`        | 文件输入枚举、hashGitPaths、内容/环境快照、缓存与过滤。`:59-126`、`:299-404`、`:738-825`                                                                   | 当前生产 domain 已无导入，仅 `scripts/benchmark/workflow-scale-benchmark.mjs:131,474` 直接引用；可删除旧 benchmark 分支后整体移除 |

完整静态导入清单在调查产物 `C:/Users/BENYM/AppData/Local/Temp/classic-managed-check-import-map.json`。它只追踪当前 active 源码的直接导入，不把测试 fixture、历史归档或字符串参考冒充生产执行依赖。

### 需先拆出业务部分的模块

- `classic-sdk-check-recovery.ts:25-54` 是被拒 Build 配置提案的恢复，不是检查进程；`:153-253` 还包含未知 Builder 保留部分产物、回填失败和原 Action 续行。保留这些业务恢复，删除 isCheck、record/manifest/receipt、stop-unconfirmed、原命令重放和 stoppedActions 的检查专用路径。不把原 Builder 的 running/unknown 直接改成完成。
- `classic-check-policy.ts`、`classic-check-manifest.ts` 仍被交付路径收集/修复引用，暂不能直接删除。v2 Archive preflight 已使用 `collectClassicSdkDeliveryInputs(root, '', null, run)`，不需要检查策略，来源 `classic-sdk-archive-preflight.ts:264`；只保留已有交付路径与基线语义后，可删旧 argv/cwd-policy、glob input/output、manifest/hash 兼容。
- `classic-sdk-implementation-inputs.ts:1-42` 混合了 `classicForeignChangeRoots`、路径归属判断与旧 manifest 内容收集。交付隔离仍用前两项；旧 parseCheckManifest/内容映射可删。不要把其他 change 的草稿纳入当前交付。
- `classic-sdk-delivery-inputs.ts:92-115` 中 identity、_manifest、policy filters 主要服务旧受管检查；v2 传 null。`:117-162` 选择 v1 verify.check 或 v2 archive.preflight 的历史分支可简化为当前 preflight 的 deliveryPaths。`:164-175` 的路径合法性、实际 Git 状态与交付范围检查仍需保留。

## 必须切断的入口与隐式装配

### CLI 与 Guard

- `domains/comet-classic/classic-cli.ts:71` 动态加载 check command；`classic-cli-help.ts:18-50` 宣传执行/复用，`:106-129` 仍把 Build/Verify Guard 描述为受管检查。移除旧命令入口或留下明确的无执行拒绝提示，不能保留执行模块再只隐藏帮助。
- `app/cli/index.ts:14,677-680,1206-1209`、`bin/fast-runtime-router.js:4`、`app/commands/classic.ts` 也会路由 `comet check`。注意 `app/cli/index.ts:780` 是 **comet skill check** 的通用 Engine 检查入口，不是同一条 Classic 命令，不能误删其他产品职责。
- `classic-state-command.ts:2175-2245` 的 state record-check、`:3133-3139` 派发和帮助都应撤下；`:2033-2042` 的 Compat recoverCommandChecks 不能继续启动旧恢复。保留 state check（业务入口前提检查）、tasks、task-complete、sync-plan、checkpoint，它们不是运行测试命令。
- `classic-guard.ts:337-471` 等 commandCheckPasses、策略 cwd、接受/消费收据及自动命令提示应去掉；Open 产物、Design、Build 配置、tasks 权威、Verify 报告和 Archive 授权检查保留。
- `classic-sdk-guard.ts:501-609`：保留 v2 completeClassicSdkBuild + checksRef；删 v1 literal argv、sdkCheckCwd 和 executeClassicSdkCheckCommand。Verify 同理：保留 `:723-783` 的平台报告、verification-ready、报告 Evidence；删 `:787` 后受管执行及收据分支。

### 自动续行与 SDK 原始命令

- `classic-sdk-next.ts:14-51` 的 Open / Design / Plan / Verification Report Evidence 自动续行属于业务，应保留；sources 中 classic-build-check / classic-verify-check 和 `:99-133` 的 classic-check 执行分支可撤下。
- `app/commands/runtime.ts:983-995` 的内置 Classic **start 仍调用 v1 defineClassicWorkflowApplication**。只改 state init 默认值无法关闭 raw dispatch 的旧入口。start 必须改为当前平台报告合同或拒绝旧 workflow.version，不能先创建旧 owner/Run 再隐式迁移。
- `app/commands/runtime.ts:1052-1059` 即使 v2 普通步骤没有旧检查，也会补装 createClassicSdkCheckExecutor。这个默认注入应彻底去掉。
- `classic-sdk-status.ts:125` 与 `classic-sdk-revision-application.ts:575-680` 根据 saved hash 构造大量历史定义，含 prepare、refresh、旧收据恢复变体。应在读取边界完成旧 Run 的数据转换，然后只加载当前业务图，不构造这些执行兼容图；保留原 Run 身份和批准，不能通过 fallback 重开 Open。
- `classic-sdk-revision-application.ts:287-435` 的 refresh-checks、withClassicCheckPreparation 和旧检查 transition 可删；continue-work、continue-build、revise-design、reopen-verification、preset 升级和用户配置批准等业务命令保留。

### 工厂与组合应用

- `classic-sdk-application.ts:1069` 的 v1 图定义包含 build.check、verify.check、对应 Evidence/validator；`defineClassicAgentWorkflowApplication:2373` 先构造它，再删除普通检查步骤。应让当前工厂直接构造平台报告业务图，去掉为新普通 Run 编译 v1 受管图的成本；不能留下“已不调用”的执行兼容图当作彻底移除。
- `classic-application.ts:110` 的公开组合工厂仍基于 v1，`:561` 注册旧 executor。新组合应用若要继续支持，应改为平台执行和报告合同，并保留扩展 Skill 的输入、验收与固定身份；若暂不支持，明确拒绝，不能把缺 executor 当成可执行应用发布。
- `classic-sdk-delivery-repair-application.ts:128-143`：v2 分支仅返回 repair.reports 与 deliveryPaths，不 spawn 命令；保留该交付修复业务动作及用户决定。删其 v1 preflight/receipt/委托 createClassicSdkCheckExecutor 分支，可以用职责更清楚的名称表达平台报告动作。

## 当前 v2 必须保留的合同

| 合同                 | 源码                                                                                                            | 删除时不可改变的结果                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 平台检查报告边界校验 | `classic-sdk-application.ts:2495,2515` 的 assert/readClassicAgentCheckReports                                   | checks 的 name/result/note、空列表 checksReason、not-run 原因；真实 failed 不能被提交成通过。不从文字自动推断测试已执行  |
| Build 合法推进       | `classic-sdk-build.ts:421-470`，`classic-sdk-application.ts:2434-2476`                                          | 同一 Run 的实际 Builder session、完整 tasks/plan/configuration、平台报告，然后进入 Verify；任务打勾仍由稳定 task ID 管理 |
| Verify 与报告绑定    | `classic-sdk-guard.ts:723-783`，`classic-sdk-application.ts:2477-2491`                                          | 读取实际报告，记录 verification-ready，提交原 Action 的报告 Evidence；失败回 Build，不跳过全部验收                       |
| Archive 前提         | `classic-sdk-archive-preflight.ts:145-175`                                                                      | 当前被接受的 Verify Action/报告与平台报告仍有效；OpenSpec Archive 与 Git 交付分别按原用户授权和实际结果执行              |
| 当前业务输入与批准   | `classic-sdk-output.ts:108-229,253-309`                                                                         | 当前输入摘要/未知格式原输入、相关批准、真实会话与恢复命令；不是因为删旧检查就删整个 current                              |
| 恢复不重放业务副作用 | `classic-sdk-archive-manifest.ts`、`classic-sdk-delivery-checkpoint.ts`、`classic-sdk-delivery-repair-model.ts` | 保留归档/commit/push/PR 实际结果和原身份；不得把命令检查回执退休推广成“无需核对 Git 已执行结果”                          |

`classic-sdk-state-store.ts:689-710` 对旧 classic-check outcome 强制核验辅助命令收据的块可以退休；周围 compareAndSwap、Portable checkpoint、用户状态投影与分支/worktree 身份不可一并删除。Portable 传输的是业务状态和批准历史，不是普通命令的文件内容快照。

## Compat、旧状态与专用快照/锁

- 明确区分旧普通检查功能和旧业务数据。旧 SDK v1、Compat 的业务数据应自动转换到当前合同，旧受管检查永不恢复执行；旧未知外部结果交由 Agent 根据实际记录核对，不自动重开 Open、不伪造停止或通过。具体方案见后文。
- `classic-migrate.ts:173-263`、`classic-runtime-run.ts:50-185,301-316` 会为 Compat 装配旧内部 Skill Runtime 与 skill snapshot。这些旧执行迁移及其资产应退出普通产品装配；转换直接读取旧数据，不为了读取或升级而创建整套旧 Runtime。
- `classic-store.ts:287-299,421-444` 仍有只读与迁移分支；需让只读历史走不迁移路径。`classic-state.ts`、`classic-state-options.ts:7`、`classic-validate-command.ts:143` 的 checkEpoch/check_epoch 可按旧字段只读或明确不再支持处理，不继续因普通编辑递增失效纪元。
- 检查专用轨迹、classic-sdk-checks、日志/manifest/receipt recovery alias 可移除活跃读取和生成逻辑；不要升级时清理用户目录，也不要删除正常业务 `.comet-state` / owner / state-projection 的短 CAS 锁。
- `platform/process/owned-command.ts`、`terminate-process-tree.ts` 等共享基础设施还被 Native 与 Eval 使用。Classic 撤下导入不自动授权删除其他执行用途；是否全局删由根 agent 根据 Native 闭包统一决定，Eval 不因本次任务被启动。

## Skill、帮助和生成资产

当前中文 Skill 在 agent 报告段落后仍紧接旧“首次最终 GREEN 通过 comet check run、读取收据”的命令，容易使 Agent 混用：

- `assets/skills-zh/comet-build/SKILL.md:14,20,34`
- `assets/skills-zh/comet-verify/SKILL.md:14,20,28-32`
- `assets/skills-zh/comet-hotfix/SKILL.md:26,42`；`comet-tweak/SKILL.md:29,45`
- `comet-classic/reference/scripts.md:30-32,81-85`；`reference/sdk-methods.md:114-116`
- `comet-build/reference/compat.md`、`comet-verify/reference/compat.md` 的 managed checks、SKIP_BUILD、input/log复用与重跑要求

移除旧 Run“继续原 Runtime check 协议”的承诺，改成平台工具执行后提交实际报告；原用户方法选择、TDD RED/局部调试、任务审查、批准和验收不可一起删除。按仓库规则先中文、确认后英文同步；Skill 触发句保留既有规范。

命令撤下需同步 `app/cli/index.ts`、`bin/fast-runtime-router.js`、`classic-cli.ts`/help、`classic-check-entry.ts`、`scripts/build/build-classic-runtime.mjs`、`config/repository-layout.json:38`、`assets/manifest.json:34`、对应 Runtime 资产测试拷贝列表，以及 `comet-check.mjs`。`assets/skills/comet/runtime/classic/checks.yaml` 和旧内嵌 Compat runtime 执行资产应一并撤下，自动转换不加载它们。不要只删生成物，源码/构建目录同时收敛。

`classic.check_timeout_ms` 已在项目配置的解析、生成、全局设置和旧配置查询中使用：`classic-project-config.ts:81-82`、`workflow-contract/project-config.ts:222,955-970,1394-1395,1539-1540,2700-2704`。受管执行完全撤下后不再暴露为可调执行参数；旧值可明确报停用或作为无作用历史元数据读取，不换名新增另一组限额。

## 测试与 badcase 迁移

本次不执行产品测试。确定性替代边界应验证：旧 check/run/rerun/record-check/prepare/refresh/Guard literal argv 不启动 Node marker；旧 v1 Run/旧 pending check/unknown check 自动转换后继续当前业务，保留原批准和历史绑定，revision 仅按一次业务转换增加；新 full/hotfix/tweak 经平台报告完成 Build→Verify→Archive；失败或未解释的缺失结果不能通过；既有任务权威、用户配置、批准、分支隔离和归档交付恢复仍可完成。后文的 Temp 探针只证明 SDK 数据保留方案可行，不等于完整 Classic 自动升级已经实现或验收。

不能为了绿色测试保留受管执行器，也不能直接删来源登记。`docs/architecture/badcase-maintenance.zh.md:48` 现已支持 `testMigration.kind: feature-removed`：保留原 ID/来源/behavior/原 tests，归档旧断言正文，追加具体撤下授权、docs 记录及精确替代测试；旧未完成模型验收不能写成已通过，退休案例不能在 PR 声称已修复原问题。

直接引用专用检查测试文件的当前 6 个案例：

| case ID                                           | 原测试入口/选择器                                                                                                                | 迁移方向                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| classic-short-timeout-supervisor-startup          | classic-check-defaults.test.ts / applies project timeout to the public sdk check run；并含平台整树终止选择器                     | 旧受管检查入口不可执行；共享平台其他用途是否保留由对应领域核对 |
| classic-compat-proven-prelaunch-retry             | classic-command-checks.test.ts / retries only a proven prelaunch failure in the same check Action                                | 旧 Compat 数据自动转换，不启动或重试旧命令                     |
| classic-compat-unknown-check-no-replay            | classic-command-checks.test.ts / refuses both old and new request IDs when the process ran but its completion receipt is unknown | unknown 调度退休并保留原数据；Agent 核对后继续，不重放         |
| classic-ci539-interrupted-check-plan              | classic-executed-checks.test.ts / preserves and reruns an interrupted check...；does not rerun...corrupted SDK Action binding    | 撤下检查重跑功能；自动转换并保留不重放边界                     |
| classic-legacy-verify-receipt-continuation        | classic-sdk-legacy-check-continuation.test.ts / source、generated 原 Verify receipt continuation                                 | 撤下旧执行兼容；保留已接受结果并转为 Agent 报告流程            |
| classic-committed-check-without-auxiliary-receipt | 同上及 classic-sdk-verify-rounds.test.ts 的 original execution receipts                                                          | 已存历史仍可解释；不得把旧记录补造为新平台检查或重复执行       |

另外，`config/workflow-regressions.json` 中通过较宽文件/选择器筛出的 Classic 候选共 55 项，**不是 55 项都应退休**。完整 ID、行为、来源和精确选择器在 `C:/Users/BENYM/AppData/Local/Temp/classic-managed-check-wide-regression-candidates.json`；直接专用模块映射在 `classic-managed-check-regression-map.json`。历史冻结清单直接关联上述专用文件的 Issue 有 #192 与 #502，仍须按各 case ID 的已有 migration 链追加，不能改写冻结源。

需要重点退休/替代的范围包括：

- `classic-upgraded-preset-first-managed-check`、`classic-first-managed-check`、`native-classic-check-plan-continuation`、`classic-sdk-fresh-check-opt-in-guidance`；
- `classic-sdk-approved-check-refresh`、`classic-compat-approved-check-refresh`、`classic-sdk-refresh-byte-identical-restoration`、`classic-sdk-recover-original-input-manifest`、`classic-sdk-archive-reverification-guidance`；
- 上表 6 项及 `classic-agent-check-help` 的已撤下命令帮助部分。

不能按包含 check/receipt 的名字直接退休的业务安全项包括：`classic-agent-check-reports-v2`、`classic-interrupted-builder-continuation`、`classic-interrupted-skill-continuation`、`classic-sdk-branch-rebind`、`workflow-simplification-t17-classic-checkpoint`、`classic-approved-preset-upgrade-continuation`、`classic-terminal-delivery-receipt-guidance`、归档/交付 checkpoint 与不重放 Git 副作用。交付修复一组案例混合了旧命令检查与仍有效的授权/范围/副作用要求，应逐行为拆分：撤下执行部分，保留平台报告和实际交付保护的替代断言。

## 实施顺序建议

1. 先固定新的平台报告业务图与旧版本业务数据自动转换，切断 raw start / execute / prepare / refresh 的受管执行入口。
2. 保留 v2 Build/Verify、业务 Evidence、任务和授权；拆出混合文件中的业务恢复及交付修复报告。
3. 去掉 app 默认 executor 注入、Guard/next 自动执行、组合工厂旧执行绑定和 state-store 的专用回执校验。
4. 断开全部消费者后删除专用模块、孤立 snapshot、CLI entry 和旧生成资产；同步配置帮助与 Skill。
5. 按行为归档旧测试并追加 feature-removed 迁移；再由根 agent 执行新边界的定向检查、公开 CLI、构建与必要的最终本地验证。

这里没有执行证据能证明退休已经完成；本报告是当前源码的删除闭包与保留合同清单，不把静态可删结论写成实际通过。

## 补充：旧 v1 自动转换到当前 Agent 业务图

用户最终明确要求自动兼容旧版本。可行的最小方案是读取旧业务数据、转换同一个 Run，然后仅加载当前 v2 图；不构造 v1 factory，不加载旧 executor、旧 Evidence validator、旧命令定义或占位成功桥。以下是源代码可行性方案，尚非已实施结果。

### 保留什么，改变什么

| 旧数据                               | 转换规则                                                                                                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run 身份、输入、branch/worktree 归属 | 同一个 runId；保留 changeDir、原配置、原输入及归属校验，revision 按一次正常 CAS 增加。不得为升级生成第二个 Open Run。                                                                                                                                                      |
| phase、用户方法选择、任务与材料      | 保留 `ClassicState` 中 phase、buildMode、tddMode、reviewMode、isolation、boundBranch、plan、designDoc、verificationReport 等；任务文件、稳定任务 ID 和已完成状态不重置。                                                                                                   |
| 用户批准                             | 原 Wait、proposal、proposalHash、decisionId、choice 和 reason 原样保留。当前仍需用户决定的业务 Wait 保持 pending；不因为升级构造新的“已批准”决定。                                                                                                                         |
| 已接受的业务结果                     | 原 Action/claim/session/inputHash/outcome/receipts、actionContexts、历史 results/sequence 原样保留，不向已经提交的 outcome 强塞 `checks` 字段。                                                                                                                            |
| 旧检查 Action                        | succeeded/failed 原样留作历史。仅退休步骤的 pending/running/unknown 使用 `cancelRuntimeAction` 取消调度，reason 写明原状态及外部结果尚需核对；保留 claim/session，不生成 outcome、executionStop 或 cancellation 回执。其他 Builder、归档或 Git Action 不因本次迁移而取消。 |
| 旧检查 Evidence                      | resolved/invalidated 原样保留 receipt/invalidation；pending 改为 cancelled，不生成 receipt。取消的是旧等待要求，不声称检查通过。                                                                                                                                           |
| 当前可继续的步骤                     | 当前业务 Action/Wait 若步骤不变则继续保留；若仅剩被退休的检查，则追加当前 Build/Verify 的 Agent 业务 Action，要求先读取已有产物、已完成任务及旧检查事实，只补缺失检查和报告。更新 Run.status，清理指向已退休步骤的 ready/join，不能遗留不满足状态不变量的 waiting Run。    |

字段来源：`classic-state.ts:33-69`；任务与原 Builder/session 的完成入口 `classic-sdk-build.ts:405-480`；批准解析 `engine/workflow-run-validation.ts:170-254`；取消语义 `engine/runtime-action.ts:307-310`。`cancelRuntimeAction` 对终态直接返回原 Action，其余只改 status/reason，确实不声明操作系统进程已经停止。Agent 必须从保留的 claim、原 reason/日志和实际文件判断旧命令有没有完成，不能将 cancelled 展示成 stopped/passed，也不能无条件重放命令。

取消最后一个 pending Evidence 后不能只保存取消状态：`workflow-run-validation.ts:649-671` 要求 running 必须有实际工作、waiting 必须有未决等待。可复用 `workflow-scheduler.ts:39-126` 的调度写入来追加当前业务 Action，sequence 单调增加、旧 ID 不改。它不提交成功结果，也不执行命令。转换应一次 CAS 提交完整合法的新状态。

旧已接受检查只可作为已有事实读取，例如原成功 Action 的 exitCode/receiptRef、对应被接受 Evidence。转换不能将它改写成“本次 Agent 已运行”；缺失或未知结果交当前 Agent 核对。特别是旧 Verify outcome 不含 v2 `checks`：当前 `classic-sdk-archive-preflight.ts:145-175` 直接要求最新 Verify outcome 的报告，不能只换 workflow.version 就放行 Archive。应在转换时区分已接受旧结果与缺失报告，缺失时恢复当前 Verify 报告工作；原 Archive 批准与已执行的归档/Git 副作用继续保留，不重新执行。不得为了迁移通过修改旧 outcome/receipt 或清零 verifyFailures。

### SDK 只需允许读取已退休的终态历史

直接删除 Action/Evidence 会破坏通用 Run 协议：`workflow-run-validation.ts:500-519` 要求 actions/waits/evidenceWaits 覆盖完整 sequence；`:524-600` 要求 actionContexts 与 Action 一一对应，results 仍引用真实来源。`preserveRuntimeExecutionOrigins`（`portable-run-checkpoint.ts:227-234`）只给已领取 Action 保留旧 workflow 身份，不映射 ID、不修复删历史后的序号。正确顺序是先保留 executionOrigin，再更新当前 workflow.version/hash 与当前 definitionHashes，不再要求加载旧图。

当前阻碍有两处，均在 `engine/runtime-service.ts` 的 `validateDefinitionBindings`：

1. `:706-715` 对所有 EvidenceWait 都要求当前同名 await_evidence。最小收窄：只有 **step 已不存在且 wait 非 pending** 才作为历史读取；pending 未知 step 仍拒绝；同名 step 仍存在但 type/kind 不一致仍拒绝。历史 receipt/invalidation/sequence 的解析保持不变。已结束旧 Evidence 的 record/invalidate API 在 `:1418`、`:1497` 先拒绝非 pending，无需旧 validator。
2. `:609-623` 对所有 commands 都要求当前 command 声明。commands 只有 id/name/inputHash/actionId，没有 accepted 标志。始终核对 Action 存在、activation 存在及其 hash；仅在 **command 名与 Action.stepId 均已从新定义移除，且 Action.status 为 succeeded/failed/cancelled** 时豁免当前定义匹配。pending/running/unknown 不豁免；rejectedOutcomes 不代表已接受，仍看 Action 的实际状态。若同名 command 仍存在但绑定其他 step，依然拒绝。旧 succeeded/failed 的 outcome/claim/receipts 继续经 Action 解析验证。

不需要 archive-only await_evidence 占位定义。那种定义仍强制要求 validator（`workflow-definition.ts:228-230`、`runtime-service.ts:478-486`），会留下无业务作用的永久兼容图。允许读取不可再派发的终态历史与已有历史 Action 的处理一致；新 command 仍由 `dispatchCommand` 的当前定义决定（`:886-895`），旧 Evidence 不能自动形成新授权。ready token 的来源结果、原 event 以及当前 transition 核对（`:632-705`）不能放宽。

### 已执行的隔离探针

原始脚本与 JSON 位于 `C:/Users/BENYM/AppData/Local/Temp/comet-classic-retired-history-d3c783aa210a4e1d8a1c0ed092fd6633/`：`probe-build.cjs`、`probe.ts`、`current.json`、`prospective.json`。实际从公开 SDK API 构造需求结果→用户决定→旧 command Action→接受 outcome→Evidence→当前业务 Action；决定通过 SDK resolveWait 输入的是明确标注的探针模拟用户，不代表真实 change 批准；unknown 通过公开 markUnknown 生成，未手工伪造业务状态。候选只通过 esbuild 内存加载替换上述两段 binding，然后输出到 Temp；没有修改产品或测试。使用内存 store、零 executor，未启动受管检查命令或模型。COMET_DATA_DIR、HOME、USERPROFILE、APPDATA、LOCALAPPDATA、CODEX_HOME、XDG_DATA_HOME、XDG_CONFIG_HOME、XDG_STATE_HOME、XDG_CACHE_HOME 均指向该 Temp 隔离目录；只有依赖解析通过 Temp node_modules junction 指向仓库现有依赖。

| 探针行为                                                                       | 当前 SDK                           | Temp 候选                                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------ |
| 原批准、成功命令、已接受 Evidence 历史保留，当前图无旧步骤                     | INVALID_RUN：历史 command 不在定义 | inspect 成功，原批准/claim/session/sequence 保留                               |
| pending Evidence 取消等待并追加当前 Agent 工作                                 | INVALID_RUN                        | inspect 成功                                                                   |
| 旧 running/unknown command 只取消调度，无 stop/outcome                         | INVALID_RUN                        | inspect 成功，claim/session 保留且 executionStop/cancellation/outcome 均未生成 |
| pending 未知 Evidence，pending/running/unknown 未知 command 未先退休           | INVALID_RUN                        | 全部仍 INVALID_RUN                                                             |
| command activation hash 不符、resolved Evidence 缺 receipt、历史 sequence 错误 | 拒绝                               | 全部仍拒绝                                                                     |
| 用旧 resolved Evidence 结果生成没有当前 transition 的 ready token              | 拒绝                               | 仍拒绝：待调度步骤与当前定义不一致                                             |
| 对旧 Evidence 再提交、新请求调用已移除 command                                 | 被历史定义匹配先挡住               | 分别 EVIDENCE_WAIT_RESOLVED、COMMAND_NOT_FOUND                                 |
| 保留历史后当前业务 Action claim/recordOutcome                                  | 被历史定义匹配先挡住               | completed                                                                      |

上述是 16 个确定性观察，不是 Classic 公开 CLI 完整升级测试。首次 Temp 探针因依赖解析缺少 ajv、随后因空 proposalFrom fixture 不合法失败，已通过 Temp 依赖 junction 和正常需求 Action 修正后重跑；产品源码没有为探针改动。pending Evidence 直接取消后曾因没有新工作违反 waiting 不变量，已在候选转换中先追加当前工作，不能忽略这条发现。真实平台 Hook、发布安装、Classic full/hotfix/tweak 所有升级阶段和真实模型判断均未执行。

### 读取与旧 Compat 布局的边界

SDK 转换入口应在 `classic-sdk-status.ts:122-126` 得到 saved 后、选择 application 之前；在已有 change 所有权短锁/CAS 内只转换一次。先完成 store/owner/project/branch/checkpoint 原有校验，再将新状态与新 Portable checkpoint/投影同步保存。普通 readOnly 诊断可只报告待转换，不应为了 inspect 生成旧 Runtime 或写状态。

`classic-sdk-state-store.ts:220-327` 已能从**指定 change 的受保护状态候选文件**恢复原 Portable checkpoint，并核对原 application、Run 输入、branch、允许的用户配置编辑与投影一致性；可保留该恢复再做转换。`portable-run-checkpoint.ts:48-93` 对运行中 Action 的传输本来就转为 unknown，不伪造停止；`:154-190` 保留 sourceRevision 与来源校验。不能把转换混入不受约束的跨工作区搜索。

旧 Compat 应在已知项目的升级入口或用户明确继续的已知 change 上读取现有 `.comet.yaml` 与本地记录，直接转业务数据；不再调用 `ensureClassicRun` 来装配旧 Skill。当前 `classic-migrate.ts:173-263` 会创建 Skill snapshot、旧 Run/checkpoint/trajectory，应删除这条装配路线。`classic-runtime-paths.ts:337-373` 的现有迁移针对给定 changeDir/固定 CLASSIC_LOCAL_RECORDS，适合在已知升级入口调用；不要把它重新放回普通发现路径。`workspace-runtime.ts:1411-1421` 已明确普通 resolve 不导入旧布局，显式 migrate 才导入；保持这个边界。`app/commands/update.ts:1803` 的 legacy selection 迁移只是入口选择文件，不能当作旧业务 Run 已转换。

只有老状态没有完整 SDK 批准历史时，保留其真实材料/配置/任务和旧批准事实；当前需要但旧数据不能证明的确认仍进入正常 pending 用户决定，不能根据 phase 或 `archive_confirmation: confirmed` 构造不存在的精确提案批准。当前 `restoreClassicSdkChange`（`classic-runtime-ownership.ts:116-145`）会清回 Open、plan/design/report 和验收状态，不适合作为本次自动转换实现。转换合法数据应无须用户手工执行迁移命令；损坏、冲突或确实缺少批准的数据仍应给出具体缺项，不能用“无感”掩盖。

### 必须补的正式替代覆盖

在原业务/来源 case ID 下补升级到当前普通业务方式的公开 CLI 或 bundle 用例：Open/Design/Build 配置批准与已完成 tasks 保留；v1 Build/Verify check pending/running/unknown 不启动旧 marker、不重放且 Agent 可继续；原 Verify 成功与 Archive 已批准保持授权，缺报告不伪造通过；已归档或 Git 结果不重复；Portable 恢复后同一 Run/用户配置仍可继续；Compat 只迁移已知 change、其他 worktree 不读不写。原表中“旧 Run 拒绝/停止支持”方向已被这里的自动数据转换要求取代，只有受管命令执行功能退休。旧场景来源、原断言和 testMigration 链仍须保留，不能通过删除 case ID 绕过。

## 后续源码快照：v2 工厂完成后的剩余删除闭包

根 agent 实施期间再次只读核对：`classic-sdk-application.ts:1090` 已直接定义 version 2，`:2313` 的 Agent 工厂名称是同一工厂的别名；`classic-sdk-next.ts` 已只续行业务 Evidence、Open revalidation 和 Archive；`classic-sdk-status.ts:125` 开始调用纯数据 `upgradeClassicRun`。因此前文“v2 仍先构造 v1”的初始发现不再代表这个后续快照。以下列尚留在当前源码中的生产引用，不等于它们最后仍会保留。

### 尚能把旧执行器带入产品的直接引用

| 旧模块                                                 | 当前生产引用与应收尾位置                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `classic-sdk-check.ts`                                 | `classic-check-command.ts:34,190` 导入并执行；`classic-application.ts:25-28,561,592-608` 注入 executor 并核验旧命令；`classic-sdk-check-recovery.ts:11,110` 为诊断重建旧命令；`classic-sdk-output.ts:15,568-592` 返回旧 check/next 执行指令；`classic-sdk-archive-preflight.ts:21-24,213` 仍有 v1 Verify 验收；`index.ts:16` 导出。                                                                                                              |
| `classic-sdk-check-record.ts`                          | SDK check 自身、`classic-sdk-check-preparation.ts:11`、`classic-sdk-check-recovery.ts:12-17`、`classic-sdk-archive-preflight.ts:20,223`；当前 state-store 已开始剥离其新增结果校验，需最终重查无导入。                                                                                                                                                                                                                                           |
| `classic-sdk-check-preparation.ts`                     | `classic-check-command.ts:30-33`、SDK check 自身、`classic-sdk-output.ts:14,568`；修订工厂已不再构造该 prepare 图，但 output/check 命令仍会加载它。                                                                                                                                                                                                                                                                                              |
| `classic-command-checks.ts`                            | `classic-check-command.ts:14-19,416-487` 为 Compat 执行/重跑；`classic-guard.ts:17-25,380,804,826,909` 读取并验收旧证据；`classic-state-command.ts:32-35,2037,2230` 恢复/record-check；`classic-archive.ts:11,496` 在归档前核验旧检查；`comet-entry/project-status.ts:7,385-386` 只为状态查询也导入整份模块。`app/commands/status.ts:9`、`comet-entry/types.ts:1,51-52` 是类型引用，运行时不会加载，但删除文件前仍须移除或转为当前业务报告类型。 |
| `classic-check-action.ts`、`classic-check-index.ts`    | 只被 `classic-command-checks.ts` 直接使用；父消费者切断后整体删除。                                                                                                                                                                                                                                                                                                                                                                              |
| `classic-check-policy.ts`、`classic-check-manifest.ts` | 除旧 snapshot 外，`classic-guard.ts:15,368` 的 cwd 校验；`classic-sdk-delivery-inputs.ts:9-13,101-105` 的旧 policy 过滤；`classic-sdk-delivery-repair.ts:15-16,65-66,120-121` 的 v1 argv/输出路径分支；`classic-sdk-implementation-inputs.ts:3,32` 的 manifest 解析。先保留交付路径/其他 change 隔离，再删 policy/manifest 部分。                                                                                                                |
| `classic-check-snapshot.ts`                            | 当前生产 domain 仍无导入；旧 benchmark 直接入口见前文，可随专用 benchmark 分支退休。                                                                                                                                                                                                                                                                                                                                                             |

`classic-application.ts:179-188,219-225` 的扩展 checkpoint 名单仍列 build/verify.check.evidence；当前工厂已经没有这些步骤，合法扩展会被“步骤不存在”拒绝。组合工厂应把这两处声明同步到当前真正存在、语义相同的业务检查点（Build 平台报告提交、Verify 报告 Evidence），保留扩展自身 Skill 验收与批准，不能只去掉 executor 后留下失效公开扩展点。新应用 `validateOutcome` 也不能继续导入旧 `assertClassicSdkCheckCommandBinding`。

混合业务恢复 `classic-sdk-check-recovery.ts` 仍被 `classic-sdk-output.ts:13` 与 `classic-state-command.ts:111` 使用。保留被拒配置提案的原 claim 重提（`:25-54`）及 Builder 部分工作恢复；删除检查专用 record/manifest/stop-unconfirmed/argv/retry/cancel stoppedActions 分支（`:56-152` 及 `:157-253` 中相应条件）。不应因为文件名而把业务恢复全删，也不应因为保留几段业务恢复而继续加载旧 SDK check。

### check CLI 可以保留薄兼容入口，但不能伪造执行

当前 `classic-check-command.ts` 仍有约 487 行：SDK v2 在 `:166-169` 拒绝受管执行，但导入链已包含全部旧执行；Compat 在 `:416` 调用 `ensureClassicRuntimeRun`，随后 run/rerun 直接调用 `executeCommandCheck`。只改 SDK v2 那条错误提示不能撤掉整个功能。

薄入口可以保留 `check run/rerun <change> <build|verify>` 路由以服务旧 Agent 指令，职责仅为：

1. 解析 change/scope，调用具名的自动数据转换，再读取当前平台任务；不导入旧 command-checks、check-preparation、SDK check、Runtime package、policy、timeout resolver。
2. 旧 `-- <program> ...` 只作为返回给 Agent 的检查建议，明确由 Agent 平台工具执行，返回真实项目 cwd、当前任务和后续 `--checks` 的提交命令。不能输出旧 `exitCode=0`、`reused=true` 或“检查完成”，也不能把命令文本当检查报告。
3. 若兼容入口新增接受 `--checks <file>`，直接委托当前 Build/Verify 的已有业务提交入口，复用它的原批准、phase、tasks/plan 与报告校验；不再写一份单独检查状态或模拟旧 Evidence。Verify 仍需实际 verification report。旧 timeout/local/incremental 不能重新启动缓存/监管逻辑；帮助应只宣传平台执行与实际结果提交。
4. rerun 只返回当前 Agent 核对/补跑工作的指引，不沿旧 index/trajectory 自动读取 argv 并重放。旧 unknown 结果必须先由 Agent 核对已有事实。

保留这个很小的 CLI 路由时，`classic-check-entry.ts`、CLI entry、manifest 和命令 bundle 仍有用途，不能按前文“全撤命令”的备选方案全部删除；应重建为只含当前业务路由的 bundle。受管执行模块与旧 `checks.yaml` 不因保留兼容命令名而继续存在。

### Compat state 到 SDK：目前没有现成的转换函数

可复用的是读取业务事实的能力，不是旧 Runtime 装配：

| 可复用入口                                                                                            | 用途与限制                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `readClassicState(changeDir, { migrate: false })`；`classic-store.ts:352-388`                         | 读取 YAML、原 generic RunState 与旧/新本地位置，保持旧文件不改；先确认未知字段/来源一致，不能把数据迁移选项误当 SDK 业务升级。 |
| `collectClassicEvidence`；`classic-evidence.ts:215`                                                   | 读取 proposal/design/tasks/spec、plan、verification report、handoff 的材料就绪情况；这不是用户批准证明。                       |
| `parseClassicTasks`、`assignClassicTaskIds`、`inspectClassicPlanTasks`；`classic-tasks.ts:14,66,91`   | 保留原 completed 状态，缺 ID 时只补 ID，计划映射走当前规则，不能重置已完成 tasks。                                             |
| `classicConfigurationReadiness` / `classicConfigurationReady`；`classic-build-configuration.ts:22,65` | 保留用户方法选择，判断哪些输入确实缺失。                                                                                       |
| `readTrajectory` / `readArtifacts` / `readContext`；`classic-run-store.ts:35,44,67`                   | 读取原 generic Run 的真实材料与历史，不启动旧 Skill；历史事件中的文字或旧 `phase` 不自动等于当前提案已批准。                   |
| `withClassicChangeOwnershipLock`、当前 SDK state store 与 Portable projection                         | 可承载具名转换的短提交边界；不能靠跨 worktree 搜索寻找“最像”的状态。                                                           |

不能直接复用的入口：`ensureClassicRuntimeRun`（`classic-runtime-run.ts:301-307`）总会加载旧 package；`ensureClassicRun`（`classic-migrate.ts:173-263`）创建 Skill snapshot、旧 checkpoint/trajectory；`restoreClassicSdkChange`（`classic-runtime-ownership.ts:116-145`）清回 Open。当前 `resolveClassicChangeRuntimeOwner`（`:216-322`）对非 managed YAML 最后仍 `registerCompatChangeOwner`，并未自动转 SDK。新增 `upgradeClassicRun` 输入已经是 `WorkflowRun`，也不能接收 generic `RunState` 冒充同一协议。

还须明确解决两个现有边界：

- `change-runtime-owner.ts:997-1044` 的注册只接受缺失 owner 或逐字相同 owner。已有 compat owner 转成 sdk 会报“already bound”；没有公开替换入口。需要一个在既有所有权锁内比较已知 compat 来源、原子发布 sdk owner 并同步 canonical 的窄转换入口，不能删旧 owner 后裸注册，也不能在查询时抢占其他应用 owner。
- SDK 的 `classic-sdk-create.ts:55` 要求 runId===change，state-store Portable 读取要求 input.change===runId。旧 Compat 的 generic Run 常用 UUID，与 SDK Run 不是同一协议。应保留同一个业务 change、原 generic Run ID/源记录及原事实，不能为“同 ID”伪造一串 SDK Action/批准历史。前文“保留同一 Run ID”的要求只适用于 SDK v1→v2，不是要求给 generic 记录换标签。

SDK 创建时固定 entry 为 Open，因此把旧 state 作为 initialState 调用 `createClassicSdkRun` 仍不等于恢复当前 phase。窄转换应直接构造当前业务状态与当前缺失工作，不重放过去业务结果；旧已有材料、配置、任务和可证明批准直接作为迁移来源保留，当前缺少确切批准的步骤才进入正常用户决定。转换后的公开 status/next 必须显示原材料和任务，不要求用户手工重新从 Open 走一遍。

另外，当前 `state init` 在非 Git 项目默认 compat（`classic-state-command.ts:2559`），帮助明确支持其 document-only Archive（`classic-cli-help.ts:55`）；SDK Archive preflight 却必读 bound branch/`git rev-parse HEAD`（`classic-sdk-archive-preflight.ts:126,250`）。不能自动把这些合法任务转进一个末尾必失败的 Git 流程。若统一转 SDK，需保留当前无 Git 文档归档业务能力；否则应暂保留一个不含检查执行器的纯业务 Compat 路径，并说明这仍是一项待完成的统一工作，不能宣称全部旧任务升级无感。

本次只做源代码核对与报告更新，没有对当前新工厂或转换实现运行测试、构建、CLI 或 Eval。前节 Temp 探针证明的是 SDK 终态历史读取方案，不能替代这里 Compat/generic 协议的实际升级证据。

## npm 0.5.2 发布包：旧 Classic 前沿数据

本轮另获授权使用既有 npm 发布包构造隔离旧格式数据。包位置是 `C:/Users/BENYM/AppData/Local/Temp/comet-052-cli-package-626acda290b5479fb72b05334de5c0e5/package`，version 为 `0.5.2`。仅导入它自己的 `dist/domains/comet-classic/*` 和 `dist/domains/engine/runtime.js`；没有用当前分支 helper 生成旧基线。它没有 053 的 `classic-sdk-check-preparation.js`，不能把当前 prepare 命令 ledger 当作 052 普通路径。

全部产物保留在 `C:/Users/BENYM/AppData/Local/Temp/comet-052-classic-frontiers-b54109f387694f55b2edc32534dfe5ef/`，脚本为 `create-fixtures.mjs`，摘要为 `summary.json`，实际三次旧 CLI 调用见 `cli-calls.json`。COMET_DATA_DIR、HOME、USERPROFILE、APPDATA、LOCALAPPDATA、CODEX_HOME 及四个 XDG_*_HOME 全部隔离。只在该临时项目初始化 Git 并提交初始配置；没有启动受管检查命令、执行器、监管进程、操作系统计划任务或真实模型，也没有创建旧检查 log/执行收据/停止证明。所有 Agent/User 均明确标注为模拟；不存在真实任务授权。

### 原始发布协议实际到达的前沿

`build-check-pending.sdk-052.run.json` 是完整原 Run，9624 字节。通过发布包的 `runClassicCli` 创建 tweak SDK change，写真实 proposal/design/tasks，运行原 Open Guard/原材料 validator，再调用包自身的 `completeClassicSdkBuild`。全部调用成功；在第一处检查待办停止，不领取或执行它。

- workflow 是 `comet-classic-tweak@1`，原 hash `fdf07b67da7ac398b4edb7c9909de416a5ef83a8db900f0772e4859731a215cd`。
- phase 为 build，sequence 为 4，`demo:4` 是 pending 的 `tweak.build.check`；受管检查 claim 数量为 0。
- 已接受 Builder 是 `demo:3`，会话为 `SIMULATED-AGENT-BUILDER-052`；任务文件保留 completed 与 `fixture-task` 稳定 ID。
- 该检查的 actionContexts 精确引用 `tweak.open` sequence 1、Open Evidence sequence 2、`tweak.build.execute` sequence 3。后者结果是旧格式 `{event: "build-complete"}`，没有当前 v2 checks。
- `commands` 与 `waits` 均为空：这是 052 preset 普通路径的真实协议，Open 材料通过不产生 full 的 ask_user Wait。不能为了构造批准覆盖而人为加一个历史批准。

这个完整 SDK Run 可用于新的升级回归基线；元数据见 `build-check-pending.sdk-052.metadata.json`。它只证明旧 Open/Build 业务协议与第一处检查待办，不能证明检查通过或完整流程验收。

### 后续前沿明确降为派生样本

跨过旧检查需要已执行命令的收据和检查 Evidence。遵守不启动检查的限制后，后续只调用发布包原 `transitionHandler.apply` 和状态函数，保存每个假设事件及返回值。假设旧检查成功事件没有进入原持久化 Runtime，也没有伪造日志/收据。文件包含 `evidenceLayer`、`events` 与 `substitutedLayer`，不能当作完整合法 WorkflowRun 输入。

| 文件                                          | 原 handler 派生的业务状态与下一步                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-report-evidence-pending.derived.json` | phase=verify、verifyResult=pending、verificationReport 指向实际隔离报告，下一步 `tweak.verify.report.evidence`。                                                                        |
| `verify-check-pending.derived.json`           | phase=verify、verifyResult=pending，下一步 `tweak.verify.check`。报告文件通过原 `classicVerificationReportReceipt` 和原 report validator；这只证明材料边界，旧 Build 检查仍未实际运行。 |
| `archive-prepare.derived.json`                | 假设旧 Verify 检查 Evidence 被接受后，phase=archive、verifyResult=pass、archiveConfirmation=pending，下一步 prepare。该 pass 是明确的假设派生，不是实测检查结果。                       |
| `archive-execute-approved.derived.json`       | 带下一项局部 SDK 的真实模拟批准；原 handler 对假设 preflight 结果返回 archive.execute。                                                                                                 |
| `archive-deliver-approved.derived.json`       | 原 handler 对假设 Archive move 成功结果返回 archived=true、phase=archive、confirmation=confirmed，下一步 archive.deliver；没有移动目录、执行 Archive 或提交 Git。                       |

`archive-preflight-approved.slice-sdk.json` 单独验证批准协议：从发布 factory 取原图、原 schemas/handler，仅把 entry 改为 `tweak.archive.prepare`，初始 Archive 状态来自上表派生。由原 SDK claim/recordOutcome 保存模拟 Agent 提案，再通过原 resolveWait 模拟用户选择 local；得到精确 proposalHash、decisionId 与 pending preflight。它是局部协议探针，workflow hash 已因 entry 改变，不能冒充完整发布包原 Run，也不能用来声称旧 Verify 已通过。

该 preflight context 的 results 保留 `tweak.archive.prepare` sequence 1 的 targetBranch/summary，以及 `tweak.archive.confirm` sequence 2 的 choice 和原 proposal。批准 reason 明确写着隔离模拟用户、不授权生产 change。新的迁移需要保留这些来源关系；不能只根据 state.archiveConfirmation 字符串重建批准。

### 对升级规则的直接约束

1. Build.check 待办前沿有真实已接受 Builder/session/tasks，升级不应要求重做已完成实现；转交 Agent 补检查与当前报告即可。保留原 claim/inputHash/上下文，不能给旧 outcome 添加 checks 破坏原 receipts。
2. 旧 Verify 报告 Evidence 与 Verify.check 待办都尚是 verifyResult=pending。删除检查不能顺势标 pass；当前 Agent 验收工作仍须完成。实际报告引用与原已接受材料不能丢失。
3. 已批准 Archive 的 wait/proposal/decision/context 应保留；缺当前报告时补验收，不自动撤销原批准或重开已执行 Archive/Git。Deliver 的 archived=true 是已产生副作用的业务状态，不得改回待 Archive。
4. 发布包 v1 `archive.preflight` outputSchema 只有 deliveryAction、targetBranch、verifiedBranch、baseCommit 等，没有 v2 的 deliveryPaths；v1 Verify outcome 也没有 checks。因此仅替换 workflow.version 后直接要求所有旧数据满足新 v2 输出会阻塞旧 Archive/Deliver。需要在读取转换中保留原已接受事实，明确哪些确实缺失并交 Agent 核对，不能伪造新报告或重放旧副作用。
5. 上述原始 Run 与派生/局部样本必须分开用于测试：原始 Run 可以做旧发布格式复现；后两者只支撑业务转换规则与批准协议的确定性断言。完整旧检查、Archive validator、Git delivery validator、发布安装及真实模型验收均未执行。

## 后续授权验证：真实旧检查、批准与已归档待交付 Run

后续获得明确授权，只在隔离项目通过 npm 0.5.2 **公开 bin CLI** 实际执行无副作用的 `node -e process.exit(0)`，由发布包自己记录原检查结果与 Evidence；随后通过公开 `runtime dispatch` 模拟 Agent 提案及用户 local 批准，运行公开 Archive Guard 完成实际本地归档。没有调用当前产品 helper 生成基线，没有手工生成检查/停止收据，也没有运行 Eval、真实模型、delivery、push 或 PR。此证据层高于前节纯 handler 派生样本，但不证明新升级代码已经通过验证。

先取得的文档变更样本保留于 `C:/Users/BENYM/AppData/Local/Temp/comet-052-classic-real-archive-a2f339026b1e41cd93e558f84609a8a4/`。其旧 Verify `deliveryInputs` 为合法空对象，因此又按同一范围制作一个有实际临时实现文件变更的样本，避免只验证空路径。

### 非空交付输入样本

目录：`C:/Users/BENYM/AppData/Local/Temp/comet-052-classic-real-archive-inputs-15568e97f06f41b79f63c856e747fa3a/`。

| 完整原 SDK Run 文件                                   |  字节 | 实际状态                                                                                                   |
| ----------------------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------- |
| `verify-accepted.archive-prepare.sdk-052.run.json`    | 49976 | revision 15，sequence 10；两次旧检查与 Evidence 已接受，Verify pass，当前 Archive prepare pending。        |
| `archive-approved.preflight-pending.sdk-052.run.json` | 69090 | revision 18，sequence 12；`demo:11` 的 local 决定已绑定精确提案，`demo:12` Archive preflight pending。     |
| `archived.deliver-pending.sdk-052.run.json`           | 95744 | revision 22，sequence 14；实际 OpenSpec Archive 已完成，archived=true，`demo:14` Archive deliver pending。 |

三份都是未经手工修改的完整原 WorkflowRun，原 workflow 仍为 `comet-classic-tweak@1`、hash 为 `fdf07b67da7ac398b4edb7c9909de416a5ef83a8db900f0772e4859731a215cd`，不是改 entry 的 slice。来源是发布包同一个公开入口 `package/bin/comet.js`，最后一轮 9 次 CLI 调用全部退出 0。实际依赖解析复用现有 node_modules junction；它是提取 npm 包的公开 CLI 验证，不是重新安装发布包的验证。

Build `demo:4` 与 Verify `demo:8` 都由原 `comet-classic-check` 执行器实际运行 noop，结果 exitCode=0、inputBefore=inputAfter，原检查 Evidence `demo:5` 与 `demo:9` 均 resolved。Verify 的真实 output 包含：

```json
{
  "deliveryInputs": {
    "implementation.txt": "git:666c837a118d7eb13bb61e0490e60a736460ddc3"
  }
}
```

该字段在原 Verify Action、后续 Action context.results 以及 Run outputs 中保持原来源；新产品可读取已接受的旧业务结果，不需要为此保留旧执行器。原 Verify Action 自身仍没有 v2 的 checks，原 preflight outcome 也没有 deliveryPaths。

Archive 提案和用户输入均使用显式 `SIMULATED` 标记。原 SDK 生成 `demo:11` 的 proposalHash `7390ea8e81b5da9fb3db7b94c4ac0bbb3984a92bb077783bc01ecab956a82a93`，实际 resolve-wait 记录 `SIMULATED-USER-LOCAL-APPROVAL`/local；没有绕过等待直接设置 archiveConfirmation。实际全局 OpenSpec 1.7.0 CLI 仅在该 Temp 项目执行 archive，目录为 `openspec/changes/archive/2026-11-10-demo`。临时 Git 没有任何 remote；HEAD 仍为初始提交 `5c75462c0920c45fe261133d99044230c3d9c4c9`，没有执行交付提交。

### 命令、原文件与重建边界

- `create-real-fixtures.mjs` 保存可复现脚本，`commands.json` 保存每条真实 argv/cwd/exitCode；`outputs/` 保存完整 stdout/stderr，`requests/` 保存真实提交给公开 CLI 的 JSON。
- `metadata.json` 明确所有环境目录与模拟输入。COMET_DATA_DIR、HOME、USERPROFILE、APPDATA、LOCALAPPDATA、CODEX_HOME 和四个 XDG_*_HOME 均隔离；daemon 关闭，不改真实项目或真实 Runtime。
- `materials.json`（95873 字节）保留实际配置、状态、Archive manifest、proposal/design/tasks、报告与实现文件原文；`reportRef` 为 `docs/superpowers/reports/verify.md`，其真实文件位于该目录的 `project/` 下同一相对路径。实现文件为 `project/implementation.txt`。
- `beforeArchiveMaterialMap` 给出前三个核心 change 材料在原 active 路径的重建对应；使用 earlier Run 时不要把归档后的 state YAML 覆盖到它上面。`.git`、指向旧绝对目录的 `.comet/runtime` fence 和旧 `.comet-state.lock` fence 明确排除，不能随材料复制激活旧 Runtime。

早先两次探路失败也保留：第一份目录 `comet-052-classic-real-archive-1accfb0398444cd8a14306babd36e870` 的旧 Guard 不接受 `--session-id`，尚未执行检查；第二份 `a2f339...` 在 Archive 提案 record-outcome 时因请求含 052 CLI 不支持的 context 字段退出 64，移除该字段后沿原 claim 继续，没有重跑检查。最终非空样本已在脚本中修正这些差异，9 次公开 CLI 调用全通过。没有为失败探路修改产品或降低 validator。

本轮实际执行的是旧发布包真实 noop 检查、原 Evidence/批准、原 Archive preflight 与 Archive outcome validator；交付仍未执行。新产品回归应使用这些完整原 Run 和材料，分别证明批准保留、旧验收认可、非空路径恢复及已 Archive 不重放；不能用这批旧版成功结果替代新版公开 CLI 恢复测试、完整安装或真实模型证据。

## 删除执行器后的测试迁移静态审计

本节只读当前源码、测试和登记；没有编辑产品/测试，没有运行 Vitest、构建或 Eval。工作树正在并行调整，下面是本次读取时的精确引用，后续行号可能变化。

原始审计文件均在 `C:/Users/BENYM/AppData/Local/Temp/`：

- `classic-check-test-retirement-audit.json`：逐文件缺失模块/导出、测试名与行号、registry 原映射及沿 supersededBy 查到的最终有效映射。
- `classic-check-test-retirement-before.json`：17 个相关测试文件的当前全文与 HEAD 原文，1042754 字节。该 Temp 快照尚不代替要求中的 `docs/` 归档；修改活跃断言前应把选定原文放入受审阅的 docs 记录，不格式化历史正文。
- `classic-check-test-registry-before.json`：相关 78 个原 case 完整登记及已有迁移链。**78 是可能受引用影响的集合，不是 78 个应该退休的案例。** 不得覆盖已有 supersededBy 或把仍有效业务都改成 feature-removed。

### 两处当前已知失效断言

`classic-agent-checks.test.ts:24` 的 `compiles Classic %s Agent checks without changing the legacy definition` 仍要求第一个公开工厂生成 version 1、含 verify.check，另一个工厂生成 version 2。这项“双图并存”机制已退休，应归档原断言，改为 full/hotfix/tweak 两个工厂名称均直接使用当前图、无旧步骤/执行器/检查 Evidence validator；原测试中 Archive confirm 仍是 ask_user 的业务断言必须保留。新 `classic-platform-execution-retirement.test.ts` 的 `constructs only the Agent platform Classic %s workflow` 覆盖当前主工厂/无旧节点/报告 schema，尚没有覆盖别名一致性与 Archive 用户决定，不能以已有这个测试为由删掉两项断言。

`classic-agent-checks.test.ts:99` 与 `classic-agent-delivery-repair.test.ts:88` 都仍要求 `check run` 非零退出。新 shim 合法返回 0 的工作指引，不能再断言拒绝；应精确断言 `status=platform-execution-required`、`checksExecuted=false`、无通过字段/收据，命令 marker 未生成，**原 SDK Run 完全不变**。保留随后真实 failed report 在 claim 前被拒绝且 Run 不变的断言；成功报告、任务、Verify 和归档边界也保留。

现有 `classic-platform-command.test.ts` 的 `routes a legacy check invocation to platform work without executing it or claiming a pass` 已覆盖源码 shim、marker 不存在、无 passed/receiptRef 和旧 YAML phase 不变；它是裸 Compat 状态场景，不等于 SDK Run 不变，也不等于 generated 命令 bundle。原 `classic-agent-command-selection.test.ts` 的 compat/sdk × source/generated 四格覆盖不能只替换成这一格。

registry `classic-agent-check-reports-v2` 只登记 `continues a new Classic Run with platform check reports and rejects failed reports before claiming`，没有登记上面的双工厂标题。这个 case 的“平台报告/拒绝真实失败/保留审批边界”仍存在，应保留 case ID、来源和有效流程测试；不能整条 feature-removed 宣称平台报告功能已退休。原 managed-call 拒绝断言的改变需在归档和逐行为说明中显式交代，保留当前同一业务的无执行/无推进更强断言。

### 15 个 import 失效文件的处理边界

| 文件                                            | 缺失依赖或导出                                                                 | 处理方向                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `classic-check-defaults.test.ts`                | check-policy                                                                   | 5 个 timeout/reuse/preset 机制测试可归档，普通执行器已退休；`classic-short-timeout-supervisor-startup` 迁移到旧调用只给指引且不执行，加当前业务合法流程。共享进程基础设施其他用途另测。                                                                      |
| `classic-check-index.test.ts`                   | check-index                                                                    | 5 个旧索引缓存/篡改/mtime 机制测试随功能归档；其旧数据不能成为新版自动执行授权。没有直接 registry case 不代表可以不留移除记录。                                                                                                                              |
| `classic-check-manifest.test.ts`                | check-manifest                                                                 | 6 个旧 manifest/glob 机制测试归档；不能把当前交付路径合法性断言一起删掉。                                                                                                                                                                                    |
| `classic-check-policy.test.ts`                  | check-policy                                                                   | 5 个旧 policy 匹配/输入预算机制测试归档，不恢复 policy 执行器以保留测试。                                                                                                                                                                                    |
| `classic-sdk-execution-origin.test.ts`          | check-record                                                                   | 两个专用 receipt identity/raw-key alias 测试归档；通用 SDK executionOrigin/claim 的 Portable 身份仍由 engine 测试与实际旧 Run 转换保持。                                                                                                                     |
| `classic-agent-command-selection.test.ts`       | executeClassicSdkCommandCheck                                                  | 旧“显式命令执行一次/原收据续行”退休；保留不推断构建、原任务/Run、无用户批准不推进和 source/generated 边界，见下表。                                                                                                                                          |
| `classic-agent-content-judgment.test.ts`        | executeClassicSdkCommandCheck                                                  | 当前正文已改平台报告，旧 import 完全未使用，删除这一个 import 即可恢复加载；其真实失败、用户批准、同 Run、任务、一次 Archive、限定 Git 交付等业务不能退休。                                                                                                  |
| `classic-archive.test.ts`                       | check-snapshot                                                                 | 当前旧 import 未使用；24 个 Archive/文档注记/批准/非 Git 归档/恢复幂等业务均保留。                                                                                                                                                                           |
| `classic-readonly-state.test.ts`                | readCheckIndex                                                                 | 25 个测试混合只读、归属、foreign fence、事务与归档。`:98` 的 missing-home 测试只有 `:109` 调用旧 index；可归档该专用断言，换为保留路径的只读读取，不删整个测试或文件。                                                                                       |
| `classic-command-checks.test.ts`                | check-action；executeCommandCheck/recoverCommandChecks/usableCommandCheck 导出 | 执行/重试/缓存机制退休；`appends command evidence without executing the saved command`、`serializes concurrent evidence sequence allocation`、当前 Run/失败/合法 cwd/无效记录选择等仍对应保留的 Agent 声明记录职责。先按每个测试实际职责拆，不能整文件归档。 |
| `classic-executed-checks.test.ts`               | check-snapshot、recoverCommandChecks                                           | argv 启动/输入证明/复用/超时/原命令重放退休；`does not infer or execute a build when prerequisite configuration is missing`、原失败不能被旧成功覆盖及未满足其他前提不推进仍保留当前报告语义。                                                                |
| `classic-sdk-legacy-check-continuation.test.ts` | check-record                                                                   | 旧执行收据访问实现退休，但已接受旧结果继续有效、错误来源/最新失败/用户决定仍待处理属于保留合同，见下表。                                                                                                                                                     |
| `classic-sdk-application.test.ts`               | 未使用 check-snapshot import；domain index 已无 executeClassicSdkCommandCheck  | 大量共用 fixture 仍跑旧 check。应将 fixture 改为平台报告，保留 Archive/用户批准/任务/分支/真实 Git/恢复业务。不能把整份混合业务测试退休。                                                                                                                    |
| `classic-sdk-revisions.test.ts`                 | runClassicSdkCommandCheck                                                      | `:954` 旧调用位于修复输出测试，其他共用 fixture 也需平台报告；设计/计划重审批、旧决定失效、Builder 部分工作、任务 ID、原交付 checkpoint 仍保留。                                                                                                             |
| `classic-sdk-verify-rounds.test.ts`             | check-record、executeClassicSdkCommandCheck                                    | managed 首次执行/复用/子进程停止 handshake 退休；preset 批准升级 full、真实失败、重新验收、分支重绑、Archive 无副作用恢复、Builder 中断、原批准/文档继续交付不能退休。                                                                                       |

### 逐行为 registry 与可复用测试映射

下表的“可复用”只表示源码断言确有相应内容，本轮没有执行，不报告通过。原测试名完整展开及所有旧迁移链见审计 JSON。

| 原 case ID / 原精确测试                                                                                                                                                                                                                                              | 新测试可覆盖部分                                                                                                                                                                                                      | 仍须补或保留                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-classic-command-selection`；`runs only the Agent-selected Build command for %s through %s`                                                                                                                                                                    | platform-command 的 legacy 指引不执行；platform-execution-retirement 三种图无旧步骤                                                                                                                                   | 保留原四格 source/generated × compat/sdk，缺配置不推进、SDK Run 不变；将“命令恰执行一次”改为“CLI 不执行，Agent 平台执行结果单独提交”，归档原执行断言。                                                      |
| `agent-classic-sdk-continuation`；`continues the original Classic check receipt without SDK parameters or repeated execution through %s`                                                                                                                             | published-business-upgrade 的 `resumes the published 0.5.2 Build frontier on the original Run without running a check`                                                                                                | 新测试目前是 memory SDK；原 public source/generated next 只读、显式 continue 不越过 Agent/用户步骤的边界仍需公开 CLI。                                                                                      |
| `classic-legacy-verify-receipt-continuation`；`accepts an original legacy Verify receipt after business continuation through %s without repeating the command`；`retains original receipt, latest failure, and pending user decision checks for legacy continuation` | published-business-upgrade 的 `preserves published acceptance and delivery data at %s` 保留原 state/waits/Verify outcome；缺旧 Evidence 拒绝                                                                          | 不能只保留正例：最新失败、错 claim/来源、已接受结果与未提交恢复 JSON 的区别、未决用户批准，及原 source/generated CLI 边界仍须补。                                                                           |
| `classic-committed-check-without-auxiliary-receipt`；`continues a committed Classic Verify through %s after losing auxiliary receipts without replay`                                                                                                                | 同一 published 旧接受结果用例不依赖旧 executor/日志/辅助 receipts                                                                                                                                                     | 原 case 含 failed-result/removed-binding/old-claim/changed-receipt/missing-receipt 攻击变体。只有已被取消的专用收据“文件存在性”可退休；原接受来源、最新失败、未提交结果不得伪造必须在新业务读取中保留反例。 |
| `classic-compat-proven-prelaunch-retry`、`classic-compat-unknown-check-no-replay`、`classic-ci539-interrupted-check-plan`                                                                                                                                            | platform-command 不执行旧 run；published Build 转换不 claim 旧 check                                                                                                                                                  | 专用重试/重跑机制 feature-removed，仍保留旧 unknown 取消调度不造停止、不重放、原业务继续与损坏来源不授权。已有 supersededBy 只能追加，不能改写。                                                            |
| `classic-interrupted-builder-continuation`；`records an interrupted Builder failure and resumes its partial work on the same Run`                                                                                                                                    | 无足够等价新测试                                                                                                                                                                                                      | 这是仍存在的 Builder 业务，保留原 selector 与断言，调整 fixture；不要退休。                                                                                                                                 |
| `classic-interrupted-skill-continuation`；`continues interrupted full.design.handoff/full.build.plan work without resetting completed stages`                                                                                                                        | 无足够等价新测试                                                                                                                                                                                                      | 保留未完成阶段续行、已完成阶段不重置，调整平台报告 fixture。                                                                                                                                                |
| `classic-revise-design-after-verify`、`classic-revise-plan-after-archive-approval`、`classic-plan-revision-pause-preservation`                                                                                                                                       | content-judgment 正常批准可复用部分                                                                                                                                                                                   | 原“revises changed Design from Verify...”/“revises the accepted plan from Archive...”/“revises a plan from execute or plan-ready...” 明确验证新批准与旧句柄失效，不能映射一个正常流程替代。                 |
| `classic-sdk-authorized-implementation-continuation`；`resumes an actual implementation revision from verify/archive with declared inputs, retaining only B`                                                                                                         | content-judgment 的真实平台检查与限定提交提供公共基础                                                                                                                                                                 | 仍需保留原授权输入、只保留指定 B 与不重做已完成阶段的精确断言。                                                                                                                                             |
| `classic-delivery-repair-source-exclusion` 等 delivery-recheck/repair case                                                                                                                                                                                           | `classic-agent-delivery-repair.test.ts` 的 `repairs archived Classic v2 delivery with platform reports without replaying commands or Archive` 保留缺报告/failed report拒绝、原Run、只一次Archive、交付新决定/指定路径 | 该测试仍有前述 shim 非零错误断言须修。它不自动覆盖全部分支漂移、不可变 checkpoint、丢回复不重复副作用；原相关 case 要逐个保留其反例。                                                                       |
| `classic-sdk-branch-rebind`、`classic-archive-failed-input-repair`、`classic-preset-requirements-revision`、`classic-approved-preset-upgrade-continuation`                                                                                                           | published 旧 Run state/waits 保留只提供迁移基础                                                                                                                                                                       | 原 branch 重绑后重新验收/批准、Archive 无副作用修复、preset 当前范围重确认、批准升级 full 不补造 full Open 决定等仍是有效业务；改 fixture 后保留原选择器。                                                  |

`classic-sdk-application.test.ts` 必须保留的具体测试包括 `waits for the user delivery choice before scheduling Archive side effects`、`records local-only authorization before scheduling Archive preflight`、`keeps Archive unexecuted until its preflight Action succeeds`、`keeps Archive preflight pending when the branch changes after approval`、`rejects approval if the displayed Build choices drift from the recorded proposal`、`holds Design at a persistent user decision before dispatching document work`、`keeps full Open authoritative until verified artifacts are approved`，以及 scoped archive commit、未提交交付拒绝、Archive 中断恢复不重放的全部断言。它们即使共享旧 fixture，也不是执行器机制测试。

迁移应遵守 `badcase-maintenance.zh.md:48`：保存原 case/来源/旧 test 字段和断言全文，在精确语义退休时追加 feature-removed，测试搬迁则 tests-moved；当前保留业务的测试须等价或更强。任何“还没迁移所以先 skip/删除旧 mapping”的做法都会掩盖剩余交付缺口。新内部 SDK、source CLI、generated CLI 与真实模型是不同层级，本轮静态清单不替代它们的实际运行记录。
