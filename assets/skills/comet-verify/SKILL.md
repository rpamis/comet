---
name: comet-verify
description: 'Verify a Classic change and record the results. Use when the user invokes /comet-verify or Classic Runtime enters Verify.'
---

# Comet Phase 4: Verify

On first entering a phase, handing off to a new Agent, or restoring context, read and follow [Task Context and Artifact Language](../comet-classic/reference/scripts.md#task-context-and-artifact-language). Prefer the current continuation or claimed Action's `contextRequest`; do not retrieve repeatedly during uninterrupted work in the same phase.

After entry returns layout, follow `comet-classic/reference/classic-layout.md` to bind each logical root to its directory. Do not reload the protocol if it is already in context. Use the adapter for OpenSpec CLI calls and the bound `<classic-*>` roots for paths; do not run an extra root show first.

When an edit needs an actual-impact judgement or a continuation points to a content judgement, you must read and follow [edit continuation](../comet/reference/edit-review.md). The current Agent merges the handling of changes, keeps the original Run, valid approvals, and checks, and adds only evidence for what is affected.

## SDK Run path

On first entering the current SDK phase, handing off to a new Agent, or restoring context, read [phase entry and recovery](../comet-classic/reference/sdk-methods.md#phase-entry-and-recovery) and the current phase's section in that reference. Reuse them when already available and still valid in this session. Continue with the phase below; recovery routes based on `nextAction.kind` apply only to older responses without a continuation mode.

Reuse the latest valid response for the same change, workspace, and Run: `agent.continuation`, `data.nextAction`, phase, revision, and path summaries. Run `comet state next <change-name> --json` only for cold recovery, workspace or external state changes, a stale response version, or missing information needed for the current step; loading the next Skill is not a reason to query again. Runtime still validates current versions and evidence on writes; cached context cannot bypass checks or approval. Confirm `data.runtimeFormat: sdk`, `data.phase: verify`, and `nextAction.kind`, and work in the bound `projectRoot`. Run `comet classic workspace resolve <change-name> --json` only when paths are missing or the binding has changed; use `comet state check <change-name> verify --json` only when current task, workspace, or evidence summaries are missing. For `reconcile`, use `comet state check <change-name> verify --recover --json` to investigate the original Action and check; stop if its result remains unknown.

1. Follow the risk assessment, integrated review, and light/full verification methods in SDK execution methods, but use the SDK Run as evidence authority. Do not call legacy `state scale`, `state set`, `comet handoff`, or `comet check` evidence commands. For implementation or task defects, report the specific failure. Only when `<profile>.verify.run` is pending (`<profile>` is full, hotfix, or tweak), run `comet state transition <change-name> verify-fail --reason "<failure-reason>"`. It records a failed Verify Action and returns to Build. Follow the current Build Action from that response; query `state next --json` only if continuation information is missing. Investigate existing failed or unknown checks before reporting another failure.
2. When verification passes, write actual checks, evidence references, independent review, and acceptable deviations in a repository report at `<report-ref>`. Run directly `comet guard <change-name> verify --report <report-ref> --apply -- <program> [args...]` with an explicit complete verification command. Guard records the report, evidence, and real check receipt in one Run; a manual claim is insufficient. On check failure, use the failure receipt and current Build or Verify Action from the same response; query `state next --json` only if they are missing, and follow the latest Action.
3. After Guard succeeds, use that response directly; run `comet state next <change-name> --json` only if phase or nextAction is missing. Load `/comet-archive` only when phase is Archive and `nextAction.kind` points there. Verify passing does not itself authorize Archive; obtain the current delivery decision there.

## Compat path

The remaining original Runtime steps apply only to `runtimeFormat: compat`. Read [Compat operations](reference/compat.md) and continue its current phase. SDK does not load that reference.
