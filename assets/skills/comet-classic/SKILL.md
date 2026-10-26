---
name: comet-classic
description: 'Comet Classic workflow entry. Use when the user explicitly invokes /comet-classic, asks to start or resume Classic, or resume-probe returns auto_resume for one unambiguously recoverable active Classic change.'
---

# Comet Classic — OpenSpec + Superpowers

Classic has five phases: Open → Design → Build → Verify → Archive. OpenSpec manages specifications and archiving. Superpowers provides design methods and the planning, execution, and review methods selected by the user. The full workflow requires brainstorming and design confirmation; hotfix/tweak follow their preset steps.

## 1. Resolve the Target and Workspace

On a new task or host change, read and perform the [host capability check](../comet/reference/host-check.md) before approving Open. When execution configuration changes, check only capabilities required by the new strategy.

Before starting or resuming, resolve artifact paths with `comet-classic/reference/classic-layout.md` and follow “CLI Bootstrap” in `comet-classic/reference/scripts.md`. Use the public Comet CLI and its OpenSpec adapter. Read only sections needed for the current action; reuse valid instructions already in context.

- When Classic was not explicitly invoked and existing work may need to resume: read Ambient Resume in `comet-classic/reference/context-recovery.md` and follow `comet resume-probe . --stdin --json`. Only `auto_resume` enters automatically; for `ask_user` ask by `reason` using the Ambient Resume table's question and options; `out_of_scope`/`none` does not enter.
- When starting a new request or the target change is unclear: read the minimal example and target-selection rules in `comet-classic/reference/intent-frame.md`. List active changes, fill a CometIntentFrame, and run `comet classic intent route --stdin`. The Agent extracts intent fields from evidence; Runtime computes the route. Follow its result without inventing a separate set of prose scoring rules.
- When the target change is explicit and Runtime has initialized it, bind its workspace below. New SDK changes use `comet-state.yaml`; historical `.comet.yaml` files are read and written in place, and compat initialization still uses the old name. Use Runtime ownership returned by `state next`, not the mere presence of the state file, to choose the recovery path. Do not bind early when several active changes exist and none has been selected. A genuinely new change goes to `/comet-open` or the matching preset Skill, which prepares the workspace before initializing; `workspace resolve` reports not-found for an uninitialized change.

```bash
comet classic workspace resolve <change-name> --json
# Enter the returned projectRoot before selecting the change
comet state select <change-name> --json
```

If both `comet-state.yaml` and `.comet.yaml` exist for the same change, including a dangling symlink, stop, preserve both, and check their origins. Do not silently choose one, overwrite either, or rename them automatically.

Continue directly when the selection response contains current Runtime ownership, phase, revision, and nextAction. Run `comet state next <change-name> --json` only for missing information, external state changes, or an expired response.

Transfer the actual state file, change documents, referenced artifacts, code, and project configuration together. A checkpoint does not include separate child worktrees or uncommitted code. For a copied SDK change whose actual state file contains `run_checkpoint`, named `state select` or `state next` restores the saved phase, Actions, and approvals. Confirm the original device's execution process has stopped before continuing external work. Reconcile an Action with an unknown outcome before retrying it. Only when an older state file has no checkpoint and the normal entry explicitly reports missing Run history, inspect the formal documents, explain that explicit restoration returns to Open and requires fresh approvals and checks, and obtain the user's consent before running `comet state restore <change-name> --confirmed`.

When the response already includes `agent.continuation.mode`, first follow the shared rules in `comet-classic/reference/auto-transition.md`. Use `mode` to execute, wait, ask, reconcile, or finish; the `nextAction.kind` routing below is only for older responses without `mode`.

Use `data.runtimeFormat` to distinguish `sdk` from `compat`, then follow the returned phase, configuration, and `data.nextAction.kind`. Only an SDK `action` loads the returned Skill. For `decision`, `evidence`, or `reconcile`, first resolve the current Run's decision, evidence, or claimed Action; never replay it as a fresh Skill action. Keep the original routing for compat changes. Send a new full change to `/comet-open`, which prepares the workspace, creates OpenSpec artifacts, and initializes an SDK Run. Send confirmed hotfix/tweak choices to their preset Skills. Do not call `/opsx:new` directly. On ownership conflicts or malformed state, follow “Entry Errors and Recovery” in context-recovery.md and stop; do not infer phase from artifacts or create another state record.

A new full change must have its workspace selected before Open creates artifacts. Full-workflow `isolation` may be `current`, `branch`, or `worktree`; prepare a Worktree for explicit parallel-work requests, and otherwise follow `comet-classic/reference/workspace.md`. Hotfix/tweak confirm and bind workspaces during their own initialization. Resume in the bound workspace. If branch ownership has changed, rebind according to the user's confirmed choice; ask only when valid authorization is missing.

