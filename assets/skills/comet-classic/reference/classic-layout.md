# Classic Artifact Layout

When entering the phase of a selected change, use layout returned by the current `comet state check <change-name> <phase> --json`; do not query layout separately. Run this command at the project root only before a change is selected, when entry omits layout, or when working only on root migration:

```bash
comet classic root show
```

Accept only `schema: comet.classic-layout.v1`. Map layout's `openSpecRoot`, `changesRoot`, `archiveRoot`, `specsRoot`, and `superpowersRoot` to the actual directories for `<classic-open-spec-root>`, `<classic-changes-root>`, `<classic-archive-root>`, `<classic-specs-root>`, and `<classic-superpowers-root>`. Use the entry's changeDir for `<classic-change-dir>`; construct it from changesRoot and name only before the change exists. Do not construct archived paths using active-change directory rules. Use the returned layout for this invocation. Refresh it when session recovery lacks context or the workspace changes, rather than reusing old directory information.

## Command Rules

- This Skill and other Comet-owned Classic Skills must invoke the official OpenSpec CLI through this adapter:

  ```bash
  comet classic openspec -- <args...>
  ```

- The adapter runs the official CLI in the configured OpenSpec root and preserves stdout, stderr, and exit code. Do not register or query a separate OpenSpec store for the same repository.
- To obtain a directly executable next command, use `comet classic openspec --agent-json -- <args...>`. Read OpenSpec JSON from `data.upstream.data` and retain `data.upstream.cwd/stdout/stderr/exitCode` for diagnosis. Execute `data.nextAction` with its complete argv and cwd. Raw nextSteps assume the OpenSpec root as cwd and cannot be copied directly to the project root. Calls without `--agent-json` still return OpenSpec output unchanged.
- Direct `openspec` use is allowed only when the user explicitly requests the official CLI in the resolved OpenSpec root.

## Path Rules

- Absolute paths are for file I/O only. `data.artifactRefs` supplies repository-relative paths: `change`, `tasks`, `designDoc`, `plan`, `plansRoot`, and `handoffContext`. Use `change` as `<classic-change-ref>` and `tasks` as `<classic-task-authority-ref>`. State path fields and plan `comet-task-authority` must use those relative paths, not absolute `<classic-change-dir>`. Construct a new plan's relative path from `plansRoot` and its filename, then resolve it through `projectRoot` for file I/O. Custom paths must also be project-root-relative and cannot include `..`, cross-project links, or another change's task list.
- File paths for changes, tasks, delta specs, handoffs, and archives must use the resolved `<classic-*>` roots; for example, tasks use `<classic-change-dir>/tasks.md`. Renaming a hard-coded directory in prose does not suffice if actual I/O still uses that directory.
- Superpowers files use `<classic-superpowers-root>/...`; do not derive that path from the OpenSpec root or current cwd.
- `comet state`, `comet guard`, `comet handoff`, and `comet archive` resolve layout internally. Never write a physical root into `.comet/current-change.json`.
- If root show or any write command reports conflicting legacy/docs roots, invalid configuration, or unfinished migration, stop writes immediately and run read-only `comet doctor`. Do not scan both roots and guess ownership, or write to both.

## New Projects, Existing Projects, and Migration

- New Classic projects default to `docs/openspec/`.
- For backward compatibility, a project without `classic.artifact_layout` uses root-level `openspec/` (legacy). New-project init explicitly writes docs. If `comet update` finds existing `openspec/` artifacts, it records `legacy` without moving them.
- Ordinary init/update does not move existing artifacts. Inspect with `comet classic root move docs --dry-run`; after user confirmation, migrate with `comet classic root move docs --apply`. Runtime records the migration identifier and rechecks migration conditions while holding the lock.
- Migration moves the entire old-layout directory unchanged, including active, unmanaged, and incompletely archived changes. Those change states do not block root migration.
