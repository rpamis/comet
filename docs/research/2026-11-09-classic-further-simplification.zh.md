# Classic 后续减负调查

基线：053，`7f016b28d47e6052959eb18d592a17adccc5abc2`。本记录只调查当前源码和既有真实 CLI 测量，不实施产品变更，不启动 Eval。已删除的内容 hash、输入快照与编辑自动失效不再列为待办。原工作树保持不变，仅新增本文。

## 优先结论

最值得先做三项：

1. **把 Classic 普通检查交给 Agent 平台工具，Runtime 接收实际报告。** 这是减少完整流程回合和受管执行固定成本的最大候选；保留检查充分性判断、真实结果、审批、失败与未知处理。旧 Run、固定应用和用户明确声明的工具步骤保留原执行契约。
2. **一次命令只准备一次 Classic Runtime/Change 路径，把已确认的目录与身份传到内部读写。** 当前许多本机记录操作会再次发现项目、读 YAML 身份、核对旧路径迁移和目录绑定。可直接合并重复准备，不需要删除实际工作区归属保护。
3. **减少 SDK 每次 claim/outcome/evidence 都同步完整 YAML/Portable checkpoint 的写放大，并合并重复检查结果副本。** 先减少纯内部转换的投影，保留开始外部副作用、用户决定、Agent 交接和完成等恢复边界；不直接取消默认跨机恢复。

不能预先承诺节省百分比。当前可用计量显示文件数量增加不再明显拖慢 Classic，但空检查仍有秒级固定成本；下一轮应测调用数与阶段耗时，不用模型步骤数推算性能。

## 已有测量证明什么

[既有 CLI 对照原始记录](2026-11-09-workflow-removal-performance.json)按相同 Node、Windows 和隔离项目，after 三轮中位数如下：

| 项目普通文件数 | 首次空检查 | 相同命令显式复用 | Git 调用 |
| --- | --- | --- | --- |
| 0 | 2985 ms | 约1063 ms | 0 |
| 2000 | 3036 ms | 1049 ms | 0 |

这里的 Classic 样本是 **Compat** 路径：`classic check run → ensureClassicRuntimeRun → executeCommandCheck`，实际命令经 [classic-command-checks.ts](../../domains/comet-classic/classic-command-checks.ts) L661、L882 的 `spawnCommand` 启动。不能把 SDK 的 `spawnOwnedCommand` 监管器归因到这个 3 秒样本。重复样本实际返回 reused=true，没有重跑被测命令，因此约1秒主要来自 CLI、项目/归属发现及既有记录读取；现有总时长没有给出这些部分的独立占比。

SDK 则另走 [classic-check-command.ts](../../domains/comet-classic/classic-check-command.ts) L147、[classic-sdk-check.ts](../../domains/comet-classic/classic-sdk-check.ts) L369/L539 的 claim→执行→outcome→evidence；其 Windows 监管成本尚需独立计量，不能用 Compat 的首轮/复用差值代替。

## C1：普通检查改为平台工具报告

当前 SDK 主链为 `executeClassicSdkCheckCommand → executeClassicSdkCommandCheck → runtime.claim → runClassicSdkCommandCheck → runCommand → runtime.recordOutcome → runtime.recordEvidence`。 [classic-check-command.ts](../../domains/comet-classic/classic-check-command.ts) L147–250、[classic-sdk-check.ts](../../domains/comet-classic/classic-sdk-check.ts) L369–507、L539–605。

SDK 的 runCommand 再启动 Node 监管器、等待 ready/start，经 IPC 等 completed，再确认整个进程树停止；正常完成也走停止确认与后代存活核对。[classic-sdk-check.ts](../../domains/comet-classic/classic-sdk-check.ts) L94–187；[owned-command.ts](../../platform/process/owned-command.ts) L8–175。这部分在平台工具已经负责执行和返回结果时，没有必要再为“被 Comet 认可”重复执行一次。

建议新建内置 Classic Run 接收 Agent 的实际检查报告，沿用已有 `checks` 报告概念和明确的 passed/failed/not-run 结果。Agent 运行命令、读取真实结果、决定旧结果是否适用；Build 一次提交实现与结果，Verify 一次提交完整验收结论。Runtime 只保存原任务归属、真实会话、结果与用户决定，不再要求普通检查的独立受管 Action、进程树监管、日志收据和补交 evidence 回合。Native v4 已有参考实现：[native-sdk-application.ts](../../domains/comet-native/native-sdk-application.ts) L925/L1108/L2996，[native-sdk-task-command.ts](../../domains/comet-native/native-sdk-task-command.ts) L318–338。

