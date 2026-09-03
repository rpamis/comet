# Agent Learning Loop

## Purpose

Comet 提供一条宿主无关的 Agent Learning Loop，把用户信号、任务经历、工具和验证结果、Review 结论、Change 归档及上下文使用结果转换为可持续复用的语义记忆和程序性策略。该能力由公开 Plugin Runtime 接口承载，Classic、Native、Hotfix、Tweak、Dashboard 和 CLI 不实现各自的学习状态机。

学习循环为：`Experience → Reflection → Consolidation → Activation → Outcome Feedback`。系统只有在形成或更新 Learning Unit 后才称为“学到了内容”；接收、排队或处理过事件不能冒充学习结果。

## Experience Event and production entry

公开事件使用版本化 `comet.agent-experience.v1` envelope，至少包含：

- 稳定 `eventId`、`episodeId`、时间和事件类型；
- `actor`: `user | agent | tool | workflow | repository`；
- `scope`: `user | project`，以及稳定 project identity；
- task、workflow、change、phase、路径和操作等 context；
- 可选明确用户 signal；
- 有类型、引用、摘要和成功状态的 evidence；
- 可选 outcome 与前因/替代关系。

支持事件：

- `user.signal`：明确长期偏好、纠正、接受、否定或遗忘；
- `episode.completed`：一次可评价任务经历完成；
- `verification.completed`：项目验证入口得到结构化结果；
- `review.resolved`：Review 结论已经接受并处理；
- `failure.resolved`：失败、根因、修复和成功复验形成闭环；
- `change.archived`：Change 的最终决策、变更和验证已稳定；
- `repository.changed`：知识来源版本发生变化；
- `context.applied` 与 `context.outcome`：学习内容被选择以及后续效果。

公共 Comet Entry/Plugin Bridge 必须提供生产可调用的结构化 capture 边界，并由 Skills、CLI、Dashboard 和 workflow completion 统一使用：

- 明确长期用户意图用 `user.signal` 和 user actor 记录；
- 未明确长期意图但可复用的协作方式用有用户 evidence 的 observation/episode 记录；
- Review、失败、验证和 Archive 分别使用对应事件，不能全部压成无语义的 `episode.completed`；
- 任务结束只登记真实发生的事件，不能从任务摘要臆造用户信号或策略。

事件不保存完整聊天、完整 diff、原始日志或隐藏推理。Evidence 使用 project-relative source、anchor、digest、命令摘要和结构化结果，使 Learner 可以核对但不复制无边界正文。

### Scenario: 生产入口保留真实事件语义

- **Given** 一个任务包含明确长期用户偏好、已接受 Review 和成功验证
- **When** 正常 Comet 入口完成任务
- **Then** Journal 分别收到 user actor 的 `user.signal`、`review.resolved` 和 `verification.completed`
- **And** 不得仅写一条 workflow actor 的泛化 `episode.completed` 代替这些事件

## Experience Journal and reflection queue

Experience Journal 是 append-only、可重放、按用户与项目隔离的机器状态。`eventId` 全局幂等；相同 episode 的恢复、重试、重复验证和跨会话继续合并到同一 episode。Journal 可按 evidence digest 识别重复来源，并保留 Unit 所需的最小来源链。

Journal 写入是快速路径，不调用语义模型。显式 `user.signal` 可以同步触发确定性更新；任务结束、验证、Review、Archive 和批量模式分析进入后台 Reflection 队列。队列记录 `pending | running | deferred | completed | failed`、最近尝试、结果数量和诊断。`completed` 表示 Learner 已完成处理，不等于一定创建了 Unit；noop/跳过必须保留原因。

队列失败不阻塞 workflow，并允许按 episode 幂等重放。Journal 不设置用户可见总容量；实现可以压缩已经 Consolidate 的旧 episode，但必须保留活跃 Unit 使用的证据引用和 application outcome。

### Scenario: 已处理与已学习分开统计

- **Given** 一个事件因一次性指令、证据不足或内容重复而产生 noop
- **When** Learner 完成处理
- **Then** 事件可以标记 completed，但新增/更新 Unit 数量为零
- **And** Dashboard 显示真实跳过原因，不把它计入“学到了”

## Reflection and Consolidation

Reflection 接收一个或多个相关 episode，输出结构化 Learning Delta：`create | update | supersede | forget | noop`。每个 Delta 指定 owner、memory type、kind、statement、applicability、evidence 和推荐初始状态。

Reflection 输入按 episode 和 evidence 自动分块；大输入通过多批提取后再 Consolidate，不允许因为固定字节预算拒绝有效学习。语义 reviewer 由宿主通过正式 Plugin Bridge 注入；生产入口和 Dashboard 后台使用同一 adapter。

语义 reviewer 不可用时，确定性显式信号、仓库事实和验证结果仍能形成 Delta；只有需要语义泛化的内容进入 deferred 并可重试。系统不得静默丢弃事件或生成泛化占位 Unit。

Consolidation 合并同义 Unit、保留更具体 selector、连接新 evidence、识别 supersedes，并按以下优先级解决冲突：当前明确用户/团队决定、当前确定性项目事实和检查、范围更具体的 proven 内容、最近成功应用、trial 推断。稳定逻辑 identity 和规范化 statement 决定更新，不使用时间戳生成近义副本。

### Scenario: reviewer 恢复后重放延迟学习

- **Given** 语义 reviewer 不可用期间积累了 deferred episode
- **When** reviewer 恢复并触发重试
- **Then** 系统按原 eventId/episodeId 幂等反思并 Consolidate
- **And** 每个 episode 形成 Delta 或明确 noop
- **And** 重试不会重复创建同一 Learning Unit

