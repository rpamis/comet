# Skill 流程中可整段取消的重复执行

基线：`053`，`b0a2fc5d03b0e265ba83459667e3cad30c18fe39`，2026-11-08。用户最终收窄为 Native 和 Classic 的 Skill 执行部分；Creator、生成的独立应用和共享 SDK 调度不列为本轮主要优化项。本轮按能否取消一次真实命令执行、一次重复内容维护或一次不必要的方法分派调查，不把函数级微测、文件行数和文案缩短作为主要收益。

## 证据边界

读取当前发布 Skill、Runtime 和对应测试，没有修改产品、安装副本或 Skill，没有调用外部 Skill，没有启动真实模型 Eval。下文“可减少”是满足列出条件后的执行次数上界，不是已取得的端到端耗时收益。不能为了减少执行而采用缺少输入绑定的模型口头结果。

## 本轮结论

没有找到可以普遍取消 Shape/Open 批准、完整验收、独立审查要求或 Archive 输入复验的证据。较值得推进的是把以下工作从 Agent 执行链中删除：

| 顺序 | 可取消的工作                                                   | 适用范围与当前状态                                                                                                                                                                       |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 最后一次普通 shell 完整检查之后，再由 Runtime 执行同一完整检查 | Native v3 已有受管 Build 检查与 Verify 复用，可直接改善 Skill 的检查安排；Classic 任务期/报告前还缺合适的受管首次执行入口。输入必须保持一致；省掉一次真实测试，而非省略验收。见 RN1、RC1 |
| 2    | 已声明的检查计划与复用方式，在后继阶段由模型重新填写           | Classic continuation 丢回命令占位符；Native Builder 完成模板也未预填之前受管检查计划。只继承已经明确选择的计划和复用语义，不自行把外部检查标成可缓存。见 RC2、RN1                        |
| 3    | 关联能力时，Agent 同时编辑 Delta 和由它唯一确定的目标 Spec     | Native 已有 applyNativeDelta 和一致性校验；可让 Runtime 从已绑定基线和 Delta 生成待批准的完整目标，省一份重复内容编辑。限关联能力，当前公开流程尚未提供这一生成步骤。见 RN2              |
| 4    | 将 Runtime 已有的验收正文逐字复制到 Supervisor 索引            | Agent 只决定子任务、依赖和 covers，完整索引可由 Runtime 绑定当前提案后生成。只影响 Supervisor；验收语义与映射判断不能省。见 RN3                                                          |

RC3 的候选设计复用、RN4 的同会话上下文去重属于条件项；RC4 的纯方法 Skill 分派尚未验证等价，不列入主要收益。前两项更可能影响常规实现流程；后两项主要改善规格较大或多子任务时的模型工作。没有真实模型端到端证据，不给出整体提速百分比或分钟数承诺。

## Classic：值得实施验证的项

### RC1：任务和 Verify 的首次完整检查尚未统一进入受管证据通道

**成立条件：** 某任务已经在普通 shell 中运行了本轮最终、完整的检查命令；随后 Build Guard 选用完全相同的 argv、cwd、环境和超时，期间实际输入没有变化。不是所有任务的局部测试都满足这些条件。

当前执行链：

1. Build 实施按所选 TDD/检查方法运行任务测试，保存实际 GREEN。
2. 完成必要审查、勾选 tasks，提交 `complete-build`。
3. Run 才产生 `<profile>.build.check`，Guard 以完整命令真实执行一次，再记录前后输入、日志和收据。
4. Verify 对相同完整检查可复用第 3 步的受信证据。

重复点在第 1 与第 3 步，不在已经支持复用的第 3 与第 4 步。目前命令执行器只接受待执行的 Build/Verify check Action；其历史搜索也只寻找 Run 中 `ref: classic-check` 的结果。普通 shell 的最终 GREEN 不在这个证据通道中，因此不能合法跳过第 3 步。

