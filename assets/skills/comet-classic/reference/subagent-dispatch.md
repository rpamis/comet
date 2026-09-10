# Comet Extensions for Subagent-Driven Development

Canonical path: `comet-classic/reference/subagent-dispatch.md`

Read for `build_mode: subagent-driven-development`, or when autonomous needs delegation/task review. The former loads the matching Superpowers Skill before applying this contract; autonomous applies it directly without mandatory external execution Skills. Classic owns the execution method, task acceptance, review budget, and five-phase closure. External Skills return to comet-build after execution, without final review or finishing-a-development-branch.

## Start and Task Identity

1. Read the plan, confirmed design, and configuration from `comet state check <name> build --json` once. Refresh relevant material after scope, file, or configuration changes.
2. Perform one plan preflight: the plan must not contradict specifications, acceptance, or global constraints. Investigate questions answerable from the repository; batch user questions for conflicts affecting goals or authorization.
3. Use the entry task summary first. Run `comet state tasks <name> --json` only for individual requirements and IDs. `tasks.md` is the sole completion authority; select task IDs by dependency, not line number, order, or mutable title.
4. For `needsIds: true`, run `comet state tasks <name> --assign-ids --json` and refresh affected handoff and mappings. Preserve existing IDs. Reconcile legacy checkboxes with actual implementation, checks, and review under context-recovery.md, then synchronize explicit ID mappings. Unchecked items do not trigger reimplementation; genuine extra tasks are not silently discarded.

The main session coordinates dispatch, integration, and acceptance without concurrently editing an active implementer's scope. Under subagent-driven-development it does not implement tasks itself. Autonomous may implement after explicitly withdrawing delegation, inspecting existing work, and saving a checkpoint. Continue after work is visible and accepted without asking between tasks. Stop for user pause, genuine authorization ambiguity, or the blocking conditions below.

## Dispatch Unit

Dispatch independently acceptable outcomes by default. Related tasks in the same module with shared local context and known dependencies may form a bounded work package for one implementer. Fix taskIds, allowed scope, execution order, acceptance points, and reporting boundaries at dispatch. Do not mechanically restrict packages to 2-3 microtasks or allow sessions to grow indefinitely.

A work package is not a new task identity. Report, accept, and check off each ID; one passing member does not complete the package. thorough permits implementer reuse but retains independent per-task review. Pause affected members on scope changes, dependency conflicts, or new risks. Reconcile completed work before adjusting subsequent packages; do not silently add tasks.

Reuse an implementer across tasks within its package; return fixes to the original session first. Save a checkpoint and end reuse when module/scope boundaries change substantially, context pressure prevents reliable retention of constraints, the session is unavailable, or two consecutive reports repeat the same blocker without new implementation/evidence. Investigate before recovery; hand off only unfinished members and feedback rather than creating unlimited sessions that consume review budget. Reviewers remain independent of implementers; do not reuse an implementation role for self-review. Subagents do not nest dispatch; the main session coordinates it.

## Handoff and Evidence

Send only what the current task needs: task ID and full requirement, plan/design references, allowed scope, dependency interfaces, configured artifact language, required checks, and reporting contract. Use upstream-supported file handoff for long requirements, reports, and feedback; retain paths and necessary summaries rather than repeatedly pasting accumulated history. Follow user/platform model configuration and choose roles by available capabilities, not mandated model names.

Implementers report `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`, with files, commit references, check commands and actual results, unfinished work, and risk signals per task ID. They implement and self-test, but do not check off tasks. The main session confirms files and commits are visible in the current workspace before acceptance; integrate isolated copies first.

With `tdd_mode: tdd`, implementers and fix agents provide genuine, cause-matched RED failure and GREEN success commands and summaries. Autonomous does not require an external TDD Skill; other strategies load test-driven-development in the independent context. Do not reload intact context. Complete verifiable missing checks and honestly report historical gaps; never revert code to fabricate RED. Direct does not require per-task RED/GREEN, but still requires relevant checks and bug-regression evidence.

