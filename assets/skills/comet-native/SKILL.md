---
name: comet-native
description: 'Comet Native workflow. Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry routes to Native.'
---

# Comet Native

Identify runtime format before acting; Runtime stores requirements and acceptance in the project.

## Required rules

- Continue confirmed implementation, document repairs, evidence reuse, and recovery. Pause for new decisions, authorization, or external information. Use current continuation commands, templates, and packages; correct inputs within the same task.
- Treat `.comet/config.yaml`, the current change's `comet-state.yaml`, Runtime progress, and formal artifacts on disk as authoritative; chat memory is supplementary. Among formal workflow files, the Agent edits only the brief, complete target Specs, association `delta.yaml`, and `children.yaml`. Runtime owns state, check results, reports, locks, and transactions.
- Advance through the public `comet native` CLI on PATH; do not ask the user to run commands manually. If the command is unavailable, report an incomplete installation and stop. Consult `comet native <command> --help` for arguments.
- Create changes with the CLI; use returned paths and follow denial commands or targets before retrying. Custom and non-Comet writes stay neutral.
- The Builder submits code as the candidate implementation. Each iteration requires a new read-only Verifier to assess every acceptance item independently. Assessing every item does not mean rerunning every command: reuse Runtime check records that still match the current candidate and add only missing or invalidated checks. Failed, blocked, unexecuted, and timed-out work cannot count as passed.
- Run confirmation commands only after the user explicitly confirms the complete Shape, accepts the final result, or selects the relevant delivery option. Reuse confirmed scope and user choices saved by Runtime. Authorization for Archive, merge, push, PR creation, and workspace cleanup is not interchangeable.
- This Skill and Runtime provide the Native workflow without an external Skill dependency. The Agent chooses implementation methods that preserve confirmed requirements and constraints.

## Start or resume

