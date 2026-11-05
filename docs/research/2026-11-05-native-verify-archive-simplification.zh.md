# Native Verify 与 Archive 减负分析

来源：`report:2026-11-05-native-verify-archive-overhead`。本报告分析当前分支的代码与 Skill，不实施功能删减，不启动 Eval，也不把静态调用次数当作实际耗时。

## 分析边界

- 开始检查时分支为 `052`，HEAD 为 `895fc964`。工作区已有 Archive 恢复、版本、生成资产和测试等未提交修改，网站子模块也有外部变化；本报告不改动这些文件。
- 本报告中的源码行号对应本轮读取的工作区。`native-sdk-archive-command.ts` 的未提交差异将已返回但被拒收的恢复支持从 `archive.prepare` 扩大到 `archive.execute`、`archive.finalize`，并精确核对原领取信息；不改变下述正常归档的阶段结构。
- 结论区分模型协调、Runtime 正常路径和仅故障时执行的恢复。源码证明某项检查会执行，不证明它在实际任务中占用多少时间。

## 判断与优先级

当前流程确实有可以删减的工作，主要来自重复执行、固定的角色分工、派生文件参与推进、双份状态维护，以及兼容协议暴露给 Agent。不能仅按文件数量或锁模块长度判断耗时，也不能把恢复分支的存在当成每个正常任务都执行了恢复。

建议保留 Verify 阶段的验收职责，收缩其必须执行的手续；Archive 只完成已接受结果的持久化、必要的 Spec 更新和已授权交付。下面是实施顺序建议，不是本轮已经完成的修改。

| 优先级 | 建议删减                                                                                           | 直接影响                                  | 是否改变产品契约                                 |
| ------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| 第一批 | 已确认终止的检查不再反复查 PID；归档同次读取合并；默认响应仅展示当前可执行协议；取消空学习检查往返 | Runtime I/O、进程探测、模型阅读和工具调用 | 前两项应保持正确性边界，后两项改变展示和收尾要求 |
| 第二批 | Build 实际检查统一记录并供 Verify 复用；独立审查按实际需要选择；报告改为派生视图                   | 重复测试、全量重读、模型交接、报告恢复    | 是，需要明确新的执行与验收约定                   |
| 第三批 | 移出不可重复命令；精简双份状态与锁实现；隔离旧格式支持；取消过早的能力占用                         | 状态分支、维护面、恢复复杂度              | 是，必须核对兼容性、历史案例和迁移               |

“第一批”不表示已证明收益最大；它们的行为边界较清楚，适合先完成可比较的确定性测量。取消固定独立审查可能明显减少模型工作，但当前没有证据证明所有任务都能保持检错能力。

## Verify 中值得删减的工作

### 1. Build 自报检查与 Verify 正式检查分离，留下了重复执行的缺口

