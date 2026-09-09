# Classic 五阶段工作流与强自主模型适配调查

调查开始：2026-09-08；整理完成：2026-09-09

基线：`master`，`a23a2519ba75060ff9df1fec0e616fbaf63d5a9e`，Comet `0.4.0`
性质：调查与设计建议；未修改产品 Skill、Runtime、配置或版本，未启动 Classic change。

## 结论

**保留 Open → Design → Build → Verify → Archive 五阶段，优先重构阶段内部的执行协议。** Classic 的价值在于把需求、设计、实现、验证与 spec 归档连起来，并支持跨会话恢复。最值得优化的是重复澄清、预先展开全部实现代码、逐任务新建代理、多份进度人工同步，以及重复检查和外部 Skill 的控制流冲突。

面向用户所说的 Fable 级、GPT-5.6、GPT-6 等强自主模型，建议让模型拥有范围内的实现规划权，让 Runtime 负责稳定身份、授权边界、证据有效性、恢复和归档。适配依据应是实际任务中的能力与失败轨迹，不是硬编码模型名称。本调查不比较这些模型的规格，也不声称已经测得其性能改善。

**当前可以确认开销机制，尚不能量化历史运行慢的归因比例或承诺节省百分比。** 后续应以当前发布资产、实际嵌套 Skill 和指定模型进行逐项消融实验。

## 证据范围

- 核对根目录、`assets/`、`domains/comet-classic/`、`docs/` 的开发规则。
- 当前 HEAD 与本地 `origin/master` 引用无提交差异；未 fetch，不把该引用当作已实时核实的远端状态。
- 开始调查时已有 `website` 子模块引用变化，未修改它。
- 主要依据为 `assets/skills-zh/` 中的 Classic 入口、五阶段及 12 个 reference 文件，并核对英文契约与 Runtime。
- 嵌套依赖读取了本地 `.agents/skills/` 的 brainstorming、writing-plans、executing-plans、subagent-driven-development 及实现/审查模板、TDD、调试、验证 Skill。它们是审查对象，不是本轮执行的工作流。
- 本机 OpenSpec 包为 `1.11.0`；读取了其默认 schema 和 explore/new/verify 模板。项目 `.agents/skills/` 未提供 OpenSpec Skill，因此用包内模板分析这一层，不能据此断言所有用户实际安装的模板完全相同。
- 另核对当前 Classic Eval treatment 使用的 `eval/local/skills/benchmarks/dependency/` 快照。快照与本机 Skill 并非完全相同，不能把旧 Eval 直接当作当前组合的结果。

历史调查仅用于定位先前精简方向，本文关于当前行为的结论均重新核对了工作区材料。

## 已复现的 Runtime 问题

独立 Runtime 调查使用当前发布 `.mjs` 在临时项目中验证了以下行为。主线程核对了对应源码；这不是仅凭提示词作出的推测，也不是指定模型的行为实验。

复现用 `COMET_FORCE_PHASE=1` 构造待检查阶段，未完整执行 Open/Design/Build。该变量在当前源码中只放行直接设置 phase，不跳过 guard 或 `transition verify-pass` 的检查。源码变化实验真实执行了验证命令，但失败后没有追加失败记录，用于检查代码变化本身是否会使先前成功记录失效；若显式追加了失败记录，guard 会拒绝该最新失败记录。

| 问题                                   | 实际观察                                                                                    | 对优化的影响                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 旧验证记录没有输入失效保护             | 初始验证退出 0 并记录；修改源码后同一验证退出 1，Verify guard 仍退出 0                      | 先让证据绑定验证输入，再允许缓存复用                       |
| `verify-pass` 转换弱于 guard           | 临时项目没有验证命令记录，只有报告文件，仍可成功转换到 archive                              | 统一自动推进前必须共享同一套证据前置条件                   |
| Build guard 不因前置失败而停止昂贵检查 | 两次 guard 均因前置条件失败退出 1，但实际触发了两次构建；已有成功记录也不会覆盖自动推断构建 | 先执行廉价阻塞检查，失败时避免启动构建；再考虑有效证据复用 |

来源：`domains/comet-classic/classic-command-checks.ts:109`；`domains/comet-classic/classic-state-command.ts:786`；`domains/comet-classic/classic-guard.ts:347`、`:461`、`:923`。`runChecks` 会累计失败并继续执行后续检查，虽然 Build 检查旁的注释声称应在配置通过后才执行。

