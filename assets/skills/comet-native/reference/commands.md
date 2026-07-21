# Native command reference

Prefer the installed `comet native` command. If the host exposes only Skill files, use this Skill's bundled runtime:

```text
node <comet-native-skill-root>/scripts/comet-native-runtime.mjs <command> [options]
```

Both entry points use the same arguments, stdout, stderr, and exit codes. Normal discovery searches upward from the current directory for `.comet/config.yaml` or the repository root; generated launchers may also pass the hidden `--project-root <path>` option.

## Project and artifact root

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
comet native root show
comet native root move <artifact-root>
```

`artifact-root` must be a project-relative path and defaults to `docs`. `.` creates `<project>/comet/`; `docs` creates `<project>/docs/comet/`. `init --language` persists the project's default Native language in `.comet/config.yaml`; later `new` commands inherit it when `--language` is omitted. Running `init --language` again changes the default for future changes without rewriting existing ones. Existing configuration rejects a conflicting `--root`. Change the root only through `root move`, never by editing configuration directly.

## Change management

```text
comet native new <change-name> [--language en|zh-CN]
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
comet native list [--cursor <token>]
comet native show <change-name>
comet native status [--cursor <token>]
comet native status <change-name> [--details [--acceptance-cursor <token>]]
comet native select <change-name>
```

`new` creates default configuration and `<project>/docs/comet/` when configuration is absent. Write complete target specifications at `specs/<capability>/spec.md`; `next` infers create/replace and freezes the canonical hash. Use `spec remove` to remove a capability instead of editing `spec_changes`.

After a concurrent canonical change causes a conflict, reread and rewrite the complete target specification. Then use `spec rebase` to refresh operation/hash, return to Build, and clear the previous verification conclusion.

`show` returns state, the brief, and proposed complete specifications. `status` returns a bounded view of phase, evidence freshness, finding summary, checkpoint, repair state, and continuation. `status <change-name> --details` also returns:

- up to 50 detailed findings;
- the `findingsTruncated` flag;
- recovery details;
- the first `acceptancePage`.

When findings are truncated, handle the returned findings and then read details again. When `nextCursor` is non-null, pass it to `--acceptance-cursor` until it becomes null. Acceptance cursors are valid only with a specific change and `--details`, and bind to the current acceptance hash.

`status` and `show` are always read-only. Run `select` explicitly when resuming a confirmed target change; do not add a `resume` command. Both `new` and `select` write the shared project-level `.comet/current-change.json` with `workflow` fixed to `native`; neither modifies a Classic change.

`list` and `status` without a change name return the same read-only paginated projection, with at most 24 changes per page. Pass a non-null `nextCursor` back unchanged through `--cursor`. The cursor is bound to the complete visible name set; adding or removing changes makes an old cursor fail explicitly instead of shifting the page. At most 4096 visible changes are accepted, and a serialized page is capped at 512 KiB. `show` also bounds the number of specifications, per-file and cumulative reads, and final output size; it rejects oversized input instead of truncating requirement text.

## In-phase progress and built-in checks

```text
comet native checkpoint <change-name> \
  --summary <text> \
  --next-action <text> \
  [--artifact <project-relative-path>]... \
  [--expect-revision <n>]

comet native check <change-name>
```

`checkpoint` stores only an in-phase summary, next action, and content-addressed artifact manifest. It uses revision/CAS to prevent overwrites and does not change the phase. `check` is available only in Verify after an implementation scope exists. It runs Comet's built-in bounded, read-only text scan. It does not invoke Git, a shell, project scripts, external Skills, or any external process; it accepts no arbitrary command, path, environment, or timeout options and does not modify project files, the change, Run, or trajectory. Results, issue counts, and scope freshness are written to an independent content-addressed receipt. A check that finds issues or becomes stale exits with 1, but still writes the receipt.

## Phase progression

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--allow-partial-scope <sha256> --partial-reason <text> --confirmed] \
  [--result pass|fail] \
  [--report <change-relative-path>] \
  [--receipt <runtime/evidence/check-receipts/...json>] \
  [--failure-category <token>]... \
  [--failed-check <token>]... \
  [--override-repair <sha256> --override-summary <text>]

comet native archive <change-name> --dry-run
comet native archive <change-name> --expect-preflight <sha256>
```

