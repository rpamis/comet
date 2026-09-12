# Context Recovery Protocol

Canonical path: `comet-classic/reference/context-recovery.md`

## Phase Entry and On-Demand Recovery

First establish the public CLI and selected workspace using scripts.md. For normal phase handoffs, prefer the successful result's `agent.continuation` and returned entry state. While that information remains valid, do not repeat next, select, or check. Run one entry check only when it is missing or no longer valid:

```bash
comet state check <change-name> <phase> --json
```

Normal and recovery entries return layout, configuration, `configurationReadiness`, nextAction, taskState, coordination, and delivery. An empty `missingFields` and `invalidFields` means the current execution configuration can be reused; ask or repair only the fields listed there instead of querying each field again. taskState is `{authority, revision, total, completed, needsIds, next}`; coordination is `{path, stale, taskIds, stage, sessionId, reviewRounds, unresolved}`. Resolve logical directories through classic-layout.md and enter the actual phase. Do not query summary fields individually. Refresh affected state after state writes or changes to the workspace or requirements.

nextAction is `{kind, reason, taskId?}`. Read reason first, then perform the step indicated by kind: reconcile-task checks actual work; review supplies missing review; checkoff records completion; check supplies missing checks; reconcile-plan supplies legacy-plan task mappings or synchronizes status; plan supplies a valid plan; configure supplies missing configuration; workspace repairs workspace ownership; delivery completes authorized delivery. nextAction does not waive acceptance. Its taskId must identify a task in tasks.md.

Use this recovery entry only when a new session lacks prior context, conversation was compacted, or recovery evidence is insufficient:

```bash
comet state check <change-name> <phase> --recover --json
```

Use the returned recovery summary to identify unfinished steps. Add `--details` only when complete tasks and checkpoints are needed; this adds tasks to taskState and checkpoint to coordination:

```bash
comet state check <change-name> <phase> --recover --details --json
```

Read only content still missing for the current step. Runtime marks check evidence `revalidated` or `rerun-required`; only the former is reusable. If local inputs, environment, logs, or run-specific evidence do not meet reuse requirements, rerun only the affected checks. Preserve the plan, tasks, reviews, and recheck rounds already used.

## Ambient Resume

If Classic was not explicitly invoked but the repository may have an active change, follow scripts.md and pass the current request through stdin to `comet resume-probe . --stdin --json`. Resume automatically only for auto_resume. Ask one short question for ask_user. Do not enter the workflow for out_of_scope/none.

## Entry Errors and Recovery

When commands fail, dependencies are unavailable, state is missing, or artifacts are incomplete, preserve the original error and handle its cause. Automatically recover only when current inputs establish the correct action. Rerun the affected entry check after recovery succeeds.

| Problem                                                                         | Recovery and when to stop                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `comet classic openspec -- list --json` fails                                   | Check OpenSpec installation and the actual command error. If the artifact root is missing or corrupt, explain that `comet update --scope project` / `comet init --scope project` can repair it. Do not interpret command failure as “no active changes,” or upgrade/reinitialize the user's environment without authorization. |
| A Comet/OpenSpec/Superpowers Skill required by the current phase is unavailable | Stop actions that require it. Name the missing Skill and what must be installed or enabled. Plain conversation cannot replace a mandatory Skill, and the selected execution method must not be changed without authorization.                                                                                                  |
| `.comet.yaml` is missing                                                        | Establish workflow from the explicit current choice and verifiable artifacts. Return full to `/comet-open`, and hotfix/tweak to their preset initialization steps, then run `comet state select`. Ask if workflow cannot be established; do not default it to full.                                                            |
| `.comet.yaml` is malformed                                                      | Report the parse error and recover from version control, backup, or verifiable artifacts. Do not overwrite corrupt state with `comet state set` or guess phase from existing files and advance.                                                                                                                                |
| The change directory or required artifacts are incomplete                       | Fill missing files using the current workflow's Open initialization rules and dependencies returned by artifact checks. Preserve valid existing artifacts. Even after files are complete, obtain final user review and confirmation of Open artifacts.                                                                         |
| Workspace binding conflicts or a path escapes its allowed root                  | Check binding and actual paths through workspace.md. When returning to the bound branch or rebinding requires a choice, present valid options and wait for an explicit selection. Stop writes if ownership cannot be established.                                                                                              |
| Build, test, or manual verification fails                                       | Preserve the current change and failure evidence; investigate through debug-gate.md. A Build failure cannot pass the completion Guard into the next phase. Handle Verify failures through its repair/reverification rules; an old pass cannot replace the current failure.                                                     |

## Task Reconciliation and Checkoff

`tasks.md` is the sole authority for task completion; the plan describes implementation. An unchecked task does not justify reimplementation, and a checked task does not replace current acceptance evidence.

1. Use stable task IDs, requirement revision, and the plan's base-ref to reconcile current files, Git diff/commits, check results, reviews, and unresolved feedback. Attribute uncommitted changes through dirty-worktree.md first.
2. If implementation, checks, and required review are satisfied, check off through task-complete without repeating implementation.
3. If implementation is complete but evidence is insufficient, supply only missing checks or independent review. If partially implemented, finish only the remainder. Report missing historical TDD RED honestly; never revert code to fabricate evidence or declare TDD satisfied without it.
4. When evidence does not match current inputs, reverify only affected work and check off after acceptance.
5. Use `comet state task-complete <name> <task-id> --expect <revision> --json`. On a revision conflict, reassess changed requirements rather than merely retrying with the new revision.

