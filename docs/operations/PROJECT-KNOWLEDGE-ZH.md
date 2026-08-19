# 项目知识检索

Comet 现在可以通过第一方 `comet.project-knowledge` 插件，把有界的项目文档引用加入普通 `comet task` 上下文。默认使用 Local，在声明的 Native、Classic/OpenSpec 文档和归档 Change 明确引用的 Superpowers Markdown 中即时检索；不会建立索引，也不会把项目内容发送到网络。

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
