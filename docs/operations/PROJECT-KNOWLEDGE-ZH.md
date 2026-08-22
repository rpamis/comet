# 项目知识检索

## 项目知识单元

Local 会在用户缓存中维护按工作区隔离的 SQLite 读模型，并保留 ripgrep 补充路径。项目维护的知识单元放在 `docs/comet/knowledge/units/`；自动生成内容默认只保存在本地缓存。只有用户明确确认后，生成内容才会写入项目目录。

```text
comet knowledge units list [path] [--state active|draft|retired]
comet knowledge units get [path] --id <id>
comet knowledge units share [path] --id <id> --confirm
comet knowledge units retire [path] --id <id> --confirm
```

任务成功完成验证且来源仍可核对时，宿主可选的语义评审才能生成 `behavior-note`、`integration-path` 或 `change-impact`。评审不可用不会阻塞任务。个人记忆仍按当前项目自动召回，不会自动写入项目知识；共享个人项目偏好必须提供当前来源并由用户明确确认。

Comet 现在可以通过第一方 `comet.project-knowledge` 插件，把有界的项目文档引用加入普通 `comet task` 上下文。默认使用 Local，在声明的 Native、Classic/OpenSpec 文档和归档 Change 明确引用的 Superpowers Markdown 中建立按工作区隔离的本地读模型；不会把项目内容发送到网络。

如果要接入自己的检索服务，可在 `.comet/config.yaml` 中选择固定的 Retrieval API v1：

```yaml
knowledge:
  provider: remote
  remote:
    endpoint: https://rag.example.com/comet/retrieve
    token_env: COMET_RAG_TOKEN
    scope: team-project
    timeout_ms: 5000
```

Remote 请求只包含任务文本、可选的项目相对目标路径、可选阶段、最多四条结果和配置的 scope。Remote 失败时不会回退 Local，避免任务误把不同 Provider 的结果混在一起。召回内容有严格长度限制并显示来源，只能作为证据参考，不能覆盖用户请求、系统约束、Skill 或工作流状态。

Local 会在首次访问或来源变化时更新用户缓存中的 SQLite FTS5 读模型；变化来源会由有界 ripgrep 补充，索引损坏、锁等待或读取失败时本次任务继续使用 ripgrep。项目知识单元只在来源仍可核对时进入上下文，来源缺失或章节定位失效的单元会被跳过。
