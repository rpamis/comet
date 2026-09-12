---
name: comet-classic
description: 'Comet Classic workflow entry. Use when the user explicitly invokes /comet-classic, asks to start or resume Classic, or resume-probe returns auto_resume for one unambiguously recoverable active Classic change.'
---

# Comet Classic — OpenSpec + Superpowers

Classic has five phases: Open → Design → Build → Verify → Archive. OpenSpec manages specifications and archiving. Superpowers provides design methods and the planning, execution, and review methods selected by the user. The full workflow requires brainstorming and design confirmation; hotfix/tweak follow their preset steps.

## 1. Resolve the Target and Workspace

Before starting or recovering, use `comet-classic/reference/classic-layout.md` to resolve logical artifact paths, and read “CLI Bootstrap” in `comet-classic/reference/scripts.md`. Call the public Comet CLI and use its OpenSpec adapter for OpenSpec commands. Read only the reference sections needed for the current action. Reuse instructions already in context that remain valid; a reference to one section does not require reading the rest of the file.

- When Classic was not explicitly invoked and existing work may need to resume: read Ambient Resume in `comet-classic/reference/context-recovery.md` and follow `comet resume-probe . --stdin --json`. Only `auto_resume` enters automatically; `ask_user` waits for a choice; `out_of_scope`/`none` does not enter.
- When starting a new request or the target change is unclear: read the minimal example and target-selection rules in `comet-classic/reference/intent-frame.md`. List active changes, fill a CometIntentFrame, and run `comet classic intent route --stdin`. The Agent extracts intent fields from evidence; Runtime computes the route. Follow its result without inventing a separate set of prose scoring rules.
- When the target change is explicit: bind its workspace below. Do not bind early when several active changes exist and none has been selected.

```bash
comet classic workspace resolve <change-name> --json
# Enter the returned projectRoot before selecting the change
comet state select <change-name>
comet state next <name> --json
```

Continue from the returned phase, configuration, and next route. Send a new full change to `/comet-open`, which prepares the workspace and creates OpenSpec artifacts and `.comet.yaml`. Send confirmed hotfix/tweak choices to `/comet-hotfix` or `/comet-tweak` for their own initialization steps. Do not call `/opsx:new` directly. If an existing change has no state file, follow “Entry Errors and Recovery” in context-recovery.md to establish its workflow and recover. Report malformed state rather than guessing a phase from existing artifacts.

A new full change must have its workspace selected before Open creates artifacts. Full-workflow `isolation` may be `current`, `branch`, or `worktree`; prepare a Worktree for explicit parallel-work requests, and otherwise follow `comet-classic/reference/workspace.md`. Hotfix/tweak confirm and bind workspaces during their own initialization. Resume in the bound workspace. If branch ownership has changed, rebind according to the user's confirmed choice; ask only when valid authorization is missing.

## 2. Load the Current Phase

While working on the same set of tasks, reuse state returned by the current commands and context already read. Refresh only as needed after a state write, workspace switch, session recovery, or external change; reuse valid state included in the successful result. Select checks according to the risk of the current changes; Verify still owns one final integrated review of the completed implementation.