**建议：** 给任务收尾检查一个正式 Runtime 入口，让第一次最终完整检查就由 Runtime 监管执行、记录真实前后输入与日志，随后 Build check 只采用仍有效的同一份受信证据。可以允许在 Build implementation Action 内提交任务检查，而不提前推进阶段；不能把任意历史日志导入为成功检查。命令、输入、执行环境或原日志变化时重新执行。

**能取消什么：** 在条件成立的任务上，取消一次完整测试/构建子进程执行。TDD 的 RED、变更后的 GREEN、不同范围的集成测试和独立 reviewer 均保留；没有证据证明可把局部单测直接升级为完整验收。

**证据：** `assets/skills-zh/comet-build/SKILL.md:22–26`；`assets/skills-zh/comet-classic/reference/sdk-methods.md:78–82,108–110`；`domains/comet-classic/classic-sdk-build.ts:430–474`；`domains/comet-classic/classic-sdk-check.ts:262–290,406–424`。

**未完成验证：** 当前没有任务期受信检查接口，需要先定义恢复身份、未知结果、失败遮蔽、输入变化和任务/完整检查覆盖关系。不能仅修改 Skill 加一句“刚跑过就跳过 Guard”完成此项。

#### 同一缺口在 Verify 中的另一条触发链

这与任务期 GREEN 属于同一个“首次完整检查尚未进入受管证据”的接口缺口，只按一项机制计算收益。当前顺序确实存在，尚不能证明所有正常 change 都因此重复执行命令。

**成立条件：** Verifier 需要补一条 Build 没有执行过的完整验证命令，或者已有 Build 检查无法合法复用；它为了先写出真实结果，在普通 shell 中执行该命令，之后 Guard 又采用同一命令，输入和执行条件没有变化。

当前执行链：

1. Skill 要求先“验证结论合格”，把实际检查项、独立审查结论等写入报告。
2. continuation 同样指示“先完成独立验证并保存真实报告；Guard 会预检报告、执行检查并绑定收据”。
3. Runtime 的顺序是 `<profile>.verify.run` → `<profile>.verify.report.evidence` → `<profile>.verify.check`。在报告证据提交之前，没有可领取的 Verify check Action；执行器还要求 state 已包含 verificationReport。
4. Guard 先读取并验证已有报告，再提交 verify.run 结果与报告证据，最后才调用受管命令检查。
5. 因而第 1 步如果已经在普通 shell 跑了同一个新检查，其结果不在 Run 的受信检查历史里，第 4 步会再次执行。单纯把该 shell 日志路径写进报告不能使其成为受信收据。

**建议：** 允许在完整 Verify 报告形成前先运行正式受管检查，Verifier 读取该次真实收据并独立完成需求/实现评估后写报告，再把报告与同一检查证据绑定。最终推进时校验当前输入仍与检查一致、报告未漂移、独立评估已完成；没有变化就取消报告之后的第二次命令执行。也可用一个恢复安全的公开编排入口管理这些步骤，不新增另一套状态权威。

**能取消什么：** 条件成立时取消一次完整验证子进程。保留第一次实际验证、独立需求/实现审查、检查前后输入观察、最终绑定及失败回 Build。已经从 Build 合法复用同一检查的路径不重复计收益。

**证据：** `assets/skills-zh/comet-verify/SKILL.md:18–19`；`domains/comet-classic/classic-sdk-output.ts:596–611`；`domains/comet-classic/classic-sdk-application.ts:1901–1936,2340–2362,2699–2739`；`domains/comet-classic/classic-sdk-guard.ts:626–629,714–771`；`domains/comet-classic/classic-sdk-check.ts:262–290,699–708`。

**未完成验证：** 尚无该顺序重排的实现或回归。需要覆盖检查成功但报告未完成、报告完成但绑定中断、输入变化、报告变化、检查失败、外部未知结果、同候选恢复，以及固定应用的原协议。不能将“先写一个通过报告，再赌后续命令通过”作为精简办法。

### RC2：已选择可复用的检查在 Verify continuation 中又变回待模型填写的命令

