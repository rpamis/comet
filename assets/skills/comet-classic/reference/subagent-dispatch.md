# Comet Subagent Development Rules

Canonical path: `comet-classic/reference/subagent-dispatch.md`

Read for `build_mode: subagent-driven-development`, or when autonomous needs delegation or review. The former loads the matching Superpowers Skill before applying these rules; autonomous applies them directly without an external execution Skill. Classic defines the execution method, task acceptance, recheck limits, and five-phase completion. External Skills return to comet-build after execution, without adding final review or invoking finishing-a-development-branch.

## Check Tasks Before Starting

1. Read the plan, confirmed design, and configuration from `comet state check <name> build --json` once. Refresh relevant material after scope, file, or configuration changes.
2. Perform one plan preflight: the plan must not contradict specifications, acceptance, or global constraints. Investigate questions answerable from the repository; batch user questions for conflicts affecting goals or authorization.
3. Use the entry task summary first. Run `comet state tasks <name> --json` only for individual requirements and IDs. `tasks.md` is the sole completion authority; select task IDs by dependency, not line number, order, or mutable title.
4. For `needsIds: true`, run `comet state tasks <name> --assign-ids --json` and refresh affected handoff and mappings. Preserve existing IDs. Reconcile legacy checkboxes with actual implementation, checks, and review under context-recovery.md, then synchronize explicit ID mappings. Unchecked items do not trigger reimplementation; genuine extra tasks are not silently discarded.

The main session coordinates dispatch, integration, and acceptance without concurrently editing an active implementer's scope. Under subagent-driven-development it does not implement tasks itself. Autonomous may implement after explicitly withdrawing delegation, inspecting existing work, and saving a checkpoint. Continue after work is visible in the current workspace and accepted, without asking between tasks. Stop affected work for a user-requested pause, unclear authorization, or the blockers below.

## Grouping and Assigning Tasks

Assign tasks by independently acceptable outcomes. Related tasks in the same module, with shared local context and known dependencies, may form a clearly scoped group completed consecutively by one implementer. Specify taskIds, allowed scope, execution order, acceptance requirements, and reporting times when assigning it. Do not mechanically limit groups to 2–3 small tasks or add tasks to one session indefinitely.

A task group does not change task IDs. Report, accept, and check off each ID; one passing task does not complete the whole group. thorough permits implementer reuse but retains independent per-task review. Pause affected tasks on scope changes, dependency conflicts, or new risks. Reconcile completed work before adjusting subsequent assignments; do not silently add tasks.

Reuse an implementer within its assigned group; return fixes to the original session first. Save a checkpoint and end reuse when tasks cross modules or scope changes substantially, context pressure prevents reliable retention of constraints, the session cannot be recovered, or two consecutive reports repeat the same blocker without new implementation/evidence. Investigate before recovery and hand off only unfinished tasks and feedback. Do not create unlimited new sessions for repeated review. Reviewers remain independent of implementers; an implementer cannot review its own code. Subagents do not nest dispatch; the main session coordinates it.

## Handoff and Evidence

Send only what the current task needs: task ID and full requirement, plan/design references, allowed scope, dependency interfaces, configured artifact language, required checks, and the report format. Use file handoff supported by the external Skill for long requirements, reports, and feedback. Retain paths and necessary summaries in the main session rather than repeatedly pasting accumulated history. Follow user/platform model configuration and assign roles by available capabilities, not fixed model names.

Implementers report `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`, with files, commit references, check commands and actual results, unfinished work, and risk signals per task ID. They implement and self-test, but do not check off tasks. The main session confirms files and commits are visible in the current workspace before acceptance; integrate isolated copies first.

With `tdd_mode: tdd`, implementers and fix agents provide genuine, cause-matched RED failure and GREEN success commands and summaries. Autonomous does not require an external TDD Skill; other strategies load test-driven-development in the independent context. Do not reload intact context. Complete verifiable missing checks and honestly report historical gaps; never revert code to fabricate RED. Direct does not require per-task RED/GREEN, but still requires relevant checks and bug-regression evidence.

