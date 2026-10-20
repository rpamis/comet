---
name: comet-tweak
description: 'Use the Classic preset for a lightweight adjustment within one change. Use when the user explicitly invokes /comet-tweak, selects tweak, or resumes workflow: tweak.'
---

# Comet Preset: Tweak

Before starting or resuming, read and follow `comet-classic/reference/classic-layout.md`. All OpenSpec CLI calls must use the adapter, and all paths must use the bound `<classic-*>` logical roots.

Tweak provides preset choices for Comet's five-phase workflow. It uses OpenSpec for requirements and implementation, reuses open/build/verify/archive, and skips Superpowers brainstorming and a full implementation plan. It does not create a separate workflow.

Use it for configuration, documentation, or prompt adjustments, and moderate changes that need spec-driven implementation, including delta spec, without the full `/comet-classic` deep-design flow. Delta spec is a normal Tweak artifact; needing it is not by itself a reason to escalate.

**All applicability conditions must hold:**

1. The work fits in **one OpenSpec change**.
2. The solution can be clarified without a Superpowers Design Doc and full implementation plan.
3. No cross-module or cross-layer architectural coordination is needed.
4. Task scope can be estimated. File/task counts are prompts only, not automatic escalation rules; see “Escalation decisions.”

**When the preset may no longer fit:** If implementation encounters a change listed under “Escalation decisions,” let the user decide whether to use the full `/comet-classic` flow.

On first entering a phase, handing off to a new Agent, or restoring context, read and follow [Task Context and Artifact Language](../comet-classic/reference/scripts.md#task-context-and-artifact-language). Prefer the current continuation or claimed Action's `contextRequest`; do not retrieve repeatedly during uninterrupted work in the same phase.

Personal memory contains reusable user information, never task summaries, progress, command output, or test results.

## SDK Run path

On first entering the current SDK phase, handing off to a new Agent, or restoring context, read [phase entry and recovery](../comet-classic/reference/sdk-methods.md#phase-entry-and-recovery) and the current phase's section in that reference. Reuse them when already available and still valid in this session. Continue with the phase below; recovery routes based on `nextAction.kind` apply only to older responses without a continuation mode.

At entry or resume, reuse the current valid result's `agent.continuation` / `data.nextAction` and the bound change, workspace, phase, and Run revision. Route by the known `data.runtimeFormat`. Run `comet state next <change-name> --json` only on a cold resume, after external state changes, or when this information is missing. For `sdk`, use this section for state changes. The applicability, OpenSpec apply method, escalation, and file-count authorization rules in SDK execution methods apply; submit state and evidence through this section. For `nextAction.kind: reconcile`, run `comet state check <change-name> <phase> --recover --json` to investigate the original Action; do not repeat implementation, checks, or archive while its result is unknown.

1. For a new change, choose isolation under [workspace selection](../comet-classic/reference/workspace.md). Run `comet classic workspace prepare <name> --isolation <selected-isolation> --json`, enter `projectRoot`, create the OpenSpec base directory first under [Entry and artifacts](../comet-classic/reference/sdk-methods.md#entry-and-artifacts), then run `comet state init <name> tweak --isolation <selected-isolation>` ; then run `comet state select <name>` to bind Hook routing. Create OpenSpec artifacts under SDK execution methods, including any delta spec this change needs. Preview `comet guard <change-name> open --json`. Save `data.approvalHash`, show the user the Open artifacts and scope, and obtain explicit approval before running `comet guard <change-name> open --apply --approval-hash <approvalHash>`. If artifacts change, preview and obtain approval again; do not reuse the old hash. Open completes only when the Run enters Build.
2. At `tweak.build.execute`, keep the same change, workspace, and Run and resume Build directly; do not initialize again or repeat Open. Follow SDK document methods's OpenSpec apply method and complete the same tasks.md. On a material escalation signal or file-count overage without valid authorization, run `comet state propose-escalation <change-name> --reason "<reason>"`. Present the reason and effects of continuing tweak versus upgrading to full; save `data.wait.proposalHash`. After explicit choice, run `comet state decide-escalation <change-name> --proposal-hash <proposalHash> --choice <continue|upgrade>`. Continuing still requires the scope, risk, and ruling conditions in SDK execution methods. Upgrade enters full Design in the same Run and workspace; immediately load comet-design through the standard trigger. Reuse a pending Wait on recovery.
3. When tasks are complete and tweak still fits, run `comet guard <change-name> build --apply -- <program> [args...]` with the full build or acceptance command. There is no new user decision here: `--apply` revalidates current tasks, configuration, workspace, and evidence before executing and recording the real check. Only valid success enters Verify. Use the read-only `comet guard <change-name> build` preview only when diagnosis is needed. On failure use the returned current state, reading `state next --json` only when no continuation was returned; do not replay an unknown Action.
4. When the Run enters Verify, **Immediately execute:** Use the Skill tool to load the comet-verify skill. Skipping this step is prohibited. Cover delta-spec consistency in full verification when applicable; do not call legacy `state set verify_mode`. When the Run enters Archive, **Immediately execute:** Use the Skill tool to load the comet-archive skill. Skipping this step is prohibited. Archive and delivery still need current user authorization; claim completion only when the current successful result shows a completed Run; read `state next --json` if completion state is missing.

After each advance, use that result's `agent.continuation` / `data.nextAction`. Do not repeat next, select, or check while state is valid and complete; read again only on a cold resume, after external state changes, or for missing information. Resolve `decision`, `evidence`, or `reconcile` within the current Run; execute the corresponding step only for `action`.
For deterministic local checks, add --local before -- as described in SDK execution methods; Runtime validates full inputs and logs before reuse. External checks still execute. Associate SDK Build with a stable --session <builder-execution-ref>; full complete-build already carries it when supplied.

## Compat path

The remaining original Runtime steps apply only to `runtimeFormat: compat`. Read [Compat operations](reference/compat.md) and continue its current phase. SDK does not load that reference.