**成立条件：** 前一个真实成功检查已经明确 `reusable: true`，下一阶段仍需同一个完整检查，且任务没有要求逐阶段真实执行；Runtime 重新校验全部输入、环境、超时及原日志。

当前执行链：

1. Build Guard 使用 `--local` 真实执行并保存可复用结果。
2. 进入 Verify，continuation 仍返回 `<program>`、`<args...>` 占位符，且模板没有 `--local`，要求模型再次提供“当前完整验证命令”。
3. 模型需要自己恢复原 argv、cwd、timeout 和可复用选择。漏掉复用标记，或把同一命令改写为语义相近但 argv 不同的形式时，就无法命中现有精确复用。
4. 如果两次都明确 `--local` 且所有绑定仍一致，现有代码已经跳过第二次执行；这不是新建议创造的能力。

**建议：** continuation 优先提供已有受信检查的准确命令、原 cwd、timeout 和原本已经选择的复用标记；由 Runtime 判断是否命中，模型只选择新增检查。需要新的验证命令或明确要求每阶段重跑时，保留完整命令输入。不能根据命令名称自行判定外部服务检查可缓存。

**能取消什么：** 取消一次重新构造同一检查命令的模型工作，并在漏标/改写会造成重复的路径上取消一次真实测试/构建执行。正确使用现有 `--local` 的路径不会再获得额外一次执行收益。

**证据：** `domains/comet-classic/classic-sdk-output.ts:516–531,596–611`；`domains/comet-classic/classic-sdk-status.ts:24`；`domains/comet-classic/classic-sdk-check.ts:406–528`。`test/domains/comet-classic/classic-sdk-verify-rounds.test.ts:1095–1141` 已断言相同 Build/Verify 命令的计数文件只有一行，并验证 `reused: true`；`:667–719` 核对输入、环境、未标记和日志变化时不误复用。

**需要补的验证：** 当前 continuation 没有“携带已有命令及复用选择”的契约测试；实施应补这一层，不能仅复用执行器单元测试。只有 Build 标记可复用不能代替判断 Verify 是否有独立的重新执行要求。

### RC3：完整候选设计可以作为唯一批准正文，避免摘要、提案字符串和批准后文档的再次整理

**成立条件：** Design 阶段已经形成完整、可检查、语言和元数据均合格的候选 design.md；它覆盖最终待批准方案、取舍、风险、测试策略与实际 Spec Patch，批准后正文没有变化。

当前执行链要求持续保存 brainstorm-summary.md，再通过 `propose-design --proposal "<candidate-summary>"` 重新组织一个覆盖全部关键内容的提案字符串，批准后再完善唯一正式 Design Doc。Runtime 自动生成的 handoff 本身不算模型重复产出；新的技术决定也不能因来源文件已存在就省略分析。

**建议：** 让 proposal 明确引用当前完整候选文档及内容哈希；已经足够完整时，使用同一文件作为批准正文和后续 Design Doc，批准后只做确定性身份绑定，不再要求模型重新编排一份正式正文。候选文件在等待期间可明确标注未批准，其存在和完整性不能推进 Run。独立 brainstorm-summary 仅在确有尚未纳入候选的探索分支或中断信息时维护。现有引用或 Dashboard 展示需要兼容处理，不能直接删除旧恢复材料。

**能取消什么：** 条件成立时，取消一轮“把已完整方案改写成另一份批准后正文”的模型产出，以及单独整理提案字符串的工作；保留一次正式 Design 决定、批准哈希、最终来源检查和需要时的候选修订。当前文本没有强制要求从零重写，因此这是收敛协议、稳定复用的候选，不是所有 change 都存在的一轮固定浪费。

**证据：** `assets/skills-zh/comet-design/SKILL.md:18–21`；`assets/skills-zh/comet-classic/reference/sdk-methods.md:36–44`；`domains/comet-classic/classic-sdk-design.ts:80–88,133–173,275–293,319–353`；`domains/dashboard/collector.ts:1056–1059`。

