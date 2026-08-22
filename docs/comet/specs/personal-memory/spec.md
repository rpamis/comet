# Personal Memory、User Profile 与 Provider

## 产品行为

Personal Memory 是默认安装但可独立停用或卸载的第一方 Comet 插件。它只学习当前用户未来仍有用的偏好、协作习惯和项目工作约定，并在 Classic、Native、Hotfix、Tweak、CLI 与 Dashboard 中提供一致能力。插件缺失、停用或失败时，Comet workflow 继续工作。

Personal Memory 对 Agent 提供两个明确分开的上下文层：

1. **User Profile**：稳定、紧凑、跨任务可用的当前用户画像。
2. **Task-matched Personal Memory**：根据当前项目和任务检索的相关记忆。

两层共享 Provider 中的规范化记录，不维护两份互相漂移的权威数据。Local Provider 将 User Profile 投影到现有 `profile.md`，将项目记忆投影到 `projects/<project-key>.md`；机器状态、候选、证据、冲突、tombstone、历史和索引保存在用户级 Runtime。项目仓库不保存个人记忆副本。

显式记忆、纠正和遗忘完成后给出一次简短、用户可理解的确认。后台观察、候选形成、重复计数、检索和同步默认静默；只有新记忆第一次实际改变处理方式，或当前要求与记忆冲突时，才简短说明采用或忽略的原因。普通消息不显示内部 ID、evidenceKeys、候选计数或 Provider envelope。

## 记忆模型

每条规范化记录至少包含稳定 ID、内容、类别、作用域、来源类型、状态、selectors、项目身份、最小证据引用和时间信息。稳定枚举为：

- `memoryClass`: `user-fact | user-preference | collaboration-habit | project-convention`
- `kind`: `explicit | inferred`
- `scope`: `global | project`
- `state`: `candidate | active | conflict | inactive | tombstoned`

`user-fact` 表示姓名、角色、时区、技术背景和技术熟练度等稳定的用户事实。`user-preference` 表示用户直接表达或稳定表现出的个人偏好，例如语言、表达风格和工具偏好。`collaboration-habit` 表示跨任务稳定的协作方式，例如先给结论、仅暂存当前改动。`project-convention` 表示只对当前项目有用的个人工作约定或已验证操作经验，不表示仓库本身的公共规则或事实。

Personal Memory 的 project 作用域与 Project Knowledge 是两个独立领域。Personal Memory 不修改 Project Knowledge lifecycle、项目规则、Specs、linter、测试或仓库事实；Project Knowledge 也不替代用户私有的项目记忆。

## 独立 User Profile

User Profile 是独立的产品、管理和检索层。它由 active global `user-fact`、`user-preference` 与稳定的 active global `collaboration-habit` 形成，表达“这个用户是谁，以及通常希望怎样合作”，承担类似 Hermes `USER.md` 的作用。

User Profile 必须满足：

- 在项目开启 Personal Memory 检索时，以独立、清楚标识的完整紧凑上下文区块提供给 Agent。
- 不设置条目数上限。默认容量为 2,000 个 Unicode 字符，并可通过用户级配置调整；容量按字符而不是 UTF-8 字节计算。
- 优先保留姓名/角色/时区/技术背景、语言、沟通方式、输出偏好、明确禁忌和稳定协作习惯。
- 不要求当前任务命中关键词才返回稳定的核心画像。
- 只包含 active 记录；candidate、conflict、inactive 和 tombstoned 记录只在管理界面可见。
- 同一记录如果也被任务检索命中，只在最终上下文中出现一次。
- 当前用户要求或项目规则与画像冲突时，当前要求和项目规则优先，不把记忆当成授权或强制规则。

每个 workflow 任务开始时加载一次 User Profile 快照，并在该任务内保持稳定。任务中新增或修改的内容立即持久化；当前对话仍可直接使用用户刚说的话，更新后的 Profile 从下一任务开始进入快照。这样避免同一任务中上下文前缀反复变化。

