# Outcome

让 Comet 在不依赖用户手动整理的情况下，把用户反馈、任务结果、验证、Review、Change 归档和上下文使用结果记录为统一 Agent Experience；通过后台 Reflection 将 Experience 沉淀为 Personal Memory、Project Knowledge 和可执行或可召回的 Project Policy，并在后续任务中按需加载、展示“为什么应用”，形成可持续自我改进的 Agent Learning Loop。

# Scope

- 新增共享 `agent-learning` 领域模块，提供版本化 Experience Event、Experience Journal、Reflection、Consolidation、应用反馈和状态晋升接口。
- 用统一 Experience Event 替换当前仅有 `completed` 名称和大量可选字段的生命周期观察接口，并接入 Native、Classic、Hotfix、Tweak、`comet task`、Personal Memory、Project Knowledge 和 Plugin Runtime。
- Personal Memory 分为 Core Profile、Collaboration Policy 和 Personal Episode；显式偏好或纠正立即生效，隐式经验可以立即试用，并根据后续效果自动强化、改写或废弃。
- Project Knowledge 分为 Project Model 与 Project Policy：前者保存项目事实，后者保存决策、模式、流程、约束和失败解决经验。
- 增加 Policy Compiler，把项目策略分类为上下文指导、已有验证命令约束或 Skill 候选；本期不编写通用生态配置生成器。
- 增加 Context Director 和渐进式 Context Manifest：只常驻核心画像与关键策略，其余内容按 ID 展开，并记录应用原因和后续结果。
- 支持任务、路径、操作和阶段变化时重新选择上下文；有 Hook 时动态投递，无 Hook 时由 Skill/CLI 使用相同接口。
- Dashboard 和 CLI 使用同一领域状态，展示记忆/知识/策略类型、状态、证据、应用原因、使用结果，并支持纠正、遗忘、废弃和展开。
- 删除未上线旧事件、旧 Record 状态和拒绝大 Review Packet 的兼容路径；更新正式 Specs、双语 Skill、Runtime 生成物、测试、Eval 和 Changelog。

# Non-goals

- 不训练或微调模型，不保存隐藏推理，不建设完整会话回放系统。
- 不引入向量数据库、通用知识图谱、常驻后台服务或新的 Provider marketplace。
- 不自动把 Personal Memory 复制为团队 Project Policy。
- 不实现自动改写任意 ESLint、Maven、Gradle、compiler 或 CI 配置的通用生成器；只复用已经存在并可验证的项目命令。
- 不自动生成或覆盖项目 Skill；成熟多步骤经验只形成 Skill 候选。
- 不让记忆或项目策略扩大提交、推送、删除、发布等用户授权。
- 不提供未上线旧机器 schema、旧事件 envelope 或旧 Dashboard 状态的迁移兼容；用户可读 Personal Memory Markdown 和项目知识来源仍可重新导入或重建。

# Acceptance examples

- A1: Plugin Runtime 接收统一、版本化且有来源的 Experience Event；Native、Classic、Hotfix、Tweak 和 `comet task` 不再分别拼装互不一致的学习载荷。
- A2: 相同 `eventId` 只能写入一次；同一 episode 的重试、恢复和重复验证会合并证据，不制造重复学习记录。
- A3: 用户明确表达长期偏好或纠正时，Personal Memory 在当前交互后立即写为 proven，并从下一任务的 Core Profile 或 Collaboration Policy 生效。
- A4: 一次性要求和普通 Agent 工作摘要不进入长期记忆；带复用价值但没有明确长期措辞的用户反馈可以成为 trial，并立即参与低优先级召回。
- A5: trial 记忆在一次成功应用后自动成为 proven；被用户否定或造成失败时自动降级、改写或 supersede，显式用户内容始终覆盖推断内容。
- A6: 自动学习遇到任意大小的有效输入时按 episode 和 evidence 分块 Reflection/Consolidation，不再抛出 Review Packet byte budget 错误；容量配置只约束单次上下文注入，不拒绝保存。
- A7: Project Model 能从当前代码、配置、自定义知识路径和成功验证中自动生成或更新 topology、fact 与 dependency 事实，并保留可核对来源。
- A8: `review.resolved`、`failure.resolved`、`verification.completed` 和 `change.archived` 能形成 decision、pattern、procedure、constraint 或 failure-resolution Project Policy。
- A9: 明确用户项目约定和确定性仓库事实直接 proven；单次可信推断进入 trial；成功复用后 proven；绑定现有成功验证命令的确定性约束可以 enforced。
- A10: Policy Compiler 对 Agent 判断型内容生成上下文策略，对已有项目验证命令生成验证策略，对稳定多步骤流程生成 Skill 候选；不会自动改写未知技术栈配置。
- A11: 来源文件变化、验证命令消失或更高优先级决定出现后，受影响知识或策略停止注入并变为 superseded，重新学习产生新版本而非近义重复。
- A12: 新任务只注入完整 Core Profile、关键 proven/enforced Project Policy 和紧凑 Context Manifest；相关详细记忆、项目知识、Episode 与 Procedure 通过稳定 ID 按需展开。
- A13: 每个 Context Manifest item 都包含本地化标题、摘要、来源类型和 `whyApplied`；Agent 或 Dashboard 可以读取完整内容、来源和验证方式。
- A14: Context Director 在任务、路径、操作或阶段变化时重新选择相关内容；同一会话未变化内容不重复投递。
- A15: 每次实际应用上下文都会产生 application 记录；任务完成时的成功、忽略、覆盖或用户纠正反馈会回写并影响后续排序和状态晋升。
- A16: 有 Hook 的宿主使用唯一 Comet Hook Router 投递同一 Context Manifest；无 Hook 时 `comet task`/Skill 提供相同行为和展开入口。
- A17: Personal Memory 与 Project Knowledge 继续使用独立 Provider、存储和作用域；同一 Experience 可以被两个 Learner 独立消费，但不能跨域直接复制规范化记录。
- A18: Dashboard 首屏从缓存快照直接展示，不等待 Reflection；个人记忆中心区分 Core Profile、Collaboration Policy 与 Personal Episode，项目知识中心区分 Project Model 与 Project Policy，并展示 trial/proven/enforced/superseded、应用原因、最近效果和 Context Manifest 预览；统一设置只配置 Provider、学习、检索与单次注入预算，不把存储或 Review Packet 暴露为容量限制。
- A19: 旧 `CometLifecycleObservation`、旧 Project Knowledge Record 状态和固定 Review Packet 拒绝路径被主动删除，不保留别名、双写或迁移分支。
- A20: 形成 Eval 覆盖显式偏好、隐式纠正、失败解决、Review 决策和项目约束；检索 Eval 验证目标内容召回、错误应用、上下文节省和反馈后排序变化。