**未完成验证：** 需要验证提案引用哈希与现有来源证据、Spec Patch、设计文档证据的一致性；修改正文必须失效旧批准。没有模型 Eval，不能承诺现有模型一定会重复改写，也不能声称此项已经节省 token 或分钟。

### RC4：非 autonomous 的 Verify 可以研究取消纯方法分派，但保留独立审查执行

当前非 autonomous 验证要求加载 verification-before-completion，再在开启 review 时加载 requesting-code-review，完整规格验证时还加载 openspec-verify-change。Comet 自己已定义检查范围、独立 reviewer、一次最终集成审查、证据有效性与报告；autonomous 路径则明确不依赖外部验证或审查 Skill，也必须完成这些职责。

可以研究让 Comet 直接实施相同验证和 reviewer 分派，取消前两次纯方法 Skill 加载；不能取消真正的独立 reviewer、用户指定的执行方法或固定应用依赖。OpenSpec 的当前 schema/规格检查也不因已有一个 reviewer 就自动被覆盖。

**能取消什么：** 最多两个方法 Skill 加载调用，不等于两次 reviewer 或两次测试。未读取、调用 Superpowers 原始 Skill，也没有证据证明取消后方法覆盖完全等价，因此本项优先级低于 RC1/RC2，不能作为已证实的大幅 Runtime 收益。

**证据：** `assets/skills-zh/comet-classic/reference/sdk-methods.md:88–104`；`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:40–46,64`。

## Classic：没有成立的“整段可以删掉”判断

### 不能声称 Build 与 Verify 默认必然重复跑同一命令

同一 Run、同一完整命令且两次都显式选择复用时，SDK 已检查输入、环境、超时、原收据和日志，直接返回 reused，不重启命令。编写验证报告和更新 walkthrough 也不自动导致全部检查失效：snapshot 明确排除当前验证报告和中性 walkthrough。来源：`domains/comet-classic/classic-sdk-check.ts:399–528`；`domains/comet-classic/classic-check-snapshot.ts:295–319`；`test/domains/comet-classic/classic-sdk-verify-rounds.test.ts:1095–1141`。

### 不能直接取消独立最终审查

Build 的风险任务审查与 Verify 的最终集成审查有不同对象；当前协议已禁止再叠加第二次最终审查，并允许复用覆盖当前输入的有效独立结论。没有证据证明正常流程会强制把同一个最终 diff、同一份需求和全部证据交给第二个 reviewer 再审一遍。来源：`assets/skills-zh/comet-classic/reference/sdk-methods.md:82,88–98`；`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:40–46,64`。

### Open → Design → Build 不是已证实的“三次从头设计”

当 OpenSpec schema 的必需依赖要求 design/tasks 时，Open 确实在进入 Design 前就要生成它们并检查高层决策和数据流；随后 full Design 无条件加载 brainstorming，Build 再要求计划。但是当前 Design 明确先读取已有设计，只探索需要的方案；正式设计优先沿用同一 design.md。Build 计划引用任务权威，不复制 checkbox，已有有效计划直接复用。仅凭阶段顺序无法证明它们都在重新从头写同一内容。

已具备完整外部设计时，无条件再加载探索/brainstorming 的方法分派可以进一步研究按证据省略；这不等于删除正式设计确认。把 Open 的 design/tasks 直接延后到后阶段则会破坏当前 `applyRequires` 闭包和 Open Guard 的前置条件，不能靠 Skill 跳过。需要先定义 schema 感知的分阶段产物契约，再验证完整初始化、审批与恢复；本轮尚未成立为可直接删除项。

来源：`assets/skills-zh/comet-open/SKILL.md:69,146–170,207–211`；`assets/skills-zh/comet-design/SKILL.md:18–21`；`assets/skills-zh/comet-classic/reference/sdk-methods.md:36–44,62–68`。

### 正常阶段切换没有强制走完整恢复协议

