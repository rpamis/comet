---
name: comet-build
description: 'Plan, implement, and accept Classic tasks. Use when the user invokes /comet-build or Classic Runtime enters Build or returns to Build for repairs.'
---

# Comet Phase 3: Plan and Build

After entry returns layout, follow `comet-classic/reference/classic-layout.md` to bind each logical root to its directory. Do not reload the protocol if it is already in context. Use the adapter for all OpenSpec CLI calls and the bound `<classic-*>` roots for paths; do not run an extra root show first.

## Prerequisites

- The Design Doc exists; Phase 2 is complete.
- An active change exists.

## Steps

### 0. Validate entry state

Use the supported `comet` CLI described in `comet-classic/reference/scripts.md` for these checks. When resuming from any entry, first follow `comet-classic/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <name> build --json
```

If this invocation already has a successful Design/Guard result with Build state, use its `data.configuration`, `configurationReadiness`, `artifactRefs`, task information, and `agent.continuation` without repeating select/check. Run the entry commands above only on recovery or workspace/external state changes. After writing configuration, use the successful result rather than repeating get for every field. Handle `data.issues` on failure.

If select/check returns `BLOCKED` because `bound_branch` differs from the current branch, pause under `comet-classic/reference/decision-point.md`. Offer a single choice: return to the bound branch and rerun entry checks, or, after the user explicitly confirms that the current branch should take over this change, run `comet state rebind <change-name>` and rerun entry checks. Do not switch or rebind branches yourself.

**Recovery:** Reconcile the returned phase, task IDs, and plan `base-ref` with existing implementation and review records. Resume the unfinished implementation or review step. An unchecked task may already be implemented. Inspect checkpoints before dispatching; do not repeat existing commits or assume external operations are safe to retry.

### 1. Confirm the execution strategy first

Read configuration, `configurationReadiness`, taskState, and nextAction from entry. When `configurationReadiness.missingFields` and `invalidFields` are empty, retain the confirmed configuration instead of presenting the same choices again; ask only about the listed missing or invalid decisions. If configuration, plan, and review records remain valid, continue without asking again or regenerating them. Open must already have prepared and bound the workspace. Stop if isolation is missing or the directory does not match, and resume in the projectRoot returned by workspace resolve. Do not create or switch workspaces in Build.

**Confirm the execution strategy before writing a plan.** `configurationReadiness` lists only unresolved or invalid fields; a valid configuration is not presented as a new choice. If configuration is missing or the user explicitly requests a change, collect execution mode, TDD, and review mode together under `comet-classic/reference/decision-point.md`, asking only about the listed decisions. Do not choose based on the model name.

| build_mode                    | Behavior                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autonomous`                  | After explicit user selection, the Agent writes the plan and either implements serially or delegates a clearly scoped group of tasks. External planning/execution skills are not mandatory. |
| `subagent-driven-development` | Load the same-named Superpowers skill. The main session coordinates, the implementer writes the code, and both follow Comet's dispatch and review rules.                                    |
| `executing-plans`             | Load the same-named Superpowers skill; the main session implements the plan in order.                                                                                                       |

Recommend autonomous when the Agent can plan effectively and a long task needs flexible organization. Recommend subagent-driven-development for a fixed delegation method, or executing-plans for a fixed sequential method. Recommendations do not replace user confirmation and must not automatically replace an existing change's strategy.

| Configuration | Options and requirements                                                                                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tdd_mode`    | `tdd`: confirm a test fails because of the missing behavior (RED), then implement it and make the test pass (GREEN). `direct`: per-task RED/GREEN is not required, but relevant tests and defect regression results still are.                                                           |
| `review_mode` | `off`: no automatic review for low-risk tasks. `standard`: review risky tasks and perform the single final integration review in Verify. `thorough`: independently review each task or section according to the selected execution strategy, then complete the final integration review. |

Full autonomous requires standard or thorough; implementer self-review cannot replace independent review. Existing execution strategies retain their review_mode rules. Recommend tdd and standard by default. Hotfix/tweak direct presets remain unchanged.

After the user makes all choices, write the configuration atomically. For example, for an explicit autonomous/TDD/standard choice:

