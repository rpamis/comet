---
name: comet-native
description: Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry router selects Native; clarify requirements, read state, and drive Shape → Build → Verify → Archive.
---

# Comet Native

Native stores requirements, complete target specifications, state, and evidence. You understand, implement, and verify; the Runtime owns state, boundaries, and recovery.

## Core rules

Read these values from `.comet/config.yaml`:

- `native.clarification_mode`: defaults to `sequential`;
- `native.archive_confirmation`: defaults to `automatic`;
- `native.max_verify_failures`: defaults to `5`.

Config, selection, change state, and formal artifacts on disk take precedence over chat memory. Do not directly edit Runtime-managed state, evidence, locks, or transaction files.

The Native main workflow does not depend on any external Skill.

## CLI bootstrap

The Native Skill uses only the public `comet native <cmd>` CLI on PATH. Packaged command bundles are internal installation and Runtime assets; the Skill does not search for or invoke them directly. If a command returns `command not found`, `executable not found`, or `ENOENT`, stop and explain that the Comet CLI installation is incomplete. Do not search for Skill files, enumerate platform directories, or invoke an internal bundle directly.

Common commands:

```bash
comet native status [--json]
comet native show <change-name>
comet native select <change-name>
comet native new <change-name> [--language en|zh-CN] [--isolation current|branch|worktree]
comet native next <change-name> --summary <text> [--confirmed]
comet native archive <change-name> --dry-run
```

## Start or resume

1. In a Git project, first read the current branch and `git worktree list --porcelain`. Run read-only `comet native status --project-root <path> --json` for every safely accessible working directory. This is default discovery; do not wait for the user to say “parallel.”
2. Run `comet native status` in the current working directory and combine it with the other working-directory results to identify the target change, its owning working directory, and phase. If a matching active change exists, resume in that working directory instead of creating another one.
3. Run `comet native show <change-name>` for the target. In Verify, Archive, or Build after a failure, also run the status command with `--details`.
4. When more acceptance items are needed, follow `acceptancePage.nextCursor`. If findings are truncated, handle the returned findings and then read details again.
5. Enter the target's actual working directory and run `comet native select <change-name>`. Do not require the user to run `cd` manually.

If multiple reasonable candidates remain, ask the user to select one. Create a change only after confirming that no matching active change exists in any discovered working directory, then follow the workspace protocol below.

Use only the Native artifact root selected by project configuration.

## Workspace protocol for a new change

The parallelism unit is a change: separate changes may progress concurrently in separate working directories. One change is writable only from its bound working directory and current execution context; Native does not create a long-lived session lease.

Before creation, inspect the current branch, uncommitted changes, active Native changes in the current directory, and registered Git worktrees. Keep three workspace modes:

- `current`: keep the current branch and directory;
- `branch`: create and switch to a change branch in the current directory;
- `worktree`: create a separate change branch and Git working directory, then continue there.

Selection rules:

- When the current directory is clean and no discovered working directory has another active change, default directly to `current`; do not ask whether the user wants “parallel” work.
- When uncommitted changes or other facts make isolation materially affect the user's directory, present one joint `current / branch / worktree` choice with the recommendation, branch, and working-directory path. Do not split it into a separate “parallel?” question.
- When another active Native change owns the current directory, disclose that `current` and `branch` are unavailable because of baseline-drift risk, then use the only safe `worktree` mode. Active changes already in other worktrees do not disable `current` or `branch` here.
- In the same choice, the user may override the default branch `comet/<change-name>` and directory `.worktrees/<change-name>`. On a path or branch collision, stop; do not add a random suffix or take over a directory that is not already legally bound to this change.

Prepare `branch` or `worktree` before running `new` and before the baseline is captured. The target branch defaults to the starting branch at the moment the branch or worktree is created:

```text
# current
comet native new <change-name> --language en --isolation current

# branch: create and switch branches first
comet native new <change-name> --language en \
  --isolation branch --change-branch comet/<change-name> --target-branch <starting-branch>

# worktree: create and enter .worktrees/<change-name> first
comet native new <change-name> --language en \
  --isolation worktree --change-branch comet/<change-name> --target-branch <starting-branch>
```

Before creating a worktree, add `.worktrees/` to the repository-local Git exclude in the Git common directory's `info/exclude`; do not modify tracked `.gitignore` for this. The Agent continues automatically in the new working directory instead of handing navigation to the user.

Create the worktree from the resolved commit of a verified local target branch. If the source directory has uncommitted content, attribute it first: leave work proven unrelated to the new change in place; if content may belong to the new change and cannot enter through that commit, wait for the user to decide how to preserve it rather than silently committing, copying, or omitting it. The target directory must receive consistent configuration from the target branch or establish legal configuration through public `comet native init`, then verify artifact-root, language, clarification, archive, verify, and snapshot semantics. Stop when consistency cannot be proven. Never copy the source `.comet/current-change.json`.