建议把前两项作为扩大自治前的必要修复，把第三项作为可独立验证的直接性能修复。Runtime 修复需要源码、生成资产和回归测试同步，不应只靠 Skill 要求模型更谨慎。

## 1. 五阶段实际上执行了什么

| 阶段    | 当前职责与产物                                                                                           | 对强模型最值得调整之处                                                     |
| ------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Open    | 工作区绑定；explore；resolved brief；new change；按 schema 生成 proposal、specs、design、tasks；最终确认 | 已提供充分需求仍要求多轮澄清；深度设计开始前就生成高层设计和任务清单       |
| Design  | handoff；brainstorming；多方案与分段确认；brainstorm-summary；技术 Design Doc；可能回写 spec             | 重开澄清流程；多个确认层；高层 design 与技术 Design Doc 长期一致性维护     |
| Build   | writing-plans；计划完整展开；执行/TDD/review 联合选择；执行 Skill；任务验收、提交、勾选；guard           | 对已具备自主规划能力的实现者规定大量微步骤；任务级冷启动和双清单记账       |
| Verify  | scale；最终集成 review；light/full 验证；报告；失败回 Build；guard                                       | 验证深度主要按规模决定；light 明确跳过场景覆盖；修复循环与证据复用不够精细 |
| Archive | 归档及交付确认；delta 合并主 spec；文档标注；移动；唯一归档提交；按授权交付                              | 生命周期值得保留；交付授权和执行结果的持久恢复还可加强                     |

默认 schema 的 `apply.requires: [tasks]`，而 tasks 依赖 specs 和 design。这使 Classic Open 的退出条件实际上达到“可实施产物已齐备”，接着 Design 又开展深度设计。若要 Open 只完成意图和行为契约，必须同步调整阶段就绪条件，不能只删几段提示词。

来源：`assets/skills-zh/comet-open/SKILL.md:185`；`assets/skills-zh/comet-design/SKILL.md:15`；`node_modules/@fission-ai/openspec/schemas/spec-driven/schema.yaml:145`。

### 嵌套调用关系

```text
comet-classic
  Open    -> openspec-explore -> openspec-new-change -> status/instructions 循环
  Design  -> handoff -> brainstorming -> 分段确认/文档确认/后续计划入口
  Build   -> writing-plans -> Comet 联合配置
             -> executing-plans
             或 subagent-driven-development + Comet subagent-dispatch
                  -> implementer / task reviewer / repair agent
             -> TDD（按配置）/ systematic-debugging（遇到失败）
  Verify  -> verification-before-completion -> 最终代码审查
             -> light 或 openspec-verify-change -> repair loop
  Archive -> Comet archive -> OpenSpec archive -> Git 交付
```

这不是每次都会完整展开的调用计数；TDD、任务 review、调试和 full verify 均有分支条件。外部 Skill 的后续入口也不等于一定执行，Comet 已覆盖其中一部分控制流。

### 已经存在、应保留的优化

- 清晰的 brief 和名称不再独立确认；Build 的继续/暂停和配置已经合并。
- `review_mode: standard` 仅对风险任务派发任务级 review；spec 与 quality 已合并到同一个任务 reviewer。
- Build 不追加最终 reviewer，整个 change 的最终集成代码审查归 Verify。
- reviewer 不默认重跑实现者已报告的同一批测试；大型交接通过文件引用，避免累计历史进入派发 prompt。
- handoff 已有确定性摘录和 hash；主动压缩不再是强制停顿点。
- 有效的子代理检查点可恢复到审查或勾选步骤；已完成任务不应重做。
- 前三次明确可修复的 Verify 失败自动返回 Build；Archive 已把归档和交付合为一次选择。

来源：`assets/skills-zh/comet-build/SKILL.md:79`、`:193`；`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:48`、`:64`、`:109`、`:157`；`assets/skills-zh/comet-verify/SKILL.md:65`；`assets/skills-zh/comet-design/SKILL.md:224`。

## 2. 优先优化点

以下“高/中”表示优化优先级，不是已复现产品缺陷的严重程度。源码能证明规则存在，规则是否造成某次真实停顿仍需模型轨迹。

