---
name: comet-native
description: "Comet Native workflow. Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry router selects Native."
---

# Comet Native

Native stores the requirements, complete target specifications, current progress, and verification conclusions in the project. After completing each phase, return to the Runtime for the next action and handle only the phase it specifies.

## Inviolable boundaries

- The on-disk `.comet/config.yaml`, current change, `comet-state.yaml`, and formal Markdown are the working source; chat memory is only supplementary.
- The Runtime manages workflow state, local tasks, logs, locks, and transactions. Advance every phase through the public `comet native` commands on PATH.
- If a command is unavailable, report an incomplete Comet installation and stop. Treat `comet native <command> --help` as authoritative for arguments and output.
- The Builder submits a candidate. A fresh read-only Verifier subagent or separate Agent task makes the verification judgment.
- This Skill and the Runtime complete the Native workflow; Native does not depend on any external Skill.

## Start or resume

1. When the change name is known, run `comet native status <change-name> --details --json` directly. Only run `comet native status --json` when the name is unknown, then query the selected change in detail.
2. Run pagination commands from `nextPageArgs` only when the current phase needs the complete acceptance list. Run `show` or read the corresponding brief/Spec only when editing or checking formal content.
3. When an active change already exists, enter the returned `workspace.projectRoot` and run `select`. Ask the user only when multiple reasonable candidates remain.
4. Create a change only when no matching active change exists, using the artifact directory from configuration.

### Create a change

Choose a lowercase kebab-case name, then use the [workspace selection reference](reference/workspace.md) to decide whether to use the current directory, create a branch, or create a worktree.

The CLI binds the branch or worktree, maintains repository-local exclusions, validates configuration, and creates state that can be resumed across devices. Then enter the returned `preparation.projectRoot`.

If preparation does not finish, keep the resources already created, show the failure reason from `preparation`, and continue with the recovery direction from the Runtime or user.

## Read on demand

After confirming the phase, read only the needed reference:

- Shape: always read and execute the [clarification reference](reference/clarification.md).
- Read the [artifact reference](reference/artifacts.md) when editing the brief or complete target specifications, or when reviewing the verification report.
- During normal progression, execute the command returned in Runtime `continuation`. Read the [command reference](reference/commands.md) only when a returned field is unclear, command input is rejected, the Verifier cannot be started, Verifier execution fails, or the Verifier needs user-provided information.
- Read the [recovery reference](reference/recovery.md) only when the task cannot continue because of an interrupted process, missing local Runtime state after moving devices, repeated lack of progress, a concurrency conflict, failed legacy migration, or damaged state.

## Shape

First investigate facts that can be determined from the repository, tools, and runtime environment. Independent fact-finding may be delegated to subagents. Follow `native.clarification_mode` and the clarification reference to maintain a decision tree. Ask the user only for choices that change the visible result and cannot be inferred reliably.

Immediately synchronize confirmed user-visible decisions and important constraints into Decisions, the brief, and complete target specifications. Keep ordinary implementation choices in the implementation and tests unless they affect visible behavior. Acceptance items must be specific, observable, and non-duplicative.

Keep unresolved questions `[blocking]`; do not modify implementation while a blocker remains. Completion criterion: every choice that affects the visible result and every unstated assumption has been handled, no `[blocking]` item remains, the user has explicitly confirmed the outcome, scope, key decisions, acceptance items, and non-goals, and the Runtime has entered Build. Advance with the continuation containing `--confirmed` only after explicit user confirmation.

## Build ↔ Verify Loop

Build and Verify form a bounded acceptance Loop: the Builder submits a candidate, the Runtime runs the necessary checks, and a fresh read-only Verifier evaluates it. If verification does not pass, return to Build, make the changes, and submit the next candidate. When every item passes, enter Archive.

`iteration` is the implementation-candidate round. `attempt` is the number of times a Verifier has been started for the same candidate. Repeated failures, no meaningful progress, or repeated Verifier execution errors cause the Runtime to enter an await-user or blocked state at its configured budget. The Runtime updates all counters; the Agent follows only the latest `continuation`.

## Build

For the first implementation, read the current brief, complete target specifications, and all acceptance items. When Verify returns to Build, first address the failed items, blocked verification issues, and failed checks reported by the Verifier. Before submitting again, recheck the complete specifications and all acceptance items so that fixing the reported issue does not hide other omissions.

When requirements change, classify them first:

- The current requirement was implemented incompletely: use `--return-to-build` from Verify or Archive to return to Build.
- User-visible behavior or acceptance criteria changed: return to Shape, update the formal artifacts, and reconfirm.
- The request is unrelated to the current requirement: keep it for another change.

Apply the same rule when the user explicitly adds to the current scope.

When the candidate is ready, use the input template in Runtime `continuation` to submit a concise Builder handoff: what changed in this round, which acceptance items were addressed, which development-time checks were or were not actually run, and any known limitations.

The handoff is stored in `comet-state.yaml`; it does not create a separate file and does not mean verification passed. The Runtime gives it to the Verifier, and the Builder submits it once.

Completion criterion: the implementation and relevant checks are ready for verification, the complete acceptance list has been rechecked, and the Runtime accepts the handoff and enters Verify.

## Verify

When the Runtime requests `dispatch-verifier`, first fill `inputOptions.template` with the tests and check commands needed for the current candidate, then let the Runtime execute them. The Runtime reuses completed checks. Follow the latest `continuation` for any retry or additional check.

After the Runtime returns `verifierDispatch`, immediately start a fresh read-only Verifier subagent. If the platform does not support subagents, start a new Agent task separate from the Builder session.

The Verifier first reads the acceptance items, brief, complete target Specs, actual implementation, and Runtime check results. It reads the Builder handoff last, as an investigation lead, so the verification judgment remains independent.

The Verifier remains read-only. If existing checks are insufficient, list the additional checks in the `inputOptions.template` returned by the Runtime. The Runtime executes them and returns the results to the Verifier.

The Verifier must finally mark every acceptance item exactly once as `passed`, `failed`, or `blocked`. For a failed or blocked item, provide a reason that the next Build round can act on directly. If the Verifier cannot be started, execution fails, or external information is missing, follow the command reference and the latest `continuation`.

Completion criterion: the Runtime has accepted the complete Verifier result and has explicitly entered one of Build, Archive, `await-user`, `blocked`, or `done`.

## Archive

Continue only when `continuation` permits Archive. Archive uses the accepted verification result directly. When a `branch` or `worktree` needs a finish decision, show the actual change branch, target branch, and directory together, then let the user choose merge, push, create a PR, keep the workspace, or defer Archive.

Commit only the implementation and formal artifacts that belong to the current change, preserving other user changes. Execute the returned `commandArgs`, then inspect `workspaceFinishResult`. If it is `blocked`, preserve the workspace and run the recovery command in `recoveryArgs`.

Completion criterion: state is `done`, and the user-authorized workspace finish result is `completed` or `kept`. Follow `continuation` for any other result.

## Follow-up actions

After every command, handle only the latest `continuation`:

- `continue`: execute `commandArgs` and fill `inputOptions` from its template.
- `await-user`: wait for the listed user decision.
- `blocked`: resolve the listed blocker or recovery action first.
- `done`: finish.

After a state-changing command, query the change details again and confirm the current phase, acceptance Loop, state version, and working directory. Run `show` only when formal content is needed.
