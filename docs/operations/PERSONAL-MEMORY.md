# Comet Personal Memory

Comet Personal Memory keeps genuinely reusable user preferences and collaboration experience across tasks. It is not a chat transcript or activity log, and it does not store complete conversations, tool output, diffs, hidden reasoning, or facts that are easy to rediscover in the repository.

## Three memory layers

- **Core Profile**: stable language, role, technical background, communication, and output preferences.
- **Collaboration Policy**: personal working practices selected by project, path, task type, operation, or phase.
- **Personal Episode**: a compact successful, corrected, or failed situation with a situation, action summary, outcome, and lesson, used for background reflection or on-demand expansion.

An explicit “remember”, “always do this”, or correction is stored immediately as `proven` and can affect the next task. A request limited to “this time” or “this task” is not persisted. Reusable experience inferred from real feedback starts as low-priority `trial`; one successful application can promote it to `proven`, while rejection, correction, or a contributed failure can rewrite it or mark it `superseded`. Forgetting writes a separate tombstone, so replaying old events cannot restore forgotten content.

## Automatic learning and task use

Classic, Native, Hotfix, and Tweak write structured user signals, task outcomes, verification, Review, and Archive results to the same Experience Journal. Journal capture is the fast path; semantic Reflection runs in bounded background batches, never rejects valid content because of Review Packet size, and does not block the primary workflow. Explicit user signals still use a deterministic immediate path when semantic services are unavailable.

At task start, the Context Director keeps only the full Core Profile and a small set of directly relevant `proven` collaboration policies resident. Other relevant memories enter the Context Manifest with a stable ID, title, summary, source type, and actual `whyApplied`. The Agent expands an ID only when it needs full content, sources, or verification:

```text
comet task . --task "implement a new CLI command" --phase build --session <stable-session-id> --json
comet task . --task "implement a new CLI command" --phase build --session <same-id> --expand-context <id> --json
```

When the path, operation, or phase changes, the same session selects again without redelivering unchanged content. After actually using a memory, the Agent records its application outcome. `used-successfully` can strengthen or promote it; `ignored`, `overridden`, `corrected`, and `contributed-to-failure` affect later ranking, rewriting, or supersession.

The current user request and system constraints always outrank Personal Memory, and Project Policy outranks a personal project habit. Memory never grants authority to commit, push, delete, or publish and never becomes a team rule automatically.

## Dashboard experience

The Personal Memory workspace directly provides Core Profile, Collaboration Policy, Personal Episode, and history/forgotten views without repeating the same large title shown in the sidebar. Each record shows `trial`, `proven`, or `superseded`, its scope, evidence summary, recent outcome, and why it was applied. Users can add, correct, forget, roll back, and expand records. The current Context Manifest is previewable and the full application history is expandable.

The page renders its cached snapshot first and refreshes in the background; Reflection does not block first paint. The unified settings panel configures only Provider, learning, retrieval, synchronization, and per-injection context budgets. It does not present storage size or Review Packet size as a user capacity limit.

## View and manage

CLI, Dashboard, Skill, and Hook use the same authoritative state:

```text
comet memory list .
comet memory retrieve . --task "implement a new CLI command"
comet memory remember . --text "Answer in Chinese by default" --scope global
comet memory correct . --id <memory-id> --text "Use concise Chinese answers"
comet memory forget . --id <memory-id>
comet memory rollback . --id <memory-id>
comet memory pause . --project <project-key>
comet memory sync .
comet memory status .
```

Use `remember` for an explicit long-term user preference; it takes effect immediately. `observe` is only for an implicit, stable collaboration practice that the Agent found reusable across tasks and must not contain task summaries, progress, command output, or test results. `forget` keeps rollback history by default; permanent deletion requires the explicit `--permanent` flag.

## Configuration, providers, and storage

The project `.comet/config.yaml` controls automatic learning and retrieval:

```yaml
memory:
  learning: true
  retrieval: true
```

Disabling learning does not delete existing records, and disabling retrieval does not prevent Dashboard or explicit management operations. The user-level `~/.comet/config.yaml` selects the Local or Remote Provider and configures per-injection budgets:

```yaml
personal_memory:
  provider: remote
  profile_char_limit: 2000
  task_context_char_limit: 6000
  remote:
    endpoint: https://memory.example.test/provider
    token_env: COMET_MEMORY_TOKEN
    profile: default
```

Character budgets determine only how much full text stays resident in one Agent Context. Overflow becomes Manifest items; it does not reject saves, truncate authoritative records, or produce byte-budget errors. Providers have no fixed record count or user-visible total-capacity limit.

The Local Provider retains readable `profile.md`, `projects/<project-key>.md`, user-level Runtime state, and optional private Git synchronization. Markdown is the management projection and rebuildable input. A repository's main workspace and worktrees share a stable project identity, while different repositories remain isolated. Remote uses a fixed versioned protocol, and token values stay only in environment variables. A Remote failure does not silently switch to Local.

Explicit add, correct, forget, rollback, expand, or settings failures return their real error and preserve prior state. Background capture, Reflection, feedback, or retrieval failures record diagnostics while the current workflow continues.
