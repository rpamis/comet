# Native command and execution reference

Runtime no longer uses PID, process creation identity or thread binding to decide recovery. Process exit releases the local transaction lock; retire legacy lock metadata once after confirming the original operation stopped. Preserve the original Run, actual results and logs after interruption. For unknown outcomes, inspect side effects and explicitly confirm stopping before reconciling the original Action. Do not kill historical PIDs or automatically replay commands. Removing PID eliminates that recovery dependency; partially completed Git or file operations still require reconciliation.

Read only the sections needed for the current operation. Supervisor coordination, memory integration, and exception handling each have their own triggers.

## SDK Run

### Task results

Claim ordinary or Supervisor tasks in a new built-in SDK Run with `comet native next <change> --session <actual-session-id> --json`, including Shape preparation. A `comet.native.task-result.v1` response supplies `task`, `resultTemplate`, and `next.commandArgs`; `--details` includes the full SDK projection. The result file contains actual `status`, `output`, and applicable business fields. `--action` binds the original task and `--session` binds its actual claimant. Use a temporary UTF-8 JSON file outside formal artifacts. Without Git tracking information, place it outside the project so it cannot become a candidate input.

For `shape.prepare`, the Agent derives acceptance from formal documents and submits `output.acceptance` using `resultTemplate`, with actual `source` and `text` for each item. Sources are the brief or declared target Specs; CLI assigns stable acceptance IDs. Freeform documents need no fixed headings. Present the complete proposal and obtain user confirmation after submission.

Supervisor fields `task.child`, `task.scope`, and `workspace.projectRoot` identify the actual execution scope. Select among `availableTasks` and claim with the real session. Child acceptance covers assigned criteria; parent acceptance covers all confirmed requirements. Integration repair uses the integration workspace. An independent Verifier does not automatically claim implementation or integration repair.

For ordinary, Child, and parent tasks, the Agent executes checks with platform tools, reads actual results, and records commands, directories, results, and log references in checks name/result/note. The Builder submits implementation and results together. Ordinary Verifier results use output.checks; Child Verifier results use evidence.checks. Checks may be empty, but failed or unrun checks cannot count as passing; the reviewer judges whether evidence is sufficient. Do not submit verificationChecks, integrationChecks, request-checks, or custom receipts for v4. Runtime does not repeat ordinary checks. Older business data is adapted automatically, retaining approvals, tasks, and candidates; use current report templates. `--review current-session` claims Verify with the current actual session. `--review independent` leaves it pending for a separate receiver, who supplies their own session identity in the returned command. Explicit user requests for independent review require that choice. Execute only the current next step and retain all acceptance text.

Verify submission normally stops for user acceptance. Add `--accept-on-pass <authorization-summary>` only when the user explicitly delegated acceptance and Archive after all criteria pass. Runtime binds the summary to the current passing result and confirmation, then archives. Git merge, push, PR, and cleanup keep their own authorization requirements. The existing `--accept-result` proposal binding remains in effect. Repeated results use the original Action and identical content; wrong sessions, conflicting results, and candidate drift follow the existing Runtime rejection rules.

The lower-level protocol below is for older Runs, fixed applications, specific failures, or debugging. Continue directly when the high-level response supplies the required information.

Use this section when the current response has `runtimeFormat: sdk`, or `data.schema` is `comet.native.sdk-status.v1`, `comet.native.dispatch-result.v1`, or `comet.native.run-view.v1`. Identify the current response directly without another status query. Use its `data.run.id` or `data.runId`; current `pendingActions`, `activeActions`, `action`, and `stateVersion` determine work. Claim responses already include Action input and outcome templates; use them directly, retrieving details only when necessary content is missing. Save SDK requests as temporary UTF-8 JSON and submit through `comet runtime dispatch --application native --project-root <projectRoot> --request <file>`. Keep requests out of artifacts, commits, and reports. After `status: succeeded`, verify the same Action's claim or persisted outcome identity. Idempotent acknowledgment of the same claim or outcome may retain the original revision; success does not require another state change. Continue with the returned identity and continuation.

### Shape and Runtime Actions

Ordinary `status` reads current business state. Use `--details` or `doctor` for historical execution records. Continue from the current response and read recovery instructions when an actual error occurs. The local SDK Run records every transition. Portable checkpoints are written at user waits, Agent handoffs, and terminal boundaries. Internal steps without external effects do not require projection synchronization. External command execution still records its recovery boundary. Do not edit checkpoints to advance the workflow.

After a passing Verify result, new Runs wait directly for acceptance while the Runtime generates the reading report. If report writing fails, follow the warning or retry `next`, preserving the saved verification result. After acceptance, ordinary Archive preparation validates the candidate and actual inputs. Candidate changes require fresh handling. Supervisor delivery retains its own execution steps.

Complete the formal brief and target Specs, then run `comet native next <change> --json` until `shape.confirm` or `supervisor.shape.confirm` appears in `run.waits`. Present the full Shape; for Supervisor also present the Child plan and ask whether to use multiple or one session. After explicit confirmation, execute the current `continuation.commandAlternatives` with its state version and expected action. Re-propose when the Agent identifies a material change to goals, acceptance, or authorization. Each later `next` runs authorized internal Actions until a user decision, Agent task, failure, or unknown result. Use `pendingActions` for the entire queue; `pendingAction` is only the first. Claim and report `build.builder`, `verify.verifier`, `supervisor.child.builder`, `supervisor.child.verifier`, `supervisor.child.integration-repair`, and `supervisor.parent.builder` as described below. Children may work concurrently, but integration Actions and result submissions run serially in Run order. Refresh Actions, Waits, and state after every submission.

