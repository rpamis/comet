---
name: comet-native
description: "Comet Native workflow. Use when the user invokes /comet-native, asks to start or resume a Native change, or the entry router selects Native."
---

# Comet Native

Native stores requirements, complete target specifications, portable state, and acceptance results on disk. You clarify, implement, and organize independent verification as directed by Runtime; Runtime owns state, Loop behavior, boundaries, and recovery.

## Inviolable boundaries

- `.comet/config.yaml`, the current change, `comet-state.yaml`, and formal Markdown on disk override chat memory.
- Do not directly edit Runtime-managed state, local executions, logs, locks, or transactions.
- Invoke only the public `comet native` on PATH. If it is unavailable, report an incomplete Comet installation; do not search for or invoke an internal bundle.
- Run `comet native <command> --help` for parameters and output. Do not guess or reconstruct commands in the Skill.
- A Builder completion claim is not an acceptance result. The Skill must start a new Verifier subagent or independent Agent execution; the Builder cannot author the Verifier result directly.
- The Native main workflow does not depend on any external Skill.

## Start or resume

1. Run `comet native status --json`. The CLI discovers registered Git worktrees and returns each change's actual workspace, phase, Loop, and continuation.
2. When a target name is known, run `comet native status <change-name> --details --json` and `show`. Follow `nextPageArgs` to read every acceptance item or later status page.
3. If the active change already exists, resume against its returned `workspace.projectRoot` and `select` it instead of creating a duplicate. Ask the user only when multiple reasonable candidates remain.
4. Create only when no matching active change exists. Use only the configured artifact root.

### Create a change

Resolve a lowercase kebab-case name first. If the user did not name it, present a short recommendation before creation.

Ask about isolation only when it materially affects the user's directory, presenting the applicable choices and recommendation together:

- `current`: default when the directory is clean and not owned by another active Native change;
- `branch`: use a separate branch in the current clean directory;
- `worktree`: use when another active change owns the directory or an independent working directory is needed.

The user may override the change branch, target branch, and worktree path together. Defaults are `comet/<change-name>`, the current branch, and `.worktrees/<change-name>`. Show the final selection. On collision, stop; never add a random suffix or take over an existing resource.

Pass the selection to `new`. The CLI creates or reuses a legally bound branch/worktree, maintains the repository-local exclude, checks target configuration, and creates portable state plus the local execution overlay. Continue from `preparation.projectRoot`. If preparation is partial, report the error and resources recorded in `preparation`; do not delete a directory, branch, or file with uncertain ownership.

Keep legacy workspace metadata compatible. Do not migrate it or move the change merely to enable isolation.

## Read on demand

After confirming the phase, read only the needed reference:

- Shape: always read and execute the [clarification reference](reference/clarification.md);
- editing the brief or complete target specifications, or viewing the acceptance report: [artifact reference](reference/artifacts.md);
- a Runtime `runnerAction`, constructing `--runner-input`, Verifier dispatch, or diagnostics: [command reference](reference/commands.md);
- interrupted execution, missing local Runtime, stagnation, conflict, migration, or damage: [recovery reference](reference/recovery.md).

## Shape

Investigate facts available from the repository, tools, and runtime environment first. You may use subagents for independent fact investigations; do not send investigable facts to the user.

Follow `native.clarification_mode` and the clarification reference while maintaining a decision tree. Sequential asks exactly one currently askable node per round; Batch asks the complete currently askable set. Ask only decisions that materially change user-visible results and cannot be inferred reliably.

Synchronize every conclusion immediately into Decisions, the brief, and complete target specifications. Write acceptance criteria as non-empty, observable, non-duplicated items. Keep unresolved questions `[blocking]`; do not modify implementation while a blocker remains. After checking every branch and silent assumption, summarize the goal, scope, key decisions, acceptance criteria, and non-goals. Advance with the continuation containing `--confirmed` only after explicit user confirmation.

## Build

Implement the simplest reliable solution satisfying the brief and complete target specifications. When requirements change, classify ownership first:

- implementation work belonging to this change: from Verify/Archive, use the continuation's `--return-to-build` action and confirm Build before writing implementation;
- changed user-visible behavior or acceptance criteria: return to Shape, update formal artifacts and acceptance items, then reconfirm;
- work unrelated to this change: preserve it and create or select another change.

When the user explicitly adds a file or behavior to this change, do not reject it merely because an earlier plan omitted it. Update the formal scope through the ownership rule above; keep it blocked until required confirmation is complete.

When the candidate is complete, review it against the full specification and every acceptance item, then use `next --runner-input <file>` from `continuation.commandArgs` to submit a compact Builder handoff: this iteration's implementation summary, how prior failures were addressed, development checks actually run or not run, and known limitations. Public JSON never supplies candidate, identity, provider, or execution refs; Runtime allocates those correlations. Put the input in the OS temporary directory and delete it in `finally` after the call, never leaving it in the project or Runtime directory. Do not write an acceptance verdict, copy complete command output, or substitute a self-reported completion for Verify.

