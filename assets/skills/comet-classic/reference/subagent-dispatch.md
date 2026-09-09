# Comet Extensions for Subagent-Driven Development

Canonical path: `comet-classic/reference/subagent-dispatch.md`

Read only after the user selects `build_mode: subagent-driven-development`. Load the installed Superpowers skill, then apply this Comet invocation contract. Upstream supplies implementation methods and file handoffs; Classic owns execution choice, acceptance, review budgets, and five-phase completion. Return to comet-build instead of adding upstream final review or `finishing-a-development-branch`; Verify and Archive own those steps.

## Start and Task Identity

1. Read the plan, approved design, and configuration from `comet state check <name> build --json` once. Refresh affected material when scope, files, or configuration changes.
2. Preflight the plan once for conflicts with specs, acceptance, or global constraints. Investigate repository-answerable questions; batch questions affecting goals or authorization.
3. Run `comet state tasks <name> --json`. tasks.md is the sole completion authority. Select unfinished IDs by dependency, not line number, position, or mutable title.
4. For `needsIds: true`, run `comet state tasks <name> --assign-ids --json` and refresh affected handoffs and plan mappings. Preserve existing IDs. Recover legacy checkbox plans using both lists first; migrate explicitly only after inspecting every implementation and acceptance, never by deleting unfinished items.

The main session dispatches, integrates, and accepts; it does not implement assigned subagent tasks. Continue after visible implementation and acceptance without asking between tasks. Stop for user pauses, genuine requirement ambiguity, or the blocking conditions below.

## Dispatch Unit

Default to one implementer per independently acceptable outcome. A fresh implementer may receive **2-3 same-pattern microtasks** only when all share local context, have nonconflicting file scope and satisfied dependencies, retain individual IDs and acceptance evidence, have no individual or combined risk signals, and `review_mode` is not `thorough`.

A batch is not a new task identity. Report, accept, and complete each member independently; one passing member does not complete the batch. On risk or scope growth, stop expanding the batch, review actual changes as risky, and return unexecuted members to individual dispatch.

Do not reuse agents across tasks or roles; prefer the original implementer for repairs to the same task/batch. Create a repair agent only when that session is unavailable or no longer progressing, preserving the review budget. Reviewers remain independent. Subagents do not dispatch implementers or reviewers; the controller owns all dispatch.

## Handoff and Evidence

Send only current-task context: ID and complete requirements, plan/design references, allowed write scope, dependency interfaces, artifact language, required checks, and response contract. Use upstream file handoffs for long requirements, reports, and feedback; keep paths and essential summaries in the controller instead of repeatedly pasting history. Inherit user/platform model configuration; assign roles by capability, not mandated model names.

Implementers report `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`, listing changed files, commits, actual check commands/results, unfinished work, and risks per ID. They implement and self-test without checking off tasks. Accept only after files and commits are visible in the current workspace; integrate isolated copies first.

With `tdd_mode: tdd`, implementers and repair agents load `test-driven-development` in their independent contexts and supply commands and summaries for RED failure and GREEN success. Do not reload an intact resumed context; reload as needed after compaction. Missing evidence prevents completion. `direct` skips per-task RED/GREEN, not relevant checks or fix regression evidence.

## Risk and Review Budgets

Risk signals: cross-module coordination; authentication, authorization, cryptography, SQL, external input, or credentials; concurrency, locks, shared mutable state; data/schema migration; public API changes; `DONE_WITH_CONCERNS`; or an individual/combined diff over 200 lines. Inspect both implementer reports and actual diffs.

| `review_mode` | Build task review                                                      | Repair re-review limit |
| ------------- | ---------------------------------------------------------------------- | ---------------------- |
| `off`         | No automatic reviewer                                                  | 0                      |
| `standard`    | Risky tasks only; one reviewer checks spec compliance and code quality | 1 round                |
| `thorough`    | Independent reviewer per task checks both dimensions; no batching      | 2 rounds               |

This budget replaces upstream default reviewer nodes, not an additional review system. Initial review reads actual requirements, diff, and evidence, not only summaries. Re-review covers unresolved issues, fixes, and new risks without repeating full analysis or resetting rounds. Check trusted evidence applicability; run additional checks only for missing evidence, changed inputs, or new risks.

Reviewers remain neutral, without preemptive restrictions on findings. Resolve CRITICAL/IMPORTANT issues; if unresolved at the re-review limit, record `BLOCKED` and ask the user. `off` does not waive failing tests, Debug Gate, or explicit requests. Close a finding as already satisfied only after actual verification and a recorded reason.

## Completion and Durable Records

Maintain `<classic-change-dir>/.comet/subagent-progress.md` with task IDs/batch members, requirements revision, `implementing | task-review | checkoff | done | blocked`, sessions, handoff paths, commits/checks, risks, passed reviews, unresolved feedback, and used repair rounds. Update after dispatch, response, review, and completion; never redispatch accepted members. This is coordination history, not another completion list.

Autonomously handle reversible implementation choices within the spec. Save decisions affecting later work, rationale, and task IDs in `<classic-change-dir>/.comet/rulings.md`; retain essential conclusions and evidence references before upstream temporary files disappear. Scope/spec/acceptance changes, important defect acceptance, security exceptions, and external side effects still require authorization. Temporary sessions or upstream internal directories cannot be the sole recovery source.

After individual acceptance, record completion using the inspected revision:

```bash
comet state task-complete <name> <task-id> --expect <revision> --json
```

This records completion, not acceptance. On rejection for changed requirements, reread tasks and affected design and reconsider; do not merely fetch a fresh revision and retry. Checkbox-only changes preserve revision, and completion can be retried idempotently. Follow existing commit policy without mechanical per-microtask progress commits.

After all task acceptance, immediately return to comet-build exit checks. Build adds no whole-branch reviewer; comet-verify performs the only final integrated review under review_mode, followed by Archive.

## Interrupted Recovery

Get fresh state through context-recovery.md, then read the coordination checkpoint, rulings, and IDs. Check requirements revision, commits, files, and evidence before resuming the original stage, preserving passed reviews and consumed rounds.

- For unchecked but implemented tasks, inspect acceptance rather than reimplementing; committed but unaccepted tasks remain incomplete.
- Resume only unaccepted batch members; tasks.md owns accepted completion.
- Remap deleted/renamed tasks and changed requirements before assessing impact; missing mappings do not mean the first unchecked task.
- Investigate the worktree and history when checkpoints are absent. Dispatch only confirmed unimplemented tasks; no checkpoint does not imply no implementation.
- Record dispatch/session failures and stop the affected loop under recovery rules; do not bypass the selected method by implementing in the main session.
- Return to comet-build after all tasks; do not restore obsolete Build final-review/final-fix states.