# Constraints and invariants

- 优先级始终为：当前用户要求与系统约束 > 当前代码、配置和测试 > proven/enforced Project Policy > Project Model > Personal Memory > trial/历史 Episode。
- Experience 只保存结构化情境、动作摘要、结果和证据引用，不保存完整 transcript、完整 diff、原始日志或隐藏推理。
- Personal Memory、Project Knowledge 和 Project Policy 共享事件与 Reflection 基础设施，但保持独立领域接口、Provider 和规范化状态。
- 写入与 Reflection 不设置用户可见总容量或字节拒绝；Context Director 只对单次注入使用可配置字符预算和渐进式展开。
- SQLite/FTS 继续是可重建读模型，不成为仓库事实、用户可读 Personal Memory 或 workflow 状态的唯一来源。
- 自动学习默认后台执行，失败不能阻断当前 workflow；显式记住、纠正、遗忘和展开失败必须返回真实错误。
- `app/` 只编排领域能力；共享学习规则位于 `domains/agent-learning/`，平台存储差异通过现有 Provider/Adapter seam 接入。
- 本需求围绕同一 Experience/Context interface 反复修改相同核心模块，保持单一 Native change，不拆分 Supervisor children。

# Decisions

- 采用 Agent Learning Loop：Experience → Reflection → Consolidation → Semantic/Procedural Memory → Context Activation → Outcome Feedback。
- Agent 记忆类型采用业界一致的 episodic、semantic、procedural；产品仍使用用户可理解的“个人记忆、项目知识、项目规则”名称。
- Project Policy 是 `comet.project-knowledge` 插件内部独立领域模块，不新增第三个用户必须管理的插件入口。
- Personal Memory 的显式信号直接 proven；隐式信号不进入人工审批队列，而是以 trial 立即低优先级试用。
- Project Model 的确定性事实直接 proven；Project Policy 只有绑定现有确定性验证入口时才进入 enforced。
- 状态统一收敛为 `trial | proven | enforced | superseded`，遗忘继续使用独立 tombstone；不保留旧 candidate/active/needs-review/retired 兼容层。
- Core Profile 与关键策略完整注入，其余内容只进入 Context Manifest；通过稳定 ID 展开正文。
- Provider 数据可持续增长；现有容量字段改为上下文注入预算，不再作为保存或 Review 的拒绝条件。
- 未上线内部 schema 直接替换；现有可读 Markdown 和仓库来源通过重建导入，不实现机器状态迁移。

# Open questions

- 无。

# Verification expectations

- 先运行 agent-learning、comet-plugin、comet-memory、project-knowledge、comet-entry 和相关 app 命令的最小 Vitest。
- 运行 Personal Memory formation/retrieval Eval 与 Project Knowledge retrieval/learning Eval，并增加 application feedback 场景。
- 更新 Dashboard source/host/Playwright 测试，验证 Context Manifest、whyApplied、状态和缓存首屏。
- 涉及跨模块事件、Hook、Runtime 和生成资产，最终运行 format、lint、build、生成物检查和全量测试；Native Verifier 逐项验证 A1-A20。
