# Personal Memory

## Product model

Personal Memory 是默认安装、可独立停用或卸载的第一方用户级插件。它只学习当前用户未来任务仍有帮助的事实、偏好和协作方式，不保存仓库公共事实，也不自动产生团队 Project Policy。插件失败或停用时 workflow 继续。

Personal Memory 使用三层 Agent 记忆：

1. **Core Profile**：姓名、角色、语言、技术背景、沟通与输出偏好等稳定语义记忆；
2. **Collaboration Policy**：按项目、路径、任务类型、操作和阶段匹配的程序性个人协作策略；
3. **Personal Episode**：能够解释一次成功、纠正或失败的紧凑情景记录，只用于 Reflection 或按需展开。

三层共享同一 Provider 中的权威记录，不维护互相漂移的副本。Core Profile 与关键 Collaboration Policy 可以直接注入；其他内容进入 Context Manifest。

## Formation and production capture

所有受支持的 Comet 入口使用同一套用户信号语义：

- 用户明确表达“以后”“一直”“记住”或等价长期意图时，入口调用公开 remember/user-signal 边界，生成 `user.signal`，一次即可形成 proven 记录；
- 用户没有明确要求长期保存，但出现可跨任务复用的稳定协作方式时，入口提交有作用域和证据的 observation，形成 trial 候选；
- 明确仅限“这次”“当前任务”的要求只作用于当前请求，不写入长期记忆；
- 普通任务摘要、Agent 计划、测试数量、Change 状态、提交摘要、CLI 输出和容易从仓库重新发现的事实不得成为个人记忆。

生产路径必须保留真实 actor、scope、signal 和最小用户证据，不得用 workflow actor 的泛化 `episode.completed` 代替明确用户 signal。入口只传递结构化 signal/observation，不保存完整聊天。

一次可信、可复用推断进入 trial 并允许低优先级召回；一次实际成功应用后 proven。用户纠正立即产生新版本并 supersede 冲突旧版本。显式内容高于推断内容；更具体项目/路径 selector 高于全局宽泛 selector。

遗忘立即停止检索并写 tombstone，旧事件重放不能恢复。Reflection 使用 Experience Journal 中的结构化用户 signal、情境、结果和最小 evidence，按 episode 分块处理。语义 Reflection 暂不可用时，明确用户 signal 仍由确定性路径直接写入；延迟的推断保留可重试诊断，不生成占位记忆。

### Scenario: 显式长期偏好进入下一任务

- **Given** 用户通过任一正常 Comet 入口明确要求以后都使用中文
- **When** 入口完成当前任务的信号捕获
- **Then** Personal Memory 形成一条 proven Core Profile 或 Collaboration Policy
- **And** 下一相关任务加载该记录并能说明应用原因
- **And** Journal 中保留结构化 user actor 与最小用户证据，而不是泛化 workflow episode

### Scenario: 一次性要求不被持久化

- **Given** 用户明确要求只在当前任务输出三条结果
- **When** 当前任务结束
- **Then** 该要求不会形成长期 Record、trial 候选或下次任务上下文

### Scenario: 稳定协作习惯经使用后晋升

- **Given** 系统从有用户证据的协作过程识别出一个可复用习惯，但用户没有明确要求长期保存
- **When** Learner 接受该 observation
- **Then** 先形成一条有作用域和证据的 trial Collaboration Policy
- **And** 只有下一相关任务实际采用并回写 `used-successfully` 后才晋升 proven

### Scenario: 用户纠正立即替代旧记忆

- **Given** 已有一条与用户新纠正冲突的个人记忆
- **When** 用户明确纠正或遗忘
- **Then** 新记录成为当前版本或 tombstone 生效
- **And** 旧版本立即停止注入并保留可追溯关系

## Record and Provider

Personal Memory Record 至少包含稳定逻辑 ID、memory type、memory class、scope、project identity、正文、selectors、authority、`trial | proven | superseded`、来源、evidence、应用统计、版本关系和时间。Episode 额外包含 situation、action summary、outcome 和 lesson，不包含隐藏推理。

领域层继续只依赖：

```ts
interface PersonalMemoryProvider {
  status(): Promise<ProviderStatus>;
  query(request: ProviderQueryRequest): Promise<ProviderQueryResult>;
  apply(mutation: ProviderMutation): Promise<ProviderMutationResult>;
}
```

`query` 支持 profile、task、manifest、expand 和 manage；`apply` 支持 experience delta、remember、correct、forget、rollback 和 feedback。Local 与 Remote 必须通过相同契约测试。

Local Provider 的 Record/Provider 状态是权威机器状态。`profile.md` 和 `projects/<project-key>.md` 是用户可读投影和可重建输入，不是第二份独立记录库。投影文件必须从当前记录和 tombstone 幂等重建；记录已删除或被遗忘后，旧正文不得仅因投影文件残留而重新出现。文件数不得用作记忆数。

