# 052 Classic 与共用 Runtime 性能调查

日期：2026-10-28。源码基线：`35c9860b77b42bafa0c2d80d8d695889f888a924`，版本 `0.5.1`。本文是 `052` 的优化候选调查，没有修改 Runtime、Skill、版本或生成资产。

本文件仅记录当前源码和现有测试提供的静态证据。[主调查](2026-10-28-052-core-workflow-performance.zh.md) 提供本轮 CLI、调用栈与规模测量。根据用户提出的轻量研发原则，整体投入顺序以[编辑后续行复核](2026-10-28-052-edit-continuation-review.zh.md)为准，先处理普通编辑造成的重复恢复；本文顺序仅用于 Runtime 实现优化。下文没有把算法成本、Git 调用数量或历史基准换算成当前机器的耗时和提速百分比。

## 建议顺序

以下路径索引、文件采样和 Git 查询优化服务于语言无关的变化记录；内容含义、影响范围及检查选择交给当前 Agent，不依赖语言解析或项目编译。

| 顺序 | 优化范围                                    | 当前证据                                                                               | 建议与验收                                                                                                                 |
| ---- | ------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1    | Classic 交付范围和提交树的路径查找          | 实现清单逐项遍历全部变更名；每个交付文件再次线性查找同一提交树                         | 为变更名建立集合并按父目录匹配；为每个仓库和提交建立路径索引。增加大仓库、多变更、多子模块样本，保持交付范围和拒绝结果相同 |
| 2    | Classic 检查、Verify 和 Archive 的 Git 等待 | 快照内部 Git 查询同步串行；Verify 生成交付输入时另取一组 Git 状态                      | 先拆分计时，再把无依赖的只读查询有限并发；同一请求内复用一致的观察结果。保留前后输入、环境和副作用边界复验                 |
| 3    | SDK 查询与输出装配                          | 已复用首次 Run 读取，但 entry 输出继续读取编辑审查、恢复信息、分支和存储诊断           | 记录这些部分各自耗时，只复用本请求已核对的 owner、布局、分支和解析结果；让完整诊断与实际 continuation 需求匹配             |
| 4    | Agent 的短命令往返                          | daemon 路由仅覆盖部分查询；调用方还可绕开 daemon；写操作和 Runtime dispatch 走独立请求 | 先统计一次完整流程的命令数、输出字节和重复查询。优先消费已有 continuation 和多字段输出，再决定是否扩展常驻入口             |
| 5    | 真实写入 Hook                               | 轻入口和请求内缓存已经存在；真正写入仍会加载 Guard 图并检查当前证据                    | 建立真实平台写入 Hook 的冷/热分段样本，再决定是否分离纯观察依赖；保持错误关闭和新鲜状态读取                                |

前两项是 Runtime 实现层的候选，应在编辑失效规则与续行路径明确后安排。第三至第五项需要分段测量后才能确定投入，不能只凭模块数量决定。

## 1. 先消除 Classic 交付路径查找的乘法成本

