# 项目知识

Project Knowledge 是当前项目的工程知识层。它记录项目结构、模块职责、行为说明、集成路径、影响范围和验证方式，帮助 Agent 在任务开始和需要时找到相关上下文；代码、配置、测试和当前工作流状态始终是最终依据。

## 存储与 Provider

默认使用 Local Provider。项目知识保存在用户数据目录的按项目、按工作区隔离的 SQLite 中，不在项目目录创建知识文件，也不会修改项目仓库。Local 会索引 Comet 管理的 Native/Classic 文档、归档文档和受限的确定性项目结构信息，并用有界 ripgrep 补充当前文件内容。

可选使用 Remote Provider，让团队通过外部项目知识服务共享记录：

```yaml
knowledge:
  provider: remote
  remote:
    endpoint: https://knowledge.example.com/provider
    token_env: COMET_KNOWLEDGE_TOKEN
    scope: team-project
    timeout_ms: 5000
```

Local 与 Remote 是二选一。Remote 只接收任务、项目相对路径、阶段、操作和有界查询参数；token 只从环境变量读取。Remote 失败不会偷偷回退 Local，避免同一任务混入两个来源的结果。

Provider 统一实现三类能力：`status` 查看状态，`query` 搜索/列出/读取记录，`apply` 新建、纠正、退役或刷新记录。这个接口为未来接入 mem0 等外部存储保留稳定位置，但本期不实现 mem0 适配器。

## 记录与学习

项目知识记录是有来源的最小工程事实，包含稳定 ID、类型、状态、权威级别、摘要、适用路径、操作、带来源的结论、关系和验证方式。

- Local 生命周期事件会触发有界的确定性学习；结构、模块和构建测试记录在来源可核对时自动进入 active。
- 可选的语义评审只能补充有来源的行为、集成和影响记录，评审不可用不会阻塞任务。
- 用户纠正后的记录使用 `user` 权威级别，自动学习不会覆盖用户维护的摘要和结论。
- 来源变化或删除会让记录进入 `needs-review`，不会继续把过期事实注入上下文。
- 个人记忆仍由 Personal Memory 独立管理。个人偏好不会自动复制到 Project Knowledge，也没有本期的“共享个人记忆”操作。

## 上下文注入

Plugin Bridge 在任务上下文收集阶段调用当前 Provider 的有界搜索，将记录和文档 section 渲染为独立的项目知识参考。Personal Memory 和 Project Knowledge 保持独立存储、预算和管理动作，二者可以同时注入但不会互相写入。

注入内容会限制来源、条数和总字符数，并明确标注为证据参考，不能覆盖用户请求、系统约束、Skill 或工作流状态。没有可靠命中时不注入空壳内容。

## 用户操作

CLI 提供：

```text
comet knowledge status
comet knowledge query <task>
comet knowledge list [--state active|needs-review|retired|all]
comet knowledge get --id <id>
comet knowledge correct --id <id> --text <text>
comet knowledge forget --id <id>
comet knowledge rebuild
```

Dashboard 提供相同范围的状态、记录列表、查询预览、Provider 配置、纠正、忘记和刷新操作。Remote 配置只保存 endpoint、scope、超时和 token 环境变量名，不保存 token 值。
