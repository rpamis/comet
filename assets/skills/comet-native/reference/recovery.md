# Native Recovery Reference

Read this file only when Runtime reports an interrupted execution, missing local Runtime, Loop stagnation, conflict, migration, or damaged state.

## General rule

Stop writing, rerun `status --details --json`, and run read-only `doctor`. Execute only actions returned by the continuation, blockers, findings, or doctor. Do not edit portable state, local execution, locks, or transactions. Preserve the scene and wait for the user when safe automatic recovery cannot be established.

## Workspace

`status` searches registered worktrees for the binding-consistent change and returns its actual `workspace.projectRoot`. Resume and `select` there. Do not copy an active change, recreate the same name elsewhere, or edit workspace metadata to take ownership.

Block writes when root, branch, worktree kind, or Git availability does not match the portable workspace. Continue when Runtime can safely locate or create the declared worktree; otherwise enter `await-user`. If the original directory or branch is truly lost, only the user chooses whether to restore it, reconstruct from a trusted backup, or abandon the change.

## Stable state and local execution

`comet-state.yaml` determines the stable boundary to resume from. Local `state.json` only says what this machine is executing; discard and rebuild it from YAML, the brief, and target Specs when it is missing, behind, or belongs to an older operation. It must never overwrite newer YAML.

- Shape: remain in Shape and continue clarification or confirmation.
- Build / repairing: preserve the iteration and continue from the Builder handoff, unresolved acceptance items, and next action.
- Verify / verify-ready: rerun required checks for the current candidate and start a new Verifier attempt; do not reuse a pass from the old device.
- Archive / archive-ready: atomically return to Verify / verify-ready, reset current acceptance results to pending, and then verify the synchronized implementation again.
- `await-user` / `blocked`: restore the original blocker, owner, and allowed actions without advancing on your own.
- `done` in the active path: complete only deterministic directory movement and cleanup without another verification.
- `done` in the archive path: display read-only and do not create per-change Runtime.

Treat old operation processes, log handles, and Agent executions as lost; never infer success. When a check completed but YAML did not advance, rerun only safely repeatable checks and move unsafe external actions to `await-user`.

When `verification.md` is missing, interrupted, or its `generated_from_state_version` is behind, rebuild only the report from YAML. Body text cannot recover machine state, and Archive remains unauthorized until the versions align.

Show a legacy active change as read-only `migration-required`. Only `doctor --repair` or a Runtime-returned locked write action may migrate it. Preserve old files on failure; do not move or delete them manually.

## Zero-chat-context and cross-device recovery

Zero-chat-context recovery requires the same synchronized project code, `comet-state.yaml`, brief, target Specs, and `.comet/config.yaml` when a non-default artifact root is used. Stop the old device and synchronize before continuing. Enter `blocked` on a Git conflict or two forks from one state version; do not merge them automatically.

Recovery does not include code that was never synchronized from the old device and cannot continue the same subagent execution. The new device creates a new local execution from the portable workspace, Loop, acceptance results, blockers, Builder handoff, and next action. If synchronized implementation is missing, the new Verifier reports that gap and returns normally to Build.

Cross-device re-verification from Verify or archive-ready is infrastructure recovery: it does not increment iteration, failed iterations, or stagnation. Starting a real new Verifier increments only attempt. Recovery does not rerun completed Shape or Build work and does not enumerate the whole project to guess progress.

## Verify failure and stagnation

After Verify fail, read failed or blocked acceptance items and failed checks, actually repair them, and submit a new Builder handoff. Progress requires a smaller unresolved set; wording-only changes, repeated checks, or the same failure reason are not repairs.

Follow Runtime's `blocked` action after consecutive no-progress results or repeated execution errors. At `native.max_verify_failures`, enter `await-user` and let the user continue the current goal, change confirmed requirements, or stop. Reset semantic failure counters only after confirming a new acceptance list and starting a new goal cycle.

## Specification and Archive conflicts

When a canonical Spec changes, reread the latest canonical, brief, and proposed complete specification; rewrite according to user intent, execute the finding's rebase action, then implement and verify again. Never overwrite concurrent changes.

When two active changes declare the same capability, Archive enters `await-user` under its lock so the user can choose a serial order. Never select the newer version or merge them silently.

For interrupted Archive or root move, use only the transaction and direction returned by doctor. If paths, state, or actual files disagree, preserve both sides; do not invent a rollback or delete either side.

If `workspaceFinishResult.status` is `blocked`, the change may already be archived or committed. Inspect Git state with `recoveryArgs` first. Do not repeat Archive, force-remove the worktree, or merge/push again from an unknown state.

## Damaged state

- Never delete locks manually; repair only when doctor explicitly permits it.
- Do not guess and rewrite damaged config, change, brief, specification, or verification content.
- Preserve the scene and stop when active and archive both exist, ownership is unclear, or a transaction step cannot be determined uniquely.
