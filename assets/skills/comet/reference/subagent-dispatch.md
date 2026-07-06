# Comet Extensions for Subagent-Driven Development

Canonical path: `comet/reference/subagent-dispatch.md`

This document provides Comet-specific extensions applied **on top of** the Superpowers `subagent-driven-development` skill. The Superpowers `subagent-driven-development` skill provides the base continuous dispatch loop (a fresh implementer for each task, including the default task reviewer node) and enforces continuous execution. This document adds Comet-specific real background dispatch, task tracking, state verification, context recovery, and review/fix budgets; Comet's `review_mode` takes over the reviewer stage to decide which tasks need reviewers, how many fix rounds are allowed, and which final review runs. If the Superpowers skill conflicts with this document, the more specific Comet constraints here take precedence.

> **⚠️ CRITICAL — No Pause Between Tasks**
>
> After a task passes `review_mode` validation and is checked off, **immediately dispatch the next task** without stopping, summarizing, or asking the user whether to continue. The user expects all tasks to execute in sequence without manual intervention. Pausing between tasks breaks the workflow and requires the user to manually resume each time.
>
> Only stop and wait for user input when:
> - A task is **BLOCKED** (review-fix rounds exhausted: `review_mode: standard` — 1 round of risk-task review-fix or final lightweight review not passed; `review_mode: thorough` — 2 rounds of task-level/final review-fix not passed)
> - There is irreducible ambiguity that cannot be resolved from the repository, plan, or existing context
> - The platform lacks real background agent dispatch capability and the user must choose `executing-plans`
> - The user **explicitly** asks to pause
>
> This rule applies to the ENTIRE dispatch loop, not just individual tasks.

## Before Starting

1. Before dispatching the first task, complete the Superpowers `subagent-driven-development` skill pre-flight plan review: scan the plan and global constraints for contradictions or plan-mandated defects a reviewer would flag. If found, ask one batched question with the conflicting plan text before implementation starts; if clean, proceed without ceremony.
2. Read the plan once, extracting the full text of all unchecked tasks in order.
3. Save a unique identifier for each task: the full task text after the checkbox in the plan, and the full OpenSpec task text it maps to (if any). If the text is not unique, stop and fix the plan first; never rely on "first match."
4. Respect dependencies; do not dispatch a task whose dependencies are not yet complete.

## Per-Task Comet Extensions

Apply these on every task, in addition to the Superpowers skill's dispatch loop:

### 0. Dispatch Enforcement (Critical)

The main session is the **coordinator only** and must NOT execute tasks directly or modify source code. The coordinator may modify only the plan, OpenSpec task, and subagent progress checkpoint for durable tracking. Never bundle multiple tasks into one agent. Dispatch a fresh background implementer agent for every task; when `review_mode` requires review or fixes, the task reviewer, fix agents, and the final reviewer must also each use a fresh background agent:

- **Claude Code**: Use the `Agent` tool with `run_in_background: true` for each implementer, task reviewer, fix agent, and final reviewer. Never execute tasks inline and do not accidentally enter team mode, which requires a pre-created team.
- **Other platforms**: Use the platform's equivalent background agent / Task / multi-agent dispatch mechanism.
- **Never** reuse implementers, reviewers, or fix agents across tasks or roles. Each agent gets a fresh, isolated context containing only the single task and role-specific context it needs.
- If the platform has no real background dispatch capability, do not proceed; pause and wait for the user to choose `build_mode: executing-plans`.

### 1. Dispatch Prompt and Return Contract

Every implementer or fix-agent prompt must include:

- The full text of the single current task, architecture background, and dependency context
- `Language: Use the configured Comet artifact language from "$COMET_BASH" "$COMET_STATE" get <name> language`
- The allowed file scope and prohibited modification scope
- The required test commands and commit requirements
- For a fix agent, the corresponding reviewer's complete feedback