Provider 在 Profile 接近容量时优先合并完全等价或可以无损归并的短条目，不按固定条目数裁剪。无法容纳新内容时不得静默截断或删除 active 显式记录：显式操作返回当前用量和可处理的整理提示，自动 inferred 内容留在 candidate/待确认区。Dashboard 显示当前字符用量和容量。

Local Provider 的 `profile.md` 是 User Profile 的用户可读投影，不新增 `user-profile.md`。用户直接编辑该文件时，Local Provider 将变更作为显式用户操作导入规范化状态并保留历史。

## Task-matched Personal Memory

Task-matched Personal Memory 承担类似 Hermes `MEMORY.md` 的相关记忆作用，但不保存或搜索完整会话。它从以下 active 记录中检索：

- 当前项目的 project 作用域记录。
- 当前项目的 `project-convention`。
- 与当前任务 selectors 明确匹配的 global 偏好或协作习惯。
- 未被 User Profile 区块占用、且对当前操作有直接帮助的其他相关记录。

检索使用作用域、稳定项目身份、任务类型、操作、路径、类别、标签和关键词做确定性匹配。排序依次考虑当前项目匹配、显式来源、结构化 selector 匹配、最近确认和稳定 ID。结果不设固定条目数，按默认 6,000 个 Unicode 字符预算依次装入最相关记录；预算可通过用户级配置调整。没有可靠命中时不注入详细记忆。

项目记忆继续保存在 Local Provider 的 `projects/<project-key>.md`。同一 Git 仓库的 worktree、目录移动和同一远端重新克隆共享项目记忆；fork 和不同仓库默认隔离。项目身份不得依赖本地绝对路径、宿主会话 ID 或进程 ID。

## 用户证据与形成规则

记忆只能由用户证据形成。允许的证据包括用户直接表达的长期偏好、明确的记住/纠正/遗忘指令、用户反复作出的选择，以及用户对 Agent 行为的纠正。

以下内容不得成为正向记忆证据：

- Agent 自己的计划、总结、工作方式或推断。
- CLI 用法、Change 状态、测试数量、构建结果、提交/PR/Issue 摘要。
- 工具输出、原始日志、完整 diff、完整 transcript 和容易从仓库重新发现的普通事实。
- 带有“这次”“当前任务”等明确临时边界的一次性要求。
- 失败、取消或尚未验证的操作结果。

“以后都用中文回答”这类用户直接表达的长期偏好属于 `explicit`，即使没有出现“记住”关键词也立即 active。“这次只列三条”仍只影响当前请求，不创建候选。

自动观察只在成功 phase 转换、可信 checkpoint、验证完成、任务完成或 Archive 等稳定检查点运行。Workflow 只提交当前会话中有界的用户表达、选择和纠正；Runtime 补充 workflow、Change、项目身份、配置语言、成功结果、现有相关记忆、稳定 evidence ID 和固定预算。普通对话轮次、每次工具调用、失败或取消不触发正向学习。

没有长期价值时必须 `skip`。一次观察可以处理多个独立 candidateKey，但动作数、证据数和总字节数均受固定预算限制。评审不可用、输出无效或超时时保持原状态并继续当前 workflow。

## 晋升、纠正、冲突与遗忘

显式记忆立即 active，并在同等匹配条件下高于 inferred 记忆。隐式记忆第一次只形成 candidate：

- project 记忆需要同一项目中至少两个不同成功 Change 的一致、无冲突用户证据才能 active。
- global 记忆需要至少两个不同项目的一致用户证据，或由用户明确确认后才能 active。
- 同一 Change 的恢复、重试、跨会话继续或 Hotfix/Tweak 升级只更新同一证据，不增加独立计数。

用户显式纠正、Dashboard/CLI 操作或 Markdown 编辑立即更新当前内容并保留可回滚历史。隐式内容与显式记忆冲突时进入 conflict，不能自动覆盖显式内容。等价内容应合并或更新，不产生近义重复。

用户显式遗忘或删除后，当前内容立即停止检索，并保存最小 tombstone。遗忘前的旧观察、事件重放和旧设备同步不能把它恢复；只有遗忘后的新独立证据可以重新形成 candidate，用户也可以从历史回滚或永久删除。

