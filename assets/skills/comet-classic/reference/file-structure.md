# File Structure Reference

Canonical path: `comet-classic/reference/file-structure.md`

Consult this project file-structure reference as needed; do not load it wholesale with the Skill.

```text
<classic-open-spec-root>/              # OpenSpec requirements and specifications; resolved by Classic
├── config.yaml
├── changes/
│   ├── <name>/                        # Active change
│   │   ├── .openspec.yaml
│   │   ├── .comet.yaml
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
