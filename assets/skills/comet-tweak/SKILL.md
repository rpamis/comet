---
name: comet-tweak
description: 'Use the Classic preset for a lightweight adjustment within one change. Use when the user explicitly invokes /comet-tweak, selects tweak, or resumes workflow: tweak.'
---

# Comet Preset: Tweak

Before starting or resuming, read and follow `comet-classic/reference/classic-layout.md`. All OpenSpec CLI calls must use the adapter, and all paths must use the bound `<classic-*>` logical roots.

Tweak provides preset choices for Comet's five-phase workflow. It uses OpenSpec for requirements and implementation, reuses open/build/verify/archive, and skips Superpowers brainstorming and a full implementation plan. It does not create a separate workflow.

Use it for configuration, documentation, or prompt adjustments, and moderate changes that need spec-driven implementation, including delta spec, without the full `/comet-classic` deep-design flow. Delta spec is a normal Tweak artifact; needing it is not by itself a reason to escalate.

**All applicability conditions must hold:**

1. The work fits in **one OpenSpec change**.
2. The solution can be clarified without a Superpowers Design Doc and full implementation plan.
3. No cross-module or cross-layer architectural coordination is needed.
4. Task scope can be estimated. File/task counts are prompts only, not automatic escalation rules; see “Escalation decisions.”

**When the preset may no longer fit:** If implementation encounters a change listed under “Escalation decisions,” let the user decide whether to use the full `/comet-classic` flow.

---

## Preset flow: 4 phases

### 0. Set the output language

Use Comet's configured artifact language for the reduced OpenSpec artifacts. Before `.comet.yaml` exists, read `classic.language` from project `.comet/config.yaml`, then global `~/.comet/config.yaml`. After initialization, read it with `comet state get <name> language`.

Execution order: open → OpenSpec apply → verify → archive. Tweak presets each stage: prepare the necessary artifacts, build directly through OpenSpec apply, choose light/full verification from change size and delta spec, and request final archive confirmation after verification passes.

Use the supported Comet CLI described in `comet-classic/reference/scripts.md`. On recovery from any entry, check phase/workflow under `comet-classic/reference/context-recovery.md` first.

For an existing tweak, the first state operation must be `comet state select <change-name>`. For a new change, run it immediately after `.comet.yaml` initializes successfully and before source edits.

After entering the tweak workspace and reading current `phase`, run `comet task <project-root> --task "<original-user-request>" --phase "<phase>" --session "<stable-task-session-id>" --json`. Use the returned context as follows:

- Add only returned `text` to the current context. Context Manifest (`manifest` / `<context_manifest>`) contains only summaries, application reasons, and stable IDs. Add `--expand-context "<id>"` when source text, provenance, or validation details are needed. When path, operation, or phase changes, select applicable entries again using the same `--session`.
- Use `comet memory remember ... --scope global|project` when the user explicitly asks for long-term memory. Use `comet memory observe` only for implicit, reusable, stable collaboration patterns. Do not save task summaries, progress, command output, or test results.
- After actually using an entry and determining its outcome, take `applications[].applicationId` (`application_id` in Hook text) and run `comet task <project-root> --task "<original-user-request>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json` to record the result.
- At task completion, still run `comet task` with `--complete --workflow <workflow> --change <change-id>`. Without Hooks, this Skill uses the same interface. `comet memory context` is a compatibility entry only. Plugin failures do not block this change.

### 1. Open a minimal change

Reuse Comet Open with tweak defaults. Skip the full `openspec-explore` exploration and create the artifacts needed for this change.

**Required now:** Load `openspec-new-change` using the Skill tool. Do not skip this step.

<!-- external-openspec-skill-override -->

**Adapt external OpenSpec instructions:** Do not directly invoke the official CLI, adopt a fixed cwd, or read/write fixed physical OpenSpec paths. Use `comet classic openspec -- <args...>` for every OpenSpec command and this invocation's `<classic-*>` logical roots for all change and artifact paths.

Follow the skill to create the reduced artifacts:

- `proposal.md`: motivation, goals, and scope.
- `design.md`: a brief implementation approach; no comparison required.
- `tasks.md`: a reasonably scoped task list. Count alone does not trigger escalation; see “Escalation decisions.”
- Optional `delta spec`: create it normally if the change affects existing spec acceptance scenarios, using only `## MODIFIED Requirements` or `## ADDED Requirements`. OpenSpec uses delta specs to describe incremental changes to existing systems. The need for this artifact does not itself require escalation.

Initialize Comet state:

```bash
comet state init <name> tweak
comet state select <name>
```

Then validate initialization:

```bash
comet state check <name> open
```

If select/check returns `BLOCKED` because `bound_branch` differs from the current branch, pause under `comet-classic/reference/decision-point.md`. Offer a single choice: return to the bound branch and rerun entry checks, or, after the user explicitly confirms that the current branch should take over this change, run `comet state rebind <change-name>` and rerun entry checks. Do not switch or rebind branches yourself.

Workspace isolation is a user choice at entry; do not write `current` as an assumed default. Pause under `comet-classic/reference/decision-point.md` and present:

- A. Work on the current branch: run `comet state set <name> isolation current`, binding the actual branch.
- B. Create a branch: create and switch to `tweak/YYYYMMDD/<change-name>`, then run `comet state set <name> isolation branch`.
- C. Create a worktree: first load Superpowers `using-git-worktrees` with the Skill tool and let it create the isolated workspace. Enter it, then run `comet state set <name> isolation worktree`.

After B or C, run this again in the actual execution branch/worktree:

```bash
comet state select <name>
```

Apply the guard to move from open to build:

```bash
comet guard <change-name> open --apply
```

### 2. Build with OpenSpec apply, for tweak only

Use tweak's `build_mode: direct`. Preserve the isolation confirmed in Step 1; do not change it back to `current`. Skip Superpowers `brainstorming` and `writing-plans`, and execute this change's tasks through OpenSpec's apply action.

<IMPORTANT>
This apply path belongs only to tweak. Full `/comet-classic` or `workflow: full` must not use tweak's `openspec-apply-change` Build path. Full still generates a Design Doc through `/comet-design`, then plans and implements through `/comet-build` using the confirmed strategy. Autonomous does not require `writing-plans`; other strategies use the planning and execution skills specified by `/comet-build`.
</IMPORTANT>

Before starting or resuming edits, handle uncommitted changes under `comet-classic/reference/dirty-worktree.md`. After establishing ownership, follow “Escalation decisions” if a listed condition appears or changed files exceed the prompt threshold.

**Required now:** Load `openspec-apply-change` using the Skill tool. Do not skip this step.

<!-- external-openspec-skill-override -->

**Adapt external OpenSpec instructions:** Use its apply method only. Replace direct official CLI calls, fixed cwd, and fixed physical OpenSpec paths with `comet classic openspec -- <args...>` and the `<classic-*>` logical roots.

Pass the current `<change-name>` and follow the skill's apply instructions:

1. Run `comet classic openspec -- status --change "<name>" --json`, or use its still-valid result, to identify the schema and task artifact.
2. Run `comet classic openspec -- instructions apply --change "<name>" --json`, or use its still-valid result, to read apply instructions, `contextFiles`, task progress, and the current instruction.
3. Read every listed context file. Do not implement from old conversation alone or simply invent a loop over tasks.
4. Complete unchecked tasks one by one under the apply instructions, keeping changes minimal and focused.
5. After each task:
   - Run the project's formatter, such as `mvn spotless:apply` or `npm run format`.
   - Run relevant tests and confirm they pass.
   - Mark the task complete under `openspec-apply-change` rules.
   - Commit with `tweak: <change-summary>`.
6. Explicitly run relevant project tests and build after all tasks finish.
7. Apply the phase guard to move from build to verify.

During tweak, a crash, unexpected behavior, failing test, or failing build encountered while running the program, tests, build, or manual verification requires loading Superpowers `systematic-debugging` through the Skill tool. Do not propose or implement source repairs before completing root-cause investigation.

Follow `comet-classic/reference/debug-gate.md` for investigation, the minimal failing test, verification after repair, and completing those steps within the current change.

**Reassess whether tweak still fits:** Throughout Build, and once more before build→verify, follow “Escalation decisions”:

- The Agent assesses the actual changes for conditions requiring reconsideration of the workflow.
- File counts only prompt the user to review scope; the user decides whether to escalate.
- Scale only recommends light/full verification; it does not decide workflow escalation.

When an escalation condition applies or the file-count threshold is exceeded, **do not escalate or decide to continue on your own**. Pause under `comet-classic/reference/decision-point.md` and ask the user to choose tweak or the full `/comet-classic` flow.

Apply the phase guard:

```bash
comet guard <change-name> build --apply
```

State becomes `phase: verify`, `verify_result: pending`; continue to verification.

### 3. Verify

Reuse `/comet-verify`, whose size assessment selects light or full verification.

**Required now:** Load `comet-verify` using the Skill tool. Do not skip this step.

**Verification with delta spec:** Delta spec is a normal tweak artifact. If the change created one, explicitly set full verification before entering comet-verify. This uses OpenSpec verification (`openspec-verify-change`) to check delta-spec consistency:

```bash
comet state set <change-name> verify_mode full
```

A tweak without delta spec usually meets light conditions (≤ 3 tasks and changed files below the scale threshold). Follow comet-verify's light-verification checklist. If the user wants more review, they can run `comet state set <name> review_mode standard` or `thorough` before verification.

After verification passes, record `.comet.yaml` `verify_result: pass` under `/comet-verify` rules. Do not omit that state before archive. Passing verification still leads to `/comet-archive` for final confirmation; never run archive automatically without it.

### 4. Archive

Reuse `/comet-archive`. Require `.comet.yaml` `verify_result: pass` and wait for its final archive confirmation.

**Required now:** Load `comet-archive` using the Skill tool. Do not skip this step.

---

## Continue through the preset

<IMPORTANT>
Tweak runs continuously by default. After `/comet-tweak`, automatically move through its own steps without extra pauses. If `auto_transition: false`, end the invocation between build/verify/archive phases and use `HINT` to tell the user how to invoke the next phase later. Do not add another confirmation question. Regardless of auto_transition, pause for these user decisions:

1. An escalation condition appears: **pause, present choices, and wait for an explicit decision** to continue tweak or move to the full `/comet-classic` flow.
2. Verify needs acceptance of a WARNING/SUGGESTION deviation, a spec-divergence decision, or a strategy after the automatic repair limit. The first 3 clearly repairable failures are repaired and reverified automatically.
3. The final pre-archive choice of whether to archive and how to deliver the archive commit.

Order: quick Open → Build with escalation checks → Verify → Archive → done.

Continue to the next phase as soon as the current one finishes, subject to the rules above. Still invoke the required Comet/OpenSpec/Superpowers skills within each phase. If a called skill has a user decision, follow its rules.
</IMPORTANT>

---

## Escalation decisions

Escalation decides only whether to replace the lightweight preset with full. Neither the need for delta spec nor file count automatically upgrades the workflow. `comet state scale` recommends light/full verification without writing configuration; Verify chooses based on actual risk.

If `/comet-classic` passes an intent frame, before Build recheck only `risk_signal` and whether work adds a feature or public API, changes a structured-data schema, needs cross-module coordination, or exposes a deeper architecture issue. Follow this section when these arise. Delta spec remains a normal tweak artifact and does not automatically cause escalation. Do not repeat entry intent classification.

During implementation, watch for:

- Coordinated edits across modules.
- A new feature.
- Database schema changes.
- A new public API.
- A deeper architecture issue.
- The need to split this tweak into multiple OpenSpec changes.

For any of these, the Agent **must neither escalate nor decide to stay on tweak without the user**.

File count prompts a scope review only. Above the prompt threshold, such as > 6 files, also let the user choose tweak or full. More files do not necessarily require the full flow. Tweak often includes delta spec or configuration edits and usually touches more files than defect repair, so its threshold is higher than hotfix's.

When a condition or file-count prompt applies, **pause under `comet-classic/reference/decision-point.md` and wait for an explicit choice**. Do not enter `/comet-design` or create a Design Doc automatically.

After the user chooses escalation (B), run the supported state-machine transition to full and return to design:

```bash
comet state transition <name> preset-escalate
```

It atomically sets `workflow`/`classic_profile` to `full`, moves `phase` to `design`, clears `design_doc`, and clears preset-specific `build_mode`, `tdd_mode`, `review_mode`, `isolation`, and `verify_mode`. **Immediately load `comet-design` using the Skill tool** to complete the design within the existing change. On entering Build, jointly reconfirm the complete working configuration.

If the user chooses to continue (A), continue tweak and record why they accepted doing so.

---

## Exit conditions

- The change is implemented and tests pass.
- The change is archived.
- Any spec changes are synced to main spec.
- **Phase guards:** use `comet guard <change-name> build --apply` before build → verify, and follow `/comet-verify` to run `comet guard <change-name> verify --apply` before verify → archive.

## Continue to the next phase

Follow `comet-classic/reference/auto-transition.md` and `agent.continuation` from the successful result. Do not repeat next, select, or check while valid state information is available. Run this only after context loss, external state changes, or when an older result lacks that information:

```bash
comet state next <name>
```

- `NEXT: auto`: invoke the skill named by `SKILL`: build returns `comet-tweak`, verify returns `comet-verify`, and archive returns `comet-archive`.
- `NEXT: manual`: do not invoke the next skill. Follow `HINT`, return control, and end this invocation without another confirmation question.
- `NEXT: done`: the workflow is complete.