```bash
comet state set <name> build_mode autonomous subagent_dispatch null tdd_mode tdd review_mode standard --json
```

Substitute the actual choices. For subagent-driven-development, also write `subagent_dispatch confirmed`; for other modes, write null. Preserve isolation, bound_branch, and any existing pause. Stop on write failure without loading the execution skill. If the user has not decided or requests a pause, stop without writing partial configuration.

`direct` is not an alias for autonomous. Full allows direct only when explicitly requested and recorded with `direct_override true`. Autonomous does not permit skipping design, planning, configuration, verification, or independent review.

### 2. Create or resume the plan

`tasks.md` determines task completion. Run `comet state tasks <name> --json` only when task bodies or IDs are needed. If IDs are missing, run `comet state tasks <name> --assign-ids --json`, preserving existing IDs and updating affected handoff content and plan mappings.

Follow context-recovery.md when resuming, syncing legacy plan checkboxes, or recording completed work. Unchecked does not mean unimplemented: check off work whose implementation, checks, and reviews are sufficient, and finish only what remains for other tasks. task-complete automatically syncs legacy plans with comet-task ID mappings. Use `comet state sync-plan <name>` for a separate sync. When planSync returns mapping-required, add the mapping without reimplementing the task.

Keep an existing valid plan. Otherwise, use configuration.language to create `<classic-superpowers-root>/plans/<YYYY-MM-DD>-<change-name>.md`:

- autonomous: the current Agent writes and checks the plan directly, without loading writing-plans.
- Other plan execution strategies: use the `writing-plans` skill for writing and self-checking only; stop if it fails. Pass the confirmed configuration, design_doc, tasks.md, fixed plan path, and current `git rev-parse HEAD`. Return to Comet Build afterwards without choosing the strategy again or entering the external skill's subsequent workflow.

Adjust plan depth to risk: keep plans brief for clear, mature, reversible work; record tradeoffs, dependencies, rollback, and verification for real technical choices, component dependencies, permissions, migrations, concurrency, compatibility, or irreversible operations. Each task must still produce an independently acceptable result and identify its task ID, scope, dependencies, constraints, and acceptance commands or scenarios. Organize preparation, implementation, tests, and documentation around that result. Do not split tasks by estimated minutes, file counts, or RED/GREEN steps. Reference designs and requirements rather than writing the whole implementation in advance. Include code excerpts only for interfaces or high-risk algorithms that need review before implementation.

Do not create another checkbox list in a new plan. Add `<!-- comet-task-authority: <classic-task-authority-ref> -->`, using the repository-relative reference from `data.artifactRefs.tasks`, and associate each task with `<!-- comet-task-ref:<task-id> -->`. Add actual new work to tasks.md and assign IDs before adding it to the plan. Handle scope changes under Step 4.

Plan frontmatter:

```yaml
---
change: <change-name>
design-doc: <recorded-design-doc-path>
base-ref: <git rev-parse HEAD before implementation>
---
```

Keep a legacy plan's base-ref; do not replace it with current HEAD on recovery. Reuse `data.artifactRefs.plan` for `<plan-ref>`. For a new plan, combine `data.artifactRefs.plansRoot` and the chosen filename into a repository-relative reference. Use the absolute path only for writing. After confirming that the file exists, record it:

```bash
comet state set <name> plan "<plan-ref>" --json
```

Continue under the confirmed strategy after planning; do not add another configuration approval. If the user explicitly requests a model switch or a pause after the plan, write `comet state set <name> build_pause plan-ready` and stop. Clear an existing plan-ready pause only after the user explicitly asks to continue. Keep the valid plan and configuration. For an older change missing configuration, complete Step 1 without rewriting the plan.

### 3. Implement and accept tasks

Use this invocation's entry configuration and continuation before implementation. Refresh entry after configuration, requirements, or workspace changes. Run checks according to risk instead of repeating the full suite after every small edit. External skills execute only the current plan and confirmed configuration. They must not create a worktree, choose isolation again, add a final review, or call finishing-a-development-branch. Return completed tasks to Comet Build.