## Risk and Recheck Limits

Assess risk further for cross-module coordination; authentication, authorization, cryptography, SQL, external input or credentials; concurrency, locks, shared mutable state; data/schema migration; public API changes; or DONE_WITH_CONCERNS. The main session checks actual diff against self-report. More than 200 lines prompts complexity inspection but does not determine risk alone. Mechanical/generated changes do not automatically escalate; their source logic, installation behavior, and runtime interface requirements still require review.

| `review_mode` | Build Task Review                                                                              | Rereview Limit After Fixes |
| ------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| `off`         | No automatic reviewer                                                                          | 0                          |
| `standard`    | Risk tasks only; one reviewer checks specification compliance and code quality                 | 1 round                    |
| `thorough`    | Independent review of specification compliance and code quality for each task, accepted per ID | 2 rounds                   |

These arrangements replace the external Skill's default review steps rather than adding another review process. Initial review reads actual requirements, diff, and evidence, not just implementation summaries. Rechecks cover unresolved findings, fixes, and new risks without repeating all requirement analysis or resetting rounds already used. Check whether trustworthy existing results still apply; add checks only for insufficient evidence, changed inputs, or new risks.

Reviewers remain neutral; do not prohibit findings in advance. Resolve CRITICAL/IMPORTANT issues; after exhausting rereview rounds, record `BLOCKED` and return the decision to the user. `off` does not waive test failures, the Debug Gate, or explicit user requests. Close a finding as already satisfied only after actual inspection, recording rationale rather than optimistic inference.

## Accept Tasks and Save Progress

Follow the schemaVersion:1 JSON example in context-recovery.md and save coordination with `comet state checkpoint <name> --file <json-path>`. Runtime validates and generates Markdown; do not manually maintain subagent-progress.md. Read `{checkpoint, stale}` and inspect actual work when stale. Persist before dispatch, after receiving the session ID, and at review/acceptance/blocked boundaries. Ordinary reports may be coalesced; never redispatch accepted members. Checkpoints are not a second completion list.

Reversible implementation decisions within specifications may be made autonomously. Save decisions affecting subsequent work, their rationale, and task IDs in `<classic-change-dir>/.comet/rulings.md`; preserve necessary conclusions and evidence references before upstream temporary files are cleaned. Expanding scope, changing specifications or acceptance, accepting important defects, security exceptions, and external side effects still require user authorization. Temporary sessions or upstream internal directories cannot be the sole recovery source.

After per-task acceptance under the configuration, use the inspected revision to record completion:

```bash
comet state task-complete <name> <task-id> --expect <revision> --json
```

This command records completion; it does not replace acceptance. If changed requirements cause rejection, reread tasks and affected design and reassess, rather than blindly retrying with a new revision. Completion-only changes do not alter revision; the command may be retried idempotently. Follow existing commit policy without mechanical per-microtask progress commits.

After all tasks are accepted, immediately return to `comet-build` exit checks. Build does not add a whole-branch reviewer; `comet-verify` performs the only final integrated review under review_mode, then Archive closes the workflow.

## Interrupted Recovery

Obtain current entry state through context-recovery.md. Read `comet state checkpoint <name>` only when coordination summaries are insufficient; load referenced rulings as needed. Reconcile revision, actual commits, files, and evidence, then resume the original step with valid reviews and previously used recheck rounds intact.

- For unchecked but implemented tasks, verify acceptance without reimplementing; committed but unaccepted tasks remain incomplete.
- Restore only unaccepted tasks in the assigned group. tasks.md remains authoritative; mapped legacy plan checkboxes only display its completion state.
- Reconcile mapping and impact when tasks are deleted, renamed, or changed. Missing mapping cannot be guessed as the first unchecked task.
- If checkpoints are missing, inspect the working tree and history first. Dispatch implementation only for confirmed missing work; no checkpoint does not mean no implementation.
- Record dispatch/session failures and stop the affected loop, then follow recovery without silently changing the selected strategy.
- Return to comet-build when all tasks are complete; do not restore old Build final-review/final-fix states.
