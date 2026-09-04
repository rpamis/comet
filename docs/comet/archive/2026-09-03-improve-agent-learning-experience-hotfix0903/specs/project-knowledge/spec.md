# Project Knowledge and Project Policy

## Product model

`comet.project-knowledge` 是 project-scope 第一方插件，为 Agent 提供当前项目的可追溯语义知识和程序性策略。用户通过一个“项目知识”中心管理该能力，内部明确分为：

- **Project Model**：topology、fact、dependency 等“项目是什么”的语义记忆；
- **Project Policy**：decision、pattern、procedure、constraint、failure-resolution 等“以后怎样做”的程序性记忆。

Project Knowledge/Policy 不能覆盖当前用户请求、系统约束、当前源码、配置和测试。Personal Memory 使用独立 Provider、存储和作用域；同一 Experience 可以被两个 Learner 消费，但个人记录不会直接复制为项目记录。

## Record identity and lifecycle

规范化 Record 至少包含稳定逻辑 ID、repository/project ID、kind、标题、摘要、适用路径/操作/阶段、结论、关系、来源、来源版本、内容摘要、验证方式、authority、`trial | proven | enforced | superseded`、application 统计和更新时间。

Project Model kind 为 `topology | fact | dependency`。Project Policy kind 为 `decision | pattern | procedure | constraint | failure-resolution`。authority 为 `automatic | user | repository`。

用户明确项目约定和已有 Agent 指令属于 proven；从当前 manifest、配置、源码结构和验证结果确定性提取的 Project Model 直接 proven；单次可信语义推断进入 trial。trial 实际成功应用一次后 proven；只有绑定当前存在且成功执行的确定性验证命令的 constraint 才可以 enforced。

同一语义身份更新当前 Record，不创建近义重复。版本变化以规范化内容摘要和稳定来源定位为准；mtime、检出分支、worktree 路径或扫描顺序不能单独触发新版本。内容真正变化时，新版本成为当前 Record，旧版本 superseded 并通过版本关系进入历史。

更高优先级决定、来源失效或负面 application outcome 会 supersede Record。用户明确纠正的正文不能被自动内容覆盖。`trial | proven | enforced` 计入有效记录；`superseded` 只计入历史并从注入结果排除。

### Scenario: 相同内容不会产生版本风暴

- **Given** 一个来源文件内容和定位未变化
- **When** 文件 mtime、当前分支或 worktree 发生变化并触发刷新
- **Then** 同一逻辑知识仍只有一个当前版本
- **And** 不新增仅 ID 或更新时间不同的重复 Record

### Scenario: 内容变化形成可追溯的新版本

- **Given** 当前知识的来源内容或适用范围真实变化
- **When** 刷新重新验证该来源
- **Then** 一个新版本成为当前有效 Record
- **And** 旧版本 superseded、停止注入并能从历史查看替代关系

## Experience learning

Project Model Builder 消费 `repository.changed`、结构化 `verification.completed` 和 `change.archived`，结合内置 corpus、用户配置的 `knowledge.local.include` Markdown glob、manifest、配置和有限源码关系更新项目模型。

Project Policy Learner 消费：

- `review.resolved`：形成已接受的 decision 或 constraint；
- `failure.resolved`：形成失败情境、根因、修复和复验的 failure-resolution；
- `verification.completed`：把成功命令连接为验证方式，并校准相关 Policy；
- `change.archived`：提取最终决策、稳定模式、Procedure 和废弃项；
- `context.outcome`：根据后续使用效果强化、改写或 supersede trial Policy。

所有正式 Comet 入口和默认 Plugin Bridge 必须把可用的生产语义 reviewer 传入 Project Knowledge Learner。语义 reviewer 不可用时，确定性 Project Model 和验证关联继续工作；需要语义判断的 Policy 进入可重试的延迟状态，记录事件、原因和最近尝试，不得静默丢失，也不得用“模块概览”之类泛化占位结论冒充已形成策略。

Reflection 输入按 episode、changed paths 和 evidence 分块；来源在写入前重新核对。只有 Review 已接受、失败已闭环或 Archive 最终状态可作为稳定策略证据，任务中间计划不得直接形成 Project Policy。

### Scenario: 生产 Review 形成项目策略

