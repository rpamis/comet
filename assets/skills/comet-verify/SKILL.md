---
name: comet-verify
description: "Comet Phase 4: Verify and Close. Invoke with /comet-verify. Verify implementation matches design, handle development branch."
---

# Comet Phase 4: Verify and Close (Verify)

## Prerequisites

- Code committed (Phase 3 complete)
- All tasks.md tasks completed

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
"$COMET_BASH" "$COMET_STATE" check <change-name> verify
```

Proceed to Step 1 after verification passes. The script outputs specific failure reasons when verification fails.

**Idempotency**: All verify phase checks can be safely re-executed. If `verify_result` is already `pass` and `branch_status` is `handled`, verification is complete — execute guard to transition. If `verify_result` is `pending`, start verification from the beginning.

### 0a. Output Language Constraint

Verification reports and branch-handling notes must use the language of the user request that triggered this workflow. When resuming an existing change with a clear dominant language in verification/design artifacts, preserve that language unless the user explicitly asks to switch. When invoking `openspec-verify-change` or `finishing-a-development-branch`, ARGUMENTS must include the same Language constraint.

### 1. Scale Assessment

Execute scale assessment:

```bash
"$COMET_BASH" "$COMET_STATE" scale <change-name>
```

The script automatically counts tasks, delta spec count, changed file count, determines light or full verification mode, and sets the verify_mode field.

Before verification begins, handle uncommitted changes through `comet/reference/dirty-worktree.md` protocol. Verify phase special handling:

1. If dirty diff belongs to current change and involves implementation, tests, tasks, delta spec, or design doc changes, do not fix or commit directly in verify phase; report failures and enter Step 1b verification failure decision blocking point
2. If dirty diff is only verify phase artifacts (e.g., verification report draft, branch handling records), may continue and record state in verify phase
3. If dirty diff shows implementation but tasks.md not checked, treat as build state lag; report failures and enter Step 1b, let user decide to roll back for fix or accept deviation

Only after user chooses fix, allow rollback to build phase:

```bash
# Execute only after user confirms fix
"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail
```

Note: If every task in build phase was committed, the script's file count based on working tree diff may underestimate change scale. In this case, must read plan file header `base-ref` and verify with commit range:

```bash
PLAN=$("$COMET_BASH" "$COMET_STATE" get <change-name> plan)
BASE_REF=$(grep '^base-ref:' "$PLAN" 2>/dev/null | head -1 | sed 's/^base-ref: *//')
git diff --stat "$BASE_REF"...HEAD
```

If commit range shows changes exceed lightweight threshold (> 4 files, cross-module coordination, or delta spec spans more than 1 capability), manually set to full verification:

```bash
"$COMET_BASH" "$COMET_STATE" set <change-name> verify_mode full
```

### 1b. Verification Failure Decision (Blocking Point)

When verification does not pass, **must use the AskUserQuestion tool to pause and wait for the user to decide fix or accept deviation**. Must not automatically run `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`, nor automatically invoke `/comet-build`. Must not just output a text prompt and then continue executing.

When pausing, must list:
- Failed items
- Whether CRITICAL (build failure, test failure, security issues, core acceptance scenario failure)
- Recommended handling approach

**Uncertainty principle**: When severity is unclear, downgrade (SUGGESTION > WARNING > CRITICAL). Only use CRITICAL for build failures, test failures, and security issues; ambiguous or uncertain issues should be WARNING or SUGGESTION.

After user selection, continue as follows:
- **Fix all**: Run `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`, then invoke `/comet-build` to fix
- **Handle item by item**: CRITICAL failures must be fixed; non-CRITICAL failures may choose to accept deviation, but must record acceptance reason and impact scope in verification report. If any CRITICAL failure exists, skipping fix to accept all is not allowed

### 2a. Lightweight Verification (Small Changes)

When scale assessment result is "small", skip `openspec-verify-change` and directly execute these checks:

1. All tasks.md tasks completed `[x]`
2. Changed files match tasks.md descriptions (`git diff --stat` / `git diff --cached --stat` / `git diff --stat <base-ref>...HEAD` compared against tasks content)
3. Build passes (run project-specific build command, e.g., `npm run build`, `mvn compile`, `cargo build`, etc.)
4. Related tests pass
5. No obvious security issues (no hardcoded keys, no new unsafe operations)

**Pass criteria**: All 5 items OK, no CRITICAL issues.

**When not passing**: Report failures, enter Step 1b verification failure decision blocking point. Only after user confirms fix, execute the following command to record failure and roll back to build phase, then invoke `/comet-build` to fix:

```bash
# Execute only after user confirms fix
"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail
```

**Report format**: Brief table listing 5 check results + PASS/FAIL.

**Skipped items** (not checked in lightweight verification):
- spec scenario coverage
- design doc consistency deep comparison
- code pattern consistency suggestions
- delta spec and design doc drift detection

### 2b. Full Verification (Large Changes)

When scale assessment result is "large":

**Immediately execute:** Use the Skill tool to load the `openspec-verify-change` skill. Skipping this step is prohibited.

After the skill loads, follow its guidance to verify. Check items:
1. All tasks.md tasks completed (`[x]`)
2. Implementation matches `openspec/changes/<name>/design.md` high-level design decisions
3. Implementation matches Design Doc (technical design documents under `docs/superpowers/specs/`)
4. All capability spec scenarios pass
5. proposal.md goals are satisfied
6. No contradictions between delta spec and design doc (if Build phase had incremental spec modifications, check if design doc has corresponding records)
7. Associated design documents under `docs/superpowers/specs/` are locatable (file exists and is related to current change)

When verification does not pass: report missing items, enter Step 1b verification failure decision blocking point. Only after user confirms fix, execute the following command to record failure and roll back to build phase, then invoke `/comet-build` to supplement:

```bash
# Execute only after user confirms fix
"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail
```

**Spec Drift Handling** (user decision point):
- If check item 6 finds contradictions (delta spec has content but design doc does not reflect it), **must use the AskUserQuestion tool as a single-select question to pause and wait for user to choose handling method**; must not select automatically. Options:
  - Option A: Append "Implementation Divergence" section to design doc recording deviation reason. Option A is a verify phase allowed artifact; after writing, must not re-trigger Step 1b dirty-worktree decision due to that design doc change
  - Option B: After user selects B, run `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`, then invoke `/comet-build`; `/comet-build`'s Spec Incremental Update rules will load the Superpowers `brainstorming` skill to update Design Doc + delta spec
  - Option C: Confirm deviation is acceptable, continue verification (design doc will be marked as `superseded-by-main-spec` during archiving)

### 3. Finishing (Superpowers)

**Immediately execute:** Use the Skill tool to load the Superpowers `finishing-a-development-branch` skill. Skipping this step is prohibited.

If the Superpowers `finishing-a-development-branch` skill is unavailable, stop the process and prompt to install or enable Superpowers skills. Do not substitute this step with normal conversation.

After the skill loads, follow its guidance to finish. Branch handling options:
1. Merge to main branch locally
2. Push and create PR
3. Keep branch (handle later)
4. Discard work

This is a user decision point. **Must use the AskUserQuestion tool to pause and wait for user to choose branch handling method**. Must not select based on recommendations, defaults, or current branch status. Must not just output a text prompt and then continue executing. Only after the user completes selection and the corresponding operation finishes, may `branch_status: handled` be written.

**Confirmation items**:
- All tests pass
- No hardcoded keys or security issues

### 4. Record Verification Evidence

Verification report must be saved to disk and recorded in `.comet.yaml`; after branch handling completes, state fields must also be written. Do not manually set `verify_result: pass`; use guard for auto-transition.

```bash
mkdir -p docs/superpowers/reports
# Write verification conclusions to report file, e.g.:
# docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md

"$COMET_BASH" "$COMET_STATE" set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
"$COMET_BASH" "$COMET_STATE" set <change-name> branch_status handled
```

## Exit Conditions

- Verification report passed
- Branch handled
- `verification_report` in `.comet.yaml` points to an existing verification report file
- `branch_status: handled` in `.comet.yaml`
- **Phase guard**: Run `"$COMET_BASH" "$COMET_GUARD" <change-name> verify --apply`; after all PASS, auto-transitions to `phase: archive` through `comet-state transition verify-pass`

After both verification and branch handling are complete, run guard for auto-transition:

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> verify --apply
```

State file auto-updates to `phase: archive`, `verify_result: pass`, `verified_at: YYYY-MM-DD`.

## Automatic Transition

After exit conditions are met (including user selecting branch handling method), auto-transition to next phase:

> **REQUIRED NEXT SKILL:** Invoke `comet-archive` skill to enter the archive phase.

## Context Compaction Recovery

The verify phase may trigger context compaction. To recover, first run:

```bash
"$COMET_BASH" "$COMET_STATE" check <change-name> verify --recover
```

The script outputs structured recovery context (phase, verification status, branch status, recovery action). Follow the Recovery action to determine next step.
