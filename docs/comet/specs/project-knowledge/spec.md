# Agent 项目知识

## Requirement: 项目知识边界

### Scenario: 项目知识与 Personal Memory 分离

`comet.project-knowledge` 是 project-scope 第一方能力，为 Agent 提供关于当前项目结构、模块职责、已验证行为、集成路径、改动影响以及构建/测试方式的可追溯、可核对和有界参考。它通过现有任务上下文桥接提供上下文，也允许 CLI 和 Dashboard 管理。

项目知识只能作为证据参考，不能覆盖当前源码、配置、测试、用户请求、系统约束、Skill 或 Native/Classic workflow 状态。

Personal Memory 是独立能力，保存用户事实、偏好、协作习惯和个人项目经验。它使用独立存储、Provider 配置、检索预算、上下文区块和管理动作。Personal Memory 记录不会自动复制为 Project Knowledge，Project Knowledge 也不会写入 Personal Memory。

## Requirement: Provider 选择与所有权

### Scenario: Local 默认、Remote 可选且严格二选一

项目配置继续使用：

```yaml
knowledge:
  provider: local
```

`local` 是默认 Provider，数据属于当前用户并保存在项目外。`remote` 是可选的团队共享 Provider，使用 endpoint、token 环境变量名、scope 和 timeout。一次请求只能选择一个 Provider；Remote 失败不读取 Local、不发送 Local 正文，也不静默切换到 Local。

Dashboard 可以通过现有 workflow-project 配置写入链路更新 `knowledge` 块。页面只显示 token 环境变量名和是否存在，token 值和 Authorization header 永远不能进入页面数据。

## Requirement: Project Knowledge Record

### Scenario: Record 的状态、来源和权威

内部对象是 `ProjectKnowledgeRecord`，包含稳定记录 ID、稳定 repository/project ID、类型、标题、摘要、适用路径、操作、带 project-relative source/anchor 的结论、可选一跳关系、验证信息、来源版本和更新时间。

Record 状态只有 `active | needs-review | retired`，权威只有 `automatic | user`。产品不向用户暴露 `unit`、`origin`、`maintained`、`generated` 或 `draft` 术语。Record 存储在用户数据目录，项目目录不生成 Project Knowledge Markdown 或数据库文件。

## Requirement: Provider contract

### Scenario: 所有调用方使用 status/query/apply

领域层只依赖：

```ts
interface ProjectKnowledgeProvider {
  status(): Promise<ProjectKnowledgeStatus>;
  query(request: ProjectKnowledgeQueryRequest): Promise<ProjectKnowledgeQueryResult>;
  apply(mutation: ProjectKnowledgeMutation): Promise<ProjectKnowledgeApplyResult>;
}
```

`query` 支持有界的 search、list 和 get；`apply` 支持 upsert、correct、retire 和 refresh。CLI、Dashboard、上下文桥接、学习服务和 Plugin Runtime 都只能通过该接口工作，不直接访问 SQLite 表或 Remote HTTP。

## Requirement: Local Provider

### Scenario: 仓库级 Record 与 workspace 级索引

Local Provider 使用用户数据目录中按稳定 repository ID 隔离的 SQLite。主工作区和 linked worktree 共享 Record 权威状态；源码、文档 section 和 FTS 投影按 workspace ID 分区，避免不同分支的正文串线。

数据库包含权威 Record 表和可重建的 workspace section/FTS 投影，使用 WAL、短事务、有限 busy timeout 和现有来源读取上限。投影损坏或结构不兼容时重建可派生投影，不删除有效 Record；本功能未上线，不实现旧 schema 迁移。

Local search 按以下顺序工作：构造 task/path/phase/operation 查询；在现有时间预算内刷新变化来源；搜索 active Record、section FTS 和有界 ripgrep；确定性融合并按路径、来源和类型排序；只从已命中的 Record 做带来源的一跳关系扩展；返回前重新核对每个来源。

来源、anchor 或 fingerprint 不再有效时，Record 变为 `needs-review` 并排除当前上下文。用户权威 Record 保留纠正文案，但来源无效时同样停止注入。

## Requirement: Remote Provider

### Scenario: Remote 使用可扩展的 provider.v1 协议

Remote 使用 `comet.project-knowledge.provider.v1`。`status`、`query` 和 `apply` 都是配置 endpoint 上的 operation；请求包含 operation、scope、稳定 project ID 和有界输入。

query 只发送有界 task、project-relative path、phase、operation、limit 或 list/get selector。apply 只发送 Record 结论、project-relative 来源、适用范围和验证信息，不发送完整 transcript、完整 diff、命令日志、凭据、token 值或整个仓库。

无效响应、超时、非成功响应或超出响应大小限制时返回空结果或失败 apply 和有界诊断；不得查询 Local，也不得向 Remote 泄露 Local 项目正文。

## Requirement: 自动学习

### Scenario: 成功验证后自动激活