入口与阶段 Skill 均要求复用有效 continuation，只在冷恢复、外部变化或字段缺失时补读。计划默认不暂停，既有配置不重问，已完成任务不重派。没有新证据表明可以再取消一轮所有正常 change 都会执行的恢复命令。来源：`assets/skills-zh/comet-build/SKILL.md:16,20–26`；`assets/skills-zh/comet-classic/reference/context-recovery.md:7–35`。

## 实际验证

本轮读取了上述源码和测试断言；实际执行 `pnpm exec vitest run test/domains/comet-classic/classic-sdk-verify-rounds.test.ts -t 'does not reuse SDK checks after unmarked changes'`，1 项通过、77 项未选择，耗时 17.39 秒。该测试实际断言未标记可复用的 Build 检查在 Verify 再执行一次，计数文件两行；它没有验证 RC1/RC2 建议实现，因为本轮没有修改产品。没有运行真实模型、外部 Skill、平台 Hook、完整工作流性能对照或全量测试。

## Native：Skill 执行部分

### RN1：普通 v3 不缺检查复用，缺的是稳定安排“第一次最终检查”的执行路径

当前存在两条合法安排：

- 普通 shell 跑开发期最后一次完整 GREEN → Builder 把该结果写进 checks，并提交 verificationChecks → Runtime 冻结候选后真实运行 verificationChecks → Verifier 判断全部验收项。
- Builder 用 response.kind=request-checks 提交最终可重复检查计划 → Runtime 真实执行 build.checks 并返回当前 Builder → 输入未变时提交同一 verificationChecks → Verify 复用已有收据 → Verifier 判断全部验收项。

第一条中的普通 shell 结果是开发记录，不能被 Runtime 当作带前后输入绑定的检查回执。两次命令完全相同、且实际输入、环境和日志均一致时，第二条可取消一次真实测试执行。这不是新增 Native 能力：当前源码与测试已经实现，Skill 可把任务收尾的最后完整 GREEN 优先安排到现有受管路径，不再先在 shell 跑完同一最终计划后才填写计划。早期 RED、局部开发测试、改变实现后的重检和独立验收保留。

来源：assets/skills-zh/comet-native/reference/commands.md:49–55,174–178；domains/comet-native/native-sdk-application.ts:899–917；native-sdk-checks.ts:1139–1235；test/domains/comet-native/native-sdk-application.test.ts:10757–10861。

仍有一处模型重复维护：受管 Build 检查完成后，后继 Builder 的完成模板仍由 nativeSdkOutcomeOutput 生成 verificationChecks:[check] 占位计划，没有用上一次已明确提交的检查计划预填（native-sdk-continuation.ts:148–176,263–267）。模型需要再次复制相同计划；复制时改变 id、argv、cwdRef 或 timeout，可能让原本可以复用的检查变成不同检查。可以把实际原计划和来源一起带回，只让 Agent 增补缺失检查，再由 Runtime 重新核对输入。这与 Classic RC2 的遗漏具有相似的执行后果，但 Native 已有受管 Build 入口，优先调整 Skill 指引和当前模板即可，不需要再造检查引擎。

**收益条件：** 只限最终 GREEN 与最终验收检查确为同一计划，且之后没有使证据失效的改动；不是所有 TDD 测试都能复用，也不能从普通终端日志事后补造可信回执。增加受管请求和结果回报也有 CLI 开销，不能声称短命令一定提速。长测试/构建才更值得优先采用这种安排。

**本轮验证：** 运行现有 reuses a Build check only while inputs match 的三种参数：edited=false 复用原 Action；edited=true 不复用；failed-later 不允许更早成功掩盖后来的失败。3 项全部通过。这验证现有证据路径，不是修改后的 Skill 模型遵循情况；没有运行 Eval。

### RN2：关联能力的 Delta 与完整目标 Spec 可以收敛为一次语义编辑

**当前完整执行链：**

