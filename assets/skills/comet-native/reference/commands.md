# Native command and execution reference

Read only the sections needed for the current operation. Supervisor coordination, memory integration, and exception handling each have their own triggers.

## Memory integration

After entering the change workspace and reading Runtime's current `phase`, the Agent automatically runs once:

```text
comet task <project-root> --task "<original user request>" --phase "<phase>" --session "<stable task identifier>" --json
```

Add only the returned JSON `text` to context. `manifest` (`<context_manifest>` in injected text) is the Context Manifest: a list of context items containing only summaries, reasons for use, and stable IDs.

When the task needs full text, sources, or verification methods, run `comet task <project-root> --task "<original user request>" --phase "<phase>" --session "<same identifier>" --expand-context "<id>" --json`. When paths, operations, or phase change, retain the same `--session` and retrieve again with the new `--path`, `--operation`, and `--phase`; unchanged items are not returned again.

If `<active_policies>` includes `<verification command="...">`, include those commands in current Verify checks and record actual results. Runtime makes the policy mandatory only after its command executes successfully.

Save memory as follows:

- When the user explicitly asks to remember a preference or project convention long term, call `comet memory remember <project-root> --text "<preference or convention>" --scope global|project --json` to save it immediately as explicit user memory.
- Only when the user has not requested long-term memory, but a collaboration practice is stable and reusable in future tasks, call `comet memory observe <project-root> --text "<collaboration practice>" --workflow <workflow> --change <change-id> --candidate-key <stable-topic-key> --json`.
- Neither command may save task summaries, implementation progress, command output, or test results.

After actually using an item, obtain its identifier from JSON `applications[].applicationId` (`application_id` in Hook text). Once the outcome is known, record it with `comet task <project-root> --task "<original user request>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`. Never report successful use of an unused item.

If verification, compilation, or linting fails, address the error and rerun. At task completion, still call `comet task <project-root> --task "<original user request>" --complete --workflow <workflow> --change <change-id> --json` to record completion. An unavailable command, empty result, or failed automatic retrieval does not block the task. On platforms without Hooks, this Skill calls the same interfaces; `comet memory context` is a compatibility entry only.

## Filling command inputs

Read this section before first filling a Runtime template or returning a result through `returnAction`.

Copy `inputOptions.template` into a system temporary JSON file, replace only the requested values, then execute `continuation.commandArgs` or the selected `commandAlternative.commandArgs`. Delete the temporary file after the command completes. Preserve all supplied iteration, attempt, state-version, and task identifiers exactly; fill only fields exposed by the template.

Options in the same `exclusiveGroup` within `inputOptions` are mutually exclusive. Choose one and place its `template` in the temporary file as a single JSON object. On validation failure, correct that file using the JSON paths, missing fields, and unknown fields listed in `error.issues`.

Supervisor children work in the task package's `projectRoot`. Return results through the controller directory, command, and template specified by `returnAction`.

After copying Runner input, you may validate its JSON structure with `comet native next <change> --runner-input <file> --validate-only --json`. This does not write state or start checks. Actual submission must still use the state version, task identifiers, and arguments in the current `continuation`.

## Builder handoff

Read this section before submitting `builder-handoff`.

An ordinary change or Supervisor parent does not need an additional read-only review before Verify. If a separate read-only review already exists, the Runtime template accepts optional `review.status=passed`, `review.summary`, and `review.reviewer_execution_ref`. The review execution identifier must differ from the Builder's.

The Builder handoff must describe this iteration's changes, acceptance items addressed, development checks actually run and not run, and known limitations. An earlier review cannot replace the formal Verifier, which still independently assesses every acceptance item.

Runtime saves the summary in `comet-state.yaml`, not a separate file; it does not mean acceptance has passed. Submit it once; Runtime passes necessary summaries to the Verifier.

Complete when implementation and relevant checks are ready for verification, all acceptance items have been rechecked, and Runtime accepts the handoff and enters Verify.

## Verify protocol