## Learning Unit lifecycle

所有 Learner 共享最小 lifecycle：

- `trial`：可信但尚未复用验证，允许低优先级召回；
- `proven`：明确用户信号、确定性事实或成功复用支持的稳定内容；
- `enforced`：绑定当前存在并成功执行的确定性验证入口；
- `superseded`：被纠正、来源失效、验证入口消失或被更高优先级 Unit 替代，不再注入。

遗忘使用 tombstone，而不是 lifecycle state，防止旧事件重放恢复已遗忘内容。显式用户信号可以直接 proven；一次可信推断可以直接 trial，不需要 Dashboard 审批；trial 在一次实际成功应用后 proven。只有 Project Policy 可以 enforced。

状态统计统一定义为：有效=`trial + proven + enforced`，候选=`trial`，历史=`superseded`，遗忘保护=`tombstone`。调用方不得自行发明不同计数。

## Activation and application feedback

Context Director 每次选择 Unit 时生成 application record，记录 Unit、任务、路径、phase、选择原因和投递方式。`context.outcome` 至少区分 `used-successfully | ignored | overridden | corrected | contributed-to-failure`。

生产任务入口在上下文选择后保留 application ID，并在任务结果明确时提交实际采用内容的 outcome。未展开、未采用或无法判断的候选保持 unset；unset 不能用于晋升、增加成功权重或计算成功率。成功应用提高复用强度并可推进 trial；忽略只影响排序；被覆盖、纠正或造成失败会降低强度并触发 Reflection。

排序结合当前相关性、selector、authority、来源新鲜度、历史成功复用和负面反馈，不只依赖关键词相似度。Context Manifest 必须解释选择原因，并允许按稳定 ID 展开正文和证据。

### Scenario: 任务只反馈实际采用的上下文

- **Given** Context Director 为任务选择六条候选，但 Agent 只展开并采用两条
- **When** 任务完成并提交 outcome
- **Then** 只有两条实际采用记录获得对应结果
- **And** 其他四条保持 unset
- **And** 统计同时显示总应用、已反馈和未反馈，不把未反馈算作成功

### Scenario: 负面反馈改变生命周期

- **Given** 一条 trial 或 proven Unit 被用户纠正或导致失败
- **When** 系统收到 `corrected` 或 `contributed-to-failure`
- **Then** Reflection 更新、降权或 supersede 原 Unit
- **And** 后续检索不再以原强度提供冲突内容

## Interfaces and ownership

共享领域提供小接口：

```ts
interface AgentLearningCoordinator {
  capture(event: AgentExperienceEvent): Promise<CaptureResult>;
  reflect(request: ReflectionRequest): Promise<LearningDelta[]>;
  consolidate(deltas: readonly LearningDelta[]): Promise<ConsolidationResult>;
  feedback(outcome: ContextOutcome): Promise<void>;
}
```

Personal Memory Learner 与 Project Knowledge Learner 是独立 adapter。它们可以消费同一 Experience，但独立决定、存储和检索，不能直接复制彼此的 Unit。Plugin Runtime 只负责事件分发、作用域、隔离、队列状态和诊断，不理解专有 Memory/Knowledge schema。

Dashboard、CLI 与任务上下文读取同一 Runtime/Learner 快照。快照至少区分事件接收、待处理、延迟、失败、noop、新建/更新 Unit 和 application feedback 覆盖率。

## Failure behavior

Journal 写入、后台 Reflection 或某个 Learner 失败时，其他 Learner 和 workflow 继续。显式用户管理操作失败必须返回错误且保持原状态。无效事件 envelope 被拒绝并带来源诊断；未知事件可以被不订阅它的插件忽略。

Remote 或语义 reviewer 失败不能静默改用另一 Provider，也不能将失败标记为 completed/success。恢复后可以按稳定事件重放，不要求用户重新描述原始内容。

## Verification and evaluation

验证必须覆盖真实生产边界，而不只覆盖手工构造的领域事件：

- 通过 Comet Entry/Skill/CLI 输入显式长期偏好，确认 Journal、Personal Memory、下一任务 Activation 和 feedback 全链路；
- 通过真实 Review、失败解决、验证和 Archive completion 形成 Project Policy，确认 reviewer 生产注入和 deferred 重试；
- 运行多任务 fixture，覆盖 `signal → trial/proven → context.applied → context.outcome → promotion/correction/supersede`；
- 实际执行固定检索数据集并核对结果，输出 Recall@k、nDCG@k 或等价排序指标、重复率、失效来源命中率和反馈覆盖率；
- A/B 评估必须通过真实 Context Director/Provider 路径产生 trace，不能只对两个硬编码数组运行汇总函数。

### Scenario: 真实端到端评估能发现断链

- **Given** 固定学习与检索案例包含明确预期 Unit、相关来源和结果
- **When** 评估从公共生产入口执行完整任务序列
- **Then** 报告来自实际 Journal、Provider、Context Director 和 outcome 记录
- **And** 任一 capture、formation、retrieval、feedback 或 lifecycle 断链都会使对应场景失败

## Non-goals

- 不保存完整聊天、工具日志、完整 diff、隐藏推理或普通任务流水账。
- 不让 Plugin Runtime 合并 Personal Memory 与 Project Knowledge 的领域 schema。
- 不以模型自评、候选被展示或任务成功本身自动证明某条上下文被成功使用。