1. native new 关联已有 capability 时，Runtime 已经把当前 canonical Spec 原文复制为 change 中的完整目标 spec.md，并生成空 operations 的 delta.yaml。
2. Skill 要求 Agent 修改完整目标 Spec，同时在 delta.yaml 按稳定 requirement ID 再写同一变更。
3. Shape 准备读取两份正文，调用 applyNativeDelta 合成预期目标，再检查模型编辑的完整目标是否与合成结果的 hash 相同；不同则拒绝，要求 Agent 修正完整目标。
4. 后续 rebase 已能用 mergeNativeDeltaAgainstCurrent 生成并写入完整目标文本。

来源：native-new-command.ts:49–89；assets/skills-zh/comet-native/reference/artifacts.md:22,126–136；native-portable-requirements.ts:675–704；native-delta-spec.ts:916–939；native-portable-delta-rebase.ts:75–79,109–118,127–145。

这里可以省掉的是第 2 步的一份重复正文维护，以及不一致时为机械对齐而发生的修正。Runtime 已能计算唯一预期目标，Agent 无需再用模型保证两份正文恰好一致。建议由 Agent 只编写要改变的 requirement 和 Delta，Runtime 在 Shape 提案前从绑定基线生成完整目标，将完整结果、Delta、基线及所有验收正文一起给用户确认；目标 Spec 仍作为完整、可读、可验收的交付产物存在。

**必须保留：** 基线内容哈希、旧共享约束、稳定 requirement ID、删除/重命名冲突、完整目标的批准绑定、最新 canonical 漂移检查、必要的重新 Verify，以及恢复幂等。生成不能静默覆盖用户在目标 Spec 中独立作出的语义编辑；出现这种编辑需拒绝并展示两者差异，让 Agent 明确选定当前修订内容。

**限制：** 这只适用于有可信关联基线和 Delta 的 capability，不覆盖新能力、无关联的旧 change、任意 Markdown 修改或无产品行为变更任务。Runtime 现在已经复制完整基线，不能把此项说成“每次让模型从零重写整份 Spec”；当前真正重复的是修改涉及的内容及两份材料的一致性维护。实际节省多少模型输出未测。

**本轮验证：** 运行现有五项 Delta 测试，验证新增不替换旧内容、稳定 ID 修改/移除/重命名、独立变更自动重合并与重叠冲突、共享旧约束漂移拒绝、已应用结果恢复幂等，5 项通过。这证明已有确定性合成原语和反例，不证明公开 Shape 入口已支持自动生成。

### RN3：Supervisor 不需要由模型逐字复制验收索引

当前 Skill 要求 children.yaml 的 acceptance_index 逐字复制 Runtime 当前验收列表中的 source/text，模型另外填写 children 的 name、depends_on、covers。Runtime 随后用 acceptanceCatalog 检查副本，任何 source/text 不同都拒绝并提示从 catalog 精确复制。

来源：assets/skills-zh/comet-native/reference/artifacts.md:98–124；native-children-contract.ts:129–155；test/domains/comet-native/native-children.test.ts:458–489,532–559。修复 Child 还要求模型向同一索引复制实际失败的 Spec 验收项（commands.md:275–277）。

可以省掉整步“读验收正文→原样抄进 YAML→因抄错而修正”。Agent 保留对子任务职责、覆盖范围和依赖的语义判断，仅提交 covers 等引用；Runtime 在准备当前完整 Shape 时，从同一验收 catalog 生成包含正文的固定索引，再把最终方案整体提交批准。索引作为恢复证据仍保留，只改变它的生成责任。

不能只存一个不绑定来源的 A1：验收序号可能因内容修改而变化。生成必须绑定当前完整提案和内容身份；旧目录中的 V1/V2 继续按原规则读取，旧批准不能因自动生成而被重解释。修复索引只能加入实际允许的失败 Spec 验收，子任务总覆盖和无环约束、worktree 隔离、子任务验收、集成检查与父级最终验收全部保留。

