---
name: comet-hotfix
description: 'Use the Classic preset to repair a localized defect. Use when the user explicitly invokes /comet-hotfix, selects hotfix, or resumes workflow: hotfix.'
---

# Comet Preset: Hotfix

Before starting or resuming, read and follow `comet-classic/reference/classic-layout.md`. All OpenSpec CLI calls must use the adapter, and all paths must use the bound `<classic-*>` logical roots.

A short defect-repair flow: open → build → root cause check → verify → archive. It skips brainstorming and a full implementation plan, and applies to repairing existing behavior without designing new features.

**All applicability conditions must hold:**

1. Repair an existing feature's defect without adding a feature.
2. No interface changes or architectural redesign.
3. The scope can be estimated. File counts are only a prompt for review, not an automatic escalation rule; see “Escalation decisions.”

**When the preset may no longer fit:** If the repair encounters changes listed under “Escalation decisions,” let the user decide whether to use the full `/comet-classic` flow.

On first entering a phase, handing off to a new Agent, or restoring context, read and follow [Task Context and Artifact Language](../comet-classic/reference/scripts.md#task-context-and-artifact-language). Prefer the current continuation or claimed Action's `contextRequest`; do not retrieve repeatedly during uninterrupted work in the same phase.

Personal memory contains reusable user information, never task summaries, progress, command output, or test results.

## SDK Run path

On entering an SDK phase, read its section in [SDK execution methods](../comet-classic/reference/sdk-methods.md). For denied Verify edits or pending review proposals, read [edit review](../comet/reference/edit-review.md).

New SDK changes use `comet-state.yaml`. Historical `.comet.yaml` files remain in place for reads and writes; compat initialization still uses the old name. If both names exist, including a dangling symlink, stop and preserve them rather than renaming or overwriting either. Use the ownership and paths returned by Runtime.

When the response already includes `agent.continuation.mode`, follow `comet-classic/reference/auto-transition.md` first. `wait` means wait for the original task, without running recovery queries merely because the compatibility field says `nextAction.kind: reconcile`. Use the current response’s commands and inputs; submit `completion` only after the Skill’s actual work is complete. Recovery rules in this section based on `nextAction.kind` apply only to older responses without `mode`.

At entry or resume, reuse the current valid result's `agent.continuation` / `data.nextAction` and the bound change, workspace, phase, and Run revision. Route by the known `data.runtimeFormat`. Run `comet state next <change-name> --json` only on a cold resume, after external state changes, or when this information is missing. For `sdk`, use this section for state changes. The applicability, reproduction, root-cause repair, escalation, and file-count authorization rules in SDK execution methods apply; submit state and evidence through this section. For `nextAction.kind: reconcile`, run `comet state check <change-name> <phase> --recover --json` to investigate the original Action; do not repeat implementation, checks, or archive while its result is unknown.

1. For a new change, choose isolation under [workspace selection](../comet-classic/reference/workspace.md). Run `comet classic workspace prepare <name> --isolation <selected-isolation> --json`, enter `projectRoot`, then run `comet state init <name> hotfix --isolation <selected-isolation>` ; then run `comet state select <name>` to bind Hook routing. Create concise OpenSpec artifacts under SDK execution methods. Preview `comet guard <change-name> open --json`. Save `data.approvalHash`, show the user the Open artifacts and scope, and obtain explicit approval before running `comet guard <change-name> open --apply --approval-hash <approvalHash>`. If artifacts change, preview and obtain approval again; do not reuse the old hash. Open completes only when the Run enters Build; the state file is `comet-state.yaml` in the change directory; historical changes retain their original filename.
2. At `hotfix.build.execute`, keep the same change, workspace, and Run and resume Build directly; do not initialize again or repeat Open. Reproduce the defect, preserve failure evidence, complete tasks, and check the root cause under SDK execution methods. On a material escalation signal or file-count overage without valid authorization, run `comet state propose-escalation <change-name> --reason "<reason>"`. Present the reason and effects of continuing hotfix versus upgrading to full; save `data.wait.proposalHash`. After explicit choice, run `comet state decide-escalation <change-name> --proposal-hash <proposalHash> --choice <continue|upgrade>`. Continuing still requires the scope, risk, and ruling conditions in SDK execution methods. Upgrade enters full Design in the same Run and workspace; immediately load comet-design through the standard trigger. Reuse a pending Wait on recovery.
3. When root cause and tasks are complete and hotfix still fits, run `comet guard <change-name> build --apply -- <program> [args...]` with the full build or acceptance command. There is no new user decision here: `--apply` revalidates current tasks, configuration, workspace, and evidence before executing and recording the real check. Only valid success enters Verify. Use the read-only `comet guard <change-name> build` preview only when diagnosis is needed. On failure use the returned current state, reading `state next --json` only when no continuation was returned; do not replay an unknown Action.
4. When the Run enters Verify, **Immediately execute:** Use the Skill tool to load the comet-verify skill. Skipping this step is prohibited. Its SDK path handles the report, independent review, and real check receipt. When the Run enters Archive, **Immediately execute:** Use the Skill tool to load the comet-archive skill. Skipping this step is prohibited. Archive and delivery still need current user authorization; claim completion only when the current successful result shows a completed Run; read `state next --json` if completion state is missing.

After each advance, use that result's `agent.continuation` / `data.nextAction`. Do not repeat next, select, or check while state is valid and complete; read again only on a cold resume, after external state changes, or for missing information. Resolve `decision`, `evidence`, or `reconcile` within the current Run; execute the corresponding step only for `action`.
For deterministic local checks, add --local before -- as described in SDK execution methods; Runtime validates full inputs and logs before reuse. External checks still execute. Associate SDK Build with a stable --session <builder-execution-ref>; full complete-build already carries it when supplied.

## Compat path

The remaining original Runtime steps apply only to `runtimeFormat: compat`. Read [Compat operations](reference/compat.md) and continue its current phase. SDK does not load that reference.