Large task text, implementation reports, and review material must move through the file-handoff mechanism exposed by the loaded Superpowers `subagent-driven-development` skill, not be pasted wholesale into the main session. The dispatch prompt should point agents to those handoff artifacts while still naming the role, allowed scope, required tests, report contract, and any Comet-specific constraints. Comet may record returned artifact paths or short summaries for recovery, but must not depend on the internal names or directory layout of those artifacts.

The agent return status must be `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` and include or point to implementation details, test results, commit hash, changed files, and concerns. **The implementer/fix agent must also report whether this task hits any risk signal** (see the list below); if so, list each one hit. This is the first signal source for whether a per-task reviewer is dispatched under `review_mode: standard`. Before review, the coordinator must verify that the commit and changed files are visible in the current worktree; on isolated-copy platforms, pull or merge the changes first.

**Risk signal list** (hitting any one marks the task as a risk task):

- Cross-module / cross-subsystem coordinated change
- Security-sensitive surface: auth, authorization, crypto, SQL, external input handling, secrets/credentials
- Concurrency, locks, shared mutable state
- Data or schema migration
- Public API contract or external interface change
- Implementer returns `DONE_WITH_CONCERNS`
- Single-task diff exceeds 200 lines

When `review_mode` requires a reviewer, each reviewer prompt must include or point to the full task requirements, the implementation commit or diff, and the RED/GREEN evidence (when `tdd_mode: tdd`). A reviewer must not review from the implementer's summary alone.

Reviewer prompts must stay neutral:

- Do not ask a reviewer to re-run the same tests the implementer already ran and reported; the reviewer verifies the reported evidence and the code/diff.
- Do not pre-judge, suppress, or down-rank findings in the reviewer prompt. If a likely finding conflicts with the plan, let the reviewer report it, then ask the user which requirement governs.
- Do not paste accumulated prior-task history into later dispatches. Give only the current task, the relevant interfaces/constraints, and the handoff artifacts exposed by the loaded Superpowers `subagent-driven-development` skill.

**Model selection (mandatory)**: Every dispatch must specify the model explicitly. An omitted model silently inherits the session's most expensive model, slowing execution and raising cost. Follow the Superpowers `subagent-driven-development` Model Selection rules:

- **Implementer / fix agent**: prose-described implementation work uses at least the standard tier; multi-file integration, pattern matching, or debugging → standard tier; requires design judgment or broad codebase understanding → most capable tier. Use the cheapest tier only when the plan text already contains the complete code to write (transcription + testing) or for a single-file mechanical fix.
- **Reviewer (task-level / final)**: scale to the diff's size, complexity, and risk. A small mechanical diff does not need the most capable model; a subtle concurrency change does.
- **Final whole-branch review**: use the most capable available model, not the session default.

Omitting the model equals letting it run the session's most expensive model — directly defeating this section's goal.

### 2. Implementer Scope Restriction

The implementer is only responsible for implementation, testing, and committing code. **The implementer must not check off plan or OpenSpec tasks**, nor update only the built-in Todo or in-chat checklists.

### 3. TDD Hard Constraint

If `tdd_mode: tdd`, every implementer and fix agent must first use the Skill tool to load the Superpowers `test-driven-development` skill, and its prompt must also inject:

```text
You MUST follow TDD: write a failing test first, watch it fail, then write minimal code to pass. No production code without a failing test first.
```

The implementer or fix-agent return must provide **RED failure command and failure summary**, **GREEN pass command and pass summary**; missing either piece of evidence blocks entry into review. When `review_mode` requires a task reviewer, that reviewer must verify RED/GREEN evidence and test coverage while checking both spec compliance and code quality.

### 4. Durable Progress Checkpoint

The coordinator must maintain `openspec/changes/<name>/.comet/subagent-progress.md` and update it immediately after every dispatch, agent return, review result, review-fix round change, and task checkoff. The checkpoint must record at least:

- The unique current plan task text and mapped OpenSpec task text
- Current stage: `implementing | task-review | checkoff | done | blocked | final-review | final-fix`
- Implementation commit hash, changed files, and RED/GREEN evidence
- The selected `review_mode`
- Review stages already passed and unresolved reviewer feedback
- The current task or final-review review-fix round (`standard`: max 1, `thorough`: max 2, `off`: 0)
- Under `review_mode: standard`, whether this task has already triggered a risk task-level review and which risk signals it hit (on recovery, do not re-dispatch an already-completed task-level review)

This file stores only coordinator recovery state and does not replace plan or OpenSpec checkboxes. Retain the final record when a task completes, then replace it with the next task's record when that task begins.

Comet does not read, write, or require any Superpowers `subagent-driven-development` internal scripts or workspace paths. If the installed Superpowers `subagent-driven-development` skill maintains its own scratch artifacts, review material, task requirement files, or progress records, those remain owned by Superpowers. Comet's durable source of truth is limited to Comet workflow state, the plan/OpenSpec checkboxes, and this coordinator checkpoint.

### 5. Review Mode Behavior

> **⚠️ CRITICAL — review_mode takes over the Superpowers default flow, no double review**
>
> The Superpowers `subagent-driven-development` Process flowchart makes "dispatch a task reviewer after every task" a mandatory node. **Comet's `review_mode` takes over this stage, deciding which tasks get a per-task reviewer** (see the per-task reviewer column in the table below). **Do not dispatch additional reviewers beyond what `review_mode` prescribes.** Tasks that do not get a reviewer (`off`: all; `standard`: non-risk tasks) must go straight to task checkoff and dispatch of the next task.
>
> The total review count for a change is decided solely by the table below — do not add more.

**Build-phase review budget** (these only — do not add more). This table covers the build phase only; the verify phase has its own review handling (see note below):

| `review_mode` | per-task reviewer (build) | final review (build) |
|---------------|---------------------------|----------------------|
| `off` | 0 | 0 |
| `standard` | risk tasks only (see rules below) | 1 (lightweight) |
| `thorough` | every task (spec + quality) | 1 (complete) |

**Verify-phase review is not in this table.** The verify phase's review is driven by `verify_mode` (light/full), with `review_mode` only gating whether automatic code review fires at all (`off` skips it; `standard`/`thorough` run a lightweight code review under lightweight verification, or rely on `openspec-verify-change` under full verification). There is no separate per-`review_mode` "complete" code review in verify — see `comet-verify` for the authoritative verify-phase behavior.

**When `review_mode: standard`**: By default no per-task reviewer is dispatched; instead, a **risk trigger** decides: after the implementer self-tests, commits, and reports evidence (including the risk-signal self-report), the coordinator reads the self-report and reviews the task's diff. **Only when the implementer's self-report hits any risk signal, or the coordinator's diff review finds any risk signal**, dispatch one per-task reviewer for that task, checking both spec compliance and code quality; CRITICAL/IMPORTANT findings enter one review-fix round (max 1), and a failed re-review marks it **BLOCKED**. Tasks that hit no risk signal go straight through targeted checkoff verification. After all tasks complete, still dispatch one final lightweight code reviewer (scope: correctness, security, edge cases). If the final lightweight review finds CRITICAL or IMPORTANT issues, dispatch at most one fix agent and re-review once; if still not passed, mark **BLOCKED** and pause, handing feedback to the user. Non-CRITICAL findings may be accepted with rationale recorded.

**When `review_mode: thorough`**: **Dispatch one per-task reviewer per task, checking both spec compliance and code quality**: after the implementer self-tests, commits, and reports evidence, the coordinator dispatches a fresh background reviewer for that task. CRITICAL/IMPORTANT findings enter review-fix (max 2 rounds); if still not passed, mark **BLOCKED** and pause, handing feedback to the user. After all tasks, dispatch one final complete reviewer. Thorough does not run batched review — a high-risk change demands immediate, focused review on every task; deferring to a batch boundary to catch issues is too costly.

