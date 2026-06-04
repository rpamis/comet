---
name: comet-hotfix
description: "Comet preset path: Bug fix / hotfix. Skip brainstorming, directly open → build → verify → archive. Applicable for behavior fixes, scenarios not involving new capability design."
---

# Comet Preset Path: Hotfix

Quick bug fix workflow: open → build → verify → archive. Skip brainstorming and full plan, applicable for behavior fixes not involving new capability design.

**Applicable conditions** (all must be met):
1. Fix bugs in existing functionality, no new capability
2. No interface changes or architecture adjustments
3. Change scope is predictable (usually ≤ 2 files)

**Not applicable**: If fix process discovers need for architecture adjustments, should upgrade to full `/comet` workflow.

---

## Process (preset workflow, 5 steps)

Execution chain: open → build → root cause check → verify → archive. Hotfix provides default decisions for each phase: streamlined open, direct build, root cause confirmation, scale-based verification, archive after verification passes.

Locate Comet scripts before starting:

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
```

### 1. Quick Open (preset open)

Reuse Comet open capability to create change, but use hotfix defaults: do not execute `openspec-explore` long exploration, directly enter streamlined change creation.

**Immediately execute:** Use the Skill tool to load the `openspec-new-change` skill. Skipping this step is prohibited.

When loading the skill, ARGUMENTS must include:

```
Language: Use the language of the user request that triggered this workflow.
```

After the skill loads, follow its guidance to create streamlined artifacts:
  - `proposal.md` — problem description + root cause analysis + fix goal (no solution comparison needed)
  - `design.md` — fix solution (one is enough, no multi-solution comparison needed)
  - `tasks.md` — fix task list
- **No delta spec needed** (unless fix changes existing spec acceptance scenarios)

Streamlined OpenSpec artifacts must use the language of the user request that triggered this workflow. When resuming an existing change with a clear dominant artifact language, preserve that language unless the user explicitly asks to switch.

Initialize Comet state file:

```bash
"$COMET_BASH" "$COMET_STATE" init <name> hotfix
```

Verify initialized state:

```bash
"$COMET_BASH" "$COMET_STATE" check <name> open
```

Run phase guard to transition open → build:

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> open --apply
```

### 2. Direct Build (preset build)

Use hotfix defaults: `build_mode: direct`. Skip Superpowers `brainstorming` and `writing-plans` (unless tasks > 3; if exceeds 3 tasks, transfer to `/comet-build`'s plan and execution method selection).

Before continuing or starting changes, handle uncommitted changes through `comet/reference/dirty-worktree.md`. If attribution shows the fix scope exceeds hotfix, handle it through this file's "Upgrade Conditions".

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

### 3. Root Cause Elimination Check

**Execute before running build guard**, ensuring the fix actually eliminates the root cause:

1. Read bug description and root cause in proposal.md
2. Search and verify problem code no longer exists
3. If root cause not eliminated, return to Step 2 to continue fix (still in build phase, no state transition needed)

**Upgrade conditions**:
- Root cause check reveals deep architecture issues → Stop hotfix, handle per "Upgrade Conditions" section
- Fix requires additional interface changes → Stop hotfix, handle per "Upgrade Conditions" section

After root cause is confirmed eliminated, run phase guard to transition build → verify:

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply
```

State automatically updates to `phase: verify`, `verify_result: pending`, then enter verification.

### 4. Verification (preset verify)

Reuse `/comet-verify`, with comet-verify's scale assessment deciding lightweight or full verification.

**Immediately execute:** Use the Skill tool to load the `comet-verify` skill. Skipping this step is prohibited.

Small-scale hotfixes without delta spec usually meet lightweight verification conditions (≤ 3 tasks, ≤ 2 files), comet-verify's scale assessment will select lightweight verification path (5 quick checks). If hotfix created delta spec, enter full verification path according to comet-verify's scale assessment rules.

After verification passes, record `.comet.yaml` `verify_result` as `pass` according to `/comet-verify` rules, must not skip this status before archiving.

### 5. Archive (preset archive)

Reuse `/comet-archive`. Must satisfy `verify_result: pass` in `.comet.yaml` before archiving.

**Immediately execute:** Use the Skill tool to load the `comet-archive` skill to archive. Skipping this step is prohibited.
If there is delta spec, sync to main spec according to comet-archive rules, and handle associated Design Doc and Plan archiving annotations.

---

## Continuous Execution Mode

<IMPORTANT>
Hotfix workflow is **one-time continuous execution**. After invoking `/comet-hotfix`, agent must automatically advance through hotfix steps, without pausing to wait for user input mid-way. But the following situations must pause and wait for user confirmation:

1. Encountering upgrade conditions (see "Upgrade Conditions" section). **Must use the AskUserQuestion tool to pause and wait for the user to explicitly confirm** upgrading to full workflow
2. workspace isolation and execution-method selection when tasks exceed 3 and transfer to `/comet-build`
3. verify phase (comet-verify) verification-failure and branch-handling decisions

Execution order: quick open → direct build → root cause check → verification → archive → complete

After each step completes, immediately enter next step. Within each phase, must still call corresponding Comet/OpenSpec/Superpowers skill according to above requirements; if the called skill has its own user decision points, follow that skill's rules.
</IMPORTANT>

---

## Upgrade Conditions

Upgrade to full `/comet` when **any** of the following conditions are met:

| Condition | Explanation |
|-----------|-------------|
| Change involves **3+ files** | Exceeds single-point fix scope |
| Architecture changes | New modules, new interfaces, new dependencies |
| Database schema changes | Structural adjustments |
| Introduces new public API | Fix creates new external interface |
| Fix scope exceeds single function/module | Requires coordinated changes |

When upgrade conditions are met, **must use the AskUserQuestion tool to pause and wait for the user to explicitly confirm** upgrading to the full `/comet` workflow. Do not directly enter `/comet-design`, and do not automatically supplement Design Doc. Must not just output a text prompt and then continue executing.

After user confirms upgrade, **must first update the workflow field** before entering full flow:

```bash
"$COMET_BASH" "$COMET_STATE" set <name> workflow full
```

Then on current change basis, supplement Design Doc: **Immediately use the Skill tool to load the `comet-design` skill**, proceed normally with full workflow. If user does not confirm upgrade, stop hotfix and report that current change has exceeded hotfix scope.

---

## Exit Conditions

- Bug fixed, tests pass
- Change archived
- If spec changes, synced to main spec
- **Phase guard**: Before build → verify run `"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply`; before verify → archive follow `/comet-verify` and run `"$COMET_BASH" "$COMET_GUARD" <change-name> verify --apply`
