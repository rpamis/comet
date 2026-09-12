---
name: comet-archive
description: 'Archive and deliver a Classic change. Use when the user invokes /comet-archive or Classic Runtime enters Archive or resumes delivery.'
---

# Comet Phase 5: Archive

After entry returns layout, follow `comet-classic/reference/classic-layout.md` to bind each logical root to its directory. Do not reload the protocol if it is already in context. Use the adapter for OpenSpec CLI calls and the bound `<classic-*>` roots for paths; do not run an extra root show first.

## Prerequisites

- Verification passed; Phase 4 is complete.
- Archive or the selected delivery action is unfinished. Recovery does not require branch_status to remain pending.
- `<classic-change-dir>/.comet.yaml` records `verify_result: pass`.

## Steps

### 0. Set the output language

Use configuration.language from this invocation's entry result for the archive summary and completion message. Do not query the language separately.

### 0b. Validate entry state

Use the supported `comet` CLI in `comet-classic/reference/scripts.md` for these checks. When resuming from any entry, first follow `comet-classic/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <name> archive --json
```

Continue from returned layout, configuration, nextAction, and the delivery summary. After context loss, read details according to context-recovery.md. If authorization is still valid and the delivery target is unchanged, continue only unfinished actions without asking again. Handle the specific cause on failure.

If select/check returns `BLOCKED` because `bound_branch` differs from the current branch, pause under `comet-classic/reference/decision-point.md`. Offer a single choice: return to the bound branch and rerun entry checks, or, after the user explicitly confirms that the current branch should take over this change, run `comet state rebind <change-name>` and rerun entry checks. Do not switch or rebind branches yourself.

### 1. Ask the user to confirm archive and delivery

Read configuration.isolation and delivery from entry. If valid authorization is absent or the delivery target changed, **pause under decision-point.md and ask the user to confirm archive and delivery**. If authorization exists, let Runtime verify actual Git state and delivery progress, then follow nextAction. Do not infer archive, push, or PR authorization solely from branch_status: handled. Do not run archive-confirm or archive before authorization.

Before asking, show a short summary:

- Change name.
- Verification report path and conclusion.
- Current branch/workspace and which work owns each uncommitted change.
- The irreversible archive actions: merge delta changes into main spec, annotate the Design Doc/plan, and move the change to the archive directory.
- How the archive commit will be handled: keep it local, push the bound branch, or push and create a PR.

Present a single-choice question containing every option below. Use this table in text fallback mode. With structured questions, use “Method” as the short label and “Effect” as its description; do not shorten options until their meaning is unclear.

| Option | Method                                 | Effect                                                                                                                                                                                                                     |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Archive locally; do not push           | Archive and create the single archive commit. Keep it on the currently bound branch; do not push or create a PR.                                                                                                           |
| B      | Confirm archive and push now           | Archive, create the single archive commit, and push the currently bound branch. Do not create a PR.                                                                                                                        |
| C      | Confirm archive, push, and create a PR | Archive, create the single archive commit, push the bound branch, and create a PR.                                                                                                                                         |
| D      | Adjust or verify again                 | Do not archive. Run `comet state transition <change-name> archive-reopen` to return to `phase: verify`, then invoke `/comet-verify`. If repairs are needed, return to `/comet-build` under the verification-failure rules. |
| E      | Do not archive yet                     | Do not run archive-confirm or archive, commit, or push. Keep the unarchived change, `phase: archive`, and `branch_status: pending` for a later `/comet-archive` invocation.                                                |

Only after the user chooses A, B, or C, save the choice as JSON through Runtime, then confirm archive:

```bash
comet state delivery <change-name> --file <json-path>
comet state transition <change-name> archive-confirm
```

JSON contains action (A=local, B=push, C=pr), targetBranch, and optional remote, commit, and prUrl. Initially record only confirmed actions and targets. Do not fabricate unknown commit/prUrl values; add them after the operations actually complete.

targetBranch is the bound branch receiving the archive commit, not the PR base branch. Use an explicit existing PR-base configuration; clarify ambiguity first. With multiple remotes, establish the destination rather than guessing. For example, after the user confirms push:

```json
{
  "action": "push",
  "targetBranch": "<confirmed-bound-branch>",
  "remote": "<confirmed-remote>"
}
```

Save JSON using file tools and pass it to delivery --file. Once the archive commit is confirmed, add `"commit": "<actual-archive-commit-sha>"` to the same complete record. For action pr, add the actual prUrl after PR creation. Local needs only action:local and the confirmed targetBranch; remote is not required.

Plain `comet state delivery <change-name>` reads saved records only, and the entry summary does not access the network. Explicitly run the following when resuming remote delivery, resolving an uncertain call result, or preparing to announce completion:

```bash
comet state delivery <change-name> --verify
```

The result is `{delivery, verification}`. delivery contains saved choices and progress; verification contains Runtime's read-only checks of actual Git, remote branches, and PRs. A delivery record or successful ordinary entry check alone does not prove remote delivery. Handle the result as follows:

- Confirmed not-yet-delivered, such as no first push or a completed push with no PR: if authorization and target remain valid, perform the missing action and check again with --verify. Do not stop solely because of notVerified/needsVerification.
- unavailable, meaning network, permission, or service failures prevent determining the result, or a target conflict/uncertain outcome: keep the record and stop. Restore read-only verification first; do not blindly retry push or create duplicate PRs.

