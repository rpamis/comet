# Classic Artifact Layout Protocol

For a selected change, use layout from this turn's `comet state check <change-name> <phase> --json` without a separate root query. Run the following from the project root only before selecting a change, when entry does not provide layout, or when handling root migration alone:

```bash
comet classic root show
```

Accept only `schema: comet.classic-layout.v1`. Bind the returned `openSpecRoot`, `changesRoot`, `archiveRoot`, `specsRoot`, and `superpowersRoot` as `<classic-open-spec-root>`, `<classic-changes-root>`, `<classic-archive-root>`, `<classic-specs-root>`, and `<classic-superpowers-root>`, respectively, use the actual changeDir returned by entry for `<classic-change-dir>`. Construct it from changesRoot and name only before creating a change. Do not construct an active path for an archived change. Layout is the source of truth for this turn; refresh it through entry on cold recovery or workspace changes rather than retaining old bindings.

## Command rules

- This and every other Comet-owned Classic Skill must call the official OpenSpec CLI directly through:

  ```bash
  comet classic openspec -- <args...>
  ```

- The adapter runs the official CLI from the configured OpenSpec base and preserves stdout, stderr, and the exit code. Do not register or query an OpenSpec store for a root inside the same repository.
- For executable follow-ups, use `comet classic openspec --agent-json -- <args...>`. Read upstream JSON from `data.upstream.data`, retaining `data.upstream.cwd/stdout/stderr/exitCode` for diagnostics. Execute the complete argv and cwd from `data.nextAction`. Raw nextSteps belong to the upstream base, so do not execute them at the project root. The ordinary adapter retains its existing passthrough contract.
- Run `openspec` directly only when the user explicitly operates from the resolved OpenSpec base.

## Path rules

- Absolute paths are for file operations. `data.artifactRefs` supplies repository-relative references: `change`, `tasks`, `designDoc`, `plan`, `plansRoot`, and `handoffContext`. Bind `change` as `<classic-change-ref>` and `tasks` as `<classic-task-authority-ref>`. State path fields and plan `comet-task-authority` markers must use these references, not absolute `<classic-change-dir>`. Form a new plan reference from `plansRoot` and its filename; resolve file-operation paths against `projectRoot`. Custom references must also be project-relative without traversal, cross-project links, or another change's task authority.
- Express change, tasks, delta spec, handoff, and archive paths with the `<classic-*>` logical roots bound above; for example, use `<classic-change-dir>/tasks.md`. Do not wrap one physical layout in a logical-path convention and keep using it as filesystem guidance.
- Resolve Superpowers files through `<classic-superpowers-root>/...`; do not derive them from the OpenSpec root or current cwd.
- `comet state`, `comet guard`, `comet handoff`, and `comet archive` resolve the layout internally. Never persist a physical root in `.comet/current-change.json`.
- If root show or a write command reports conflicting legacy/docs roots, invalid config, or an incomplete migration, stop. Use `comet doctor` for read-only inspection; do not scan both roots, guess change ownership, or dual-write.

## New, existing, and migrated projects

- New Classic projects default to `docs/openspec/`.
- Compatibility reads without `classic.artifact_layout` use root-level `openspec/` (legacy); new project init writes docs explicitly. When `comet update` detects existing root-level `openspec/` artifacts, it explicitly backfills `legacy` without moving them.
- Normal init/update never moves existing artifacts. Run `comet classic root move docs --dry-run` to inspect the current state; after confirmation, run `comet classic root move docs --apply` to migrate. The Runtime manages migration identity and locked revalidation internally.
- Migration moves the complete legacy-layout tree as-is, including active, unmanaged, and incompletely archived changes; change state does not block a root move.
