# Project Knowledge and Project Policy

## Product model

`comet.project-knowledge` 是 project-scope 第一方插件，为 Agent 提供当前项目的可追溯语义知识和程序性策略。用户仍通过一个“项目知识”中心管理该能力，内部明确分为：

- **Project Model**：topology、fact、dependency 等“项目是什么”的语义记忆；
- **Project Policy**：decision、pattern、procedure、constraint、failure-resolution 等“以后怎样做”的程序性记忆。

Project Knowledge/Policy 不能覆盖当前用户请求、系统约束、当前源码、配置和测试。Personal Memory 使用独立 Provider、存储和作用域；同一 Experience 可以被两个 Learner 消费，但个人记录不会直接复制为项目记录。

## Record model

规范化 Record 至少包含稳定 ID、repository/project ID、kind、标题、摘要、适用路径/操作/阶段、结论、关系、来源、来源版本、验证方式、authority、`trial | proven | enforced | superseded`、application 统计和更新时间。

Project Model kind 为 `topology | fact | dependency`。Project Policy kind 为 `decision | pattern | procedure | constraint | failure-resolution`。authority 为 `automatic | user | repository`。

用户明确项目约定和已有 Agent 指令属于 proven；从当前 manifest、配置、源码结构和验证结果确定性提取的 Project Model 直接 proven；单次可信语义推断进入 trial。trial 成功应用一次后 proven；只有绑定当前存在且成功执行的确定性验证命令的 constraint 才可以 enforced。

更高优先级决定、来源失效或负面 application outcome 会 supersede Record。相同语义 identity 更新现有 Record，不创建近义重复。用户明确纠正的正文不能被自动内容覆盖。

## Experience learning

Project Model Builder 消费 `repository.changed`、结构化 `verification.completed` 和 `change.archived`，结合内置 corpus、用户配置的 `knowledge.local.include` Markdown glob、manifest、配置和有限源码关系更新项目模型。

Project Policy Learner 消费：

- `review.resolved`：形成已接受的 decision 或 constraint；
- `failure.resolved`：形成失败情境、根因、修复和复验的 failure-resolution；
- `verification.completed`：把成功命令连接为验证方式，并校准相关 Policy；
- `change.archived`：提取最终决策、稳定模式、Procedure 和废弃项；
- `context.outcome`：根据后续使用效果强化、改写或 supersede trial Policy。

Reflection 输入按 episode、changed paths 和 evidence 分块；来源在写入前重新核对。语义 reviewer 不可用时，确定性 Project Model 和验证关联继续工作，语义 Policy 延后处理，不阻塞 workflow。

## Policy Compiler

Policy Compiler 把 Project Policy 转换为三类 activation：

1. `context`：需要 Agent 判断的 decision、pattern、procedure 或 constraint，通过 Context Manifest/expand 提供；
2. `verification`：项目已经存在可运行命令且能够确定性判断成功/失败的 constraint，在相关 phase 作为 enforced 验证入口；
3. `skill-candidate`：跨任务稳定、多步骤、可组合的 procedure，提供候选摘要和证据，但本期不自动创建或覆盖 Skill。

Policy Compiler 不编写通用 linter/compiler/build/CI 配置生成器，也不发明第二套严重级别。若项目已有 ESLint、Maven、Gradle、测试、构建或 CI 命令，沿用其成功/失败和诊断语义。

## Provider and storage

领域层继续依赖 `status/query/apply` Provider seam。query 支持 search、list、get、manifest 和 expand；apply 支持 upsert、correct、supersede、refresh、experience delta 和 feedback。

Local Provider 使用用户数据目录中按稳定 repository ID 隔离的 SQLite；Record 是权威机器状态，workspace section/FTS 是可重建读模型。主工作区和 linked worktree 共享 Record，源码与文档索引按 workspace 隔离。当前功能未上线，旧 Record schema 直接重建，不提供状态映射或双读。

Remote 使用版本化固定协议，Local/Remote 严格二选一。Remote 查询只发送有界 task/path/phase/operation 和 ID selector；apply 只发送规范化 Record/evidence，不发送完整仓库、完整 diff、日志、Personal Memory 或凭据。Remote 失败不回退 Local。

## Source freshness and retrieval

所有 Record 注入前核对 project-relative source、anchor、digest 或版本。来源变化、命令消失或 selector 不再成立时，旧 Record superseded 并从 Context Manifest 排除；新证据形成新版本。

检索先按 project、path、operation、phase、kind 和 state 过滤，再结合 FTS、有限 ripgrep、关系扩展和 application feedback 排序。proven/enforced 高于 trial；当前代码/config/test 高于所有 Record。

关键 proven/enforced Project Policy 可以完整注入；Project Model、trial Policy、Procedure 和 Episode 以 `id/title/summary/whyApplied/sourceType` 进入 Context Manifest 并按需 expand。单次注入预算不限制 Provider 总记录数或 Reflection 输入；超出预算只减少常驻正文。

## CLI and Dashboard

CLI 提供 status、list、get/expand、query、correct、forget/supersede、rebuild/refresh 和 application feedback；不恢复旧 `knowledge units` 或旧 Project Rules 数据库命令。

Dashboard 在同一项目知识中心直接提供“项目模型”和“项目策略”视图，不重复渲染与侧边栏相同的大标题。项目模型按 topology/fact/dependency 浏览；项目策略按 decision/pattern/procedure/constraint/failure-resolution 浏览，并展示 trial/proven/enforced/superseded、作用范围、来源、验证方式、whyApplied、最近应用结果和更新时间。页面同时提供当前 Context Manifest 预览。用户可以手动新增知识或策略、纠正、废弃、展开来源和刷新。后台学习不阻塞首屏，页面优先显示缓存 snapshot。

Project Policy 的 Dashboard 状态是领域状态，不是另一份规则源。用户在仓库维护的 AGENTS/Rule 文件和现有检查仍是高优先级项目证据；插件只建立可检索模型和 activation，不静默改写这些文件。

## Failure behavior

查询失败时任务继续且不注入项目上下文；apply/correct/supersede 失败时保持原状态；Local 索引损坏时重建 FTS 或使用有限 ripgrep；来源不可读时停止注入；插件停用或卸载后不学习、不查询、不运行验证、不打开 SQLite、不发送网络请求。

## Verification scenarios

- 项目首次使用时，Project Model 从 manifest、配置、目录和自定义 Markdown corpus 生成 proven topology/fact/dependency。
- Review 中确认“domains 不得直接访问文件系统”并在后续 Change 实施后，系统形成 trial constraint；成功应用后 proven，若已有 architecture check 命令则可 enforced。
- 一次失败命令、明确根因、修复和成功复验形成 failure-resolution；下一相关任务通过 Manifest 找到并展开。
- Archive 的最终决定 supersede 旧设计结论，旧 Record 不再注入。
- 来源文件变化后旧 Model/Policy 立即失效，刷新后产生新版本。
- Local/Remote Provider、CLI/Dashboard、Learning Eval、Retrieval Eval 和 Classic/Native 集成返回一致语义。

## Non-goals

- 不把 Project Knowledge 当作当前源码或强制授权。
- 不自动复制 Personal Memory，不保存完整任务轨迹，不建设通用知识图谱。
- 不自动修改未知技术栈的 Agent 指令、linter、compiler、测试、构建或 CI 配置。
- 不实现旧 Unit schema、old project-rules Runtime、旧状态枚举或兼容命令。
