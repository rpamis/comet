# Native command reference

Prefer the installed `comet native` command. If the host exposes only Skill files, use this Skill's bundled runtime:

```text
node <comet-native-skill-root>/scripts/comet-native-runtime.mjs <command> [options]
```

Both entry points use the same arguments, stdout, stderr, and exit codes. Normal discovery searches upward from the current directory for `comet.config.yaml` or the repository root; generated launchers may also pass the hidden `--project-root <path>` option.

## Project and artifact root

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
comet native root show
comet native root move <artifact-root>
```

`artifact-root` must be a project-relative path. `.` creates `<project>/comet/`; `docs` creates `<project>/docs/comet/`. Existing configuration rejects a conflicting `--root`. Change the root only through `root move`, never by editing configuration directly.

## Change management

```text
comet native new <change-name> [--language en|zh-CN]
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
comet native list
comet native show <change-name>
comet native status [<change-name>]
comet native select <change-name>
```

`new` creates default configuration and `<project>/comet/` when configuration is absent. Write complete target specifications at `specs/<capability>/spec.md`; `next` infers create/replace and freezes the canonical hash. Use `spec remove` to remove a capability instead of editing `spec_changes`. After a concurrent canonical change causes a conflict, re-read and rewrite the complete target specification, then use `spec rebase` to refresh operation/hash, return to Build, and clear the old verification conclusion. `show` returns state, the brief, and proposed complete specifications. `status` returns the current phase, verification result, next Native command, and archive readiness. `select` writes only Native-owned selection state.

## Phase progression

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--result pass|fail] \
  [--report <change-relative-path>]

comet native archive <change-name>
```

- Shape advances after the brief and proposed specifications pass; add `--confirmed` only when this turn contains a high-impact decision the user just confirmed.
- Build rechecks the brief and proposed specifications, then requires at least one real project artifact or `--no-code-reason`. Also pass `--confirmed` when this turn includes a high-impact decision the user just confirmed during implementation.
- Verify requires `--result` and a complete `--report`; fail returns to Build and pass enters Archive.
- Archive is completed only by `archive`; `next` cannot substitute for it.

## Diagnosis and recovery

```text
comet native doctor [<change-name>]
comet native doctor [<change-name>] --repair --strategy continue|rollback
```

Read-only doctor does not modify files. `--repair` is limited to provably safe selection cleanup, stale locks, ordinary phase transitions, and deterministic transaction recovery; user-authored YAML, Markdown, and specifications are never rewritten automatically. Ordinary transitions support `continue`, not `rollback`.

## Output and exit codes

Every command supports `--json`. JSON mode emits exactly one object with `command`, `exitCode`, `data`, and a structured `error` on failure.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `64` | Invalid arguments or usage |
| `65` | Invalid configuration, state, or artifacts |
| `73` | Lock, transaction, concurrent hash, or root conflict |
| `70` | Unexpected internal failure |