1. If known, run `comet native select <change-name> --json`; otherwise run `comet native status --json`. When an active change exists, enter its `workspace.projectRoot`. Runtime locates the workspace; ask the user only if several workspaces match equally. If local Run history is missing, read [fault recovery](reference/recovery.md#fault-recovery): resume the saved phase when a checkpoint exists; otherwise diagnose and wait for a recovery decision.
2. If there is no matching active change, select isolation and create it using [workspace selection](reference/workspace.md#create-a-change). Run `native new`, then enter `preparation.projectRoot`. If preparation fails, preserve any branches and directories already created and address the reported cause.
3. After entering the workspace and obtaining `phase`, retrieve context once using [memory integration](reference/commands.md#memory-integration). Expand details only when needed, record actual use outcomes, handle Project Memory and Personal Memory separately at task completion, and call `comet task --complete` as specified there.

Never save task summaries, progress, command output, or test results as Personal Memory; complete the learning check.

Project experience and personal preferences are stored separately: use `comet knowledge remember` for reusable verified project facts and Personal Memory for stable user preferences. See [memory integration](reference/commands.md#memory-integration) for completion conditions.

## SDK Run path

When the current response has `data.runtimeFormat: sdk`, or `data.schema` is `comet.native.sdk-status.v1`, `comet.native.dispatch-result.v1`, or `comet.native.run-view.v1`, follow [SDK Run commands and recovery](reference/commands.md#sdk-run) without querying status again to identify the format. The Run is authoritative: Builders and Verifiers claim and submit Actions through that reference; `native next` executes Runtime Actions and user decisions.

Both runtimes use the latest `continuation`; `--runner-input` and legacy Archive inputs apply only to the legacy Runtime. SDK still requires approval, independent verification, and workspace authorization. Do not migrate legacy changes automatically.

## Read only what the action needs

Read the section for the current action. Follow links within it only when their stated conditions apply; do not load the entire command reference or all references at once.

- Shape: read and follow [clarification](reference/clarification.md#clarification), using Sequential or Batch steps according to project configuration. For large requests, follow its Supervisor decomposition and confirmation link before final confirmation.
- Before editing the brief, Specs, or `children.yaml`, or checking an acceptance report, read [formal artifacts](reference/artifacts.md#formal-artifacts). A file, attachment, link, or local path supplied as a requirements source requires [source-document full coverage](reference/artifacts.md#source-document-full-coverage). Material used only for debugging, evidence gathering, review, or implementation reference does not trigger this automatically.
- Before first filling a Runtime template or returning a result through `returnAction`, read [filling command inputs](reference/commands.md#filling-command-inputs).
- Before submitting a Builder candidate, read [Builder handoff](reference/commands.md#builder-handoff). Before launching, adding checks for, or waiting on a Verifier, read [Verify protocol](reference/commands.md#verify-protocol).
- When state contains `childSummary`, read [Supervisor coordination](reference/commands.md#supervisor-coordination) before dispatching, receiving results, or integrating. Handle only children listed in `readyChildren` and Supervisor coordination actions.
- If fields are unclear, input is rejected, a Verifier is unavailable, execution fails, or external information is missing, read [command inputs and exceptions](reference/commands.md#command-inputs-and-exceptions). For normal actions, use Runtime's returned commands and templates directly.
- When waiting for external input, follow [external input and monitoring](reference/recovery.md#external-input-and-monitoring); continue independent work. For interruption, a device change, repeated lack of progress, concurrency conflicts, failed migration, or damaged state, read [fault recovery](reference/recovery.md#fault-recovery).

## Shape

Investigate facts that can be established without the user. Ask only about decisions that change user-visible outcomes and cannot be inferred reliably. For simple requests, list unresolved questions and dependencies; maintain a decision tree only when several decisions affect one another. Before asking under `native.clarification_mode`, save this round's unresolved questions in the brief. Immediately copy confirmed conclusions into the relevant brief sections and complete target Specs. Keep unanswered parts `[blocking]`.

Complete when requirements sources are fully processed within the coverage boundary and classified by purpose, all outcome-affecting decisions and assumptions are resolved, no `[blocking]` remains, the user explicitly confirms the outcome, scope, key decisions, all acceptance items, and non-goals, and Runtime has entered Build.

New or reconfirmed briefs need outcome, scope, non-goals, and acceptance examples. Add constraints, decisions, open questions, or special verification requirements when applicable. Runtime also checks formal paths and a complete target Spec or concrete no-product-behavior-change reason. Repair reported artifacts and rerun continuation. Existing later-phase changes retain progress until Shape.

## Build ↔ Verify Loop

After the Builder submits a candidate, Runtime runs required checks and a new read-only Verifier assesses it. On failure, return to Build, repair, and resubmit. Once every item passes, wait for the user to accept the result.

`iteration` counts implementation submissions; `attempt` counts Verifier launches for the same candidate. Runtime updates all counters. When consecutive failures or lack of progress reach configured limits, follow the latest instructions to wait for a user decision or address the blocker.

## Build

Before the first implementation, read the current brief, complete target Specs, and every acceptance item. Edit project code and tests within confirmed scope. During repair, prioritize the Verifier's failed or blocked items and failed checks, then recheck other confirmed behavior before submission. `previous_unresolved_ids` identifies the repair focus; the next formal verification still covers every acceptance item.

Build, Verify, and Archive recheck formal bindings. New Shapes bind Markdown content: blank lines and soft wraps preserve confirmation; content, structure, code, link, or acceptance changes require reconfirmation. After an edit, Hooks check actual content before the next implementation write; Runtime also checks before advancement. Existing Shapes retain their binding. Invalid documents or reports return repair actions and preserve work. Ordinary documents preserve candidates by default; use `native.document_writes: revert` for strict behavior. See [formal artifacts](reference/artifacts.md#formal-artifacts) for paths.

User Hook output can use `hook.allow_paths` in `.comet/config.yaml`; see [User Hook writes](reference/commands.md#user-hook-writes).

Classify requirement changes before taking an action allowed by the current `continuation`:

- Missing implementation of confirmed functionality: use `--revise-implementation` from Verify, retain confirmed scope, and return to Build.
- Changed user-visible behavior or acceptance criteria: use `--revise-requirements` from Verify or Archive-ready, update formal artifacts, and reconfirm Shape.
- Unrelated requirements: use another change.

Apply the same rules when the user explicitly adds to the current scope.

One confirmed Supervisor Shape authorizes all children within that scope. Dispatch and integrate as Runtime directs, then automatically perform final verification of every Supervisor acceptance item. Follow [Supervisor coordination](reference/commands.md#supervisor-coordination) for coordinator, Builder, and Verifier responsibilities. A child is complete only after Runtime accepts its verification and confirms integration.

Complete when the implementation and relevant checks are ready for verification, Runtime accepts the Builder handoff, and the phase is Verify.

## Verify

Launch a new read-only Verifier immediately under the Verify protocol with the unchanged task package. Report it as running only after the platform accepts startup and the Verifier reports `verifier-started`; handle launch failures immediately. Use inline acceptance text or page through every scopeId. The Verifier assesses all acceptance items independently, reuses Runtime checks matching implementation, workspace, and inputs, and adds missing or invalidated evidence. Read files and logs on demand.

After a wait-tool timeout, keep waiting for the same Verifier. If its receipt is missing and it is unresponsive, check launch success. Report errors only for confirmed failure, execution timeout, task loss, or completion without a usable result. Follow current state after Runtime accepts results. Run `--accept-result` only after explicit user acceptance, including automated-check-only results. For isolated workspaces, accept results and choose delivery in one reply with `--finish`; ask separately if no finish was chosen.

Complete when Runtime accepts each verdict and supplies the next action. Continue repairs on Build, or address the specified waiting or blocking condition. Ending a phase does not mean the task is finished.

## Archive

When `continuation` permits Archive, read [Archive completion](reference/workspace.md#archive-completion), reuse the accepted result, and follow continuation. After an explicit finish choice, execute its complete `--confirmed --finish` command; Runtime preflights and rechecks the transaction. If dry-run is returned, preview and run its unique confirmed command after `ready: true`. Address the returned blockers.

Commit only this change's implementation and formal artifacts; preserve unrelated edits. Inspect `workspaceFinishResult`, preserving the workspace and following `recoveryArgs` if blocked. Fix commit messages and local blockers under existing authorization and continue; ask only for new authorization or external information.

Complete when state is `done`, authorized workspace finishing is `completed` or `kept`, and task completion has been recorded through memory integration. Continue handling any other result.

## Continuation

When the response includes `continuation.mode`, use it to decide the current action: `execute` uses the complete returned arguments, input templates, and task package; `wait` waits for the original task; `ask` presents the current proposal and awaits the user decision; `reconcile` checks the original execution or addresses blockers using the returned evidence; `done` ends after checking the criteria for this completion or cancellation. Fill `commandArgs` placeholders using `requiredInputs` and the input templates; a template is neither completed input nor user approval. `inputRef` points to complete input in the same response; read it without querying state again. After each write, use only the new response’s identity, version, and working directory. When details are essential, use the retrieval command in that response rather than querying to discover the next step.

For older responses without `mode`, use the original `disposition`:

- `continue`: execute the complete `commandArgs` in the returned working directory and fill inputs from `inputOptions` templates.
- `await-user`: relay `userCommunication.message` and `suggestedReply`, then wait for the listed decisions. Execute the matching `commandAlternatives`, retaining `--expected-state-version` and `--expected-action`. Read the latest state if stale; do not construct an unguarded command.
- `blocked`: address listed blockers or recovery actions; pause only dependent work.
- `done`: finish after checking the Archive completion criteria.

After a successful response containing `agent`, reuse the shared workflow guard's lightweight ownership result and continue with the response's phase, state version, `workspace.cwd`, and `continuation`. Read details only when fields are missing, the command is rejected for version or ownership, or the action needs additional artifact text. Query `status` again only for a new session or compression recovery without response state, a repository/branch/change switch, or clear external changes. Do not redispatch an existing Verifier or child task because a wait tool timed out.

Add `--details` only when the current action needs acceptance text, handoff summaries, or history. Follow `nextPageArgs` through every page covering `scopeIds`. Run `show` only when artifact bodies are needed. For CLI text, read `summary`, the single `NEXT:`, and any relay message first. Use `--json` for programmatic parsing and `--verbose` only to diagnose local execution.