Builder 的开发检查只填 `name/result/note`，`verificationChecks` 则是 Runtime 后续执行的计划；独立 Verify 不能直接把前者当作正式检查收据。已有复用函数只搜索此前的 `verify.checks` 和 `verify.requested-checks`，没有从 Build 普通命令执行中自动取得证据。见 [`commands.md:33`](../../assets/skills-zh/comet-native/reference/commands.md#L33)、[`native-sdk-checks.ts:1073`](../../domains/comet-native/native-sdk-checks.ts#L1073)、[`native-sdk-checks.ts:1402`](../../domains/comet-native/native-sdk-checks.ts#L1402)。

因此“Build 已经跑过单测”与“Verify 仍执行同一计划”可以同时发生。当前也不是完全没有缓存：符合候选、输入、上下文和原日志要求的正式检查已经支持复用，不能把已有能力当作待开发功能。

建议统一实际检查的记录入口，让 Build 中的真实执行直接产生 Verify 可读取的命令、输入和结果记录，由执行层自动捕获；Verify 只补缺失、失效或明确要求再运行的检查。不能把历史的 `passed` 自报文字自动升级为执行证明。这里取消的是阶段之间的重复执行，验收结论仍在 Verify 中形成。

### 2. 取消“每个候选都必须新开独立会话”的统一要求

Skill 明确要求新的只读 Verifier；SDK 的领取与结果校验也会拒绝 Builder 会话。因此只改 Skill 提示词不能真正缩短这条固定路径。见 [`SKILL.md:66`](../../assets/skills-zh/comet-native/SKILL.md#L66)、[`commands.md:37`](../../assets/skills-zh/comet-native/reference/commands.md#L37)、[`native-sdk-state-store.ts:650`](../../domains/comet-native/native-sdk-state-store.ts#L650)、[`native-sdk-application.ts:591`](../../domains/comet-native/native-sdk-application.ts#L591)。

这项规则增加任务交接、上下文重建、再次阅读全部验收项、领取与回报。对范围清楚且已有充分证据的改动，可以允许当前 Agent 在 Verify 中完成验收；存在具体疑问、复杂交互或用户要求独立审查时再派发。保留原请求、已批准范围、最终结果及未验证项即可，不再要求用另一套模式配置和长表单证明“这次可以少做”。

完整验收应表示每项要求都有仍适用的结论，不必表示每次候选变更都重新阅读、重跑所有项目。增量判断需明确实际变化和受影响行为；此前失败、未知或未执行不能因复用而变为通过。

这是产品契约变更，不是已确认无风险的代码删除。现有独立审查能发现复杂问题，不能用“调用少了”替代检错能力证据。本轮没有运行任何模型比较。

### 3. 删除默认输出中的新旧双协议与不适用模板

领取响应仍同时计算并返回 `outcomeRequest` 和 `resultRequest`，同时还有补检查、失败等替代模板。当前实现已省略重复 Action 正文，不能说完全没有压缩。见 [`native-sdk-continuation.ts:424`](../../domains/comet-native/native-sdk-continuation.ts#L424)、[`native-sdk-continuation.ts:488`](../../domains/comet-native/native-sdk-continuation.ts#L488)。

建议默认只交付当前动作、必需材料和一个完整回报入口；旧协议保持可接收，详细诊断按需展开。候选、尝试、输入哈希和领取标识由 Runtime 保存、校验，Agent 不负责拆装。Builder 逐项 `acceptanceReview`、独立 Verifier 逐项结果、`requestReview` 和 Markdown 报告之间也应减少重复叙述，保留一次可追溯的要求与结论映射，不用多个“已经核对”字段替代语义判断。现有模板见 [`native-sdk-continuation.ts:154`](../../domains/comet-native/native-sdk-continuation.ts#L154)。

### 4. 将一次性有副作用的命令移出 Verify

当前检查计划支持 `repeatable: false`，于是需要追溯历史调用、阻止再次运行、限制 reverify、区分尚未启动与结果未知。见 [`native-sdk-checks.ts:1388`](../../domains/comet-native/native-sdk-checks.ts#L1388)、[`native-sdk-checks.ts:1426`](../../domains/comet-native/native-sdk-checks.ts#L1426)、[`native-sdk-continuation.ts:1453`](../../domains/comet-native/native-sdk-continuation.ts#L1453)。

若把普通 Verify 限定为可重复、不会产生不可逆外部副作用的检查，部署、发布、迁移等操作交给已授权交付路径，就有条件删除 Verify 专属的一次性执行恢复分支。测试和构建仍可写临时输出，“可重复”不等于文件系统绝对只读。迁移旧计划时不能直接把 `false` 改成 `true`；在仍支持原能力的版本中，原有防重放检查必须保留。

## 锁、PID 与重复状态的取舍

### 1. 已确认停止的历史检查不应反复查询进程

普通状态投影、诊断及执行停止协调都使用 `includeSettled: true`；`inspectNativeSdkCheckExecutions` 对这些已经结束的 Action 仍读取执行登记、探测 owner 与 child 的存活。另一方面，Run 已有绑定 Action、attempt、inputHash、claim 和收据的停止事实。见 [`native-sdk-status.ts:65`](../../domains/comet-native/native-sdk-status.ts#L65)、[`native-sdk-diagnostics.ts:31`](../../domains/comet-native/native-sdk-diagnostics.ts#L31)、[`native-sdk-check-execution.ts:392`](../../domains/comet-native/native-sdk-check-execution.ts#L392)、[`native-sdk-check-execution.ts:449`](../../domains/comet-native/native-sdk-check-execution.ts#L449)、[`native-sdk-check-execution.ts:511`](../../domains/comet-native/native-sdk-check-execution.ts#L511)。

这是比“删所有 PID 代码”更直接的减负点：为身份与终止证据完整匹配的终态走快速读取；只有 active、unknown、终止未确认或证据缺失时重新探测。旧记录不完整时仍走保守路径。必须沿用同一真实执行的已确认终止事实，不能仅凭退出码、PID 不存在或经过一段时间推断整棵进程树停止。

当前进程的创建身份已有进程内缓存，Windows 也已有本地探测器和回退实现；不能把“增加 PID 缓存”当作全新发现，也不能声称每次取锁必然启动 PowerShell。见 [`process-identity.ts:26`](../../platform/process/process-identity.ts#L26)、[`windows-process-identity.ts:190`](../../platform/process/windows-process-identity.ts#L190)。

### 2. 可以合并锁实现，先减少需要互相保持一致的状态

Native 自有锁通过 `.coordinator` claim 协调，平台通用文件锁通过 `.contenders` ticket 协调，两套实现都处理发布、竞争、身份核对、删除及恢复。见 [`native-lock.ts:469`](../../domains/comet-native/native-lock.ts#L469)、[`native-lock.ts:578`](../../domains/comet-native/native-lock.ts#L578)、[`recoverable-file-lock.ts:243`](../../platform/fs/recoverable-file-lock.ts#L243)。

SDK Run 之外还维护 Portable 状态投影、内嵌 Run checkpoint 和投影 marker；每次 CAS 成功后同步，非只读同步再使用投影锁。见 [`native-sdk-state-store.ts:225`](../../domains/comet-native/native-sdk-state-store.ts#L225)、[`native-sdk-state-store.ts:527`](../../domains/comet-native/native-sdk-state-store.ts#L527)、[`native-sdk-state-store.ts:629`](../../domains/comet-native/native-sdk-state-store.ts#L629)、[`native-sdk-state-store.ts:716`](../../domains/comet-native/native-sdk-state-store.ts#L716)。

这里没有证据表明每个步骤同时持有所有锁。合理方向是：推进只认 SDK Run，展示投影可以按需生成；Portable 导出与丢失 Run 后恢复收缩到明确的导出/恢复入口，不让每次推进同步完整备份。再把剩余互斥需求集中到共享实现。相关状态被 Guard、恢复和旧 Run 消费，必须迁移这些消费者后才能删除投影锁，不能直接取消锁却继续维护双份写入。

每个 Run 的原子更新、跨 change 修改 canonical Spec 时的短时互斥仍需保留。单个 Agent 也可能与 Hook、Dashboard、第二个 CLI 或用户编辑并发；产品不承诺同时任意写入，并不意味着可以丢掉原子性。若明确只支持同一 Run 单写入者，可以对第二个写入者直接返回“当前操作尚在执行”，不把公平排队和复杂接管当作普通 Agent 工作。

### 3. 保留测试进程清理，减少向 Agent 暴露的内部恢复工作

当前检查先启动监管进程、登记真实进程实例，再启动命令；Windows 正常结束也会完成整树停止确认。见 [`native-check-executor.ts:311`](../../domains/comet-native/native-check-executor.ts#L311)、[`native-check-executor.ts:427`](../../domains/comet-native/native-check-executor.ts#L427)、[`native-check-executor.ts:534`](../../domains/comet-native/native-check-executor.ts#L534)、[`owned-command.ts:7`](../../platform/process/owned-command.ts#L7)。

超时清理、父命令退出后的后代清理和未知执行不自动重放，是实际执行职责。单测可以启动服务器和子进程，直接改回裸 `spawn` 会丢失这些保证。适合缩减的是多处重复探测、重复停止记录和原始 PID/claim/token 的展示；正常输出应只告诉 Agent 当前结果和下一动作，详细进程诊断留给真实异常。

## 已有实验给出的限制

当前仓库记录 bugfree 已于 2026-11-05 撤下。撤下记录指出：为减少阅读而新增的模式、基线、材料、会话续行、紧凑结果与报告分支增加了协议成本；最后一轮内部通过并归档，原题仍只有 10/14。见 [`bugfree-retirement:47`](2026-11-05-bugfree-retirement.zh.md#L47)、[`bugfree-retirement:61`](2026-11-05-bugfree-retirement.zh.md#L61)、[`bugfree-retirement:128`](2026-11-05-bugfree-retirement.zh.md#L128)。本轮只核对仓库记录与当前入口，不重新审计所有原始模型日志，不将历史单题结果推广为整体正确率。

因此不建议重新包装一个轻量模式，再增加选择条件、专用输入、收据和报告。优先删掉普通流程已不需要的重复工作；改变审查策略时直接说明能力和保障的取舍。

## Archive 已有的简化

普通 SDK 归档的内部顺序为 `archive.prepare → archive.execute → archive.finalize`。`archiveNativeSdkChangeValue` 已在一次公开命令内连续执行这些内置 Action，遇到额外审批、扩展动作、失败或未知结果才停止。因此不能把三个内部 Action 算成必然三轮 Agent 工具调用，也不应再次建议“把三条归档命令合并为一条”作为尚未实现的能力。见 [`native-sdk-archive-command.ts:435`](../../domains/comet-native/native-sdk-archive-command.ts#L435) 和 [`native-sdk-archive.ts:55`](../../domains/comet-native/native-sdk-archive.ts#L55)。

SDK 不接受 Compat 的 `--finish`、`--confirmed` 等参数，用户已确认的 Run 决定负责归档授权。Git 提交、推送、合并与 PR 按已获得的交付授权另行完成。当前 Skill 已要求不重复确认同一选择、不重复已完成的交付。见 [`native-sdk-archive-command.ts:107`](../../domains/comet-native/native-sdk-archive-command.ts#L107)、[`workspace.md:33`](../../assets/skills-zh/comet-native/reference/workspace.md#L33)。

## 优先删减的 Archive 成本

### 1. 合并成功路径上反复执行的完整检查

当前存在可直接从调用关系确认的重复：

| 正常路径                             | 当前工作                                                                                                               | 删减方向                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `archive.prepare` 执行器与结果校验器 | 执行器运行完整 `archivePreflightOutput`，成功结果校验器再运行一次同一函数                                              | 内置执行器形成一次可信的观察结果；同一操作提交时核对身份与仍可能变化的输入，不完整重跑预检 |
| 每次完整 preflight                   | 校验候选、检查输入，再分别计算普通 `candidateBinding` 与恢复 `recoveryBinding`；两种绑定都会遍历材料并进入候选输入检查 | 一次采集材料和输入，计算不同用途的绑定；恢复字段可保留，避免为两个摘要读取两次相同材料     |
| `archive.execute`                    | SDK 绑定检查后，Portable 层在锁内再次运行归档预检；写完 Spec 后检查，返回结果前再次检查，结果校验器再检查              | 将共享的只读观察传入真正的提交边界，只补查会被这次写入影响的 Spec；保留写入前的当前值比较  |
| `archive.finalize`                   | 执行器绑定检查、事务内搬迁前后候选检查、结果校验器绑定检查                                                             | 合并归档操作内的候选检查；内部搬迁只核对受影响文件和持久收据，跨进程恢复时才重新完整检查   |

证据：

- Preflight 执行与成功结果复查：[`native-sdk-archive.ts:441`](../../domains/comet-native/native-sdk-archive.ts#L441)、[`native-sdk-archive.ts:457`](../../domains/comet-native/native-sdk-archive.ts#L457)。
- 同次 preflight 的候选、输入与双绑定：[`native-sdk-archive.ts:375`](../../domains/comet-native/native-sdk-archive.ts#L375)；绑定中的目录遍历与输入检查：[`native-sdk-archive.ts:131`](../../domains/comet-native/native-sdk-archive.ts#L131)、[`native-sdk-archive.ts:228`](../../domains/comet-native/native-sdk-archive.ts#L228)。
- Apply 的重复预检和 Spec 核对：[`native-portable-archive.ts:805`](../../domains/comet-native/native-portable-archive.ts#L805)、[`native-sdk-archive.ts:658`](../../domains/comet-native/native-sdk-archive.ts#L658)。
- Finalize 的多次候选核对：[`native-sdk-archive.ts:744`](../../domains/comet-native/native-sdk-archive.ts#L744)、[`native-portable-archive.ts:1053`](../../domains/comet-native/native-portable-archive.ts#L1053)、[`native-portable-archive.ts:1110`](../../domains/comet-native/native-portable-archive.ts#L1110)、[`native-sdk-archive.ts:821`](../../domains/comet-native/native-sdk-archive.ts#L821)。

这是优先级最高的实现简化候选，但不是删除所有校验。锁外的其他进程仍可能编辑项目；不能仅因持有 Comet 的状态锁就断言文件未变化。应明确哪次采集绑定实际输入、哪个提交点检查变化、哪些由 Runtime 自己完成的写入可以直接计算预期结果。不能跨用户等待、未知执行或进程重启复用内存观察。

### 2. 删除“编辑派生报告也会改变流程”的功能语义

`verification.md` 由状态渲染，当前却同时承担被用户确认、可被人改写、必须保全原文、必须逐字节匹配的角色。执行器为用户改写保存 `native/preserved-verification/...`，结果校验器再核对备份；用户确认后 `verify.revalidate` 又核对整个报告，报告变化会回到 `verify.report`。随后归档还要保存报告摘要、原状态版本、最终状态版本，重新渲染并检查对齐。

见 [`native-sdk-report.ts:97`](../../domains/comet-native/native-sdk-report.ts#L97)、[`native-sdk-report.ts:190`](../../domains/comet-native/native-sdk-report.ts#L190)、[`native-sdk-report.ts:213`](../../domains/comet-native/native-sdk-report.ts#L213)、[`native-sdk-application.ts:2669`](../../domains/comet-native/native-sdk-application.ts#L2669)、[`native-portable-archive.ts:1062`](../../domains/comet-native/native-portable-archive.ts#L1062)。

可以把验收结论与用户决定绑定到结构化结果和候选内容，报告仅作为可重新生成的阅读视图；用户补充进入独立备注。这样才有条件删除报告备份、报告改写触发的回退、跨阶段报告状态对齐等代码。迁移时必须保留已有用户改写，不能覆盖后声称“报告本来就是生成物”。用户主动要求重新验收和实际候选变化的重新验收仍然保留，不应随报告简化一起删除。

### 3. 用实际 Spec 冲突替代过早的“同能力占用”阻塞

`otherPortableCapabilityOwners` 在存在 Spec 变更时列出 Git worktree，读取其他 active change；只要别的 change 声明相同 capability，就使当前 Archive 不 ready。它不要求当前 canonical Spec 已经发生冲突。见 [`native-portable-archive.ts:250`](../../domains/comet-native/native-portable-archive.ts#L250)、[`native-portable-archive.ts:791`](../../domains/comet-native/native-portable-archive.ts#L791)。

这是可撤下的产品策略候选：归档时只比较真正要更新的 canonical Spec 基线与当前值，发生实际冲突再解决；不要因为另一个工作区也声明同一能力就要求串行安排。Spec 写入已经核对目标现值，见 [`native-portable-archive.ts:385`](../../domains/comet-native/native-portable-archive.ts#L385)。但删除占用策略仍须验证多 change、worktree 合并和相同 Spec 更新的行为，不能把“已有哈希”当成自动证明所有并发情形正确。

没有 Spec 变更时该函数已立即返回，不能把它描述为每次纯文档归档都扫描全部 worktree。

### 4. 收缩 SDK、Portable 与旧 Runtime 的并存范围

公开 Archive 入口先按 SDK owner 路由，后面还保留 Portable 与旧 Runtime 处理；SDK 的归档实现又复用 Portable 的事务与材料逻辑。旧 Run 没有新绑定、旧报告缺少版本字段、旧事务需要历史原文的恢复分支继续存在。见 [`native-archive-command.ts:136`](../../domains/comet-native/native-archive-command.ts#L136)、[`native-sdk-archive.ts:188`](../../domains/comet-native/native-sdk-archive.ts#L188)、[`native-sdk-archive.ts:266`](../../domains/comet-native/native-sdk-archive.ts#L266)、[`native-sdk-archive.ts:523`](../../domains/comet-native/native-sdk-archive.ts#L523)。

长期可将旧格式支持集中为只读查看与明确迁移入口，停止在每个新 Run 的普通流程中承载旧恢复规则；文档也按当前 Run 路由交付，避免让 Agent 同时理解两套参数。这主要减少维护面与上下文，不保证显著缩短一个健康的新 SDK Run。兼容迁移是功能范围决定，不能立刻删除仍有用户状态依赖的恢复模块。

## 模型收尾中可移出的附加工作

项目记忆与个人学习并非 Archive Runtime 的固有步骤。Skill 目前要求结束前完成个人学习检查、查询项目待评审、编写评审动作、核对 `applied` 与 pending 计数；同时已经支持 `--learning-file` 一次提交，且明示学习失败不阻断已完成开发。见 [`commands.md:75`](../../assets/skills-zh/comet-native/reference/commands.md#L75)、[`commands.md:91`](../../assets/skills-zh/comet-native/reference/commands.md#L91)。

可取消每次任务都必须证明“没有可学习内容”的往返，以及为完成任务而立即处理全部学习队列的要求。只有明确的用户纠正或已验证、可复用的新经验才提交；其余留待异步整理。不能把现有支持批量提交误写成“目前只能逐条调用”。

`walkthrough.html` 默认开启，在 Build 收尾和 Verify 展示结果前要求生成或更新；Archive 仅搬迁已有页面，不补生成、不新增确认、不重跑代码检查。见 [`SKILL.md:131`](../../assets/skills-zh/comet-native/SKILL.md#L131)。它属于可选解释材料的模型成本。若用户追求最短收尾，可采用已有 `change_walkthrough: false`，或将生成改为用户需要时执行；不应将它记为 Archive 的固定模型生成步骤。

## 不应作为“无用代码”直接删除的部分

- 最终候选与已接受验收结果的绑定。否则用户接受的是旧代码，归档却可能发布后来改过的实现。
- Spec 写入的当前值比较与最小事务记录。写到一半退出后，需要知道哪些 Spec 已应用，不能重新覆盖用户更新。
- 归档目录移动、最终状态与收据之间的恢复。当前 finalize 有 `specs-applied → report-aligned → moved` 等状态；可以合并事务设计，不能只删日志后假定多文件写入具有原子性。
- 授权边界与外部交付的真实结果。SDK 完成不等于 Git push/PR 完成，不能为了快把“归档成功”写成“已交付”。

这些边界有当前回归案例约束，减少实现时应保持原行为或明确撤下对应功能，不能删除历史失败断言换取更简单的代码。案例迁移要求见 [`badcase-maintenance.zh.md`](../architecture/badcase-maintenance.zh.md)。本报告未宣称这些检查的现有实现全部必要；只保留它们必须保证的结果。

## 后续实施的验收方法

先测同一正常任务的模型消息数、工具调用数、候选及输入采集次数、各步骤墙钟时间，再比较删减后的相同任务。对代码层简化使用确定性临时项目覆盖成功归档、内容漂移、事务中断及恢复；不把内部函数测试替代公开命令验证。涉及模型审查策略的正确率与费用，需要用户另行明确授权对应场景、样本和轮次的 Eval，本次不执行。

## 本次交付与检查

- 仅新增本研究文档，没有修改产品代码、Skill、版本或 Changelog，也未提交或推送。分析期间其他任务继续更新 Archive 相关文件，本任务未干预这些修改。
- `pnpm exec prettier --check docs/research/2026-11-05-native-verify-archive-simplification.zh.md` 通过。
- 使用 Node 检查本文 65 个引用的本地文件与源码行号，全部存在且行号有效；这只证明引用可定位，结论来自前述源码阅读。最初的 Python 版本检查未启动，本机 `python.exe` 别名不可用，已改用 Node 完成。
- 没有发现适用于独立研究笔记的现有文档契约测试，因此未扩大为无关仓库测试。
- 未运行行为回归、构建、全量测试、真实平台 Hook、安装验收、性能基准或模型 Eval：本次是静态分析，没有产品改动，也没有启动 Eval 的授权。

本报告不宣称已修复用户报告，不给出未测得的耗时比例、可删除行数或正确率保证。
