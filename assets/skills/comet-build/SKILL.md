---
name: comet-build
description: 'Phase 3 of Comet Classic — recover or create the implementation plan and execute its tasks.'
---

# Comet Phase 3: Plan and Build (Build)

Before starting or recovering, read and follow `comet-classic/reference/classic-layout.md`. Every OpenSpec CLI call in this file must use the adapter, and every file path must use the `<classic-*>` logical roots bound by that protocol.

## Prerequisites

- Design Doc has been created (Phase 2 complete)
- Active change exists

## Steps

### 0. Entry State Verification (Entry Check)

Use the stable `comet` CLI described in `comet-classic/reference/scripts.md`, then run entry verification. When resuming from any entry point, first run the recovery check in `comet-classic/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <name> build --json
```

After verification passes, use language, execution, and review settings from `data.configuration` without repeated field queries. Refresh after configuration writes or transitions; resolve specific failures before continuing.

If the `select` / `check` output is `BLOCKED` because `bound_branch` does not match the current branch, immediately pause under `comet-classic/reference/decision-point.md` and let the user choose one option: switch back to the bound branch and rerun entry verification, or run `comet state rebind <change-name>` after the user explicitly confirms the current branch should take over this change, then rerun entry verification. Do not switch branches or rebind on your own.

**Recovery**: Match entry phase, task IDs, and plan `base-ref` against implementation and review evidence. Resume the unfinished execution or review step. Unchecked does not mean unimplemented: inspect checkpoints before dispatch, preserve existing commits, and do not assume external operations are safe to repeat.

### 1. Create Plan

Run `comet state tasks <name> --json`; tasks.md is the completion authority. For new tasks without IDs, run `comet state tasks <name> --assign-ids --json`, preserving existing IDs and refreshing affected handoff evidence. If a legacy plan has checkboxes, verify its implementation and acceptance before explicitly migrating; never silently discard unfinished items.

Use the `writing-plans` Skill to create the implementation plan in the entry's configuration.language, at `docs/superpowers/plans/<YYYY-MM-DD>-<change-name>.md`.

Provide these inputs when invoking the Skill:

1. Artifact language: entry configuration.language
2. The formal Design Doc at the recorded design_doc path
3. `<classic-change-dir>/tasks.md` (task boundaries)
4. The fixed plan path and the result of `git rev-parse HEAD`

Use only the `writing-plans` plan-writing and self-review flow; return to Comet Build after the plan is complete, where Comet owns the subsequent execution configuration. If the Skill fails to load or the plan cannot be created, stop Build and report the reason.

**Comet invocation contract**: Override generic fine-grained steps and full-code templates with independently acceptable outcomes. Each task specifies file scope, dependencies, constraints, and acceptance commands/scenarios; group related preparation, implementation, tests, and docs together. Do not split mechanically by minutes, file counts, or RED/GREEN steps. Omit complete implementation and test code by default; include only necessary interface, algorithm, or high-risk snippets requiring prior review. Reference the approved design instead of repeating requirements.

On recovery, check the existing plan, completion evidence, and confirmed configuration. Reuse a valid plan and existing choices. For unchecked tasks with matching commits, verify review and acceptance before updating progress; do not redo implementation.

Plan requirements:

- Save to the plan path given in the instructions; do not change the file name
- Cover only the tasks listed in tasks.md; do not expand scope
- Reference design document, break down into executable tasks
- New plans describe order, dependencies, and method, not duplicate completion state. Include `<!-- comet-task-authority: <classic-change-dir>/tasks.md -->` and cover every task with `<!-- comet-task-ref:<task-id> -->`. Do not create a second checkbox list; reference canonical requirements and design.
- **Plan file header must contain associated metadata**:

```yaml
---
change: <openspec-change-name>
design-doc: <recorded-design-doc-path>
base-ref: <git rev-parse HEAD before implementation>
---
```

`base-ref` is used during verification to measure committed changes across the full implementation range. Record the current commit when creating the plan:

```bash
git rev-parse HEAD
```

After writing the plan, verify that the path exists and run Step 2's `comet state set <name> plan ...` to record it.

### 2. Record the Plan and Jointly Confirm the Workflow Configuration

Record plan path:

```bash
comet state set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

No manual phase update needed — guard auto-transitions when exit conditions are met.

When presenting the joint decision, show only execution methods, TDD modes, and code-review modes supported by this workflow. The workspace was prepared and bound during Open; if the change has no valid isolation, return to `/comet-open` instead of creating or switching a workspace in Build.

After the plan is written, provide exactly **one joint decision point** that collects whether to continue now, the execution method, TDD mode, and code-review mode. Do not ask whether to continue or pause first and then create a second configuration blocker.

| Option | Behavior                              | Details                                                                                                                                      |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Continue and commit the configuration | Choose the Step 3 execution, TDD, and review configuration in the same response                                                              |
| B      | Pause to switch model                 | Record `build_pause: plan-ready`, stop this `/comet-build` invocation, and let the user resume later from `/comet-classic` or `/comet-build` |

This is a user decision point. **Use `comet-classic/reference/decision-point.md` to present the plan summary, pause option, and every executable Step 3 configuration in one response.** Do not auto-select, and never write the pause into `build_mode`.

When the user chooses to continue with complete configuration, commit all related fields together in Step 3 and clear the pause in that same update.

When the user chooses to pause:

```bash
comet state set <name> build_pause plan-ready
```

After setting `build_pause: plan-ready`, stop the current invocation. Do not choose `isolation` or `build_mode`, and do not load an execution skill.

### 3. Apply the Confirmed Workflow Configuration

If resuming with `build_pause: plan-ready` and the plan exists, reuse it and reissue Step 2's joint decision. Atomically commit and clear the pause only after complete configuration is confirmed.

The plan is in the workspace prepared during Open. Confirm its existing `isolation` from this entry's configuration.

If the result is empty, stop Build and return to `/comet-open` for workspace resolve/prepare; do not make the first current/branch/worktree choice or create a workspace here.

**Execution method**:

| Option | Skill                                     | Applicable scenario                                                                                                 |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A      | Superpowers `subagent-driven-development` | Independent, complex tasks; each task runs in an isolated implementer subagent, with review driven by `review_mode` |
| B      | Superpowers `executing-plans`             | The main session executes tasks in plan order; suitable for fewer or tightly coupled tasks                          |

**Execution-method recommendations**:

- 3 or more tasks → recommend A
- 2 or fewer tasks with no cross-module dependency → recommend B
- From a hotfix path → recommend B

Execution method, TDD, and review tables are one Step 2 joint decision; do not create a separate pause. Recommendations must not replace the user's choice.

After the user chooses, update only the execution method, TDD mode, and code-review mode fields; preserve the `isolation` and `bound_branch` established during Open.

- For `executing-plans`, set `subagent_dispatch null` and `build_mode executing-plans` in the same update.
- For `subagent-driven-development`, set `subagent_dispatch confirmed` and `build_mode subagent-driven-development` in the same update.

**TDD mode**:

| Option   | Meaning                                                          | Applicable scenario                                                                                             |
| -------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `tdd`    | Write a failing test before implementation for each task         | Recommended for business logic, features, or APIs                                                               |
| `direct` | Implementation-first; no per-task Red-Green-Refactor requirement | Still run relevant tests and retain regression evidence for bug fixes; hotfix/tweak presets default to `direct` |

Include the confirmed `tdd_mode` in the same configuration update.

**Code-review mode**:

| Option     | Meaning                                                                                                 | Applicable scenario                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `off`      | Do not automatically dispatch code review                                                               | Docs, configuration, copy, or small low-risk tasks                  |
| `standard` | Dispatch task-level review when risk signals are present, and run one final integrated review in Verify | Recommended default for most ordinary changes                       |
| `thorough` | Dispatch task-level review for every task, and run one final integrated review in Verify                | High-risk, multi-module, architectural, or security-related changes |

Include the confirmed `review_mode` in the same update. For example, after the user selects sequential execution, TDD, and standard review:

```bash
comet state set <name> build_pause null build_mode executing-plans subagent_dispatch null tdd_mode tdd review_mode standard --json
comet state check <name> build --json
```

Use the user's actual values. Any invalid field rejects the entire update; preserve the workspace configuration established during Open.

`isolation` is a script-enforced hard constraint. Full workflow must write `current`, `branch`, or `worktree` during Open and complete the corresponding workspace preparation and `bound_branch` binding before entering Build; if it is missing, Build may only stop and return to Open for repair.

`subagent_dispatch` is a script-enforced hard constraint that records the user's subagent execution choice. `build_mode: subagent-driven-development` requires `subagent_dispatch: confirmed` before leaving the build phase, otherwise both `comet guard build --apply` and `comet state transition build-complete` will fail; it is not a capability check.

`tdd_mode` is a script-enforced hard constraint. Full workflow must have `tdd_mode` selected as `tdd` or `direct` before leaving the build phase, otherwise both `comet guard build --apply` and `comet state transition build-complete` will fail.

`review_mode` is a script-enforced hard constraint. Full workflow must have `review_mode` selected as `off`, `standard`, or `thorough` before leaving the build phase, otherwise both `comet guard build --apply` and `comet state transition build-complete` will fail. Legacy state files without this field follow a compat path, but should be backfilled on recovery.

`build_mode` defaults to `direct` only for hotfix/tweak presets. Full workflow must not default to `direct`. Use it only when the user explicitly asks to bypass the plan execution skills and you record an explicit override:

```bash
comet state set <name> direct_override true build_mode direct
```

Without `direct_override: true`, `build_mode=direct` in full workflow is blocked by both guard and state transition.

**Execution location**:

Open has already prepared the current directory, branch, or Worktree according to `isolation` and returned the actual `projectRoot`. On resume, run `comet classic workspace resolve <name> --json`, enter the returned directory, then run `comet state select <change-name>`; do not create a Worktree, switch branches, commit a plan to transfer it across Worktrees, or rebind isolation in Build.

**Execute plan**: Must handle execution according to the actual runtime of `build_mode`.

Pass an explicit return boundary to the execution Skill: execute only the current plan and confirmed configuration. Platform subagent availability must not replace `executing-plans`; do not create another worktree, reselect isolation, add phase confirmations or final review, or invoke `finishing-a-development-branch`. Return to Comet Build after tasks; Comet exclusively owns the five-phase lifecycle.

- `build_mode: executing-plans`: **Immediately execute:** Use the Skill tool to load the Superpowers `executing-plans` skill. Skipping this step is prohibited. If loading fails, stop and report the error; do not substitute with normal conversation. After the skill loads, ARGUMENTS must include the same Language constraint as Step 1: `Language: Use the configured Comet artifact language from comet state get <name> language`. Execute according to plan.
- `build_mode: subagent-driven-development`: The main session only coordinates and must not write implementation code directly. **Immediately execute:** Use the Skill tool to load the Superpowers `subagent-driven-development` skill. After the skill loads, read `comet-classic/reference/subagent-dispatch.md` for Comet-specific extensions (subagent dispatch, task isolation, checkoff verification, TDD constraints, continuous execution, context recovery) and apply them alongside the skill's workflow. If they conflict, the more specific Comet extensions take precedence.
- If subagent dispatch fails, follow `comet-classic/reference/subagent-dispatch.md` to record the current task as `BLOCKED` with the failure reason; the main session must not take over implementation.

**TDD Mode Execution Constraints**:

If `tdd_mode: tdd`:

- `build_mode: executing-plans`: After loading the execution skill and before the first task, **immediately load** Superpowers `test-driven-development` once with the Skill tool. Follow the loaded TDD Red-Green-Refactor cycle for each task without skipping failing-test verification. Do not reload between tasks. On cold recovery load it only if absent from context, inspect existing RED/GREEN evidence, and resume the unfinished step rather than reenacting verified implementation.
- `build_mode: subagent-driven-development`: The main session does not load the TDD skill. TDD constraints and evidence thresholds are defined in `comet-classic/reference/subagent-dispatch.md`; every background implementer and fix agent must use the Skill tool to load the Superpowers `test-driven-development` skill and follow the Comet-injected TDD hard constraint.

If `tdd_mode: direct`: Follow normal flow, no enforced TDD.

**Build review boundary**: Build keeps only task-level or segmented reviews. Verify owns the only final integrated code review for the entire change.

- `executing-plans` + `off|standard`: do not request a whole-change final review in Build; enter Verify after task acceptance
- `executing-plans` + `thorough`: request one segmented review after every 3 completed tasks, limited to that segment's diff; when total tasks are 3 or fewer, add no Build review
- `subagent-driven-development`: follow `comet-classic/reference/subagent-dispatch.md` for task-level review under the selected `review_mode`; do not append a final reviewer after all tasks complete

Fix CRITICAL/IMPORTANT findings from task-level or segmented review in Build. If a required review Skill cannot load, stop and report the failure instead of silently skipping it. Record the reason and impact scope for accepted non-CRITICAL findings in a durable artifact.

### 3b. In-Execution Debugging (Debug Gate)

During task execution, whenever a crash, unexpected behavior, test failure, or build failure appears while running the program, tests, build, or manual verification, must use the Skill tool to load the Superpowers `systematic-debugging` skill. Before root-cause investigation is complete, must not propose or implement source-code fixes.

For specific investigation, minimal failing test, fix verification, and keeping the current change verification loop, follow `comet-classic/reference/debug-gate.md`.

### 4. Spec Incremental Updates

When the initial spec is found incomplete during implementation, handle by scale:

| Scale  | Trigger Conditions                                   | Approach                                                                                                                                                                             |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Small  | Missing acceptance scenarios, edge cases             | Directly edit delta spec + design.md, append tasks.md tasks                                                                                                                          |
| Medium | Interface changes, new components, data flow changes | **Pause, present the choice, and wait for the user to explicitly confirm**, then must use Skill tool to load the Superpowers `brainstorming` skill to update Design Doc + delta spec |
| Large  | Brand-new capability requirements                    | **Pause, present the split choice, and wait for the user to explicitly confirm**; after user confirms, create independent change through `/comet-open`                               |

**50% Threshold Determination**: Using initial task count in tasks.md as baseline, if new tasks exceed half of that total, it's considered outside original plan scope, **must follow the `comet-classic/reference/decision-point.md` protocol to pause and wait for the user to decide whether to split into a new change**.

When creating an independent change, must invoke `/comet-open`, not `/opsx:new` directly. `/comet-open` creates both OpenSpec artifacts and `.comet.yaml`, preventing the new change from leaving the Comet state machine.

**User choices must include**:

- "Split into new change" — create independent change via `/comet-open`
- "Continue in current change" — record scope-expansion decision, update tasks.md and delta spec, then continue

**Principles**:

- Delta spec is a living document, can be modified at any time during this phase
- Each update should be committed with commit message explaining the change reason
- Do not sync to main spec in advance, sync uniformly during archiving
- For small-scale incremental direct delta spec edits, note in commit message to facilitate design doc drift assessment during archiving

**Handoff synchronization**: adding, modifying, or removing a delta spec expires the design handoff pack (`handoff_hash`). During Build you can regenerate it directly without reverting the current phase or step:

```bash
comet handoff <change-name> design --write
```

Regeneration rebuilds the handoff from the current OpenSpec artifacts and updates `handoff_hash`; it does not change the `phase` field or the Runtime `currentStep`, so you can continue in the Build phase after refreshing.

### 5. Context Management

Build is the longest phase and may span many tasks. To support resume after context compaction:

- **After each task**: complete acceptance under the execution branch and `review_mode`, then record completion with `comet state task-complete <name> <task-id> --expect <revision> --json`. Use the revision from the inspected task list; reconsider changed requirements instead of blindly refreshing and retrying. Plans and checkpoints do not maintain duplicate checkboxes. Subagent review is off for `off`, risk-based for `standard`, and per-task for `thorough`; batches still require per-ID acceptance. Follow project commit policy without mechanical microtask progress commits.
- **Context compression recovery**: Follow `comet-classic/reference/context-recovery.md` with phase set to `build`.
- **User manual-change resume**: handle uncommitted changes through `comet-classic/reference/dirty-worktree.md`. That protocol defines checks, attribution, and prohibitions. Build-specific handling:
  1. After attribution, if the diff implies plan or spec changes, handle it through Step 4 "Spec Incremental Updates"
- **Long task split**: if a single task exceeds 200 lines of code changes, consider splitting it into multiple subtasks and commits

## Exit Conditions

- All tasks.md checked
- Code committed
- Project-specific build/tests explicitly run and pass; do not rely only on guard auto-detection
- `isolation` has been written as `current`, `branch`, or `worktree`
- `build_mode` has been written as `subagent-driven-development`, `executing-plans`, or `direct` with explicit override; if `subagent-driven-development`, `subagent_dispatch` must be `confirmed`
- `tdd_mode` has been written as `tdd` or `direct`
- `review_mode` has been written as `off`, `standard`, or `thorough`
- Task-level or segmented review required by `review_mode` is complete; Build does not duplicate Verify's final integrated review
- **Phase guard**: Run `comet guard <change-name> build --apply`; after all PASS, state advances to `phase: verify`

Prefer Runtime execution and evidence capture instead of running a command manually and having Guard repeat it. Use `--local` only for deterministic local checks; omit it for external services or uncertain environments, whose evidence is single-use. Platform adapters handle ordinary Windows npm/pnpm shims. Batch arguments with shell metacharacters are rejected; use an explicit entry such as `node <script>` for complex checks, not a shell string as the program name.

```bash
comet check run <change-name> build --local -- <program> [args...]
```

Guard checks configuration, tasks, and artifacts, then reuses Runtime evidence only for matching inputs and environment; otherwise it runs a detectable build. Source, tests, related configuration, dependency, or submodule changes require rerunning. Cold recovery revalidates reusable local evidence and reruns invalid or single-use evidence. Input changes during execution prevent reuse. Preview does not consume single-use evidence; a successful transition does. Read failure logs on demand through `logRef`.

`state record-check --command` only records a manual claim: Comet never executes that text or advances from it automatically. Build and Verify evidence remain independent; Verify may reference a validated build result, but it does not replace tests and acceptance checks. `COMET_SKIP_BUILD=1` is a legacy bypass, not auditable evidence.

Before exit, run guard to auto-transition:

```bash
comet guard <change-name> build --apply
```

State file is automatically updated to `phase: verify`, `verify_result: pending`.

## Automatic Handoff to Next Phase

Follow `comet-classic/reference/auto-transition.md`. Key command:

```bash
comet state next <change-name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to enter the next phase
- `NEXT: manual` → do not invoke the next skill; return control with `HINT`, end the invocation, and do not create another confirmation point
- `NEXT: done` → workflow is complete, no further action needed
