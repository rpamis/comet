---
name: comet-hotfix
description: "Use when the user wants to fix an existing behavior bug without adding capability or needing full design; also use when resuming hotfix workflow."
---

# Comet Preset Path: Hotfix

Quick bug fix workflow: open → build → verify → archive. Skip brainstorming and full plan, applicable for behavior fixes not involving new capability design.

**Applicable conditions** (all must be met):
1. Fix bugs in existing functionality, no new capability
2. No interface changes or architecture adjustments
3. Change scope is predictable (file count is a hint only, not a hard upgrade condition; see Upgrade Assessment below)

**Not applicable**: If the fix process hits a qualitative-change signal (see "Upgrade Assessment" section), the user decides whether to upgrade to the full `/comet` workflow.

---

## Process (preset workflow, 6 steps)

### 0. Output Language Constraint

Streamlined OpenSpec artifacts must use the configured Comet artifact language. Read `language` from `.comet/config.yaml` before `.comet.yaml` exists, then use `"$COMET_BASH" "$COMET_STATE" get <name> language` after initialization.

Execution chain: open → build → root cause check → verify → archive. Hotfix provides default decisions for each phase: streamlined open, direct build, root cause confirmation, scale-based verification, and final archive confirmation after verification passes.

Before starting, locate Comet scripts via `comet/reference/scripts.md`. When resuming from any entry point, first use `comet/reference/context-recovery.md` to confirm phase/workflow.

### 1. Quick Open (preset open)

Reuse Comet open capability to create change, but use hotfix defaults: do not execute `openspec-explore` long exploration, directly enter streamlined change creation.

**Immediately execute:** Use the Skill tool to load the `openspec-new-change` skill. Skipping this step is prohibited.

After the skill loads, follow its guidance to create streamlined artifacts:
  - `proposal.md` — problem description + root cause analysis + fix goal (no solution comparison needed)
  - `design.md` — fix solution (one is enough, no multi-solution comparison needed)
  - `tasks.md` — fix task list
- **No delta spec needed** (unless fix changes existing spec acceptance scenarios)

Initialize Comet state file:

```bash
node "$COMET_STATE" init <name> hotfix
```

Verify initialized state:

```bash
node "$COMET_STATE" check <name> open
```

Run phase guard to transition open → build:

```bash
node "$COMET_GUARD" <change-name> open --apply
```

Check `auto_transition` to decide whether to continue:

```bash
node "$COMET_STATE" next <name>
```

- `NEXT: auto` → continue to Step 2
- `NEXT: manual` → pause, follow `HINT` to prompt user to run `/<SKILL>` manually

### 2. Direct Build (preset build)

