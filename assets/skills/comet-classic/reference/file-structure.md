# File Structure Reference

Canonical path: `comet-classic/reference/file-structure.md`

Consult this project file-structure reference as needed; do not load it wholesale with the Skill.

```text
<classic-open-spec-root>/              # OpenSpec requirements and specifications; resolved by Classic
├── config.yaml
├── changes/
│   ├── <name>/                        # Active change
│   │   ├── .openspec.yaml
│   │   ├── comet-state.yaml
│   │   ├── proposal.md                # Motivation, goals, and scope
│   │   ├── design.md                  # High-level architecture decisions
│   │   ├── specs/<capability>/spec.md # Incremental capability specification changes (delta spec)
│   │   ├── .comet/handoff/            # Script-generated phase handoff files
│   │   └── tasks.md                   # Task list
│   └── archive/YYYY-MM-DD-<name>/     # Archived change
└── specs/<capability>/spec.md         # Main specification (OpenSpec merges delta specs at archive)

<classic-superpowers-root>/            # Superpowers design and plan directories; resolved by Classic
├── specs/YYYY-MM-DD-<topic>-design.md # Technical design/RFC (status annotated at archive)
└── plans/YYYY-MM-DD-<feature>.md      # Implementation plan (change metadata in frontmatter)

.comet/
└── config.yaml                        # Comet project configuration (context_compression defaults to off; beta is optional)
```

New Classic SDK changes use `comet-state.yaml`; historical `.comet.yaml` files remain supported in place, and compat initialization still uses the old name. Both names must not coexist, including when one is a dangling symlink.

Machine-local Runs, execution evidence, locks, and transactions are stored in the user Comet data directory, isolated by checkout and Git worktree. The default data root is `~/.comet`; set `COMET_DATA_DIR` to an absolute path outside the workspace to override it. The project directories above retain configuration and user-readable artifacts, rather than local Run storage. Use the paths returned by Runtime, and do not manually edit or copy local execution files.
