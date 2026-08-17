---
name: comet-native
description: "Comet Native workflow. Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry router selects Native."
---

# Comet Native

Native stores the requirements, complete target specifications, current progress, and verification conclusions in the project. After completing each phase, return to the Runtime for the next action and handle only the phase it specifies.
## Inviolable boundaries
- The on-disk `.comet/config.yaml`, current change, `comet-state.yaml`, and formal Markdown are the working source; chat memory is only supplementary.
- The Runtime manages workflow state, local tasks, logs, locks, and transactions. Advance every phase through the public `comet native` commands on PATH; users do not run these commands manually.
- If a command is unavailable, report an incomplete Comet installation and stop. Treat `comet native <command> --help` as authoritative for arguments and output.
- The Builder submits a candidate. A fresh read-only Verifier subagent or separate Agent task makes the verification judgment.
- This Skill and the Runtime complete the Native workflow; Native does not depend on any external Skill.
## Start or resume
1. When the change name is known, run `comet native status <change-name> --details --json` directly. Only run `comet native status --json` when the name is unknown, then query the selected change in detail.
2. Run pagination commands from `nextPageArgs` only when the current phase needs the complete acceptance list. Run `show` or read the corresponding brief/Spec only when editing or checking formal content.
3. When an active change already exists, enter the returned `workspace.projectRoot` and run `select`. Runtime scans registered Worktrees and prefers a workspace whose bound branch matches; ask the user only when multiple equally aligned candidates remain.
4. Create a change only when no matching active change exists, using the artifact directory from configuration. `comet init` initializes `native.language` from the selected Skill language; after that, artifacts follow the project setting, and `--language` is only for an explicit user override.
### Memory integration
After entering the change workspace, the Agent automatically runs:

```text
comet task <project-root> --task "<original user request>" --phase build --json
```

Only relevant personal memory snippets are added to the current task context. Workflow commands may carry `--comet-task`, `--comet-path`, and `--comet-phase`; the CLI strips these markers, selects context, and prints the relevant snippets. If context is unavailable or empty, continue normally. After a successful change, verification, or review, the Agent records a stable summary with `comet memory observe` using the workflow, change ID, and candidate key so preferences can accumulate across sessions. When a compiler, test, or linter fails, read its diagnostics, fix the code, and rerun it according to the workflow. At task end, run `comet task <project-root> --task "<original user request>" --complete --workflow <workflow> --change <change-id> --json` to complete the personal-memory checkpoint.

Without a Hook platform, these commands are the Skill fallback for context and learning; the lower-level `comet memory context` command remains available. With a Hook, inject only task-relevant personal memory snippets.
### Create a change
Choose a lowercase kebab-case name, then use the [workspace selection reference](reference/workspace.md) to decide whether to use the current directory, create a branch, or create a worktree. Explicit parallel, simultaneous, or multi-session intent automatically selects `worktree` without asking for a three-way choice.

Before creating the change, the CLI binds the branch or worktree, reuses a registered change branch, recreates a Worktree when its branch still exists but the registered Worktree was removed, maintains repository-local exclusions, validates configuration, and creates state that can be resumed across devices. Then enter the returned `preparation.projectRoot`; do not continue subsequent commands in the original directory.
If preparation does not finish, keep the resources already created, show the failure reason from `preparation`, and continue with the recovery direction from the Runtime or user.
## Read on demand
After confirming the phase, read only the needed reference:

- Shape: always read and execute the [clarification reference](reference/clarification.md).
- Read the [artifact reference](reference/artifacts.md) when editing the brief or complete target specifications, or when reviewing the verification report.
- During normal progression, execute the command returned in Runtime `continuation`. Read the [command reference](reference/commands.md) only when a returned field is unclear, command input is rejected, the Verifier cannot be started, Verifier execution fails, or the Verifier needs user-provided information.
- Read the [recovery reference](reference/recovery.md) only when the task cannot continue because of an interrupted process, missing local Runtime state after moving devices, repeated lack of progress, a concurrency conflict, failed legacy migration, or damaged state.
## Shape
First investigate facts that can be determined from the repository, tools, and runtime environment. Independent fact-finding may be delegated to subagents. Follow `native.clarification_mode` and the clarification reference to maintain a decision tree. Ask the user only for choices that change the visible result and cannot be inferred reliably.

Immediately synchronize confirmed user-visible decisions and important constraints into Decisions, the brief, and complete target specifications. Keep ordinary implementation choices in the implementation and tests unless they affect visible behavior. Acceptance items must be specific, observable, and non-duplicative. A Supervisor Change using `comet.native.children.v2` keeps `children.yaml` user-readable with only each Child's `name`, user-facing `summary`, and real `depends_on`; it does not expose `covers`, `owns`, or positional acceptance mappings. Runtime keeps v1 read compatibility for at least one beta cycle.

