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

**Idempotency**: All build phase operations can be safely re-executed. Read `.comet.yaml` `phase` field to confirm still in build, read plan header `base-ref`, then read tasks.md to find the first unchecked task. Already-committed tasks must not be re-committed.

### 1. Create Plan

**Immediately execute:** Use the Skill tool to load the Superpowers `writing-plans` skill. Skipping this step is prohibited.

When loading the skill, ARGUMENTS must include:

```
Language: Use the language of the user request that triggered this workflow.
```

After the skill loads, follow its guidance to create a plan. Plan files and execution feedback must use the language of the user request that triggered this workflow. Plan requirements:
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

This is a user decision point. **Must use the AskUserQuestion tool to pause and wait for the user to explicitly choose**. Must not auto-continue and must not write the pause into `build_mode`.

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

This is a user decision point. **Must use the AskUserQuestion tool to pause and wait for the user to explicitly choose both isolation method and execution method**. Must not choose `branch` or `worktree` based on recommendation rules, and must not choose the execution method based on recommendation rules. Recommendation rules are for suggestion only, not a substitute for user confirmation. Must not just output a text prompt and then continue executing.

After user selection, update `isolation` and `build_mode` fields:

```bash
"$COMET_BASH" "$COMET_STATE" set <name> isolation <branch|worktree>
"$COMET_BASH" "$COMET_STATE" set <name> build_mode <subagent-driven-development|executing-plans|direct>
```

`isolation` is a script-enforced hard constraint. Full workflow init may temporarily leave it as `null`, but only before this step. If it remains `null`, both the `build → verify` guard and `comet-state transition build-complete` will fail.

`build_mode` defaults to `direct` only for hotfix/tweak presets. Full workflow must not default to `direct`. Use it only when the user explicitly asks to bypass the plan execution skills and you record an explicit override:

```bash
"$COMET_BASH" "$COMET_STATE" set <name> direct_override true
"$COMET_BASH" "$COMET_STATE" set <name> build_mode direct
```

Without `direct_override: true`, `build_mode=direct` in full workflow is blocked by both guard and state transition.

**Execute isolation**:

- **branch**: Run `git checkout -b <change-name>`, subsequent work on the new branch
- **worktree**: Must use the Skill tool to load the Superpowers `using-git-worktrees` skill to create isolated workspace. Do not bypass this skill with plain shell commands or native tools; if the skill is unavailable, stop the process and prompt to install or enable Superpowers skills.

After creating isolation, confirm plan file is accessible (naturally accessible with branch method; for worktree method, confirm plan has been committed).

**Load execution skill**: Use the Skill tool to load the corresponding skill. Skipping this step is prohibited.

If the selected Superpowers skill is unavailable, stop the process and prompt to install or enable the corresponding skill. Do not substitute this step with normal conversation.

When loading `subagent-driven-development` or `executing-plans`, ARGUMENTS must include the same Language constraint.

After the skill loads, follow its guidance to execute:
- Execute tasks according to plan
- Complete tasks.md check (`- [ ]` → `- [x]`)
- Commit code after each task completion

### 4. Spec Incremental Updates

When the initial spec is found incomplete during implementation, handle by scale:

| Scale | Trigger Conditions | Approach |
|------|-------------------|----------|
| Small | Missing acceptance scenarios, edge cases | Directly edit delta spec + design.md, append tasks.md tasks |
| Medium | Interface changes, new components, data flow changes | **Must use the AskUserQuestion tool to pause and wait for the user to explicitly confirm**, then must use Skill tool to load the Superpowers `brainstorming` skill to update Design Doc + delta spec |
| Large | Brand-new capability requirements | **Must use the AskUserQuestion tool to pause and wait for the user to explicitly confirm the split**; after user confirms, create independent change through `/comet-open` |

When loading `brainstorming` for a medium-scale Spec incremental update, ARGUMENTS must include the same Language constraint as Step 1:

```text
Language: Use the language of the user request that triggered this workflow.
```

**50% Threshold Determination**: Using initial task count in tasks.md as baseline, if new tasks exceed half of that total, it's considered outside original plan scope, **must use the AskUserQuestion tool to pause and wait for the user to decide whether to split into a new change**. Must not just output a text prompt and then continue executing.

When creating an independent change, must invoke `/comet-open`, not `/opsx:new` directly. `/comet-open` creates both OpenSpec artifacts and `.comet.yaml`, preventing the new change from leaving the Comet state machine.

**Principles**:
- Delta spec is a living document, can be modified at any time during this phase
- Each update should be committed with commit message explaining the change reason
- Do not sync to main spec in advance, sync uniformly during archiving
- For small-scale incremental direct delta spec edits, note in commit message to facilitate design doc drift assessment during archiving

### 5. Context Management

Build is the longest phase and may span many tasks. To support resume after context compaction:

- **After each task**: immediately check off tasks.md and commit code so `.comet.yaml` and file state are durable
- **After context compaction**: first run `"$COMET_BASH" "$COMET_STATE" check <change-name> build --recover` — the script outputs structured recovery context (isolation/build_mode status, plan path, task progress, recovery action). Follow the Recovery action to determine next step.
- **User manual-change resume**: handle uncommitted changes through `comet/reference/dirty-worktree.md`. That protocol defines checks, attribution, and prohibitions. Build-specific handling:
  1. After attribution, if the diff implies plan or spec changes, handle it through Step 4 "Spec Incremental Updates"
- **Long task split**: if a single task exceeds 200 lines of code changes, consider splitting it into multiple subtasks and commits

## Exit Conditions

- All tasks.md checked
- Code committed
- Project-specific build/tests explicitly run and pass; do not rely only on guard auto-detection
- `isolation` has been written as `branch` or `worktree`
- `build_mode` has been written as `subagent-driven-development`, `executing-plans`, or `direct` with explicit override
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

## Automatic Transition

After exit conditions are met (including user selecting workflow configuration), auto-transition to next phase:

> **REQUIRED NEXT SKILL:** Invoke `comet-verify` skill to enter the verification and completion phase.