所有应用动作只保存最小来源类型、时间、Change 引用和 evidenceKeys，不保存完整消息、工具输出或 diff。

## Provider 抽象层

Personal Memory 领域层只依赖以下统一 Provider 接口：

```ts
interface PersonalMemoryProvider {
  status(): Promise<ProviderStatus>;
  query(request: ProviderQueryRequest): Promise<ProviderQueryResult>;
  apply(mutation: ProviderMutation): Promise<ProviderMutationResult>;
}
```

`query` 支持 `profile`、`task` 和 `manage` 三种视图。`apply` 承载观察、显式记住、纠正、遗忘和回滚；Provider 按本 Spec 维护候选、晋升、冲突、历史和 tombstone 语义。该接口不按 Local、Remote 或未来 Mem0 的 SDK 形状扩张。

Comet 负责：

- 从 workflow 提取和限制用户证据。
- 校验统一接口与 Remote Provider 协议的 request/response schema、枚举、长度和记录归属。
- 应用项目学习/检索开关、上下文预算、优先级和最终去重。
- 渲染统一 User Profile 与任务匹配上下文。
- 为 Dashboard、CLI 和 workflow 提供统一领域 API。

Provider 负责：

- 持久化规范化记录与历史。
- 候选、晋升、冲突、纠正、遗忘、回滚和 tombstone 状态。
- 按 query 视图返回规范化记录与最小状态。

同一时刻只有一个 Provider 生效。Comet 不双写、不静默回退，也不因切换 Provider 自动迁移或删除数据。

## Local Provider

Local Provider 是默认实现，继续使用：

- `profile.md`：User Profile 的可读投影。
- `projects/<project-key>.md`：项目记忆的可读投影。
- 用户级 Runtime：规范化记录、候选、证据、冲突、tombstone、历史、索引和迁移状态。
- 现有专用私有 Git 仓库：跨会话、宿主和设备同步可读数据与所需状态。

Local Provider 必须保留现有 Git remote、项目身份、历史和同步行为。Git remote 暂时不可用时，当前本地记忆仍可使用，并提供非阻塞同步诊断。Local Git 同步只在 Local Provider 生效时出现在 Dashboard。

## Remote Provider 协议与未来 adapter

Remote Provider 允许用户接入自建 HTTPS 服务。所有操作通过用户配置的单一 endpoint，使用固定版本 envelope `comet.personal-memory.provider.v1`。Envelope 至少表达 operation、profile 命名空间、可选 projectKey 和对应 payload；不增加能力协商或 Provider 专属扩展字段。

Remote 请求只能包含完成当前操作所需的有界用户证据、selectors、项目身份和规范化元数据，不发送完整 transcript、工具输出、diff 或仓库内容。Remote 响应只能返回符合 Comet schema 的规范化记录、状态和诊断，不能返回任意 Markdown、HTML、提示词或可直接拼接的上下文。

Remote Provider 是完整后端，负责与 Local Provider 相同的候选、晋升、冲突、检索和管理语义。Comet 在接收后再次执行 schema、预算和记录归属校验，再由统一渲染层生成上下文。

本期不实现 Mem0 adapter。未来 adapter 可以把 `status/query/apply` 映射到 Mem0 SDK 或 API，但不得要求领域层、Dashboard 信息架构、项目配置或 Agent 上下文理解 Mem0 专属概念。

## 配置

Provider 是用户级选择，配置在 `~/.comet/config.yaml`：

```yaml
personal_memory:
  provider: remote
  profile_char_limit: 2000
  task_context_char_limit: 6000
  remote:
    endpoint: https://memory.example.com/comet
    token_env: COMET_MEMORY_TOKEN
    profile: default
    timeout_ms: 5000
```

