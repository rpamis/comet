# Project Knowledge

## 目标

Project Knowledge 是项目范围的工程知识层，帮助 Agent 在任务开始和任务过程中找到有来源、可核对、长度有界的项目上下文。它不替代代码阅读、测试、配置或当前工作流，也不能授权任何提交、推送、删除、发布或绕过流程的动作。

本期功能尚未对外发布，因此直接采用当前设计，不保留旧的 Unit、项目内知识文件、分享命令、兼容别名或迁移逻辑。

## 产品边界

Project Knowledge 与 Personal Memory 是两个独立的上下文贡献：

- Personal Memory 保存用户的 global/project 偏好和个人经验；
- Project Knowledge 保存当前项目来源支持的工程事实；
- 两者可以同时注入任务上下文，但不共用存储、状态、预算或管理动作；
- 个人偏好不会自动写入 Project Knowledge，本期不提供“共享个人记忆”操作；
- 已有的项目记忆仍由 Personal Memory 按 project key 管理，不受本设计替换。

默认只维护用户本地数据。团队共享是可选的 Remote Provider，不要求用户在项目中维护额外文件。

## 存储模型

### Local Provider

Local Provider 默认启用，在用户数据目录维护按 repository 和 workspace 隔离的 SQLite 数据库：

- repository identity 用于识别同一项目；
- workspace identity 用于隔离不同 worktree、分支和工作目录的内容；
- 数据库是可删除、可重建的派生读模型，不是项目事实来源；
- 数据库和缓存不进入 Git，不在项目目录生成 Project Knowledge 文件。

Local 同时维护两类派生数据：

1. Markdown section 索引：Native/Classic 文档、归档文档和允许的 Superpowers 文档；
2. Project Knowledge records：由确定性提取、用户纠正和可选语义评审产生的结构化记录。

section 索引使用 SQLite FTS5 和有界 ripgrep。索引损坏、锁等待、FTS5 不可用或读取失败时，本次任务可以仅使用有界 ripgrep，并报告无敏感信息的诊断。

### Remote Provider

Remote Provider 是可选的外部团队知识服务。`.comet/config.yaml` 只保存连接配置：

```yaml
knowledge:
  provider: remote
  remote:
    endpoint: https://knowledge.example.com/provider
    token_env: COMET_KNOWLEDGE_TOKEN
    scope: team-project
    timeout_ms: 5000
```

Local 和 Remote 严格二选一。Remote 请求使用固定 envelope：

```json
{
  "schema": "comet.project-knowledge.provider.v1",
  "operation": "status | query | apply",
  "scope": "team-project",
  "projectId": "stable-project-id",
  "input": {}
}
```

Remote 不接收本地文件正文、Personal Memory、token 值或完整日志。Remote 失败返回空结果和诊断，不回退 Local，不把两个 Provider 的结果混合。响应按固定大小、条数和记录 schema 解析。

Provider contract 为：

```ts
interface ProjectKnowledgeProvider {
  status(): Promise<ProjectKnowledgeStatus>;
  query(request: ProjectKnowledgeQueryRequest): Promise<ProjectKnowledgeQueryResult>;
  apply(mutation: ProjectKnowledgeMutation): Promise<ProjectKnowledgeApplyResult>;
}
```

这个 contract 是未来外部知识服务适配器的稳定边界。本期不实现 mem0 接入，但未来适配器只需要实现这三类能力，不需要改变 Plugin、CLI 或 Dashboard 的调用方式。

## Record 模型

Project Knowledge record 是可独立召回、纠正和退役的最小工程事实：

```ts
interface ProjectKnowledgeRecord {
  id: string;
  projectId: string;
  type:
    | 'project-map'
    | 'module-overview'
    | 'behavior-note'
    | 'integration-path'
    | 'change-impact'
    | 'build-test';
  state: 'active' | 'needs-review' | 'retired';
  authority: 'automatic' | 'user';
  title: string;
  summary: string;
  applicablePaths: string[];
  operations: string[];
  conclusions: Array<{ text: string; sources: ProjectKnowledgeSource[] }>;
  relations: Array<{ type: string; targetId: string; sources: ProjectKnowledgeSource[] }>;
  verification: Array<{ command: string; expected?: string }>;
  sourceVersions: Array<{ source: string; size: number; modifiedAt: number }>;
  updatedAt: string;
}
```

