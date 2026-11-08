---
name: comet-verify
description: 'Verify a Classic change and record the results. Use when the user invokes /comet-verify or Classic Runtime enters Verify.'
---

# Comet Phase 4: Verify

On first entering a phase, handing off to a new Agent, or restoring context, read and follow [Task Context and Artifact Language](../comet-classic/reference/scripts.md#task-context-and-artifact-language). Prefer the current continuation or claimed Action's `contextRequest`; do not retrieve repeatedly during uninterrupted work in the same phase.

After entry returns layout, follow the [shared phase entry](../comet-classic/reference/scripts.md#shared-phase-entry) when receiving a phase for the first time or when its binding changes. Reuse the valid [layout](../comet-classic/reference/classic-layout.md); do not run an extra root show first. When edits require judgement, load edit continuation through the shared entry.

## SDK Run path

Run the first complete verification through `comet check run <change-name> verify --report <report-ref> --local -- <program> [args...]` as described in SDK execution methods. Declare the final report path first, inspect the real receipt, finish acceptance, and write the report without first running the same command separately. Omit `--local` for external-state or nonrepeatable checks. Submit Guard afterward; this first check does not advance the phase.

On first entering the current SDK phase, handing off to a new Agent, or restoring context, read [phase entry and recovery](../comet-classic/reference/sdk-methods.md#phase-entry-and-recovery) and the current phase's section in that reference. Reuse them when already available and still valid in this session. Continue with the phase below; recovery routes based on `nextAction.kind` apply only to older responses without a continuation mode.

Reuse the latest valid response for the same change, workspace, and Run: `agent.continuation`, `data.nextAction`, phase, revision, and path summaries. Run `comet state next <change-name> --json` only for cold recovery, workspace or external state changes, a stale response version, or missing information needed for the current step; loading the next Skill is not a reason to query again. Runtime still validates current versions and evidence on writes; cached context cannot bypass checks or approval. Confirm `data.runtimeFormat: sdk`, `data.phase: verify`, and `nextAction.kind`, and work in the bound `projectRoot`. Run `comet classic workspace resolve <change-name> --json` only when paths are missing or the binding has changed; use `comet state check <change-name> verify --json` only when current task, workspace, or evidence summaries are missing. For `reconcile`, use `comet state check <change-name> verify --recover --json` to investigate the original Action and check; stop if its result remains unknown.

1. Follow the risk assessment, integrated review, and light/full verification methods in SDK execution methods, but use the SDK Run as evidence authority. Do not call legacy `state scale`, `state set`, `comet handoff`, or `comet check` evidence commands. For implementation or task defects, report the specific failure. Only when `<profile>.verify.run` is pending (`<profile>` is full, hotfix, or tweak), run `comet state transition <change-name> verify-fail --reason "<failure-reason>"`. It records a failed Verify Action and returns to Build. Follow the current Build Action from that response; query `state next --json` only if continuation information is missing. Investigate existing failed or unknown checks before reporting another failure.
2. When verification passes, write actual checks, evidence references, independent review, and acceptable deviations in a repository report at `<report-ref>`. Run directly `comet guard <change-name> verify --report <report-ref> --apply -- <program> [args...]` with an explicit complete verification command. Guard records the report, evidence, and real check receipt in one Run; a manual claim is insufficient. On check failure, use the failure receipt and current Build or Verify Action from the same response; query `state next --json` only if they are missing, and follow the latest Action.
3. After Guard succeeds, use that response directly; run `comet state next <change-name> --json` only if phase or nextAction is missing. Load `/comet-archive` only when phase is Archive and `nextAction.kind` points there. Verify passing does not itself authorize Archive; obtain the current delivery decision there.

## Compat path

The remaining original Runtime steps apply only to `runtimeFormat: compat`. Read [Compat operations](reference/compat.md) and continue its current phase. SDK does not load that reference.

## Optional change walkthrough

At Build completion and before presenting Verify results, check the project `.comet/config.yaml` field `change_walkthrough` (enabled by default; only explicit `false` disables it). When enabled, read and execute [Change walkthrough](../comet/reference/change-walkthrough.md), use the shared template to generate or update the same `walkthrough.html`, and provide an opening link. When disabled, skip extra explanation, detailed instructions and rendering; retain the existing summary. Archive preserves existing pages with the materials and links to their actual archived location; it does not generate missing pages, add confirmation or rerun code checks for page updates.