`provider` 支持 `local | remote`，默认 `local`。`profile_char_limit` 默认 `2000`，控制完整 User Profile 快照容量；`task_context_char_limit` 默认 `6000`，控制每次任务匹配检索的上下文容量。两者按 Unicode 字符计算且不附带固定条目数。Remote token 值只从 `token_env` 指定的环境变量读取，不能写入配置、Runtime、日志或 Dashboard；Dashboard 只编辑环境变量名。`profile` 是同一 Remote Provider 中的用户命名空间，默认 `default`。`timeout_ms` 是可选的简单请求超时，不引入复杂重试或熔断。

项目 `.comet/config.yaml` 只控制该项目是否参与学习和检索：

```yaml
memory:
  learning: true
  retrieval: true
```

项目不能选择或覆盖用户 Provider。`learning: false` 停止该项目的新观察，但不删除现有记录；`retrieval: false` 停止向该项目注入 User Profile 和任务匹配记忆，但不影响 Dashboard 管理。

## Dashboard 与管理

Dashboard 的 Personal Memory 页面使用统一领域 API，并提供以下区域：

- **用户偏好**：查看包含用户事实、偏好和协作习惯的当前 User Profile，查看字符用量，并新增、编辑、纠正、遗忘和查看历史。
- **项目记忆**：查看当前项目的 active 记忆，并进行纠正、遗忘和回滚。
- **待确认**：查看 candidate、conflict 和需要用户处理的内容；这些内容默认不注入 Agent 上下文。
- **Provider 设置**：选择 Local/Remote，编辑 endpoint、token 环境变量名、profile、可选 timeout、Profile 字符容量和任务上下文字符预算，测试连接并保存启用。

Local 模式显示现有 Git 同步状态和操作；Remote 模式隐藏 Local Git 同步操作并显示 Remote 连接状态。切换 Provider 前明确说明不会迁移或删除数据。连接测试只验证当前配置可用，不写入测试记忆。

CLI、Dashboard、Skill 上下文和用户可读 Markdown 必须读写同一领域状态。管理界面可以显示本地化的作用域、类别、来源、证据数、最后确认时间和冲突状态，但普通 Agent 上下文不暴露这些机器细节。

## 检索优先级与权限边界

处理当前任务时，优先级为：

1. 当前用户明确要求。
2. 当前项目规则与配置。
3. 匹配的显式 Personal Memory。
4. 匹配的隐式 active Personal Memory。

User Profile 和任务匹配记忆是两个上下文区块，不改变上述优先级。记忆只能影响表达、协作和用户偏好的处理方式，不能扩大 Agent 权限，也不能授权提交、推送、删除、发布或其他外部副作用。

自动生成的内容使用当前 active workflow 的配置语言。`zh-CN` 的正文、理由和可读 Markdown 标题使用中文，`en` 使用英文；代码、命令、路径和专有名词可以保留原文，机器 schema 和枚举保持英文。用户通过 CLI 或直接编辑 Markdown 提供的文本保留原文。

## 失败行为

显式记住、纠正、遗忘、回滚或 Provider 配置失败时，系统必须给出明确错误、保持原状态且不能伪报成功。自动学习失败时不改变记忆，自动检索失败时不注入任何记忆；两者只产生非阻塞诊断，当前 workflow 继续。

Remote Provider 不可达、超时、鉴权失败或返回无效 schema 时，不回退到 Local Provider。Local Git 同步失败不阻止 Local Runtime 读取当前记忆。插件停用时不调用任何 Provider。

## 迁移与兼容

升级时必须原地迁移现有 Local 数据：

- 保留 `profile.md`、`projects/<project-key>.md`、Runtime 历史和 Git remote。
- 根据现有 scope、category、来源和内容映射到新 `memoryClass`，能够确认的 active 用户偏好保持 active。
- 现有稳定 candidate、conflict、tombstone 和历史保持原语义与 evidence 去重能力。
- 明显属于 CLI 用法、Change 状态、测试/提交摘要、Agent 计划或 `workflow-operation` 的旧记录转为 inactive，不进入 User Profile 或任务检索；保留历史以便用户查看或删除。
- 不能可靠分类的旧记录保持可追溯但不自动注入，等待用户在 Dashboard 中确认。
- 不新增重复的 `user-profile.md`，也不因 Provider 切换移动或删除任一后端的数据。

