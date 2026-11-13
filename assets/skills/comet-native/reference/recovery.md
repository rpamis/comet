# Native recovery reference

Read only the section relevant to the current blocker.

## External input and monitoring

- Pause condition: pause recurring monitoring for the affected work only when it waits solely for a user reply or external material, no child is ready, no relevant task is running, and no external state needs periodic checks. Keep independent tasks and their monitors. Continue platform waits or monitoring for running tasks, CI, and external jobs whose results still need checking.
- Pause action: when the monitor belongs to the current work and the platform permits management, actually pause it through the platform and check the returned state. Query that automation if the response is insufficient. If it cannot be identified, permission is missing, or pausing fails, explicitly state that the pause is unconfirmed and what the user needs to do. Stopping chat replies does not stop recurring task triggers. Do not change unrelated or unidentified automations.
- Waiting message: on first entering the wait, explain the blocker, missing material, monitors actually paused, tasks still running, and recovery condition once. Save these details, monitor identifiers, and pause results in existing task records; do not introduce a new formal artifact format.
- Resume condition: on relevant new input or confirmed satisfaction of the prerequisite, reread Runtime state and continue from the latest `continuation`, retaining the change, task identifiers, and completed results. An ordinary progress message does not resolve the blocker or justify redispatching completed work. Resume the relevant monitor only if periodic checks are still needed, and verify that it resumed.
- State distinction: platform idleness or paused monitoring is not Runtime `blocked` / `await-user`. Update Runtime only through an existing public command that applies to this phase and blocker. Otherwise record what blocks the task and pause dependent work. Do not edit state files directly or use Verifier status to represent missing implementation material.

## Fault recovery

If local SDK Run history is missing, first inspect read-only with `comet native doctor <change-name> --json`, then follow its explicit recovery or import action. The original `run_checkpoint` in `comet-state.yaml` or a known older business source preserves saved phases, Actions, claims, and valid approvals; `status` does not write or restore records. Without a trusted source, preserve the workspace instead of restarting Shape or repeating approvals. Before further external work, reconcile unfinished or unknown tasks through their original platform without replaying possible side effects.

When a command returns a specific error, current state, and recovery action, use that response first. Correct Runner validation errors through [filling command inputs](commands.md#filling-command-inputs), and continue commit or merge failures through [Archive completion](workspace.md#archive-completion), keeping active task identifiers. If current state is missing, the call was interrupted, or the workspace disagrees with the response, stop dependent edits and run `status --details --json` once. Run read-only `doctor` only if the state or recovery records still do not explain the issue. Execute only recovery actions explicitly returned by `continuation` or `doctor`. Runtime owns business state and actual Archive transactions; the Agent inspects and cleans up platform tasks through their original platform. If safe automatic recovery cannot be established, preserve the workspace and wait for a user decision.

For external-input waits, follow [external input and monitoring](#external-input-and-monitoring) while independent work continues. Before redispatching Supervisor tasks after recovery, read [Supervisor coordination](commands.md#supervisor-coordination). Before relaunching a Verifier, read [Verify protocol](commands.md#verify-protocol) and check current task identifiers, candidate version, and execution state.

SDK recovery reads only the SDK Run and SDK Verify protocol in commands.md. Compat Runner, startup receipts, and workspace-finish fields below do not apply to SDK.

### Workspace

Continue a known change or Run in its current workspace. For another worktree, enter its known directory and run `select`; ordinary status does not search all worktrees. Reuse the located change and workspace; do not copy it or recreate the same name elsewhere.

Runtime blocks writes if project root, branch, workspace type, or Git state disagrees with `comet-state.yaml`. Follow its action if Runtime can safely find or create the declared worktree; otherwise it enters blocked await-user (`disposition: blocked`, recovery action `await-user`). If the original directory or branch is truly lost, the user chooses the recovery location, whether to restore from a trusted backup, or whether to abandon the change.

### Older business records

Continue the original change and Run. Entry adapts business data automatically, preserving accepted Shape, user decisions, tasks, and candidates. Use current templates. Old executors, PIDs, stop handshakes, and content snapshots are not restored. Inspect unfinished or unknown tasks through their original platform; cancelled scheduling does not establish termination or authorize replaying side effects.

Restore missing SDK Runs from their original `run_checkpoint` or known old data source. Without a trusted source, preserve the workspace and use doctor’s explicit import or recovery entry rather than searching other workspaces. Reports are views of business state and do not replace approvals or actual results.

### Cross-device recovery without chat history

A new device without chat history needs the same synchronized project code, `comet-state.yaml`, brief, and target Specs. Synchronize `.comet/config.yaml` too when the change uses a nondefault artifact directory. An SDK change's `run_checkpoint` travels with the state file and restores completed Shape and Build work and still-valid decisions; reconcile any Action that was executing locally.

Stop advancement on the old device and finish synchronization first. Git conflicts or different contents for the same state version block progress and require user resolution.

Business state cannot recover unsynchronized code. Inspect original tasks and side effects, then judge whether synchronized implementation, environment, and previous results apply. Collect only missing or invalidated evidence.

Recovery retains original tasks and counters. Update counters only when a candidate is resubmitted, a review starts, or an actual failure occurs under its business rule. Accepted Shape and Build do not restart merely because the machine changed.

### Failed Verify and Execution Errors

Read actual failed or blocked criteria and check results. The Agent judges repair direction and progress and submits a new Builder handoff after necessary changes. Repeated or alternating acceptance IDs and nonshrinking sets do not create another pause.

When actual failures reach `native.max_verify_failures`, or Verifier executions repeatedly fail, follow the current response for the budget or original execution recovery. Do not record unknown or failed results as passed. Retain the original Run, valid approvals, and existing results. Record a user-confirmed new objective cycle through the existing requirements protocol.

### Spec and Archive conflicts

If an archived project Spec changes while this change is active, reread that Spec, the brief, and this change's complete target specifications. Revise according to user intent, execute the rebase action in Runtime's conflict response, then implement and verify again. Preserve concurrent additions.

Active changes in separate workspaces may modify the same capability. Archive handles actual conflicts in the current canonical Spec; preserve both changes and follow its conflict and realignment actions. Any unresolved user proposal already present in the original Run still requires its original decision.

If Archive or a change-directory move is interrupted, use `doctor` transaction state and allowed actions for recovery. If paths, workflow state, and files disagree, preserve both sides and wait for an explicit recovery action.

If `workspaceFinishResult.status` is `blocked`, Archive or the Git commit may already be complete. Run `recoveryArgs` to inspect actual Git state before deciding the next step.

### Damaged state

- If config, change, brief, Specs, or verification is damaged, preserve original files and wait for `doctor` or the user to identify a recovery source.
- If a change appears in both active and archive, file ownership is unclear, or transaction progress cannot be established, preserve the workspace and stop writes.
