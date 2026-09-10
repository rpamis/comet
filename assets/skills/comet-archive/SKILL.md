---
name: comet-archive
description: 'Phase 5 of Comet Classic — confirm archiving, merge delta specs, and finish branch delivery.'
---

# Comet Phase 5: Archive

After entry returns layout, bind logical roots under `comet-classic/reference/classic-layout.md`; do not reload the protocol if it is already in context. OpenSpec CLI calls use the adapter and paths use the bound `<classic-*>` roots, without a separate root show first.

## Prerequisites

- Verification passed (Phase 4 complete)
- Archive or selected delivery actions remain incomplete; recovery does not require branch_status to remain pending
- `verify_result: pass` in `<classic-change-dir>/.comet.yaml`

## Steps

### 0. Output Language Constraint

Archive summaries and lifecycle closure notes use this entry's configuration.language without an extra language query.

### 0b. Entry State Verification (Entry Check)

Use the stable public CLI under `comet-classic/reference/scripts.md`, then run entry verification. For recovery, follow `comet-classic/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <name> archive --json
```

Continue using entry layout, configuration, nextAction, and delivery summaries. Read cold-recovery details under context-recovery.md. If authorization remains valid and targets match, continue only unfinished actions without asking again. Resolve specific failures.

If select/check returns BLOCKED because bound_branch differs from the current branch, pause under `comet-classic/reference/decision-point.md`. Let the user choose to return to the bound branch and rerun entry, or explicitly authorize the current branch to take over, then run `comet state rebind <change-name>` and rerun entry. Do not switch branches or rebind on your own.

### 1. Final Archive and Delivery Confirmation (Blocking Point)

Use entry configuration.isolation and delivery. If authorization is absent or the delivery target changed, **pause under decision-point.md and confirm archive and delivery method**. With existing authorization, let Runtime inspect actual Git and delivery state before continuing from nextAction. Never infer archive, push, or PR authorization from branch_status: handled, or run archive-confirm/archive before authorization.

Before confirmation, show a short summary:

- Change name
- Verification report path and result
- Current branch/workspace and attribution of uncommitted changes
- Irreversible archive actions: merge main specs using OpenSpec delta semantics, annotate design doc/plan, and move the change to archive
- Commit handling: local only, push the bound branch, or push and create a PR

Use a single-select question containing every option below. Text fallback must use this table; structured questions use Method as the short label and Actual Impact as the description, without ambiguous abbreviations.

| Option | Method                                       | Actual Impact                                                                                                                                                                                                           |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Archive only (no push)                       | Archive and create the only archive commit; keep it on the bound branch locally, without pushing or creating a PR                                                                                                       |
| B      | "Confirm archive and push now"               | Archive, create the only archive commit, then push the bound branch without creating a PR                                                                                                                               |
| C      | "Confirm archive, push now, and create a PR" | Archive, create the only archive commit, push the bound branch, then create a PR                                                                                                                                        |
| D      | "Adjust or re-verify"                        | Do not archive; run `comet state transition <change-name> archive-reopen` to return to `phase: verify`, then invoke `/comet-verify`; if repair is required, follow verification failure handling back to `/comet-build` |
| E      | "Do not archive yet"                         | Do not run `archive-confirm` or the archive command, commit, or push; keep the active change, `phase: archive`, and `branch_status: pending` until a later `/comet-archive` invocation                                  |

Only after the user selects A, B, or C, save the selection as JSON through Runtime, then confirm archive:

```bash
comet state delivery <change-name> --file <json-path>
comet state transition <change-name> archive-confirm
```

JSON fields are action (A=local, B=push, C=pr), targetBranch, optional remote, commit, and prUrl. Initially provide only confirmed action and target. Do not fabricate unknown commit/prUrl; add them after actual completion. targetBranch is the bound branch receiving the archive commit, not the PR base. Use an explicitly configured PR base and clarify ambiguity. With multiple remotes, establish the destination instead of guessing. Example after the user confirms push:

```json
{
  "action": "push",
  "targetBranch": "<confirmed-bound-branch>",
  "remote": "<confirmed-remote>"
}
```

Save JSON with file tools and pass it to delivery --file. After confirming the archive commit, append `"commit": "<actual-archive-commit-sha>"` to the same complete record. For action pr, add the real prUrl after creation. Local needs only action:local and the confirmed targetBranch, not remote.

Ordinary `comet state delivery <change-name>` reads records only; entry summaries do not access the network. Before recovering remote delivery, resolving an uncertain response, or declaring completion, explicitly run:

```bash
comet state delivery <change-name> --verify
```

Reads return `{delivery, verification}`. delivery is the persisted selection/progress; verification is Runtime's read-only inspection of actual Git/remote/PR state. A delivery record or successful ordinary entry does not prove remote completion. Distinguish:

- Confirmed not-yet-delivered (for example, before the first push, or pushed but no PR yet): with valid authorization and target, execute the missing action, then --verify again. Do not stop solely because of notVerified/needsVerification.
- unavailable (network, permission, or service failure prevents determining the real result), conflicting targets, or uncertain results: preserve records and stop. Restore read-only verification before retrying; do not blindly push or create duplicate PRs.

