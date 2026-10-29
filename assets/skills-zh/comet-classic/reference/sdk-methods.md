# Classic SDK 执行方法

仅在 `runtimeFormat: sdk` 时读取当前阶段的章节。阶段命令、Action、Wait 和输入模板以主 Skill 与最新 continuation 为准；本参考说明实际工作和完成条件。

所有产物与外部 Skill 输入使用当前 configuration.language。每次阶段入口、接收新 Agent 和上下文恢复，先按 [任务上下文协议](scripts.md#任务上下文与产物语言) 使用当前 continuation 或已领取 Action 的 `contextRequest`；派发子任务时一并交付阶段、任务范围、实际工作区和有效配置。保留已有事实与有效证据。

## 阶段入口与恢复

复用同一 change、工作区和 Run 的最新 continuation、配置、phase、revision 与路径；只有冷恢复、外部变化、响应过期或字段缺失时，才用 `comet state next <change-name> --json` 补读。阶段入口不重复获取同一快照；写入仍由 Runtime 校验版本和证据。

SDK 新 change 使用 `comet-state.yaml`，历史 `.comet.yaml` 原地保留。两文件共存（包括失效符号链接）时停止并保留现场，不自动改名或覆盖。路径、Runtime 归属和 layout 以当前响应为准。

响应含 `agent.continuation.mode` 时按[自动衔接](auto-transition.md)执行；mode 优先于旧 `nextAction.kind`。区分手动衔接、原执行者等待与结果核对，完成实际工作后才提交 `completion`。无 mode 的旧响应才按各阶段的 kind 路由；结果未明时核对原 Action，不重发外部工作。

编辑后需要判断实际影响，或 continuation 指向内容判断时读取[编辑后续行](../../comet/reference/edit-review.md)。只读取当前阶段与实际发生的异常所需参考，不展开其余阶段。

## 开始与产物

新建 full、hotfix 或 tweak 时，先按[宿主能力核对](../../comet/reference/host-check.md)检查当前所需能力，再按 workspace.md 确定隔离方式并进入返回的 projectRoot。三种流程统一使用以下顺序：

1. 先核对当前目录、Runtime 归属和已有 OpenSpec change。已有 SDK Run 时直接恢复其当前 Action，补齐缺失产物，不再执行 OpenSpec `new change` 或 `state init`。
2. 真正的新 change 先创建 OpenSpec 基础目录；仅在此分支加载下面的新建 Skill。已有基础目录但初始化中断时，用 OpenSpec `status --change <name> --json` 核对实际产物，确认属于当前需求后补做初始化，保留文件。
3. 基础目录创建成功后，立即运行 `comet state init <name> <full|hotfix|tweak> --isolation <selected-isolation>`，再运行 `comet state select <name>`。不要先初始化 Runtime 再调用 OpenSpec `new change`，后者会拒绝已存在的目录。初始化失败时保留 OpenSpec 目录，恢复时只补未完成步骤。
4. SDK Run 已存在后，通过 `status` 和 `instructions` 填充当前需要的产物，再按阶段入口预览 Open 并取得用户批准。已有目录无法确认归属时先停止核对，不覆盖或新建第二份 Run。

真正的新 change 创建基础目录时：

**立即执行：** 使用 Skill 工具加载 openspec-new-change 技能。禁止跳过此步骤。

<!-- external-openspec-skill-override -->

技能加载后，通过 `comet classic openspec -- <args...>` 执行命令，使用 `<classic-*>` 路径。基础目录创建后返回上面的初始化步骤，再填充产物。hotfix 的 proposal 记录问题、根因和修复目标；tweak 记录动机、目标和范围。两者保存简短 design.md 与 tasks.md；影响已有验收时创建所需 delta spec，tweak 不因 delta spec 升级。

## Design

读取当前 proposal、tasks、delta specs 和已有设计中与本轮有关的内容；摘要被截断或缺少验收正文时补读原文。行为需求以 OpenSpec 为准，技术设计引用需求，不创建第二份规格。已确认需求不重新询问。

**立即执行：** 使用 Skill 工具加载 Superpowers brainstorming 技能。禁止跳过此步骤。

技能加载后，只采用探索与设计方法；传入当前 change、已绑定工作区、已知事实、约束和源文件引用。遇到无法推断且会改变结果的决定时，按 decision-point.md 提供问题、推荐理由、选项及影响。信息充分时直接形成方案，不设最低问答轮数；真实存在取舍时比较方案，高风险接口、迁移、安全和并发说明失败路径与验证策略。

持续保存 `brainstorm-summary.md`，区分候选与已确认内容。Spec Patch 先说明具体改动并取得用户同意，再修改 delta spec；大幅改变范围时重新澄清。需要重新确认时，按[需求变化后的重新确认](decision-point.md#需求变化后的重新确认)说明变化及影响。最终方案统一通过主 Skill 的 Design Wait 确认，仍绑定当前 Design 提案哈希；不再追加整份设计文档批准，也不让外部 Skill 自动进入规划、实施或切换工作区。

批准后完善唯一 Design Doc：已有引用优先沿用，否则使用当前 change 的 design.md；项目明确要求独立文档时，OpenSpec design.md 仅保存摘要和链接。frontmatter 仅含 `comet_change: <change-name>`、`role: technical-design`、`canonical_spec: openspec`。设计覆盖方案、取舍、风险和测试策略，正文与已批准提案一致后提交。中断后读取已保存摘要、源文件与当前 Wait，只补未完成工作。

## Build

已选配置要求的实施、TDD 或审查能力，按[宿主能力核对](../../comet/reference/host-check.md) 在开始实现前确认；已有仍有效的核对直接复用。

工作区沿用 Open 的绑定；需要展示、补齐或更改配置时，读取[执行配置展示](decision-point.md#执行配置展示)，按当前 change 的值、含义和确认状态呈现。各字段的选择与要求如下：

| 配置        | 选择与要求                                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| build_mode  | autonomous 自行规划与实施；executing-plans 按固定计划实施；subagent-driven-development 由实现代理实施、主会话协调；direct 由当前会话按计划直接实施 |
| tdd_mode    | tdd 保留真实 RED/GREEN；direct 不要求 RED/GREEN，仍做相关检查与缺陷回归                                                                            |
| review_mode | off 跳过自动审查；standard 审查风险任务与最终集成；thorough 做任务或分段审查及最终集成                                                             |

full autonomous 必须采用 standard 或 thorough。full direct 需要用户明确选择并记录 `direct_override: true`，仍完成设计、计划和验证。subagent-driven-development 对应 `subagent_dispatch: confirmed`，其他方式为 null。

已有待决定 Wait 复用原提案，提案改变后按现有机制重新确认，不沿用过期批准。用户明确选择完整配置后，使用主 Skill 的 `propose-build --confirmed` 保存提案与批准；缺少决定时保留 Wait。

任务正文与完成状态以 tasks.md 为准。保留任务 ID；计划引用设计和当前任务权威，写入 `<!-- comet-task-authority: <classic-task-authority-ref> -->` 和每项 `<!-- comet-task-ref:<task-id> -->`，不复制 checkbox。计划列出任务范围、依赖、约束和验收方式；高风险部分补充理由、失败处理和回退。frontmatter 保留 `change`、`design-doc` 和实施前的 `base-ref`，恢复时不重写旧 base-ref。已有有效计划直接复用。

autonomous 直接制定计划。其他策略需要编写计划时：

**立即执行：** 使用 Skill 工具加载 writing-plans 技能。禁止跳过此步骤。

技能加载后，只采用编写与自检方法，完成后返回当前 Run。实施时，executing-plans 策略：

**立即执行：** 使用 Skill 工具加载 executing-plans 技能。禁止跳过此步骤。

技能加载后，使用当前配置与固定计划实施。subagent-driven-development 策略：

**立即执行：** 使用 Skill 工具加载 subagent-driven-development 技能。禁止跳过此步骤。

技能加载后，主会话协调、实现代理实施；委派前读取 subagent-dispatch.md，按工作包逐 ID 验收。外部 Skill 不新建工作区、不改变配置、不执行最终收尾。派发失败时保存原因，不擅自更换策略。

非 autonomous 的 tdd 策略首次实施时，由实施者加载：

**立即执行：** 使用 Skill 工具加载 test-driven-development 技能。禁止跳过此步骤。

技能加载后，按当前已确认任务执行。tdd 先确认测试因待实现行为而失败，再实施并记录转绿结果。已有有效证据无需重演，不回退代码伪造 RED。按风险运行相关检查；Build 做任务级或分段审查，Verify 做唯一最终集成审查。必须解决 CRITICAL/IMPORTANT 问题；无法完成所需独立审查时报告阻塞，不用实现者自评代替。任务实际完成后勾选同一 tasks.md，由 Run 提交实现结果和检查证据。

需求变化时判断实际范围、公开行为、验收和风险；原范围内遗漏直接修复，实质扩大范围或需要重新设计时，按[需求变化后的重新确认](decision-point.md#需求变化后的重新确认)请用户决定。任务数和文件数不单独触发 full 流程重启。异常先复现、定位根因，再修复并验证；需要外部方法时按 debug-gate.md 加载相应 Skill，仍沿用当前 Run。

## Verify

核对任务完成、实际改动范围、构建与相关测试、安全问题、目标及全部验收场景，并检查实现与当前规格和技术设计一致。风险决定深度，不以文件数直接决定全量测试；tweak 的 delta spec 是正常产物，存在时必须验证规格一致性。

review_mode 为 standard 或 thorough 时，由独立 reviewer 对最终 diff 完成唯一最终集成审查；覆盖当前输入的有效审查可以复用，输入变化只补受影响部分。off 时记录跳过原因；full autonomous 仍要求独立审查。autonomous 不依赖外部验证或审查 Skill，其他策略进入实际验证时：

**立即执行：** 使用 Skill 工具加载 verification-before-completion 技能。禁止跳过此步骤。

技能加载后，只采用验证方法，使用当前候选和有效证据。非 autonomous 且 review_mode 为 standard 或 thorough 的最终集成审查：

**立即执行：** 使用 Skill 工具加载 requesting-code-review 技能。禁止跳过此步骤。

技能加载后，审查当前最终 diff，复用仍有效的独立结论，不追加第二次最终审查。完整规格验证时：

**立即执行：** 使用 Skill 工具加载 openspec-verify-change 技能。禁止跳过此步骤。

<!-- external-openspec-skill-override -->

技能加载后，OpenSpec 命令通过 `comet classic openspec -- <args...>`，路径使用已绑定的 `<classic-*>` 根目录。核对 tasks、proposal、能力场景、高层与技术设计，以及 delta spec 与设计的一致性。

将实际结果、证据、独立审查结论、未执行项和已接受偏差写入报告。明确可修复的失败在前三次内按主 Skill 回 Build；CRITICAL/IMPORTANT 不可豁免。WARNING/SUGGESTION 涉及行为、范围或风险取舍时由用户决定；安全局部修复直接处理。已有 verify_failures >= 3 时，先让用户选择继续修复或停止流程寻求外部决定。失败、超时、阻塞和未执行均不算通过。

## 检查复用

确定性的本地检查使用主 Skill 的 Guard 命令并在 `--` 前加 `--local`。Runtime 只有在 argv、cwd、输入、环境、超时、原始收据和日志匹配时才返回 reused；Build 与 Verify 可复用同一完整命令。外部服务或不可重复检查不加该参数。恢复时沿用原执行及收据，结果未知先核对，不重发副作用。输入发生变化时由 Runtime 重跑，不能用旧对话里的通过结论替代检查。

## 预设范围复核

hotfix/tweak 的 Build、Verify 和 Archive 都核对已批准需求。完成任务的 checkbox 和 `state tasks --assign-ids` 添加的任务标识不改变需求；proposal、设计、规格或任务正文发生变化时，恢复已批准内容，或在 Build 使用主 Skill 的 `propose-escalation` 提交当前范围，再按[需求变化后的重新确认](decision-point.md#需求变化后的重新确认)取得同一预设继续或升级 full 的新决定。继续批准绑定提案时的实际内容；提案后再次改动时先恢复提案内容，或选择升级 full 并重新确认设计，不沿用旧批准。

hotfix 先复现根因，保留真实失败证据；可自动化时先运行失败回归，再修复并确认转绿，最后检查根因已消除。hotfix 使用 direct/direct/off 默认配置，任务数不决定是否升级。

tweak 使用 direct，并采用 OpenSpec apply 方法：

**立即执行：** 使用 Skill 工具加载 openspec-apply-change 技能。禁止跳过此步骤。

<!-- external-openspec-skill-override -->

技能加载后，通过 `comet classic openspec -- status --change <name> --json` 和 `comet classic openspec -- instructions apply --change <name> --json` 获取或复用有效结果，读取列出的 contextFiles 与全部 apply 指令，逐项实现并勾选同一 tasks.md，保留格式检查、相关测试与回归结果。路径使用 `<classic-*>` 根目录。full 不使用此预设 apply 路径。

新增功能、公共 API、schema、跨模块协调或深层架构变化时，请用户决定继续预设或升级 full。hotfix 超过 4 个、tweak 超过 6 个交付文件只触发范围复核，不自动升级。仅文件数超限且范围、验收与风险不变时，可复用当前 change 的 rulings.md：`status: active`、匹配 workflow、`decision: continue-on-file-count-only`、已确认 scope、`allowed-file-categories: implementation, tests, user-docs, config, generated`、`authorization-basis: user-explicit` 和 reason。首次无有效授权时先询问；已有授权时报告总数、分类、范围对应关系及记录位置后继续。范围、风险、验收、workflow 或文件类别改变时标为 invalidated，再请用户决定。SDK 使用主 Skill 的 escalation Wait，升级保留同一 Run 与工作区，进入 full Design，不执行 Compat 的状态清空命令。

## Archive 与 Git 交付

使用当前验证证据、绑定分支、remote 和 PR base，展示归档影响与本 change 的改动归属。已有授权覆盖相同目标时沿用，只补未完成的交付；目标变化或授权缺失时再问。local 只归档并提交，push 再推送，pr 推送后创建 PR；reverify 回 Verify，later 保留当前工作。target branch 与 PR base 分别核对，不能混用。

Guard apply 自带预检与副作用边界复查，常规提交直接执行主 Skill 的 apply 命令；诊断时才预览。归档后核对 Runtime 返回的实际路径，显式暂存本 change 的实现、归档文件、主 spec 和设计/计划标注，审查 staged diff 后创建唯一归档提交。保留无关改动；提交后不再修改已封存的归档目录。已有提交则复用，push/PR 结果未知先只读核对远端，不重复执行。完成实际 Git 交付后用真实 SHA 和 PR URL 提交 complete-delivery，由 Runtime 核对通过并结束 Run 才宣告完成。