After the target configuration is ready and before running `new`, the Agent must run these commands in the new working directory:

```bash
comet doctor --repair --scope project
comet doctor --scope project --json
```

Continue only when Doctor confirms that the Hook runtime is current, the platform has exactly one Router rooted in the target project, and no legacy or duplicate Comet Hook remains. The Agent runs these commands in the new working directory without asking the user to enter it manually, and never copies `.comet/current-change.json` from the source directory. If the target branch did not provide project configuration, first use the public `comet native init` command to establish the source project's verified semantics, then run the Doctor sequence above.

If worktree creation completes only some steps, stop immediately and report the original error, target branch and path, every branch/worktree/exclude/config/change resource known to have been created, and the recoverable next action. Clean up only resources proven to be newly created by this operation and safe to remove. Preserve the scene when ownership is uncertain; never remove an existing or possibly user-owned worktree, branch, or file.

Runtime rechecks for a newly active change inside the same mutation lock used by `new`. If a system-default `current` loses this race and returns `workspace-isolation-required`, automatically prepare the default worktree and retry there. If an explicit user choice becomes invalid before execution, stop and reconfirm rather than silently changing modes.

Existing active changes without a workspace v3 binding remain compatible: do not generate worktrees, move files, or refresh their baselines automatically. Continue selecting only one change at a time in a shared legacy directory. Only real baseline or scope drift fails closed and requires the user to decide whether to recover, recreate, or abandon the change.

## On-demand loading

After confirming the current change and phase, read one corresponding reference on demand:

- When entering Shape, you must first read and execute the [clarification reference](reference/clarification.md). Do not skip it because “the requirements look clear.” Do not modify project implementation or advance to Build until shared understanding is confirmed.
- If you need advanced options, receipts, or partial-scope commands, read the [command reference](reference/commands.md).
- If you need to edit the brief, specifications, or verification report, read the [artifact reference](reference/artifacts.md).
- If interruption, stale evidence, a repair stop, conflict, lock, or migration occurs, read the [recovery reference](reference/recovery.md).

## Shape

First investigate facts available from the repository, tools, and runtime environment. Ask the user only when different choices would materially change user-visible results and the existing requirements do not resolve the choice reliably. You own implementation choices.

Follow the clarification reference according to `clarification_mode`. Even when the initial assessment finds no unresolved behavior, complete its information classification and silent-assumption check. After every user answer, immediately update Decisions, the brief, and the complete target specifications in the same change. Keep unresolved items `[blocking]`; do not modify project implementation or advance while a blocker remains.

After all user decisions are resolved, check again for silent assumptions. Give the user a shared-understanding summary covering the goal, scope, key decisions, acceptance criteria, and non-goals. Only after explicit confirmation may you remove the final blocker and advance:

```text
comet native next <change-name> --summary <summary> --confirmed
```

If the brief or specifications change confirmed behavior, obtain confirmation again. Do not edit confirmation state manually.

## Build

Implement the simplest reliable solution that satisfies the brief and complete target specifications. Work may proceed in batches. Long tasks may use a checkpoint for recovery context, but a checkpoint is not completion evidence.

When requirements change, update the formal artifacts first. If a new user decision appears, stay in Build but repeat the Shape clarification and confirmation boundary: save a `[blocking]` item, pause implementation, and ask the user. After confirmation, update Decisions, the brief, and the complete target specifications, then remove the blocker. When leaving Build, run the command returned by the Runtime and pass `--confirmed`.

After the candidate implementation is complete, review it against the complete specifications and every acceptance item for omissions, then advance with real project artifacts:

```text
comet native next <change-name> \
  --summary <summary> \
  --artifact <project-path> \
  [--confirmed]
```

If no code changed or the Runtime cannot prove complete scope, read the command reference. Never describe unknown or incomplete scope as complete.

## Completion Loop

After entering Build, converge through this loop:

1. Run `comet native status <change-name> --details` and read the currently required acceptance pages. After a Verify failure, prioritize failed or missing acceptance items and failed checks.
2. Complete one related batch of real repairs. You may write a checkpoint before interruption, but a checkpoint is not completion evidence.
3. When a candidate implementation exists, reread the brief, complete specifications, and every acceptance item, then perform one complete review.
4. Run real validation and submit the Verify result.
5. `fail` returns to Build and repeats from step 1 without running Archive; only `pass` enters Archive.

`blocked` pauses the normal Build → Verify loop and enters a recovery branch. After handling the findings, resume from step 1 according to the new continuation. End the current work only at `done`, `await-user`, or an explicit caller stop point. One Agent turn, one checkpoint, one `blocked` result, or the Agent saying “complete” is not a terminal state. The Agent finds and repairs gaps; the Runtime decides whether completion has been proven.

## Verify

Run real validation based on the acceptance items, complete target specifications, and change risk. Record actual results in `verification.md` and the acceptance evidence. A check that did not run or failed cannot be reported as passed.

