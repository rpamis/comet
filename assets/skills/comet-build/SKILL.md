---
name: comet-build
description: "Comet Phase 3: Plan and Build. Invoke with /comet-build. Create plans and select execution method (subagent or direct) for implementation."
---

# Comet Phase 3: Plan and Build (Build)

## Prerequisites

- Design Doc has been created (Phase 2 complete)
- Active change exists

## Steps

### 0. Entry State Verification (Entry Check)

Execute entry verification:

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
"$COMET_BASH" "$COMET_STATE" check <name> build
```

Proceed to Step 1 after verification passes. The script outputs specific failure reasons when verification fails.

**Idempotency**: All build phase operations can be safely re-executed. Read `.comet.yaml` `phase` field to confirm still in build, read plan header `base-ref`, then use `grep -n '\- \[ \]' tasks.md | head -1` to find the first unchecked task. Already-committed tasks must not be re-committed.

### 1. Create Plan (Subagent Offload)

Create the implementation plan through a subagent, avoiding planning skill occupying main session context. Plan files and execution feedback must use the configured Comet artifact language from `"$COMET_BASH" "$COMET_STATE" get <name> language`.

**Subagent instructions**:

You are an implementation planning expert. Create an implementation plan based on the following inputs:

1. **Immediately execute:** Use the Skill tool to load the Superpowers `writing-plans` skill. Skipping this step is prohibited. After the skill loads, ARGUMENTS must include: `Language: Use the configured Comet artifact language from "$COMET_BASH" "$COMET_STATE" get <name> language`
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

### 2. Update Plan Status and Provide Plan-Ready Pause Point

Record plan path:

```bash
"$COMET_BASH" "$COMET_STATE" set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

No manual phase update needed — guard auto-transitions when exit conditions are met.

After the plan is recorded, immediately provide a new user decision point:

| Option | Behavior | Description |
|--------|----------|-------------|
| A | Continue execution | Stay in the current model and proceed to Step 3 to choose workspace isolation and execution method |
| B | Pause to switch model | Record `build_pause: plan-ready`, stop this `/comet-build` invocation, and allow the user to resume later from `/comet` or `/comet-build` |

This is a user decision point. **Must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to explicitly choose**. Must not auto-continue and must not write the pause into `build_mode`.

When the user chooses to continue:

```bash
"$COMET_BASH" "$COMET_STATE" set <name> build_pause null
```

When the user chooses to pause:

```bash
"$COMET_BASH" "$COMET_STATE" set <name> build_pause plan-ready
```

After setting `build_pause: plan-ready`, stop the current invocation. Do not choose `isolation` or `build_mode`, and do not load an execution skill.

### 3. Select Workflow Configuration

If resuming with `build_pause: plan-ready` and the `plan` file exists, do not rerun `writing-plans`. First tell the user the workflow is stopped at the plan-ready pause point; after the user confirms continuing, set:

```bash
"$COMET_BASH" "$COMET_STATE" set <name> build_pause null
```

Then continue this step to choose workspace isolation and execution method.

Plan has been written to the current branch. Before starting execution, **ask the user to choose both workspace isolation and execution method in a single interaction**:

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
| A | Superpowers `subagent-driven-development` | Independent tasks, high complexity, requires two-phase review |
| B | Superpowers `executing-plans` | Simple tasks, no subagent environment, lightweight and fast |

**Execution method recommendation rules**:
- Task count ≥ 3 → Recommend A
- Task count ≤ 2 and no cross-module dependencies → Recommend B
- From hotfix path → Recommend B

This is a user decision point. **Must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to explicitly choose isolation method, execution method, and TDD mode**. Must not choose `branch` or `worktree` based on recommendation rules, and must not choose the execution method or TDD mode based on recommendation rules. Recommendation rules are for suggestion only, not a substitute for user confirmation.

After user selection, update `isolation`, execution method, and TDD mode fields:

```bash
"$COMET_BASH" "$COMET_STATE" set <name> isolation <branch|worktree>
```