On definitive Child verification failure, repair in its original worktree and submit a new candidate with platform checks and acceptance results. Inspect unknown results through the original platform. Resolve Git integration conflicts or interruption with the same Action and original merge workspace without replaying unknown merges. Runtime still validates actual commits, branches, and ancestry.

If parent verification definitively fails, or the user rejects the parent result, the Run creates another `supervisor.parent.builder`. Repair in the original integration worktree and report a new `candidateCommit`. Runtime binds later checks, verification, and delivery to that commit. Even if code did not change, submit a new Builder result and checks; do not reuse the old candidate's acceptance.

### SDK Action claims and outcomes

Before Builder starts an iteration or an independent Verifier starts, copy the current Action's `claimRequest`, fill the receiving session and preserve the supplied stable claim token, and submit `claim`. Independent claims validate `actionId`, `attempt`, and `inputHash`; do not add an old global revision. Progress by another task does not require redispatching this one. Include `operation: "claim"`, `runId`, `actionId`, `attempt`, `inputHash`, `executorId: "native-host"`, `sessionId`, and a unique `claimToken` stable across recovery. Use a platform session or task ID; if unavailable, use a stable execution reference and do not imply that it authenticates the executor. Work only after that Action is returned as `running` with the matching claim. If another executor holds it, investigate that work instead of claiming or starting it again.

When the claim response provides `resultRequest`, preserve its complete `receipt` and fill only `result.status` and the actual business `result.output`. Submit through the same dispatch command; do not assemble Action identity fields or generate an outcome ID. Repeating identical results uses the original receipt. Legacy `outcomeRequest` remains supported; do not mix the two input forms. Preserve the prefilled claim token and supply the actual session ID. Runtime supplies the submission time. Optional `addressedAcceptanceIds` records this iteration’s focus; omission does not mean every acceptance item was changed.

For legacy responses without `resultRequest`, submit `record-outcome` after completion with the same `runId`. The outcome contains the original `actionId`, `attempt`, `inputHash`, `claimToken`, a unique `outcomeId`, the real `status`, and `output`. Never report unfinished, unexecuted, or unknown work as `succeeded`. Continue only after SDK validates and stores the receipt.

### SDK Builder handoff

New Run Builder results support the optional boolean `requireIndependentReview`. Set it to `true` when the user requires independent review or the Agent has chosen a separate reviewer. Runtime stores this requirement with the actual Builder result, and later claims cannot cancel it by omitting options. The ordinary high-level `--review independent` command saves the same requirement. Supervisor Children and the parent use this choice too. Older Runs whose templates omit the field retain their existing requirements. Every reviewer remains read-only and claims with their actual session identity. Same-session conclusions are labeled `self-reviewed`.

Complete `build.builder` and `supervisor.parent.builder` with the actual `summary`, actual `checks` (each with `name`, `result`, `note`) and `knownLimits`. When the current template omits `acceptanceReview`, submit these fields and perform full item-by-item acceptance in Verify. Older templates requiring the review need one `{id,status,evidence,note}` per acceptance ID, with `implemented-with-evidence` and nonempty evidence before submission. An explicitly supplied review must still be complete and truthful.

Follow [ordinary commands and checks](../../comet/reference/platform-execution.md). Use platform tools, inspect original tasks and side effects, judge result applicability, and submit actual reports. Comet does not repeat checks or maintain ordinary-command content snapshots, supervision, or recovery. Do not submit `request-checks`, command plans, or ordinary check receipts.

### SDK Verify protocol

Select the `verify.verifier` or `supervisor.child.verifier` executor from the current `sessionRequirements.independent`. When false, the current session may claim it. Choose an independent review according to uncertainty, the value of cross-checking, and user requirements. When true, a session different from the Builder must claim it. All verification remains read-only. When arranging a separate reviewer, supply the current candidate ID, acceptance items and references, workspace, and actual check report locations, and have it claim using its actual session identity. Platform dispatch alone means dispatched, not confirmed started. On a wait-tool timeout, continue tracking the same task. The Verifier evaluates every current acceptance item. Successful output includes the current `candidateId`, the same `verifierExecutionRef` used at claim, and a `response`: `final-result` for a complete verdict; actual checks go in `output.checks` (Child: `evidence.checks`). Collect missing evidence through platform tools while retaining the same review task.

Submit `status: "failed"` with a truthful nonempty `summary` only when the platform confirms that the Verifier did not start, failed, timed out, was lost, or ended without a usable result. SDK keeps the candidate and completed checks and creates a limited number of replacement Actions. At the limit, await a user decision. If a required independent session is unavailable, stop and report. Always report the actual verification outcome.

### User decisions, Archive, and recovery

