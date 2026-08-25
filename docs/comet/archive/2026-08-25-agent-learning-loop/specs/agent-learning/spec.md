# Agent Learning Loop

## Purpose

Comet 提供一条宿主无关的 Agent Learning Loop，把用户信号、任务经历、工具和验证结果、Review 结论、Change 归档及上下文使用结果转换为可持续复用的语义记忆和程序性策略。该能力由公开 Plugin Runtime 接口承载，Classic、Native、Hotfix、Tweak、Dashboard 和 CLI 不实现各自的学习状态机。

学习循环为：`Experience → Reflection → Consolidation → Activation → Outcome Feedback`。其中 Experience 是情景记忆输入，Consolidation 产生语义或程序性 Learning Unit，Activation 负责按任务加载，Outcome Feedback 反向调整 Unit。

## Experience Event

公开事件使用版本化 `comet.agent-experience.v1` envelope，至少包含：

- 稳定 `eventId`、`episodeId`、时间和事件类型；
- `actor`: `user | agent | tool | workflow | repository`；
- `scope`: `user | project`，以及稳定 project identity；
- task、workflow、change、phase、路径和操作等 context；
- 可选明确用户 signal；
- 有类型、引用、摘要和成功状态的 evidence；
- 可选 outcome 与前因/替代关系。

支持事件：

- `user.signal`：明确偏好、纠正、接受或否定；
- `episode.completed`：一次可评价任务经历完成；
- `verification.completed`：项目验证入口得到结构化结果；
- `review.resolved`：Review 结论已经接受并处理；
- `failure.resolved`：失败、根因、修复和成功复验形成闭环；
- `change.archived`：Change 的最终决策、变更和验证已稳定；
- `repository.changed`：知识来源版本发生变化；
- `context.applied` 与 `context.outcome`：学习内容被选择以及后续效果。

事件不保存完整聊天、完整 diff、原始日志或隐藏推理。Evidence 使用 project-relative source、anchor、digest、命令摘要和结构化结果，使 Learner 可以核对但不复制无边界正文。

## Experience Journal

Experience Journal 是 append-only、可重放、按用户与项目隔离的机器状态。`eventId` 全局幂等；相同 episode 的恢复、重试、重复验证和跨会话继续合并到同一 episode。Journal 可按 evidence digest 识别重复来源，并保留 Unit 所需的最小来源链。

Journal 写入是快速路径，不调用语义模型。显式 `user.signal` 可以同步触发确定性更新；任务结束、验证、Review、Archive 和批量模式分析进入后台 Reflection 队列。队列失败只记录诊断并允许后续重放，不阻塞 workflow。

Journal 不设置用户可见总容量。实现可以压缩已经 Consolidate 的旧 episode，但必须保留活跃 Unit 使用的证据引用和 application outcome。

## Reflection and Consolidation

Reflection 接收一个或多个相关 episode，输出结构化 Learning Delta：`create | update | supersede | forget | noop`。每个 Delta 指定 owner、memory type、kind、statement、applicability、evidence 和推荐初始状态。

Reflection 输入按 episode 和 evidence 自动分块；大输入通过多批提取后再 Consolidate，不允许因为固定字节预算拒绝有效学习。语义 reviewer 不可用时，确定性显式信号、仓库事实和验证结果仍能形成 Delta；只有需要语义泛化的内容延后处理。

Consolidation 合并同义 Unit、保留更具体 selector、连接新 evidence、识别 supersedes，并按以下优先级解决冲突：当前明确用户/团队决定、当前确定性项目事实和检查、范围更具体的 proven 内容、最近成功应用、trial 推断。

## Learning Unit lifecycle

所有 Learner 共享最小 lifecycle：

- `trial`：可信但尚未复用验证，允许低优先级召回；
- `proven`：明确用户信号、确定性事实或成功复用支持的稳定内容；
- `enforced`：绑定当前存在并成功执行的确定性验证入口；
- `superseded`：被纠正、来源失效、验证入口消失或被更高优先级 Unit 替代，不再注入。

遗忘使用 tombstone，而不是 lifecycle state，防止旧事件重放恢复已遗忘内容。显式用户信号可以直接 proven；一次可信推断可以直接 trial，不需要 Dashboard 审批；trial 在一次成功应用后 proven。只有 Project Policy 可以 enforced。

## Application feedback

Context Director 每次选择 Unit 时生成 application record，记录 Unit、任务、路径、phase、选择原因和投递方式。`context.outcome` 至少区分 `used-successfully | ignored | overridden | corrected | contributed-to-failure`。

成功应用提高复用强度并可推进 trial；忽略只影响排序；被覆盖、纠正或造成失败会降低强度并触发 Reflection。排序结合当前相关性、selector、authority、来源新鲜度、历史成功复用和负面反馈，不只依赖关键词相似度。

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

Personal Memory Learner 与 Project Knowledge Learner 是独立 adapter。它们可以消费同一 Experience，但独立决定、存储和检索，不能直接复制彼此的 Unit。Plugin Runtime 只负责事件分发、作用域、隔离和诊断，不理解专有 Memory/Knowledge schema。

## Failure behavior

Journal 写入、后台 Reflection 或某个 Learner 失败时，其他 Learner 和 workflow 继续。显式用户管理操作失败必须返回错误且保持原状态。无效事件 envelope 被拒绝并带来源诊断；未知事件可以被不订阅它的插件忽略。

本能力未上线，旧 `CometLifecycleObservation` 和旧事件 payload 直接删除，不提供双写、别名或迁移。用户可读 Personal Memory Markdown 和项目来源由新 Learner 重建。

## Verification

- 事件 schema、幂等、episode 合并、队列重放和错误隔离具有契约测试。
- 固定 Eval 覆盖显式偏好、一次性要求、隐式纠正、Review 决策、失败解决和 Archive 反思。
- Application feedback 测试证明成功使用能晋升 trial，纠正能 supersede 或改写，重复事件不会重复计数。
