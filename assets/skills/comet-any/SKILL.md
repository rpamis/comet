---
name: comet-any
description: 'Create or continue Native extensions, Classic compositions, or standalone SDK workflows from a natural-language goal; inspect real Skills, confirm a plan, then generate and preview installation. Not for general Skill authoring, cleanup, or review.'
disable-model-invocation: true
---

# Comet Any

After the user describes a goal, inspect real Skills and show a concrete workflow. Creator preserves the goal, plan, decisions, fixed dependencies, compiled artifacts, and installation preview for the same creation; continue through public `comet creator` commands. After each stage, read the current action and keep progressing until completion, a user decision, or an external capability blocker.

## Start or resume

1. When the creation name is known, run `comet creator status <name> --project <project> --json`, then `comet creator next <name> --project <project> --json`. Preserve the original name and Run; after interruption, inspect the original Action and do not repeat completed work.
2. For a new creation, read `comet creator guide --project <project> --json`. Determine the goal and installation location from the user's description; ask only about choices that cannot be investigated and would change the result. Start with `comet creator start <name> --project <project> --goal <user-goal> --install-target <relative-directory> --host codex|claude-code --json`.
3. Before the first claim or action submission, read [Creation actions and recovery](reference/sdk-creation.md). Use the returned Action, attempt, inputHash, and the current host session identifier; when the current action lacks a required capability, report the blocker and preserve the current work.

## Analysis and plan

`analyze` requires the host to read real Skills and organize a concrete plan. Delegate investigation or creation work according to its size; hand off only when needed, carrying the original goal, current action, scope, and fixed dependencies. There is no fixed subagent count.

1. Discover candidates with `comet creator candidates --project <project> --json`; read each candidate's `SKILL.md`, scripts, and necessary resources. Inspect actual inputs, outputs, authorization, host capabilities, completion conditions, failures, and recovery. Do not infer capability from a name or modify third-party originals.
2. For every Skill required by the plan:

   **Immediately execute:** Use the Skill tool to load the <skill-name> skill. Skipping this step is prohibited.

   After the skill loads, use its actual content to complete the adapter contract and content hash. Distinguish loading records, self-reported completion, machine checks, and independent review; a complete workflow that publishes or takes over approval cannot pose as ordinary guidance.

3. Choose the starting point the user needs: add steps, guidance, and review to Native; compose Classic at allowed positions in full, hotfix, and tweak; or declare a standalone workflow's own order, branches, joins, child workflows, and bounded repair. Report approval and publication is a runnable sample; it does not give every workflow Native independent verification.
4. Return the current analysis result in the reference's structure. The compiler assembles the actual workflow and execution bindings from the fixed plan; missing implementations, validators, dependencies, or capabilities block progress with a corrective action.

## Confirmation, validation, and delivery

1. When `next` reaches plan confirmation, show the actual steps, bound Skills, artifacts, checks, failure paths, and capability limits, including the optional Eval after compilation. Show the selected Agent and model, 2–4 cases, interaction turns, and total timeout; other platforms require separate evaluation. Credentials enter only through the execution environment. Use `--eval-config <JSON-file>` or the analysis result's `evaluation` for non-sensitive settings.
2. After the user explicitly approves the current plan, submit the user decision for the current `confirm-plan`. A hash only identifies the plan; having a hash does not grant authorization. Rejection preserves the current work; use `revise` for plan changes and repeat affected confirmation and validation.
3. Continue calling `next` to compile and validate by actually loading the application. On failure, correct the existing work and resume the original Action; success strings cannot replace real artifacts, Schema, candidate, or dependency checks.
4. At `confirm-eval`, show the current evaluation preview and let the user choose evaluate, skip, or revise. After evaluate, continue calling `next`: Eval generates and freezes cases, runs the model and actual SDK Run checks, and saves the report without asking about every case. Retry reuses existing cases; revisions prefer the original cases. Failed or incomplete evaluation stops at `review-eval`; show the report, failures, and uncovered paths, and let the user choose retry, revise, or explicitly skip. Skipping does not turn failure into a pass. Reconcile uncertain execution against the original experiment and process before restarting.
5. Before installation, show the current target directory, files to be written, fixed versions, conflicts, and evaluation status, and explain that preview has not written the installation target. After explicit user approval, submit `confirm-install`; reuse valid existing approval without expanding its scope. Changes to the target, dependencies, files, or evaluation report require reconciliation and confirmation.
6. When creation completes, report the package and entry locations, actual checks, Eval report, unexecuted items, and limits. Identify the Agent, model, cases, and uncovered paths; distinguish skipped, failed, unavailable, and timed-out evaluation. Real host Hooks, handoffs, and other platforms require separate evidence. Local compilation or one passing Eval does not establish complete production acceptance.

## Recovery boundaries

- Continue with the original Run ID and current action; an old attempt, stale plan, or wrong candidate result cannot advance it.
- Reconcile uncertain results against actual compiled or installed files first; block when reconciliation is unavailable, without blindly repeating external work.
- Inject credentials only through the execution context, never into plans, generated packages, Runs, reports, or Agent configuration.
- Keep Codex and Claude Code adapter contracts; current candidate evidence determines whether real host and model acceptance has occurred in this round.
- Regenerate old `workflow-protocol.json` and legacy creation formats while preserving user files; do not silently convert them.