At `verify.confirm`, show the actual verdict and wait for the user. Use the current `run.waits[].proposalHash`, `stateVersion`, and `--expected-action` with `native next <change> --accept-result|--revise-implementation --summary <text> --proposal-hash <hash> --expected-state-version <n> --expected-action <action>`. Runtime binds acceptance to the current candidate and structured verification result. New Runs treat the Markdown report as a reading view; old Runs keep the original report and execution association without revalidating file bytes. For changed requirements or acceptance criteria, explain Shape reconfirmation and, after explicit choice, use `native next <change> --revise-requirements --summary <text> --expected-state-version <n> --expected-action revise-requirements`. This versioned SDK command replaces unclaimed work; it does not use the Verify proposal hash. Do not reuse acceptance for the new Shape. Revision also applies in Archive before `archive.execute` succeeds, but not afterward. At `verify.retry`, use `--retry-verifier` with the same guards only after the user chooses to retry; retain the candidate and valid checks.

In Archive, directly execute the `native archive <change> --json` command returned by the current continuation. Runtime advances `archive.prepare`, `archive.execute`, and `archive.finalize` together where safe, retaining each Action’s real outcome. Use `native archive <change> --dry-run --json` only for preview or diagnosis. Follow the latest continuation after each call; do not repeat Archive on a fixed schedule or replay an old state version. Supervisor also schedules `supervisor.cleanup`: Runtime removes only the Child and integration worktrees created for this Run when the target branch still points to the accepted commit, the temporary worktrees are clean, and their branches have been merged. Preserve a dirty worktree or an unknown outcome and reconcile the original Action; do not force removal. Declare SDK archive complete only when the Run is `completed` and business state is `done`. Merge, push, PR, and non-Supervisor temporary workspace cleanup still require separate authorization and verification; SDK archive alone does not prove external delivery is complete.

After interruption, read `native status <change> --details --json` and use SDK `inspect` when necessary. A pending Action can continue. For a `running` or `unknown` host Action, inspect the original platform session, task handle, and `claimToken`. The original claimant reports a known actual outcome. Reopen through SDK `retry`/reconciliation only with authoritative evidence that the work did not execute. Otherwise preserve the state and report the blocker; do not redispatch side-effecting work. Original Runtime `continuation` and `--runner-input` instructions do not apply to an SDK Run. If the entire local Run history is missing, follow the explicit restoration steps in the main Skill.

If a Builder partially executed and its original Action has a recorded `failed` outcome, preserve the workspace and that failure. Do not reconcile the Action as "not executed" or redispatch it yourself. Run `native next <change> --json` and read the matching `build.resume`, `supervisor.child.resume`, or `supervisor.parent.resume` Wait from `pendingBuilderDecisions`. Explain the partial changes, failure, and risk of continuing to the user first. After an explicit decision to continue, fill in `--summary` in its `commandArgs`, retain the proposal hash, state version, and expected action, and execute `--continue-builder`. Runtime creates a new Builder Action bound to the failed one. Claim and continue that new Action in the original workspace, then rerun checks and verification. While the user has not decided or the proposal is stale, stop and inspect the current Run again; leave the original failure unchanged.

If `supervisor.parent.deliver`, `archive.execute`, `archive.finalize`, or `supervisor.cleanup` is the only `unknown` Action and the original execution process is confirmed stopped, run `native archive <change> --recover --json`. Delivery recovery reports the outcome against the original Action only when the target branch still points exactly to the verified integration commit. It rejects a target that has not received the commit or has moved since delivery; it does not repeat the fast-forward. Archive and cleanup recovery verify the original claim, durable evidence, and worktrees, complete any remaining safe work, and report against the same Action. Recovery does not create another attempt. If evidence is insufficient, a worktree has uncommitted changes, or the original process may still be running, preserve the state and resolve those facts first. After success, refresh the Run and handle any newly pending Action.

## Memory integration

When a claim response includes `data.contextDelivery`, read `data.context[].text` and start work without executing `contextRequest` again. `empty` means no new delivery; continue the explicit task after `unavailable`. Use `data.contextActions.expand` for full text, `data.contextActions.restore` after context loss, and `data.contextActions.complete` with an actual learning file at completion. New Agents use their own session IDs rather than another executor’s context receipts.

Without automatic delivery, after entering the change workspace and obtaining its current `phase`, prefer the current task packet's `contextRequest`, including Compat `supervisorTask.contextRequest`; use `continuation.contextRequest` when no task-specific request exists. SDK Builders, Verifiers and children use the `contextRequest` of their corresponding `pendingActions[]` or `activeActions[]`, after the receiver successfully claims the Action. Supply the original user request and the receiving Agent's own stable session ID. If the original request is missing, first recover the goal from the current brief.

Read a full snapshot once on first entering a phase, handing off to a new Agent, or recovering after context compression or in a new session. For older responses without `contextRequest`, use:

```text
comet task <project-root> --task "<original user request>" --phase "<phase>" --session "<receiving Agent stable identifier>" --context-mode snapshot --json
```

Add the returned JSON `context[].text` to context. A snapshot returns the currently applicable content even when this session received it before; repeated retrieval does not imply repeated use or successful execution. `manifest` (`<context_manifest>` in injected text) is the Context Manifest: a list of context items containing only summaries, reasons for use, and stable IDs.

When the task needs full text, sources, or verification methods, run `comet task <project-root> --task "<original user request>" --phase "<phase>" --session "<same identifier>" --expand-context "<id>" --json`. Reuse context during uninterrupted work in the same phase. When paths or operations change, retain the session ID and retrieve with the new `--path` and `--operation`; the default incremental mode returns applicable content not yet delivered for that context.

