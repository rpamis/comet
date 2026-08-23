# Project Knowledge

Project Knowledge is the engineering knowledge layer for the current project. It records project structure, module responsibilities, behavior, integration paths, change impact, and verification guidance so the Agent can find relevant context when a task starts or needs it. Code, configuration, tests, and current workflow state remain authoritative.

## Storage and providers

Local Provider is the default. Project Knowledge is stored in a user-data SQLite database isolated by project and workspace. It does not create knowledge files in the project or modify the repository. Local indexes Comet-managed Native/Classic documents, archived documents, and bounded deterministic project-structure facts, with bounded ripgrep used to supplement current file content.

An optional Remote Provider lets a team share records through an external Project Knowledge service:

```yaml
knowledge:
  provider: remote
  remote:
    endpoint: https://knowledge.example.com/provider
    token_env: COMET_KNOWLEDGE_TOKEN
    scope: team-project
    timeout_ms: 5000
```

Local and Remote are mutually exclusive. Remote receives only the task, project-relative path, phase, operation, and bounded query parameters; tokens are read from the environment only. A Remote failure does not silently fall back to Local, so one task never mixes two providers' results.

The provider contract has three operations: `status` reports health, `query` searches/lists/reads records, and `apply` creates, corrects, retires, or refreshes records. This contract leaves a stable place for a future mem0-backed provider, but this release does not implement a mem0 adapter.

## Records and learning

A Project Knowledge record is a source-backed engineering fact with a stable ID, type, state, authority, summary, applicable paths, operations, sourced conclusions, relations, and verification guidance.

- Local lifecycle events trigger bounded deterministic learning; structure, module, and build/test records become active when their sources can be checked.
- An optional semantic reviewer may enrich sourced behavior, integration, and impact records. Reviewer unavailability never blocks the task.
- User corrections use `user` authority. Automatic learning does not overwrite user-maintained summaries or conclusions.
- A changed or deleted source moves a record to `needs-review`; stale facts are not injected into context.
- Personal Memory remains independently managed. Personal preferences are not copied into Project Knowledge, and this release has no “share personal memory” operation.

## Context injection

During task context collection, the Plugin Bridge calls the active provider with a bounded search and renders records and document sections as a separate Project Knowledge reference. Personal Memory and Project Knowledge keep separate storage, budgets, and management operations; both may be injected without writing into each other.

Injected content is bounded by source, count, and total characters and is explicitly marked as advisory evidence. It cannot override the user request, system constraints, Skills, or workflow state. No empty placeholder is injected when there is no reliable match.

## User operations

The CLI provides:

```text
comet knowledge status
comet knowledge query <task>
comet knowledge list [--state active|needs-review|retired|all]
comet knowledge get --id <id>
comet knowledge correct --id <id> --text <text>
comet knowledge forget --id <id>
comet knowledge rebuild
```

Dashboard provides the same scope of status, record list, query preview, provider configuration, correction, forgetting, and refresh. Remote configuration stores only the endpoint, scope, timeout, and token environment-variable name; it never stores the token value.
