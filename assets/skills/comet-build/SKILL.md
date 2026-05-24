---
name: comet-build
description: "Comet Phase 3: Plan and Build. Invoke with /comet-build. Create plans and choose execution method (subagent or direct) for implementation."
---

# Comet Phase 3: Plan and Build (Build)

## Prerequisites

- Design Doc has been created (Phase 2 complete)
- Active change exists

## Steps

### 0. Entry State Verification (Entry Check)

Execute entry verification:

```bash
COMET_SEARCH_ROOTS=("." "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.cursor/skills")
COMET_STATE="${COMET_STATE:-$(find "${COMET_SEARCH_ROOTS[@]}" -path '*/comet/scripts/comet-state.sh' -type f -print -quit 2>/dev/null)}"
COMET_GUARD="${COMET_GUARD:-$(find "${COMET_SEARCH_ROOTS[@]}" -path '*/comet/scripts/comet-guard.sh' -type f -print -quit 2>/dev/null)}"
bash "$COMET_STATE" check <name> build
```

Proceed to Step 1 after verification passes. The script outputs specific failure reasons when verification fails.

### 1. Create Plan

**Immediately execute:** Use the Skill tool to load the `superpowers:writing-plans` skill. Skipping this step is prohibited.

After the skill loads, follow its guidance to create a plan. Plan requirements:
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

### 2. Update Plan Status

Record plan path:

```bash
bash "$COMET_STATE" set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

No manual phase update needed — guard auto-transitions when exit conditions are met.

### 3. Workspace Isolation

Plan has been written to the current branch. Before starting execution, choose workspace isolation method:

| Option | Method | Description |
|--------|--------|-------------|
| A | Create branch | Create a new branch in the current repo, simple and fast |
| B | Create Worktree | Isolated workspace, fully independent, suitable for parallel development |

**Recommendation rules**:
- Change involves ≤ 3 files → Recommend A
- Need parallel development, current branch has uncommitted work → Recommend B

After user selection, update `isolation` field. `isolation` only allows one of the following values:

```bash
bash "$COMET_STATE" set <name> isolation <value>
```

- `branch`
- `worktree`

<IMPORTANT>
This is a script-enforced hard constraint, not a suggestion. Full workflow init may temporarily leave `isolation` as `null`, but only before this step.
Before implementation starts, stop and ask the user, then write either `branch` or `worktree`. If it remains `null`, both the `build → verify` guard and `comet-state transition build-complete` will fail.
</IMPORTANT>

**Execute isolation**:

- **branch**: Run `git checkout -b <change-name>`, subsequent work on the new branch
- **worktree**: Invoke `superpowers:using-git-worktrees` skill or use native `EnterWorktree` tool to create isolated workspace

After creating isolation, confirm plan file is accessible (naturally accessible with branch method; for worktree method, confirm plan has been committed).

### 4. Select Execution Method

Present plan summary to user (task count, involved modules), then ask for execution method:

| Option | Skill | Applicable Scenario |
|------|------|-------------------|
| A | `superpowers:subagent-driven-development` | Independent tasks, high complexity, requires two-phase review |
| B | `superpowers:executing-plans` | Simple tasks, no subagent environment, lightweight and fast |

**Recommendation rules**:
- Task count ≥ 3 → Recommend A
- Task count ≤ 2 and no cross-module dependencies → Recommend B
- From hotfix path → Recommend B

After user selection, update `build_mode` field. `build_mode` only allows one of the following values:

```bash
bash "$COMET_STATE" set <name> build_mode <value>
```

- `subagent-driven-development`
- `executing-plans`
- `direct` (default only for hotfix/tweak preset use)

Full workflow must not default to `direct`. Use it only when the user explicitly asks to bypass the plan execution skills and you record an explicit override:

```bash
bash "$COMET_STATE" set <name> direct_override true
bash "$COMET_STATE" set <name> build_mode direct
```

Without `direct_override: true`, `build_mode=direct` in full workflow is blocked by both guard and state transition.

Then, **immediately execute:** Use the Skill tool to load the corresponding skill. Skipping this step is prohibited.

If the selected Superpowers skill is unavailable, stop the process and prompt to install or enable the corresponding skill. Do not substitute this step with normal conversation.

After the skill loads, follow its guidance to execute:
- Execute tasks according to plan
- Complete tasks.md check (`- [ ]` → `- [x]`)
- Commit code after each task completion

### 5. Spec Incremental Updates

When the initial spec is found incomplete during implementation, handle by scale:

| Scale | Trigger Conditions | Approach |
|------|-------------------|----------|
| Small | Missing acceptance scenarios, edge cases | Directly edit delta spec + design.md, append tasks.md tasks |
| Medium | Interface changes, new components, data flow changes | Re-run `superpowers:brainstorming` to update Design Doc + delta spec |
| Large | Brand-new capability requirements | `/comet-open` to create independent change |

**50% Threshold Determination**: Using initial task count in tasks.md as baseline, if new tasks exceed half of that total, it's considered outside original plan scope, should consider splitting into new change.

**Principles**:
- Delta spec is a living document, can be modified at any time during this phase
- Each update should be committed with commit message explaining the change reason
- Do not sync to main spec in advance, sync uniformly during archiving
- For small-scale incremental direct delta spec edits, note in commit message to facilitate design doc drift assessment during archiving

### 6. Context Management

Build is the longest phase and may span many tasks. To support resume after context compaction:

- **After each task**: immediately check off tasks.md and commit code so `.comet.yaml` and file state are durable
- **After context compaction**: read `.comet.yaml` to confirm the phase is still build, read the plan header `base-ref`, then read tasks.md to find the next unchecked task
- **Long task split**: if a single task exceeds 200 lines of code changes, consider splitting it into multiple subtasks and commits

## Exit Conditions

- All tasks.md checked
- Code committed
- Project-specific build/tests explicitly run and pass; do not rely only on guard auto-detection
- `isolation` has been written as `branch` or `worktree`
- `build_mode` has been written as `subagent-driven-development`, `executing-plans`, or `direct` with explicit override
- **Phase guard**: Run `bash "$COMET_GUARD" <change-name> build --apply`; after all PASS, state advances to `phase: verify`

Guard reads project command configuration first:

```yaml
build_command: <build command>
verify_command: <verify command>
```

Configuration can live in the change `.comet.yaml`, or in repo-root `.comet.yaml` / `comet.yaml` / `.comet.yml` / `comet.yml`.
Only when no command is configured does guard fall back to `npm run build`, Maven, or Cargo auto-detection. When a command fails, guard prints the command output as evidence for debugging.

Before exit, run guard to auto-transition:

```bash
bash "$COMET_GUARD" <change-name> build --apply
```

State file is automatically updated to `phase: verify`, `verify_result: pending`.

## Automatic Transition

After exit conditions are met, **proceed immediately to the next phase without waiting for user input**:

> **REQUIRED NEXT SKILL:** Invoke `comet-verify` skill to enter the verification and completion phase.
