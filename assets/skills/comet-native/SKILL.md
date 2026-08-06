---
name: comet-native
description: Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry router selects Native; clarify requirements, read state, and drive Shape → Build → Verify → Archive.
---

# Comet Native

Native stores requirements, complete target specifications, state, and evidence. You understand, implement, and verify; the Runtime owns state, boundaries, and recovery.

## Inviolable boundaries

- `.comet/config.yaml`, the current change, state, and formal artifacts on disk override chat memory.
- Do not directly edit Runtime-managed state, workspace, scope, evidence, checkpoints, locks, or transactions.
- Invoke only the public `comet native` on PATH. If it is unavailable, report an incomplete Comet installation; do not search for or invoke an internal bundle.
- Run `comet native <command> --help` for parameters and output. Do not guess or reconstruct commands in the Skill.
- The Native main workflow does not depend on any external Skill.

## Start or resume

1. Run `comet native status --json`. The CLI discovers registered Git worktrees and returns each change's actual workspace, phase, continuation, and pagination actions.
2. When a target name is known, run `comet native status <change-name> --details --json` and `show`. Follow `nextPageArgs` for later status or acceptance pages.
3. If the active change already exists, resume against its returned `workspace.projectRoot` and `select` it instead of creating a duplicate. Ask the user only when multiple reasonable candidates remain.
4. Create only when no matching active change exists. Use only the configured artifact root.

### Create a change

Resolve a lowercase kebab-case name first. If the user did not name it, present a short recommendation before creation.

Ask about isolation only when it materially affects the user's directory, presenting the applicable choices and recommendation together:

- `current`: default when the directory is clean and not owned by another active Native change;
- `branch`: use a separate branch in the current clean directory;
- `worktree`: use when another active change owns the directory or an independent working directory is needed.

The user may override the change branch, target branch, and worktree path together. Defaults are `comet/<change-name>`, the current branch, and `.worktrees/<change-name>`. Show the final selection. On collision, stop; never add a random suffix or take over an existing resource.

Pass the selection to `new`. The CLI creates or reuses a legally bound branch/worktree, maintains the repository-local exclude, checks target configuration, and captures the baseline in the target directory. Continue from `preparation.projectRoot`. If preparation is partial, report the error and resources recorded in `preparation`; do not delete a directory, branch, or file with uncertain ownership.

Keep legacy workspace metadata compatible. Do not migrate it, move the change, or refresh its baseline merely to enable isolation.

## Read on demand

After confirming the phase, read only the needed reference:

- Shape: always read and execute the [clarification reference](reference/clarification.md);
- editing the brief, complete target specifications, or verification: [artifact reference](reference/artifacts.md);
- advanced inputs, receipts, partial scope, or diagnostic actions requested by Runtime: [command reference](reference/commands.md);
- interruption, stale evidence, repair stop, conflict, migration, or damage: [recovery reference](reference/recovery.md).

## Shape

Investigate facts available from the repository, tools, and runtime environment first. You may use subagents for independent fact investigations; do not send investigable facts to the user.

Follow `native.clarification_mode` and the clarification reference while maintaining a decision tree. Sequential asks exactly one currently askable node per round; Batch asks the complete currently askable set. Ask only decisions that materially change user-visible results and cannot be inferred reliably.

Synchronize every conclusion immediately into Decisions, the brief, and complete target specifications. Keep unresolved questions `[blocking]`; do not modify implementation while a blocker remains. After all branches and silent assumptions are checked, summarize the goal, scope, key decisions, acceptance criteria, and non-goals. Advance with the continuation containing `--confirmed` only after explicit user confirmation.

## Build

Implement the simplest reliable solution satisfying the brief and complete target specifications. Checkpoints may preserve recovery context for long work, but they are not completion evidence.

When requirements change, classify ownership first:

- implementation work belonging to this change: from Verify/Archive, use the continuation's `--return-to-build` action and confirm Build before writing implementation;
- a changed user-visible contract: return to Build, repeat clarification, update formal artifacts, and reconfirm;
- work unrelated to this change: preserve it and create or select another change.

When the user explicitly adds a file or behavior to this change, do not reject it merely because an earlier plan omitted it. Update the formal scope through the ownership rule above; keep it blocked until required confirmation is complete.

When the candidate implementation is complete, review it against the full specification and every acceptance item. Submit real project artifacts through the continuation's `commandArgs`; use its no-code alternative only when no project file changed. Never declare an unknown scope complete.

## Completion loop

1. Read `status <change-name> --details --json` and every acceptance page. After a failure, prioritize failed or missing acceptance items and failed checks.
2. Complete a coherent repair batch and review it against the full specification.
3. Run real validation and produce current receipts and verification report.
4. `fail` returns to Build; only `pass` enters Archive.

`blocked` enters recovery. Resolve findings and reread the continuation. Stop only on `done`, `await-user`, or an explicit user request; one turn, checkpoint, or self-reported completion is not terminal.

## Verify

Run real validation proportional to acceptance criteria, the complete specification, and change risk. Record only actual commands, results, and reviewable facts. Unrun, failed, skipped, blocked, or timed-out checks cannot be reported as passed.

Use Runtime-provided acceptance IDs and typed receipts. Submit `--result` and `--report` as requested by the continuation; do not supply a caller-created required-check receipt. Reverify after any specification, implementation, report, or evidence change.

After Verify fail, actually repair the gaps before retrying. On `repair-stagnation-stop`, form one different concrete repair hypothesis and use the Runtime-provided override input. Wait for the user only when the continuation requires `repair-continuation-decision`.

## Archive

Prepare Archive only after final Verify pass.

`current` needs no branch-finishing choice. For `branch` or `worktree`, show the exact change branch, target branch, and directory once, then ask the user to choose local merge, push the change branch, push and create a PR, keep, or do not archive. Stop on “do not archive.”

Before execution, commit only implementation and active-change formal artifacts owned by this change, preserving every other user change; the CLI rejects uncommitted paths outside its safe Archive metadata. Persist the choice with `archive --dry-run --finish ...`, then use the exact continuation `commandArgs`:

- `automatic`: execute it;
- `required`: show the summary and wait for explicit confirmation;
- never reuse an old preflight.

The Archive command commits Archive paths and executes the authorized merge, push, or PR action. Inspect `workspaceFinishResult`: `completed`/`kept` means the action ran; `blocked` means Archive completed but an external finish remains, so preserve the scene and diagnose with `recoveryArgs`. Cleanup after merge is deferred until the merged result is validated. Never resolve semantic conflicts silently.

## Continuation

After every command, follow Runtime output:

- `continue`: fill real values into `commandArgs` and `inputOptions`, then continue;
- `await-user`: wait only for the listed user decision;
- `blocked`: pause the normal loop and resolve findings or recovery actions;
- `done`: the change and selected finish reached the terminal state reported by the command.

Do not assemble shell text from `command`; prefer structured argv. Reread status after execution and verify phase, revision, and workspace still match expectations.