- **Given** Review 接受了一条有来源、有适用范围的项目约束
- **When** 正常 Comet 生产入口完成该 Review episode
- **Then** Project Policy Learner 收到事件并通过语义 reviewer 形成 trial constraint
- **And** 后续实际成功使用后可晋升 proven

### Scenario: 语义审查不可用时延迟而不伪造

- **Given** 一个需要语义判断的 Review、失败解决或 Archive episode 已进入 Journal
- **When** 生产 reviewer 暂不可用
- **Then** 确定性 Project Model 仍可刷新
- **And** 语义 episode 保留为可重试的延迟学习并暴露原因
- **And** 系统不生成无关泛化策略或将事件标记成已学习

## Readiness, source freshness, and rebuild

领域提供统一的 `ensure/refresh` 服务，负责：

- 检查当前 workspace 的索引、当前有效 Project Model 和来源新鲜度；
- 首次使用时从 manifest、配置、目录和允许的 corpus 建立 proven Project Model；
- 来源变化时按内容摘要刷新当前版本并失效旧版本；
- 索引损坏时重建可重建读模型；
- 返回有效、历史、延迟、跳过、截断和诊断的同一快照语义。

任务上下文、CLI status/list/query、Dashboard status/refresh 必须调用或读取同一 readiness 结果。不得出现 Dashboard 显示零有效记录，而同一时刻下一次任务才静默生成另一套当前模型的状态分裂。

现有异常数据通过幂等维护操作整理：先修复身份和版本逻辑，再合并重复链、保留必要历史及用户纠正，最后重建当前有效模型。维护操作不得删除用户 authority 的当前结论，也不得恢复已失效内容。

### Scenario: 三个入口看到一致的项目模型

- **Given** 一个从未建立当前 Project Model 的项目
- **When** 用户依次打开 Dashboard、执行 CLI 查询并启动任务
- **Then** 三个入口通过同一 readiness 服务建立或读取模型
- **And** 有效记录数量、来源版本和诊断一致
- **And** 同一来源不会被重复构建三次

### Scenario: 异常历史可安全整理

- **Given** Store 中存在同一逻辑知识的多个 superseded 版本且当前有效模型为空
- **When** 用户执行维护或刷新
- **Then** 重复版本链被幂等整理并保留必要审计信息
- **And** 当前项目模型从现有真实来源重建
- **And** 第二次执行不继续新增或删除记录

## Policy Compiler

Policy Compiler 把 Project Policy 转换为三类 activation：

1. `context`：需要 Agent 判断的 decision、pattern、procedure 或 constraint，通过 Context Manifest/expand 提供；
2. `verification`：项目已经存在可运行命令且能够确定性判断成功/失败的 constraint，在相关 phase 作为 enforced 验证入口；
3. `skill-candidate`：跨任务稳定、多步骤、可组合的 procedure，提供候选摘要和证据，但不自动创建或覆盖 Skill。

Policy Compiler 不编写通用 linter/compiler/build/CI 配置生成器，也不发明第二套严重级别。若项目已有 ESLint、Maven、Gradle、测试、构建或 CI 命令，沿用其成功/失败和诊断语义。

## Provider and storage

领域层继续依赖 `status/query/apply` Provider seam。query 支持 search、list、get、manifest 和 expand；apply 支持 upsert、correct、supersede、refresh、experience delta、feedback 和维护操作。

Local Provider 使用用户数据目录中按稳定 repository ID 隔离的 SQLite；Record 是权威机器状态，workspace section/FTS 是可重建读模型。主工作区和 linked worktree 共享 Record，源码与文档索引按 workspace 隔离。

Remote 使用版本化固定协议，Local/Remote 严格二选一。Remote 查询只发送有界 task/path/phase/operation 和 ID selector；apply 只发送规范化 Record/evidence，不发送完整仓库、完整 diff、日志、Personal Memory 或凭据。Remote 失败不回退 Local。

所有 Record 注入前核对 project-relative source、anchor、digest 或版本。来源变化、命令消失或 selector 不再成立时，旧 Record superseded 并从 Context Manifest 排除；新证据形成新版本。

### Scenario: 过期来源停止注入