[`collectClassicSdkDeliveryInputs`](../../domains/comet-classic/classic-sdk-delivery-inputs.ts#L143) 先收集变更名，再对实现清单的每个路径执行 `[...changed].some(...)`。因此清单有 N 项、变更名有 M 项时，最坏比较量是 N×M，而且每个路径都重新创建变更数组。[源码](../../domains/comet-classic/classic-sdk-delivery-inputs.ts#L193)

建议预建变更路径集合，先检查完整路径，再沿输入路径的父目录向上查询。这样保留 `ref === name || ref.startsWith(name + '/')` 的原含义，同时避免对每一项扫描全部变更。子模块目录也需要保留目录前缀语义，不能只改成完整路径相等。

[`committedHash`](../../domains/comet-classic/classic-sdk-delivery-inputs.ts#L198) 已按仓库和提交缓存 `ls-tree` 的输出，但是每次核对文件仍执行 `rows.find`，找不到普通文件时还执行一次子模块前缀查找。交付文件数 K、仓库树条目数 T 时，普通命中路径最坏仍是 K×T。[源码](../../domains/comet-classic/classic-sdk-delivery-inputs.ts#L211)

建议缓存 `Map<路径, mode/type/objectId>` 以及子模块路径集合。按父路径解析子模块归属时仍使用父提交固定的子模块提交。不要删除中间提交的内容核对：当前 [`assertClassicSdkArchiveCommitInputs`](../../domains/comet-classic/classic-sdk-delivery-inputs.ts#L465) 要检查交付范围内每个相关提交，优化对象是查找方式。

这两处是当前源码可确认的算法成本；还没有测出它们在实际 Archive 总耗时中的比例。应分别测量少量交付文件的大仓库、大量交付文件和多个交付提交，避免以只含几个文件的 fixture 得出结论。

## 2. 缩短 Classic 快照和交付状态的串行 Git 等待

Classic 快照的 [`git`](../../domains/comet-classic/classic-check-snapshot.ts#L29) 使用同步子进程。目录路径先查询 tracked/untracked 列表，然后取得 HEAD、索引、status，再批量计算 dirty 内容摘要；这些查询当前顺序执行。[源码](../../domains/comet-classic/classic-check-snapshot.ts#L474)

当前代码已经按批次计算 dirty 文件摘要，并对文件处理使用有限并发，所以不应再把“消除逐文件 Git hash”列为尚未完成的目标。[批量摘要](../../domains/comet-classic/classic-check-snapshot.ts#L46)、[文件处理](../../domains/comet-classic/classic-check-snapshot.ts#L456)

可以先把列表、HEAD、索引和 status 分别计时，再评估有限并发的异步 Git 查询。查询属于同一个观察窗口不代表工作区被冻结；发生读取失败、索引变化或内容不稳定时仍需报告不可用，不能把几个不同时刻的结果拼成可复用证据。

SDK 检查在命令执行前后分别取快照和环境身份。[前快照](../../domains/comet-classic/classic-sdk-check.ts#L307)、[后快照](../../domains/comet-classic/classic-sdk-check.ts#L433) Verify 检查成功或合法复用时还要计算交付输入，这一路再次执行 HEAD、diff、untracked 和 staged-deletes 查询。[交付输入](../../domains/comet-classic/classic-sdk-delivery-inputs.ts#L143)

建议让本次快照的只读观察携带经过核对的交付所需 Git 数据，减少相邻调用重复启动 Git；该观察必须绑定根目录、索引、提交和所读取的内容，并在实际提交或 Archive 前重新核对。不能直接用旧 Verify 快照代替 Archive 检查，也不能把用户批准期间发生的修改视为不可能。

Archive 的确认决定和预检本就处于不同边界，都会校验 Verify 证据。应优化各边界内部的重复工作，而非跨用户等待复用一个未经复核的“通过”。[确认决定](../../domains/comet-classic/classic-sdk-archive-decision.ts#L113)、[预检](../../domains/comet-classic/classic-sdk-archive-preflight.ts#L136)

## 3. 控制 SDK 查询和恢复信息的装配成本

[`inspectClassicSdkRun`](../../domains/comet-classic/classic-sdk-status.ts#L117) 已把第一次 store 读取交给随后 Runtime inspect 使用，避免同一 Run 再读一次。后续优化应在现有基础上做请求内复用，不能声称此项尚未实现。

[`classicSdkEntryData`](../../domains/comet-classic/classic-sdk-output.ts#L683) 使用已有 Run，但还会收集编辑审查、revision readiness、分支绑定、恢复信息和存储诊断。Verify 路径会两次构造同一个编辑审查 scope。[输出装配](../../domains/comet-classic/classic-sdk-output.ts#L690) [`inspectClassicSdkRunDiagnostics`](../../domains/comet-classic/classic-sdk-diagnostics.ts#L8) 又会读取 owner 和存储 disposition。

这些检查承担真实恢复职责，不能整体删除。建议先为输出装配增加独立阶段计时，再把已解析的布局、scope、owner 和同一时点的分支观察显式传下去。正常查询仍应返回可用的下一步；省略故障诊断导致 Agent 多试几条命令，可能反而增加总耗时。

## 4. 先减少流程往返，再决定常驻范围

当前 [`daemon 路由`](../../bin/comet-daemon-route.js#L1) 只接收 Classic `state current/next` 和 Native `status/show/root`。带任务上下文或 summary 的调用可能回退；写命令、检查和 `runtime dispatch` 没有通过该路由复用服务端。

[`bin/comet.js`](../../bin/comet.js#L3) 已启用可用的 compile cache，并有快速 Runtime 分流。Classic facade 与命令 bundle 在 [`fast-runtime-router`](../../bin/fast-runtime-router.js#L130) 中加载；不能把“启用编译缓存”“给所有命令新增 fast path”当成尚未做过的优化。

建议先统计真实完整流程中 `inspect → status → get → next` 等重复读取，以及已经由 mutation 响应返回的 continuation 是否又被重新查询。Classic 已支持多字段一次读；应先使用这个已有能力。[测试](../../test/domains/comet-classic/classic-sdk-read-performance.test.ts#L59)

若这些成本被实测确认为主要瓶颈，再评估更窄的持久化入口。扩展常驻写请求需要覆盖 CAS revision、未知执行结果、取消、环境身份和连接中断恢复；不能仅凭只读热查询快就将所有写操作放入 daemon。

## 5. Hook 只优化仍存在的重路径

[`Hook entry`](../../domains/comet-entry/hook-router-entry.ts#L113) 已让确定的非写事件快速返回，并在需要时才加载 Guard。Guard 使用 [`runWithHookReadCache`](../../domains/comet-entry/hook-router-guard-entry.ts#L72)，Classic Hook 也已在单次请求内缓存 SDK 读取与计划检查。[Classic Hook](../../domains/comet-classic/classic-hook-guard.ts#L47)

真正的写入仍会加载包含 Native、Classic、应用契约的 Guard 图。建议分别测量 Node 启动、Guard 加载、项目发现、当前 Run/分支读取、目标校验，再决定是否提取轻量的只读观察接口。不能跨 Hook 请求直接缓存批准、当前阶段或文件内容；平台 Hook 验证必须执行真实入口，内部函数通过不等于实际平台耗时或行为已确认。

## 已有工作与验证边界

本轮阅读了现有工作量测试：Classic SDK 多字段读取、稳定投影不重写、无分支投影免 Git、dirty 文件批量摘要、handoff 每阶段单次读、Design Run 复用及归档扫描缓存。这些用例说明当前已经存在的约束，本文没有在本轮重新执行它们，不能据此报告当前运行通过。

实现上述候选时，应复用并扩充对应测试：

- [`classic-check-performance.test.ts`](../../test/domains/comet-classic/classic-check-performance.test.ts)：Git 调用预算、删除、输出排除和时间戳复原后内容变化。
- [`classic-sdk-read-performance.test.ts`](../../test/domains/comet-classic/classic-sdk-read-performance.test.ts)：一次读取、多字段、投影、分支漂移和 CAS。
- [`classic-handoff-performance.test.ts`](../../test/domains/comet-classic/classic-handoff-performance.test.ts)、[`classic-sdk-design-performance.test.ts`](../../test/domains/comet-classic/classic-sdk-design-performance.test.ts)：来源在最终提交边界变化时仍拒绝。
- [`classic-archive-scan-performance.test.ts`](../../test/domains/comet-classic/classic-archive-scan-performance.test.ts)：多目录、歧义、目录变化和符号链接拒绝。

本分调查只执行了源码、规则、Git 基线和测试代码的读取，没有执行产品修改、全量测试、真实模型 Eval、真实 Agent 平台 Hook、npm 安装验收或提速对照。因此这里的“建议”是待测量和实现的候选，不是已交付的性能改进。