When a reviewer returns an item that cannot be verified from review material alone, the coordinator must resolve it before task checkoff. If direct repository inspection confirms a real gap, treat it as a failed spec/quality review and send it through the appropriate fix and re-review loop. If it is satisfied by unchanged code or a cross-task constraint, record the rationale in the checkpoint and continue.

**When `review_mode: off`**: No automatic task reviewer, final reviewer, or review-fix agent is dispatched. Task completion is determined by implementer test/build evidence, current worktree confirmation, targeted task text checkoff verification, and explicit user request. If test failures, build failures, or abnormal behavior occur during execution, the debug gate protocol must still be followed - `off` does not skip real issues.

### 6. Task Checkoff and Verification

**After `review_mode` validation**, the main session:

1. Changes the saved unique task text from `- [ ]` to `- [x]` in the plan
2. If a mapping exists, also checks off the OpenSpec task
3. Commits this progress update
4. Runs targeted verification:

```bash
node "$COMET_STATE" task-checkoff "$PLAN_FILE" "$PLAN_TASK_TEXT"
node "$COMET_STATE" task-checkoff "openspec/changes/<name>/tasks.md" "$OPENSPEC_TASK_TEXT"
```

Run the second command only when the corresponding mapping exists. The script requires the task text to appear exactly once and be checked; verification failure blocks moving to the next task.

## Wrap-up

- **AUTO-CONTINUE**: After `review_mode` validation and the task is checked off, immediately dispatch the next unchecked task. Do NOT summarize, do NOT ask the user whether to continue, do NOT wait for user input between tasks. This is non-negotiable — the Superpowers skill enforces continuous execution, and the CRITICAL warning at the top of this document reinforces it.
- After all tasks complete, if `review_mode: standard`, switch the checkpoint to `final-review` and dispatch exactly one final lightweight code reviewer. CRITICAL or IMPORTANT issues allow at most one auto-fix and re-review; if still not passed, pause and hand to the user. After passing or accepting non-CRITICAL findings, continue to return to `comet-build`.
- After all tasks complete, if `review_mode: thorough`, switch the checkpoint to `final-review` and dispatch one final complete reviewer. CRITICAL or IMPORTANT issues allow at most two auto-fix and re-review rounds; if still not passed, pause and hand to the user. After passing or accepting non-CRITICAL findings, continue to return to `comet-build`.
- After all tasks complete, if `review_mode: off`, do not enter `final-review` or `final-fix`, but must record the reason for skipping automatic code review in a durable artifact, then return to `comet-build`.
- After final review passes, only the subagent dispatch loop is complete, not the Comet workflow. The coordinator must not load `finishing-a-development-branch` or pause to ask what comes next; it must return control to `comet-build` for exit checks, the phase guard, and phase handoff.

## Context Recovery

Reload the Superpowers `subagent-driven-development` skill and re-read this document. Read `openspec/changes/<name>/.comet/subagent-progress.md`, then compare it with the first unchecked task and the current worktree:

- When the checkpoint matches the unchecked task, resume from its exact recorded stage while preserving the implementation commit, RED/GREEN evidence, `review_mode`, review stages already passed, unresolved feedback, and current review-fix round. Never reset the round or repeat an already passed stage.
- If the loaded Superpowers `subagent-driven-development` skill reports a task complete through its own progress record, reconcile that report against git history and Comet plan/OpenSpec checkboxes before dispatching. When the commits and task identity match, update Comet's checkpoint/checkoff state instead of re-dispatching completed work.
- When the checkpoint is missing or does not match the unchecked task, create a new checkpoint for the first unchecked task and begin with implementer dispatch.
- When a recorded commit or file is not visible in the current worktree, pull, merge, or recover the corresponding changes before proceeding; never assume the implementation exists.
- When all tasks are checked and the checkpoint stage is `final-review` or `final-fix`, resume the exact final-review stage while preserving final feedback and its review-fix round; never re-enter completed tasks.

Tasks committed without passing `review_mode` validation remain unchecked and re-enter the corresponding validation, review, or fix loop according to the checkpoint.