## 2. Load the Current Phase

Reuse command results and context for the same tasks. Continue from returned state and `agent.continuation`; query only for missing fields, workspace changes, lost context on recovery, or external changes. Select checks by risk; Verify owns one final integrated review of the completed implementation.

After binding the workspace and phase, and on phase changes, Agent handoffs or context recovery, follow [Task Context and Artifact Language](reference/scripts.md#task-context-and-artifact-language). Use the continuation or claimed Action's `contextRequest` for a snapshot once per entry or recovery. Use the configured artifact language and expand only missing Context Manifest content. Report actual usage outcomes and save a checkpoint at task end.

Memory learning submits only reusable user information; never save task summaries, progress, command output, or test results as Personal Memory. Complete the learning check in the task context reference before task completion and record `submitted`, `no-observation`, or `not-run`.

Project experience and personal preferences are stored separately: before task completion, write project-validated and reusable experience to Project Memory with `comet knowledge remember`; only user preferences and stable collaboration habits go to Personal Memory. See [Task Context and Artifact Language](reference/scripts.md#task-context-and-artifact-language) for the commands and filtering rules.

| Runtime route or phase        | Entry and responsibility                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| new full / open               | `/comet-open`: clarify scope, create required artifacts, and obtain the user's review and confirmation          |
| design                        | `/comet-design`: resolve technical tradeoffs and confirm the formal design                                      |
| build + full                  | `/comet-build`: recover configuration/plan, complete tasks and required reviews                                 |
| hotfix / build + hotfix       | `/comet-hotfix`: repair a localized existing defect                                                             |
| tweak / build + tweak         | `/comet-tweak`: make a lightweight adjustment within one change                                                 |
| verify                        | `/comet-verify`: run acceptance checks, reverify repairs, and perform the only final integrated review          |
| archive / verify_result: pass | `/comet-archive`: confirm archiving, commit only this change's files, and complete the selected delivery method |

The corresponding Skill performs phase work; load it before authoring artifacts, calling OpenSpec, or advancing. Resolve `decision`, `evidence`, and `reconcile` on the current Run without repeating phase work.

For new full / Open, or an Action specifying `comet-open`:

**Immediately execute:** Use the Skill tool to load the comet-open skill. Skipping this step is prohibited.

For an Action specifying `comet-design`:

**Immediately execute:** Use the Skill tool to load the comet-design skill. Skipping this step is prohibited.

Recommend a lightweight workflow only for a new request. Enter directly when its risk fits the preset and the user has explicitly selected it. When the Agent makes the recommendation, explain why, present hotfix/tweak and full with their effects, and wait for confirmation. Never silently downgrade an existing full change. Assess public APIs, data migrations, security, concurrency, and cross-module design by their actual risks; a small file count does not waive necessary steps.

For hotfix/tweak, SDK must read and follow [Preset scope](reference/sdk-methods.md#preset-scope) and reuse valid `rulings.md` authorization; Compat follows the chosen preset's `reference/compat.md`. Review scope when only file count exceeds the threshold, asking only when a new decision is needed. Upgrade after the user's choice, using the Run continuation or matching Compat command. Use `verify_mode` for verification depth; keep workflow and escalation decisions separate.

On session recovery, external changes, or discrepancies between actual work and plan, task, review, or delivery records, read `comet-classic/reference/context-recovery.md`. Use nextAction from the current phase entry to identify unfinished steps. Reuse valid configuration and work; an unchecked task is not proof that implementation is missing. Follow that reference for the recovery procedure.

## 3. Complete the Work Authorized for This Invocation

After phase exit checks pass, follow `comet-classic/reference/auto-transition.md`: read `agent.continuation` from the successful result and load only its next Skill. Query again only when reusable state is unavailable, session recovery lacks context, or external state changes. `auto_transition: false` controls the next Skill invocation, not the phase already advanced by Guard. For `NEXT: manual`, show HINT and end the invocation without adding a confirmation question.

First check existing approval, delegated authority, and the user's requested confirmation method. Wait for an explicit answer when a new decision is needed. Before the first clarification or confirmation, read `comet-classic/reference/decision-point.md` and follow its options, recommendation reasons, per-option effects, and `AskUserQuestion` priority. Reuse it when already in context. Check authorization for the following matters under that protocol. Continue when existing authority still covers them; ask only when a new decision is needed:

- If the target change, PRD split, or workspace isolation still needs a choice, ask related questions together and wait.
- At the end of Open, obtain final confirmation of the name, scope, and artifacts. After Design develops a proposal, obtain confirmation of the formal design. In both cases, check current content against existing authority. Present a reviewable result and wait when a user decision is needed.
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
