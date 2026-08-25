# Personal Memory

## Product model

Personal Memory 是默认安装、可独立停用或卸载的第一方用户级插件。它只学习当前用户未来任务仍有帮助的事实、偏好和协作方式，不保存仓库公共事实，也不自动产生团队 Project Policy。插件失败或停用时 workflow 继续。

Personal Memory 使用三层 Agent 记忆：

1. **Core Profile**：姓名、角色、语言、技术背景、沟通与输出偏好等稳定语义记忆；
2. **Collaboration Policy**：按项目、路径、任务类型、操作和阶段匹配的程序性个人协作策略；
3. **Personal Episode**：能够解释一次成功、纠正或失败的紧凑情景记录，只用于 Reflection 或按需展开。

三层共享同一 Provider 中的规范化来源，不维护互相漂移的副本。Core Profile 与关键 Collaboration Policy 可以直接注入；其他内容进入 Context Manifest。

## Formation

`user.signal` 中明确表达的长期偏好、记住、纠正或遗忘是 explicit，一次即可 proven。明确仅限“这次”“当前任务”的要求只作用于当前请求，不写入长期记忆。

任务完成时，Agent Learning Loop 可以从用户选择、纠正和结果中形成 inferred Personal Episode 或 Collaboration Policy。一次可信、可复用推断进入 trial 并允许低优先级召回；一次成功应用后 proven。Agent 自己的计划、测试数量、Change 状态、提交摘要、CLI 输出和容易从仓库重新发现的事实不得成为 Personal Memory。

用户纠正立即产生新版本并 supersede 冲突旧版本。显式内容高于推断内容；更具体项目/路径 selector 高于全局宽泛 selector。遗忘立即停止检索并写 tombstone，旧事件重放不能恢复。

Reflection 使用 Experience Journal 中的结构化用户 signal、情境、结果和最小 evidence。它按 episode 分块处理，不因 Review Packet 大小拒绝保存。语义 Reflection 暂不可用时，明确用户 signal 仍由确定性路径直接写入。

## Record and Provider

Personal Memory Record 至少包含稳定 ID、memory type、memory class、scope、project identity、正文、selectors、authority、`trial | proven | superseded`、来源、evidence、应用统计和时间。Episode 额外包含 situation、action summary、outcome 和 lesson，不包含隐藏推理。

领域层继续只依赖：

```ts
interface PersonalMemoryProvider {
  status(): Promise<ProviderStatus>;
  query(request: ProviderQueryRequest): Promise<ProviderQueryResult>;
  apply(mutation: ProviderMutation): Promise<ProviderMutationResult>;
}
```

`query` 支持 profile、task、manifest、expand 和 manage；`apply` 支持 experience delta、remember、correct、forget、rollback 和 feedback。Local 与 Remote 必须通过相同契约测试。

Local Provider 保留 `profile.md`、`projects/<project-key>.md`、用户级 Runtime 和私有 Git 同步。Markdown 是用户可读投影和可重建输入；机器状态可以在升级时重建，不实现未上线旧 schema 迁移。Remote 使用版本化固定 envelope，同一时刻 Local/Remote 严格二选一，失败不静默切换。

## Retrieval and context

每个新任务加载 Core Profile 快照。明确语言、沟通方式、禁忌及高复用 Collaboration Policy 可以完整注入；其他匹配记录以 `id/title/summary/whyApplied` 进入 Context Manifest，Agent 按需 expand。

检索使用 scope、稳定 project identity、task、path、phase、operation、tags 和 application feedback。排序优先当前明确要求、显式 proven、selector 精确匹配、成功复用和来源新鲜度；trial 低于 proven。相同 Record 只出现一次。

现有 `profile_char_limit` 与 `task_context_char_limit` 改为单次注入预算：超出时内容进入 Manifest，而不是拒绝记住、截断权威记录或产生 byte budget 错误。Provider 存储不设置固定条目数或总容量。

## Configuration and management

用户级配置继续选择 Provider、Remote endpoint/token env/profile/timeout，以及 Core Profile 和任务上下文注入预算。项目 `.comet/config.yaml` 继续控制 `memory.learning` 和 `memory.retrieval`；关闭学习不删除记录，关闭检索不影响 Dashboard 管理。

CLI、Dashboard、Skill 和 Hook 读写同一领域状态。Dashboard 中心区不重复渲染与侧边栏相同的大标题，而是直接提供 Core Profile、Collaboration Policy、Personal Episode 和历史/遗忘视图；显示 trial/proven/superseded、证据摘要、whyApplied、最近应用结果和作用范围，并支持新增、纠正、遗忘、回滚和 expand。页面同时提供当前 Context Manifest 预览，便于解释下一任务会应用什么。后台 Reflection 不阻塞首屏，页面先显示缓存快照再刷新。

统一设置面板只提供 Provider、学习、检索、同步和单次注入预算。预算文案必须表达“一次注入可常驻多少上下文”，不得表达为记忆总量、Review Packet 大小或保存上限。

显式操作成功后给出简短确认；后台形成默认静默。只有记忆第一次实际改变处理方式、与当前要求冲突或被用户纠正时显示必要原因，不在普通回复中泄露机器 envelope。

## Priority and boundaries

当前用户请求和系统约束始终高于 Personal Memory。Project Policy 高于个人项目习惯；Personal Memory 不授权提交、推送、删除或发布。个人 project scope 记录不会自动共享到 Project Knowledge；如用户明确共享，由 Project Knowledge 重新核对来源并创建自己的记录。

自动内容使用当前 workflow 配置语言；用户原文保持原语言。插件停用时不调用 Provider、不学习、不检索；卸载不自动删除数据。

## Failure behavior

显式 remember/correct/forget/rollback/expand 和 Provider 配置失败必须返回真实错误并保持原状态。后台 capture、Reflection、feedback 或检索失败只记录诊断，当前 workflow 继续。Remote 不可达时不回退 Local，Local Git 同步失败不阻止当前本地读取。

## Verification scenarios

- “以后都用中文回答”立即 proven，并在下一任务 Core Profile 生效；“这次只列三条”不持久化。
- 一次用户对 Agent 协作方式的纠正形成 trial Collaboration Policy；下一相关任务成功使用后 proven。
- 用户再次否定该策略时，新内容 supersede 旧内容，后续 Context Manifest 解释新内容的应用原因。
- 大量有效用户信号被分块 Reflection，不出现 Review Packet byte budget 错误。
- 同一仓库 worktree 共享 project-scope 个人记忆，不同 repository identity 隔离。
- Local/Remote、CLI/Dashboard/Hook/Skill 和 formation/retrieval Eval 返回一致状态。

## Non-goals

- 不保存完整会话、工具日志、完整 diff、隐藏推理或普通项目事实。
- 不自动修改 Project Knowledge、Project Policy、Specs、linter、测试或 Skill。
- 不实现内置 Mem0 adapter、向量数据库、Provider marketplace、Local/Remote 双写或复杂迁移层。