Remote 使用版本化固定 envelope，同一时刻 Local/Remote 严格二选一，失败不静默切换。Provider 存储不设置固定条目数或总容量。

### Scenario: 权威状态与 Markdown 投影一致

- **Given** 权威状态中没有有效个人记忆，但磁盘存在旧投影文件和 tombstone
- **When** 用户刷新、同步或执行修复
- **Then** 有效记忆数仍为零，投影按当前记录重建且遗忘保护保留
- **And** 重复执行不会恢复已遗忘正文或新增重复记录

## Retrieval and context

每个新任务加载 Core Profile 快照。明确语言、沟通方式、禁忌及高复用 Collaboration Policy 可以完整注入；其他匹配记录以 `id/title/summary/whyApplied` 进入 Context Manifest，Agent 按需 expand。

检索使用 scope、稳定 project identity、task、path、phase、operation、tags 和 application feedback。排序优先当前明确要求、显式 proven、selector 精确匹配、成功复用和来源新鲜度；trial 低于 proven。相同逻辑 Record 只出现一次，superseded 和 tombstoned 内容不得注入。

现有 `profile_char_limit` 与 `task_context_char_limit` 是单次注入预算：超出时内容进入 Manifest，而不是拒绝记住、截断权威记录或产生保存上限错误。

当前用户请求和系统约束始终高于 Personal Memory。Project Policy 高于个人项目习惯；Personal Memory 不授权提交、推送、删除或发布。个人 project scope 记录不会自动共享到 Project Knowledge；如用户明确共享，由 Project Knowledge 重新核对来源并创建自己的记录。

### Scenario: 当前请求覆盖历史偏好

- **Given** proven 个人偏好与当前用户请求冲突
- **When** 当前任务选择上下文
- **Then** 当前请求获胜
- **And** 系统不得把被覆盖的旧偏好当作本次成功应用

## Configuration and management

用户级配置继续选择 Provider、Remote endpoint/token env/profile/timeout，以及 Core Profile 和任务上下文注入预算。项目 `.comet/config.yaml` 继续控制 `memory.learning` 和 `memory.retrieval`；关闭学习不删除记录，关闭检索不影响 Dashboard 管理。

CLI、Dashboard、Skill 和 Hook 读写同一领域状态。管理界面展示 Core Profile、Collaboration Policy、Personal Episode 和历史/遗忘视图；显示生命周期、证据摘要、whyApplied、最近应用结果和作用范围，并支持新增、纠正、遗忘、回滚和 expand。页面同时提供当前 Context Manifest 预览。

“自动学习已开启”只表示配置允许学习，不能表示已经形成记录。界面必须分别显示有效记录、trial、历史、tombstone、最近学习结果和跳过/延迟原因。投影文件及其同步状态放在数据详情中，不计入“记忆条数”。

显式操作成功后给出简短确认；后台形成默认静默。只有记忆第一次实际改变处理方式、与当前要求冲突或被用户纠正时显示必要原因，不在普通回复中泄露机器 envelope。

### Scenario: 空状态说明为什么没有学到

- **Given** 学习配置已开启但当前没有有效记录
- **When** 用户打开个人记忆中心
- **Then** 页面显示有效记忆为零
- **And** 分别说明最近没有合格信号、等待复用验证、学习延迟或发生错误中的真实原因
- **And** 不以投影文件数或已处理事件数替代学习结果

## Failure behavior

显式 remember/correct/forget/rollback/expand 和 Provider 配置失败必须返回真实错误并保持原状态。后台 capture、Reflection、feedback 或检索失败只记录诊断，当前 workflow 继续。Remote 不可达时不回退 Local，Local Git 同步失败不阻止当前本地读取。

插件停用时不调用 Provider、不学习、不检索；卸载不自动删除数据。自动内容使用当前 workflow 配置语言，用户原文保持原语言。

## Verification

- 契约测试覆盖 Local/Remote、CLI/Dashboard/Hook/Skill 的形成、检索、管理、投影重建和错误语义。
- 跨任务测试覆盖显式长期偏好、一次性要求、trial 晋升、纠正 supersede、遗忘 tombstone 和当前请求优先。
- 生产入口测试证明结构化 user signal/observation 真正进入 Learner，不只在测试 fixture 中直接注入事件。

## Non-goals

- 不保存完整会话、工具日志、完整 diff、隐藏推理或普通项目事实。
- 不自动修改 Project Knowledge、Project Policy、Specs、linter、测试或 Skill。
- 不实现内置 Mem0 adapter、向量数据库、Provider marketplace、Local/Remote 双写或复杂迁移层。