- **Given** 一个 proven/enforced Record 的来源已改变、删除或验证命令已消失
- **When** 任务选择上下文或显式刷新
- **Then** 旧 Record 在注入前被判定失效并 superseded
- **And** Context Manifest 不包含该旧结论

## Retrieval and application feedback

检索先按 project、path、operation、phase、kind 和有效 state 过滤，再结合 FTS、有限 ripgrep、关系扩展和 application feedback 排序。proven/enforced 高于 trial；当前代码、配置和测试高于所有 Record。

关键 proven/enforced Project Policy 可以完整注入；Project Model、trial Policy、Procedure 和 Episode 以 `id/title/summary/whyApplied/sourceType` 进入 Context Manifest并按需 expand。相同逻辑 Record 只返回一次，单次注入预算不限制 Provider 总记录数或 Reflection 输入。

每个被选择的候选拥有 application record。只有 Agent 实际采用该内容且结果已知时才能回写 outcome；未使用候选保持未反馈。反馈统计必须分别显示总应用、已反馈、未反馈、成功、忽略、覆盖、纠正和导致失败，不能用总应用数表示学习成功。

### Scenario: 未使用候选不会被误判成功

- **Given** Context Manifest 提供多条候选，但 Agent 只实际采用其中一条
- **When** 任务完成并回写结果
- **Then** 只有已采用记录收到真实 outcome
- **And** 其余候选保持未反馈且不能晋升或增加成功强度

## CLI and Dashboard

CLI 提供 status、list、get/expand、query、correct、forget/supersede、rebuild/refresh、维护和 application feedback。Dashboard 在同一项目知识中心提供项目模型、项目策略、索引来源和历史视图，并使用同一领域快照。

项目模型按 topology/fact/dependency 浏览；项目策略按 decision/pattern/procedure/constraint/failure-resolution 浏览。当前有效列表包含 trial/proven/enforced，历史列表包含 superseded。页面显示作用范围、来源、验证方式、whyApplied、最近应用结果、版本关系和更新时间，并提供新增、纠正、废弃、展开来源、刷新和安全维护操作。

索引来源表示可检索 corpus，结论证据表示支持某条 Record 的引用，两者不得合并成一个模糊的“数据来源”列表。来源详情先展示关联知识的完整结论、关系、状态、版本、project-relative anchor 和引用片段，再按需展示有界文件原文。

快照必须携带并展示真实健康状态、Provider/索引诊断、当前记录计数、最近学习及延迟原因、最近刷新、最近查询耗时与候选数、反馈覆盖和截断信息。页面不得仅因插件已配置或未停用就显示“服务正常”。

### Scenario: 来源详情说明关联的具体内容

- **Given** 一个源码文件既是索引来源，也是多条知识版本的证据
- **When** 用户打开来源详情
- **Then** 页面按逻辑知识分组显示当前结论和历史版本
- **And** 每项显示关系、类型、状态、精确 anchor、引用片段和替代关系
- **And** 不把相同标题的多个旧版本渲染成无法区分的并列结论

## Failure behavior

查询失败时任务继续且不注入项目上下文；apply/correct/supersede 失败时保持原状态；Local 索引损坏时重建 FTS 或使用有限 ripgrep；来源不可读时停止注入。后台学习、刷新和 reviewer 失败留下分层诊断并允许重试。

插件停用或卸载后不学习、不查询、不运行验证、不打开 SQLite、不发送网络请求。卸载不默认删除用户数据。

## Verification

- Local/Remote Provider、CLI/Dashboard、Learning Eval、Retrieval Eval 和 Classic/Native 集成返回一致生命周期和就绪语义。
- 检索评估实际构建 Provider、执行查询、核对相关结果并输出 Recall、排序质量、重复率和来源新鲜度等可审计指标；不得只检查数据集条目数。
- 集成测试覆盖首次建立、内容摘要去重、真实更新、来源失效、语义学习延迟/重试、应用反馈和异常数据幂等整理。

## Non-goals

- 不把 Project Knowledge 当作当前源码或强制授权。
- 不自动复制 Personal Memory，不保存完整任务轨迹，不建设通用知识图谱。
- 不自动修改未知技术栈的 Agent 指令、linter、compiler、测试、构建或 CI 配置。
- 不恢复旧 Unit schema、old project-rules Runtime 或旧状态枚举。
