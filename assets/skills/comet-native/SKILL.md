---
name: comet-native
description: 'Comet Native workflow. Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry routes to Native.'
---

# Comet Native

Native saves complete requirements, progress, and acceptance results in the project. The Agent works only on the phase specified by Runtime. After each action, read the latest `continuation` and follow it until the task is complete, a user decision is needed, or an external dependency blocks progress.

## Required rules

- Treat `.comet/config.yaml`, the current change, `comet-state.yaml`, and formal artifacts on disk as authoritative; chat memory is supplementary. Among formal workflow files, the Agent edits only the brief, complete target Specs, and `children.yaml`. Runtime owns state, check results, reports, locks, and transactions.
- Advance through the public `comet native` CLI on PATH; do not ask the user to run commands manually. If the command is unavailable, report an incomplete installation and stop. Consult `comet native <command> --help` for arguments.
- The Builder submits the current code and related files as a candidate implementation. Each iteration requires a new read-only Verifier to assess every acceptance item independently. Failed, blocked, unexecuted, and timed-out work cannot count as passed.
- Run confirmation commands only after the user explicitly confirms the complete Shape, accepts the final result, or selects the relevant delivery option. Reuse confirmed scope and user choices saved by Runtime. Authorization for Archive, merge, push, PR creation, and workspace cleanup is not interchangeable.
- This Skill and Runtime provide the Native workflow without an external Skill dependency. The Agent chooses implementation methods that preserve confirmed requirements and constraints.

## Start or resume

1. If the name is known, run `comet native status <change-name> --json`; otherwise run `comet native status --json` to identify the target.
2. When an active change exists, enter the returned `workspace.projectRoot` and run `select`. Let Runtime locate the workspace; ask the user only when multiple workspaces match equally well.
3. If there is no matching active change, select isolation and create it using [workspace selection](reference/workspace.md#create-a-change), then enter `preparation.projectRoot`. If preparation fails, preserve any branches and directories already created and address the reported cause.
4. After entering the workspace and obtaining `phase`, retrieve context once using [memory integration](reference/commands.md#memory-integration). Expand details only when needed, record actual use outcomes, and call `comet task --complete` at the end as specified there.

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

Investigate facts that can be established without the user. Ask only about decisions that change user-visible outcomes and cannot be inferred reliably. For simple requests, list unresolved questions and dependencies; maintain a decision tree only when several decisions affect one another. Before asking under `native.clarification_mode`, save this round's unresolved questions in the brief. Immediately copy confirmed conclusions into Decisions, the brief, and complete target Specs. Keep unanswered parts `[blocking]`.

Complete when requirements sources have been fully covered according to their purpose, all outcome-affecting decisions and assumptions are resolved, no `[blocking]` remains, the user explicitly confirms the outcome, scope, key decisions, all acceptance items, and non-goals, and Runtime has entered Build.

## Build ↔ Verify Loop

After the Builder submits a candidate, Runtime runs required checks and a new read-only Verifier assesses it. On failure, return to Build, repair, and resubmit. Once every item passes, wait for the user to accept the result.

`iteration` counts implementation submissions; `attempt` counts Verifier launches for the same candidate. Runtime updates all counters. When consecutive failures or lack of progress reach configured limits, follow the latest instructions to wait for a user decision or address the blocker.

## Build

Before the first implementation, read the current brief, complete target Specs, and every acceptance item. Edit project code and tests within confirmed scope. During repair, prioritize the Verifier's failed or blocked items and failed checks, then recheck other confirmed behavior before submission. `previous_unresolved_ids` identifies the repair focus; the next formal verification still covers every acceptance item.

Classify requirement changes before taking an action allowed by the current `continuation`:

- Missing implementation of confirmed functionality: use `--revise-implementation` from Verify, retain confirmed scope, and return to Build.
- Changed user-visible behavior or acceptance criteria: use `--revise-requirements` from Verify or Archive-ready, update formal artifacts, and reconfirm Shape.
- Unrelated requirements: use another change.

Apply the same rules when the user explicitly adds to the current scope.

One confirmed Supervisor Shape authorizes all children within that scope. Dispatch and integrate as Runtime directs, then automatically perform final verification of every Supervisor acceptance item. Follow [Supervisor coordination](reference/commands.md#supervisor-coordination) for coordinator, Builder, and Verifier responsibilities. A child is complete only after Runtime accepts its verification and confirms integration.

Complete when the implementation and relevant checks are ready for verification, Runtime accepts the Builder handoff, and the phase is Verify.

## Verify

Immediately launch an independent read-only Verifier under the Verify protocol. It checks that recorded results match the current candidate, workspace, and inputs, adds only missing or invalidated checks, and independently assesses every acceptance item. The Builder passes only the implementation location, acceptance IDs and references, check-record locations, known limitations, and relevant file locations. Read log bodies on demand.

A wait-tool timeout means keep waiting for the same Verifier. Record an execution error only when the platform confirms execution failure, an execution timeout, a lost task, or completion without a usable result. Once Runtime accepts the complete result, follow the latest state. When user acceptance is required, run `--accept-result` only after explicit acceptance. Results with automated checks but no independent verification also require explicit acceptance.

Complete when Runtime accepts each verdict and supplies the next action. Continue repairs on Build, or address the specified waiting or blocking condition. Ending a phase does not mean the task is finished.

## Archive

When `continuation` permits Archive, first read [Archive completion](reference/workspace.md#archive-completion). Use the accepted verification result and execute the complete returned `archive --dry-run` command. Address only blockers in that response. Run its single returned `archive --confirmed` command only after `ready: true`.

Commit only this change's implementation and formal artifacts; preserve unrelated edits. Inspect `workspaceFinishResult`, preserving the workspace and following `recoveryArgs` if blocked.

Complete when state is `done`, authorized workspace finishing is `completed` or `kept`, and task completion has been recorded through memory integration. Continue handling any other result.

## Continuation

- `continue`: execute the complete `commandArgs` in the returned working directory and fill inputs from `inputOptions` templates.
- `await-user`: relay `userCommunication.message` and `suggestedReply`, then wait for the listed decisions. Execute the matching `commandAlternatives`, retaining `--expected-state-version` and `--expected-action`. Read the latest state if stale; do not construct an unguarded command.
- `blocked`: address listed blockers or recovery actions; pause only dependent work.
- `done`: finish after checking the Archive completion criteria.

After a successful response containing `agent`, continue using its phase, state version, `workspace.cwd`, and `continuation`. Query `status` again only on session recovery, a missing response, or signs of external changes.

Add `--details` only when the current action needs acceptance text, handoff summaries, or history. Follow `nextPageArgs` through every page covering `scopeIds`. Run `show` only when artifact bodies are needed. For CLI text, read `summary`, the single `NEXT:`, and any relay message first. Use `--json` for programmatic parsing and `--verbose` only to diagnose local execution.