保留的核心体验：full 的需求和设计批准、hotfix/tweak 范围升级批准、完整验收、真实失败不变通过、unknown 不声称完成、用户接受/归档及 Git 交付授权。固定应用声明的工具步骤、SDK 对外执行器、旧在途 Run 继续按原契约执行。应通过新定义版本承载新普通路径，不能静默改变已固定的应用定义。

**证据层级：源码已确认；尚无新方案实现或模型行为计量。** 可减少执行层与往返，但是否改变 Agent 判断质量需要单独授权的模型证据。

## C2：合并同次命令的 Runtime/Change 路径准备

Compat 的状态锁先执行 `resolveClassicRunDirectory`；Trajectory 包装、context/artifacts/pending 读写也分别重新解析相同目录。[classic-store.ts](../../domains/comet-classic/classic-store.ts) L80–101；[classic-run-store.ts](../../domains/comet-classic/classic-run-store.ts) L7–102。该解析会读取 change 身份、保护旧 writer、核对绑定，并遍历旧本机记录的迁移入口。[classic-runtime-paths.ts](../../domains/comet-classic/classic-runtime-paths.ts) L90–137、L315–350。

普通文件读取也先进入 `projectTarget → resolveClassicLocalTarget`，之后再做受保护路径读取；重复的相同 Runtime 记录读取因此仍付出解析和路径核对。[classic-protected-path.ts](../../domains/comet-classic/classic-protected-path.ts) L57–84、L143–170；[classic-runtime-paths.ts](../../domains/comet-classic/classic-runtime-paths.ts) L393–486。

SDK Store 的 boundRuntimeRoot 每次可写调用都重新异步解析并准备根；read/CAS/syncStateFile 又会分别调用。[classic-sdk-state-store.ts](../../domains/comet-classic/classic-sdk-state-store.ts) L115–129、L299–305、L568–640。

建议在一个命令/Store 范围内准备 Runtime 根、change UUID、实际目标目录一次，内部显式传递这些已校验值。只在实际写入、原子替换和身份发生变化的边界重新核对。将迁移与旧 writer fence 的完整处理留在首次打开、真正发现旧布局或恢复路径，不在每次读取本机日志时重做。

这是**直接合并重复工作**，无需新增公开配置、hash 或通用缓存服务。保留真 branch/worktree 身份变化拒绝、路径不逃逸、旧布局可恢复；不能换成跨命令无限期信任缓存。当前只有秒级固定成本和源码调用链证据，具体 FS 调用占比待仪表化结果。

## C3：SDK 投影与检查结果减少多份同步写入

### 合并纯内部步骤的 YAML/Portable 投影

当前 Store 的每次成功 compareAndSwap 都调用 syncStateFile；后者读取并解析已有 YAML、构造完整 Portable Run、编码历史、写 YAML，再写 projection marker，并由独立投影锁包装。[classic-sdk-state-store.ts](../../domains/comet-classic/classic-sdk-state-store.ts) L299–335、L515–563、L609–640；[portable-run-checkpoint.ts](../../domains/engine/portable-run-checkpoint.ts) 的 encodePortableRunCheckpoint。

一次真实检查至少包含 claim、outcome，随后还提交 check evidence；Guard 完整 Verify 可能先提交 verify.run 的 claim/outcome 与 report evidence。[classic-sdk-check.ts](../../domains/comet-classic/classic-sdk-check.ts) L560–594；[classic-check-command.ts](../../domains/comet-classic/classic-check-command.ts) L234–250；[classic-sdk-guard.ts](../../domains/comet-classic/classic-sdk-guard.ts) L699–743。即使没有新模型工作，仍可能数次处理不断增长的完整 Run。

可参考 Native 已有“本地 Run 为权威、恢复边界保存 Portable”的方式，合并无外部副作用的连续转换，避免每个内部 revision 都更新完整兼容投影。开始真实命令、Agent 交接、用户决定和最终状态仍保存恢复所需数据。固定应用使用自己的 Store wrapper 契约，不能机械套用内置流程优化。

**不要把完整 Portable checkpoint 直接删掉当作无损优化。** 那会改变仅凭项目文件跨机恢复原批准、未知执行和历史的能力，需要单独决定并设计显式导出/迁移。

### 检查结果合并三份来源

SDK 检查目前有本机 check-receipts 追加式记录、项目内恢复 JSON、权威 Run outcome；结束时先写日志，再写收据，再写 completed 恢复 JSON，随后提交 Run。重复使用时也为新 Action 写新的收据和 completed JSON。[classic-sdk-check-record.ts](../../domains/comet-classic/classic-sdk-check-record.ts) L135–229；[classic-sdk-check.ts](../../domains/comet-classic/classic-sdk-check.ts) L411–507。

