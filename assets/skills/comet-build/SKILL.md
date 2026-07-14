---
name: comet-build
description: "Use only when explicitly invoked as /comet-build or routed by the root Comet skill/runtime to a full workflow build phase; create or recover the implementation plan and execute tasks."
---

# Comet Phase 3: Plan and Build (Build)

## Prerequisites

- Design Doc has been created (Phase 2 complete)
- Active change exists

## Steps

### 0. Entry State Verification (Entry Check)

Use the stable `comet` CLI described in `comet/reference/scripts.md`, then run entry verification. When resuming from any entry point, first run the recovery check in `comet/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <name> build
```

Proceed to Step 1 after verification passes. The script outputs specific failure reasons when verification fails.

**Idempotency**: All build phase operations can be safely re-executed. Read `.comet.yaml` `phase` to confirm build, read the plan header `base-ref`, then parse tasks.md checkboxes in document order and resume from the first unchecked task. Already-committed tasks must not be re-committed.

### 1. Create Plan (Subagent Offload)

Create the implementation plan through a subagent, avoiding planning skill occupying main session context. Plan files and execution feedback must use the configured Comet artifact language from `comet state get <name> language`.

**Subagent instructions**:

You are an implementation planning expert. Create an implementation plan based on the following inputs:

1. **Immediately execute:** Use the Skill tool to load the Superpowers `writing-plans` skill. Skipping this step is prohibited. After the skill loads, ARGUMENTS must include: `Language: Use the configured Comet artifact language from comet state get <name> language`
2. Read the Design Doc (technical design document under `docs/superpowers/specs/`)
3. Read `openspec/changes/<name>/tasks.md` (task boundaries)
4. Follow the skill's guidance to create the plan

Plan requirements:
- Save to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
- Reference design document, break down into executable tasks
- **Plan file header must contain associated metadata**:

```yaml
---
change: <openspec-change-name>
design-doc: docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
base-ref: <git rev-parse HEAD before implementation>
---
```

`base-ref` is used during verification to measure committed changes across the full implementation range. Record the current commit when creating the plan:

```bash
git rev-parse HEAD
```

Write the plan to file, then return the file path.

**Execute subagent**: Use the current platform's subagent dispatch mechanism to send the above task.

After the subagent completes:
- If a valid file path is returned and the file exists, record it as the plan
- If the subagent fails or returns an invalid path, fall back to loading the Superpowers `writing-plans` skill inline in the main session (degraded fallback)

### 2. Update Plan Status and Jointly Confirm Workflow Configuration

Record plan path:

