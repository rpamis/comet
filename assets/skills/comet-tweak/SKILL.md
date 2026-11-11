---
name: comet-tweak
description: 'Use the Classic preset for a lightweight adjustment within one change. Use when the user explicitly invokes /comet-tweak, selects tweak, or resumes workflow: tweak.'
---

# Comet Preset: Tweak

Before starting or resuming, read and follow `comet-classic/reference/classic-layout.md`. All OpenSpec CLI calls must use the adapter, and all paths must use the bound `<classic-*>` logical roots.

Tweak provides preset choices for Comet's five-phase workflow. It uses OpenSpec for requirements and implementation, reuses open/build/verify/archive, and skips Superpowers brainstorming and a full implementation plan. It does not create a separate workflow.

Use it for configuration, documentation, or prompt adjustments, and moderate changes that need spec-driven implementation, including delta spec, without the full `/comet-classic` deep-design flow. Delta spec is a normal Tweak artifact; needing it is not by itself a reason to escalate.

**All applicability conditions must hold:**

1. Complete the work in one OpenSpec change.
2. Clarify the solution without a Superpowers Design Doc and full implementation plan.
3. No architectural coordination across modules or layers.
4. The scope is predictable. File and task counts are advisory and do not automatically require escalation; follow Preset scope in the SDK methods reference.

**Escalation:** If the changes listed in Preset scope arise, the user decides whether to switch to the full `/comet-classic` workflow.

On first entering a phase, handing off to a new Agent, or recovering context, read and follow [Task context and artifact language](../comet-classic/reference/scripts.md#task-context-and-artifact-language). Prefer the current continuation or claimed Action's `contextRequest`; do not fetch it again during uninterrupted work in the same phase.

Personal memory stores reusable user information. Never save task summaries, progress, command output, or test results.

## SDK Run path

First read and follow [ordinary commands and checks](../comet/reference/platform-execution.md). New and old Runs use platform tools for ordinary commands and submit actual check reports to the original Run. Automatic upgrades do not restore old check executors. Phase preparation, user choices, task completion, and acceptance requirements remain effective.

On first entering the current SDK phase, changing Agent, or recovering context, read [Phase entry and recovery](../comet-classic/reference/sdk-methods.md#phase-entry-and-recovery) and its current phase section. Reuse applicable instructions already in this session. Follow the current phase below; `nextAction.kind` recovery routing applies only to old responses without a continuation mode.

When starting or resuming, reuse valid `agent.continuation` / `data.nextAction` and the bound change, workspace, phase, and Run revision. Route by known `data.runtimeFormat`. Run `comet state next <change-name> --json` only for a cold resume, external state change, or missing information. Follow this section for `sdk`; the SDK methods reference still governs applicability, OpenSpec apply, escalation, and file-count authorization. Submit state and evidence through the commands below. For `nextAction.kind: reconcile`, run `comet state check <change-name> <phase> --recover --json` to inspect the original Action. Do not repeat implementation, checks, or Archive while its result is unknown.

1. For a new change, choose isolation through [Workspace selection](../comet-classic/reference/workspace.md). Run `comet classic workspace prepare <name> --isolation <selected-isolation> --json` and enter the returned `projectRoot`. Create the OpenSpec base directories through [Entry and artifacts](../comet-classic/reference/sdk-methods.md#entry-and-artifacts), run `comet state init <name> tweak --isolation <selected-isolation>`, then `comet state select <name>` to bind Hook routing. Follow Entry and artifacts to create the OpenSpec artifacts, including any needed delta spec. Preview with `comet guard <change-name> open --json` and retain `data.approvalHash`. Present the Open artifacts and scope to the user. After explicit approval, run `comet guard <change-name> open --apply --approval-hash <approvalHash>`. Changed artifacts require a fresh preview and approval; do not reuse an old hash. Open finishes only when the Run enters Build.
2. When `tweak.build.execute` is pending, resume Build in the same change, workspace, and Run. Do not initialize again or repeat Open. Follow the OpenSpec apply instructions in Preset scope, read the required context, implement each task, and check it off in the same tasks.md. For a material escalation signal, or a file-count limit without valid authorization, first run `comet state propose-escalation <change-name> --reason "<reason>"`. Present the reason and the effects of continuing tweak or upgrading to full; retain `data.wait.proposalHash`. After the user chooses, run `comet state decide-escalation <change-name> --proposal-hash <proposalHash> --choice <continue|upgrade>`. `continue` still requires the reference's scope, risk, and ruling conditions. `upgrade` enters full Design in the same Run and workspace; immediately follow the entry to load comet-design. Resume a pending Wait with its original proposal; do not repropose or choose for the user.
3. Once all tasks, necessary checks, and reviews are complete and the preset still applies, run `comet state complete-build <change-name> --session <builder-execution-ref> --checks <checks-json-file>` to submit actual results. This adds no user decision. Runtime validates tasks, configuration, workspace, and reports before entering Verify. On failure or uncertainty, inspect the original task through the returned current Action without repeating execution.
4. When the Run enters Verify, **Immediately execute:** Use the Skill tool to load the comet-verify skill. Skipping this step is prohibited. For delta spec, follow the reference's complete verification method to cover consistency; do not call the old `state set verify_mode`. When the Run enters Archive, **Immediately execute:** Use the Skill tool to load the comet-archive skill. Skipping this step is prohibited. Archive and delivery still require current user authorization. Claim completion only when the current successful result shows a completed Run; read `state next --json` if completion state is missing.

After each advance, use that result's `agent.continuation` / `data.nextAction`. Do not repeat next, select, or check while state is valid and complete; read again only on a cold resume, after external state changes, or for missing information. Resolve `decision`, `evidence`, or `reconcile` within the current Run; execute the corresponding step only for `action`.

Use the actual `--session <builder-execution-ref>` for SDK Build; do not repeat it when already supplied.

## Compat path

The remaining original Runtime steps apply only to `runtimeFormat: compat`. Read [Compat operations](reference/compat.md) and continue its current phase. SDK does not load that reference.

## Optional change walkthrough

At Build completion and before presenting Verify results, check the project `.comet/config.yaml` field `change_walkthrough` (enabled by default; only explicit `false` disables it). When enabled, read and execute [Change walkthrough](../comet/reference/change-walkthrough.md), use the shared template to generate or update the same `walkthrough.html`, and provide an opening link. When disabled, skip extra explanation, detailed instructions and rendering; retain the existing summary. Archive preserves existing pages with the materials and links to their actual archived location; it does not generate missing pages, add confirmation or rerun code checks for page updates.
