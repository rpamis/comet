---
name: comet-hotfix
description: 'Use the Classic preset to repair a localized defect. Use when the user explicitly invokes /comet-hotfix, selects hotfix, or resumes workflow: hotfix.'
---

# Comet Preset: Hotfix

Before starting or resuming, read and follow `comet-classic/reference/classic-layout.md`. All OpenSpec CLI calls must use the adapter, and all paths must use the bound `<classic-*>` logical roots.

A short defect-repair flow: open → build → root-cause elimination check → verify → archive. It skips brainstorming and a full implementation plan, and applies to repairing existing behavior without designing new features.

**All applicability conditions must hold:**

1. Repair an existing feature's defect without adding a feature.
2. No interface changes or architectural redesign.
3. The scope can be estimated. File counts are only a prompt for review, not an automatic escalation rule; see “Escalation decisions.”

**When the preset may no longer fit:** If the repair encounters changes listed under “Escalation decisions,” let the user decide whether to use the full `/comet-classic` flow.

---

## Preset flow: 6 steps

### 0. Set the output language

Use Comet's configured artifact language for the reduced OpenSpec artifacts. Before `.comet.yaml` exists, read `classic.language` from project `.comet/config.yaml`, then global `~/.comet/config.yaml`. After initialization, read it with `comet state get <name> language`.

Execution order: open → build → root-cause elimination check → verify → archive. Hotfix presets how each stage runs: prepare the necessary artifacts, implement directly, check that the root cause is eliminated, choose verification based on size, then request final archive confirmation after verification passes.

Use the supported Comet CLI described in `comet-classic/reference/scripts.md`. On recovery from any entry, first check phase/workflow under `comet-classic/reference/context-recovery.md`.

For an existing hotfix, the first state operation must be `comet state select <change-name>`. For a new change, run it immediately after `.comet.yaml` initializes successfully and before source edits.

After entering the hotfix workspace and reading current `phase`, run `comet task <project-root> --task "<original-user-request>" --phase "<phase>" --session "<stable-task-session-id>" --json`. Use the returned context as follows:

- Add only returned `text` to the current context. Context Manifest (`manifest` / `<context_manifest>`) contains only summaries, application reasons, and stable IDs. Add `--expand-context "<id>"` when source text, provenance, or validation details are needed. When path, operation, or phase changes, select applicable entries again using the same `--session`.
- Use `comet memory remember ... --scope global|project` when the user explicitly asks for long-term memory. Use `comet memory observe` only for implicit, reusable, stable collaboration patterns. Do not save task summaries, progress, command output, or test results.
- After actually using an entry and determining its outcome, take `applications[].applicationId` (`application_id` in Hook text) and run `comet task <project-root> --task "<original-user-request>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json` to record the result.
- At task completion, still run `comet task` with `--complete --workflow <workflow> --change <change-id>`. Without Hooks, this Skill uses the same interface. `comet memory context` is a compatibility entry only. Plugin failures do not block the repair.

### 1. Open a minimal change

Reuse Comet Open with hotfix defaults. Skip the full `openspec-explore` exploration and create only the artifacts needed for the repair.

**Required now:** Load `openspec-new-change` using the Skill tool. Do not skip this step.

<!-- external-openspec-skill-override -->

**Adapt external OpenSpec instructions:** Do not directly invoke the official CLI, adopt a fixed cwd, or read/write fixed physical OpenSpec paths. Use `comet classic openspec -- <args...>` for every OpenSpec command and this invocation's `<classic-*>` logical roots for all change and artifact paths.

Create the initial change structure, then immediately initialize state and select the change so interrupted work can resume:

```bash
comet state init <name> hotfix
comet state select <name>
comet state check <name> open
```

If select/check returns `BLOCKED` because `bound_branch` differs from the current branch, pause under `comet-classic/reference/decision-point.md`. Offer a single choice: return to the bound branch and rerun entry checks, or, after the user explicitly confirms that the current branch should take over this change, run `comet state rebind <change-name>` and rerun entry checks. Do not switch or rebind branches yourself.

Workspace isolation is a user choice at entry; do not write `current` as an assumed default. Pause under `comet-classic/reference/decision-point.md` and present:

- A. Work on the current branch: run `comet state set <name> isolation current`, binding the actual branch.
- B. Create a branch: create and switch to `hotfix/YYYYMMDD/<change-name>`, then run `comet state set <name> isolation branch`.
- C. Create a worktree: first load Superpowers `using-git-worktrees` with the Skill tool and let it create the isolated workspace. Enter it, then run `comet state set <name> isolation worktree`.

After B or C, run this again in the actual execution branch/worktree:

```bash
comet state select <name>
```

Then create the reduced artifacts:

- `proposal.md`: problem, root cause, and repair goal; no solution comparison required.
- `design.md`: the repair approach; one approach is enough.
- `tasks.md`: repair tasks.
- **No delta spec is required** unless the fix changes acceptance scenarios in an existing spec.

Apply the phase guard to move from open to build:

```bash
comet guard <change-name> open --apply
```

Check `auto_transition` to decide whether to continue:

```bash
comet state next <name>
```

- `NEXT: auto`: continue to Step 2.
- `NEXT: manual`: follow `HINT`, return control, and end this invocation. Do not ask for another continuation approval.

### 2. Implement directly

Use hotfix defaults: `build_mode: direct`, `tdd_mode: direct`, `review_mode: off`. Preserve the isolation confirmed in Step 1; do not change it back to `current`.

`direct` skips full planning and per-task TDD orchestration; it still requires reproduction, regression tests, and verification. Skip Superpowers `brainstorming` and `writing-plans`. **Task count alone does not trigger `/comet-build`.** Execute even a longer tasks.md in order within the current hotfix. Ask whether to escalate to full only when the later escalation conditions or scope prompts apply.

Before starting or resuming edits, handle uncommitted changes under `comet-classic/reference/dirty-worktree.md`. After establishing ownership, apply “Escalation decisions” if the repair meets an escalation condition or exceeds the file-count prompt.

Before changing implementation, **reproduce the issue and record the failure**:

1. Confirm the reported old behavior actually fails with minimal repeatable steps. Record the command, input, and actual result.
2. Where automation is possible, add and run a failing regression test first. Confirm that it fails for this defect, not an environment or test error.
3. Where automation is not currently possible, record why and provide repeatable manual failure evidence in the proposal/verification report. Do not edit code without failure evidence.

After obtaining RED evidence, execute tasks.md in order:

1. Read `<classic-change-dir>/tasks.md` for unfinished tasks.
2. For each task:
   - Implement the described repair.
   - Run the project's formatter, such as `mvn spotless:apply` or `npm run format`.
   - Run the new regression test until it passes, then run relevant tests.
   - Change its tasks.md `- [ ]` to `- [x]`.
   - Commit using `fix: <repair-summary>`.
3. Explicitly run the relevant project tests and build after all tasks are complete.

During hotfix, a crash, unexpected behavior, failing test, or failing build encountered while running the program, tests, build, or manual verification requires loading Superpowers `systematic-debugging` through the Skill tool. Do not propose or implement source repairs before completing root-cause investigation.

Follow `comet-classic/reference/debug-gate.md` for investigation, the minimal failing test, verification after repair, and completing those steps in the current change.

**If the fix affects existing spec acceptance scenarios:**

- Create `<classic-change-dir>/specs/<capability>/spec.md` as a delta spec.
- Include only `## MODIFIED Requirements`.

### 3. Confirm the root cause is eliminated

**Do this before the build guard** to confirm that the repair actually removes the cause:

1. Read the bug description and root cause in proposal.md.
2. Search the relevant code and confirm the faulty implementation has been removed or corrected.
3. If the cause remains, return to Step 2. Phase is still build, so no state rollback is needed.

**Escalation prompts:**

- The check reveals a deeper architecture issue: pause under “Escalation decisions” and let the user choose whether to use the full flow.
- The repair needs another interface change, such as a new public API: pause under the same section for the user's decision.

After confirming elimination, advance from build to verify:

```bash
comet guard <change-name> build --apply
```

State becomes `phase: verify`, `verify_result: pending`; continue to verification.

### 4. Verify

Reuse `/comet-verify`, whose size assessment chooses light or full verification.

**Required now:** Load `comet-verify` using the Skill tool. Do not skip this step.

A small hotfix without delta spec usually meets light conditions (≤ 3 tasks and changed files below the scale threshold). Follow comet-verify's light-verification checklist. Default `review_mode: off` does not dispatch automatic code review. If the user wants review, they can set `comet state set <name> review_mode standard` or `thorough` before verification. If the hotfix creates delta spec, follow comet-verify's scale rules into full verification.