### 2.1 高：澄清停止条件应看信息是否充分

Open 明确要求不得把一次问答视为足够澄清；Design 要求不得仅一轮问答就创建 Design Doc，并要求遵循 brainstorming 的 2-3 方案、分段确认。本地 brainstorming 还包含写成文档后的用户审视和自动进入 writing-plans。Comet 虽控制最终文档写入时机，但没有像 Build 对 writing-plans 那样，为全部后续控制流声明明确返回边界。

对于完整 PRD、已有设计或明确修复要求，这些规则会要求模型重新证明“已经讨论过”。即使现有主流程的常规确认只有 Open、Design、Build、Archive 四类，条件性的 workspace 决策、分段确认和依赖 Skill 确认仍可能增加轮次。

**建议：**建立一个持续更新的决策记录，记录目标、非目标、验收、约束、未决问题与授权。只问会改变行为、范围或风险承担，且无法从现有材料解决的问题。可同时回答的问题合并。已确认内容和有效授权在恢复后继续有效；材料确有矛盾时重新确认。

正常 change 可在实施前联合审视需求、关键设计与执行计划，再在交付前审视最终结果。高风险或用户要求分阶段审视时保留单独确认。减少常规确认是本文建议，不是当前 Classic 行为，也不是 Anthropic 要求取消全部审批。

来源：`assets/skills-zh/comet-open/SKILL.md:70`、`:244`；`assets/skills-zh/comet-design/SKILL.md:108`、`:118`、`:137`；`.agents/skills/brainstorming/SKILL.md:28`、`:61`、`:122`。

### 2.2 高：实施计划不应预先生成第二份实现

Comet Build 委托 writing-plans 处理计划格式。实际嵌套 Skill 要求每个步骤 2-5 分钟、包含完整实现和测试代码，并明确要求重复代码而非引用前面任务。这里要区分“任务”和“步骤”：当前 Skill 已要求任务是独立可测试成果，问题主要在任务内部仍必须展开全部代码和微步骤。

对强模型，这会增加计划生成和后续读取成本，还把未经实际执行验证的函数签名、目录和实现细节固定下来。Build 发现正常实现细节需要调整时，又可能触发计划/设计不一致处理。

**建议：**计划只要求成果、影响范围、依赖、必须保持的接口/约束、验收方法、主要风险。先确定完整里程碑，再逐步细化当前工作；只有协议格式、迁移算法或关键兼容行为等确需预先审查的细节才给代码。模型可在不改变行为契约的前提下调整实现顺序、合并内部步骤，并持久化调整原因。

来源：`assets/skills-zh/comet-build/SKILL.md:34`；`.agents/skills/writing-plans/SKILL.md:36`、`:47`、`:128`；Eval 快照 `eval/local/skills/benchmarks/dependency/superpowers/writing-plans/SKILL.md:130`。

### 2.3 高：执行单元应允许保持上下文

Comet subagent 扩展要求每个任务全新 implementer，禁止合并多个任务，禁止跨任务或角色复用，修复 agent 也必须新建；主会话只协调。当前推荐规则主要是任务数大于等于三时推荐这种模式。

若有 N 个任务、R 个风险任务，在 standard 且无修复的该执行分支下，仅实现和审查就需 N + R + 1 次代理派发，最后的 1 是 Verify 最终审查；不包含其他调查代理。每个任务还有实现提交和协调者进度提交。这个结构计数不是实测 token 或耗时。

**建议：**同一模块或同一可验证成果由连续 builder 完成，范围内修复优先复用原实现者；真正独立的调查、实现和专项评审才委派。reviewer 与实现者保持独立。出现上下文退化、连续无进展或所有权改变再换实现者。任务数不能单独决定是否派发代理。

full workflow 当前将跳过执行 Skill 的直接执行视为 `direct_override` 例外，因此将自主执行设为正常路径需要改 Build 契约、state 枚举/验证和 guard，不能由 Agent 自行绕过。

来源：`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:33`、`:35`、`:140`；`assets/skills-zh/comet-build/SKILL.md:128`、`:165`；`domains/comet-classic/classic-guard.ts:589`。

### 2.4 高：Comet 应拥有唯一阶段控制权

