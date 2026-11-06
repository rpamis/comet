# 052 日常编辑与低成本续行复核

日期：2026-10-28。源码基线：`35c9860b77b42bafa0c2d80d8d695889f888a924`，版本 `0.5.1`。本文重新审查 Native 与 Classic 的优化顺序，并补充[核心流程性能调查](2026-10-28-052-core-workflow-performance.zh.md)。没有修改 Runtime、Skill、版本或生成资产。

准备开工时使用[最终实施清单与验收场景](2026-10-28-052-implementation-checklist.zh.md)；本文保留调查证据和判断依据。

## 本轮准则与排序

Comet 帮助用户研发。用户可以直接修改文档和代码；日常操作通常保留 Comet 的目录结构和流程产物。普通编辑应继续当前工作，只更新实际受影响的证据。恢复结构损坏属于另一类情况，不应成为普通编辑的默认路径。

因此，052 应先减少一次编辑引发的重复工作和命令往返，再优化单条命令耗时。上一轮列出的路径检查、Git 查询和交付索引优化仍有价值，但不能代替下面的流程优化。

用户进一步明确：内容检测不能绑定任何语言，也不依赖任何语言的编译，内容判断交给 Agent。本文据此撤回“扩展特定语言或命令的语义检测适配”方向，按以下职责划分推进：

- Runtime 发现文件新增、删除和内容变化，提供原始差异及对应版本；不通过语言解析、AST、去注释规则或编译结果推断语义。
- 当前 Agent 结合需求、差异和已有工作，判断内容含义、影响范围、可保留的证据以及需要执行的检查。文件类型或语言不在支持列表中，不能成为日常续行的阻塞原因。
- Runtime 保存 Agent 的判断并绑定其实际查看的输入，按当前授权执行下一步。输入随后变化时，把新增差异交给 Agent 继续处理，不默认推翻此前全部判断。
- 判断融入当前工作，不因每次保存文件额外启动模型、独立审查或用户确认。连续编辑可在下一次推进时一并处理，复用当前上下文。
- 实际项目是否需要测试、构建或编译，由 Agent 根据任务决定；内容变化检测本身不要求这些工具存在或执行。

| 顺序 | 应做优化                                              | 完成标准                                                                                                              |
| ---- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| P0   | 将语言无关的变化记录与 Agent 内容判断接入当前流程     | 任意语言和文档均可处理；Agent 判断未改变契约时在原阶段继续，不要求语言解析、编译或额外独立审查                        |
| P0   | 根据 Agent 的影响判断收窄检查、验收和批准的失效范围   | Classic 与 Native 都保留未受影响的决定和证据；实际改变需求、验收或授权范围时，仅处理相关决定                          |
| P1   | 按 Agent 判断复用检查，并自动完成已有授权下的最小续行 | 保留当前 Run、配置和已完成工作，只补受影响的检查；复用已有 continuation，不按语言扩展检测器，不让用户维护复杂依赖配置 |
| P1   | Native 分离工作内容与 Git 暂存、提交状态对证据的影响  | 相同文件内容的暂存或空提交不无条件重建实现候选；涉及交付历史、分支和明确 Git 输入的检查仍核对对应身份                 |
| P1   | 在上述路径内消除重复扫描和查询                        | 先测完整的“编辑→继续→验证→交付”成本，再用请求内共享快照、查询批量化和路径索引缩短必要核对                             |

这些是实现建议，不表示当前分支已经完成优化。尤其不能把“允许自由编辑”实现成继续使用与当前实现不匹配的测试成功记录。

## 1. Classic 普通文档中立规则在 SDK 主路径不一致