For a large requirement, run one decomposition preflight before the final Shape confirmation: recommend Supervisor Change mode only when workers can independently implement and verify at least two outcomes, acceptance items map completely, and real dependency or parallel value exists; keep a single Native change when the goal is tightly coupled, repeatedly edits one core area, coordination costs exceed independent verification, or the user asks for one change; text length and task count alone must not trigger decomposition.
When decomposition is recommended, put the `children.yaml` draft, execution waves, and coverage summary into one Shape confirmation; the user can confirm, adjust, or keep one. Do not create child changes before confirmation; do not create worktrees or dispatch Agents before confirmation.
After confirmation, Runtime creates a dedicated parent integration workspace (a separate branch/worktree), then returns task packages binding each Child, role, workspace, base commit, and `runId`. The Skill automatically dispatches current ready Children from `readyChildren`; when the host supports it, at most two independent tasks run in parallel, otherwise the same semantics use a serial fallback. Child scope inherits the parent confirmation; new user-visible decisions return to parent Shape.
On `/comet-native` resume, continue from Runtime state and do not duplicate existing children or worktrees.
Keep unresolved questions `[blocking]`; do not modify implementation while a blocker remains. Completion criterion: every choice that affects the visible result and every unstated assumption has been handled, no `[blocking]` item remains, the user has explicitly confirmed the outcome, scope, key decisions, acceptance items, and non-goals, and the Runtime has entered Build. Advance with the continuation containing `--confirmed` only after explicit user confirmation.

## Build ↔ Verify Loop
Build and Verify form a bounded acceptance Loop: the Builder submits a candidate, the Runtime runs the necessary checks, and a fresh read-only Verifier evaluates it. If verification does not pass, return to Build, make the changes, and submit the next candidate. When every item passes, enter Archive.

`iteration` is the implementation-candidate round. `attempt` is the number of times a Verifier has been started for the same candidate. Repeated failures, no meaningful progress, or repeated Verifier execution errors cause the Runtime to enter an await-user or blocked state at its configured budget. The Runtime updates all counters; the Agent follows only the latest `continuation`.

## Build

For the first implementation, read the current brief, complete target specifications, and all acceptance items. When Verify returns to Build, first address the failed items, blocked verification issues, and failed checks reported by the Verifier. Before submitting again, recheck the complete specifications and all acceptance items so that fixing the reported issue does not hide other omissions.

One parent Shape confirmation authorizes strictly derived Children, so do not ask the user to repeat the same scope. The Skill executes only actions returned by Runtime continuation and rereads `readyChildren` after each task completes; a Child must move through `active -> verified -> integrated`, and all Children become `archived` only after parent final Verify and delivery. The parent still verifies every acceptance item in the integration workspace at the end.

When status contains `children`, the current change is a Supervisor Change: do not run a parent Builder; advance only the Supervisor task returned by Runtime. Each Child is implemented in an independent worktree based on the current integration HEAD. Builder and Verifier results must carry the current `runId`; duplicate or late results are rejected. After a Verifier passes, the parent serially merges that exact commit into the integration branch and runs the Child's minimum integration checks (the former `finish=merge` boundary is now performed by Runtime); `verified`, an Agent completion message, or uncommitted files never means `integrated`. Only after all Children are integrated may the parent enter final Verify, and the target branch remains unchanged until final delivery; if the target drifts externally, Runtime first brings the latest target into the integration workspace and requires the parent checks to run again. Preserve conflict/blocker evidence and follow Runtime's `repair-child` action without reopening an integrated Child.

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

Continue only when `continuation` permits Archive. Archive uses the accepted verification result directly. When a `branch` or `worktree` needs a finish decision, show the actual change branch, target branch, and directory together, then let the user choose merge, push, create a PR, keep the workspace, or defer Archive. After Archive, if a clean worktree belongs to an archived change, offer cleanup; only run `git worktree remove` after user confirmation, and keep dirty or still-used worktrees for ordinary changes. After Supervisor final delivery, Runtime automatically cleans only confirmed-clean, unused Child/integration worktrees and branches; dirty files, a process still running inside a worktree, or an incomplete Git step preserve the worktree and return a blocker, never a forced deletion.

Commit only the implementation and formal artifacts that belong to the current change, preserving other user changes. Execute the returned `commandArgs`, then inspect `workspaceFinishResult`. If it is `blocked`, preserve the workspace and run the recovery command in `recoveryArgs`.

Completion criterion: state is `done`, and the user-authorized workspace finish result is `completed` or `kept`. Follow `continuation` for any other result.

## Follow-up actions

After every command, handle only the latest `continuation`:

- `continue`: execute `commandArgs` and fill `inputOptions` from its template.
- `await-user`: wait for the listed user decision.
- `blocked`: resolve the listed blocker or recovery action first.
- `done`: finish.

After a state-changing command, query the change details again and confirm the current phase, acceptance Loop, state version, and working directory. Run `show` only when formal content is needed.
