---
name: comet-build
description: 'Phase 3 of Comet Classic — recover or create the implementation plan and execute its tasks.'
---

# Comet Phase 3: Plan and Build (Build)

After entry returns layout, bind logical roots under `comet-classic/reference/classic-layout.md`; do not reload the protocol if it is already in context. OpenSpec CLI calls use the adapter and paths use the bound `<classic-*>` roots, without a separate root show first.

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

### 1. Confirm the Execution Strategy First

Use entry configuration, taskState, and nextAction. Resume valid configuration, plans, and review records without asking or generating again. The workspace must already be prepared and bound during Open. Stop if isolation is missing or the directory does not match; restore the projectRoot returned by workspace resolve. Do not create or switch workspaces in Build.

**An execution strategy must be confirmed before writing the plan.** If configuration is missing or the user explicitly requests a change, provide one joint decision under `comet-classic/reference/decision-point.md` for execution, TDD, and review modes. Do not auto-select by model name:

| build_mode                    | Behavior                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autonomous`                  | Explicitly selected autonomous strategy: the Agent creates a compact plan and chooses serial implementation or bounded work-package delegation; external planning/execution Skills are not mandatory |
| `subagent-driven-development` | Load the matching Superpowers Skill; the main session coordinates and implementers execute under Comet's dispatch and review contract                                                                |
| `executing-plans`             | Load the matching Superpowers Skill; the main session implements the plan sequentially                                                                                                               |

Recommend autonomous for capable autonomous planners that need flexible long-task organization, subagent-driven-development for a fixed delegation method, or executing-plans for a fixed sequential method. Recommendations do not replace user confirmation; do not automatically replace an existing change's strategy.

| Setting       | Choices and Constraints                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tdd_mode`    | `tdd`: verify a genuine RED, implement, then obtain GREEN; `direct`: no mandatory per-task RED/GREEN, but retain relevant tests and bug-regression evidence                    |
| `review_mode` | `off`: no automatic review for low-risk tasks; `standard`: risk-task review and Verify's only final integrated review; `thorough`: per-task review and final integrated review |

Full autonomous requires standard or thorough; self-review cannot replace independent review. Existing strategies retain their review_mode rules. Recommend tdd and standard by default; hotfix/tweak direct presets remain unchanged.

Write the complete selection atomically. For example, after explicit selection of autonomous, TDD, and standard:

```bash
comet state set <name> build_mode autonomous subagent_dispatch null tdd_mode tdd review_mode standard --json
comet state check <name> build --json
```

Use the actual selection. Set `subagent_dispatch confirmed` with subagent-driven-development, and null for other methods. Preserve isolation, bound_branch, and an existing pause. Stop on write failure without loading execution Skills. If the user has not decided or requests a pause, stop without writing partial configuration.

`direct` is not an alias for autonomous. Full allows direct only on explicit user request with `direct_override true`; autonomous cannot bypass design, planning, configuration, verification, or independent review.

### 2. Create or Restore the Plan

`tasks.md` is the sole completion authority. Run `comet state tasks <name> --json` only when individual task text or IDs are needed. Assign missing IDs with `comet state tasks <name> --assign-ids --json`, preserving existing IDs and refreshing affected handoff and plan mappings.

Follow context-recovery.md for recovery, legacy checkbox synchronization, and checkoff: unchecked does not mean unimplemented. Check off implemented tasks with sufficient check and review evidence; complete only missing work. task-complete automatically synchronizes legacy plans with comet-task ID mappings. Use `comet state sync-plan <name>` for standalone synchronization; planSync mapping-required requires mapping reconciliation, not reimplementation.

Retain a valid existing plan. Otherwise create `<classic-superpowers-root>/plans/<YYYY-MM-DD>-<change-name>.md` using configuration.language:

- autonomous: the current Agent writes and self-checks the plan directly, without loading writing-plans.
- Other plan execution strategies: use the `writing-plans` Skill for writing and self-checking only; stop if it fails. Pass confirmed configuration, design_doc, tasks.md, the fixed plan path, and current `git rev-parse HEAD`. Return to Comet Build without choosing the execution strategy again or entering an external lifecycle.

All strategies use the same plan contract: each item is an independently acceptable outcome with task ID, scope, dependencies, constraints, and acceptance commands/scenarios. Organize preparation, implementation, tests, and documentation around outcomes, not minutes, file counts, or RED/GREEN steps. Reference design and requirements without prewriting full implementations; include necessary snippets only for interfaces or high-risk algorithms requiring advance review.

New plans do not create duplicate checkboxes. Write `<!-- comet-task-authority: <classic-change-dir>/tasks.md -->` and associate each task with `<!-- comet-task-ref:<task-id> -->`. Genuine additional tasks must first enter tasks.md and receive IDs; handle scope changes under Step 4.

Plan frontmatter:

```yaml
---
change: <change-name>
design-doc: <recorded-design-doc-path>
base-ref: <git rev-parse HEAD before implementation>
---
```