Read before launching, adding checks for, or waiting on a Verifier. Follow [filling command inputs](#filling-command-inputs) for submissions.

### Check plan and task package

An ordinary change may submit an empty command-check list after confirming no applicable checks exist. The Supervisor parent must supply at least one integration check; `cwdRef` is relative to the integration workspace. Runtime executes and records acceptance checks. Development checks listed in the Builder handoff explain the implementation but do not replace formal check results.

Pass these `verifierDispatch` directories and references unchanged when launching the Verifier:

- `projectRoot`: the controller directory for Native commands.
- `verificationRoot`: the workspace containing the candidate; the Supervisor parent uses the integration workspace.
- `changeDir`: the base directory for relative `briefRef` and `specRefs[].ref` paths.
- `supervisorStateRef`: the local state file with child acceptance and integration records; `null` for ordinary changes.

Pass any `recoveryContext` unchanged too; it contains the latest recovery or user-provided information. `detailsPageArgs` already includes `--project-root`; retain it when querying from any directory. After additional checks run, return Runtime's results and handoff information to the current Verifier and keep waiting for its final result.

When Runtime requests `dispatch-verifier`:

1. Fill `inputOptions.template` with the tests and checks needed for this candidate, for Runtime to execute. A Runtime check receipt records the result and its candidate, workspace, and input associations. Successful checks are reusable on the same candidate, workspace, and machine when inputs are unchanged and receipts are complete.
2. After interrupted checks, retry only the repeatable checks listed by the latest `continuation` action `retry-checks`. Do not treat assertion failures or nonrepeatable checks as environment failures to retry automatically.
3. Read `verifierDispatch` for workspace and check-record locations, `scopeIds`, acceptance count, brief/Spec references, detail pagination arguments, optional review summary, and check results. The package does not inline every acceptance text; use pagination to read every scenario covered by `scopeIds`.
4. Immediately launch a new read-only Verifier subagent through the platform's native capability. Pass directories, check-record locations, and any `recoveryContext` unchanged. If subagents are unavailable, a separate Agent session from the Builder is allowed only when the user selected multi-session coordination and the platform can manage independent sessions. Otherwise report Verifier unavailability as specified below and follow the latest `continuation`.

`dispatch-verifier` registers the attempt and returns its package and attempt identifier. It does not start an independent service or process, and requires no service address or callback. Verifier results must return this package's `candidateId` and `verifierExecutionRef` unchanged. Runtime rejects late results for older candidates or Verifier tasks.

### Independent acceptance and results

The Verifier remains read-only throughout. First read the scenarios identified by current `scopeIds`, the brief, complete target Specs, actual implementation, and Runtime check results. Confirm that recorded checks match the current candidate, workspace, and inputs and cover all acceptance items. Add only missing or invalidated checks through `inputOptions.template` for Runtime to execute. Independently assess every acceptance item regardless of check reuse.

Read the Builder handoff last, as investigation leads. The Builder provides only implementation locations, acceptance IDs and references, check-record locations, known limitations, and relevant file locations. Read log bodies on demand.

A wait-tool timeout means keep waiting for the same Verifier. Record an execution error and retry only after the platform confirms execution failure, an execution timeout, a lost task, or completion without a usable result.

For `verifier-response`, mark each scenario in current `scopeIds` exactly once as `passed`, `failed`, or `blocked`. Give a concrete reason for failed or blocked items so the next Build can address them.

After submission of a repaired implementation, Runtime retains still-valid check receipts and a new formal Verifier assesses every scenario in one round. Once all pass, wait directly for user acceptance. Do not automatically clear results and add another identical full verification round.

Distinguish inability to complete verification:

- If the platform supports subagents but this task did not start, failed, timed out, or ended without returning a result, report `verifier-execution-error`.
- Report `verifier-unavailable` only when the platform truly has no available subagent capability.
- When Runtime waits on Verifier unavailability, use the `retry-verifier` alternative if the user requests a retry. Use `confirm-verifier-unavailable` only after explicit acceptance of a result without independent verification. Retrying retains current code and completed checks; do not ask the user to restore files, services, processes, or callbacks.

Before handling launch failure, execution error, missing external information, or a decision to accept incomplete verification, read [command inputs and exceptions](#command-inputs-and-exceptions), then follow the latest `continuation`.

After a Skill-launched final Verifier passes and Runtime waits for a decision, use `--accept-result` to enter Archive only when the user accepts the current result. Use `--revise-implementation` for implementation changes or `--revise-requirements` for changed acceptance criteria.

### Retrying interrupted checks

- `retry-checks`: retry only checks Runtime marks interrupted and repeatable for the current candidate. Copy the latest continuation's `check_ids`; do not replace commands or the candidate. Each check may execute at most three times. Successful results and valid logs are retained.

Complete when Runtime accepts the complete Verifier result and explicitly enters Build, Archive, `await-user`, `blocked`, or `done`.

## Supervisor coordination

Read before dispatching, receiving results, or integrating. Read [filling command inputs](#filling-command-inputs) before first filling input or executing `returnAction`.

### Dispatch and task identifiers

One confirmed Supervisor Shape authorizes every child within confirmed scope; do not ask for that scope again. Execute only actions returned in Runtime's `continuation`, rereading `readyChildren` after each task completes. Each child must progress through `active → verified → integrated`. The Supervisor parent then verifies every acceptance item in the integration worktree.

When handling `childSummary`, do not run the Supervisor Change Builder. Handle only ready children listed in `readyChildren` and Supervisor coordination actions. Read details only when a child's complete state is needed.

For each child, Runtime returns its worktree, the integration branch's current commit, role, task package, and `runId`. Builder and Verifier results must carry the current `runId`; Runtime rejects duplicate or obsolete task results. After interrupted child checks, retry only repeatable checks for this candidate listed in the latest template's `retry_check_ids`; do not repeat successful checks.

Children do not run Archive separately. Runtime now owns the integration step formerly performed through `finish=merge`. Integration is complete only after `active → verified → integrated` and successful minimal integration checks. An Agent's completion claim or uncommitted work in a worktree does not prove integration.

In multi-session mode, the current session only dispatches, monitors progress, addresses blockers, integrates, and performs final Supervisor Verify. It does not implement child tasks. A child that edits files must use its Runtime-created worktree; do not create another for the same child or write into the Supervisor or another child's worktree.

Each dispatch must identify the role, task package, worktree, baseline commit, `runId`, acceptance IDs and references, dependencies, and stopping conditions. Start only tasks in `readyChildren`; independent-session Agents and team members may not claim children whose prerequisites are unmet. Monitor progress throughout execution. Promptly report and address implementation drift, permission or environment blockers, unclear scope, or new decisions affecting user-visible outcomes; do not wait until all tasks end.

- While waiting for external input, read [external input and monitoring](recovery.md#external-input-and-monitoring). Silence in chat does not pause monitoring. Keep only monitors that still have runnable work or external state to check, and explain blockers and recovery conditions promptly.
- In Codex, when user-visible independent sessions can be managed, create one for each ready child instead of using only subagents within the current session. Use the existing project when creating a session; do not let Codex create another worktree. The new session must first enter Runtime's child worktree, and all subsequent file and Git operations stay there. Save session information, wait on or read sessions to monitor progress, and send follow-up instructions when correction or added context is needed.
- In Claude Code, create a Claude Code Agent Team when available in an interactive session. The current session coordinates; assign each ready child to a clearly named team member. Members enter Runtime's child worktree. Add only Runtime-ready children to the team task list; Runtime remains authoritative for readiness and completion. Members must not create another Claude Code Agent Team, integrate the parent branch directly, or expand scope. Continue reading messages and task state and provide timely guidance.
- If Codex independent sessions or a Claude Code Agent Team are unavailable, or original sessions or teams are missing after recovery, reread Runtime state, explain the reason, and automatically switch to a subagent under `multi-session`; do not ask for the coordination mode again. Prepare undispatched children from the latest `readyChildren`. A dispatched task whose session is lost is not complete: submit `supervisor-cancel` with its current `runId`, obtain a new package and `runId` from the latest `continuation`, then dispatch to a subagent. Runtime rejects late results from the old execution. If subagents are also unavailable, report the actual execution blocker; do not automatically switch to single-session progression.

### Final Supervisor verification

Once every child is `integrated`, immediately follow Runtime's `parentAdvance` and tell the user the Supervisor Change is entering final Verify. Do not require another “continue.” Final verification covers every acceptance item in the integration worktree.

On failure, retain conflicting files and blockers. Do not reopen archived or `integrated` children. Follow `repair-child`: add the actual failed Spec acceptance text to v2 `acceptance_index`, append a uniquely named repair child, reconfirm Shape, then continue.

Do not modify the target branch before final delivery. Final Archive, workspace finishing, merge, push, and PR creation each still require the relevant user authorization.

### Child verification and integration

- Supervisor task responses use `supervisor-builder-result`, `supervisor-builder-failure`, `supervisor-checks`, `supervisor-verifier-result`, `supervisor-reconnect`, `supervisor-cancel`, and `supervisor-integrate`. Builder, Verifier, check, reconnect, and cancel actions retain the current package's `runId`. Use `comet native next <change> --max-parallel 1` for sequential execution when needed; the default limit is 2.

The child Verifier submits checks and acceptance results as follows:

1. Read the package's `acceptance`, `contractHash`, and `verificationBoundary`, then submit `supervisor-checks`. Input fields are `kind`, `child`, `runId`, `checks` (a nonempty Runtime check plan with `repeatable: true`), and `materials` (possibly empty, with each item `{name, content}`). After interruption, use `retry_check_ids` from the latest template.
2. Runtime executes checks in the committed child candidate's clean workspace and returns `checkExecution.status` and `operationId`, followed by `receiptRef` when complete. The receipt is Runtime's saved check-result record, identifying the implementation, workspace, and inputs used.
3. Reuse the existing check operation or receipt when candidate, workspace, machine, inputs, and tool environment are unchanged. After interruption, retry only listed repeatable checks, retaining passed checks and valid logs; each check may execute at most three times. Failure or interruption does not count as passed.
4. Save external report content snapshots through `materials`. Ordinary file paths and verbal reports are investigation leads, not formal check results.
5. Submit `supervisor-verifier-result`: `verdict` is `pass`, `fail`, or `blocked`; `evidence` contains `summary`, `checks` (informal notes), `receiptRef`, and `acceptance` (each item `{id, result, reason}`). Every task-package acceptance ID must occur exactly once, and the overall verdict must agree with item results. Runtime receipts are authoritative for formal checks. For fail or blocked, `receiptRef` may be null. Correct omissions and contradictions using the actual error; never invent passed items.

Use `supervisor-integrate` without `runId`. Its `checks` must be a nonempty executable Runtime plan with `repeatable: true`, not a declaration that checks passed. After interruption, use only `retry_check_ids` for this candidate. Runtime merges child commits into the integration workspace and runs the checks; it records `integrated` only when all pass. The Supervisor parent still performs final verification of every acceptance item after children pass.

Runtime can validate saved check records and their candidate, workspace, machine, and input associations. The execution platform still owns write-permission isolation for ordinary external files.

## Command inputs and exceptions

For normal flow, execute the commands Runtime supplies in `continuation`. This section explains returned fields and handles rejected input, unavailable Verifiers, Verifier execution errors, missing external information, and decisions to accept results without complete independent verification. `continuation.disposition` says whether to continue, wait for the user, address a blocker, or finish. Execute commands containing `--confirmed` only after explicit user confirmation. CLI text begins with a readable `summary`, a single `NEXT:`, and optional `RELAY TO USER:`. Use `--json` for structured responses; use `--verbose` only to diagnose local execution.

The CLI is authoritative for command signatures and current arguments:

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

### Runtime's next action

- `disposition`: whether to continue, wait, handle blockers, or finish. When `userCommunication.required` is true, relay the message and wait before any confirmation command.
- `commandArgs` / `commandAlternatives`: complete command arguments. Each alternative represents a mutually exclusive user decision; execute the matching one and do not combine alternatives.
- `inputOptions`: fields and JSON templates to fill for this command.
- `workspace` / `preparation`: the actual working directory and change-creation result.
- `stateVersion` / `loop`: current state version and acceptance-loop progress.
- `acceptance` / `childSummary` / `readyChildren` / `supervisor` / `details.nextPageArgs`: acceptance counts, child counts, ready children, integration-branch and current task-package summaries, and the next detail-page command.
- `verifierDispatch`: workspace and evidence locations, current `scopeIds`, count, content references, detail pagination arguments, review summary, and check results for independent Verifier dispatch. Pass any `recoveryContext` directly as the latest recovery or user-provided information.
- `workspaceFinishResult` / `recoveryArgs`: post-Archive workspace result and recovery commands.

At Archive-ready, first execute continuation's `archive --dry-run`. If an isolated workspace has no selected finish action, use the complete matching `--dry-run --finish` command in `commandAlternatives`. Do not append `--finish` yourself or execute `--confirmed` directly. The dry-run checks both archive content and the branches and files involved in Git finishing. On `ready: false`, address `blockers` and the complete `workspaceFinishBlockers[].paths` list from that same response; do not add a `status` query or manually commit change state/verification files. Only on `ready: true` execute the single returned `archive --confirmed` command.

Angle brackets in templates mark values to fill. `await-user` means wait for the user's decision before running advancement commands. If `commandArgs` is `null` and `commandAlternatives` is present, obtain the decision first, then execute the selected alternative's complete `commandArgs`, retaining `--expected-state-version` and `--expected-action`. If stale state or a mismatched action rejects the command, reread the latest `continuation` and follow current state; do not construct commands without state guards. `localExecution: absent` means this machine has no currently running execution, not that the change is damaged.

### Exception action inputs

- `verifier-execution-error` / `verifier-unavailable`: use the former when subagents are supported but the task did not start, failed, timed out, or ended without a result; use the latter only when no subagent capability is actually available. Preserve task-association fields in templates so late messages from old tasks cannot affect a new Verifier.
- `retry-verifier` / `confirm-verifier-unavailable`: Runtime supplies these alternatives for Verifier unavailability. Select the former when the user requests a retry; code and completed checks are retained. Select the latter only after explicit acceptance of automated checks without independent verification.

### Exceptions

- Cannot launch an independent Verifier: first confirm applicable checks are listed and every Runtime check passes. Then report unavailable through its template and wait for the user to decide whether to accept command checks without independent requirements assessment.
- Verifier cannot yet judge (`semantic blocked`): if only user or external information is missing, execute Runtime's resolution action; if implementation changes are needed, return to Build.
- A Skill-launched Verifier passes every item (`skill-coordinated pass`): checks are complete, but the system cannot establish verifier independence. Runtime asks the user to confirm the verification result; execute the returned command only after confirmation.
- A message that full verification could not be completed and only automated checks ran means there was no independent requirements assessment. Archive requires explicit user acceptance.
- A message that the user accepted incomplete verification records that acceptance only; do not claim independent verification was completed.
- A Verifier task reports `execution error`: submit the error through its template and read the new `continuation`. Runtime decides which checks to reuse and whether to retry.

### Diagnostics

Update formal project Specs through the current change's complete target Specs and Archive; do not directly edit published Specs.

Use `spec sync` only to correct local Markdown link targets in confirmed target Specs:

- Input contains `expectedStateVersion`, `actor`, `reason`, `affectedAcceptanceIds`, and `replacements: [{from, to}]`.
- `affectedAcceptanceIds` must contain all acceptance items from affected Specs. Changes to body text, examples, or acceptance meaning still require Shape.
- Runtime records before/after content and reasons, retains unaffected verdicts, and returns to Build to reverify affected content.
- If the process stops before state is saved, recovery detects the mismatch between Specs and saved state and returns to Shape. Unsaved corrections cannot count as confirmed results.

For a lost Verifier, recover through ordinary `next --summary`. Runtime returns interrupted work to a state that can be verified again; do not wait forever on the old Verifier task.

When locating state across worktrees, Runtime checks active and archive records. It uses the archived state only when change-creation information and committed Git history prove that the archived record supersedes the active one. Handle conflicts from actual records; a matching name or higher version alone does not prove completion.

Run read-only `doctor` first. Apply a repair only when `doctor` explicitly returns its command. Runtime continues to own locks, portable state, and transactions.