本地 executing-plans 在存在子代理工具时要求转用 subagent-driven-development，并在末尾调用 finishing-a-development-branch；这与用户在 Comet 选择顺序执行、Comet 提前绑定工作区、Verify/Archive 接管收尾不完全一致。该模式切换与收尾指令也存在于 Eval 依赖快照。

本地 SDD 现在允许前三轮修复复用实现者，Comet 扩展却要求全新修复者；Comet 明确声明覆盖，避免了谁优先的不确定性，但模型仍需加载并处理两套相反规则。SDD 的独立账本与 Comet 进度文件又各有自己的恢复语义。

**建议：**在 Comet 自有层建立最小输入/输出契约：外部能力返回设计判断、计划、实现或审查结果，不能选择下一阶段、创建另一个工作区或自行收尾。长期更适合将 Classic 的必要执行规则收敛为自有短协议，把外部 Skill 作为可选能力；OpenSpec 继续负责行为 spec 和归档语义。不要修改上游原始 Skill，也不要把 Native 状态机并入 Classic。

来源：`.agents/skills/executing-plans/SKILL.md:14`、`:19`、`:34`；`.agents/skills/subagent-driven-development/SKILL.md:321`；`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:5`、`:35`、`:153`；`assets/skills-zh/comet-archive/SKILL.md:137`。

### 2.5 高：减少人工维护的事实副本

当前有 OpenSpec design、技术 Design Doc、OpenSpec tasks、详细 plan 中的 checkbox、brainstorm-summary、Comet subagent-progress，以及嵌套 SDD 自己的 ledger。它们不全是重复内容，但有重叠的设计结论、任务身份与进度，必须经常核对。

特别是任务勾选依赖“完整任务文本恰好唯一”，自然语言计划一旦改写就需要重新维护映射。每次派发、回报、审查和勾选又要求 Agent 更新 Markdown 检查点。

**建议：**每类事实指定一个权威记录。行为要求由 delta spec 持有；技术决策由一个 design 文档持有，复杂 RFC 可链接；任务由稳定 ID 关联成果与验收；执行状态由 Runtime 事件产生，Markdown 清单和恢复摘要是可重建视图。分步引入，先保留现有文件布局作为兼容输出，再减少人工双写。

来源：`assets/skills-zh/comet-classic/reference/file-structure.md:7`；`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:23`、`:93`、`:135`；`assets/skills-zh/comet-design/SKILL.md:133`。

### 2.6 高：先绑定证据，再消除重复运行

Build Skill 要求先显式运行构建/测试，build guard 又优先执行自动检测出的构建命令。Verify light 还要求编译通过。确实存在同一输入重复构建的路径。

**但 verify guard 不会再次自动执行测试。** `classic-guard.ts` 只在 scope 为 build 时推断命令；verify 读取最近的 `record-check`。记录包含 runId、scope、command、exitCode、cwd、timestamp，没有代码树或验证输入指纹。因此它目前不是可以放心跨修改复用的证据缓存。

**建议：**先引入一次执行并记录结果的 Runtime 能力，将检查绑定到相关代码、测试、依赖锁文件、配置和环境标识；明确纳入 staged/unstaged 及相关 untracked 输入，不能只看 HEAD。结果带退出码和日志引用，区分 build 与 verify 的证据责任。同一输入的有效结果可服务多个检查要求，输入变化则精确失效；全局依赖变更需扩大失效范围。无法可靠界定输入时重新执行。

语言层的“本条消息重新运行才算新鲜”应改成“证据对应当前输入才有效”。不可把 `COMET_SKIP_BUILD=1` 当作提速方案。

来源：`assets/skills-zh/comet-build/SKILL.md:253`、`:261`；`assets/skills-zh/comet-verify/SKILL.md:110`；`domains/comet-classic/classic-guard.ts:444`、`:933`；`domains/comet-classic/classic-command-checks.ts:7`、`:110`；`.agents/skills/verification-before-completion/SKILL.md:19`。

### 2.7 高：验证强度应看行为风险，基本验收不能省

当前 scale 在任务数 > 3、delta 能力数 > 1 或文件数 > 8 时选 full，其他情况 light；light 明确跳过 spec scenario 覆盖率和设计漂移深查。Agent 可以覆盖模式，但默认判断没有安全、并发、迁移、外部接口等风险信号。