Preserve an existing plan's base-ref; do not replace it with current HEAD during recovery. Confirm the file exists, then record it:

```bash
comet state set <name> plan <plan-path>
```

After planning, continue under the confirmed strategy without another configuration confirmation. If the user explicitly requests switching models or pausing after planning, write `comet state set <name> build_pause plan-ready` and stop. Clear an existing plan-ready pause only after the user explicitly asks to continue. Retain valid plans and configuration; for older changes missing configuration, complete Step 1 without rewriting the plan.

### 3. Execute and Accept

Use this entry's configuration before execution; refresh after configuration, requirement, or workspace changes. External Skills execute only the current plan and confirmed settings. They must not create Worktrees, reselect isolation, add final review, or invoke finishing-a-development-branch; return to Comet Build after task execution.

- autonomous: the Agent organizes implementation within the plan. For delegation, read `comet-classic/reference/subagent-dispatch.md` and use bounded work packages, Runtime coordination records, and independent reviewers; external execution Skills are not mandatory.
- executing-plans: use the Skill tool to load Superpowers `executing-plans`, pass entry configuration.language, and execute sequentially. Stop if loading fails.
- subagent-driven-development: load the matching Superpowers Skill and `comet-classic/reference/subagent-dispatch.md`. The main session coordinates rather than implementing; save the BLOCKED reason on dispatch failure without silently taking over or changing strategy.

Under tdd, every implementation task requires a matching genuine RED and corresponding GREEN command with actual results. Autonomous does not require an external TDD Skill but still requires RED/GREEN. executing-plans loads test-driven-development once before the first implementation; implementers load it under the subagent strategy. Do not reload in intact context. Cold recovery first checks existing evidence, without reenacting verified implementation or reverting code to fabricate RED. Direct mode still requires relevant checks and bug-regression evidence.

Build performs only task-level or segmented review; Verify owns the only final integrated review:

- autonomous and subagent execution: apply the risk and budget rules in subagent-dispatch.md for independent task review. Even without delegated implementation, autonomous requires independent reviewers where review is required.
- executing-plans + off|standard: enter Verify after task acceptance; do not add a Build final review.
- executing-plans + thorough: review each three-task segment's diff; when there are no more than three tasks in total, defer to Verify's final review.

CRITICAL/IMPORTANT findings must be resolved. Stop if review is unavailable; do not replace it with self-review. Record rationale and scope for accepted noncritical deviations. After acceptance, use task-complete to check off tasks.md by ID. Save collaboration and recovery records through `comet state checkpoint <name> --file <json-path>`; field and read/write rules are in context-recovery.md. Checkpoints do not replace task checkoff or actual evidence.

### 3b. In-Execution Debugging (Debug Gate)

During execution, unexpected crashes, behavior, test failures, or build failures require root-cause investigation first. Autonomous follows the Debug Gate directly; other strategies load Superpowers `systematic-debugging`. Do not implement source fixes before the cause is understood. A TDD RED verified to fail because the target behavior is not yet implemented is normal evidence; loading/environment errors, unrelated regressions, and unexplained RED still require investigation.

For specific investigation, minimal failing test, fix verification, and keeping the current change verification loop, follow `comet-classic/reference/debug-gate.md`.

### 4. Spec Incremental Updates

When the initial spec is found incomplete during implementation, handle by scale:

For implementation-detail adjustments within confirmed scope that do not change public behavior or acceptance constraints, update only the plan and rationale without reopening Open/Design. The following scale rules apply only to genuine spec or scope changes.

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

- **After each task**: check the actual implementation, checks, and reviews under the selected configuration, then check off tasks.md with `comet state task-complete <name> <task-id> --expect <revision> --json`. Use the inspected task revision; reassess changed requirements rather than blindly refreshing and retrying. New plans and checkpoints do not copy checkboxes; synchronize only explicitly mapped legacy items under context-recovery.md. Accept work packages per ID, persist coordination through checkpoint commands, and follow project commit policy.
- **Context compression recovery**: Follow `comet-classic/reference/context-recovery.md` with phase set to `build`.
- **User manual-change resume**: handle uncommitted changes through `comet-classic/reference/dirty-worktree.md`. That protocol defines checks, attribution, and prohibitions. Build-specific handling:
  1. After attribution, if the diff implies plan or spec changes, handle it through Step 4 "Spec Incremental Updates"
- **Long task split**: split by independently acceptable outcomes and dependency boundaries; line count indicates review risk but does not determine task count.

## Exit Conditions

- All tasks.md checked
- Code committed
- Project-specific build/tests explicitly run and pass; do not rely only on guard auto-detection
- `isolation` has been written as `current`, `branch`, or `worktree`
- `build_mode` is `autonomous`, `subagent-driven-development`, `executing-plans`, or `direct` with explicit override; subagent-driven-development requires `subagent_dispatch: confirmed`. Full autonomous retains a valid design, plan, and standard/thorough independent review
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