当前已经允许原 outcome 在权威 Run 中完整提交后，即使辅助收据丢失仍按同一 Action/claim/outcome 续行。[classic-sdk-check-record.ts](../../domains/comet-classic/classic-sdk-check-record.ts) L193–211。因此可以保留执行未提交阶段唯一的结果日志/恢复记录，成功提交权威 Run 后不再让多个副本继续互相证明；历史收据读取留在兼容适配。若普通检查改为 C1，则可直接移出新普通路径。

**证据层级：源码确认多份写入；尚未独立测出每份收据的毫秒成本。** 合并时保留“执行完成但回报前断线”可恢复，不能在 outcome 提交前把唯一执行结果删掉，也不能让可编辑恢复 JSON 独自建立成功事实。

## C4：Compat 检查索引只在本次命令解析一次

重复命令先读 latestCommandCheck，再调用 usableCommandCheck→evaluateCommandCheck，再读 latestCommandCheck。readCheckIndex 即使命中本进程缓存，仍会在前后分别解析轨迹路径和文件身份，最后 structuredClone；首次读取则加载、解析整个 trajectory 再过滤检查事件。[classic-command-checks.ts](../../domains/comet-classic/classic-command-checks.ts) L239、L661–700、L962–1004；[classic-check-index.ts](../../domains/comet-classic/classic-check-index.ts) L16–89。

建议同一入口读取一次索引并传给 latest/evaluate；只有发生实际追加事件或进入新的执行提交边界时重新读取。保留最近失败优先、Run 隔离、phase/checkEpoch 与未知启动事件，不能把它们一并删除。若长期保留 Compat，可将旧轨迹到当前状态的重建放在恢复/首次加载路径，正常命令读取已有权威当前状态；是否增加新的持久化索引需要先测长 Run 的成本，不为理论规模再加一层存储。

**证据：源码确认重复解析；没有长 trajectory 的独立性能测量。** 本进程已有缓存，不能将本项描述成完全没有缓存，也不能保证去掉两次函数调用即可消除约1秒固定成本。

## C5：交接与报告的正文副本留在显式视图

普通 Classic handoff 已改为引用原始材料，默认生成一套 hash/JSON/Markdown 的机制已经撤下。剩余 Compat handoff 仍读 proposal、写 context.md、更新 artifacts.json、写状态和 trajectory；明确 --full 才生成汇总 Markdown。[classic-handoff.ts](../../domains/comet-classic/classic-handoff.ts) L175–240。

下一步可让正常 continuation 直接携带已确认原始文档引用，正文只在 Agent 需要或明确 --full 时读取/生成；已有 pending handoff 完成与恢复事件仍绑定原 Action。该路径主要影响 full 的 Design 交接，不应冒称所有 hotfix/tweak 的共同主瓶颈。SDK 的验收报告仍需要用户可读结论；可把派生视图生成合并到交接/等待边界，不删实际报告与验收。

**证据：源码观察；未测量其在完整任务中占比，优先级低于 C1–C3。**

## 已核实不应重复列出的项目

- Build/Verify Guard 的 preview 当前提前返回，不执行普通检查；仅 apply 进入真实执行。[classic-sdk-guard.ts](../../domains/comet-classic/classic-sdk-guard.ts) L512、L683。Compat Guard 当前也只 evaluate 既有检查。可减少多余预览 CLI 往返，但不能声称仍有“预览执行一遍、apply 再执行一遍”的缺陷。
- 当前内容/环境/日志完整性证明已撤下，最新 CLI help 也已修正，不再恢复这类扫描来“稳定缓存”。
- 不能直接删用户审批、完整 Verify、原执行 unknown 的保留、真实 Git 身份与 Archive 恢复，来换取表面步骤减少。

## 实施顺序与验收

先做 C2 和 C4 的同次命令共享观察，取得实际 FS 调用下降；再为新建 Classic Run 做 C1，并与 C3 一起收敛普通检查持久化。旧 Run 和固定应用继续合法完成。

每项用同一临时项目与实际公开 CLI 记录首次/复用、实际命令次数、文件/进程调用数与 Run/投影写入次数，分别测试 0/2000 项目文件和短/长历史。保留失败、超时、未知、副作用一次、错误工作区、未批准不推进与有效批准可完成的相关反例。没有用户明确授权，不执行 Eval；也不能把确定性流程通过等同于模型判断质量不变。
