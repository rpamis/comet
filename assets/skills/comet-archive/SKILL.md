---
name: comet-archive
description: 'Archive and deliver a Classic change. Use when the user invokes /comet-archive or Classic Runtime enters Archive or resumes delivery.'
---

# Comet Phase 5: Archive

On first entering a phase, handing off to a new Agent, or restoring context, read and follow [Task Context and Artifact Language](../comet-classic/reference/scripts.md#task-context-and-artifact-language). Prefer the current continuation or claimed Action's `contextRequest`; do not retrieve repeatedly during uninterrupted work in the same phase.

After entry returns layout, follow `comet-classic/reference/classic-layout.md` to bind each logical root to its directory. Do not reload the protocol if it is already in context. Use the adapter for OpenSpec CLI calls and the bound `<classic-*>` roots for paths; do not run an extra root show first.

## SDK Run path

On first entering the current SDK phase, handing off to a new Agent, or restoring context, read [phase entry and recovery](../comet-classic/reference/sdk-methods.md#phase-entry-and-recovery) and the current phase's section in that reference. Reuse them when already available and still valid in this session. Continue with the phase below; recovery routes based on `nextAction.kind` apply only to older responses without a continuation mode.

Reuse the latest valid response for the same change, workspace, and Run: `agent.continuation`, `data.nextAction`, phase, revision, and path summaries. Run `comet state next <change-name> --json` only for cold recovery, workspace or external state changes, a stale response version, or missing information needed for the current step; loading the next Skill is not a reason to query again. Runtime still validates current versions and evidence on writes; cached context cannot bypass checks or approval. Confirm `data.runtimeFormat: sdk`, phase, and `nextAction.kind`, and work in the bound `projectRoot`; run `comet classic workspace resolve <change-name> --json` only when paths are missing or the binding has changed. Verify receipts must still be valid; the state file and a report file do not authorize delivery. For `reconcile`, use `comet state check <change-name> archive --recover --json` to inspect the original Action and disk/Git evidence. Do not repeat archive, commit, push, or PR while the result is unknown.

1. Reuse current valid state, workspace, and evidence summaries; run `comet state check <change-name> archive --json` only when they are missing. Under SDK execution methods, inspect verification, the bound branch, archive impact, and unrelated edits. For push or PR, confirm remote and PR base; do not guess among alternatives. Run `comet state propose-archive <change-name> --summary "<delivery-summary>"`, adding `--remote <name>` and `--pr-base <branch>` as needed. Save `data.wait.proposalHash` as `<proposalHash>`. Reuse an existing pending Wait.
2. Present the current proposal and delivery options under decision-point.md and the Archive and Git delivery section of SDK execution methods. Reuse explicit authorization covering the current archive effects and same delivery target; otherwise await the user choice. Run `comet state decide-archive <change-name> --proposal-hash <proposalHash> --choice <local|push|pr|reverify|later>`: local archives and commits, push additionally pushes, pr pushes and creates the PR, reverify returns to Verify, and later preserves work and stops this invocation. Recheck and obtain a new decision if target or Verify evidence changes; never reuse a stale proposal hash.
3. Only with a valid `local|push|pr` decision, apply directly `comet guard <change-name> archive --apply`. Guard checks authorization, branch, and Verify receipts and archives OpenSpec once in the Run. After interruption inspect `state next --json` and `--recover`; do not apply an already completed archive again.
4. Under the Archive and Git delivery section of SDK execution methods, inspect dirty-worktree ownership and explicitly stage this change's implementation, archive directory, main spec, and Design Doc/Plan annotations. Inspect the staged diff, then create one archive commit. SDK Guard does not perform Git operations. Do not use legacy `state set branch_status`, `state delivery`, or `archive-confirm`. For push, push only the approved remote/branch. For PR, push first, then create a PR with the approved target. On an unknown result, read the remote or PR before retrying.
5. Run `comet state complete-delivery <change-name> --commit <sha>` with the real commit; for PR add `--pr-url <url>`. It validates the archive commit and approved remote/PR delivery and completes the Run; it does not commit, push, or create a PR. On failure preserve the Run and decision and address the reported gap. Claim delivery complete only when that response shows a completed Run and a done continuation; run `comet state next <change-name> --json` only if the terminal state is missing.

## Compat path

The remaining original Runtime steps apply only to `runtimeFormat: compat`. Read [Compat operations](reference/compat.md) and continue its current phase. SDK does not load that reference.