```bash
comet state set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

No manual phase update needed — guard auto-transitions when exit conditions are met.

Check current platform capabilities before presenting the joint decision: verify whether `using-git-worktrees` is available, whether a real background subagent/Task/multi-agent dispatcher exists, and whether the repository can safely create a branch. Show only isolation and execution options that are currently executable. If a field has only one valid value, explain why and apply it without manufacturing another pause.

After recording the plan, provide exactly **one joint decision point** that collects whether to continue now, available workspace isolation, available execution method, TDD mode, and code review mode. The branch name must be confirmed in the same Step 2 joint decision when `branch` is selected. Do not ask continue/pause first and then create another configuration or naming blocker.

| Option | Behavior | Description |
|--------|----------|-------------|
| A | Continue with configuration | Provide all Step 3 isolation, execution, TDD, and review choices in the same response; include the branch name when branch is selected |
| B | Pause to switch model | Record `build_pause: plan-ready`, stop this `/comet-build` invocation, and allow the user to resume later from `/comet` or `/comet-build` |

This is a user decision point. **Follow `comet/reference/decision-point.md` once and show the plan summary, pause option, and every executable Step 3 setting together**. Continuing requires all settings and any conditional branch name in the same response. Do not auto-select or write the pause into `build_mode`.

When the user chooses to continue and supplies complete configuration:

```bash
comet state set <name> build_pause null
```

When the user chooses to pause:

```bash
comet state set <name> build_pause plan-ready
```

After setting `build_pause: plan-ready`, stop the current invocation. Do not choose `isolation` or `build_mode`, and do not load an execution skill.

### 3. Apply the Confirmed Workflow Configuration

If resuming with `build_pause: plan-ready` and the `plan` file exists, do not rerun `writing-plans`. Reissue the same joint Step 2 decision and clear the pause only after the user supplies complete configuration:

```bash
comet state set <name> build_pause null
```

Then apply the workspace isolation, execution method, TDD mode, and code review mode below.

The plan is on the current branch. These settings are all part of the single Step 2 decision:

**Workspace Isolation**:

| Option | Method | Description |
|--------|--------|-------------|
| A | Create branch | Create a new branch in the current repo, simple and fast |
| B | Create Worktree | Isolated workspace, fully independent, suitable for parallel development |

**Recommendation rules**:
- Change involves ≤ 3 files → Recommend A
- Need parallel development, current branch has uncommitted work → Recommend B

**Execution Method**:

| Option | Skill | Applicable Scenario |
|------|------|-------------------|
| A | Superpowers `subagent-driven-development` | Independent tasks, high complexity; each task runs in an isolated implementer subagent with review driven by `review_mode` |
| B | Superpowers `executing-plans` | Simple tasks, no subagent environment, lightweight and fast |

**Execution method recommendation rules**:
- Task count ≥ 3 → Recommend A
- Task count ≤ 2 and no cross-module dependencies → Recommend B
- From hotfix path → Recommend B

These tables are part of the Step 2 joint decision and do not create another pause. First remove options that capability preflight found unavailable. When multiple valid options remain, do not choose `branch` or `worktree`, execution method, TDD mode, or review mode from recommendations. Recommendations explain a preference; they never replace user confirmation.

After user selection, update `isolation`, execution method, TDD mode, and code review mode fields:

```bash
comet state set <name> isolation <branch|worktree>
```

- If the user chooses `executing-plans`: run `comet state set <name> subagent_dispatch null`, then run `comet state set <name> build_mode executing-plans`
- If the user chooses `subagent-driven-development`: first confirm the current platform has real background subagent / Task / multi-agent dispatch capability; after confirming, run `comet state set <name> subagent_dispatch confirmed`, then run `comet state set <name> build_mode subagent-driven-development`
- If real background dispatch capability cannot be confirmed, do not show or write `build_mode: subagent-driven-development`. If recovered state already records that mode but capability is unavailable, return to the same Step 2 joint decision with only executable modes; do not create a separate "switch to executing-plans" pause

**TDD Mode**:

| Option | Meaning | Applicable Scenario |
|--------|---------|---------------------|
| `tdd` | Write a failing test first for each task, then implement | Recommended. Changes involving business logic, new features, APIs |
| `direct` | Implementation-first, no per-task Red-Green-Refactor requirement | Still requires relevant tests and bug-regression evidence; hotfix/tweak presets default to `direct` |

Run `comet state set <name> tdd_mode <tdd|direct>`

**Code Review Mode**:

| Option | Meaning | Applicable Scenario |
|--------|---------|---------------------|
| `off` | No automatic code review dispatch | Documentation, configuration, copywriting, small low-risk tasks |
| `standard` | No per-task reviewer by default; dispatch a per-task reviewer only when a task hits a risk signal, plus one final lightweight code review | Default recommended, suits most ordinary changes |
| `thorough` | Dispatch a per-task reviewer (spec + quality) on every task, plus one final complete review | High-risk, multi-module, architecture or security-related changes |

Run `comet state set <name> review_mode <off|standard|thorough>`

`isolation` is a script-enforced hard constraint. Full workflow init may temporarily leave it as `null`, but only before this step. If it remains `null`, both the `build → verify` guard and `comet state transition build-complete` will fail.

`subagent_dispatch` is a script-enforced hard constraint. `build_mode: subagent-driven-development` requires `subagent_dispatch: confirmed` before leaving the build phase, otherwise both `comet guard build --apply` and `comet state transition build-complete` will fail.

`tdd_mode` is a script-enforced hard constraint. Full workflow must have `tdd_mode` selected as `tdd` or `direct` before leaving the build phase, otherwise both `comet guard build --apply` and `comet state transition build-complete` will fail.

`review_mode` is a script-enforced hard constraint. Full workflow must have `review_mode` selected as `off`, `standard`, or `thorough` before leaving the build phase, otherwise both `comet guard build --apply` and `comet state transition build-complete` will fail. Legacy state files without this field follow a compat path, but should be backfilled on recovery.

`build_mode` defaults to `direct` only for hotfix/tweak presets. Full workflow must not default to `direct`. Use it only when the user explicitly asks to bypass the plan execution skills and you record an explicit override:

```bash
comet state set <name> direct_override true
comet state set <name> build_mode direct
```

Without `direct_override: true`, `build_mode=direct` in full workflow is blocked by both guard and state transition.

**Execute isolation**:

- **branch**: Use the branch name already confirmed in Step 2; do not pause again. If legacy recovery no longer has the branch name from that joint decision, re-enter the same Step 2 decision instead of creating a separate branch-naming decision.

  Branch naming convention:
  - Read the `workflow` field from `.comet.yaml` to determine the prefix
  - `workflow: full` → recommend `feature/YYYYMMDD/<change-name>`
  - `workflow: hotfix` → recommend `hotfix/YYYYMMDD/<change-name>`
  - `workflow: tweak` → recommend `tweak/YYYYMMDD/<change-name>`
  - Format the current runtime date as `YYYYMMDD`; do not depend on one shell's date command

  Example: if change name is `fix-login-bug` and today is 2026-06-09, recommend `feature/20260609/fix-login-bug`

  Immediately after Step 2 confirms the branch name, run `git checkout -b <branch-name>` and continue on the new branch.

- **worktree**: Must use the Skill tool to load the Superpowers `using-git-worktrees` skill to create isolated workspace. Do not bypass this skill with plain shell commands or native tools; if the skill is unavailable, stop the process and prompt to install or enable Superpowers skills.

After creating isolation, confirm plan file is accessible (naturally accessible with branch method; for worktree method, confirm plan has been committed). If the plan file has not been committed under worktree mode, commit it first before creating the worktree:

```bash
git add docs/superpowers/plans/YYYY-MM-DD-feature.md
git commit -m "chore: add implementation plan"
```

After entering the final execution branch or worktree, bind the current change again inside that actual workspace. A branch switch invalidates the entry binding, and a new worktree does not inherit the original workspace-local selection file:

```bash
comet state select <change-name>
```

Do not begin source writes until this binding succeeds.

**Execute plan**: Must handle execution according to the actual runtime of `build_mode`.

- `build_mode: executing-plans`: **Immediately execute:** Use the Skill tool to load the Superpowers `executing-plans` skill. Skipping this step is prohibited. If the skill is unavailable, stop the process and prompt to install or enable the corresponding skill; do not substitute with normal conversation. After the skill loads, ARGUMENTS must include the same Language constraint as Step 1: `Language: Use the configured Comet artifact language from comet state get <name> language`. Execute according to plan.
- `build_mode: subagent-driven-development`: The main session only coordinates and must not write implementation code directly. **Immediately execute:** Use the Skill tool to load the Superpowers `subagent-driven-development` skill. After the skill loads, read `comet/reference/subagent-dispatch.md` for Comet-specific extensions (real background dispatch, task isolation, checkoff verification, TDD constraints, continuous execution, context recovery) and apply them alongside the skill's workflow. If they conflict, the more specific Comet extensions take precedence.
- If the execution preflight finds that background dispatch capability has disappeared, do not execute directly in the main window and do not create a new second decision. Return to the same Step 2 joint decision with the unavailable mode removed. After the user selects main-window execution there, run `comet state set <name> build_mode executing-plans`, then continue through that branch.

**TDD Mode Execution Constraints**:

If `tdd_mode: tdd`:
- `build_mode: executing-plans`: After loading the execution skill and before executing the first task, **Immediately execute:** Use the Skill tool to load the Superpowers `test-driven-development` skill once. Skipping this step is prohibited. After the skill loads, start from the first unchecked task and follow the loaded TDD Red-Green-Refactor cycle for each task. Must not skip the failing test verification phase. Do not reload this skill for subsequent tasks; follow the already-loaded flow. If resuming after context compaction, re-run this step to load the TDD skill once, then continue from the first unchecked task.
- `build_mode: subagent-driven-development`: The main session does not load the TDD skill. TDD constraints and evidence thresholds are defined in `comet/reference/subagent-dispatch.md`; every background implementer and fix agent must use the Skill tool to load the Superpowers `test-driven-development` skill and follow the Comet-injected TDD hard constraint.

If `tdd_mode: direct`: Follow normal flow, no enforced TDD.

**`executing-plans` review gate**:

Under `executing-plans`, the main session executes tasks directly (no isolated implementer subagent), so there is no per-task reviewer as in `subagent-driven-development`. Code review is done against completed diffs and scales with `review_mode`:

- **`review_mode: off`**: No automatic code review. Do not load `requesting-code-review`. Record the skip reason in the verification report draft or tasks.md.
- **`review_mode: standard`**: After all planned tasks are complete and before the build → verify phase guard, use the Skill tool to load the Superpowers `requesting-code-review` skill once and request one lightweight code review (correctness, security, edge cases) scoped to the whole change.
- **`review_mode: thorough`**: In addition to the single final review, request one segmented code review per task segment (every 3 tasks, scoped to that segment's diff). If total tasks ≤ 3, skip the mid-execution segments and only do the final review. Each segment review uses `requesting-code-review` against the segment's commit range. This is the closest equivalent to `subagent-driven-development`'s per-task review that `executing-plans` can offer, since it has no isolated implementer to review per task.

Requirements (apply to `standard` and `thorough`):
- the `requesting-code-review` skill must be loaded before `comet guard <change-name> build --apply`
- if `requesting-code-review` is unavailable under `standard` or `thorough`, stop and ask the user to install/enable it and retry, or explicitly switch to `review_mode: off` with a recorded reason; never skip the gate or continue guard before that explicit switch
- CRITICAL review findings (security vulnerabilities, data loss risk, build/test failures) must be fixed first and must not be carried into verify
- if non-CRITICAL review findings are accepted, record the acceptance reason and impact scope in tasks.md, the commit body, a verification report draft, or another durable artifact

### 3b. In-Execution Debugging (Debug Gate)

During task execution, whenever a crash, unexpected behavior, test failure, or build failure appears while running the program, tests, build, or manual verification, must use the Skill tool to load the Superpowers `systematic-debugging` skill. Before root-cause investigation is complete, must not propose or implement source-code fixes.

For specific investigation, minimal failing test, fix verification, and keeping the current change verification loop, follow `comet/reference/debug-gate.md`.

### 4. Spec Incremental Updates

When the initial spec is found incomplete during implementation, handle by scale:

| Scale | Trigger Conditions | Approach |
|------|-------------------|----------|
| Small | Missing acceptance scenarios, edge cases | Directly edit delta spec + design.md, append tasks.md tasks |
| Medium | Interface changes, new components, data flow changes | **Must use the current platform's available user input/confirmation mechanism to pause and wait for the user to explicitly confirm**, then must use Skill tool to load the Superpowers `brainstorming` skill to update Design Doc + delta spec |
| Large | Brand-new capability requirements | **Must use the current platform's available user input/confirmation mechanism to pause and wait for the user to explicitly confirm the split**; after user confirms, create independent change through `/comet-open` |

**50% Threshold Determination**: Using initial task count in tasks.md as baseline, if new tasks exceed half of that total, it's considered outside original plan scope, **must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to decide whether to split into a new change**.

When creating an independent change, must invoke `/comet-open`, not `/opsx:new` directly. `/comet-open` creates both OpenSpec artifacts and `.comet.yaml`, preventing the new change from leaving the Comet state machine.

**User choices must include**:
- "Split into new change" — create independent change via `/comet-open`
- "Continue in current change" — record scope-expansion decision, update tasks.md and delta spec, then continue

**Principles**:
- Delta spec is a living document, can be modified at any time during this phase
- Each update should be committed with commit message explaining the change reason
- Do not sync to main spec in advance, sync uniformly during archiving
- For small-scale incremental direct delta spec edits, note in commit message to facilitate design doc drift assessment during archiving

### 5. Context Management

Build is the longest phase and may span many tasks. To support resume after context compaction:

- **After each task**: complete acceptance per the current execution branch and `review_mode` before checking off and committing. `subagent-driven-development` dispatches no per-task reviewer under `off`; under `standard`, a per-task reviewer fires only when the task hits a risk signal; under `thorough`, every task gets a per-task reviewer. All modes must perform targeted verification by unique task text. Parse tasks.md checkboxes to count remaining work without rereading unrelated task bodies
- **Context compression recovery**: Follow `comet/reference/context-recovery.md` with phase set to `build`.
- **User manual-change resume**: handle uncommitted changes through `comet/reference/dirty-worktree.md`. That protocol defines checks, attribution, and prohibitions. Build-specific handling:
  1. After attribution, if the diff implies plan or spec changes, handle it through Step 4 "Spec Incremental Updates"
- **Long task split**: if a single task exceeds 200 lines of code changes, consider splitting it into multiple subtasks and commits

## Exit Conditions

- All tasks.md checked
- Code committed
- Project-specific build/tests explicitly run and pass; do not rely only on guard auto-detection
- `isolation` has been written as `branch` or `worktree`
- `build_mode` has been written as `subagent-driven-development`, `executing-plans`, or `direct` with explicit override; if `subagent-driven-development`, `subagent_dispatch` must be `confirmed`
- `tdd_mode` has been written as `tdd` or `direct`
- `review_mode` has been written as `off`, `standard`, or `thorough`
- Code review has been completed per the `executing-plans` review gate (Section "Execute plan") for the chosen `review_mode`: under `standard` or `thorough`, code review has been requested and CRITICAL review findings fixed or non-CRITICAL acceptance rationale recorded; under `review_mode: off`, the reason for skipping automatic code review has been recorded in a persistent artifact
- **Phase guard**: Run `comet guard <change-name> build --apply`; after all PASS, state advances to `phase: verify`

Guard runs the inferred project build check (`npm run build`, Maven, or Cargo when detected). When the inferred command fails, guard prints the command output as evidence for debugging.

If the project has no automatically inferred build command, the user or Agent must run the real build command first, then record its evidence separately:

```bash
comet state record-check <change-name> build --command "<actual build command>" --exit-code 0
```

`--command` records command text only; Comet **never executes it**. Build and verify evidence are separate and cannot substitute for each other. `COMET_SKIP_BUILD=1` is only a compatibility bypass for legacy workflows, not auditable build evidence.

Before exit, run guard to auto-transition:

```bash
comet guard <change-name> build --apply
```

State file is automatically updated to `phase: verify`, `verify_result: pending`.

## Automatic Handoff to Next Phase

Follow `comet/reference/auto-transition.md`. Key command:

```bash
comet state next <change-name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to enter the next phase
- `NEXT: manual` → do not invoke the next skill; return control with `HINT`, end the invocation, and do not create another confirmation point
- `NEXT: done` → workflow is complete, no further action needed