一次认证逻辑修改可能只有一个任务、两个文件；文档生成可能改十几个文件。规模不能代表正确性风险。已有 standard review 的风险清单是很好的起点，应与 Verify 选择对齐。

**建议：**每个模式都验证承诺的核心成功/失败场景。按认证授权、并发、迁移、公共接口、跨模块影响等决定专项验证深度；按场景把需求映射到代码、真实测试或可复核的运行证据。最终 reviewer 可核查必要的未改调用方，不能被“只读 diff”限制住关键上下文。小改动省的是无关检查和重复审查，不是承诺的验收。

来源：`domains/comet-classic/classic-state-command.ts:1372`；`assets/skills-zh/comet-verify/SKILL.md:44`、`:123`、`:134`；`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:52`；`.agents/skills/subagent-driven-development/task-reviewer-prompt.md:40`。

### 2.8 中：恢复应返回当前最小工作包

每个阶段都要求先解析布局、选择 change、入口检查；恢复还可能重读入口、执行 Skill 和扩展。handoff 已压缩上游内容，但 Verify 的 hash 匹配只允许省略 tasks 全文，其他需求/设计仍要读取。handoff hash 也覆盖 tasks 内容，状态勾选与需求变更的失效面没有完全分开。

**建议：**提供一次结构化恢复响应，包含当前 workspace/change/run 身份、授权、当前成果、下一步、未决问题、有效证据、实际需要读的文件和原因。稳定协议与任务数据分开；每个阶段只加载相关 reference。需求 hash、执行进度和证明输入分别管理。恢复一定要重新核对身份与文件，但无需重演全套已完成的探索和审查。

不得用摘要替代 canonical spec；被截断的关键约束必须回源读取。不要因为模型较强就删除检查点，也不要固定每隔几个任务强制清空上下文。

来源：`assets/skills-zh/comet-classic/reference/classic-layout.md:3`；`assets/skills-zh/comet-classic/reference/context-recovery.md:7`；`assets/skills-zh/comet-verify/SKILL.md:81`；`domains/comet-classic/classic-handoff.ts:163`、`:225`。

### 2.9 中：修复循环区分预期失败、真实失败与无进展

TDD 要求观察 RED，而异常调试协议的字面触发条件包含任何测试失败，没有明确排除预期 RED。这是提示契约歧义，尚未通过模型运行证明它一定导致错误调试。

此外，Verify 的失败计数和任务 review 的 1/2 轮预算是不同计数。长程任务中，多个独立且持续取得进展的问题不应和同一根因反复失败共用一种停止策略。

**建议：**预期 RED 记录为测试设计证据；未知失败才进入诊断。修复包包含具体失败、输入版本、已尝试策略和下一项验证。同一失败指纹连续无进展时升级调查；范围内且有明确进展时继续，同时保留任务及整次运行的时间/成本上限。环境不可用与源码错误分别记录，不允许循环重跑同一命令碰运气。

来源：`assets/skills-zh/comet-classic/reference/debug-gate.md:5`；`assets/skills-zh/comet-build/SKILL.md:183`、`:202`；`assets/skills-zh/comet-verify/SKILL.md:65`；`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:126`。

### 2.10 中：旁路状态应在长程恢复中有明确含义

dirty-worktree 协议对已确认无关的修改也要求暂停选择，实际会增加在共享开发区恢复的交互。Archive 的 `branch_status: handled` 表示处理方式已经确认，并不证明 push/PR 已成功；跨上下文恢复仍部分依赖此前对话里的交付选择。

**建议：**已明确无关、无路径冲突且不影响本任务验证的 dirty 文件默认保留，只有所有权不清或存在冲突时阻塞。交付授权、归档提交、push 结果和 PR 结果分别持久化，使恢复能只重试未完成动作。保留用户选择仅本地归档的权利，不把归档成功等同远端交付成功。

来源：`assets/skills-zh/comet-classic/reference/dirty-worktree.md:25`；`assets/skills-zh/comet-archive/SKILL.md:109`、`:130`、`:158`。

## 3. 规则文本的静态规模

按 PowerShell/.NET `ReadAllText(...).Length` 统计，即 UTF-16 code units，包含换行；不是 tokenizer 结果。