Include the receiver's `contextRequest` in handoffs, preserving the user's wording, applicability and sources. Give Verifiers applicable verification preferences, project constraints and objective evidence; do not pass Builder self-assessment as a verdict. Use the host's actual Skill loading interface for applicable Skill preferences, and explain unavailable Skills, conflicts with current instructions or incompatibility with a read-only role. Check context delivery, Skill loading and actual compliance separately. Skills do not replace Runtime checks, user authorization or independent verification. Continue with explicit instructions after empty or failed retrieval, without retry loops or workflow rollback caused by changed retrieval results.

If `<active_policies>` includes `<verification command="...">`, include those commands in current Verify checks and record actual results. Runtime makes the policy mandatory only after its command executes successfully.

Save memory as follows:

When this task has reusable observations or lessons, use [Task learning completion](../../comet/reference/task-learning.md): prepare one learning file and use `comet task --complete --learning-file <file>` to submit personal observations, project lessons, pending review decisions, and actual-use feedback together. The separate save, review, and completion commands below remain available for immediate saves, individual corrections, and older versions; do not repeat them when using a learning file.

- When the user explicitly asks to remember a preference or project convention long term, call `comet memory remember <project-root> --text "<preference or convention>" --scope global|project --json` to save it immediately as explicit user memory. Add repeatable `--phase` only when the user explicitly limits applicability, for example `--phase build --phase verify`. Correct phase applicability with `comet memory correct <project-root> --id <id> --phase <phase> --json`. Preserve the user's wording; do not automatically limit a preference to the current phase.
- Only when the user has not requested long-term memory, but a collaboration practice is stable and reusable in future tasks, call `comet memory observe <project-root> --text "<collaboration practice>" --workflow <workflow> --change <change-id> --candidate-key <stable-topic-key> --json`.
- Neither command may save task summaries, implementation progress, command output, or test results.

### Project memory

Project Memory is separate from Personal Memory. Before task completion, write facts, decisions, patterns, procedures, constraints, or failure resolutions that are verified in the current project and reusable in future tasks:

```text
comet knowledge remember <project-root> --title "<concise title>" --text "<symptom, approach, verification>" --type <fact|decision|pattern|procedure|constraint|failure-resolution> --workflow native --change <change-id> --evidence "<source files, comma-separated>" --json
```

The same title updates the existing entry instead of creating a duplicate. Skip the write when nothing is reusable. `--evidence` binds project files that support the conclusion; omit it for collaboration decisions without file evidence. The returned `slug` is the write receipt. Before applying an existing lesson, expand it with the same task arguments plus `--expand-context "project-memory:<slug>"` and check its current sources. Verify and update the lesson when a source changes or becomes unreadable. Never save task summaries, one-off command output, or unverified guesses.

Only explicit user corrections, long-term memory requests, or verified reusable lessons trigger learning submissions. Otherwise record task completion using `not-run` learning markers, without querying queues or submitting empty reviews to prove there is no observation. Preserve actual submission receipts. Pending review and reflection queues remain for asynchronous maintenance, and learning failures do not block completed development work. Query and process relevant queues when the user explicitly requests memory maintenance.

The observation JSON `learning.result` reports `candidate-created`, `candidate-promoted`, `deduplicated`, `ignored`, or `skipped`. `status.learning.lastCheck: not-run` means the host did not submit this task's learning check; it does not mean that no reusable information exists.

After actually using an item, obtain its identifier from JSON `applications[].applicationId` (`application_id` in Hook text). Once the outcome is known, record it with `comet task <project-root> --task "<original user request>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`. Never report successful use of an unused item.

If verification, compilation, or linting fails, address the error and rerun. At task completion, call `comet task <project-root> --task "<original user request>" --complete --workflow native --change <change-id> --learning-check submitted|no-observation|not-run --project-learning-check submitted|no-observation|not-run [--memory <slug>] --json` to record completion. The two checks cover Personal Memory and project experience independently. An unavailable command, empty result, or failed automatic retrieval does not block the task. On platforms without Hooks, this Skill calls the same interfaces; `comet memory context` is a compatibility entry only.

## User Hook writes

The Comet Hook Router only checks write targets; it does not replace or invoke a project's other Hooks. Writes outside the project are allowed without Comet attribution. When a user Hook writes shared project files during Shape, Verify, or Archive, configure a dedicated directory in `.comet/config.yaml`:

```yaml
hook:
  allow_paths:
    - .my-hook-output
    - docs/team-notes
```

Paths are project-relative directories; the directory and its descendants are allowed, and the setting is shared by Native and Classic. Explicitly configured paths do not require a current change selection when several changes are active. `.comet/config.yaml` is also a permitted control write.

`.comet/`, `native.artifact_root/comet/`, and Classic workflow artifact roots remain workflow-owned and cannot be bypassed through `allow_paths`. If one Hook event contains multiple targets, every non-allowlisted target still goes through phase checks; keep user Hook output in a dedicated directory.

Native formal artifacts may be created only after `comet native new <name> --json` registers the change. Runtime initializes the brief; edit the corresponding files using `artifacts.briefPath`, `artifacts.specsDir`, and the other returned paths. A rejection names the reason, wrong target, correct target, and next action: run the supplied CLI command or correct the original target and retry. Do not search other directories for same-named files or classify custom Hook and ordinary development files as Comet-owned.