After verification passes, record `.comet.yaml` `verify_result: pass` under `/comet-verify` rules. Do not omit that state before archive. Passing verification still leads to `/comet-archive` for final confirmation; never run archive automatically without it.

### 5. Archive

Reuse `/comet-archive`. Require `.comet.yaml` `verify_result: pass` and wait for its final archive confirmation.

**Required now:** Load `comet-archive` using the Skill tool. Do not skip this step.

If there is delta spec, sync it to main spec under comet-archive rules and apply archive annotations to the linked Design Doc and Plan.

---

## Continue through the preset

<IMPORTANT>
Hotfix runs continuously by default. After `/comet-hotfix`, automatically move through its own steps without extra pauses. If `auto_transition: false`, end the invocation between build/verify/archive phases and use `HINT` to tell the user how to invoke the next phase later. Do not add another confirmation question. Regardless of auto_transition, pause for these user decisions:

1. An escalation condition appears: **pause, present choices, and wait for an explicit decision** to continue hotfix or move to the full `/comet-classic` flow.
2. Verify needs acceptance of a WARNING/SUGGESTION deviation, a spec-divergence decision, or a strategy after the automatic repair limit. The first 3 clearly repairable failures are repaired and reverified automatically.
3. The final pre-archive choice of whether to archive and how to deliver the archive commit.

Order: quick Open → direct Build → root-cause elimination check → Verify → Archive → done.

Continue to the next phase as soon as the current one finishes, subject to the rules above. Still invoke the required Comet/OpenSpec/Superpowers skills within each phase. If a called skill has a user decision, follow its rules.
</IMPORTANT>

---

## Escalation decisions

Escalation decides only whether to replace the preset with full. File count does not automatically upgrade the workflow. `comet state scale` recommends light/full verification without writing configuration; Verify chooses based on actual risk.

If `/comet-classic` passes an intent frame, before Build recheck only `risk_signal` and whether work adds a feature or public API, changes a structured-data schema, needs cross-module coordination, or exposes a deeper architecture issue. Follow this section when these arise; do not repeat entry intent classification.

During repair, watch for:

- Coordinated edits across modules.
- A new feature.
- Database schema changes.
- A new public API.
- A deeper architecture issue, often discovered by the root-cause elimination check.

For any of these, the Agent **must neither escalate nor decide to stay on hotfix without the user**.

File count prompts a scope review only. Above the prompt threshold, such as > 4 files, also let the user choose hotfix or full. More files do not necessarily require the full flow. Defect repairs usually involve 1–3 files; exceeding the threshold warrants checking whether the preset still fits.

When a condition or file-count prompt applies, **pause under `comet-classic/reference/decision-point.md` and wait for an explicit choice**. Do not enter `/comet-design` or create a Design Doc automatically.

After the user chooses escalation (B), run the supported state-machine transition to full and return to design:

```bash
comet state transition <name> preset-escalate
```

It atomically sets `workflow`/`classic_profile` to `full`, moves `phase` to `design`, clears `design_doc`, and clears preset-specific `build_mode`, `tdd_mode`, `review_mode`, `isolation`, and `verify_mode`. **Immediately load `comet-design` using the Skill tool** to complete the design within the existing change. On entering Build, jointly reconfirm the complete working configuration.

If the user chooses to continue (A), continue hotfix and record the reason they accepted doing so.

---

## Exit conditions

- The defect is fixed and tests pass.
- The change is archived.
- Any spec changes are synced to main spec.
- **Phase guards:** use `comet guard <change-name> build --apply` before build → verify, and follow `/comet-verify` to run `comet guard <change-name> verify --apply` before verify → archive.

## Continue to the next phase

Follow `comet-classic/reference/auto-transition.md` and `agent.continuation` from the successful result. Do not repeat next, select, or check while valid state information is available. Run this only after context loss, external state changes, or when an older result lacks that information:

```bash
comet state next <name>
```

- `NEXT: auto`: invoke the skill named by `SKILL`: build returns `comet-hotfix`, verify returns `comet-verify`, and archive returns `comet-archive`.
- `NEXT: manual`: do not invoke the next skill. Follow `HINT`, return control, and end this invocation without another confirmation question.
- `NEXT: done`: the workflow is complete.
