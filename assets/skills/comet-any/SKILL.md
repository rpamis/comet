---
name: comet-any
description: 'Inspect Skills for a goal and author the complete entry Skill and business Rule for Native extensions, Classic compositions, or standalone applications; after confirmation, the SDK assembles Runtime, connects Hooks, and previews installation. Not for general Skill cleanup or review.'
disable-model-invocation: true
---

# Comet Any

Investigate real Skills for the user's goal, then author the application's documents, workflow, and business implementation. Use `comet creator` to preserve the plan and progress. After each stage, read the current action and continue until completion, a user decision, or an external capability blocker.

The Agent writes the entry Skill, business Rule, execution ports, and validators. The SDK preserves the documents, appends execution protocol and common protection rules, and assembles Runtime. Business Rules describe business constraints; Runtime and Guard control actions, approval, and write permissions. Installation uses formal SDK distribution.

## Start or resume

1. When the creation name is known, run `comet creator status <name> --project <project> --json`, then `comet creator next <name> --project <project> --json`. Preserve the original name and Run; after interruption, inspect the original Action and do not repeat completed work.
2. For a new creation, read `comet creator guide --project <project> --json`. Determine the goal and installation location from the user's description; ask only about choices that cannot be investigated and would change the result. Start with `comet creator start <name> --project <project> --goal <user-goal> --install-target <relative-directory> --host codex|claude-code --json`.
3. Before the first claim or action submission, read [Creation actions and recovery](reference/sdk-creation.md). Use the returned Action, attempt, inputHash, and the current host session identifier; when the current action lacks a required capability, report the blocker and preserve the current work.

## Analysis and plan

The host investigates and authors during `analyze`. When delegation is needed, carry the original goal, current action, scope, and fixed dependencies.

1. Discover candidates with `comet creator candidates --project <project> --json`; read each candidate's `SKILL.md`, scripts, and necessary resources. Inspect actual inputs, outputs, authorization, host capabilities, completion conditions, failures, and recovery. Do not infer capability from a name or modify third-party originals.
2. For every Skill required by the plan:

   **Immediately execute:** Use the Skill tool to load the <skill-name> skill. Skipping this step is prohibited.

   After the skill loads, use its actual content to complete the adapter contract and content hash. Skills that approve or publish on their own must declare those capabilities and side effects.

3. Choose the starting point the user needs: add steps, guidance, and review to Native; compose Classic at allowed positions in full, hotfix, and tweak; or declare a standalone workflow's order, branches, joins, child workflows, and bounded repair. Include user interaction, shared-understanding confirmation, and implementation steps in Runtime.
4. Write the complete entry Skill: its frontmatter name equals the application id, and description states when it applies. The body explains inputs, dependency Skill calls, interaction and approval, artifacts, acceptance, failure, and recovery. Business Rules constrain the actual business behavior. Put detailed material in references when needed and state when to read it.
5. Return the documents using the reference's `documents` structure, together with the workflow and business ports. Complete missing documents, implementations, validators, dependencies, or capabilities in the analysis; use revise and reconfirm when a plan already exists.

## Confirmation, validation, and delivery

1. When `next` reaches plan confirmation, show the complete documents, content hashes, actual steps, Skill bindings, artifacts, checks, failure paths, and capability limits. Explain that Eval is optional after compilation.
2. After the user explicitly approves the current plan, submit the user decision for the current `confirm-plan`. A hash only identifies the plan; having a hash does not grant authorization. Rejection preserves the current work; use `revise` for plan changes and repeat affected confirmation and validation.
3. Continue calling `next` to compile and validate by actually loading the application. On failure, preserve the current work, correct the plan or artifacts, and resume the original Action.
4. At `confirm-eval`, show the Agent, model, case count, interaction turns, and total timeout, then let the user choose evaluate, skip, or revise. After evaluate, call `next` to execute and save the report. Retry reuses the original cases; revisions prefer them. Failed or incomplete evaluation stops at `review-eval`; show the report and uncovered paths, then let the user choose retry, revise, or explicitly skip. Skipping retains the actual status.
5. Before installation, show the export directory, platform entry, fixed dependencies, Runtime, Rule/Hook configuration, conflicts, and Eval status; preview does not write the installation target. Use an `install-target` export directory separate from platform entries, such as `.comet/creator/exports/<application-name>`. After the user explicitly approves the current preview, submit `confirm-install`; Creator exports and formally installs the application. Follow the reference's recovery steps after preview failure or interrupted installation. Changes to the target, dependencies, files, configuration, or evaluation report require confirmation again.
6. Deliver package and entry locations, actual checks, the Eval report, unexecuted items, and limits. Report actual Skill loading, Rule configuration, Hook execution, SDK Run, and business assertions separately; installed configuration does not establish that a Hook has activated.

## Recovery boundaries

- Continue with the original Run ID, current Action/Wait, and input hash; do not reuse stale requests.
- Reconcile uncertain execution against the original experiment, process, or artifacts. Preserve the current work and block when reconciliation is unavailable; do not retry blindly.
- Inject credentials only through the execution environment, never into plans, source, generated packages, Runs, or reports.