Stop if delivery writes or transition fail; both must succeed before Step 2. For D, run archive-reopen; old delivery authorization must expire and require confirmation after re-verification. For E, stop without archive, commit, push, or setting handled.

### 2. Execute Archive

Run:

```bash
comet archive "<change-name>"
```

The script automatically:

1. Checks entry: phase=archive, verify_result=pass, archive_confirmation=confirmed, archived=false
2. Annotates Design Doc frontmatter (archived-with, status)
3. Annotates plan frontmatter (archived-with)
4. Invokes OpenSpec archive to merge main specs using delta semantics and move the change
5. Checks that main specs contain no delta-only section headings
6. Updates archived state in the actual OpenSpec archive directory and coordinates pending recovery metadata

Report nonzero exit and stop. Zero exit means archive completed. The `X/Y steps succeeded` summary counts actual steps without double-counting delta synchronization or document annotation. Main specs merge according to `ADDED/MODIFIED/REMOVED/RENAMED` semantics and are checked for residual delta-only headings. Use --dry-run to preview without executing.

### 3. Lifecycle Closure

The spec lifecycle completes here:

```text
brainstorming -> delta spec -> implementation -> verification -> main spec merge -> design doc annotation -> archive
```

### 4. Precisely Commit Archive Changes

Archive moves files and merges specs; it does not commit automatically. Expected uncommitted changes:

- Move from `<classic-change-dir>/` to `<classic-archive-root>/YYYY-MM-DD-<name>/`
- Main spec content merged under delta semantics
- Design doc/plan archive metadata

Confirm actual delivery authorization remains valid, then write compatibility state and run the final archive guard:

```bash
comet state set <change-name> branch_status handled
comet guard <change-name> archive
```

handled is compatibility state, not evidence of local/push/pr authorization or success. Use delivery records and Runtime inspection of actual Git/remote state. Stop on state-write or guard failure. During recovery, first inspect whether the archive commit already exists; reuse it instead of creating a second archive commit.

Read `git status --short` after archive, using pre-archive dirty-worktree attribution as baseline. Stage only paths attributable to this change: original active path, actual archive path returned by the script, archived .comet.yaml with branch_status: handled, main specs changed by this delta, and current Design Doc/Plan archive metadata. Stop for user handling if paths cannot be attributed.

Stage explicit inspected pathspecs, then review staged diff. Do not stage the entire repository or include unrelated user changes:

```bash
git add -- <individually-inspected-archive-paths...>
git diff --cached --stat
git commit -m "chore: archive <change-name>"
```

Stop on commit failure or unrelated staged paths; do not proceed to branch delivery.

### 5. Deliver the Archive Commit and Complete

After committing, record the actual commit through state delivery --file and have Runtime inspect the archive commit and target. Execute only authorized, incomplete actions. If recording fails, stop delivery without recommitting; inspect existing Git facts before repairing the record on recovery. Do not repeatedly create archive commits to record the commit itself; Runtime owns delivery receipt storage.

- A, archive only: no remote actions; retain the archive commit on the bound branch locally.
- B, archive and push now: push the bound branch once.
- C, archive, push, and create PR: push the bound branch once, then create a PR through the configured GitHub integration. Step 1 explicitly authorizes PR creation; do not replace it with another branch disposition.

After push or PR calls, use delivery --verify to inspect actual remote branch and PR state. After successful PR creation, record actual prUrl through delivery --file while preserving action, target, and commit. After timeout or an uncertain response, inspect actual results before retrying. Preserve delivery and current selection on failure; continue only missing authorized actions. Do not rewrite, delete, or switch branches.

Runtime must verify the archive commit exists for local, that the remote contains it for push, and that the matching PR exists with the correct target for pr. Filling commit/prUrl is not delivery success. Run clear-selection and declare completion only after Runtime verifies every selected action.

Archive no longer invokes Superpowers `finishing-a-development-branch` or offers local merge, switch, delete, or rebase operations. Select A for local-only archive, or E to defer archiving.

## Exit Conditions

- Archive script succeeded with exit code 0
- `<classic-archive-root>/YYYY-MM-DD-<change-name>/` exists
- Archived .comet.yaml contains `archived: true`
- `branch_status: handled` is included in the only archive commit
- `comet guard <change-name> archive` passes
- The only archive commit was handled as confirmed before archive: A local-only, B pushed, C pushed with PR created
- Current selection was cleared after the selected handling completed

The script moves `<classic-change-dir>/` to `<classic-archive-root>/YYYY-MM-DD-<name>/`. `comet guard <change-name> archive` resolves the actual archive directory from the original change name; do not construct dated directory names manually.

## Completion

The Comet Classic workflow is complete. Start another Classic task with `/comet-classic` or `/comet-open`.

## Context Compaction Recovery

Follow context-recovery.md with phase archive. Read persisted delivery without relying on the conversation remembering A/B/C. Runtime inspects archive, commit, remote, and PR facts, then continues only missing actions; local performs no remote actions. For old changes with only handled, absent authorization, changed targets, or conflicting branch topology, stop for explicit confirmation. Do not infer authorization or automatically repair topology.
