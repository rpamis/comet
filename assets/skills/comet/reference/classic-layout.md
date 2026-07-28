# Classic Artifact Layout Protocol

At the start or recovery of every Classic phase, run this from the project root:

```bash
comet classic root show
```

Accept only `schema: comet.classic-layout.v1`. Bind the returned `openSpecRoot`, `changesRoot`, `archiveRoot`, `specsRoot`, and `superpowersRoot` as `<classic-open-spec-root>`, `<classic-changes-root>`, `<classic-archive-root>`, `<classic-specs-root>`, and `<classic-superpowers-root>`, respectively, then define `<classic-change-dir>` as `<classic-changes-root>/<name>`. These logical roots are the source of truth for this turn. Resolve them again after recovery or context compaction.

## Command rules

- This and every other Comet-owned Classic Skill must call the official OpenSpec CLI directly through:

  ```bash
  comet classic openspec -- <args...>
  ```

- The adapter runs the official CLI from the configured OpenSpec base and preserves stdout, stderr, and the exit code. Do not register or query an OpenSpec store for a root inside the same repository.
- Run `openspec` directly only when the user explicitly operates from the resolved OpenSpec base.

## Path rules

- Express change, tasks, delta spec, handoff, and archive paths with the `<classic-*>` logical roots bound above; for example, use `<classic-change-dir>/tasks.md`. Do not wrap one physical layout in a logical-path convention and keep using it as filesystem guidance.
- Resolve Superpowers files through `<classic-superpowers-root>/...`; do not derive them from the OpenSpec root or current cwd.
- `comet state`, `comet guard`, `comet handoff`, and `comet archive` resolve the layout internally. Never persist a physical root in `.comet/current-change.json`.
- If root show or a write command reports conflicting legacy/docs roots, invalid config, or an incomplete migration, stop. Use `comet doctor` for read-only inspection; do not scan both roots, guess change ownership, or dual-write.

## New, existing, and migrated projects

- New Classic projects default to `docs/openspec/`.
- Existing projects without `classic.artifact_layout` continue to use `openspec/`.
- Normal init/update never moves existing artifacts. Run `comet classic root move docs --dry-run` first and retain its plan ID; use `comet classic root move docs --apply --plan <id>` only with explicit user authorization.
- The first migration version rejects every active or unmanaged OpenSpec change.