| 中文入口                            | 字符计数 |
| ----------------------------------- | -------: |
| comet-classic                       |   13,128 |
| comet-open                          |   11,412 |
| comet-design                        |    7,803 |
| comet-build                         |   10,845 |
| comet-verify                        |    7,523 |
| comet-archive                       |    5,393 |
| 六个入口合计                        |   56,104 |
| Classic 的 12 个 reference 文件合计 |   27,975 |

英文六个入口合计 102,260 code units。reference 按需加载，不应把全部文件之和当作每次必付成本；中文字符和英文字符也不能直接比较 token 数。

真实成本还包括动态 spec/design/plan、工具结果、子代理上下文、输出、修复轮次和恢复次数。缓存读取、非缓存输入、输出及计费价格必须分开。缩短 Skill 可能减少输入，但“少一次无必要的模型往返”“少生成一份完整代码计划”“少一次冷启动修复”更值得优先测量。

## 4. 一手文章与本调查的对应关系

### AI-Native SDLC playbook

页面标注 2026-08-21。文章将旧审批与交接列为新瓶颈，强调版本化产物驱动后续环节；同时正文仍保留 intent、spec、plan 和代码交付的人类审批。因此它支持减少重复交接、接受计划后的连续实现，不能用来证明所有审批都应删除。

来源：[The AI-Native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)。

### 随模型能力重新验证流程组件

页面标注 2026-03-24。作者逐项移除固定 sprint，将 QA 移到整轮 Build 后，保留 planner/evaluator；示例仍经历多轮 Build/QA。也记录了大幅简化后质量下降的尝试。这支持逐项消融，而非把旧流程整体撤掉；实验结果不能直接外推到 Classic 或用户指定模型。

来源：[Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)。

### 长程稳定性与上下文

2025-11-26 的长程 harness 实验支持功能清单、进度记录、Git 历史和端到端验证，指出只依赖压缩仍会丢状态或提前完成。它提供恢复与验收依据，没有确立通用的分钟级任务粒度。

来源：[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)。

2025-09-29 的 context engineering 文章支持高信号上下文、按需检索、压缩和外部笔记。对 Classic 的启示是按阶段提供最小充分材料，并保留回源能力；不是只追求文件最短。

来源：[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)。

2024-12-19 的 effective agents 文章主张从简单方案开始，仅在有收益时增加编排复杂度；独立关注点和可衡量的反馈适合专门工作流。对 Classic 的推论是按实际风险与依赖配置代理，而非按任务数量自动扩大编排。

来源：[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)。以上日期为当前页面标注，正文可能后续更新。

## 5. 建议的目标五阶段

| 阶段    | 应保证的结果                                        | 模型可自主决定                         | 需要人参与的情况                     |
| ------- | --------------------------------------------------- | -------------------------------------- | ------------------------------------ |
| Open    | 目标、非目标、范围、行为验收、change/workspace 身份 | 读代码、整理已有材料、消除可查证未知项 | 无法自行解决的行为/范围取舍          |
| Design  | 关键技术决策、风险、约束及足以启动的计划            | 方案深度、是否试验、实现里程碑         | 重大风险、外部承诺或用户指定审视     |
| Build   | 可运行成果、真实验证、持久进度                      | 步骤细化、范围内重排、合理委派及修复   | 需求扩展、无法解决的阻塞或资源上限   |
| Verify  | 当前实现满足承诺且证据有效                          | 按风险组合测试、运行验证和独立 review  | 验收偏差、不可自行承担的风险         |
| Archive | spec 生命周期闭环、精确提交、交付事实               | 在授权范围内完成及恢复交付动作         | 未授权的推送、PR、发布或其他外部动作 |

“足以启动的计划”仍覆盖全部已承诺成果和主要依赖，不能只规划第一步就丢失剩余范围。需求、设计、计划仍可分别审计，但不必分别开展完整对话、重复介绍背景或生成重复正文。

### 长程任务不可削弱的约束

1. 稳定的 change/run/workspace 身份，以及分支、路径与文件所有权检查。
2. 明确验收标准；实现者不能通过缩减要求或删测试让自己通过。
3. 完成状态必须关联实现及验证证据，不能仅凭任务勾选或代理自报。
4. 关键决策、当前工作、未解决问题和下一步及时落盘；恢复先核对现实状态。
5. 修改影响已有证据时必须失效并重验；相关验证之外不能声称全局通过。
6. 独立验收和必要专项 review；修复不应绕过新引入风险的检查。
7. 同一失败反复无进展时停止或升级；实际环境不可用不能报 PASS。
8. 归档、提交、推送、PR 的授权和完成事实各自清楚；恢复不重复已完成动作。