When the user explicitly wants to revoke a capability association, first run `comet native status <change> --json`, then use `data.stateVersion` from that latest response in `comet native spec disassociate <change> --expected-state-version <data.stateVersion> --expected-action disassociate-capability`, and follow the new continuation. For any other association-file write intent, query status without guessing revocation; do not remove the file manually.

## Filling command inputs

Runner templates in this section apply only to Compat. SDK uses the Action protocol above and current `claimRequest` / `outcomeRequest`, without `--runner-input`.

Read this section before first filling a Runtime template or returning a result through `returnAction`.

Copy `inputOptions.template` into a system temporary JSON file, replace only the requested values, then execute `continuation.commandArgs` or the selected `commandAlternative.commandArgs`. Delete the temporary file after Runtime accepts the input; retain rejected input, correct it as directed, and resubmit. Preserve all supplied iteration, attempt, state-version, and task identifiers exactly; fill only fields exposed by the template.

Options in the same `exclusiveGroup` within `inputOptions` are mutually exclusive. Choose one and place its `template` in the temporary file as a single JSON object. On validation failure, correct that file using the JSON paths, missing fields, and unknown fields listed in `error.issues`.

Supervisor children work only in the task package's `projectRoot` and return their completed result to the parent. The parent submits results in sequence through the controller directory, original command, and template specified by `returnAction`, preserving the original `runId`, candidate, and actual child session. Children do not write parent state directly.

Submit directly once the template is filled completely; Runtime validates the input on submission, so no pre-check pass is needed. Use `comet native next <change> --runner-input <file> --validate-only --json` only when a submission was rejected and you need to distinguish a JSON structure error from a business validation error; it does not write workflow state (comet-state.yaml) or start checks. Actual submission must still use the state version, task identifiers, and arguments in the current `continuation`.

### Enumerated input values

Template placeholders and validation errors list every legal value for the fields below. Each set belongs to that field only; never reuse a value from one field for another.

| Input                                | Field                          | Legal values                                                                               |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `builder-handoff`                    | `checks[].result`              | `passed` / `failed` / `not-run` — development checks the Builder ran or did not run        |
| `builder-handoff`                    | `acceptance_review[].status`   | `implemented-with-evidence` / `implemented-no-evidence` / `not-implemented` / `known-fail` |
| `builder-handoff`                    | `review.status`                | `passed`                                                                                   |
| `verifier-response` (`final-result`) | `result.verdict`               | `pass` / `fail` / `blocked` — the Verifier's overall verdict                               |
| `verifier-response` (`final-result`) | `result.acceptance[].result`   | `passed` / `failed` / `blocked` — one result per acceptance item                           |
| `supervisor-verifier-result`         | `verdict`                      | `pass` / `fail` / `blocked`                                                                |
| `supervisor-verifier-result`         | `evidence.acceptance[].result` | `passed` / `failed` / `blocked`                                                            |

Per-item results and Builder check results use the past tense (`passed`, `failed`); the overall verdict uses the base form (`pass`, `fail`). `not-run` exists only for Builder development checks, `blocked` only for Verifier fields, and `pending` is an internal Runtime state that never appears in an input.

## Builder handoff