## 场景

### 用户直接表达长期偏好

用户说“以后都用中文回答”。系统将其作为 explicit global `user-preference` 立即 active，下一次任务的 User Profile 包含该偏好。用户说“我是后端开发，时区是 GMT+8”时，稳定信息作为 `user-fact` 进入同一 Profile。

### 一次性要求

用户说“这次只列三条”。该要求只作用于当前请求，不创建 candidate，不写入 Markdown，也不出现在下一次 User Profile。

### 排除 Agent 工作信息

一个 Change 只产生 CLI 帮助文本、测试通过结果和提交摘要。自动观察返回 `skip`；迁移时发现同类旧 `workflow-operation` 记录则转为 inactive。

### 两个独立 Change 形成项目记忆

用户在同一项目的第一个成功 Change 中纠正某种协作方式，只形成 candidate；另一个独立成功 Change 出现一致用户证据后，该记录可以成为 active project 记忆。同一 Change 的恢复和重试不增加证据计数。

### 全局隐式偏好

同一行为只在一个项目中重复时不能自动晋升 global。第二个不同项目出现一致用户证据，或用户在 Dashboard 中明确确认后，才可以成为 global active 记录。

### 双通道检索

当前任务同时命中语言偏好和某项目发布约定。完整紧凑 Profile 快照包含语言偏好，项目发布约定进入任务匹配区块；如果同一记录同时命中两个查询，最终只注入一次。

### Profile 容量

User Profile 已接近字符容量。Provider 先合并等价的表达风格条目；如果一条新的显式用户事实仍无法容纳，操作不静默删除旧内容，而是返回当前用量并提示用户在 Dashboard 中整理或提高容量。新的 inferred 内容只留在待确认区。

### 项目隔离

同一仓库的另一个 worktree 能检索相同项目记忆；无关仓库和 fork 不能检索该项目记录。User Profile 中的 global 偏好仍可按配置使用。

### 纠正、冲突与遗忘

用户显式纠正旧偏好后，当前检索立即采用新内容。后续隐式矛盾只能进入 conflict，不能覆盖显式记录。用户遗忘后，旧设备同步和旧事件重放不能恢复该记录。

### Remote Provider 失败

Remote endpoint 超时。显式记住操作显示失败且原状态不变；自动检索不注入记忆但当前 workflow 继续，也不会读取 Local Provider 作为回退。

### Provider 切换

用户从 Local 切换到 Remote。Local 文件、历史和 Git remote 保留，Remote 从自己的 profile 命名空间开始工作；切回 Local 后原 Local 数据仍然存在。

## 验证标准

- 固定形成 Eval 中，有效长期用户事实与偏好的 recall 为 1，Agent 工作信息和一次性要求的错误保存数为 0。
- 固定检索 Eval 中，precision 不低于 0.9，并保持有效目标记忆 recall 为 1。
- Local 与 Remote Provider 实现通过同一组 `status/query/apply` 接口一致性测试。
- 迁移 fixture 覆盖现有 profile、项目记忆、候选、历史、Git remote 和错误工作流水账记录。
- Classic、Native、Hotfix、Tweak、CLI 与 Dashboard 集成测试验证相同的分类、检索和管理结果。
- Dashboard 浏览器验收覆盖 User Profile、项目记忆、待确认、Provider 配置、连接测试、失败状态和 Local/Remote 条件展示。

## 非目标

- 不实现 Skill 自进化或自动修改 Agent 指令、项目规则、Project Knowledge 与 Specs。
- 不保存、搜索或同步完整会话、日志、diff、隐藏推理或无边界任务轨迹。
- 不建设向量数据库、知识图谱、Comet 账户或托管记忆服务。
- 不实现内置 Mem0 adapter、Provider marketplace、动态 JS Provider 或 capability negotiation。
- 不实现 Local/Remote 双写、静默回退、自动数据迁移、复杂重试、熔断或后台迁移任务。
- 不全局拦截 Comet workflow 之外的普通宿主聊天。