工作流只提交有界的 `verification.completed`、`change.completed` 和结构化 `task.completed` 事件，包含 changed paths、artifact refs、验证命令/结果和成功状态，不持久化完整聊天、diff、日志或命令输出。

确定性提取器和可选语义 reviewer 产生 Record mutation。每个验证结果都成功、每个结论来源都仍有效时，automatic Record 直接成为 active，不要求用户打开或确认 Dashboard。相同语义身份执行更新而不是重复创建。

retired automatic Record 不能从相同 source versions 直接复活；新的可验证来源版本才可以形成新记录或更新。自动学习不得覆盖 user Record 的 summary/conclusions，只能更新来源状态并标记 needs-review。学习、reviewer 或 Provider 失败不阻塞 workflow，保留原有效状态并记录有界诊断。

## Requirement: 用户管理

### Scenario: CLI 和明确用户操作

CLI 提供：

```text
comet knowledge list [path]
comet knowledge get [path] --id <id>
comet knowledge correct [path] --id <id> --text <text>
comet knowledge forget [path] --id <id>
comet knowledge query [path] --task <task>
comet knowledge rebuild [path]
comet knowledge status [path]
```

correct 使用户文本成为 user authority 并重新核对现有来源；来源仍无效时保留正文但维持 needs-review。forget retire Record 并保留足够 source identity，防止相同旧自动内容立即复活。rebuild 刷新当前 Local workspace 投影并请求选定 Provider refresh。不存在 `knowledge units`、`share`、`share-memory` 或项目文件导出命令。

## Requirement: Dashboard

### Scenario: Dashboard 配置 Provider 并管理记录

Dashboard 通过 Plugin Runtime 提供 Provider 配置、Provider 状态、active/needs-review/retired 列表、标题/摘要、适用路径、来源、更新时间、查询预览、correct、forget、refresh 和有界诊断。

Remote 配置表单只接受 endpoint、token 环境变量名、scope 和 timeout，永远不接受或展示 token 值。页面所有动作都调用 Provider capability，成功后重新加载页面；Dashboard 不是自动学习或检索的前置条件。现有 pause/resume/uninstall 生命周期继续由 Dashboard host 管理。

## Requirement: 上下文注入

### Scenario: 只注入当前有效的项目知识

Project Knowledge 继续使用独立的 `<project_knowledge>` 区块；它明确说明内容只是证据，不能覆盖用户请求、系统约束、Skill 或 workflow。只有 active 且来源有效的结果可以注入，并始终展示来源。

保留现有边界：最多四条结果、单条最多 1,600 字符、总计最多 5,000 字符。Personal Memory 继续使用独立的 `<personal_memory>` 区块和独立预算。

## Requirement: 失败隔离

### Scenario: Provider 和索引失败不阻塞 workflow

查询失败时任务继续且不注入 Project Knowledge；apply 失败时保留上一状态并记录诊断；Remote 失败不回退 Local；Local 投影损坏时重建或使用有界 ripgrep，同时保留有效 Record；来源失效时停止注入；Provider 被停用或卸载时不查询、不学习、不打开 SQLite、不运行 ripgrep、不发送网络请求。

SQLite 锁超时、FTS 不可用、来源不可读和 reviewer 失败都使用有界诊断，不阻塞 Native、Classic、hotfix 或 tweak。

## Requirement: 一致性与发布

### Scenario: 文档、代码、测试和发布说明一致

完成后，中英文操作文档、正式 Project Knowledge Spec、CLI、Dashboard、Provider 协议、自动学习、上下文注入和 `0.4.0-rc.1` Changelog 必须描述同一最终用户行为。Changelog 只写用户从 `0.4.0-beta.19` 升级可感知的最终行为，不写内部重构、开发过程或普通回归测试。

最终验证覆盖相关 Vitest、Dashboard source/host/Playwright、format、lint、build、全量测试、Project Knowledge Retrieval Eval 和 Native Verify。旧 Unit 产品路径的删除必须有主动搜索证据。

## Requirement: Legacy Unit 产品路径

### Scenario: 未上线 Unit 模型完全移除

由于该能力尚未正式上线，直接删除 Unit repository、Unit schema、Markdown renderer/parser、`docs/comet/knowledge/units/` 发现/写入逻辑、`maintained/generated/draft` 状态、`knowledge units`、`share` 和 `share-memory`。不提供旧格式迁移、兼容读取、别名或导出路径。

历史 archive、research 和设计记录可以保留作为历史资料，但它们不能被活跃产品代码、CLI、Dashboard 或正式当前 Spec 当作运行时入口。

## Non-goals

- 不实现 Local/Remote 双写、自动同步、离线队列、能力协商或 Provider marketplace。
- 不实现后台服务、embedding、向量数据库、通用图数据库或新的项目规则子系统。
- 不把 Personal Memory 项目偏好自动复制为 Project Knowledge。
- 不让 Project Knowledge 授权提交、推送、删除、发布或绕过 workflow。
