# Project knowledge retrieval

## Project knowledge units

Local retrieval maintains a workspace-isolated SQLite read model in the user cache and keeps ripgrep as a bounded supplement. Maintained units live under `docs/comet/knowledge/units/`; generated units remain local until the user explicitly confirms sharing.

```text
comet knowledge units list [path] [--state active|draft|retired]
comet knowledge units get [path] --id <id>
comet knowledge units share [path] --id <id> --confirm
comet knowledge units retire [path] --id <id> --confirm
```

After a task completes verification and its sources remain checkable, an optional host semantic reviewer may propose `behavior-note`, `integration-path`, or `change-impact` units. Reviewer failures never block the task. Personal Memory continues to retrieve project preferences for the current project and never copies them into Project Knowledge automatically; sharing a preference requires current sources and explicit confirmation.

Comet can add bounded project-document references to ordinary `comet task` context through the first-party `comet.project-knowledge` plugin. Local retrieval is the default and maintains a workspace-isolated local read model over declared Native, Classic/OpenSpec, and explicitly referenced archived Superpowers Markdown without sending project content over the network.

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