After binding the workspace and obtaining phase, read and follow [Task Context and Artifact Language](reference/scripts.md#task-context-and-artifact-language), and run `comet task`. Use the configured artifact language. Start from Context Manifest summaries and expand only information still missing for the current step. Report outcomes truthfully after actually using an item, and save a checkpoint at task end.

| Runtime route or phase        | Entry and responsibility                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| new full / open               | `/comet-open`: clarify scope, create required artifacts, and obtain the user's review and confirmation          |
| design                        | `/comet-design`: resolve technical tradeoffs and confirm the formal design                                      |
| build + full                  | `/comet-build`: recover configuration/plan, complete tasks and required reviews                                 |
| hotfix / build + hotfix       | `/comet-hotfix`: repair a localized existing defect                                                             |
| tweak / build + tweak         | `/comet-tweak`: make a lightweight adjustment within one change                                                 |
| verify                        | `/comet-verify`: run acceptance checks, reverify repairs, and perform the only final integrated review          |
| archive / verify_result: pass | `/comet-archive`: confirm archiving, commit only this change's files, and complete the selected delivery method |

Recommend a lightweight workflow only for a new request. Enter directly when its risk fits the preset and the user has explicitly selected it. When the Agent makes the recommendation, explain why, present hotfix/tweak and full with their effects, and wait for confirmation. Never silently downgrade an existing full change. Assess public APIs, data migrations, security, concurrency, and cross-module design by their actual risks; a small file count does not waive necessary steps.

When running hotfix/tweak, read the chosen preset's escalation rules. If a listed condition occurs or the changed-file count exceeds the advisory threshold, present the choice to continue the preset or upgrade to full, and wait for an answer. Run `comet state transition <name> preset-escalate` only after the user chooses to upgrade. `verify_mode` determines verification depth; it does not select the workflow or replace escalation confirmation.

On session recovery, external changes, or discrepancies between actual work and plan, task, review, or delivery records, read `comet-classic/reference/context-recovery.md`. Use nextAction from the current phase entry to identify unfinished steps. Reuse valid configuration and work; an unchecked task is not proof that implementation is missing. Follow that reference for the recovery procedure.

## 3. Complete the Work Authorized for This Invocation

After phase exit checks pass, follow `comet-classic/reference/auto-transition.md`: read `agent.continuation` from the successful result and load only its next Skill. Query again only when reusable state is unavailable, session recovery lacks context, or external state changes. `auto_transition: false` controls the next Skill invocation, not the phase already advanced by Guard. For `NEXT: manual`, show HINT and end the invocation without adding a confirmation question.

Decision points block dependent work until the user answers explicitly. Before the first clarification or confirmation, read `comet-classic/reference/decision-point.md` and follow its options, recommendation reasons, per-option effects, and `AskUserQuestion` priority. Reuse it when already in context. Automatic handoff or a single recommended solution cannot skip these confirmations:

- If the target change, PRD split, or workspace isolation still needs a choice, ask related questions together and wait.
- At the end of Open, obtain final confirmation of the name, scope, and artifacts. After Design develops a proposal, obtain confirmation of the formal design. In both cases, present a reviewable result before waiting for approval or requested adjustments.
- Before Build writes a plan, ask about execution/TDD/review configuration only when it is missing or the user requests a change. After a user-requested `plan-ready` pause, wait for an explicit instruction to continue.
- In Verify, ask when accepting deviations, resolving implementation/Spec disagreement, or choosing how to proceed after the automatic-repair limit. In Archive, confirm archiving and the delivery method.
- Ask when upgrading a preset to the full workflow, or when Build needs to expand scope, redesign, or split a change.

Before an explicit choice, do not write state or execute branch operations that depend on it, and do not bypass phase Guards. Reuse valid authorization and configuration. Automatically handle in-scope failures with a known repair, state that can be reconciled from evidence, and other steps with only one valid action; do not add “continue?” questions.

Archive and delivery method are combined into one final confirmation. `/comet-archive` checks authorization, actual Git state, and completion of the selected delivery actions. Passing verification does not authorize archiving; an archive directory does not prove that a commit, push, or PR is complete.

## Rules for Every Phase

- Use Runtime phase, Guard results, and the current workspace binding to determine workflow state. Files and conversation help reconcile it; they do not authorize editing phase by hand to bypass confirmation or verification.
- proposal records goals and scope; spec defines behavior and acceptance; design_doc points to the single formal technical design; plan describes implementation; tasks.md records task completion.
- Follow the confirmed execution, TDD, and review configuration. Autonomous still requires full-workflow design, planning, real verification, and independent review. Build confirms missing or user-requested configuration changes; never replace configuration based on a model name.
- Attribute uncommitted changes using `comet-classic/reference/dirty-worktree.md`. Handle only the current change and protect unrelated work. For rejected state updates, path escapes, unavailable dependencies, or unclear ownership, read “Entry Errors and Recovery” in `comet-classic/reference/context-recovery.md`, report the original error, and follow the matching recovery rule.
- For failures in the current phase, read `comet-classic/reference/debug-gate.md` and investigate before fixing. Claim a test or build result only after actually running it. Reuse an earlier pass only when Runtime confirms it is still valid.

Read `comet-classic/reference/comet-yaml-fields.md` for state-field meanings and `comet-classic/reference/file-structure.md` for artifact directories. Read other references only when their triggers above apply.