- Shape: advance after the brief and proposed specifications pass; add `--confirmed` only when this turn contains a decision the user just confirmed. On successful entry to Build, the Runtime binds approval to the current contract hash.
- Build: recheck the brief and proposed specifications; provide at least one real project artifact or use `--no-code-reason`. If the contract changed after approval, status/next requires the user to reconfirm the current contract; pass `--confirmed` only after obtaining that confirmation. If complete scope cannot be proven, the first call returns a scope hash and bounded unattributed details without advancing; changes beyond the detail budget are represented by a `scope-detail-overflow` count and content hash. Retry only after the user accepts the specific risk, with the exact `--allow-partial-scope`, a reason, and `--confirmed`.
- Verify: provide both `--result` and a complete `--report`. An optional `--receipt` must be fresh for the current change, revision, contract, and implementation scope. A failure returns to Build and may use failure categories and check IDs to form a no-progress signature; a pass enters Archive.
- Repair: the third identical failure returns a manual stop. A genuine scope change on an ordinary Build `next` closes the old repair episode and continues. With unchanged scope, only one override is allowed, using the exact signature returned by status plus a non-empty summary. Neither a semantic repair budget nor an exhausted override can be bypassed; the generic Run iteration is only an event sequence number, not a permanent stop condition for a long-lived change.
- Archive: only `archive` completes this phase; `next` cannot substitute for it. First run `--dry-run`, then pass the returned `preflightHash` unchanged to `--expect-preflight`. The runtime recomputes it under the mutation lock before committing.

## Diagnosis and recovery

```text
comet native doctor [<change-name>]
comet native doctor [<change-name>] --repair
comet native doctor [<change-name>] --repair [--strategy continue|rollback]
```

Read-only doctor does not modify files. `--repair` is limited to provably safe selection cleanup, stale locks, evidence retention, ordinary phase transitions, workspace identity repair, and deterministic transaction recovery. It never rewrites user-authored YAML, Markdown, or specifications.

`--strategy` is an optional transaction-recovery argument, not a requirement for ordinary repair. Ordinary transitions support only `continue`, not `rollback`.

Doctor also reports evidence-retention candidates without changing them. Explicit `--repair` removes only derived evidence/receipts in active changes that are at least 30 days old, outside the latest 32 items of each evidence kind, and proven unreferenced by the dependency closure. Archived evidence, current-state references, dependencies, newer files, and the latest 32 of every kind are always retained. Removal is ordered dependents before dependencies and first moves files into a same-directory quarantine. After interruption, read-only doctor reports recovery required; explicit repair restores files only when there is no overwrite and identity still matches. Pending journals, damage, source/quarantine conflicts, and unknown or special files fail closed rather than deleting data to reclaim space.

Ordinary write commands such as `new`, `next`, `archive`, and `root move` never take over stale locks automatically. Only explicit `doctor --repair` may do so after proving the local owner is gone, lock identity is unchanged, and no conflicting recovery transaction exists. Active locks and locks that cannot be proven stale are always preserved.

## Output and exit codes

Every command supports `--json`. JSON mode emits exactly one object with `command`, `exitCode`, `data`, and a structured `error` on failure.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Built-in `check` completed but found issues or became stale |
| `64` | Invalid arguments or usage |
| `65` | Invalid configuration, state, or artifacts |
| `73` | Lock, transaction, concurrent hash, or root conflict |
| `75` | Repair stagnation or a hard stop blocks continuation |
| `70` | Unexpected internal failure |