Use hotfix defaults: `build_mode: direct`, `review_mode: off` (hotfix/tweak skip review_mode selection — the guard does not require it for preset workflows). Skip Superpowers `brainstorming` and `writing-plans` (unless tasks > 3; if exceeds 3 tasks, transfer to `/comet-build`'s plan and execution method selection — note this does NOT trigger full workflow upgrade, only switches execution method).

Before continuing or starting changes, handle uncommitted changes through `comet/reference/dirty-worktree.md`. If attribution shows a qualitative-change signal or file-count tripwire is hit, handle it through this file's "Upgrade Assessment".

**Immediately execute:** Execute tasks one by one according to tasks.md:

1. Read `openspec/changes/<name>/tasks.md`, get incomplete task list
2. For each incomplete task:
   - Modify code according to task description
   - Run project formatter (e.g., `mvn spotless:apply`, `npm run format`)
   - Run related tests to confirm pass
   - Check corresponding `- [ ]` to `- [x]` in tasks.md
   - Commit code, commit message format: `fix: <brief fix description>`
3. After all tasks complete, explicitly run relevant project tests and build commands

**If fix affects existing spec acceptance scenarios**:
- Create delta spec in `openspec/changes/<name>/specs/<capability>/spec.md`
- Only include `## MODIFIED Requirements` section

During hotfix execution, whenever a crash, unexpected behavior, test failure, or build failure appears while running the program, tests, build, or manual verification, must use the Skill tool to load the Superpowers `systematic-debugging` skill. Before root-cause investigation is complete, must not propose or implement source-code fixes.

For specific investigation, minimal failing test, fix verification, and keeping the current change verification loop, follow `comet/reference/debug-gate.md`.

### 3. Root Cause Elimination Check

**Execute before running build guard**, ensuring the fix actually eliminates the root cause:

1. Read bug description and root cause in proposal.md
2. Search and verify problem code no longer exists
3. If root cause not eliminated, return to Step 2 to continue fix (still in build phase, no state transition needed)

**Upgrade assessment signals**:
- Root cause check reveals deep architecture issues → Hits a qualitative-change signal; pause per the "Upgrade Assessment" section and let the user decide
- Fix requires additional interface changes → Hits a qualitative-change signal (introduces new public API); pause per the "Upgrade Assessment" section and let the user decide

After root cause is confirmed eliminated, run phase guard to transition build → verify:

```bash
node "$COMET_GUARD" <change-name> build --apply
```

State automatically updates to `phase: verify`, `verify_result: pending`, then enter verification.

### 4. Verification (preset verify)

Reuse `/comet-verify`, with comet-verify's scale assessment deciding lightweight or full verification.

**Immediately execute:** Use the Skill tool to load the `comet-verify` skill. Skipping this step is prohibited.

Small-scale hotfixes without delta spec usually meet lightweight verification conditions (≤ 3 tasks, changed files below the scale threshold), comet-verify's scale assessment will select the lightweight verification path (6 quick checks; default `review_mode: off` does not dispatch automatic code review). If the user wants to increase review, they can run `node "$COMET_STATE" set <name> review_mode standard` or `thorough` before verification. If hotfix created delta spec, enter full verification path according to comet-verify's scale assessment rules.

After verification passes, record `.comet.yaml` `verify_result` as `pass` according to `/comet-verify` rules, must not skip this status before archiving. After verification passes, still enter `/comet-archive`'s final archive confirmation; do not automatically run the archive script.

### 5. Archive (preset archive)

Reuse `/comet-archive`. Must satisfy `verify_result: pass` in `.comet.yaml` before archiving, and wait for `/comet-archive`'s final archive confirmation.

**Immediately execute:** Use the Skill tool to load the `comet-archive` skill to archive. Skipping this step is prohibited.
If there is delta spec, sync to main spec according to comet-archive rules, and handle associated Design Doc and Plan archiving annotations.

---

## Continuous Execution Mode

<IMPORTANT>
Hotfix workflow is **one-time continuous execution**. After invoking `/comet-hotfix`, agent must automatically advance through hotfix steps, without pausing to wait for user input mid-way.

Exception: when `.comet.yaml` has `auto_transition: false`, after each phase guard advances `phase`, do not auto-invoke the next skill. In this case, use `node "$COMET_STATE" next <name>` output and pause for manual continuation as instructed.

The following situations must also pause and wait for user confirmation:

1. Encountering an upgrade-assessment signal (see "Upgrade Assessment" section). **Must use the current platform's available user input/confirmation mechanism to pause and wait for the user to explicitly choose**: continue the hotfix flow, or upgrade to the full `/comet` workflow
2. workspace isolation and execution-method selection when tasks exceed 3 and transfer to `/comet-build`
3. verify phase (comet-verify) verification-failure and branch-handling decisions
4. Final archive confirmation (before comet-archive runs the archive script)

Execution order: quick open → direct build → root cause check → verification → archive → complete

After each step completes, immediately enter next step. Within each phase, must still call corresponding Comet/OpenSpec/Superpowers skill according to above requirements; if the called skill has its own user decision points, follow that skill's rules.
</IMPORTANT>

---

## Upgrade Assessment

Hotfix upgrade assessment only decides whether to move from the preset workflow to full; file count never upgrades automatically, and `comet-state scale` only decides verification weight.

If `/comet` passes an intent frame from the entry, hotfix must recheck `risk_signal` and escalation signals only before build: new capability, public API, schema change, cross-module coordination, or deep architecture work. When any signal matches, enter the existing escalation decision point; do not reimplement entry intent recognition.

Continuously check these qualitative-change signals: cross-module coordination, needing a new capability, database schema changes, introducing a new public API, or touching a deep architecture problem (in hotfix context this often surfaces during the root-cause elimination check). If any signal appears, the agent **must not self-upgrade or self-decide to continue**.

The file-count tripwire is only a prompt: when changed files exceed the hint threshold (for example > 4 files), ask the user whether to continue hotfix or upgrade full. More files do not necessarily mean qualitative change. A bug fix is usually focused on 1-3 files, so exceeding the threshold means the change surface is larger and is worth having the user confirm it still fits the preset scope.

When a qualitative-change signal or file-count tripwire is hit, **must pause under the `comet/reference/decision-point.md` protocol and wait for the user's explicit choice**. Do not directly enter `/comet-design`; do not automatically add a Design Doc.

After the user chooses upgrade (option B), use the legal state-machine upgrade channel, a single command that converts the preset workflow to full and rolls back to design:

```bash
node "$COMET_STATE" transition <name> preset-escalate
```

This command atomically sets `workflow`/`classic_profile` to `full`, rolls `phase` back to `design`, and clears `design_doc` (satisfying comet-design entry requirements). Then add the Design Doc on the current change: **immediately use the Skill tool to load the `comet-design` skill**, then proceed through the normal full workflow.

When the user chooses continue (option A), continue the hotfix workflow and record the user's reason for continuing.

---

## Exit Conditions

- Bug fixed, tests pass
- Change archived
- If spec changes, synced to main spec
- **Phase guard**: Before build → verify run `node "$COMET_GUARD" <change-name> build --apply`; before verify → archive follow `/comet-verify` and run `node "$COMET_GUARD" <change-name> verify --apply`

## Automatic Handoff to Next Phase

Follow `comet/reference/auto-transition.md`. Key command:

```bash
node "$COMET_STATE" next <name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to continue hotfix workflow (`phase: build` returns `comet-hotfix`, `verify` returns `comet-verify`, `archive` returns `comet-archive`)
- `NEXT: manual` → do not invoke the next skill; prompt user to manually run `/<SKILL>` per `HINT`
- `NEXT: done` → workflow is complete, no further action needed
