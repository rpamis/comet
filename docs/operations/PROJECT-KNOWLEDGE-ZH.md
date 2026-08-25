# 项目知识与项目策略

Project Knowledge 是当前项目的可追溯工程知识层。它帮助 Agent 理解“项目是什么”和“以后怎样做”，但不会覆盖当前用户要求、系统约束、当前源码、配置或测试。用户仍通过一个“项目知识”中心管理这项能力。

## 两类项目记忆

- **Project Model（项目模型）**：`topology`、`fact`、`dependency`，描述目录、模块、依赖和可核对的项目事实。
- **Project Policy（项目策略）**：`decision`、`pattern`、`procedure`、`constraint`、`failure-resolution`，描述已接受的决策、稳定做法、操作流程、约束和故障解决经验。

记录使用统一 lifecycle：

- `trial`：一次可信推断，允许低优先级召回；
- `proven`：用户明确项目约定、当前确定性事实或成功复用支持的稳定内容；
- `enforced`：仅用于绑定当前存在且已经成功执行的确定性验证命令的 Project Policy；
- `superseded`：来源失效、验证命令消失、被纠正或被更高优先级决定替代，不再注入。

Project Policy 不是第二套 Rule 文件。仓库已有的 AGENTS、Rule、代码、配置、测试和检查始终是更高优先级证据；Comet 只建立可检索模型和 activation，不静默修改这些文件。

## 自动沉淀节点

Project Model Builder 会消费仓库变化、结构化验证和 Change 归档结果，并结合 manifest、配置、目录结构、有限源码关系以及自定义 Markdown corpus 更新项目模型。

Project Policy Learner 会从以下已闭环事件学习：

- Review 结论已被接受并处理：形成 decision 或 constraint；
- 失败已有根因、修复和成功复验：形成 failure-resolution；
- 验证完成：连接真实成功命令并校准相关策略；
- Change 已归档：沉淀最终决策、稳定 pattern、procedure 和废弃项；
- 上下文使用结果：强化、改写或替代 trial 策略。

Experience Journal 先快速持久化事件，Reflection 再在后台按 episode、changed paths 和 evidence 分批处理。语义 reviewer 不可用时，确定性项目模型和验证关联继续工作，语义策略稍后重放，不阻塞 Classic 或 Native 工作流。

## 本地文档路径与 Provider

Local Provider 默认使用用户数据目录中按稳定 repository ID 隔离的 SQLite。主工作区和 linked worktree 共享 Record，具体文档 section/FTS 按 workspace 隔离并可重建。Local 会索引 Comet 管理的 Native/Classic 文档、归档文档、确定性项目结构，以及 `knowledge.local.include` 指定的 Markdown glob：

```yaml
knowledge:
  provider: local
  local:
    include:
      - docs/**/*.md
      - packages/*/README.md
      - architecture/**/decisions-*.md
```

路径相对项目根目录，支持多个 glob。来源在每次注入前核对；文件变化、删除或 selector 失效后，旧记录会变为 `superseded`，新证据形成新版本。

团队也可以配置严格二选一的 Remote Provider：

```yaml
knowledge:
  provider: remote
  remote:
    endpoint: https://knowledge.example.com/provider
    token_env: COMET_KNOWLEDGE_TOKEN
    scope: team-project
    timeout_ms: 5000
```

Remote 只接收有界 task/path/phase/operation、规范化 Record 和 evidence，不发送完整仓库、完整 diff、日志、个人记忆或凭据。Remote 失败不会静默回退 Local。

## Agent 如何使用

任务开始时，Context Director 先按 project、path、operation、phase、kind 和 state 过滤，再结合 FTS、有限 ripgrep、关系、来源新鲜度和真实 application feedback 排序。少量关键 `proven/enforced` Project Policy 可以完整注入；Project Model、trial Policy、长 Procedure 和 evidence 默认进入 Context Manifest。

Manifest 每项包含稳定 ID、标题、摘要、来源类型和真实 `whyApplied`。Agent 只在需要正文、来源或验证方式时按 ID 展开：

```text
comet task . --task "修改身份验证模块" --path src/auth --operation edit --phase build --session <id> --json
comet task . --task "修改身份验证模块" --session <同一id> --expand-context <id> --json
```

实际应用结果会反向影响排序和 lifecycle。Context 预算只限制一次注入的常驻正文，不限制 Provider 总记录数、索引文档数或 Reflection 输入。

## Dashboard 与 CLI

项目知识中心直接提供“项目模型”和“项目策略”视图，不重复显示与侧边栏相同的大标题。模型按 topology/fact/dependency 浏览；策略按 decision/pattern/procedure/constraint/failure-resolution 浏览。列表和详情展示 lifecycle、作用范围、来源、验证方式、`whyApplied`、最近应用结果、更新时间和完整 application history，并提供当前 Context Manifest 预览。

用户可以在 Dashboard 手动新增项目知识或策略、纠正、废弃、展开来源和刷新。首屏优先显示缓存 snapshot，后台学习和索引刷新不阻塞页面。

CLI 提供相同权威状态的查询与管理入口：

```text
comet knowledge status .
comet knowledge query . --task "修改身份验证模块" --path src/auth --phase build --operation edit
comet knowledge list . --state proven
comet knowledge get . --id <记录标识>
comet knowledge correct . --id <记录标识> --text <新说明>
comet knowledge forget . --id <记录标识>
comet knowledge feedback . --id <记录标识> --outcome used-successfully
comet knowledge rebuild .
```

查询或后台学习失败时，当前任务继续且不注入失败内容；纠正或废弃失败时保持原状态。插件停用或卸载后不会学习、查询、运行策略验证、打开 SQLite 或发送网络请求。