Compat only. SDK uses [SDK Builder handoff](#sdk-builder-handoff) and the current `outcomeRequest`.

Read this section before submitting `builder-handoff`.

An ordinary change or Supervisor parent does not need an additional read-only review before Verify. If a separate read-only review already exists, the Runtime template accepts optional `review.status=passed`, `review.summary`, and `review.reviewer_execution_ref`. The review execution identifier must differ from the Builder's.

The Builder handoff must describe this iteration's changes, acceptance items addressed, development checks actually run and not run, and known limitations. An earlier review cannot replace the formal Verifier, which still independently assesses every acceptance item.

Before handoff, review the current brief, complete target Specs, and every confirmed acceptance ID, then fill `acceptance_review` from the Runtime template with exactly one entry per ID. Preserve each template `id`, report `status` truthfully, list specific file locations, check records, or reproducible observations in `evidence`, and explain how the implementation satisfies the item in `note`. Submit only when every item is `implemented-with-evidence` with nonempty evidence. `implemented-no-evidence`, `not-implemented`, and `known-fail` mean missing evidence, missing implementation, and a known failure; complete that work before submitting a candidate for verification. Repair templates retain prior evidence for unaffected items and request current evidence for affected items. Before submission, check every entry still applies and update invalidated evidence. Prefilled content is not a new check result. Self-review does not establish independent acceptance.

Runtime saves the summary in `comet-state.yaml`, not a separate file; it does not mean acceptance has passed. Submit it once; Runtime passes necessary summaries to the Verifier.

Complete when implementation and relevant checks are ready for verification, all acceptance items have been rechecked, and Runtime accepts the handoff and enters Verify.

Follow [ordinary commands and checks](../../comet/reference/platform-execution.md). Use platform tools, inspect original tasks and side effects, judge result applicability, and submit actual reports. Comet does not repeat checks or maintain ordinary-command content snapshots, supervision, or recovery. `builder-handoff.checks` records actual results and log references without executing commands.

## Verify protocol

Compat only. SDK uses [SDK Verify protocol](#sdk-verify-protocol); the claim receipt replaces `startupInput`, without a legacy Runner response.

Read before launching, adding checks for, or waiting on a Verifier. Follow [filling command inputs](#filling-command-inputs) for submissions.

### Platform tasks and task package

Retain `verifierDispatch` working directories, candidate ID, Verifier reference, acceptance items, and brief/Spec references. Read all `scopeIds` pages when text is missing. Use platform tools to start the required read-only task and report `verifier-started` with the actual session. This registers business work without supervising processes. After platform acceptance, follow that task; a wait-tool timeout does not establish execution failure. Follow [ordinary commands and checks](../../comet/reference/platform-execution.md). Use platform tools, inspect original tasks and side effects, judge result applicability, and submit actual reports. Comet does not repeat checks or maintain ordinary-command content snapshots, supervision, or recovery.

### Independent acceptance and results

The Verifier remains read-only and first submits the package's `startupInput` (`verifier-started`; repeated submission has no side effect). Read all current-scope acceptance text, the brief, complete target Specs, implementation, and actual check reports. Confirm the candidate, workspace, inputs, and coverage. Use platform tools to collect necessary checks; independently assess each item in `scopeIds`.

Read the Builder handoff last, as investigation leads. The Builder provides only implementation locations, acceptance IDs and references, check-record locations, known limitations, and relevant file locations. Read log bodies on demand.

A wait-tool timeout means keep waiting for the same Verifier. Record an execution error and retry only after the platform confirms execution failure, an execution timeout, a lost task, or completion without a usable result.

For `verifier-response`, submit this result shape: The response lists only the current `scopeIds` and marks each scenario exactly once as `passed`, `failed`, or `blocked`. Give a concrete reason for failed or blocked items. Runtime filters a known superset only when the extra criteria already passed and still report `passed`; nonexistent IDs, duplicates, missing scope IDs, and out-of-scope `failed` or `blocked` results remain invalid.

When a result or check request is rejected for fields, format, or acceptance scope, correct the original input and resubmit through the returned current `continuation`. Keep the active Verifier; do not report `verifier-execution-error` or redispatch it. For candidate or execution-binding mismatches, first check the dispatch identity; never relabel an old task's result as a new task's result. Actual check execution failures and platform task failures still follow their corresponding failure paths.

After submission of a repaired implementation, retain still-valid actual check reports; a new formal Verifier then assesses every scenario in one round. Once all pass, wait directly for user acceptance. Do not automatically clear results and add another identical full verification round.

Distinguish inability to complete verification:

- If the platform supports subagents but this task did not start, failed, timed out, or ended without returning a result, report `verifier-execution-error`.
- Report `verifier-unavailable` only when the platform truly has no available subagent capability.
- When Runtime waits on Verifier unavailability, use the `retry-verifier` alternative if the user requests a retry. Use `confirm-verifier-unavailable` only after explicit acceptance of a result without independent verification. Retrying retains current code and completed checks; do not ask the user to restore files, services, processes, or callbacks.

Before handling launch failure, execution error, missing external information, or a decision to accept incomplete verification, read [command inputs and exceptions](#command-inputs-and-exceptions), then follow the latest `continuation`.

After a Skill-launched final Verifier passes and Runtime waits for a decision, use `--accept-result` to enter Archive only when the user accepts the current result. Use `--revise-implementation` for implementation changes or `--revise-requirements` for changed acceptance criteria.

### Interrupted checks

Follow [ordinary commands and checks](../../comet/reference/platform-execution.md). Use platform tools, inspect original tasks and side effects, judge result applicability, and submit actual reports. Comet does not repeat checks or maintain ordinary-command content snapshots, supervision, or recovery. Legacy `retry-checks` no longer executes commands. Failed, timed-out, unrun, and unknown work cannot pass. Completion means Runtime accepted the full result and returned the actual Build, Archive, wait, blocked, or terminal state.

## Supervisor coordination

Compat `childSummary`, `readyChildren`, and Runner packages only. SDK children, integration, and recovery follow the [SDK Run](#sdk-run) Action protocol.

Read before dispatching, receiving results, or integrating. Read [filling command inputs](#filling-command-inputs) before first filling input or executing `returnAction`.

### Dispatch and task identifiers

One confirmed Supervisor Shape authorizes every child within confirmed scope; do not ask for that scope again. Execute only actions returned in Runtime's `continuation`, rereading `readyChildren` after each task completes. Each child must progress through `active → verified → integrated`; a failed verification, a recorded lost-Verifier failure, or a contract revision touching an existing candidate moves the child to `needs-reverify`, and Runtime redispatches its Verifier automatically on the next `next` call (counted as blocked in `childSummary`). The Supervisor parent then verifies every acceptance item in the integration worktree.

When handling `childSummary`, do not run the Supervisor Change Builder. Handle only ready children listed in `readyChildren` and Supervisor coordination actions. When tasks are in flight, `readyChildren` lists those in-flight tasks; once capacity frees, the next `next` call dispatches remaining ready children automatically. Read details only when a child's complete state is needed.

For each child, Runtime returns its worktree, the integration branch's current commit, role, task package, and `runId`. Builder and Verifier results must carry the current `runId`; Runtime rejects duplicate or obsolete task results. After interrupted child checks, reconcile the original platform task and any side effects before deciding which checks need to run again.

Children do not run Archive separately. Runtime now owns the integration step formerly performed through `finish=merge`. Integration is complete only after `active → verified → integrated` and successful minimal integration checks. An Agent's completion claim or uncommitted work in a worktree does not prove integration.

In multi-session mode, the current session only dispatches, monitors progress, addresses blockers, integrates, and performs final Supervisor Verify. It does not implement child tasks. A child that edits files must use its Runtime-created worktree; do not create another for the same child or write into the Supervisor or another child's worktree.

Each dispatch must identify the role, task package, worktree, baseline commit, `runId`, acceptance IDs and references, dependencies, and stopping conditions, and require results to return to the parent for sequential submission. The parent claims with the actual recipient's session and preserves the original Action, claim identity, and result template. Children write only their own worktrees and do not advance the parent Run directly. Start only tasks in `readyChildren`; independent-session Agents and team members may not claim children whose prerequisites are unmet. Monitor progress throughout execution. Promptly report and address implementation drift, permission or environment blockers, unclear scope, or new decisions affecting user-visible outcomes; do not wait until all tasks end.

- While waiting for external input, read [external input and monitoring](recovery.md#external-input-and-monitoring). Silence in chat does not pause monitoring. Keep only monitors that still have runnable work or external state to check, and explain blockers and recovery conditions promptly.
- In Codex, when user-visible independent sessions can be managed, create one for each ready child instead of using only subagents within the current session. Use the existing project when creating a session; do not let Codex create another worktree. The new session must first enter Runtime's child worktree, and all subsequent file and Git operations stay there. Save session information, wait on or read sessions to monitor progress, and send follow-up instructions when correction or added context is needed.
- In Claude Code, create a Claude Code Agent Team when available in an interactive session. The current session coordinates; assign each ready child to a clearly named team member. Members enter Runtime's child worktree. Add only Runtime-ready children to the team task list; Runtime remains authoritative for readiness and completion. Members must not create another Claude Code Agent Team, integrate the parent branch directly, or expand scope. Continue reading messages and task state and provide timely guidance.
- If Codex independent sessions or a Claude Code Agent Team are unavailable, or original sessions or teams are missing after recovery, reread Runtime state, explain the reason, and switch to a subagent under `multi-session`; do not ask for the coordination mode again. Prepare undispatched children from the latest `readyChildren`. When a dispatched task's session is lost, run `next --summary` to obtain complete task packages (including `runId`, worktree, and base commit) for every in-flight task, then use the original platform to check whether the original execution and its descendants have stopped. An inaccessible session or a rejected late result does not prove that execution has stopped. Only after the platform confirms that the original execution and its descendants have stopped may you submit `supervisor-cancel` with the current `runId`, obtain a new package and `runId` from the latest `continuation`, and dispatch to a subagent. If stopping cannot be confirmed, preserve the original `runId` and worktree, report the blocker and the required evidence of stopping, and wait for reconciliation; do not cancel or redispatch the task or continue modifying that worktree. If subagents are also unavailable, report the actual execution blocker; do not automatically switch to single-session progression.

### Final Supervisor verification

Once every child is `integrated`, immediately follow Runtime's `parentAdvance` and tell the user the Supervisor Change is entering final Verify. Do not require another “continue.” Final verification covers every acceptance item in the integration worktree.

After failed acceptance, the Agent chooses the repair arrangement; the parent may repair its integration scope or add a uniquely named repair child referencing valid acceptance IDs. Preserve actual failures and budgets without reopening archived or integrated children. Explicitly use the returned --revise-requirements when revising the plan, present the full proposal, and obtain confirmation. File edits do not automatically return the change to Shape.

Do not modify the target branch before final delivery. Final Archive, workspace finishing, merge, push, and PR creation each still require the relevant user authorization.

### Child verification and integration

Retain the original `child`, `runId`, candidate, and actual worktree. Submit actual implementation, checks, and per-item acceptance. `supervisor-verifier-result` uses `pass`, `fail`, or `blocked`; evidence contains an actual summary, checks, and each `{id,result,reason}` exactly once with a consistent overall verdict. Do not submit ordinary check `receiptRef` or content snapshots.

SDK Git integration follows the current Action. For Compat, use platform tools in the specified integration worktree to merge and run checks, then submit the actual `integrationCommit` and report through `supervisor-integrate`. Without a real commit it returns platform instructions, without executing checks or claiming success. Preserve conflicts in the original workspace. Parent verification still covers all requirements.

## Command inputs and exceptions

SDK reconciles the same Action, claim, and outcome through [SDK Run](#sdk-run) and the current continuation. Runner templates, `verifier-unavailable`, and `--finish` below apply only to Compat.

For normal flow, execute the commands Runtime supplies in `continuation`. During recovery, `next --summary` without action input returns the current template and preserves the phase; fill that template directly without another status query. This section explains returned fields and handles rejected input, unavailable Verifiers, Verifier execution errors, missing external information, and decisions to accept results without complete independent verification. `continuation.disposition` says whether to continue, wait for the user, address a blocker, or finish. Execute commands containing `--confirmed` only after explicit user confirmation. CLI text begins with a readable `summary`, a single `NEXT:`, and optional `RELAY TO USER:`. Use `--json` for structured responses; use `--verbose` only to diagnose local execution.

The CLI is authoritative for command signatures and current arguments:

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

### Runtime's next action

- `disposition`: whether to continue, wait, handle blockers, or finish. When `requiresUserDecision` is true, relay the message and wait for a decision. `userCommunication.required` may only require a recovery update; then continue within existing authorization.
- `commandArgs` / `commandAlternatives`: complete command arguments. Each alternative represents a mutually exclusive user decision; execute the matching one and do not combine alternatives.
- `inputOptions`: fields and JSON templates to fill for this command.
- `workspace` / `preparation`: the actual working directory and change-creation result.
- `stateVersion` / `loop`: current state version and acceptance-loop progress.
- `acceptance` / `childSummary` / `readyChildren` / `supervisor` / `details.nextPageArgs`: acceptance counts, child counts, ready children, integration-branch and current task-package summaries, and the next detail-page command.
- `verifierDispatch`: workspace and evidence locations, current `scopeIds`, `scopeCount`, total acceptance count, content references, detail pagination arguments, review summary, and check results for independent Verifier dispatch. Pass any `recoveryContext` directly as the latest recovery or user-provided information.
- `workspaceFinishResult` / `recoveryArgs`: post-Archive workspace result and recovery commands.

At Archive-ready, follow the latest continuation. If an isolated workspace has no selected finish action, wait for the user, then execute the complete matching `--confirmed --finish` alternative, retaining its state-version arguments. Runtime saves the choice, performs preflight, and revalidates inside the transaction. Reuse a finish choice made when accepting the result without asking again. Use dry-run when a custom commit message needs previewing; do not append other arguments yourself. The dry-run checks both archive content and the branches and files involved in Git finishing. On `ready: false`, address `blockers` and the complete `workspaceFinishBlockers[].paths` list from that same response; do not add a `status` query or manually commit change state/verification files. Only on `ready: true` execute the single returned `archive --confirmed` command.

Angle brackets in templates mark values to fill. `await-user` means wait for the user's decision before running advancement commands. If `commandArgs` is `null` and `commandAlternatives` is present, obtain the decision first, then execute the selected alternative's complete `commandArgs`, retaining `--expected-state-version` and `--expected-action`. If stale state or a mismatched action rejects the command, reread the latest `continuation` and follow current state; do not construct commands without state guards. Inspect task liveness through the original platform; missing local files do not establish whether execution continues.

### Exception action inputs

- `verifier-execution-error` / `verifier-unavailable`: use the former when subagents are supported but the task did not start, failed, timed out, or ended without a result; use the latter only when no subagent capability is actually available. Preserve task-association fields in templates so late messages from old tasks cannot affect a new Verifier.
- `retry-verifier` / `confirm-verifier-unavailable`: Runtime supplies these alternatives for Verifier unavailability. Select the former when the user requests a retry; code and completed checks are retained. Select the latter only after explicit acceptance of automated checks without independent verification.

### Exceptions

- Cannot launch an independent Verifier: first confirm applicable checks are listed and every Runtime check passes. Then report unavailable through its template and wait for the user to decide whether to accept command checks without independent requirements assessment.
- Verifier cannot yet judge (`semantic blocked`): if only user or external information is missing, execute Runtime's resolution action; if implementation changes are needed, return to Build.
- A Skill-launched Verifier passes every item (`skill-coordinated pass`): checks are complete, but the system cannot establish verifier independence. Runtime asks the user to confirm the verification result; execute the returned command only after confirmation.
- A message that full verification could not be completed and only automated checks ran means there was no independent requirements assessment. Archive requires explicit user acceptance.
- A message that the user accepted incomplete verification records that acceptance only; do not claim independent verification was completed.
- A Verifier task reports `execution error`: submit the error through its template and read the new `continuation`. The Agent decides which results remain applicable to the current candidate and whether to retry.

### Diagnostics

Update formal project Specs through the current change's complete target Specs and Archive; do not directly edit published Specs.

Use `spec sync` only to correct local Markdown link targets in confirmed target Specs:

- Input contains `expectedStateVersion`, `actor`, `reason`, `affectedAcceptanceIds`, and `replacements: [{from, to}]`.
- `affectedAcceptanceIds` must contain all acceptance items from affected Specs. Changes to body text, examples, or acceptance meaning still require Shape.
- Runtime records before/after content and reasons, retains unaffected verdicts, and returns to Build to reverify affected content.
- If the process stops before state is saved, recovery detects the mismatch between Specs and saved state and returns to Shape. Unsaved corrections cannot count as confirmed results.

For a lost Verifier, recover through ordinary `next --summary`. Runtime returns recovery guidance (await-user) and does not change state automatically; record `verifier-execution-error` as directed before Runtime returns interrupted work to a verifiable boundary. Do not wait forever on the old Verifier task and do not rerun `next` in a loop.

Read state in the original worktree using the returned explicit directory; Runtime does not search other worktrees automatically. If active and archive records conflict in the current workspace, follow read-only diagnostics and an explicit recovery entry. A matching name or higher version alone does not prove completion.

Run read-only `doctor` first. Apply a repair only when `doctor` explicitly returns its command. Runtime maintains portable business state and actual file transactions; ordinary workflows do not recover locks.

The Agent judges whether previous check results apply to the current candidate and environment, retains actual execution sources, and runs only missing or invalidated checks. Submit reports with the current result template, without old check plans, file fingerprints, or edit-review records.