## Completion loop

1. Read the current Loop, every acceptance item, blockers, and next action. After failure, prioritize failed or blocked items and failed checks.
2. Complete a coherent repair batch, review the full specification, and pass `builder-handoff` JSON to the same `next --runner-input` from the continuation.
3. Explicitly resolve the command-check plan and pass `dispatch-verifier` JSON to that option. Use `checks: []` only when the project truly has no applicable command check, never to hide an unknown plan.
4. Read the complete returned `verifierDispatch`; give its candidate, iteration, attempt, acceptance list, brief/Spec refs, Builder handoff, and real Runtime checks to a new read-only Verifier subagent. If subagents are unavailable, start a new independent Agent execution. If neither is available, submit `verifier-unavailable` only after the explicit check plan completed and all checks passed; Runtime must stop for degraded user confirmation instead of fabricating a Verifier result.
5. Pass the Verifier's `verifier-response` or `verifier-execution-error` JSON to the same option. For an execution error or unavailable Verifier, copy the four binding fields from the current `verifierDispatch` exactly; they prevent a delayed old execution from changing a newer attempt. Continue the same attempt after `request-checks`; the final result covers every acceptance ID. `fail` returns to Build. For semantic `blocked`, wait for the user's choice, then use `--resolve-verifier-blocker` to retain completed checks and dispatch a new attempt when implementation is unchanged, or return to Build when it must change. A `skill-coordinated` pass stops at `await-user`: explain that the generic CLI cannot strongly prove an independent execution, ask once whether the user accepts that boundary, then run the returned `next --confirmed --summary` to enter Archive.

Continue the bounded Loop returned by Runtime. Stop only on `done`, `await-user`, `blocked`, or an explicit user request; one turn, one implementation submission, or an Agent completion claim is not terminal.

## Verify

The Verifier does not trust completion claims in the Builder handoff. It read-only inspects the brief, complete target specifications, actual implementation, Runtime check results, and every acceptance item; the handoff is only an investigative lead.

When extra checks are needed, the Verifier requests them in one batch and Runtime records their real exit state, timeout, and logs. Never treat a prose result as proof that a check ran. The final response must return exactly one `passed`, `failed`, or `blocked` decision for every known acceptance ID, with a reason the next Build can act on directly.

The Verifier does not modify implementation, advance state, or fill candidate, provider, or execution identity in its response or CLI. The released Runtime always labels this path `skill-coordinated`: it binds a candidate and attempt programmatically, but any local caller can invoke it, so it cannot prove that a malicious caller started an independent Agent and must never be called trusted, runner-attested, or host-attested. Reliability comes from the Skill's new-subagent protocol, real Runtime-executed checks, exactly-once coverage of every acceptance ID, and user confirmation before Archive. The fallback for platforms without an independent execution must retain `semantic-verification-unavailable` / `user-confirmed-degraded` assurance and cannot be reported as a normal independent pass.

After Verify fail, actually repair the gaps before retrying. Runtime judges progress from unresolved acceptance items and failure counters; obey its `blocked` or `await-user` disposition when stagnation or execution-failure limits are reached instead of retrying blindly.

## Archive

Prepare Archive only after Runtime accepts a final Verify pass or the user explicitly accepts the unavailable-semantic-verification boundary. Archive does not rerun checks or dispatch another Verifier.

`current` needs no branch-finishing choice. For `branch` or `worktree`, show the exact change branch, target branch, and directory once, then ask the user to choose local merge, push the change branch, push and create a PR, keep, or do not archive. Stop on “do not archive.”

Before execution, commit only implementation and active-change formal artifacts owned by this change, preserving every other user change; the CLI rejects unrelated uncommitted paths. Use Runtime's `commandArgs` and current state version for the authorized Archive. When confirmation is required, show the summary and wait for an explicit answer; do not reuse an old action.

Archive applies complete target Specs, moves the change, removes local per-change Runtime, and performs the authorized merge, push, or PR action. Inspect `workspaceFinishResult`: `completed`/`kept` means the action ran; `blocked` means Archive or its external finish needs recovery, so preserve the scene and diagnose with `recoveryArgs`. Never resolve semantic conflicts silently.

## Continuation

After every command, follow Runtime output:

- `continue`: fill real values into `commandArgs` and `inputOptions`, then continue;
- `await-user`: wait only for the listed user decision;
- `blocked`: pause the normal loop and resolve blockers, findings, or recovery actions;
- `done`: the change and selected finish reached the terminal state reported by the command.

Do not assemble shell text from `command`; prefer structured argv. Reread status after execution and verify that phase, Loop, state version, and workspace still match expectations.