- If the user chooses `executing-plans`: run `"$COMET_BASH" "$COMET_STATE" set <name> subagent_dispatch null`, then run `"$COMET_BASH" "$COMET_STATE" set <name> build_mode executing-plans`
- If the user chooses `subagent-driven-development`: first confirm the current platform has real background subagent / Task / multi-agent dispatch capability; after confirming, run `"$COMET_BASH" "$COMET_STATE" set <name> subagent_dispatch confirmed`, then run `"$COMET_BASH" "$COMET_STATE" set <name> build_mode subagent-driven-development`
- If real background dispatch capability cannot be confirmed, must not write `build_mode: subagent-driven-development`; must pause and wait for the user to choose `executing-plans` instead

**TDD Mode**:

| Option | Meaning | Applicable Scenario |
|--------|---------|---------------------|
| `tdd` | Write a failing test first for each task, then implement | Recommended. Changes involving business logic, new features, APIs |
| `direct` | Implement directly, no enforced TDD flow | Changes that don't need test coverage, or user chooses to skip tests and write code directly. hotfix/tweak presets default to `direct` |

Run `"$COMET_BASH" "$COMET_STATE" set <name> tdd_mode <tdd|direct>`

`isolation` is a script-enforced hard constraint. Full workflow init may temporarily leave it as `null`, but only before this step. If it remains `null`, both the `build → verify` guard and `comet-state transition build-complete` will fail.

`subagent_dispatch` is a script-enforced hard constraint. `build_mode: subagent-driven-development` requires `subagent_dispatch: confirmed` before leaving the build phase, otherwise both `comet-guard.sh build --apply` and `comet-state transition build-complete` will fail.

`tdd_mode` is a script-enforced hard constraint. Full workflow must have `tdd_mode` selected as `tdd` or `direct` before leaving the build phase, otherwise both `comet-guard.sh build --apply` and `comet-state transition build-complete` will fail.

`build_mode` defaults to `direct` only for hotfix/tweak presets. Full workflow must not default to `direct`. Use it only when the user explicitly asks to bypass the plan execution skills and you record an explicit override:

```bash
"$COMET_BASH" "$COMET_STATE" set <name> direct_override true
"$COMET_BASH" "$COMET_STATE" set <name> build_mode direct
```

Without `direct_override: true`, `build_mode=direct` in full workflow is blocked by both guard and state transition.

**Execute isolation**:

- **branch**: Recommend a branch name based on the workflow type and current date, then let the user confirm or input a custom name. This is a user decision point — **must use the current platform's available user input/confirmation mechanism to pause and wait for the user to explicitly confirm or override the branch name**. Must not skip this step and create the branch directly.

  Branch naming convention:
  - Read the `workflow` field from `.comet.yaml` to determine the prefix
  - `workflow: full` → recommend `feature/YYYYMMDD/<change-name>`
  - `workflow: hotfix` → recommend `hotfix/YYYYMMDD/<change-name>`
  - `workflow: tweak` → recommend `tweak/YYYYMMDD/<change-name>`
  - Date is derived from `date +%Y%m%d` at runtime

  Example: if change name is `fix-login-bug` and today is 2026-06-09, recommend `feature/20260609/fix-login-bug`

  After the user confirms or provides a custom branch name, run `git checkout -b <branch-name>`, subsequent work on the new branch.

- **worktree**: Must use the Skill tool to load the Superpowers `using-git-worktrees` skill to create isolated workspace. Do not bypass this skill with plain shell commands or native tools; if the skill is unavailable, stop the process and prompt to install or enable Superpowers skills.

After creating isolation, confirm plan file is accessible (naturally accessible with branch method; for worktree method, confirm plan has been committed). If the plan file has not been committed under worktree mode, commit it first before creating the worktree:

```bash
git add docs/superpowers/plans/YYYY-MM-DD-feature.md
git commit -m "chore: add implementation plan"
```

**Execute plan**: Must handle execution according to the actual runtime of `build_mode`.