## 6. 落地顺序

### 前置修复：统一验证证据条件

先修复已复现的旧证据误接受和 `verify-pass` 前置条件差异，覆盖代码、测试、依赖和配置变化后的失效；同时修复 Build guard 在廉价前置失败后仍运行构建的问题。否则减少人工检查可能放大现有证据缺口。

### 第一批：先减流程摩擦

优先调整 Comet-owned 中文 Skill 的澄清完成条件、嵌套调用返回边界、预期 RED 分类、风险判断与修复包；保持 Runtime 硬约束。将“执行过程中必须一直重复说明”的内容移到按需 reference。先审视中文语义，确认后同步英文，再按发布差异决定 Changelog。

这一批不能直接删除 full 的 plan/design 或执行模式字段，也不能把 `record-check` 当作有效缓存。

### 第二批：让自主执行成为合法路径

在 Classic 内增加合法的自主执行契约，允许按成果组织连续 builder、复用修复上下文，并保持独立验收。同步 state、guard、resume、Hook 和测试；不采用“Agent 偷设 direct_override”的实现方式。验证输入指纹与运行证据应在启用跨阶段复用之前完成。

### 第三批：收敛产物和恢复

引入稳定任务身份、结构化检查点与派生 Markdown，统一恢复返回；再评估把设计正文收敛到一个权威位置。若调整 Open readiness，应明确与 OpenSpec applyRequires 的关系，支持额外 schema artifacts，迁移旧 active change，并保留档案可读性。

产品上优先提供一条明确的默认自主路径和用户指定的严格审视需求，不建议新增一大组模型专属开关。现有 change 保留创建时的协议版本，避免升级途中突然改变控制规则。

## 7. 怎么证明更快且仍然稳定

### 固定可比较的输入

记录 Comet commit、生成资产 hash、嵌套 Skill 内容 hash、OpenSpec 版本、宿主版本、模型 ID/推理设置、任务基线、测试环境与授权规则。先在每个模型内部做对照，不拿不同模型或不同依赖版本的结果计算流程收益。

本次采样已发现差异：本地 writing-plans SHA256 前缀 `72190C88B2B5`，Eval 快照 `272E1AF349F5`；本地 SDD `349A08AD8B59`，Eval 快照 `41AB239A6AD1`。当前 treatment 使用工作区 Comet 资产，同时从 dependency 快照加载外部 Skill，因此外部版本必须计入实验身份。

来源：`eval/local/treatments/comet/comet_classic_docs_layout.yaml:11`、`:67`。

### 消融顺序

| 对照项 | 单独改变的内容                   | 主要观察                                |
| ------ | -------------------------------- | --------------------------------------- |
| A      | 当前 Classic                     | 成功率、阶段耗时、token、交互和恢复基线 |
| B      | 信息充分即停止澄清、复用有效授权 | 人工打断减少是否引起范围理解错误        |
| C      | 成果计划替代全代码计划           | 首次实现时间、后续返工、需求漏项        |
| D      | 连续 builder 与修复复用          | 冷启动减少、上下文退化和跨任务污染      |
| E      | 当前输入绑定的证据复用           | 重复构建减少、过期证据误放行            |
| F      | 合并已验证有益的改变             | 组合效应及长程回归                      |

先用少量但代表性的任务筛选明显退化，再扩大多次重复；不要一开始运行所有模型、所有变化的笛卡尔积。

### 任务与故障场景

- 明确需求的中型功能、模糊需求、已有完整 PRD、认证/并发/迁移类小 diff、大型跨模块 change。
- 在 Design 中途、实现已提交但未勾选、review 后、Verify 修复中、归档后未推送等位置强制中断并冷恢复。
- 注入相关与无关 dirty 修改、staged/untracked 输入、工作区分支变化、需求变更、依赖变化和环境失败。
- 提供边界场景、真实 CLI/打包产物/浏览器操作等独立验收，检查是否出现“文档和 checkbox 齐全但功能不工作”。

### 指标和判定