- autonomous: organize implementation within the plan. Before delegation, read `comet-classic/reference/subagent-dispatch.md`, delegate a clearly scoped group of tasks as a work package, save coordination records through Runtime, and arrange an independent reviewer. External execution skills are not mandatory.
- executing-plans: load Superpowers `executing-plans` with the Skill tool, pass entry configuration.language, and execute the plan in order. Stop if loading fails.
- subagent-driven-development: load the same-named Superpowers skill and `comet-classic/reference/subagent-dispatch.md`. The main session coordinates without writing code on the implementer's behalf. If dispatch fails, save the BLOCKED reason; do not silently take over or change strategies.

With tdd, every implementation task must record actual RED and corresponding GREEN commands/results, with a RED failure caused by the intended missing behavior. Autonomous need not load an external TDD skill but still requires RED/GREEN. Executing-plans loads test-driven-development once before first implementation; the implementer loads it for subagent execution. Do not reload while context is intact. After context loss, inspect existing results instead of reenacting verified implementation or reverting code to fabricate RED. Direct still requires relevant checks and defect regression results.

Build reviews tasks or sections only; Verify owns the single final integration review:

- Autonomous and subagent execution: follow the risk levels and review-attempt limits in subagent-dispatch.md for independent task reviews. Even when autonomous does not delegate implementation, required review must be independent.
- executing-plans + off|standard: accept tasks and enter Verify without an additional final Build review.
- executing-plans + thorough: every task must receive independent review. Closely dependent tasks that must be accepted together may form a section. Review the diff by independently acceptable result and risk, not a fixed number of tasks. Review each section before continuing implementation that depends on it. Do not combine all independently acceptable tasks to delay review until the end. The last section, with no further implementation depending on it, is reviewed by Verify's single final integration review.

Resolve CRITICAL/IMPORTANT findings. Stop if independent review is unavailable; self-review is not a substitute. Record the rationale and affected scope of accepted noncritical deviations. After acceptance, use task-complete to check off tasks.md by ID. Save coordination and recovery records through `comet state checkpoint <name> --file <json-path>`; see context-recovery.md for fields and read/write rules. Checkpoints do not replace task completion marks or actual check/review results.

### 3b. Diagnose unexpected execution failures

Investigate the root cause of unexpected crashes, behavior, test failures, or build failures before changing source. Autonomous follows the debugging protocol directly; other strategies load Superpowers `systematic-debugging`. A verified TDD RED caused by the missing behavior is expected evidence. Loading errors, environment errors, unrelated regressions, and unexplained RED failures still require investigation.

Follow `comet-classic/reference/debug-gate.md` for root-cause investigation, a minimal failing test, verification after repair, and completing these steps within the current change.

### 4. Update specs incrementally

When implementation reveals gaps in the initial spec, handle them according to the size of the change.

For implementation details within the confirmed scope that do not change public behavior or acceptance requirements, update the plan and rationale without reopening Open/Design. The following categories apply only to actual specification or scope changes:

| Size   | Trigger                                                 | Action                                                                                                                                                              |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Small  | Missing acceptance scenarios or edge cases              | Edit delta spec + design.md directly and add tasks.md work.                                                                                                         |
| Medium | Interface changes, new components, or data-flow changes | **Pause, present choices, and wait for explicit confirmation**, then load Superpowers `brainstorming` through the Skill tool to update the Design Doc + delta spec. |
| Large  | An entirely new feature requirement                     | **Pause, present split choices, and wait for explicit confirmation**. Then create an independent change through `/comet-open`.                                      |

**Recheck scope:** Before adding tasks, compare the original goal, public behavior, acceptance requirements, and risks the user has accepted. Update tasks and rationale directly when adding omitted work within that scope or adjusting task granularity. Task counts or growth percentages alone do not require a pause. Only actual scope expansion, redesign, or a new independently shippable feature requires a decision under `comet-classic/reference/decision-point.md`: continue, adjust, or split.

Create independent changes through `/comet-open`, never directly through `/opsx:new`. This creates both OpenSpec artifacts and `.comet.yaml` so the new change remains under Comet's state machine.

**Include these user choices:**

- “Split into a new change”: create it through `/comet-open`.
- “Complete within the current change”: record the scope expansion and update tasks.md and delta spec before continuing.

**Maintenance rules:**