**本轮验证：** 运行现有 readable v2 index retaining v1，以及 failed Spec repair children 两项测试，2 项通过。它们验证现有兼容、精确正文和修复范围规则；新输入形式和自动生成尚未实现、未测。

**收益范围：** 只影响 Supervisor。验收较少时收益小，不把它描述为普通 Native 的全局提速。

### RN4：同一会话阶段切换的重复上下文正文可再收敛，优先级较低

Native 的 commands.md:77–80 要求首次进入每个阶段完整 snapshot；Classic scripts.md:148 已区分同一会话、已有交付回执且正文仍在上下文时使用 incremental。Native 共用 taskContextRequest 默认也生成 snapshot（workflow-contract/task-context.ts:15–27）。可把相同已交付正文的重投递收敛为增量，保留阶段专用规则、新 Agent 和压缩后完整恢复。

这能减少重复正文，但未省掉阶段适用性检索；现有增量去重也只针对已证实完整交付的 core-profile，不代表所有 policy 或知识正文都会消失。未实测大段模型重读耗时，因此不列为“大幅缩减 Runtime”的主要证据，不再为凑数量扩大收益。

## Native：没有找到可以直接取消的核心执行段

- **普通 v3 已经简化的步骤不再计入空间。** Builder 不再强制先交完整逐项 acceptanceReview；Verify 才提交完整验收。高层 next 已合并领取、结果和必要内部推进；正常动作不要求反复 status。来源：native-sdk-continuation.ts:157–176；comet-native/SKILL.md:34–42。
- **同会话验收仍有独立的时间与输入对象。** Runtime 执行检查后，当前 Verifier 核对实际结果和全部验收项；不能把实现者事先的自评直接转换为最终通过，更不能删除用户明确要求的独立会话。
- **普通/正式文件编辑的两类判断不能合成一个含糊结论。** 它们有不同的批准和证据对象；可以减少提交包装，不能省掉对实质需求变化的判断。
- **监督子任务验收、集成检查、父任务验收对象不同。** 没有证明它们在同一工作区、同一集成状态做了同一件事，不能一概删掉其中一轮。
- **完整来源覆盖不是通用负担。** 当前只在文件或链接作为需求来源时触发，排错/实现参考不自动触发；不能把这一条件流程说成每个任务都必须多做的一轮。

## 本轮验证补充与交付状态

Native 定向命令：

```text
pnpm exec vitest run test/domains/comet-native/native-delta-spec.test.ts test/domains/comet-native/native-sdk-application.test.ts -t 'adds a requirement without|modifies, removes, and renames|automatically rebases independent|blocks a concurrent change to legacy|is idempotent when recovery|reuses a Build check only while inputs match'
pnpm exec vitest run test/domains/comet-native/native-children.test.ts -t 'accepts a readable v2 acceptance index while retaining the v1 contract|validates v2 index text while allowing only failed Spec acceptance into repair children'
```

前一命令 8 项通过、219 项未选择；后一命令 2 项通过（未选择数量以该 JSON 报告为准）。加上 Classic 单例，本轮与 Native/Classic 主结论相关的已执行测试合计 11 项通过。它们核对现状和已有原语，不证明建议已实现，也不证明模型会少多少轮。

结果 JSON 分别在系统临时目录 comet-skill-execution-native-evidence.json 和 comet-skill-execution-children-evidence.json。没有启动模型 Eval，没有运行全仓测试、真实平台 Hook、完整安装升级或新的端到端性能对照。报告中的执行次数不是实测模型轮次；Agent 可能已经把多个工具调用放在同一次模型响应中。

本轮只新增本研究文档，未修改产品源码或双语 Skill，未提交推送；原有归档状态文件、website 和前一份研究文档保持原样。上一轮已发现的共享/Native 编辑协议副本契约失败仍未修复，不因本轮定向测试通过而消失。后续真正实施时仍须遵守中文 Skill 确认后再同步英文、实际恢复与审批反例验证，以及模型 Eval 的单独启动授权。