- 首次验收通过率、最终完成率、独立场景覆盖、严重缺陷、任务丢失/重复、错误工作区写入、过期证据被接受。
- Agent 有效执行耗时与等待用户时间分开；统计 P50/P95、恢复首个有效动作时间、重做次数。
- 非缓存输入、缓存输入、输出、实际成本、模型调用/恢复、工具调用、子代理派发和修复次数；按阶段归因。
- 成本既报告全部尝试的每个成功交付成本，也报告双方都成功的配对任务效率；失败样本不能消失在平均值里。
- 先确认质量和恢复不劣化，再接受耗时/token 改善。任何安全约束或验收标准退化都必须单列，不能被平均分掩盖。

仓库已有遥测字段可复用：`eval/scaffold/python/aligned_comparison.py:1265` 定义调用/恢复、工具、耗时、输入/输出/cache/cost 等指标；`eval/scaffold/python/logging.py:230` 汇总多次调用。需另核实各宿主字段口径和子代理覆盖，不能假设它们天然可比。

## 8. 本轮验证与限制

- 已执行工作区身份、基线与子模块检查，完成源码/Skill/模板审阅及静态字符统计。
- 已执行 `pnpm exec vitest run test/domains/skill/workflow-optimization-contract.test.ts test/repository/classic-layout-documentation.test.ts`：2 个文件、37 个测试通过。
- 独立 Runtime 调查执行 6 个聚焦测试文件：120 个测试通过、1 个平台条件跳过，32.40 秒，退出码 0；并用当前发布 `.mjs` 完成上表三项临时项目验证。现有测试通过不表示这些额外复现场景已有回归覆盖。
- 研究文档经过 Prettier 格式化与检查；引用路径及行号范围已检查。
- 未启动真实模型 Eval；未重跑历史实验，旧记录不能证明当前指定模型的提速幅度。
- 未运行全量测试和产品 build：本轮没有产品代码、Skill 或 Runtime 修改。
- 未验证真实宿主 Hook，也未运行全部生成物一致性检查；直接发布 bundle 的复现不等于整套平台集成验证。
- 扫描历史 Eval 临时目录时遇到 Windows 访问拒绝，随后改为定向读取 treatment 和依赖快照；未修改权限或清理目录，也未将不完整扫描作为完整历史数据。

Runtime 测试命令：

```powershell
pnpm exec vitest run test/domains/comet-classic/classic-guard.test.ts test/domains/comet-classic/classic-handoff.test.ts test/domains/comet-classic/classic-command-checks.test.ts test/domains/comet-classic/classic-resolver.test.ts test/domains/comet-classic/classic-hook-guard.test.ts test/domains/comet-classic/comet-scripts-recovery.test.ts --no-cache --reporter=dot
```

临时复现材料保留在本机，可能被系统临时目录清理：

- 项目：`C:/Users/BENYM/AppData/Local/Temp/classic-audit-a23a2519-Ys8jZS`。
- 基础探针：`C:/Users/BENYM/AppData/Local/Temp/comet-classic-audit-a23a2519.mjs`。
- 真实检查探针：`C:/Users/BENYM/AppData/Local/Temp/comet-classic-cache-audit-a23a2519.mjs`，依赖前述项目；两个脚本执行退出码均为 0，主线程已读取脚本核对测试边界。

关键观测：

```json
{"case":"build-runs-despite-missing-config","codes":[1,1],"missingConfig":true,"builds":2}
{"case":"recorded-build-does-not-prevent-rerun","explicitBuildExit":0,"buildGuardExit":1,"buildExecutionsBeforeGuard":3,"buildExecutionsAfterGuard":4}
{"case":"real-check-fails-after-source-change-but-guard-accepts-old-record","actualInitialCheck":0,"initialGuard":0,"actualChangedCheck":1,"changedGuard":0}
{"case":"transition-without-verification-command","code":0,"phase":"archive"}
```

以上是四条独立 JSON 输出，构建计数为两个脚本累积值。探针脚本位于临时目录，未作为本次仓库修改提交。

最先值得验证的是“信息充分即停止澄清 + 成果级计划 + 连续执行者”；最先需要加强的是“验证证据对应当前输入”。这两部分共同决定 Classic 能否减少流程成本，同时保留其 SDLC 和长程恢复价值。
