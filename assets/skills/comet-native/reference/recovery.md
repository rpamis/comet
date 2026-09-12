# Native recovery reference

Read only the section relevant to the current blocker.

## External input and monitoring

- Pause condition: pause recurring monitoring for the affected work only when it waits solely for a user reply or external material, no child is ready, no relevant task is running, and no external state needs periodic checks. Keep independent tasks and their monitors. Continue platform waits or monitoring for running tasks, CI, and external jobs whose results still need checking.
- Pause action: when the monitor belongs to the current work and the platform permits management, actually pause it through the platform and check the returned state. Query that automation if the response is insufficient. If it cannot be identified, permission is missing, or pausing fails, explicitly state that the pause is unconfirmed and what the user needs to do. Stopping chat replies does not stop recurring task triggers. Do not change unrelated or unidentified automations.
- Waiting message: on first entering the wait, explain the blocker, missing material, monitors actually paused, tasks still running, and recovery condition once. Save these details, monitor identifiers, and pause results in existing task records; do not introduce a new formal artifact format.
- Resume condition: on relevant new input or confirmed satisfaction of the prerequisite, reread Runtime state and continue from the latest `continuation`, retaining the change, task identifiers, and completed results. An ordinary progress message does not resolve the blocker or justify redispatching completed work. Resume the relevant monitor only if periodic checks are still needed, and verify that it resumed.
- State distinction: platform idleness or paused monitoring is not Runtime `blocked` / `await-user`. Update Runtime only through an existing public command that applies to this phase and blocker. Otherwise record what blocks the task and pause dependent work. Do not edit state files directly or use Verifier status to represent missing implementation material.

## Fault recovery

On Runtime failure, stop editing the project and rerun `status --details --json` and read-only `doctor`. Execute only recovery actions explicitly returned by `continuation` or `doctor`. Runtime owns portable state, local execution state, locks, and transactions. If safe automatic recovery cannot be established, preserve the workspace and wait for a user decision.

For external-input waits, follow [external input and monitoring](#external-input-and-monitoring) while independent work continues. Before redispatching Supervisor tasks after recovery, read [Supervisor coordination](commands.md#supervisor-coordination). Before relaunching a Verifier, read [Verify protocol](commands.md#verify-protocol) and check current task identifiers, candidate version, and execution state.

### Workspace

`status` searches registered worktrees for the change associated with the current project and branch and returns `workspace.projectRoot`. Enter it and run `select` again. Reuse the located change and workspace; do not copy it or recreate the same name elsewhere.

Runtime blocks writes if project root, branch, workspace type, or Git state disagrees with `comet-state.yaml`. Follow its action if Runtime can safely find or create the declared worktree; otherwise it enters `await-user`. If the original directory or branch is truly lost, the user chooses the recovery location, whether to restore from a trusted backup, or whether to abandon the change.

### Workflow records and local execution

`comet-state.yaml` records the last safely recoverable workflow state. Local `state.json` only describes execution on this machine. If missing, behind, or associated with an old task, Runtime rebuilds it from YAML, the brief, and target Specs. Local state cannot override newer YAML.

- Shape: stay in Shape and continue clarification or confirmation.
- Build: `repairing` means Verify failed and returned to Build. Ordinary changes retain the current iteration and continue implementation. Supervisor Changes use `repair-child` to add a new repair child for unresolved items rather than reopening archived children.
- Verify (`verify-ready`): rerun checks needed for the current implementation and launch a new Verifier; do not reuse passes from the old device.
- Archive (`archive-ready`): safely return to Verify, reset acceptance to `pending`, and assess the implementation synchronized to this device.
- `await-user` / `blocked`: restore the original blocker, responsible party, and allowed actions, then wait for the corresponding condition.
- `done` in active: finish only directory moves and cleanup that can be established safely.
- `done` in archive: show it read-only; the change is finished.

Treat old processes, log connections, and Agent sessions as lost; leftover files do not prove success. If checks ended before YAML recorded them, rerun only safe repeatable checks. Operations that could duplicate external effects require a user decision.

If `verification.md` is missing, its write was interrupted, or `generated_from_state_version` is behind, rebuild only the report from YAML. YAML remains authoritative for recovery; report and state versions must agree before Archive.

Older active changes appear read-only as `migration-required`. Use `doctor --repair` or Runtime's explicit migration command. Preserve old files on migration failure and wait for Runtime's next action.

### Cross-device recovery without chat history

A new device without chat history needs the same synchronized project code, `comet-state.yaml`, brief, and target Specs. Synchronize `.comet/config.yaml` too when the change uses a nondefault artifact directory.

Stop advancement on the old device and finish synchronization first. Git conflicts or different contents for the same state version block progress and require user resolution.

Workflow state cannot recover code that was never synchronized from the old device. The same subagent execution cannot continue across devices. The new device creates local execution from YAML's working directory, iteration, acceptance results, blockers, Builder handoff, and next action. If synchronized implementation is incomplete, the new Verifier identifies the omissions and returns to Build.

Reverification of Verify or Archive-ready work on a new device is recovery; it does not increase iteration, failure, or no-progress counters. The Verifier attempt count increases only when a new Verifier actually launches. Completed Shape and Build are not repeated, and Runtime does not scan the entire project to guess progress.

### Failed Verify and repeated lack of progress

After Verify fails, read failed or blocked acceptance items and failed checks. Make actual repairs before submitting another Builder handoff. Progress requires fewer unresolved problems; changed wording, identical checks, or the same reported cause do not resolve them.

After repeated lack of progress or Verifier execution errors, follow Runtime's blocker-handling action. At `native.max_verify_failures`, wait for the user to continue the current objective, change confirmed requirements, or stop. Verification-failure counts reset after the user confirms a new acceptance list and starts a new objective round.

### Spec and Archive conflicts

If an archived project Spec changes while this change is active, reread that Spec, the brief, and this change's complete target specifications. Revise according to user intent, execute the rebase action in Runtime's conflict response, then implement and verify again. Preserve concurrent additions.

When two active changes modify the same capability, Archive waits for the user to choose which archives first; the other then realigns with the latest Spec.

If Archive or a change-directory move is interrupted, use `doctor` transaction state and allowed actions for recovery. If paths, workflow state, and files disagree, preserve both sides and wait for an explicit recovery action.

If `workspaceFinishResult.status` is `blocked`, Archive or the Git commit may already be complete. Run `recoveryArgs` to inspect actual Git state before deciding the next step.

### Damaged state

- Runtime owns locks; repair only when `doctor` explicitly supplies a command.
- If config, change, brief, Specs, or verification is damaged, preserve original files and wait for `doctor` or the user to identify a recovery source.
- If a change appears in both active and archive, file ownership is unclear, or transaction progress cannot be established, preserve the workspace and stop writes.
