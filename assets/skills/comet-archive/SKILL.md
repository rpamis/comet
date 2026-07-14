---
name: comet-archive
description: "Use only when explicitly invoked as /comet-archive or routed by the root Comet skill/runtime to the archive phase; confirm archive, merge delta specs, and finish the branch."
---

# Comet Phase 5: Archive (Archive)

## Prerequisites

- Verification passed (Phase 4 complete)
- Archive commit and branch handling are still pending (`branch_status: pending`)
- `verify_result: pass` in `openspec/changes/<name>/.comet.yaml`

## Steps

### 0. Output Language Constraint

Archive summaries and lifecycle closure notes must use the configured Comet artifact language from `comet state get <name> language`.

### 0. Entry State Verification (Entry Check)

Use the stable `comet` CLI described in `comet/reference/scripts.md`, then run entry verification. When resuming from any entry point, first run the recovery check in `comet/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <name> archive
```

Proceed to Step 1 after verification passes. The script outputs specific failure reasons when verification fails.

### 1. Final Archive Confirmation (Blocking Point)

After entry verification passes, **must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to confirm whether to archive immediately**. Must not run `comet archive "<change-name>"` before user confirmation.

Before confirmation, show the user a brief summary:
- Change name
- Verification report path and result
- Current branch/workspace and attribution summary for pre-existing dirty changes
- Irreversible actions this archive will perform: merge main specs with OpenSpec delta semantics, annotate design doc / plan, and move the change to the archive directory

The user confirmation question must be presented as a single-select question with these options:
- "Confirm archive" — record the final confirmation state, then run the archive script to complete spec merge and change movement
- "Needs adjustment or re-verification" — do not archive; run `comet state transition <change-name> archive-reopen` to return to `phase: verify`, then invoke `/comet-verify`. If verification confirms fixes are needed, follow `/comet-verify`'s verification-failure decision flow back to `/comet-build`
- "Do not archive yet" — do not archive; keep the current `phase: archive` state and wait for the user to invoke `/comet-archive` again later

After the user selects "Confirm archive", immediately run:

```bash
comet state transition <change-name> archive-confirm
```

If the transition returns a non-zero exit code, report the error and stop. Only after the transition succeeds may Step 2 continue. After the user selects "Needs adjustment or re-verification", must first run the `archive-reopen` state transition; do not edit `.comet.yaml` manually.

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
- The change directory moved from `openspec/changes/<name>/` to `openspec/changes/archive/YYYY-MM-DD-<name>/`
- The main spec content merged via delta semantics
- Archive metadata annotations on the design doc / plan

After archive, read `git status --short` and compare it with the pre-archive dirty-worktree attribution baseline. Stage only paths attributable to this change: the original active path, actual archive path printed by the command, main specs changed by this delta, and archive metadata on this Design Doc/Plan. Stop if any path cannot be attributed.

Use explicit pathspecs, then inspect the staged diff. Never stage the whole repository or mix the user's pre-existing changes into the archive commit:

```bash
git add -- <individually verified archive paths...>
git diff --cached --stat
git commit -m "chore: archive <change-name>"
```

Stop if the commit fails or the staged diff contains unrelated paths.

### 5. Handle the Branch After the Archive Commit

After the archive commit succeeds, **immediately execute:** use the Skill tool to load Superpowers `finishing-a-development-branch`. This ordering ensures the final branch or PR contains the main-spec merge and archive metadata.

If the skill is unavailable, stop and prompt the user to enable/install it; do not mark `branch_status` handled. After loading it, pause under `comet/reference/decision-point.md` and let the user choose:

1. Merge locally into the main branch
2. Push and create a PR
3. Keep the current branch for later

Archive is already complete, so do not offer "discard work". Only after the selected operation succeeds (or the user explicitly keeps the branch), run:

```bash
comet state set <change-name> branch_status handled
comet guard <change-name> archive
comet state clear-selection
```

The archive guard must verify both archive completeness and `branch_status: handled`; a failure means the workflow is still incomplete.

## Exit Conditions

- Archive script executed successfully (exit code 0)
- Archive directory `openspec/changes/archive/YYYY-MM-DD-<change-name>/` exists
- Archived `.comet.yaml` contains `archived: true`
- Archive changes were committed with exact pathspecs
- The user's branch decision completed and archived state has `branch_status: handled`
- `comet guard <change-name> archive` passes

The archive script moves `openspec/changes/<name>/` to `openspec/changes/archive/YYYY-MM-DD-<name>/`.

`comet guard <change-name> archive` resolves the actual archive directory from the original change name; do not construct a dated archive path manually.

## Complete

Comet workflow complete. To start new work, invoke `/comet` or `/comet-open`.

## Context Compression Recovery

Follow `comet/reference/context-recovery.md` with phase set to `archive`. If `archived: true` and archive directory exists, archival is complete — do not re-execute archive operations.