- Maintain delta spec as implementation progresses, following the rules above.
- Commit each update with a message explaining why.
- Do not sync to main spec early; archive performs that sync.
- Explain small direct delta-spec edits in the commit message so Design Doc divergence can be assessed during archive.

**Update handoff:** Adding, changing, or deleting delta spec makes the design handoff hash stale. Regenerate it directly during Build without moving phase or step backwards:

```bash
comet handoff <change-name> design --write
```

This rebuilds handoff from current OpenSpec artifacts and updates `handoff_hash`. It does not change `phase` or Runtime `currentStep`; continue Build afterwards.

### 5. Manage context

Build may span many tasks. To support recovery after context compaction:

- **After each task:** verify implementation, checks, and reviews required by configuration, then check off tasks.md with `comet state task-complete <name> <task-id> --expect <revision> --json`. Use the revision from the inspected task list. Reassess changed requirements instead of blindly refreshing and retrying. New plans and checkpoints must not copy checkboxes; sync only legacy items with explicit ID mappings, following context-recovery.md. Accept work packages per task ID, persist coordination with checkpoint, and save progress under the project's commit policy.
- **After context compaction:** follow `comet-classic/reference/context-recovery.md` with phase `build`.
- **After manual user edits:** follow `comet-classic/reference/dirty-worktree.md` for inspection, ownership classification, and prohibited actions. In Build, if the attributed diff indicates plan or spec changes, apply Step 4's categories.
- **Split long work:** use independently acceptable results and dependencies. Line count signals review risk but does not alone determine task count.

## Exit conditions

- All tasks.md tasks are checked off.
- Code is committed.
- Relevant build/test commands were explicitly run and passed; do not rely solely on guard autodetection.
- `isolation` is `current`, `branch`, or `worktree`.
- `build_mode` is `autonomous`, `subagent-driven-development`, `executing-plans`, or explicitly overridden `direct`. Subagent-driven-development requires `subagent_dispatch: confirmed`. Full autonomous retains valid design, plan, and standard/thorough independent review.
- `tdd_mode` is `tdd` or `direct`.
- `review_mode` is `off`, `standard`, or `thorough`.
- Required task/section reviews are complete; do not repeat Verify's final integration review in Build.
- **Phase guard:** `comet guard <change-name> build --apply` passes all checks and advances to `phase: verify`, independently of `auto_transition`.

Prefer Runtime execution and recording to avoid running a check manually and then again through Guard.

Use `--local` only for deterministic local checks. Omit it for external services or uncertain environments; that evidence is single-use. The platform adapter handles ordinary Windows npm/pnpm shims. Batch arguments with shell metacharacters are rejected. Use an explicit entry such as `node <script>` for complex checks, not a whole shell string as a program name.

```bash
comet check run <change-name> build --local -- <program> [args...]
```

Guard checks configuration, tasks, and artifacts first, then reuses Runtime results with matching inputs and environment. It runs a detected build only when valid evidence is missing. Source, tests, related configuration, dependencies, or submodule changes require the relevant checks to run again. After context loss, revalidate reusable local evidence and rerun only invalid or single-use checks. Do not reuse results if inputs changed during execution. Preflight does not consume single-use evidence; a successful phase transition does. Read failure logs through `logRef` as needed.

`state record-check --command` only records a manual declaration. Comet **never executes that text**, and it cannot automatically authorize advancement. Build and Verify evidence are separate: Verify can reference a revalidated build result, but a successful build does not replace tests or acceptance scenarios. `COMET_SKIP_BUILD=1` is a legacy bypass, not auditable build evidence.

Before exiting, advance phase with the guard, independently of `auto_transition`:

```bash
comet guard <change-name> build --apply
```

State becomes `phase: verify`, `verify_result: pending`.

## Continue to the next phase

Follow `comet-classic/reference/auto-transition.md` and the successful result's `agent.continuation`. Do not repeat next, select, or check when valid state information is already available. Run this only after context loss, external state changes, or when an older result lacks that information:

```bash
comet state next <change-name>
```

- `NEXT: auto`: invoke the skill named by `SKILL`.
- `NEXT: manual`: do not invoke the next skill. Follow `HINT`, return control, and end this invocation without another confirmation question.
- `NEXT: done`: the workflow is complete.