Use acceptance IDs and receipts returned by the Runtime. Read the artifact and command references when you need to generate the evidence block or record an automated or manual receipt.

Submit `pass` only when the Runtime accepts the complete, fresh acceptance matrix and required checks. Reverify after relevant implementation, specification, report, or evidence changes.

When submitting Verify, pass only `--result` and `--report`; `next` does not accept `--receipt` or caller-supplied required-check arguments. The Runtime validates the report format, complete acceptance matrix, and acceptance receipts before it runs or reuses the built-in required check for the current scope. If the report is invalid, fix it before retrying instead of submitting the same `next` command repeatedly.

`fail` returns to Build. Fix the failed or missing acceptance items and failed checks reported by the Runtime before verifying again; another `next` call is not itself a repair. For `repair-stagnation-stop`, follow the recovery reference to form a new hypothesis and use the Runtime-provided override. Wait for the user only when the continuation requires `repair-continuation-decision`.

An intermediate Verify failure never runs Archive or triggers archive confirmation. Continue Build → Verify until pass, a Runtime block, or a required user decision.

## Archive

Prepare Archive only after the final Verify pass. First read the change's workspace binding; treat legacy workspace metadata as `current` for compatibility.

`current` continues to use `native.archive_confirmation` without a separate branch-finishing question. Before Archive, `branch` or `worktree` requires one joint choice:

1. archive and merge locally into the bound target branch;
2. archive and push the change branch;
3. archive, push, and open a PR;
4. archive and keep the current branch/working directory;
5. do not archive yet.

Show the exact change branch, target branch, and working directory. Recommend one option based on whether the target branch is locally available and its working directory is clean. Execute external Git actions only after the user chooses; preserve the scene and stop on “do not archive.”

Then preview:

```text
# current
comet native archive <change-name> --dry-run

# branch / worktree: persist the joint choice in formal workspace metadata
comet native archive <change-name> --dry-run --finish merge|push|pull-request|keep
```

After a successful preview:

- `automatic`: run the exact commit command returned by the continuation;
- `required`: show the implementation, verification, and specification-operation summary, then wait for the user to archive now or keep the change active.

Do not reuse an old preflight. If facts drift or a canonical conflict or unfinished transaction appears, follow the continuation and the recovery reference.

The returned `workspaceFinish` must match the user's choice. Later sessions recover that decision from formal workspace metadata without another routine prompt. After Archive succeeds, stage and commit only confirmed implementation, specification, and Archive paths owned by this change; exclude unrelated user work. The preceding joint choice authorizes this one exact stage/commit and the selected finishing action:

- Local merge: merge the change branch in the bound target branch's working directory and run post-merge validation proportional to the change risk. On success, remove the clean change worktree and the merged local branch. Preserve both on any failure.
- Push: push the change branch. On success, a clean change worktree may be removed, but retain the local and remote branches.
- Push and PR: after pushing, create the PR with the workspace's persisted `targetBranch` as its base instead of inferring the repository default branch, then apply the push cleanup. Native does not continuously monitor the PR.
- Keep: retain the branch and working directory after committing; do not merge or push.

Archive multiple changes independently. Only local merges that update the same target ref must be serialized. Resolve a conflict automatically only when the resolution mechanically preserves both confirmed contracts, then revalidate. Abort any semantic conflict and ask whether to create a separate integration change; never silently overwrite either side.

## Continuation and stop points

Shape, Build, and Verify transitions return `next: auto | manual` together with `continuation.disposition: continue | await-user | blocked | done`, required inputs, and the next action. Archive does not advance through `next`; a successful archive returns `done`. After every transition, act on that Runtime continuation:

- `continue`: reread the phase and currently required artifacts, then continue;
- `await-user`: wait for a decision or missing input that genuinely requires the user;
- `blocked`: pause the normal loop, handle the findings, and read the recovery reference when needed; then resume according to the new continuation rather than ending the task because it was `blocked`;
- `done`: the change is complete.

`next: auto` means only that the current transition succeeded; later work has not run automatically. If the caller explicitly requests a stop after a transition, update the formal artifacts, run the one allowed transition, make no tool calls after the transition succeeds, then output the agreed marker and end the turn, even when the continuation is `continue`.

For legacy metadata, `workspace-root-changed` and `workspace-inspection-unavailable` are read-only advisories and do not block progression or Archive by themselves. `workspace-binding-root-changed`, `workspace-branch-changed`, `workspace-kind-changed`, and `workspace-vcs-unavailable` mean a new binding is invalid; return to the bound working directory and branch or stop for recovery. Other unknown workspace-integrity findings, confirmed conflicts, stale evidence, and repair stops must also be resolved. When the Runtime requires workspace identity repair, run read-only doctor and then follow its explicit `doctor --repair` report.

Never place tokens, passwords, private keys, connection strings, or other credentials in summaries, reasons, reports, or artifacts.