Stop if either the delivery write or transition fails. Proceed to Step 2 only after both succeed. For D, run archive-reopen; the old delivery authorization must be invalidated, and obtain new confirmation after verification. For E, stop without archiving, committing, pushing, or setting handled.

### 2. Run archive

```bash
comet archive "<change-name>"
```

The script automatically:

1. Validates entry state: phase=archive, verify_result=pass, archive_confirmation=confirmed, archived=false.
2. Updates Design Doc metadata before archive: archived-with, status.
3. Updates Plan metadata before archive: archived-with.
4. Calls OpenSpec archive to merge deltas into main spec and move the change to archive.
5. Checks that main spec has no delta-only section headings.
6. Updates archived state in the actual OpenSpec archive directory and reconciles pending recovery metadata so interrupted work can resume.

Report and stop on a nonzero exit code. A zero exit code means archive completed.

The script's `X/Y steps succeeded` counts actual steps, not duplicate counts for delta syncing or document annotations.

It applies OpenSpec `ADDED/MODIFIED/REMOVED/RENAMED` delta semantics and verifies that main spec has no remaining delta-only section headings afterwards.

Use `--dry-run` to preview without executing.

### 3. Complete the spec workflow

The full path from requirements discussion to archive is now complete:

```text
brainstorming → delta spec → implementation → verification → main spec merge → design doc annotation → archive
```

### 4. Commit only the archive changes

Archive moves files and merges specs; it does not commit. Afterwards, expect these uncommitted changes:

- The change moves from `<classic-change-dir>/` to `<classic-archive-root>/YYYY-MM-DD-<name>/`.
- Main spec contains the merged delta changes.
- The Design Doc/plan contains archive metadata.

Confirm that delivery still records valid authorization, then write the compatibility field and run the final archive guard:

```bash
comet state set <change-name> branch_status handled
comet guard <change-name> archive
```

handled is only a legacy compatibility field. It neither authorizes local/push/pr nor proves those actions succeeded. Use delivery records and Runtime checks of actual Git/remotes for authorization and completion. Stop on state-write or guard failure. On recovery, check whether the archive commit already exists and reuse it rather than making a second one.

Read `git status --short` after archive and reconcile it against the ownership records collected under dirty-worktree before archive. Stage only paths clearly belonging to this change: the original change path, actual archive path reported by the script, archived `.comet.yaml` containing `branch_status: handled`, main specs changed by this delta, and archive metadata in the current Design Doc/Plan. If ownership of any changed path is unclear, stop and ask the user to handle it.

Use explicit pathspecs for the inspected paths, then inspect the staged diff. Do not stage the whole repository or include pre-existing user edits:

```bash
git add -- <individually-verified-archive-paths...>
git diff --cached --stat
git commit -m "chore: archive <change-name>"
```

Stop if commit fails or the staged diff contains unrelated paths. Do not continue branch handling.

### 5. Deliver the archive commit and finish

After commit succeeds, record its actual commit through `state delivery --file`, then let Runtime verify the archive commit and target. Perform only authorized, unfinished actions. Stop delivery if recording fails; do not commit again. On recovery, inspect existing Git commits and branch state before completing the record. Runtime stores delivery receipts; do not create more archive commits merely to record a commit hash.

- A, archive locally: perform no remote operation; keep the archive commit on the bound branch.
- B, archive and push now: push the bound branch once.
- C, archive, push, and create a PR: push the bound branch once, then create a PR through the configured GitHub integration. The explicit Step 1 choice authorizes PR creation; do not replace it with another branch-handling method.

After a push or PR call, use delivery --verify to check the actual remote branch and PR. After successful PR creation, record the actual prUrl through delivery --file while preserving action, target, and commit. On timeout or an uncertain response, inspect the actual result before retrying. Keep delivery and current selection on failure, and resume only missing authorized actions. Do not rewrite, delete, or switch branches.

Local requires Runtime to confirm that the archive commit exists. Push additionally requires the remote to contain that commit. PR additionally requires the matching PR and target. Merely filling commit/prUrl does not prove delivery. Run clear-selection and announce completion only after Runtime verifies every selected action.

Do not invoke Superpowers `finishing-a-development-branch` in Archive. Do not offer local merges, branch switches/deletion, rebases, or other branch-topology changes. Choose A for local archive completion or E to defer archive.

## Exit conditions

- The archive script succeeded with exit code 0.
- `<classic-archive-root>/YYYY-MM-DD-<change-name>/` exists.
- Archived `.comet.yaml` records `archived: true`.
- The single archive commit includes `branch_status: handled` in archived state.
- `comet guard <change-name> archive` passes.
- The archive commit was handled as confirmed: A stays local, B was pushed successfully, or C was pushed and has a PR.
- Current selection was cleared after the selected handling completed.

The script moves `<classic-change-dir>/` to `<classic-archive-root>/YYYY-MM-DD-<name>/`.

`comet guard <change-name> archive` resolves the actual archive directory from the original change name. Do not construct a dated directory manually.

## Completion

The Comet Classic workflow is complete. Start new Classic work with `/comet-classic` or `/comet-open`.

## Recover after context compaction

Follow context-recovery.md with phase archive. Read saved delivery records rather than recalling A/B/C from conversation. After Runtime checks the archive directory, commits, remote, and PR, continue only missing actions; local performs no remote operations. Stop for explicit confirmation if an older change has only handled, authorization is missing, the target changed, or branch relationships differ from the record. Do not infer authorization or repair branch relationships automatically.