- `build_mode: executing-plans`: **Immediately execute:** Use the Skill tool to load the Superpowers `executing-plans` skill. Skipping this step is prohibited. If the skill is unavailable, stop the process and prompt to install or enable the corresponding skill; do not substitute with normal conversation. After the skill loads, ARGUMENTS must include the same Language constraint as Step 1: `Language: Use the configured Comet artifact language from "$COMET_BASH" "$COMET_STATE" get <name> language`. Execute according to plan.
- `build_mode: subagent-driven-development`: The main session only coordinates and must not write implementation code directly. **Immediately execute:** Use the Skill tool to load the Superpowers `subagent-driven-development` skill. After the skill loads, read `comet/reference/subagent-dispatch.md` for Comet-specific extensions (real background dispatch, task isolation, checkoff verification, TDD constraints, continuous execution, context recovery) and apply them alongside the skill's workflow. If they conflict, the more specific Comet extensions take precedence.
- If the current platform has no real background agent dispatch capability, must pause and wait for the user to choose main window execution instead. After the user chooses, must run `"$COMET_BASH" "$COMET_STATE" set <name> build_mode executing-plans`, then follow the `build_mode: executing-plans` branch to load the Superpowers `executing-plans` skill. Must not continue executing tasks before the user explicitly chooses.

**TDD Mode Execution Constraints**:

If `tdd_mode: tdd`:
- `build_mode: executing-plans`: After loading the execution skill and before executing the first task, **Immediately execute:** Use the Skill tool to load the Superpowers `test-driven-development` skill once. Skipping this step is prohibited. After the skill loads, start from the first unchecked task and follow the loaded TDD Red-Green-Refactor cycle for each task. Must not skip the failing test verification phase. Do not reload this skill for subsequent tasks; follow the already-loaded flow. If resuming after context compaction, re-run this step to load the TDD skill once, then continue from the first unchecked task.
- `build_mode: subagent-driven-development`: The main session does not load the TDD skill. TDD constraints and evidence thresholds are defined in `comet/reference/subagent-dispatch.md`; every background implementer and fix agent must use the Skill tool to load the Superpowers `test-driven-development` skill and follow the Comet-injected TDD hard constraint.

If `tdd_mode: direct`: Follow normal flow, no enforced TDD.

**`executing-plans` review gate**:

When `build_mode` is `executing-plans`, after all planned tasks are complete and before running the build → verify phase guard, must use the Skill tool to load the Superpowers `requesting-code-review` skill and request code review at least once.

Requirements:
- the `requesting-code-review` skill must be loaded before `"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply`
- if `requesting-code-review` skill is unavailable, skip the review gate but must record `<!-- review skipped: skill unavailable -->` in tasks.md, then continue guard transition
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

- **After each task**: complete acceptance per the current execution branch before checking off and committing. `subagent-driven-development` must wait for both reviews to pass and perform targeted verification by unique task text. Use `grep -c '\- \[ \]' tasks.md` to check remaining unchecked count; no need to re-read the entire file
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
- If `build_mode` is `executing-plans`, the Skill tool has been used to load the Superpowers `requesting-code-review` skill and request code review at least once, and CRITICAL review findings have been fixed or acceptance rationale for non-CRITICAL review findings has been recorded
- **Phase guard**: Run `"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply`; after all PASS, state advances to `phase: verify`

Guard reads project command configuration first:

```yaml
build_command: <build command>
verify_command: <verify command>
```

Configuration can live in the change `.comet.yaml`, or in repo-root `.comet.yaml` / `comet.yaml` / `.comet.yml` / `comet.yml`.
Only when no command is configured does guard fall back to `npm run build`, Maven, or Cargo auto-detection. When a command fails, guard prints the command output as evidence for debugging.

Before exit, run guard to auto-transition:

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply
```

State file is automatically updated to `phase: verify`, `verify_result: pending`.

## Automatic Handoff to Next Phase

Follow `comet/reference/auto-transition.md`. Key command:

```bash
"$COMET_BASH" "$COMET_STATE" next <change-name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to enter the next phase
- `NEXT: manual` → do not invoke the next skill; prompt user to run `/<SKILL>` manually
- `NEXT: done` → workflow is complete, no further action needed