When a legacy plan still has task checkboxes, establish the comet-task ID for each. task-complete automatically synchronizes mapped plan tasks from tasks.md. For a separate display update, run:

```bash
comet state sync-plan <name>
```

For `planSync: mapping-required`, add explicit ID mappings and rerun sync-plan without repeating implementation or reassessing already completed tasks. Plan checkboxes are display copies, not another completion authority. Assign stable IDs through tasks --assign-ids when absent. Never guess mappings from order, position, or similar titles. Reconcile scope and add genuine extra legacy-plan tasks to tasks.md. If mappings remain unclear, record unresolved and ask the user; do not delete entries to pass checks. A checked plan alone does not prove implementation.

## Runtime Coordination Records

`state checkpoint` manages `<classic-change-dir>/.comet/coordination.json`; its human-readable Markdown file is `.comet/subagent-progress.md`. `.comet/checkpoint.json` belongs to Engine, not coordination. Never edit or overwrite it manually, or use it as the --file output target.

Do not reread when the entry's coordination summary is sufficient. For the complete record or a state write, use:

```bash
comet state checkpoint <change-name>
comet state checkpoint <change-name> --file <json-path>
```

JSON requires `schemaVersion: 1` and taskIds/revision/stage/sessionId/evidence/unresolved/reviewRounds. Replace the task IDs, revision, and session identifier below with actual current values:

```json
{
  "schemaVersion": 1,
  "taskIds": ["task-1"],
  "revision": "<task-revision>",
  "stage": "implementing",
  "sessionId": "<implementer-session-id>",
  "evidence": [],
  "unresolved": [],
  "reviewRounds": 0
}
```

evidence holds references to actual commits, RED/GREEN results, and review evidence. unresolved holds unresolved issues, not the entire conversation. stage identifies implementation, review, or checkoff work; reviewRounds records rechecks already used. Runtime validates the data and generates Markdown. Do not handwrite subagent-progress.md or treat coordination records as a task-completion list.

Reads return `{checkpoint, stale}`. When stale is true, reconcile revision, task scope, and actual work before repeating any step. An empty checkpoint does not mean implementation is absent. Reread after repairing the record; do not bypass checks by editing internal state.

Before dispatch, save the task scope and coordination-session information. Save sessionId immediately after receiving a subagent session ID, before continuing to wait or process replies. Save new evidence and next steps at handoffs, review completion, acceptance, or blockers. Combine small updates within one step rather than copying every message. If saving fails, stop further dispatch and phase advancement, preserving files for reconciliation.

If records are missing, a session is unavailable, or revision does not match, inspect actual work and rebuild the records needed for recovery. “No checkpoint” does not mean “no implementation.” Preserve valid reviews and recheck rounds already used; a new session does not reset them.

## Phase-Specific Recovery

Obtain current phase, configuration, and nextAction before entering the matching phase Skill. If state and files disagree, resolve the entry's reported problem. File existence alone does not prove phase completion, and phase must not be edited by hand.

- Open: if state is missing, establish workflow and initialize through “Entry Errors and Recovery” above. Repair malformed state from a valid source. Complete artifacts still require checking the user's Open confirmation; files alone cannot advance the workflow.
- Build pause: `build_pause: plan-ready` means the user requested a pause after planning. Reuse valid plan and configuration; clear the pause only after the user explicitly asks to continue. Return to Build's pre-plan configuration step only for missing configuration or an explicit request to change it, confirming the necessary settings together. Recovery does not justify re-asking valid configuration. If the plan is missing, reconcile files and state, repair it, and retain the requested pause.
- Build workspace: for a legacy change missing isolation or a directory mismatch, follow workspace.md to recover Open's workspace resolve/prepare. Do not first choose or switch workspaces in Build.
- Recorded verification failure: `verify_result: fail` automatically invokes `/comet-build` to continue repairing the recorded failure without recording verify-fail a second time. At the automatic-repair limit, or when deviations need acceptance, `/comet-verify` asks how to proceed using the actual failure count.

- Build: continue with valid plan and configuration. Autonomous does not load an external execution Skill; other strategies load methods only when missing from context. Restore the assigned task scope and original implementer session through subagent-dispatch.md. In subagent-driven-development, the main session does not take over implementation. After all tasks finish, return to Build exit checks; do not restore obsolete Build final-review/final-fix steps.
- Design: continue clarifying unconfirmed proposals. For confirmed designs, supply only the formal Design Doc or unfinished state writes. Read brainstorm-summary.md and one Markdown handoff as needed; Runtime normally validates machine JSON without rereading the entire context.
- Verify: reconcile the report, actual diff, and valid review evidence. Supply missing checks or affected reviews without restarting the phase from scale assessment.
- Archive: normal entry and delivery reads do not access the network. Use `comet state delivery <change-name> --verify` to check Git, remote, and PR state read-only, and identify authorization and actual results from `{delivery, verification}`. Do not archive or commit again when already done, or repeat completed pushes or PR creation. handled does not prove authorization or delivery success. Follow Archive confirmation rules when records are missing or targets change.
