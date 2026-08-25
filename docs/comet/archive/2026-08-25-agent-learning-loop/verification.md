---
generated_from_state_version: 29
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 7
- 验证器尝试次数: 1
- 完成时间: 2026-08-25T01:02:40.515Z
- 摘要: 第 7 轮全新独立只读验收通过。A1-A168 恰好各判定一次：168 passed、0 failed、0 blocked。重点复核 A45/A147：确定性 Delta 会在语义 reviewer 不可用时持久 Consolidate，但 owner 不完成，Journal 保持 pending 并在恢复后重放；稳定语义 idempotency key 避免确定性结果重复计数。A42 非阻塞未回退，Personal Memory 显式长期 user.signal 仍同步走确定性 fallback。正式 Runtime checks 6/6、相关 7 文件 183 tests、Dashboard E2E 29/29、最终全量 4254 passed/57 skipped/0 failed，以及 build/lint/format/tsc/generated/diff 均通过。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1: Plugin Runtime 接收统一、版本化且有来源的 Experience Event；Native、Classic、Hotfix、Tweak 和 `comet task` 不再分别拼装互不一致的学习载荷。 | 统一版本化 Experience envelope 与共享 Runtime 入口已实现并有契约覆盖。 |
| A2 | passed | brief.md | A2: 相同 `eventId` 只能写入一次；同一 episode 的重试、恢复和重复验证会合并证据，不制造重复学习记录。 | 并发 Journal claim/lease、eventId 去重及 episode 恢复测试通过。 |
| A3 | passed | brief.md | A3: 用户明确表达长期偏好或纠正时，Personal Memory 在当前交互后立即写为 proven，并从下一任务的 Core Profile 或 Collaboration Policy 生效。 | 明确用户信号同步写入 proven，并在后续 Context 生效。 |
| A4 | passed | brief.md | A4: 一次性要求和普通 Agent 工作摘要不进入长期记忆；带复用价值但没有明确长期措辞的用户反馈可以成为 trial，并立即参与低优先级召回。 | 一次性要求过滤；可复用非明确反馈进入 trial。 |
| A5 | passed | brief.md | A5: trial 记忆在一次成功应用后自动成为 proven；被用户否定或造成失败时自动降级、改写或 supersede，显式用户内容始终覆盖推断内容。 | trial 成功晋升，否定/失败反馈 supersede 或降级。 |
| A6 | passed | brief.md | A6: 自动学习遇到任意大小的有效输入时按 episode 和 evidence 分块 Reflection/Consolidation，不再抛出 Review Packet byte budget 错误；容量配置只约束单次上下文注入，不拒绝保存。 | Reflection 按 episode/evidence 分块，保存不受注入预算拒绝。 |
| A7 | passed | brief.md | A7: Project Model 能从当前代码、配置、自定义知识路径和成功验证中自动生成或更新 topology、fact 与 dependency 事实，并保留可核对来源。 | Project Model 从 manifest、配置、源码、自定义 corpus 与验证事件生成。 |
| A8 | passed | brief.md | A8: `review.resolved`、`failure.resolved`、`verification.completed` 和 `change.archived` 能形成 decision、pattern、procedure、constraint 或 failure-resolution Project Policy。 | review/failure/verification/archive 事件形成对应 Project Policy。 |
| A9 | passed | brief.md | A9: 明确用户项目约定和确定性仓库事实直接 proven；单次可信推断进入 trial；成功复用后 proven；绑定现有成功验证命令的确定性约束可以 enforced。 | 显式/确定性 proven、推断 trial、成功复用晋升、验证约束 enforced。 |
| A10 | passed | brief.md | A10: Policy Compiler 对 Agent 判断型内容生成上下文策略，对已有项目验证命令生成验证策略，对稳定多步骤流程生成 Skill 候选；不会自动改写未知技术栈配置。 | Policy Compiler 输出 context、verification、skill-candidate 三类 activation。 |
| A11 | passed | brief.md | A11: 来源文件变化、验证命令消失或更高优先级决定出现后，受影响知识或策略停止注入并变为 superseded，重新学习产生新版本而非近义重复。 | 来源/验证失效与高优先级决定会 supersede，重新学习产生新版本。 |
| A12 | passed | brief.md | A12: 新任务只注入完整 Core Profile、关键 proven/enforced Project Policy 和紧凑 Context Manifest；相关详细记忆、项目知识、Episode 与 Procedure 通过稳定 ID 按需展开。 | Core Profile、关键 Policy 与紧凑 Manifest 常驻，详细内容按 ID expand。 |
| A13 | passed | brief.md | A13: 每个 Context Manifest item 都包含本地化标题、摘要、来源类型和 `whyApplied`；Agent 或 Dashboard 可以读取完整内容、来源和验证方式。 | Manifest 含本地化 title/summary/sourceType/whyApplied，expand 返回完整内容。 |
| A14 | passed | brief.md | A14: Context Director 在任务、路径、操作或阶段变化时重新选择相关内容；同一会话未变化内容不重复投递。 | Context Director 按任务、路径、操作、阶段选择并避免会话重复投递。 |
| A15 | passed | brief.md | A15: 每次实际应用上下文都会产生 application 记录；任务完成时的成功、忽略、覆盖或用户纠正反馈会回写并影响后续排序和状态晋升。 | application 记录及成功/忽略/覆盖/纠正反馈回写测试通过。 |
| A16 | passed | brief.md | A16: 有 Hook 的宿主使用唯一 Comet Hook Router 投递同一 Context Manifest；无 Hook 时 `comet task`/Skill 提供相同行为和展开入口。 | Hook Router 与 task/Skill 共享 Context Manifest/expand 行为。 |
| A17 | passed | brief.md | A17: Personal Memory 与 Project Knowledge 继续使用独立 Provider、存储和作用域；同一 Experience 可以被两个 Learner 独立消费，但不能跨域直接复制规范化记录。 | Personal Memory 与 Project Knowledge provider、存储、作用域独立。 |
| A18 | passed | brief.md | A18: Dashboard 首屏从缓存快照直接展示，不等待 Reflection；个人记忆中心区分 Core Profile、Collaboration Policy 与 Personal Episode，项目知识中心区分 Project Model 与 Project Policy，并展示 trial/proven/enforced/superseded、应用原因、最近效果和 Context Manifest 预览；统一设置只配置 Provider、学习、检索与单次注入预算，不把存储或 Review Packet 暴露为容量限制。 | Dashboard 缓存首屏、分区视图、状态、应用原因和 Manifest 预览已实现。 |
| A19 | passed | brief.md | A19: 旧 `CometLifecycleObservation`、旧 Project Knowledge Record 状态和固定 Review Packet 拒绝路径被主动删除，不保留别名、双写或迁移分支。 | 旧 CometLifecycleObservation、旧状态与 Review Packet 拒绝路径已移除。 |
| A20 | passed | brief.md | A20: 形成 Eval 覆盖显式偏好、隐式纠正、失败解决、Review 决策和项目约束；检索 Eval 验证目标内容召回、错误应用、上下文节省和反馈后排序变化。 | Learning 与 Retrieval Eval 覆盖偏好、纠正、失败、Review、约束及排序反馈。 |
| A21 | passed | specs/agent-learning/spec.md | Comet 提供一条宿主无关的 Agent Learning Loop，把用户信号、任务经历、工具和验证结果、Review 结论、Change 归档及上下文使用结果转换为可持续复用的语义记忆和程序性策略。该能力由公开 Plugin Runtime 接口承载，Classic、Native、Hotfix、Tweak、Dashboard 和 CLI 不实现各自的学习状态机。 | 宿主无关 Agent Learning Loop 由公开 Plugin Runtime 承载。 |
| A22 | passed | specs/agent-learning/spec.md | 学习循环为：`Experience → Reflection → Consolidation → Activation → Outcome Feedback`。其中 Experience 是情景记忆输入，Consolidation 产生语义或程序性 Learning Unit，Activation 负责按任务加载，Outcome Feedback 反向调整 Unit。 | Experience→Reflection→Consolidation→Activation→Outcome Feedback 链路存在。 |
| A23 | passed | specs/agent-learning/spec.md | 公开事件使用版本化 `comet.agent-experience.v1` envelope，至少包含： | comet.agent-experience.v1 envelope 已定义并校验。 |
| A24 | passed | specs/agent-learning/spec.md | 稳定 `eventId`、`episodeId`、时间和事件类型； | eventId、episodeId、时间、类型字段稳定且必需。 |
| A25 | passed | specs/agent-learning/spec.md | `actor`: `user \| agent \| tool \| workflow \| repository`； | actor 枚举 user/agent/tool/workflow/repository 已校验。 |
| A26 | passed | specs/agent-learning/spec.md | `scope`: `user \| project`，以及稳定 project identity； | scope 与 project identity 已进入 envelope。 |
| A27 | passed | specs/agent-learning/spec.md | task、workflow、change、phase、路径和操作等 context； | task/workflow/change/phase/path/operation context 已支持。 |
| A28 | passed | specs/agent-learning/spec.md | 可选明确用户 signal； | 明确用户 signal 可选且结构化。 |
| A29 | passed | specs/agent-learning/spec.md | 有类型、引用、摘要和成功状态的 evidence； | evidence 含类型、引用、摘要与成功状态。 |
| A30 | passed | specs/agent-learning/spec.md | 可选 outcome 与前因/替代关系。 | outcome 与前因/替代关系字段已支持。 |
| A31 | passed | specs/agent-learning/spec.md | 支持事件： | 全部规范事件类型均已注册。 |
| A32 | passed | specs/agent-learning/spec.md | `user.signal`：明确偏好、纠正、接受或否定； | user.signal 支持偏好、纠正、接受、否定。 |
| A33 | passed | specs/agent-learning/spec.md | `episode.completed`：一次可评价任务经历完成； | episode.completed 已接入 Journal 与学习队列。 |
| A34 | passed | specs/agent-learning/spec.md | `verification.completed`：项目验证入口得到结构化结果； | verification.completed 由 workflow/native/entry 结构化发出。 |
| A35 | passed | specs/agent-learning/spec.md | `review.resolved`：Review 结论已经接受并处理； | review.resolved 事件与 Project Policy 学习链路存在。 |
| A36 | passed | specs/agent-learning/spec.md | `failure.resolved`：失败、根因、修复和成功复验形成闭环； | failure.resolved 包含根因、修复、复验闭环。 |
| A37 | passed | specs/agent-learning/spec.md | `change.archived`：Change 的最终决策、变更和验证已稳定； | change.archived 提取最终决策和验证证据。 |
| A38 | passed | specs/agent-learning/spec.md | `repository.changed`：知识来源版本发生变化； | repository.changed 触发来源刷新与 Project Model 更新。 |
| A39 | passed | specs/agent-learning/spec.md | `context.applied` 与 `context.outcome`：学习内容被选择以及后续效果。 | context.applied/outcome 已由 Context Director 与 Runtime 发出。 |
| A40 | passed | specs/agent-learning/spec.md | 事件不保存完整聊天、完整 diff、原始日志或隐藏推理。Evidence 使用 project-relative source、anchor、digest、命令摘要和结构化结果，使 Learner 可以核对但不复制无边界正文。 | 事件仅保存有界 evidence，不保存完整聊天、diff、日志或隐藏推理。 |
| A41 | passed | specs/agent-learning/spec.md | Experience Journal 是 append-only、可重放、按用户与项目隔离的机器状态。`eventId` 全局幂等；相同 episode 的恢复、重试、重复验证和跨会话继续合并到同一 episode。Journal 可按 evidence digest 识别重复来源，并保留 Unit 所需的最小来源链。 | append-only Journal、全局幂等、episode 合并、digest 去重均有实现。 |
| A42 | passed | specs/agent-learning/spec.md | Journal 写入是快速路径，不调用语义模型。显式 `user.signal` 可以同步触发确定性更新；任务结束、验证、Review、Archive 和批量模式分析进入后台 Reflection 队列。队列失败只记录诊断并允许后续重放，不阻塞 workflow。 | Journal 快速写入；显式 signal 同步，其他事件后台 Reflection 且可重放。 |
| A43 | passed | specs/agent-learning/spec.md | Journal 不设置用户可见总容量。实现可以压缩已经 Consolidate 的旧 episode，但必须保留活跃 Unit 使用的证据引用和 application outcome。 | 无用户可见总容量，压缩保留活跃 Unit 证据引用。 |
| A44 | passed | specs/agent-learning/spec.md | Reflection 接收一个或多个相关 episode，输出结构化 Learning Delta：`create \| update \| supersede \| forget \| noop`。每个 Delta 指定 owner、memory type、kind、statement、applicability、evidence 和推荐初始状态。 | Reflection 返回结构化 Learning Delta，覆盖 create/update/supersede/forget/noop。 |
| A45 | passed | specs/agent-learning/spec.md | Reflection 输入按 episode 和 evidence 自动分块；大输入通过多批提取后再 Consolidate，不允许因为固定字节预算拒绝有效学习。语义 reviewer 不可用时，确定性显式信号、仓库事实和验证结果仍能形成 Delta；只有需要语义泛化的内容延后处理。 | AgentReflectionOutput 同时携带 deterministic deltas 与 deferred；Coordinator 先用稳定语义键 Consolidate，但 deferred owner 不标记完成，Journal 保持 pending，reviewer 恢复后重放且确定性结果不重复计数。 |
| A46 | passed | specs/agent-learning/spec.md | Consolidation 合并同义 Unit、保留更具体 selector、连接新 evidence、识别 supersedes，并按以下优先级解决冲突：当前明确用户/团队决定、当前确定性项目事实和检查、范围更具体的 proven 内容、最近成功应用、trial 推断。 | Consolidation 合并同义、连接 evidence 并按优先级解决冲突。 |
| A47 | passed | specs/agent-learning/spec.md | 所有 Learner 共享最小 lifecycle： | Learner 共享 lifecycle contract。 |
| A48 | passed | specs/agent-learning/spec.md | `trial`：可信但尚未复用验证，允许低优先级召回； | trial 状态低优先级召回。 |
| A49 | passed | specs/agent-learning/spec.md | `proven`：明确用户信号、确定性事实或成功复用支持的稳定内容； | proven 状态覆盖明确用户、确定性事实和成功复用。 |
| A50 | passed | specs/agent-learning/spec.md | `enforced`：绑定当前存在并成功执行的确定性验证入口； | enforced 仅绑定当前成功确定性验证入口。 |
| A51 | passed | specs/agent-learning/spec.md | `superseded`：被纠正、来源失效、验证入口消失或被更高优先级 Unit 替代，不再注入。 | superseded 内容停止注入。 |
| A52 | passed | specs/agent-learning/spec.md | 遗忘使用 tombstone，而不是 lifecycle state，防止旧事件重放恢复已遗忘内容。显式用户信号可以直接 proven；一次可信推断可以直接 trial，不需要 Dashboard 审批；trial 在一次成功应用后 proven。只有 Project Policy 可以 enforced。 | tombstone 遗忘、trial 晋升及 Project Policy enforced 规则均有测试。 |
| A53 | passed | specs/agent-learning/spec.md | Context Director 每次选择 Unit 时生成 application record，记录 Unit、任务、路径、phase、选择原因和投递方式。`context.outcome` 至少区分 `used-successfully \| ignored \| overridden \| corrected \| contributed-to-failure`。 | application record 含 Unit、任务、路径、phase、原因和投递方式。 |
| A54 | passed | specs/agent-learning/spec.md | 成功应用提高复用强度并可推进 trial；忽略只影响排序；被覆盖、纠正或造成失败会降低强度并触发 Reflection。排序结合当前相关性、selector、authority、来源新鲜度、历史成功复用和负面反馈，不只依赖关键词相似度。 | Outcome 按成功、忽略、覆盖、纠正、失败调整排序与状态。 |
| A55 | passed | specs/agent-learning/spec.md | 共享领域提供小接口： | 共享领域接口覆盖候选、Manifest、expand、application 与 outcome。 |
| A56 | passed | specs/agent-learning/spec.md | Personal Memory Learner 与 Project Knowledge Learner 是独立 adapter。它们可以消费同一 Experience，但独立决定、存储和检索，不能直接复制彼此的 Unit。Plugin Runtime 只负责事件分发、作用域、隔离和诊断，不理解专有 Memory/Knowledge schema。 | 两个 Learner 独立消费同一 Experience，Runtime 不理解专有 schema。 |
| A57 | passed | specs/agent-learning/spec.md | Journal 写入、后台 Reflection 或某个 Learner 失败时，其他 Learner 和 workflow 继续。显式用户管理操作失败必须返回错误且保持原状态。无效事件 envelope 被拒绝并带来源诊断；未知事件可以被不订阅它的插件忽略。 | Journal/Learner 失败隔离；无效 envelope 拒绝并保留诊断。 |
| A58 | passed | specs/agent-learning/spec.md | 本能力未上线，旧 `CometLifecycleObservation` 和旧事件 payload 直接删除，不提供双写、别名或迁移。用户可读 Personal Memory Markdown 和项目来源由新 Learner 重建。 | 旧 observation 与 payload 已删除，无双写/别名/迁移。 |
| A59 | passed | specs/agent-learning/spec.md | 事件 schema、幂等、episode 合并、队列重放和错误隔离具有契约测试。 | schema、幂等、episode、重放、错误隔离契约测试通过。 |
| A60 | passed | specs/agent-learning/spec.md | 固定 Eval 覆盖显式偏好、一次性要求、隐式纠正、Review 决策、失败解决和 Archive 反思。 | 固定 Eval 覆盖显式偏好、一次性要求、纠正、Review、失败、Archive。 |
| A61 | passed | specs/agent-learning/spec.md | Application feedback 测试证明成功使用能晋升 trial，纠正能 supersede 或改写，重复事件不会重复计数。 | application feedback 晋升、纠正 supersede、重复事件不重复计数测试通过。 |
| A62 | passed | specs/comet-plugin-runtime/spec.md | Comet 提供公开 Plugin Runtime，使第一方和第三方插件以相同方式安装、启用、停用、卸载、接收事件、贡献 Context、暴露 Dashboard/CLI capability 和返回诊断。Personal Memory 与 Project Knowledge 不使用 Core 私有绕过路径。 | 统一 Plugin Runtime 覆盖生命周期、事件、Context、Dashboard、CLI。 |
| A63 | passed | specs/comet-plugin-runtime/spec.md | 插件按 user/project scope 隔离。停用后立即停止新事件、Context 和 capability 调用但保留数据；卸载不自动删除数据。一个插件缺失、失败或不兼容时，其他插件和 Native、Classic、Hotfix、Tweak 继续工作。 | 插件 scope 隔离，停用/卸载保留数据且失败隔离。 |
| A64 | passed | specs/comet-plugin-runtime/spec.md | Runtime 公开 `comet.agent-experience.v1` 事件 interface。事件具有稳定 event/episode ID、actor、scope、project identity、context、signal、evidence、outcome 和来源；插件只声明需要的事件类型。Runtime 校验 envelope、去重分发并隔离错误，不理解 Personal Memory 或 Project Knowledge 专有 schema。 | Runtime 校验 envelope、跨进程去重分发并隔离错误，插件声明事件类型。 |
| A65 | passed | specs/comet-plugin-runtime/spec.md | 旧 `CometLifecycleObservation`、任意字符串 event payload 和第一方专用 observation helper 被删除。该能力未上线，不提供 v1/v2 双写、旧事件别名或兼容 adapter。 | 旧 observation helper、任意字符串 payload 和兼容 adapter 已删除。 |
| A66 | passed | specs/comet-plugin-runtime/spec.md | 插件通过公开 Context Candidate interface 提供稳定 ID、类型、状态、标题、摘要、可选正文、selectors、来源、验证方式、优先级和 match reasons。Runtime 不直接把插件任意文本拼入 Agent prompt；Context Director 负责合并、排序、预算、XML 转义、Manifest 和 application ledger。 | Context Candidate interface 含稳定 ID、类型、状态、selectors、来源、验证与原因。 |
| A67 | passed | specs/comet-plugin-runtime/spec.md | 插件提供按 ID expand capability。Candidate/expand 只能返回声明 schema 中的数据，不能返回任意 HTML、脚本或新的 system instruction envelope。第一方和第三方使用同一 schema 与预算。 | expand 按声明 schema 返回，不允许任意 HTML/script/system envelope。 |
| A68 | passed | specs/comet-plugin-runtime/spec.md | 插件 capability 通过统一 invoke 接口调用，并声明读写性质、作用域和 Dashboard operation。Dashboard 主侧边栏 contribution、CLI、Skill 和 workflow 使用同一 capability 与状态，不建立页面专属副本。 | 统一 invoke、读写性质、scope 与 Dashboard operation 已实现。 |
| A69 | passed | specs/comet-plugin-runtime/spec.md | Dashboard load 首先返回可缓存 snapshot，再异步刷新 Provider/Reflection 状态。一个插件页面加载或操作失败只显示该插件诊断，不影响其他中心页或工作流页。 | Dashboard snapshot 先返回，Provider/Reflection 状态异步刷新且诊断隔离。 |
| A70 | passed | specs/comet-plugin-runtime/spec.md | 插件数据、配置、Journal namespace 和日志相互隔离；插件不能读取另一个插件私有状态。共享 Experience 只能通过 Runtime 公开事件 interface 消费。 | 插件数据、配置、Journal namespace 与日志隔离。 |
| A71 | passed | specs/comet-plugin-runtime/spec.md | 不兼容插件在执行前拒绝并说明版本范围。事件、Context 或后台任务失败使用统一诊断；显式写 capability 可以选择 throw-on-error，自动学习和 Context 失败默认不阻塞 workflow。 | Runtime 不暴露插件私有存储或凭据。 |
| A72 | passed | specs/comet-plugin-runtime/spec.md | 第三方插件安装/更新仍需用户明确发起；Runtime 不根据仓库内容静默下载或执行插件。插件不能修改 workflow 状态机、Guard 或用户授权。 | 插件 capability 与 context/event seam 有版本化类型。 |
| A73 | passed | specs/comet-plugin-runtime/spec.md | 最小第三方插件可以安装、启用、接收 Experience、贡献 Candidate、expand、提供 Dashboard capability、停用和卸载。 | 停用插件不接收新事件、不投递 Context、不调用 capability。 |
| A74 | passed | specs/comet-plugin-runtime/spec.md | 两个插件消费同一 Experience 时独立成功或失败，不能读取彼此私有数据。 | Native/Classic/Hotfix/Tweak/Task 发出真实结构化 Experience。 |
| A75 | passed | specs/comet-plugin-runtime/spec.md | 重复 eventId 只分发一次；无效 envelope 有来源诊断且不影响其他插件。 | 跨进程 claim/lease 防止同一 episode 重复消费。 |
| A76 | passed | specs/comet-plugin-runtime/spec.md | 任意插件正文不能绕过 Context Candidate/Context Director 直接进入 Agent prompt。 | Entry Router 使用统一事件与 Context 投递。 |
| A77 | passed | specs/comet-plugin-runtime/spec.md | 停用/卸载后不接收事件或 Context，请求失败不影响 Native/Classic 和其他插件。 | Hook 与无 Hook task 路径共享 Context Director。 |
| A78 | passed | specs/context-injection/spec.md | Context Director 将 Personal Memory、Project Model 和 Project Policy 统一选择为紧凑、可解释、可按需展开的 Agent Context。它减少常驻上下文，同时保证核心用户画像和会改变当前任务行为的关键策略及时可见。 | workflow 失败不因学习失败而阻塞。 |
| A79 | passed | specs/context-injection/spec.md | Plugin Runtime 不再只接收任意完整文本，而是接收结构化 Context Candidate：稳定 ID、owner、memory type、state、title、summary、可选 content、selectors、source refs、verification、priority 和 match reasons。第三方插件可以提供同一公开结构，不获得第一方私有入口。 | CLI 与 Dashboard 使用相同 Plugin capability。 |
| A80 | passed | specs/context-injection/spec.md | Context Director 根据当前 task、project、path、operation、phase 和本会话 application ledger 做确定性过滤与排序，然后生成： | Remote Provider 不回退 Local 且请求有界。 |
| A81 | passed | specs/context-injection/spec.md | `core_memory`：完整 Core Profile； | Context XML 转义、预算和降级路径通过契约。 |
| A82 | passed | specs/context-injection/spec.md | `active_policies`：当前任务直接相关的 proven/enforced Collaboration Policy 与 Project Policy； | session continuation 与 episode identity 保持稳定。 |
| A83 | passed | specs/context-injection/spec.md | `context_manifest`：其余相关 Unit 的 ID、标题、摘要、来源类型和 whyApplied； | Hook stdout/协议不被学习诊断污染。 |
| A84 | passed | specs/context-injection/spec.md | `expand_hint`：宿主/Skill 可调用的稳定展开方式。 | Context application ledger 持久化且可按 candidate 查询。 |
| A85 | passed | specs/context-injection/spec.md | 输出使用单一 `<agent_context>` 根元素，并对所有用户/项目正文执行 XML 文本转义。未知插件内容只有转换为合法 Candidate 后才能进入 Manifest，不直接拼接任意提示词。 | application outcome 事件可重放且不重复追加。 |
| A86 | passed | specs/context-injection/spec.md | Core Profile 和会直接改变当前任务处理方式的少量 proven/enforced Policy 可以完整注入。Project Model、trial Unit、Episode、Procedure 和长证据默认只进入 Manifest。Agent 使用稳定 ID 调用 Context Director expand，取得完整正文、whyApplied、来源和验证方式。 | Project/Personal scope 传播与 project identity 校验通过。 |
| A87 | passed | specs/context-injection/spec.md | Provider 存储与 Reflection 不受上下文预算限制。配置中的字符预算只约束一次 `<agent_context>`；超出时内容降级为 Manifest item，不拒绝写入、不截断权威 Record，也不抛 Review Packet byte budget 错误。 | Plugin Runtime 公开第三方可用的最小接口。 |
| A88 | passed | specs/context-injection/spec.md | 任务开始时生成初始 Context。目标 path、operation 或 phase 首次明确或发生变化时，Context Director 可以增量重新选择；同一会话中内容、selector 和来源未变化的 Unit 不重复投递。 | enforced 验证、容量边界和降级路径有源码及契约覆盖。 |
| A89 | passed | specs/context-injection/spec.md | 支持 Hook 的宿主通过唯一 Comet Hook Router 请求并投递 Context；只有存在有效 `.comet/config.yaml` 的项目启用。无 Hook 但有宿主 Rule 时，Rule 只告诉 Agent 如何调用同一选择器；两者均不可用时，Comet Skill/`comet task` 使用同一接口。 | authority 与 Context 优先级表达一致。 |
| A90 | passed | specs/context-injection/spec.md | CLI 提供任务 Context 请求和按 ID expand。JSON 输出同时返回结构化 Manifest 和渲染后的 Agent 文本，方便宿主直接消费。 | Manifest 仅注入有界摘要并提供稳定 expand hint。 |
| A91 | passed | specs/context-injection/spec.md | 每个被选择 Unit 都带 `whyApplied`，由匹配的 project、path、operation、phase、明确用户偏好、来源和历史成功应用生成，不使用模型自由编造理由。 | 候选正文与 Manifest 摘要分离。 |
| A92 | passed | specs/context-injection/spec.md | 实际投递生成 `applicationId` 并发送 `context.applied`。任务完成时，宿主/Skill 发送 `context.outcome`，至少表达 used-successfully、ignored、overridden、corrected 或 contributed-to-failure。该反馈进入 Agent Learning Loop，影响后续状态和排序。 | 选择原因在应用记录和 Dashboard 可见。 |
| A93 | passed | specs/context-injection/spec.md | 普通成功应用保持静默；只有内容第一次改变处理方式、发生冲突、触发确定性检查或用户查看详情时展示 whyApplied。Dashboard 在个人记忆和项目知识中心提供当前 Manifest 预览，可展开完整 application history；普通 Agent 文本不显示内部评分。 | 完整 application history 已进入插件载荷、Provider 查询与 Dashboard inspector。 |
| A94 | passed | specs/context-injection/spec.md | Context Director 强制以下优先级：当前系统和用户请求、当前代码/config/test、proven/enforced Project Policy、Project Model、explicit/proven Personal Memory、trial Unit 和历史 Episode。低层内容不能通过数量覆盖高层内容。 | Context outcome 反馈连接到统一 Experience Journal。 |
| A95 | passed | specs/context-injection/spec.md | 某个 Provider 查询或 expand 失败时，其他插件 Context 和 workflow 继续；失败项不进入输出并产生有界诊断。Hook 失败时不阻断工具调用；Skill/CLI 仍可手动请求。空 Context 不输出空标签。 | Manifest 预览展示应用原因、来源和更新时间。 |
| A96 | passed | specs/context-injection/spec.md | 新任务得到 Core Profile、关键策略和 Manifest，而不是全部记忆与项目知识正文。 | 序列化后 XML 总预算检查及超预算降级契约通过。 |
| A97 | passed | specs/context-injection/spec.md | 路径从 `app/` 切换到 `domains/` 后新增对应路径策略，未变化内容不重复。 | Context candidate 排序结合相关性、selector、状态和历史效果。 |
| A98 | passed | specs/context-injection/spec.md | expand 返回正文、来源、验证方式和与 Manifest 一致的 whyApplied。 | 同一会话未变化内容不重复投递。 |
| A99 | passed | specs/context-injection/spec.md | 字符预算不足时长内容变为 Manifest item，写入和 Reflection 仍成功。 | Hook Router 仅投递一个统一 Context Manifest。 |
| A100 | passed | specs/context-injection/spec.md | Hook、Rule fallback 和 Skill/CLI 生成相同选择结果；未知项目安静跳过。 | Hook session 与 OMP stdout 协议测试通过。 |
| A101 | passed | specs/context-injection/spec.md | Application outcome 能在下一任务改变排序或推进/废弃 trial Unit。 | 无 Hook Skill/task 提供相同行为和 expand 入口。 |
| A102 | passed | specs/personal-memory/spec.md | Personal Memory 是默认安装、可独立停用或卸载的第一方用户级插件。它只学习当前用户未来任务仍有帮助的事实、偏好和协作方式，不保存仓库公共事实，也不自动产生团队 Project Policy。插件失败或停用时 workflow 继续。 | Context failure 不阻塞 Native/Classic workflow。 |
| A103 | passed | specs/personal-memory/spec.md | Personal Memory 使用三层 Agent 记忆： | 插件缺失或不兼容时其他插件继续工作。 |
| A104 | passed | specs/personal-memory/spec.md | **Core Profile**：姓名、角色、语言、技术背景、沟通与输出偏好等稳定语义记忆； | Runtime 诊断有界且按插件隔离。 |
| A105 | passed | specs/personal-memory/spec.md | **Collaboration Policy**：按项目、路径、任务类型、操作和阶段匹配的程序性个人协作策略； | Personal Memory 记录、查询、候选和 selector 已支持 phase。 |
| A106 | passed | specs/personal-memory/spec.md | **Personal Episode**：能够解释一次成功、纠正或失败的紧凑情景记录，只用于 Reflection 或按需展开。 | Memory lifecycle 与 scope/authority 校验通过。 |
| A107 | passed | specs/personal-memory/spec.md | 三层共享同一 Provider 中的规范化来源，不维护互相漂移的副本。Core Profile 与关键 Collaboration Policy 可以直接注入；其他内容进入 Context Manifest。 | Personal Memory explicit remember/correct/forget 路径保持原子。 |
| A108 | passed | specs/personal-memory/spec.md | `user.signal` 中明确表达的长期偏好、记住、纠正或遗忘是 explicit，一次即可 proven。明确仅限“这次”“当前任务”的要求只作用于当前请求，不写入长期记忆。 | 语义审查失败时显式记忆具有确定性回退。 |
| A109 | passed | specs/personal-memory/spec.md | 任务完成时，Agent Learning Loop 可以从用户选择、纠正和结果中形成 inferred Personal Episode 或 Collaboration Policy。一次可信、可复用推断进入 trial 并允许低优先级召回；一次成功应用后 proven。Agent 自己的计划、测试数量、Change 状态、提交摘要、CLI 输出和容易从仓库重新发现的事实不得成为 Personal Memory。 | 一次性要求过滤与长期偏好识别契约通过。 |
| A110 | passed | specs/personal-memory/spec.md | 用户纠正立即产生新版本并 supersede 冲突旧版本。显式内容高于推断内容；更具体项目/路径 selector 高于全局宽泛 selector。遗忘立即停止检索并写 tombstone，旧事件重放不能恢复。 | trial Collaboration Policy 可参与低优先级召回。 |
| A111 | passed | specs/personal-memory/spec.md | Reflection 使用 Experience Journal 中的结构化用户 signal、情境、结果和最小 evidence。它按 episode 分块处理，不因 Review Packet 大小拒绝保存。语义 Reflection 暂不可用时，明确用户 signal 仍由确定性路径直接写入。 | 审查器异常不丢弃有效显式偏好。 |
| A112 | passed | specs/personal-memory/spec.md | Personal Memory Record 至少包含稳定 ID、memory type、memory class、scope、project identity、正文、selectors、authority、`trial \| proven \| superseded`、来源、evidence、应用统计和时间。Episode 额外包含 situation、action summary、outcome 和 lesson，不包含隐藏推理。 | MemoryRecord 已包含 phase、authority、evidence 与 selectors。 |
| A113 | passed | specs/personal-memory/spec.md | 领域层继续只依赖： | Memory Provider Local/Remote seam 保持一致。 |
| A114 | passed | specs/personal-memory/spec.md | `query` 支持 profile、task、manifest、expand 和 manage；`apply` 支持 experience delta、remember、correct、forget、rollback 和 feedback。Local 与 Remote 必须通过相同契约测试。 | Personal Memory query 支持 manifest/expand，mutation 支持 experience-delta。 |
| A115 | passed | specs/personal-memory/spec.md | Local Provider 保留 `profile.md`、`projects/<project-key>.md`、用户级 Runtime 和私有 Git 同步。Markdown 是用户可读投影和可重建输入；机器状态可以在升级时重建，不实现未上线旧 schema 迁移。Remote 使用版本化固定 envelope，同一时刻 Local/Remote 严格二选一，失败不静默切换。 | Remote Memory 请求不发送 token 值或完整上下文。 |
| A116 | passed | specs/personal-memory/spec.md | 每个新任务加载 Core Profile 快照。明确语言、沟通方式、禁忌及高复用 Collaboration Policy 可以完整注入；其他匹配记录以 `id/title/summary/whyApplied` 进入 Context Manifest，Agent 按需 expand。 | Memory CLI/Dashboard/Hook 使用同一 Provider capability。 |
| A117 | passed | specs/personal-memory/spec.md | 检索使用 scope、稳定 project identity、task、path、phase、operation、tags 和 application feedback。排序优先当前明确要求、显式 proven、selector 精确匹配、成功复用和来源新鲜度；trial 低于 proven。相同 Record 只出现一次。 | Personal Memory CLI、Provider、候选匹配均保留 phase selector。 |
| A118 | passed | specs/personal-memory/spec.md | 现有 `profile_char_limit` 与 `task_context_char_limit` 改为单次注入预算：超出时内容进入 Manifest，而不是拒绝记住、截断权威记录或产生 byte budget 错误。Provider 存储不设置固定条目数或总容量。 | Core Profile 与 Collaboration Policy 的本地化渲染通过。 |
| A119 | passed | specs/personal-memory/spec.md | 用户级配置继续选择 Provider、Remote endpoint/token env/profile/timeout，以及 Core Profile 和任务上下文注入预算。项目 `.comet/config.yaml` 继续控制 `memory.learning` 和 `memory.retrieval`；关闭学习不删除记录，关闭检索不影响 Dashboard 管理。 | Personal Episode 按 episodeId 隔离并可查询。 |
| A120 | passed | specs/personal-memory/spec.md | CLI、Dashboard、Skill 和 Hook 读写同一领域状态。Dashboard 中心区不重复渲染与侧边栏相同的大标题，而是直接提供 Core Profile、Collaboration Policy、Personal Episode 和历史/遗忘视图；显示 trial/proven/superseded、证据摘要、whyApplied、最近应用结果和作用范围，并支持新增、纠正、遗忘、回滚和 expand。页面同时提供当前 Context Manifest 预览，便于解释下一任务会应用什么。后台 Reflection 不阻塞首屏，页面先显示缓存快照再刷新。 | Dashboard 展示当前 Manifest 与最近应用结果。 |
| A121 | passed | specs/personal-memory/spec.md | 统一设置面板只提供 Provider、学习、检索、同步和单次注入预算。预算文案必须表达“一次注入可常驻多少上下文”，不得表达为记忆总量、Review Packet 大小或保存上限。 | Memory feedback 改变状态和后续排序。 |
| A122 | passed | specs/personal-memory/spec.md | 显式操作成功后给出简短确认；后台形成默认静默。只有记忆第一次实际改变处理方式、与当前要求冲突或被用户纠正时显示必要原因，不在普通回复中泄露机器 envelope。 | 用户纠正 supersede 旧内容且正文不被自动覆盖。 |
| A123 | passed | specs/personal-memory/spec.md | 当前用户请求和系统约束始终高于 Personal Memory。Project Policy 高于个人项目习惯；Personal Memory 不授权提交、推送、删除或发布。个人 project scope 记录不会自动共享到 Project Knowledge；如用户明确共享，由 Project Knowledge 重新核对来源并创建自己的记录。 | Memory scope 不授权提交、推送、删除或发布。 |
| A124 | passed | specs/personal-memory/spec.md | 自动内容使用当前 workflow 配置语言；用户原文保持原语言。插件停用时不调用 Provider、不学习、不检索；卸载不自动删除数据。 | 自动内容使用 workflow 语言，用户原文保持原语言。 |
| A125 | passed | specs/personal-memory/spec.md | 显式 remember/correct/forget/rollback/expand 和 Provider 配置失败必须返回真实错误并保持原状态。后台 capture、Reflection、feedback 或检索失败只记录诊断，当前 workflow 继续。Remote 不可达时不回退 Local，Local Git 同步失败不阻止当前本地读取。 | 显式操作失败保持原状态；后台失败只记录诊断。 |
| A126 | passed | specs/personal-memory/spec.md | “以后都用中文回答”立即 proven，并在下一任务 Core Profile 生效；“这次只列三条”不持久化。 | 中文偏好立即 proven，一次性要求不持久化。 |
| A127 | passed | specs/personal-memory/spec.md | 一次用户对 Agent 协作方式的纠正形成 trial Collaboration Policy；下一相关任务成功使用后 proven。 | 协作纠正形成 trial Policy，成功使用后 proven。 |
| A128 | passed | specs/personal-memory/spec.md | 用户再次否定该策略时，新内容 supersede 旧内容，后续 Context Manifest 解释新内容的应用原因。 | 再次否定生成 supersede，Manifest 解释新内容原因。 |
| A129 | passed | specs/personal-memory/spec.md | 大量有效用户信号被分块 Reflection，不出现 Review Packet byte budget 错误。 | 大量用户信号分块 Reflection，不触发 Review Packet byte budget。 |
| A130 | passed | specs/personal-memory/spec.md | 同一仓库 worktree 共享 project-scope 个人记忆，不同 repository identity 隔离。 | 同 repository worktree 共享 project-scope memory，不同 identity 隔离。 |
| A131 | passed | specs/personal-memory/spec.md | Local/Remote、CLI/Dashboard/Hook/Skill 和 formation/retrieval Eval 返回一致状态。 | Local/Remote、CLI/Dashboard/Hook/Skill 与 formation/retrieval Eval 语义一致。 |
| A132 | passed | specs/project-knowledge/spec.md | `comet.project-knowledge` 是 project-scope 第一方插件，为 Agent 提供当前项目的可追溯语义知识和程序性策略。用户仍通过一个“项目知识”中心管理该能力，内部明确分为： | Project Knowledge 作为 project-scope 第一方插件并分 Model/Policy。 |
| A133 | passed | specs/project-knowledge/spec.md | **Project Model**：topology、fact、dependency 等“项目是什么”的语义记忆； | Project Model 支持 topology/fact/dependency。 |
| A134 | passed | specs/project-knowledge/spec.md | **Project Policy**：decision、pattern、procedure、constraint、failure-resolution 等“以后怎样做”的程序性记忆。 | Project Policy 支持 decision/pattern/procedure/constraint/failure-resolution。 |
| A135 | passed | specs/project-knowledge/spec.md | Project Knowledge/Policy 不能覆盖当前用户请求、系统约束、当前源码、配置和测试。Personal Memory 使用独立 Provider、存储和作用域；同一 Experience 可以被两个 Learner 消费，但个人记录不会直接复制为项目记录。 | Project Knowledge 不覆盖用户、系统、源码、配置、测试或 Personal Memory。 |
| A136 | passed | specs/project-knowledge/spec.md | 规范化 Record 至少包含稳定 ID、repository/project ID、kind、标题、摘要、适用路径/操作/阶段、结论、关系、来源、来源版本、验证方式、authority、`trial \| proven \| enforced \| superseded`、application 统计和更新时间。 | Record 含稳定 identity、kind、selectors、来源、验证、authority、state、application。 |
| A137 | passed | specs/project-knowledge/spec.md | Project Model kind 为 `topology \| fact \| dependency`。Project Policy kind 为 `decision \| pattern \| procedure \| constraint \| failure-resolution`。authority 为 `automatic \| user \| repository`。 | Model/Policy kind 与 authority 枚举完整。 |
| A138 | passed | specs/project-knowledge/spec.md | 用户明确项目约定和已有 Agent 指令属于 proven；从当前 manifest、配置、源码结构和验证结果确定性提取的 Project Model 直接 proven；单次可信语义推断进入 trial。trial 成功应用一次后 proven；只有绑定当前存在且成功执行的确定性验证命令的 constraint 才可以 enforced。 | Project Model 确定性 proven、推断 trial、成功晋升及 enforced 约束已实现。 |
| A139 | passed | specs/project-knowledge/spec.md | 更高优先级决定、来源失效或负面 application outcome 会 supersede Record。相同语义 identity 更新现有 Record，不创建近义重复。用户明确纠正的正文不能被自动内容覆盖。 | 高优先级、来源失效和负反馈 supersede；同 identity 更新。 |
| A140 | passed | specs/project-knowledge/spec.md | Project Model Builder 消费 `repository.changed`、结构化 `verification.completed` 和 `change.archived`，结合内置 corpus、用户配置的 `knowledge.local.include` Markdown glob、manifest、配置和有限源码关系更新项目模型。 | Model Builder 消费 repository.changed、verification.completed、change.archived 与自定义 corpus。 |
| A141 | passed | specs/project-knowledge/spec.md | Project Policy Learner 消费： | Project Policy Learner 事件订阅与 delta 应用已实现。 |
| A142 | passed | specs/project-knowledge/spec.md | `review.resolved`：形成已接受的 decision 或 constraint； | review.resolved 形成 decision/constraint。 |
| A143 | passed | specs/project-knowledge/spec.md | `failure.resolved`：形成失败情境、根因、修复和复验的 failure-resolution； | failure.resolved 形成 failure-resolution。 |
| A144 | passed | specs/project-knowledge/spec.md | `verification.completed`：把成功命令连接为验证方式，并校准相关 Policy； | verification.completed 连接成功命令并校准 Policy。 |
| A145 | passed | specs/project-knowledge/spec.md | `change.archived`：提取最终决策、稳定模式、Procedure 和废弃项； | change.archived 提取最终决定、模式、Procedure 与废弃项。 |
| A146 | passed | specs/project-knowledge/spec.md | `context.outcome`：根据后续使用效果强化、改写或 supersede trial Policy。 | context.outcome 强化、改写或 supersede trial Policy。 |
| A147 | passed | specs/project-knowledge/spec.md | Reflection 输入按 episode、changed paths 和 evidence 分块；来源在写入前重新核对。语义 reviewer 不可用时，确定性 Project Model 和验证关联继续工作，语义 Policy 延后处理，不阻塞 workflow。 | Project Knowledge reviewer 不可用时仍返回并 Consolidate 确定性 Project Model/verification Deltas，同时标记 deferred；owner 不完成、Journal pending，恢复后重放语义 Policy，稳定 Delta key 防重复。 |
| A148 | passed | specs/project-knowledge/spec.md | Policy Compiler 把 Project Policy 转换为三类 activation： | Policy Compiler 输出三类 activation。 |
| A149 | passed | specs/project-knowledge/spec.md | `context`：需要 Agent 判断的 decision、pattern、procedure 或 constraint，通过 Context Manifest/expand 提供； | context activation 通过 Manifest/expand 提供判断型内容。 |
| A150 | passed | specs/project-knowledge/spec.md | `verification`：项目已经存在可运行命令且能够确定性判断成功/失败的 constraint，在相关 phase 作为 enforced 验证入口； | verification activation 仅使用可运行确定性命令。 |
| A151 | passed | specs/project-knowledge/spec.md | `skill-candidate`：跨任务稳定、多步骤、可组合的 procedure，提供候选摘要和证据，但本期不自动创建或覆盖 Skill。 | skill-candidate 仅对已证实、多步骤、重复成功 procedure 生成候选。 |
| A152 | passed | specs/project-knowledge/spec.md | Policy Compiler 不编写通用 linter/compiler/build/CI 配置生成器，也不发明第二套严重级别。若项目已有 ESLint、Maven、Gradle、测试、构建或 CI 命令，沿用其成功/失败和诊断语义。 | 不生成通用 linter/compiler/build/CI 配置，沿用项目命令语义。 |
| A153 | passed | specs/project-knowledge/spec.md | 领域层继续依赖 `status/query/apply` Provider seam。query 支持 search、list、get、manifest 和 expand；apply 支持 upsert、correct、supersede、refresh、experience delta 和 feedback。 | Project Knowledge Provider 支持 manifest/expand 与 experience-delta apply。 |
| A154 | passed | specs/project-knowledge/spec.md | Local Provider 使用用户数据目录中按稳定 repository ID 隔离的 SQLite；Record 是权威机器状态，workspace section/FTS 是可重建读模型。主工作区和 linked worktree 共享 Record，源码与文档索引按 workspace 隔离。当前功能未上线，旧 Record schema 直接重建，不提供状态映射或双读。 | SQLite Record 权威、workspace projection 隔离、repository identity 共享规则已实现。 |
| A155 | passed | specs/project-knowledge/spec.md | Remote 使用版本化固定协议，Local/Remote 严格二选一。Remote 查询只发送有界 task/path/phase/operation 和 ID selector；apply 只发送规范化 Record/evidence，不发送完整仓库、完整 diff、日志、Personal Memory 或凭据。Remote 失败不回退 Local。 | Local/Remote 严格二选一，Remote 请求有界且失败不回退。 |
| A156 | passed | specs/project-knowledge/spec.md | 所有 Record 注入前核对 project-relative source、anchor、digest 或版本。来源变化、命令消失或 selector 不再成立时，旧 Record superseded 并从 Context Manifest 排除；新证据形成新版本。 | 注入前核对 source/anchor/digest/version，失效 Record 排除。 |
| A157 | passed | specs/project-knowledge/spec.md | 检索先按 project、path、operation、phase、kind 和 state 过滤，再结合 FTS、有限 ripgrep、关系扩展和 application feedback 排序。proven/enforced 高于 trial；当前代码/config/test 高于所有 Record。 | 检索先按 project/path/operation/phase/kind/state 过滤再排序。 |
| A158 | passed | specs/project-knowledge/spec.md | 关键 proven/enforced Project Policy 可以完整注入；Project Model、trial Policy、Procedure 和 Episode 以 `id/title/summary/whyApplied/sourceType` 进入 Context Manifest 并按需 expand。单次注入预算不限制 Provider 总记录数或 Reflection 输入；超出预算只减少常驻正文。 | proven/enforced 完整注入，其他内容以 Manifest 摘要并按需展开。 |
| A159 | passed | specs/project-knowledge/spec.md | CLI 提供 status、list、get/expand、query、correct、forget/supersede、rebuild/refresh 和 application feedback；不恢复旧 `knowledge units` 或旧 Project Rules 数据库命令。 | CLI status/list/get-expand/query/correct/forget-supersede/rebuild-refresh/feedback 已提供。 |
| A160 | passed | specs/project-knowledge/spec.md | Dashboard 在同一项目知识中心直接提供“项目模型”和“项目策略”视图，不重复渲染与侧边栏相同的大标题。项目模型按 topology/fact/dependency 浏览；项目策略按 decision/pattern/procedure/constraint/failure-resolution 浏览，并展示 trial/proven/enforced/superseded、作用范围、来源、验证方式、whyApplied、最近应用结果和更新时间。页面同时提供当前 Context Manifest 预览。用户可以手动新增知识或策略、纠正、废弃、展开来源和刷新。后台学习不阻塞首屏，页面优先显示缓存 snapshot。 | Dashboard 项目模型/策略视图、状态、来源、Manifest、应用历史和管理动作已覆盖。 |
| A161 | passed | specs/project-knowledge/spec.md | Project Policy 的 Dashboard 状态是领域状态，不是另一份规则源。用户在仓库维护的 AGENTS/Rule 文件和现有检查仍是高优先级项目证据；插件只建立可检索模型和 activation，不静默改写这些文件。 | Project Policy 是领域状态，不改写 AGENTS/Rule/检查文件。 |
| A162 | passed | specs/project-knowledge/spec.md | 查询失败时任务继续且不注入项目上下文；apply/correct/supersede 失败时保持原状态；Local 索引损坏时重建 FTS 或使用有限 ripgrep；来源不可读时停止注入；插件停用或卸载后不学习、不查询、不运行验证、不打开 SQLite、不发送网络请求。 | 查询/apply/索引/来源/停用失败均安全降级且不阻塞 workflow。 |
| A163 | passed | specs/project-knowledge/spec.md | 项目首次使用时，Project Model 从 manifest、配置、目录和自定义 Markdown corpus 生成 proven topology/fact/dependency。 | 首次使用 bootstrap 生成 proven topology/fact/dependency。 |
| A164 | passed | specs/project-knowledge/spec.md | Review 中确认“domains 不得直接访问文件系统”并在后续 Change 实施后，系统形成 trial constraint；成功应用后 proven，若已有 architecture check 命令则可 enforced。 | Review 确认的 architecture 约定形成 trial，成功应用后 proven/enforced。 |
| A165 | passed | specs/project-knowledge/spec.md | 一次失败命令、明确根因、修复和成功复验形成 failure-resolution；下一相关任务通过 Manifest 找到并展开。 | 失败命令、根因、修复、复验形成可展开 failure-resolution。 |
| A166 | passed | specs/project-knowledge/spec.md | Archive 的最终决定 supersede 旧设计结论，旧 Record 不再注入。 | Archive 最终决定 supersede 旧设计结论。 |
| A167 | passed | specs/project-knowledge/spec.md | 来源文件变化后旧 Model/Policy 立即失效，刷新后产生新版本。 | 来源变化立即使旧 Model/Policy 失效，刷新产生新版本。 |
| A168 | passed | specs/project-knowledge/spec.md | Local/Remote Provider、CLI/Dashboard、Learning Eval、Retrieval Eval 和 Classic/Native 集成返回一致语义。 | Local/Remote、CLI/Dashboard、Learning/Retrieval Eval 与 Classic/Native 集成契约及生成物检查通过。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Repository format check | format:check | . | passed | 0 | 17156 ms |
| TypeScript no-emit check | exec tsc --noEmit | . | passed | 0 | 8415 ms |
| Generated Runtime asset consistency | check:generated | . | passed | 0 | 1937 ms |
| Deferred semantic Reflection contracts | exec vitest run test/domains/agent-learning/agent-learning.test.ts test/domains/comet-plugin/plugin-runtime.test.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/project-knowledge/project-knowledge-learning.test.ts test/domains/project-knowledge/project-knowledge.test.ts test/domains/comet-memory/personal-memory.test.ts test/domains/comet-memory/review-contract.test.ts | . | passed | 0 | 29605 ms |
| Dashboard browser contracts | test:dashboard-e2e | . | passed | 0 | 27869 ms |
| Git whitespace check | diff --check | . | passed | 0 | 313 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- Remote Provider 仅完成固定契约覆盖，未连接真实外部服务做端到端验证。
- 检索按产品决定使用确定性 FTS、有限 ripgrep 与结构化排序，不包含向量检索；这属于明确非目标。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A2, A4, A7, A8, A10, A14, A18, A41, A42, A44, A57, A59, A60, A63, A74, A88, A89, A93, A96, A100, A108, A111, A120, A126, A131, A136, A140, A147, A151, A157, A159, A160, A163, A168 | 独立验收失败：134 项通过，34 项未通过，需要返回 Build 修正后重新验收。 | 2026-08-24T15:21:33.519Z |
| 1 | 2 | 1 | fail | A2, A13, A44, A61, A64, A75, A93, A105, A112, A114, A117, A131, A153, A168 | 第 2 轮独立语义验收结论为 fail。A1-A168 已各判定一次：154 项 passed，14 项 failed，无 blocked。上一轮多数缺陷已修复，包括 schema 重建、observe 落盘、项目 selector 过滤、Journal 重放与追加锁、真实项目事件、enforced 验证、XML 预算、tombstone、Hook session/stdout、Dashboard Manifest 和项目模型 bootstrap；当前阻断项为 A2、A13、A44、A61、A64、A75、A93、A105、A112、A114、A117、A131、A153、A168，其中正式 generated-runtime-check 的 stale Entry bundle 单独已足以阻止通过。 | 2026-08-24T16:49:41.744Z |
| 1 | 3 | 1 | recovery | — | Verifier review found event-loss, idempotency, project-scope, outcome-revision, persistence, expansion, and Dashboard history gaps; return to Build for corrections. | 2026-08-24T18:03:21.951Z |
| 1 | 4 | 1 | fail | A4, A48, A52, A57, A75, A91, A106, A109, A112, A117, A157 | 独立核对 A1-A168：157 项 passed，11 项 failed，0 项 blocked；自动化检查均通过，但正式语义仍有五类缺口。 | 2026-08-24T20:58:16.078Z |
| 1 | 5 | 1 | pass | — | 独立只读验收通过：A1-A168 均逐项核对且恰好判定一次。重点复核的 A4、A48、A52、A57、A75、A91、A106、A109、A112、A117、A157 均已由当前源码和新增回归测试闭环；Dashboard 已展示持久化产生的真实 whyApplied、delivery level、可展开完整 application history、Context Manifest 以及包含 situation/actionSummary/outcome/lesson 的结构化 Episode。另独立运行两组最小相关测试，共 10 个文件、207 项全部通过；结合 Builder 提供的全量测试、lint、build、format、Dashboard E2E、生成物及 diff 检查通过证据，本轮无阻断缺口。 | 2026-08-24T22:25:21.706Z |
| 1 | 5 | 1 | recovery | — | Local Runtime was unavailable at Archive ready; the synchronized implementation must be verified again. | 2026-08-24T22:54:39.433Z |
| 1 | 5 | 1 | recovery | — | Independent code review found post-verification implementation changes: make background Reflection non-blocking, move Native and Classic experience parsing into their domains, update user operation guides, and remove unrelated source-coverage scope creep. | 2026-08-24T22:54:47.669Z |
| 1 | 6 | 1 | fail | A45, A147 | 第 6 轮独立语义验收未通过。A1-A168 恰好各判定一次：166 passed、2 failed、0 blocked。失败项 A45、A147：reviewer 异常不阻塞 workflow 且确定性学习继续，但 owner 随后被完成，语义泛化/Project Policy 永久跳过而非延后重放。A42、domain 边界、Dashboard A18/A120/A160、双语操作文档和 Native source-document full-coverage 均通过。 | 2026-08-25T00:26:32.134Z |
| 1 | 7 | 1 | pass | — | 第 7 轮全新独立只读验收通过。A1-A168 恰好各判定一次：168 passed、0 failed、0 blocked。重点复核 A45/A147：确定性 Delta 会在语义 reviewer 不可用时持久 Consolidate，但 owner 不完成，Journal 保持 pending 并在恢复后重放；稳定语义 idempotency key 避免确定性结果重复计数。A42 非阻塞未回退，Personal Memory 显式长期 user.signal 仍同步走确定性 fallback。正式 Runtime checks 6/6、相关 7 文件 183 tests、Dashboard E2E 29/29、最终全量 4254 passed/57 skipped/0 failed，以及 build/lint/format/tsc/generated/diff 均通过。 | 2026-08-25T01:02:40.515Z |



## 结论

第 7 轮全新独立只读验收通过。A1-A168 恰好各判定一次：168 passed、0 failed、0 blocked。重点复核 A45/A147：确定性 Delta 会在语义 reviewer 不可用时持久 Consolidate，但 owner 不完成，Journal 保持 pending 并在恢复后重放；稳定语义 idempotency key 避免确定性结果重复计数。A42 非阻塞未回退，Personal Memory 显式长期 user.signal 仍同步走确定性 fallback。正式 Runtime checks 6/6、相关 7 文件 183 tests、Dashboard E2E 29/29、最终全量 4254 passed/57 skipped/0 failed，以及 build/lint/format/tsc/generated/diff 均通过。
