---
name: comet-archive
description: "Use when a Comet change has passed verification and needs archive confirmation, delta spec merge, or archive-phase recovery."
---

# Comet Phase 5: Archive (Archive)

## Prerequisites

- Verification passed (Phase 4 complete)
- Branch handled
- `verify_result: pass` in `openspec/changes/<name>/.comet.yaml`

## Steps

### 0. Output Language Constraint

Archive summaries and lifecycle closure notes must use the configured Comet artifact language from `"$COMET_BASH" "$COMET_STATE" get <name> language`.

### 0. Entry State Verification (Entry Check)

Locate scripts via `comet/reference/scripts.md`, then run entry verification. When resuming from any entry point, first run the recovery check in `comet/reference/context-recovery.md`:

```bash
node "$COMET_STATE" check <name> archive
```

Proceed to Step 1 after verification passes. The script outputs specific failure reasons when verification fails.

### 1. Final Archive Confirmation (Blocking Point)

After entry verification passes, **must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to confirm whether to archive immediately**. Must not run `node "$COMET_ARCHIVE" "<change-name>"` before user confirmation.

Before confirmation, show the user a brief summary:
- Change name
- Verification report path and result
- Branch handling status
- Irreversible actions this archive will perform: merge main specs with OpenSpec delta semantics, annotate design doc / plan, and move the change to the archive directory

The user confirmation question must be presented as a single-select question with these options:
- "Confirm archive" — immediately run the archive script to complete spec merge and change movement
- "Needs adjustment or re-verification" — do not archive; run `node "$COMET_STATE" transition <change-name> archive-reopen` to return to `phase: verify`, then invoke `/comet-verify`. If verification confirms fixes are needed, follow `/comet-verify`'s verification-failure decision flow back to `/comet-build`
- "Do not archive yet" — do not archive; keep the current `phase: archive` state and wait for the user to invoke `/comet-archive` again later

Only after the user selects "Confirm archive" may Step 2 continue. After the user selects "Needs adjustment or re-verification", must first run the `archive-reopen` state transition; do not edit `.comet.yaml` manually.

### 2. Execute Archive

Run the archive script to automatically complete all steps:

```bash
node "$COMET_ARCHIVE" "<change-name>"
```

The script automatically executes:
1. Entry state validation (phase=archive, verify_result=pass, archived=false)
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

### 4. Commit the Archive Changes

The archive script only moves files and merges the spec; it does not commit. After archiving, the worktree holds these uncommitted changes:
- The change directory moved from `openspec/changes/<name>/` to `openspec/changes/archive/YYYY-MM-DD-<name>/`
- The main spec content merged via delta semantics
- Archive metadata annotations on the design doc / plan

**You must prompt the user to commit these archive changes**, otherwise the archived result stays in the worktree. After showing the pending files, suggest:

```bash
git add -A
git commit -m "chore: archive <change-name>"
```

If branch handling (phase 4) chose not to merge into the main branch yet, finish up via the selected option (merge / PR / keep branch) together with this commit.

## Exit Conditions

- Archive script executed successfully (exit code 0)
- Archive directory `openspec/changes/archive/YYYY-MM-DD-<change-name>/` exists
- Archived `.comet.yaml` contains `archived: true`

The archive script moves `openspec/changes/<name>/` to `openspec/changes/archive/YYYY-MM-DD-<name>/`.

> **WARNING**: After successful archive, **do not run** `node "$COMET_GUARD" <change-name> archive` against the old active change name; the active directory no longer exists. Doing so will cause the guard to error with "change directory not found". Archive completeness is determined by script exit code and archived directory state.

## Complete

Comet workflow complete. To start new work, invoke `/comet` or `/comet-open`.

## Context Compression Recovery

Follow `comet/reference/context-recovery.md` with phase set to `archive`. If `archived: true` and archive directory exists, archival is complete — do not re-execute archive operations.