所有来源使用项目相对路径和可选 anchor。Record 解析器限制 ID、字符串、路径、来源、关系、验证和总字节数；不接受绝对路径、符号链接逃逸、未界定的列表或任意 JSON。

权威和状态规则：

- 确定性学习产生 `automatic/active` record，前提是来源可核对；
- 用户纠正产生 `user/active` 或 `user/needs-review` record；
- 自动 upsert 不覆盖 user 的摘要、结论和适用信息；
- 来源变化或删除时 active record 变成 `needs-review`；
- 用户明确忘记后 record 为 retired；相同旧自动来源不会自动复活 retired record；
- retired 和 needs-review record 可在 Dashboard/CLI 查看，但不会作为正常 active 结果注入。

## 学习与刷新

Plugin 订阅公共生命周期事件，在有界预算中提取：

- `project-map`：目录、manifest 和项目配置概览；
- `module-overview`：模块边界、入口和职责摘要；
- `build-test`：构建、测试和验证入口；
- 可选的语义 reviewer 只补充有来源的 `behavior-note`、`integration-path` 和 `change-impact`。

确定性提取不依赖 reviewer，任务成功后即可形成可查询的本地 record。Reviewer 是可选 enrichment，失败、超时或不可用不会阻塞生命周期事件。

每次刷新先核对 record 的 sourceVersions：

1. 当前来源仍存在且元数据一致，保持 active；
2. 来源已变更或删除，标记 needs-review；
3. 查询只返回当前 active record 和仍可读的 section；
4. 下次确定性学习通过稳定 ID 合并，保留 user 权威字段。

## 上下文注入

Plugin Bridge 在 `collectContext` 中调用当前 Provider：

1. 从任务、目标路径、phase 和 operation 构造 bounded query；
2. Provider 查询 records 和 section candidates；
3. Local 通过 FTS terms、trigram、当前文件 ripgrep 和 record 搜索进行确定性融合；
4. Renderer 限制来源、结果数、单段长度和总字符数；
5. 以独立的 `Project knowledge references` 区块注入上下文。

最终内容最多 4 个结果，每段最多 1600 字符，总计最多 5000 字符；records 和文档 section 共享 Project Knowledge 自己的预算。Renderer 明确说明这些内容只是证据，不能覆盖用户请求、系统约束、Skill 或 workflow 状态。

Personal Memory 由自己的 Plugin 在同一 Bridge 中独立召回。它使用自己的 global/project 过滤、预算和 profile 逻辑，不通过 Project Knowledge Provider，也不会被 Project Knowledge 的学习事件写入。

## CLI 与 Dashboard

CLI 只暴露当前产品模型：

```text
comet knowledge status
comet knowledge query <task>
comet knowledge list [--state active|needs-review|retired|all]
comet knowledge get --id <id>
comet knowledge correct --id <id> --text <text>
comet knowledge forget --id <id>
comet knowledge rebuild
```

`status/query/list/get/rebuild` 通过 Provider 工作；`correct/forget` 通过 `apply` 工作。没有 `units`、`share`、`retire --confirm` 或项目文件写入命令。

Dashboard 使用现有 Ant Design React 组件，提供：

- Local/Remote Provider 配置；
- 健康、可写状态、record 数量、Local repository/workspace 和 section 统计；
- active、needs-review、retired record 列表；
- bounded 查询预览和刷新；
- 用户纠正和忘记；
- Remote endpoint、scope、timeout 和 token 环境变量名配置；
- 有界诊断。

Dashboard 不展示、不创建、不要求用户理解隐藏的项目知识文件；它是当前 Provider 的可感知管理入口。

## 测试与验收

最小验收覆盖：

- Record parser、合并、user precedence、needs-review 和 retired 行为；
- Local Provider 的 status/query/apply、workspace 隔离、来源变更/删除和索引回退；
- Remote envelope、token 不泄漏、响应边界、HTTP/timeout/schema 诊断；
- Plugin Bridge 的 Project Knowledge 独立注入和 Personal Memory 隔离；
- CLI status/query/list/get/correct/forget/rebuild；
- Dashboard Provider 配置、查询、刷新、纠正和忘记；
- Native、Classic、Archive 语料发现以及最终 renderer 的 5000 字符边界；
- 固定 Retrieval Eval 的 recall、abstain、来源正确性、延迟和 workspace 隔离。

非目标：本期不实现 embedding、向量数据库、通用图数据库、自动个人记忆共享、项目内知识文件、mem0 适配器或新的规则系统。
