# Native recovery reference

## Context recovery order

Resume from facts on disk every time:

1. Read the project's `.comet/config.yaml` and confirm the single artifact root and `native.clarification_mode`; use `sequential` when the field is absent. If `pending_root_move` exists, run doctor first.
2. Run the read-only `comet native status`. With multiple active changes, read the shared project-level `.comet/current-change.json` and confirm `workflow: native` plus the target change, or ask the user to choose explicitly.
3. Run the read-only `show` and `status <change-name> --details` for the target change. Read `comet-state.yaml`, the brief, proposed complete specifications, verification, bounded structured findings, the `findingsTruncated` flag, and the latest checkpoint. When findings are truncated, handle the returned items and reread details. Fetch Verify/Archive acceptance IDs separately through `acceptancePage.nextCursor`; do not depend on a missing old response.
4. After confirming the target, run `comet native select <change-name>` to establish the shared selection. There is no separate `resume` command, and read-only commands never select a change implicitly.
5. Read relevant canonical specifications, implementation, rules, tests, and current workspace state.
6. Execute Shape, Build, Verify, or Archive according to the phase instead of guessing from chat history.

When state, Run state, trajectory, or a transaction journal is malformed, stop writing and run read-only doctor. Never bypass the problem by editing `phase` manually.

## Clarification-round recovery

When Shape or Build contains `[blocking]` items, recover the current open decisions from Open questions in the brief. Do not reconstruct answers from chat history. Sequential mode recovers one most-upstream question; Batch mode recovers the round's entire ready question set from its saved numbers. Changing configuration does not clear existing blockers: first map the user's answers to the saved questions, then use the current `clarification_mode` to compute the next round.

Continue investigating facts available from the repository, tools, or runtime environment yourself. Independent facts may be investigated in parallel when the host supports it, but recovery must not depend on any optional parallel capabilities. A fact still under investigation delays only the questions that depend on it.

In Batch mode, unanswered questions remain `[blocking]`. After all questions are resolved, recover or establish the final shared-understanding confirmation. Remove that blocking item and enter Build only after explicit user confirmation. This process adds no phase, change-state field, or separate decision-tree file.

Before interrupting a long task within the same phase, write a checkpoint when useful:

```text
comet native checkpoint <change-name> \
  --summary <completed-facts> \
  --next-action <next-action> \
  [--artifact <project-relative-path>] \
  [--expect-revision <n>]
```

On resume, check checkpoint freshness first. If phase, revision, or manifest changed, treat it as historical context rather than forcing its old next action onto new state. The runtime reports stale reasons explicitly in details.

## Ordinary phase progression

Before updating Run state, `comet-state.yaml`, trajectory, and checkpoint, `next` writes a prepared journal to the change's `runtime/transition.json`. It removes the journal only after every update completes.

`status` and doctor report an unfinished transition. Running `next` again or entering Archive makes the runtime continue it deterministically. You can also run:

```text
comet native doctor <change-name> --repair --strategy continue
```

An ordinary phase transition has no canonical-file side effects, so it supports only `continue`, not `rollback`. Preserve a malformed journal and stop instead of assembling state by hand.

## Missing or incomplete baselines

`new` requires a complete baseline. Git projects evaluate only tracked and non-ignored untracked files; ignored caches and nested-repository contents do not create omissions.

If the Runtime reports `baseline-snapshot-missing` or `baseline-snapshot-incomplete`, do not rebuild the baseline from current files or present it as an automatic doctor repair. That would erase historical differences since the change was created.

Restore the original baseline from a trusted backup, or preserve the user-authored brief, specifications, and implementation facts while creating a new change with a complete baseline.

## Stale evidence and controlled fallback

After entering Verify, a change to the brief, proposed specifications, or project snapshot makes status point the stale implementation scope to a controlled fallback. Run the returned summary-only `next` command to return to Build, reconfirm the changed contract, and generate a fresh scope. In Archive, a change to any bound fact such as the implementation scope, verification report, or check receipt triggers the same fallback. Do not delete findings, reuse the old pass, or replace hash refs manually.

Archive requires a two-step preflight; an old ready result is never commit authorization:

```text
comet native archive <change-name> --dry-run
comet native archive <change-name> --expect-preflight <just-returned-sha256>
```

The second command recomputes contract, canonical base, scope, verification, current-root conflicts, and recovery state while holding the lock. Any change rejects the commit and requires a new preflight.

## Verify failures and repair stops

A Verify failure honestly returns to Build. When stable, non-sensitive `--failure-category` and `--failed-check` values are supplied, the runtime validates their tokens, count, and bounds, then forms a signature from failure + contract + scope. The second identical signature warns; the third without scope progress creates a manual stop, while exhausting the episode's semantic budget creates a hard stop.

- Genuine implementation-scope change means mechanical progress. An ordinary Build `next` closes the old episode and automatically starts a new one; the previous hard stop does not freeze the new implementation.
- If scope is unchanged but there is one explicit new hypothesis, use the exact signature from status plus a non-empty summary for a single `--override-repair`.
- If the signature has already been overridden or the episode reached hard stop, do not weaken verification or fabricate a pass. Preserve the state and ask the user to change scope/constraints or stop.

A pass closes the active repair episode. If old Archive evidence later becomes stale and the same failure returns, it is a new episode, while the original trajectory remains as an audit fact. The generic Engine iteration budget is not part of this product semantic.

## Canonical specification conflicts

Archive stops when another change modifies a canonical specification after the current change froze its `base_hash`. Do not edit the hash:

