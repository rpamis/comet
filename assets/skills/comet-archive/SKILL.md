---
name: comet-archive
description: "Phase 5 of Comet Classic — confirm archive, merge delta specs, and finish the branch."
---

# Comet Phase 5: Archive (Archive)

Before starting or recovering, read and follow `comet-classic/reference/classic-layout.md`. Every OpenSpec CLI call in this file must use the adapter, and every file path must use the `<classic-*>` logical roots bound by that protocol.

## Prerequisites

- Verification passed (Phase 4 complete)
- Archive commit and branch handling are still pending (`branch_status: pending`)
- `verify_result: pass` in `<classic-change-dir>/.comet.yaml`

## Steps

### 0. Output Language Constraint

Archive summaries and lifecycle closure notes must use the configured Comet artifact language from `comet state get <name> language`.

### 0. Entry State Verification (Entry Check)

Use the stable `comet` CLI described in `comet-classic/reference/scripts.md`, then run entry verification. When resuming from any entry point, first run the recovery check in `comet-classic/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <name> archive
```

Proceed to Step 1 after verification passes. The script outputs specific failure reasons when verification fails.

If the `select` / `check` output is `BLOCKED` because `bound_branch` does not match the current branch, immediately pause under `comet-classic/reference/decision-point.md` and let the user choose one option: switch back to the bound branch and rerun entry verification, or run `comet state rebind <change-name>` after the user explicitly confirms the current branch should take over this change, then rerun entry verification. Do not switch branches or rebind on your own.

### 1. Final Archive and Delivery Confirmation (Blocking Point)

After entry verification passes, first read `comet state get <change-name> isolation`, then **follow the `comet-classic/reference/decision-point.md` protocol to pause and wait for the user to confirm whether to archive and deliver remotely now**. Must not run `comet state transition <change-name> archive-confirm` or `comet archive "<change-name>"` before user confirmation.

Before confirmation, show the user a brief summary:
- Change name
- Verification report path and result
- Current branch/workspace and attribution summary for pre-existing dirty changes
- Irreversible actions this archive will perform: merge main specs with OpenSpec delta semantics, annotate design doc / plan, and move the change to the archive directory
- Remote delivery to perform after archive: push the current bound branch only, or push and then create a PR

The user confirmation question must be presented as a single-select question with these options:
- "Confirm archive and push now" — complete archive, create the only archive commit, and push the current bound branch
- "Confirm archive, push now, and create a PR" — complete archive, create the only archive commit, push the current bound branch, and create a PR
- "Needs adjustment or re-verification" — do not archive; run `comet state transition <change-name> archive-reopen` to return to `phase: verify`, then invoke `/comet-verify`. If verification confirms fixes are needed, follow `/comet-verify`'s verification-failure decision flow back to `/comet-build`
- "Do not archive yet" — do not run `archive-confirm` or the archive command; keep the active change, `phase: archive`, and `branch_status: pending`, then wait for the user to invoke `/comet-archive` again later

Only after the user selects one of the first two immediate-delivery choices, record that choice and immediately run:

```bash
comet state transition <change-name> archive-confirm
```

If the transition returns a non-zero exit code, report the error and stop. Only after the transition succeeds may Step 2 continue. After the user selects "Needs adjustment or re-verification", must first run the `archive-reopen` state transition; do not edit `.comet.yaml` manually. After the user selects "Do not archive yet", stop immediately; do not archive, commit, push, or set `branch_status` to `handled`.

### 2. Execute Archive

Run the archive script:

```bash
comet archive "<change-name>"
```

The script automatically executes:
1. Entry state validation (phase=archive, verify_result=pass, archive_confirmation=confirmed, archived=false)
2. Design doc frontmatter annotation (archived-with, status)
3. Plan frontmatter annotation (archived-with)
4. OpenSpec archive for delta-merge semantics and moving the change to the archive directory
5. Main spec guard against leaked delta-only section headings
6. Update archived state in the actual OpenSpec archive directory and reconcile pending recovery metadata

If script returns non-zero exit code, report error and stop.
If script returns zero exit code, archive is complete.

