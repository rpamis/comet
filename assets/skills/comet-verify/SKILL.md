---
name: comet-verify
description: 'Verify a Classic change and record the results. Use when the user invokes /comet-verify or Classic Runtime enters Verify.'
---

# Comet Phase 4: Verify

On first entering a phase, handing off to a new Agent, or restoring context, read and follow [Task Context and Artifact Language](../comet-classic/reference/scripts.md#task-context-and-artifact-language). Prefer the current continuation or claimed Action's `contextRequest`; do not retrieve repeatedly during uninterrupted work in the same phase.

After entry returns layout, follow the [shared phase entry](../comet-classic/reference/scripts.md#shared-phase-entry) when receiving a phase for the first time or when its binding changes. Reuse the valid [layout](../comet-classic/reference/classic-layout.md); do not run an extra root show first. When edits require judgement, load edit continuation through the shared entry.

## SDK Run path

First follow [ordinary commands and checks](../comet/reference/platform-execution.md). New and upgraded Runs use platform tools and submit actual reports to the original Run. Automatic upgrades do not restore old check executors. Phase preparation, user choices, task completion, and acceptance requirements remain in force.

On first entering the current SDK phase, handing off to a new Agent, or restoring context, read [phase entry and recovery](../comet-classic/reference/sdk-methods.md#phase-entry-and-recovery) and the current phase's section in that reference. Reuse them when already available and still valid in this session. Continue with the phase below; recovery routes based on `nextAction.kind` apply only to older responses without a continuation mode.

Reuse the latest valid response for the same change, workspace, and Run: `agent.continuation`, `data.nextAction`, phase, revision, and path summaries. Run `comet state next <change-name> --json` only for cold recovery, workspace or external state changes, a stale response version, or missing information needed for the current step; loading the next Skill is not a reason to query again. Runtime still validates current versions and evidence on writes; cached context cannot bypass checks or approval. Confirm `data.runtimeFormat: sdk`, `data.phase: verify`, and `nextAction.kind`, and work in the bound `projectRoot`. Run `comet classic workspace resolve <change-name> --json` only when paths are missing or the binding has changed; use `comet state check <change-name> verify --json` only when current task, workspace, or evidence summaries are missing. For `reconcile`, use `comet state check <change-name> verify --recover --json` to investigate the original Action and check; stop if its result remains unknown.

1. Follow the risk assessment, integrated review, and light/full verification methods in SDK execution methods, but use the SDK Run as evidence authority. Do not call legacy `state scale`, `state set`, `comet handoff`, or `comet check` evidence commands. For implementation or task defects, report the specific failure. Only when `<profile>.verify.run` is pending (`<profile>` is full, hotfix, or tweak), run `comet state transition <change-name> verify-fail --reason "<failure-reason>"`. It records a failed Verify Action and returns to Build. Follow the current Build Action from that response; query `state next --json` only if continuation information is missing. Investigate existing failed or unknown checks before reporting another failure.
2. After acceptance succeeds, save actual checks, evidence references, review conclusions, and acceptable deviations in `<report-ref>`. Submit `comet guard <change-name> verify --report <report-ref> --apply --checks <checks-json-file>`. Guard validates this Run’s report and acceptance requirements without repeating commands. For failures or unknown results, inspect the original task using the returned Action; read `state next --json` only if continuation is missing. Do not interpret failure as success.

3. After Guard succeeds, use that response directly; run `comet state next <change-name> --json` only if phase or nextAction is missing. Load `/comet-archive` only when phase is Archive and `nextAction.kind` points there. Verify passing does not itself authorize Archive; obtain the current delivery decision there.

## Compat path

The remaining original Runtime steps apply only to `runtimeFormat: compat`. Read [Compat operations](reference/compat.md) and continue its current phase. SDK does not load that reference.

## Optional change walkthrough

At Build completion and before presenting Verify results, check the project `.comet/config.yaml` field `change_walkthrough` (enabled by default; only explicit `false` disables it). When enabled, read and execute [Change walkthrough](../comet/reference/change-walkthrough.md), use the shared template to generate or update the same `walkthrough.html`, and provide an opening link. When disabled, skip extra explanation, detailed instructions and rendering; retain the existing summary. Archive preserves existing pages with the materials and links to their actual archived location; it does not generate missing pages, add confirmation or rerun code checks for page updates.