1. Re-read the latest canonical specification, brief, and proposed complete specification.
2. Rewrite the complete target specification to reflect user intent, resolving one user decision first when necessary.
3. Run `comet native spec rebase <change-name> --summary <summary>`.
4. The runtime refreshes operation/hash, reopens the change in Build, and clears the old verification conclusion.
5. Implement again, record a newly confirmed decision with `--confirmed` when needed, then rerun Verify and Archive.

If another change already removed the target of a remove intent, rebase drops that satisfied intent. Other remove intents freeze the latest canonical hash before re-verification.

## Parallel-work advisory in the current workspace

Status and Archive compare capability, operation, base hash, and declared artifacts across changes visible in the current Native root. Definite conflicts must be resolved first, and possible overlap also blocks Archive. This cannot see unintegrated worktrees, remote branches, or other machines, so it is not a distributed lock.

`workspace-root-changed` and `workspace-inspection-unavailable` are explicit advisories. They explain where current root facts came from and do not independently block progression or Archive. Findings list concrete drift components such as `native-root-ref`, `project-root-path`, and `native-root-path`. Native does not read Git branch, HEAD, or worktree changed paths by default.

Do not treat every `workspace-*` finding as advisory. Unknown workspace-integrity findings remain errors. When the Runtime requires workspace identity repair, run read-only doctor first and then follow its report with explicit `doctor --repair`.

## Archive transactions

Archive uses a global lock, staged specifications, an append-only per-operation event log, and backups. After interruption, the canonical tree may be mid-transaction, but the journal preserves the unfinished facts.

Archive stage, backup, apply, and rollback copies all read through protected handles. The runtime validates source file, realpath, parent-directory identity, size, and expected hash before and after opening, then rechecks the destination before atomic commit. A path that passed an earlier containment check is not assumed to still identify the same file.

Write/remove first bind the original canonical object identity and contents into the transaction, atomically rename the object into same-directory isolation, and revalidate it. Write installs a transaction-private candidate without overwrite. Rollback likewise isolates and validates the post object before restoring the original without overwrite. Even when a concurrent replacement has identical content hash, the runtime refuses to overwrite it when it is a different file object and preserves the scene.

Reading `events.jsonl` is bounded by total bytes, event count, and per-event bytes. If a crash leaves only a provable prefix of the final canonical JSON event, the runtime performs CAS against the original bytes' hash/size and atomically rewrites to the last complete event before the next append. A damaged middle line, complete but invalid final line, non-canonical JSON tail, or concurrent rewrite fails closed. A complete event without a trailing newline is not removed, and repeated operations remain exactly-once by `type + operationId`.

```text
comet native doctor <change-name>
comet native doctor <change-name> --repair --strategy continue
comet native doctor <change-name> --repair --strategy rollback
```

- `continue` resumes after the last completed operation and converges on a committed archive.
- `rollback` restores canonical files and the active change in reverse order.
- The runtime validates the moved archive tree, final state, protected Run, trajectory event, and completion decision before writing `archive-finalization-started`. Rollback remains safe before this marker. Once written, the transaction has crossed the irreversible boundary and only continue is allowed, preventing an active change from being restored after completion evidence exists.

Read the paths, transaction ID, and conflict details reported by doctor first. If current hashes match neither side of the journal, preserve all trees and stop automated repair.

## Artifact-root moves

`root move` progresses through `copying`, `ready`, and `switched`. Configuration's `pending_root_move` is the recovery source of truth; ordinary Native write commands fail closed while it exists.

- `copying`: the old root is current and target staging may be incomplete.
- `ready`: staging passed per-file path, size, and SHA-256 verification, but configuration has not switched.
- `switched`: configuration points to the new root. Only after another equivalence, parent-chain, and directory-identity check is the old root renamed into a transaction-ID-bound sibling quarantine, revalidated, then removed. Continue/rollback recognizes this quarantine after interruption and settles deterministically instead of recursively deleting an old path.

Use doctor's explicit continue or rollback strategy. If the two tree hashes differ, delete neither tree and give the user both reported paths.

## Locks and safe repair

Doctor distinguishes active locks, provably stale local locks, and remote locks whose owners cannot be determined. Remove a stale lock only when its owner process is known not to exist and no unfinished transaction depends on it; never break active or unknown locks automatically.

Locks bind owner metadata, lock-file identity, and in-process FIFO ordering. Ordinary mutations never take over based on an apparently old timestamp. Only explicit doctor repair may perform identity-revalidated takeover. This prevents an old owner from deleting the new owner's lock and creating split brain.

Doctor may safely clear a selection that points to a missing change. It does not rewrite damaged configuration, change YAML, briefs, specifications, or verification reports; repair those files manually from user intent, then inspect again.

Evidence retention follows the explicit-repair boundary. Doctor reports candidates by default. `--repair` removes only active-change derived evidence or receipts that are at least 30 days old, outside the latest 32 items per evidence kind, and proven unreferenced by the dependency closure.

Removal is ordered dependents before dependencies and first renames each candidate into a unique same-directory `.gc` quarantine. If interrupted before final deletion, a later read-only doctor reports `evidence-retention-recovery-required`; explicit repair restores without overwrite only when the original path remains absent and quarantine content and identity are valid.

Cleanup is deferred and fails closed for original/quarantine conflicts, multiple quarantines, archived evidence, pending recovery, missing dependencies, damaged documents, unknown entries, symlinks, or other special files.