## Risk and Review Budget

Risk signals: cross-module coordination; authentication, authorization, cryptography, SQL, external input or credentials; concurrency, locks, shared mutable state; data/schema migration; public API changes; DONE_WITH_CONCERNS. The main session checks actual diff against self-report. More than 200 lines prompts complexity inspection but does not determine risk alone. Mechanical/generated changes do not automatically escalate; their source logic and install/runtime contracts still require review.

| `review_mode` | Build Task Review                                                                              | Rereview Limit After Fixes |
| ------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| `off`         | No automatic reviewer                                                                          | 0                          |
| `standard`    | Risk tasks only; one reviewer checks specification compliance and code quality                 | 1 round                    |
| `thorough`    | Independent review of specification compliance and code quality for each task, accepted per ID | 2 rounds                   |

This budget replaces upstream default reviewer nodes rather than adding a second review loop. Initial review reads real requirements, diff, and evidence, not just implementation summaries. Rereview covers unresolved findings, fixes, and new risks, without repeating full requirement analysis or resetting rounds. Check applicability of trustworthy existing results; rerun only for insufficient evidence, changed inputs, or new risks.

Reviewers remain neutral; do not prohibit findings in advance. Resolve CRITICAL/IMPORTANT issues; after exhausting rereview rounds, record `BLOCKED` and return the decision to the user. `off` does not waive test failures, the Debug Gate, or explicit user requests. Close a finding as already satisfied only after actual inspection, recording rationale rather than optimistic inference.

## Completion and Durable Records

Follow the schemaVersion:1 JSON example in context-recovery.md and save coordination with `comet state checkpoint <name> --file <json-path>`. Runtime validates and generates Markdown; do not manually maintain subagent-progress.md. Read `{checkpoint, stale}` and inspect actual work when stale. Persist before dispatch, after receiving the session ID, and at review/acceptance/blocked boundaries. Ordinary reports may be coalesced; never redispatch accepted members. Checkpoints are not a second completion list.

Reversible implementation decisions within specifications may be made autonomously. Save decisions affecting subsequent work, their rationale, and task IDs in `<classic-change-dir>/.comet/rulings.md`; preserve necessary conclusions and evidence references before upstream temporary files are cleaned. Expanding scope, changing specifications or acceptance, accepting important defects, security exceptions, and external side effects still require user authorization. Temporary sessions or upstream internal directories cannot be the sole recovery source.

After per-task acceptance under the configuration, use the inspected revision to record completion:

```bash
comet state task-complete <name> <task-id> --expect <revision> --json
```

This command records completion; it does not replace acceptance. If changed requirements cause rejection, reread tasks and affected design and reassess, rather than blindly retrying with a new revision. Completion-only changes do not alter revision; the command may be retried idempotently. Follow existing commit policy without mechanical per-microtask progress commits.

After all tasks are accepted, immediately return to `comet-build` exit checks. Build does not add a whole-branch reviewer; `comet-verify` performs the only final integrated review under review_mode, then Archive closes the workflow.

## Interrupted Recovery

Obtain the current entry pack under context-recovery.md. Read `comet state checkpoint <name>` only when coordination summaries are insufficient; load referenced rulings as needed. Reconcile revision, actual commits, files, and evidence, then resume the original step with valid review and used rounds intact.

- For unchecked but implemented tasks, verify acceptance without reimplementing; committed but unaccepted tasks remain incomplete.
- Restore only unaccepted package members. tasks.md remains authoritative; mapped legacy plan checkboxes are display synchronization only.
- Reconcile mapping and impact when tasks are deleted, renamed, or changed. Missing mapping cannot be guessed as the first unchecked task.
- If checkpoints are missing, inspect the working tree and history first. Dispatch implementation only for confirmed missing work; no checkpoint does not mean no implementation.
- Record dispatch/session failures and stop the affected loop, then follow recovery without silently changing the selected strategy.
- Return to comet-build when all tasks are complete; do not restore old Build final-review/final-fix states.
