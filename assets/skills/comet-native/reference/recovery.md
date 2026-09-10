# Native recovery reference

Read this file when waiting for external input requires pausing or resuming monitoring, or when the Runtime reports interrupted local execution, missing Runtime files, repeated lack of progress, a concurrency conflict, failed legacy migration, or damaged state.

## General principles

For Runtime failure recovery, stop modifying the project, then rerun `status --details --json` and read-only `doctor`. Execute only a recovery action explicitly returned by `continuation` or `doctor`. Always leave portable state, local execution state, locks, and transactions to the Runtime. If safe automatic recovery cannot be determined, preserve the workspace and wait for the user. When only waiting for external input, follow the next section and continue independent work.

## External input and monitoring

- Pause conditions: when related work only awaits user or external materials, with no executable children, no related tasks still running, and no external state worth checking periodically, pause periodic monitoring for that work; preserve independent tasks and their monitoring. Continue using platform waiting or monitoring capabilities for running tasks or checkable CI and external jobs.
- Pause operation: when the corresponding automation can be identified unambiguously and the platform permits management, actually pause it and verify the returned status through platform capabilities; if the response is insufficient, read that automation's state to confirm. If identification is uncertain, permission is missing, or pausing fails, explicitly report that monitoring is not confirmed paused and describe the required manual action. A silent reply does not pause periodic wakeups; do not operate on unrelated automations or those with unclear ownership.
- Waiting notice: on first entering this waiting state, tell the user once about the blocker, missing materials, actual pause scope, still-running tasks, and resumption conditions. Save these details, the corresponding monitoring identifier, and the pause outcome in existing coordination records without introducing a new formal artifact format.
- Resumption conditions: after receiving relevant new input or verifying that a related dependency has been resolved, reread Runtime and retain the original change, task identity, and completed results, then follow the latest `continuation`. Ordinary progress reports do not clear blockers; retain results without redispatching work. Resume the corresponding monitoring only when periodic checks are still needed, and verify the outcome.
- State boundary: platform task idleness and paused periodic monitoring are not equivalent to Runtime `blocked` / `await-user`. Register Runtime state only through an existing public action applicable to the current phase and blocker; otherwise retain the business blocker record and pause work dependent on that input. Do not edit state files directly or use Verifier state to represent missing implementation materials.

## Workspace

`status` searches registered worktrees for a change whose binding matches and returns the actual `workspace.projectRoot`. Enter that directory and run `select` again. Resume the found change in its found directory; do not copy it or recreate a change with the same name elsewhere.

If the project root, branch, workspace type, or Git state differs from the record in `comet-state.yaml`, the Runtime prevents writes. When it can safely locate or create the declared worktree, follow the returned action. Otherwise it enters `await-user`. If the original directory or branch is truly lost, the user decides which recovery directory to use, whether to rebuild from a trusted backup, or whether to abandon the change.

## Stable state and local execution

`comet-state.yaml` records the last workflow state that can be resumed safely. Local `state.json` only says what this machine is executing. If it is missing, stale, or belongs to an old task, the Runtime rebuilds it from YAML, the brief, and target Specs. Local state cannot overwrite newer YAML.

- Shape: remain in Shape and continue clarification or confirmation.
- Build: if the Runtime shows `repairing`, Verify has returned to Build. For an ordinary change, keep the current iteration and continue implementation. For a Supervisor Change, follow `repair-child` and add an unfinished child covering the failed acceptance items; do not reopen an archived child.
- Verify (`verify-ready`): rerun the necessary checks for the current candidate and start a new Verifier. Do not reuse a pass from the old device.
- Archive (`archive-ready`): safely return to Verify, reset the verification result to `pending`, and verify the implementation synchronized to the new device.
- `await-user` / `blocked`: restore the original blocker, responsible actor, and allowed actions; wait until the corresponding condition is satisfied.
- `done` under the active directory: complete only directory movement and cleanup that can be determined safely.
- `done` under the archive directory: present the change as read-only and finished.

Treat old task processes, log connections, and Agent sessions as lost. Do not infer success from leftover files. When a check finished but YAML does not record its result, rerun only checks that are safe to repeat; potentially side-effecting external actions become `await-user`. If `verification.md` is missing, its write was interrupted, or `generated_from_state_version` is behind, rebuild only the report from YAML. YAML remains the recovery source; Archive cannot be authorized until the report version aligns. An active change from an older release appears read-only as `migration-required`. Use `doctor --repair` or the migration command explicitly returned by the Runtime. If migration fails, keep the legacy files and wait for the Runtime's next action.

## Zero chat context and cross-device recovery

To resume on a new device with no chat history, obtain the same synchronized project code, `comet-state.yaml`, brief, and target Specs. Also synchronize `.comet/config.yaml` when the change uses a non-default artifact directory.

Stop progression on the old device before synchronizing. A Git conflict or two different contents for the same state version enters a blocked state for the user to resolve.

Unsynchronized code from the old device cannot be recovered from workflow state, and a subagent task cannot continue across devices. The new device creates new local execution tasks from the workspace, acceptance Loop, verification result, blockers, Builder handoff, and next action in YAML. If the synchronized implementation is incomplete, the new Verifier reports the gap and returns to Build. Reverification of Verify or archive-ready state on a new device is recovery: it does not increment the implementation iteration, failure count, or stagnation count. Only actually starting a new Verifier increments the Verifier attempt. Completed Shape and Build work are not repeated, and the Runtime does not scan the whole project to guess progress.

## Failed Verify and repeated lack of progress

After Verify fails, read the failed and blocked acceptance items and failed checks. Make actual changes, then submit a new Builder handoff. Progress means the unresolved problem set becomes smaller. Editing explanatory text, repeating the same check, or reporting the same reason again does not resolve a problem.

After repeated rounds without progress or repeated Verifier task errors, follow the blocker action returned by the Runtime. When failed iterations reach `native.max_verify_failures`, the workflow enters `await-user` so the user can continue the current target, change the confirmed requirements, or stop. The verification failure count resets after the user confirms a new acceptance list and starts a new goal round.

## Specification and Archive conflicts

If an archived canonical Spec changes during the current change, reread the latest canonical Spec, brief, and complete target specification. Rewrite the current target according to user intent, execute the rebase action from Runtime conflict information, then reimplement and reverify. Preserve concurrent additions.

When two active changes modify the same capability, Archive enters `await-user`. The user chooses which change to Archive first; the other then rebases onto the latest canonical Spec.

If Archive or change-directory movement is interrupted, use the transaction state and allowed actions returned by `doctor`. When paths, workflow state, and actual files disagree, preserve both sides and wait for an explicit recovery action.

If `workspaceFinishResult.status` is `blocked`, the change may already be archived or Git-committed. First run `recoveryArgs` to inspect actual Git state, then follow the returned result.

## Damaged state

- The Runtime manages locks. Repair them only when `doctor` returns an explicit command.
- If config, change, brief, specifications, or verification data is damaged, preserve the original file and wait for a recovery source from `doctor` or the user.
- If the same change exists in both active and archive, file ownership is unclear, or transaction progress cannot be determined, preserve the workspace and stop writing.
