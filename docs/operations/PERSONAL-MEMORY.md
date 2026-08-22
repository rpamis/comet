# Comet Personal Memory

Comet Personal Memory keeps reusable personal preferences, collaboration habits, and verified experience across sessions. It is not an activity log and does not store every command, test result, or full conversation.

## What you will experience

- When you explicitly say “remember”, “always do this”, “change it to”, or “forget”, Comet acts immediately and gives a short confirmation or error.
- A bounded background review runs at stable successful workflow checkpoints. When there is nothing durable to save, the review is skipped, or the same observation repeats, nothing is shown by default.
- You see a short notice only when a memory first changes how a later task is handled or when a conflict needs attention.
- Memory is kept in readable Markdown: global preferences in `profile.md` and project experience normally uses a readable project name, such as `projects/comet.md`. Comet keeps an internal project key for precise association, so the main worktree and worktrees of the same repository use the same project memory. You can inspect and edit these files directly.

## What is worth remembering

Good candidates include:

- long-term preferences for output, language, or collaboration;
- personal working habits validated across multiple successful tasks;
- project-specific experience that is likely to be useful again.

Comet normally skips:

- one-off commands, an individual test result, and commit/Issue/PR summaries;
- ordinary facts that are easy to find again in the repository;
- guesses, activity logs, complete logs, complete diffs, and complete transcripts;
- secrets, credentials, PII, prompt injection, and requests to modify Skills, agent instructions, or project policy files.

## Language and scope

The active project `language` in `.comet/config.yaml` controls the language of automatically generated memory:

- `zh-CN`: generated text, titles, categories, tags, and reasons are in Chinese;
- `en`: the same content is in English;
- memory text entered directly through the CLI remains in the original language and is not silently translated.

Automatic observations default to the current project scope. Only an explicitly cross-project preference, or a preference you explicitly save globally, becomes global memory. Current-project retrieval can use applicable global and project memories, but one project’s experience is never silently promoted into a rule for every project.

## Project policy

Projects can set a shared upper bound for automatic personal-memory behavior in `.comet/config.yaml`:

```yaml
memory:
  learning: true
  retrieval: true
```

- `learning: false` prevents workflow checkpoints from forming new memories automatically in this project.
- `retrieval: false` prevents personal memories from being injected into Agent context for this project.
- Omitting the block or either field keeps the existing default of `true`.
- These are project policies. A user’s Runtime switches and project pauses can further disable behavior, but cannot override a project policy set to `false`.
- Explicit `comet memory remember`, `retrieve`, `manage`, correction, and forget operations remain available for user-directed memory management.

Project policy is separate from plugin lifecycle. Uninstalling the Personal Memory plugin stops the plugin but does not edit this configuration or delete the memory repository.

## View and manage memory

The CLI and Dashboard use the same authoritative memory state. A change made through either entry point is visible with the same result in the other.

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

`forget` keeps rollback history by default; permanent deletion requires the explicit `--permanent` option. Pausing project memory stops new learning and/or retrieval according to the pause settings, and resuming re-enables it. Retrieval returns only reliable matches in the current scope that have no unresolved conflict and are not paused.

`--project` accepts the internal project key; commands for the current project can usually omit it.

## Markdown and synchronization

Markdown is the user-readable management projection for viewing and editing personal memory. The system handles duplicates, history, conflicts, and retrieval boundaries automatically, so you do not need to maintain any other files. Manual edits or deletions are treated as user intent during the next management or retrieval operation, and background observations do not silently restore removed content.

The current version uses only the readable project filename and does not read or migrate the not-yet-released `projects/<project-key>.md` format. The mapping between the internal project key and the project file is kept in `projectFiles` in `.comet/runtime/memory-state.json` under the personal-memory root. If different repositories use the same project name, Comet adds a short identifier to avoid mixing them.

Personal Memory can sync through a dedicated Git remote. Without a remote, local recording, viewing, and retrieval continue to work. If the remote is unavailable, authentication fails, or synchronization conflicts, local memory remains available and you can retry with `comet memory sync`. Conflicts are not silently overwritten by the last writer; you can inspect, correct, or roll back the memory.

## Classic and Native

Classic, Native, Hotfix, and Tweak share one fixed first-party `comet-memory` Skill and Personal Memory capability. Workflows provide only small, trusted checkpoint facts; the memory reviewer does not scan the full repository, read the full conversation, or modify any Skill. If memory is unavailable or a background operation fails, the primary workflow still completes according to its normal behavior.

## Boundaries

Personal Memory helps Comet use your long-term preferences and reusable experience. It does not automatically become a team standard and does not modify Skills, agent instructions, code, tests, or build configuration. You can always view, correct, forget, roll back, pause, or sync your own memories.