已有能力明确：[`classicDocumentEvidenceMode`](../../domains/comet-classic/classic-neutral-documents.ts#L13) 默认 `neutral`，OpenSpec 与 Superpowers 的正式工作文档仍受保护。[旧检查记录评估](../../domains/comet-classic/classic-command-checks.ts#L890)会比较逐文件清单；没有显式 `files` 输入且未设 `strict` 时，排除普通文档变化，并记录 `documentChangesIgnored`。已有[回归测试](../../test/domains/comet-classic/classic-command-checks.test.ts#L493)确认修改 README、编辑和新增使用文档后，检查仍可复用。

SDK 的两个关键调用没有采用同一判定：

- [`runClassicSdkCommandCheck`](../../domains/comet-classic/classic-sdk-check.ts#L330) 要求上一条成功检查的 `inputBefore`、`inputAfter` 都与当前完整快照摘要相同，才进入复用分支。
- [Archive 证据核对](../../domains/comet-classic/classic-sdk-archive-preflight.ts#L237)重新采集快照，摘要不同便报 `Classic Archive check inputs changed`。
- [快照文件读取](../../domains/comet-classic/classic-check-snapshot.ts#L347)绑定路径、大小和内容摘要；它不在采集阶段排除普通文档。因此，旧评估器的中立判定不能自动覆盖 SDK 的直接摘要比较。

本轮最小域 API 实验确认：仅追加 README 使用说明，快照摘要改变，但同一源码的 `splitNeutralDocumentChanges` 返回 `material: []`、`neutral: ['README.md']`。结合上述分支，可以确认 SDK 的复用条件与现有文档中立规则不一致。这个实验没有完整驱动 SDK Run，尚不能作为完整 CLI 或真实平台验收。

上述规则提供现状与兼容性证据。目标方案统一提供逐文件原始差异，由当前 Agent 判断 SDK 检查和 Archive 中哪些证据仍适用，不继续扩大文档白名单或按格式编写语义规则。现有显式检查策略的兼容处理需在实现时说明，不能静默改变用户已声明的要求。文档仍应进入交付清单，保留检查不意味着丢弃用户编辑。

## 2. 正式设计和计划仍按原始字节失效

[`classicOpenEvidenceReceipt`](../../domains/comet-classic/classic-sdk-application.ts#L697) 对任务有专门处理，但其他需求文件直接使用文件摘要。[`classicDesignEvidenceReceipt`](../../domains/comet-classic/classic-sdk-application.ts#L742)也绑定设计文件的原始字节。已接受设计的摘要不同，便要求 `revise-design` 后重新批准。[具体拒绝分支](../../domains/comet-classic/classic-sdk-application.ts#L755)

[`classicPlanEvidenceReceipt`](../../domains/comet-classic/classic-sdk-application.ts#L782)已经用 `classicTaskRevision` 规范化任务，但计划正文仍用原始字节摘要。[修订诊断](../../domains/comet-classic/classic-sdk-revision-readiness.ts#L25)把这类变化导向 `revise-design`、重新提出设计并批准，或 `revise-plan`、重新提交计划。

本轮直接调用当前源码确认：给已接受的最小 `design.md` 末尾追加一个空行，`classicAcceptedDesignEvidence` 即拒绝，并输出 `revise-design ... then approve the revised design`。实验使用最小 Run 形状调用领域函数，没有执行完整工作流。

这说明第一批应把“文档有变化”与“已经批准的范围或技术决定变化”分别表达。Runtime 提供变化前后的内容，由当前 Agent 判断是否涉及范围、技术决定、任务映射或验收条件，并决定保留哪些批准。无需为 Markdown、代码块或自然语言分别新增规范化检测器，也不为每次换行单独增加模型调用。

任务勾选已经有独立处理，不能重复立项为缺失功能。[现有任务模型](../../domains/comet-classic/classic-tasks.ts#L50)和[Build 计划测试](../../test/domains/comet-classic/classic-sdk-application.test.ts#L2067)区分任务完成状态与任务要求。

## 3. 优化续行入口，保留已有的同 Run 修订能力

当前已经具备保留工作再继续的能力：

- [从 Verify 修订 Design 的测试](../../test/domains/comet-classic/classic-sdk-revisions.test.ts#L925)覆盖保留已完成实现与 Build 配置。
- [从 Archive 修订计划的测试](../../test/domains/comet-classic/classic-sdk-revisions.test.ts#L850)覆盖同一流程继续，并拒绝已失效的旧交付批准。
- [中断 Builder 续行测试](../../test/domains/comet-classic/classic-sdk-revisions.test.ts#L970)覆盖保留部分成果并继续同一 Run。
- [重新验收测试](../../test/domains/comet-classic/classic-sdk-archive-preflight.test.ts#L512)覆盖保留编辑和历史决定；它会取消待执行交付、回到 Verify，并要求当前结果的新 Archive 决定。

因此，不应新建一套恢复状态机或宣称现在必须重建整个 change。真正要减少的是普通编辑之后的步骤和判定范围：让入口直接给出并执行有当前授权的最小下一步，保留可以继续使用的状态，只使受影响的证据失效。

当前[修订准备度检查](../../domains/comet-classic/classic-sdk-revision-readiness.ts#L134)对验收证据变化给出 `reopen-verification`，随后重新验收并获取新的 Archive 批准。对于 README 这类中立编辑，先修正上一节的失效判定；对于真正改变实现的编辑，重新检查是必要的，但应复用仍匹配的检查，不让用户手动理解一串修复命令。涉及推送、建 PR 等具体交付动作时，仍须核对当前内容与已有授权的实际范围。

正式需求变化仍需要区分现有授权是否已覆盖。[当前测试](../../test/domains/comet-classic/classic-sdk-revisions.test.ts#L1792)明确要求改变架构后停止使用旧设计，并提供合法修订命令；这不是应删除的保护。

## 4. 由 Agent 判断检查影响，Runtime 记录与执行

Classic 已有按命令配置的输入、输出、环境与 Git 绑定规则。[默认策略](../../domains/comet-classic/classic-check-policy.ts#L175)不绑定 Git 历史，任务勾选默认忽略。[策略摘要](../../domains/comet-classic/classic-check-snapshot.ts#L103)可以只绑定当前命令条目，因此修改无关命令配置不必废弃当前证据。[SDK 复用](../../domains/comet-classic/classic-sdk-check.ts#L313)也会让较新的失败或中断遮蔽旧成功，避免错误复用。

已有检查记录、配置和执行能力可以继续复用。由当前 Agent 结合变化内容、项目上下文及检查目的，判断需要重跑的命令和可保留的结果，Runtime 保存判断并执行必要检查。注释是否影响代码生成、lint 或文档测试同样由 Agent 判断，不用语言特判或编译结果作为检测前提，也不另建一套要求用户维护的依赖配置。

与性能底层相关的[路径索引和批量 Git 建议](2026-10-28-052-classic-runtime-performance.zh.md)继续保留。它们优化必要核对的执行成本；先减少不必要的重新验收，才能避免让整轮检查成本掩盖这些收益。

## 5. Native 普通编辑的恢复成本仍会放大

### Build 阶段的说明性编辑缺少轻量入口

给已批准的 brief 追加 `<!-- User explanation. -->`，当前会报告正式注释需要复核；存在 Verify 候选时可独立复核，但 Build 内没有候选时，提示转向 `revise-requirements`。[判定](../../domains/comet-native/native-portable-requirements.ts#L1233)、[本轮实际执行的测试](../../test/domains/comet-native/native-shape-incremental.test.ts#L692)

现有路径保留文件和原 Run，不能描述成丢失用户工作。应解除内容判断必须依赖 Verify 候选的限制：当前 Agent 阅读相关差异，判断说明、格式或执行指令是否改变需求、验收或子任务契约；不影响契约时在当前阶段继续，实际变化才更新相应批准。Runtime 不按 HTML 注释语法替 Agent 作出结论。

### 候选保留不等于检查和批准保留

[`validatedCheckResults`](../../domains/comet-native/native-sdk-checks.ts#L904)重新采集完整输入；[输入指纹不同时](../../domains/comet-native/native-sdk-checks.ts#L948)，要求当前 Verifier 提交 `refreshChecks: true`。[刷新入口](../../domains/comet-native/native-sdk-checks.ts#L282)会收集当前候选的既有检查，其中存在不可重复检查时拒绝直接刷新。已有[JSON 纯格式化测试](../../test/domains/comet-native/native-sdk-application.test.ts#L6282)明确安排两次编辑、两轮刷新。这个测试本轮没有重新执行。

在报告批准后的复核阶段，[当前转换](../../domains/comet-native/native-sdk-application.ts#L2552)还会清空 verification 和各项 acceptance 结果，重新安排检查、独立 Verifier 及用户确认；不能重放时进入 `await-user`。[Archive 预检](../../domains/comet-native/native-sdk-archive.ts#L301)则将检查输入漂移转为 `candidate-drift`。

因此应由 Agent 分别判断需求批准、候选接受、每条检查、验收项和报告是否仍然适用。README 编辑在下面的实验中保留候选，却改变检查指纹；不能仅凭候选保留就认为恢复已足够轻量。Agent 判定无关的变化不应扩大为整组验收失效；相关变化只刷新其影响范围，Runtime 记录判断并在现有授权下自动接续。真实范围变化、报告结论变化或交付授权变化仍需要相应的新决定。

### 将现有命令特判收敛到 Agent 判断

当前可证明窄输入范围的实现仅支持固定 Node 可执行文件的 `--check/-c file.mjs|cjs`，并绑定包声明及执行上下文。[范围定义](../../domains/comet-native/native-check-scope.ts#L9)、[识别条件](../../domains/comet-native/native-check-scope.ts#L18) 现有[生成 CLI 增量修复测试](../../test/domains/comet-native/native-sdk-blocked-recovery.test.ts#L1109)已经覆盖修改左模块、保留右模块语法检查并完成归档；这不是缺失能力，但也不能推导普通测试和构建命令具有同样的复用范围。

这项命令特判是现状，不作为继续扩展的方向。后续由 Agent 判断任何语言、文档与检查的关系，并选择保留或重跑；Runtime 仅记录其判断所对应的变化、已有结果和实际执行结果。原有检查复用案例保留为行为验收，不要求判断过程调用语法检查或编译器。

Native 还已有 Markdown 格式整理、测试计划行号变化兼容，以及 Verify 内正式注释复核；实现变化也可在原 Shape 下建立后继候选，已有授权时[续行不要求新的用户决定](../../domains/comet-native/native-sdk-continuation.ts#L853)。保留这些续行效果，将依赖内容语法的判断逐步交给 Agent，并复用现有 Run 和状态推进能力。

## 6. Native / Classic 同轮对照实验

在真实临时 Git 项目中调用当前构建的领域 API，结果如下。报告位于 `C:/Users/BENYM/AppData/Local/Temp/comet-052-edit-observation-20261028.json`，绑定本报告相同源码提交。所有 Native 快照均返回完整。这里的“保留”仅指相应摘要相同。

| 单独执行的变化     | Native 输入保留 | Native 候选保留 | Classic 默认输入保留 |
| ------------------ | --------------- | --------------- | -------------------- |
| README 编辑        | 否              | 是              | 否                   |
| 源码注释编辑       | 否              | 是              | 否                   |
| 另一源码文件编辑   | 否              | 否              | 否                   |
| 相同文件内容仅暂存 | 否              | 否              | 是                   |
| 空提交             | 否              | 否              | 是                   |

这些结果支持先检查“什么应失效”的优先级。Native 已经对 README、注释保留候选，不能把它写成待实现能力；但候选保留与检查输入保留是不同事实。Classic 默认输入对暂存和空提交已经稳定，也不应重复优化。Native 的[完整输入](../../domains/comet-native/native-portable-checks.ts#L1074)和[候选绑定](../../domains/comet-native/native-portable-checks.ts#L1834)目前带有 Git 观察，应区分实现内容、执行输入与交付身份。这个建议只涉及本地 Runtime 证据的有效性判定；远端 CI、Review、交付记录仍须绑定实际提交，不能把旧 SHA 的成功直接声明为新 SHA 已通过。

实验没有驱动完整 Native verifier、Classic SDK Run 或 Archive，也没有证明某一类输入变化一定导致全量检查。后续实现验收应把这些编辑逐一放入真实 CLI 流程，记录新增命令次数、重复检查数、需要用户决定的次数，以及用户编辑是否完整保留。

## 验证记录与下一批验收

本轮实际执行：

1. 当前源码经 esbuild 打包到系统临时目录，调用快照、文档分类和已接受设计核对函数。确认普通 README 的分类与 SDK 摘要条件不一致，以及设计末尾空行触发修订。临时项目：`C:/Users/BENYM/AppData/Local/Temp/comet-052-edit-project-dASzQO`。
2. 定向 Vitest：`classic-command-checks.test.ts` 的普通文档复用，以及 `classic-sdk-revisions.test.ts` 的设计实质漂移拒绝、Verify 修订 Design 保留实现与配置。结果：2 个文件通过，3 个测试通过，57 个因名称筛选未执行；耗时 68.03 秒。
3. 在五个独立的真实临时 Git 项目中运行表中对照，调用当前构建的领域 API；所有 Native 快照均完整，与源码实验分别记录。
4. 定向 Vitest：`native-shape-incremental.test.ts` 的 `keeps a Build comment edit and points to requirement revision when no Verify candidate exists`。结果：1 个测试通过，20 个因名称筛选未执行，耗时 15.33 秒；它证明现有摩擦存在，不是优化已通过。
5. 三份研究文档检查 Prettier、相对文件链接和行号范围；核对工作区仅有研究文档变化。

本轮未运行全量测试、完整 CLI 工作流、安装包 E2E、真实平台 Hook 和真实模型 Eval；没有产品修改，本次调查不宣称这些层级已通过。

第一批实现的验收应覆盖：多种语言、普通文档及没有编译器的项目都能提供差异并交给 Agent 判断；判断融入当前工作，连续编辑不逐次增加独立审查；Agent 判定未影响契约的编辑直接续行；真实需求变化只更新相关决定；只重跑 Agent 判断受影响的检查；结构完整的场景不进入结构修复；已有批准、任务完成情况和用户文件保留；归档或交付已产生副作用后继续时不重复执行。Runtime 的差异和状态契约用定向测试验证，Agent 对语义与影响的判断另用真实模型 Eval 验收。比较整个日常流程的成本，并分别报告进程启动、文件核对、Agent 判断、检查执行与用户等待。

本次语言无关原则的补充仅调整研究文档，检查格式与引用，没有重新运行上述行为实验或模型 Eval。