The summary `X/Y steps succeeded` counts real executed steps and does not double-count delta spec sync or document annotation.

The script calls OpenSpec archive to merge `ADDED/MODIFIED/REMOVED/RENAMED` delta semantics into main specs, then verifies main specs do not contain delta-only section headings.

Use `--dry-run` flag to preview without executing.

### 3. Lifecycle Closed Loop

Spec lifecycle completes here:
```
brainstorming → delta spec → implementation → verification → main spec merge → design doc annotation → archive
```

### 4. Commit Archive Changes with Exact Paths

The archive script only moves files and merges the spec; it does not commit. After archiving, the worktree holds these uncommitted changes:
- The change directory moved from `<classic-change-dir>/` to `<classic-archive-root>/YYYY-MM-DD-<name>/`
- The main spec content merged via delta semantics
- Archive metadata annotations on the design doc / plan

First persist the confirmed delivery choice into archived state, then run the final archive guard:

```bash
comet state set <change-name> branch_status handled
comet guard <change-name> archive
```

Here, `handled` means only that the user confirmed how to deliver this complete archive commit remotely. It does not mean that push or PR creation has succeeded. Stop without committing or performing remote operations if the state write or guard fails.

After archive, read `git status --short` and compare it with the pre-archive dirty-worktree attribution baseline. Stage only paths attributable to this change: the original active path, actual archive path printed by the command, the archived `.comet.yaml` updated to `branch_status: handled`, main specs changed by this delta, and archive metadata on this Design Doc/Plan. Stop if any path cannot be attributed.

Use explicit pathspecs, then inspect the staged diff. Never stage the whole repository or mix the user's pre-existing changes into the archive commit:

```bash
git add -- <individually verified archive paths...>
git diff --cached --stat
git commit -m "chore: archive <change-name>"
```

Stop if the commit fails or the staged diff contains unrelated paths.

### 5. Deliver the Archive Commit and Complete

After the archive commit succeeds, perform only the remote delivery method the user confirmed in Step 1:

- "Confirm archive and push now": push the current bound branch once.
- "Confirm archive, push now, and create a PR": push the current bound branch once, then create a PR through the configured GitHub integration. The explicit Step 1 choice authorizes PR creation; do not substitute another branch disposition.

If push fails, report the error and retain the current selection record; do not clear selection or report completion. Within the current task, retry only that same push. If PR creation fails, the branch already contains the complete archive commit; report the error and retain the current selection record. Within the current task, retry only PR creation. Do not automatically switch, delete, rebase, or rewrite branches after failure.

Only after every remote delivery operation selected by the user succeeds may you run `comet state clear-selection` and report the Classic workflow complete.

Archive no longer invokes Superpowers `finishing-a-development-branch`. Local merge, keeping a branch for later, or postponing push does not immediately produce final remote state, so the user must choose "Do not archive yet" in Step 1 rather than choosing it after archive.

## Exit Conditions

- Archive script executed successfully (exit code 0)
- Archive directory `<classic-archive-root>/YYYY-MM-DD-<change-name>/` exists
- Archived `.comet.yaml` contains `archived: true`
- Archived `branch_status: handled` is included in the only archive commit
- `comet guard <change-name> archive` passes
- The only archive commit was pushed successfully using the delivery method confirmed before archive; if the user selected PR creation, the PR was created successfully
- Current selection was cleared after remote delivery succeeded

The archive script moves `<classic-change-dir>/` to `<classic-archive-root>/YYYY-MM-DD-<name>/`.

`comet guard <change-name> archive` resolves the actual archive directory from the original change name; do not construct a dated archive path manually.

## Complete

Comet Classic workflow complete. To start new Classic work, invoke `/comet-classic` or `/comet-open`.

## Context Compression Recovery

Follow `comet-classic/reference/context-recovery.md` with phase set to `archive`. If `archived: true` and the archive directory exists, do not re-execute archive operations. Retry the same push or PR creation only when the current task context explicitly records the remote delivery method selected in Step 1. This Skill does not promise automatic recovery after the user leaves the flow and changes branch topology independently.
