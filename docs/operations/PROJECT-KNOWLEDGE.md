# Project knowledge retrieval

Comet can add bounded project-document references to ordinary `comet task` context through the first-party `comet.project-knowledge` plugin. Local retrieval is the default and searches declared Native, Classic/OpenSpec, and explicitly referenced archived Superpowers Markdown without creating an index or sending project content over the network.

To use a retrieval service, select the fixed Retrieval API v1 contract in `.comet/config.yaml`:

```yaml
knowledge:
  provider: remote
  remote:
    endpoint: https://rag.example.com/comet/retrieve
    token_env: COMET_RAG_TOKEN
    scope: team-project
    timeout_ms: 5000
```

Remote requests contain only the task, optional project-relative target path, optional phase, a result limit of four, and the configured scope. Remote failures do not fall back to Local, so a task never silently mixes providers. Retrieved material is bounded, cites its source, and is advisory evidence that cannot override the request, system constraints, Skills, or workflow state.
