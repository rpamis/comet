---
name: comet-verify
description: "Use when a Comet change has completed build and needs implementation verification, verification-failure decisions, or branch closeout."
---

# Comet Phase 4: Verify and Close (Verify)

## Prerequisites

- Code committed (Phase 3 complete)
- All tasks.md tasks completed

## Steps

### 0a. Output Language Constraint

Verification reports and branch-handling notes must use the configured Comet artifact language from `"$COMET_BASH" "$COMET_STATE" get <name> language`.

### 0b. Entry State Verification (Entry Check)

Locate scripts via `comet/reference/scripts.md`, then run entry verification. When resuming from any entry point, first run the recovery check in `comet/reference/context-recovery.md`:

```bash
node "$COMET_STATE" check <change-name> verify
```

Proceed to Step 1 after verification passes. The script outputs specific failure reasons when verification fails.

**Idempotency**: All verify phase checks can be safely re-executed. If `verify_result` is already `pass` and `branch_status` is `handled`, verification is complete — execute guard to transition. If `verify_result` is `pending`, start verification from the beginning.

### 1. Scale Assessment

Execute scale assessment:

```bash
node "$COMET_STATE" scale <change-name>
```

The script automatically counts tasks, delta spec count, changed file count, determines light or full verification mode, and sets the verify_mode field. Decision rule (any condition triggers full): tasks > 3, delta spec capabilities > 1, changed files > 8.

Before verification begins, handle uncommitted changes through `comet/reference/dirty-worktree.md` protocol. Verify phase special handling:

1. If dirty diff belongs to current change and involves implementation, tests, tasks, delta spec, or design doc changes, do not fix or commit directly in verify phase; report failures and enter Step 1b verification failure decision blocking point
2. If dirty diff is only verify phase artifacts (e.g., verification report draft, branch handling records), may continue and record state in verify phase
3. If dirty diff shows implementation but tasks.md not checked, treat as build state lag; report failures and enter Step 1b, let user decide to roll back for fix or accept deviation

Only after user chooses fix, allow rollback to build phase:

```bash
# Execute only after user confirms fix
node "$COMET_STATE" transition <change-name> verify-fail
```

Note: When verify-fail rolls back to build, `branch_status` is not reset. If branch handling was already completed during the first verify attempt, skip the branch handling step on re-verify and keep the existing `branch_status: handled`.

Note: If every task in build phase was committed, the script's file count based on working tree diff may underestimate change scale. In this case, must read plan file header `base-ref` and verify with commit range:

```bash
PLAN=$(node "$COMET_STATE" get <change-name> plan)
BASE_REF=$(grep '^base-ref:' "$PLAN" 2>/dev/null | head -1 | sed 's/^base-ref: *//')
git diff --stat "$BASE_REF"...HEAD
```

If commit range shows changes exceed lightweight threshold (> 8 files, cross-module coordination, or delta spec spans more than 1 capability), manually set to full verification:

```bash
node "$COMET_STATE" set <change-name> verify_mode full
```

**Override mechanism**: If the agent or user believes the automated assessment is inappropriate, override at any time with `node "$COMET_STATE" set <change-name> verify_mode <light|full>`.

### 1b. Verification Failure Decision (Blocking Point)

When verification does not pass, **must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to decide whether to fix or accept the deviation**. Must not automatically run `node "$COMET_STATE" transition <change-name> verify-fail`, nor automatically invoke `/comet-build`.

When pausing, must list:
- Failed items
- Whether CRITICAL or IMPORTANT (build failure, test failure, security issues, core acceptance scenario failure, lightweight code review correctness/security/edge-case issue)
- Recommended handling approach

**Uncertainty principle**: When severity is unclear, downgrade (SUGGESTION > WARNING > CRITICAL). Only use CRITICAL for build failures, test failures, and security issues; ambiguous or uncertain issues should be WARNING or SUGGESTION.

After user selection, continue as follows:
- **Fix all**: Run `node "$COMET_STATE" transition <change-name> verify-fail`, then invoke `/comet-build` to fix
- **Handle item by item**: CRITICAL or IMPORTANT failures must be fixed; WARNING/SUGGESTION failures may choose to accept deviation, but must record acceptance reason and impact scope in verification report. If any CRITICAL or IMPORTANT failure exists, skipping fix to accept all is not allowed

**Retry limit**: After 3 consecutive verify-fail cycles, on the 4th failure the agent must not automatically choose to continue fixing; **must use the current platform's available user input/confirmation mechanism to pause** with only two options: "Accept all deviations and record" or "Continue fixing", for the user to explicitly decide.

### 2. Artifact Context Loading (Hash On-Demand Read)

When verification needs to read OpenSpec artifacts, first check whether they have changed since the design phase:

```bash
RECORDED_HASH=$(node "$COMET_STATE" get <change-name> handoff_hash)
CURRENT_HASH=$(node "$COMET_HANDOFF" <change-name> --hash-only 2>/dev/null || echo "")
```

- If `RECORDED_HASH` = `CURRENT_HASH` and both are non-empty and neither is `null`: OpenSpec artifacts are unchanged. **tasks.md does not need to be re-read in full** (use `grep -c '\- \[ \]' tasks.md` to confirm completion count). proposal.md, design.md, and delta specs must still be read for comparison checks.
- If `RECORDED_HASH` is empty, is `null`, or differs from `CURRENT_HASH`: artifacts have changed or hash was never recorded. Read all required files in full normally.

This optimization only skips re-reading tasks.md in full. proposal.md and design.md contain the full context needed for verification checks and must not be skipped due to hash match.

**Immediately execute:** Use the Skill tool to load the Superpowers `verification-before-completion` skill. Skipping this step is prohibited.

After the skill loads, follow the `verify_mode` branch:

### 2a. Lightweight Verification (Small Changes)

Run these 6 checks:

1. All tasks.md tasks completed `[x]`
2. Changed files match tasks.md descriptions (`git diff --stat` / `git diff --cached --stat` / `git diff --stat <base-ref>...HEAD` compared against tasks content)
3. Build passes (run project-specific build command, e.g., `npm run build`, `mvn compile`, `cargo build`, etc.)
4. Related tests pass
5. No obvious security issues (no hardcoded keys, no new unsafe operations)
6. Code review strategy: when `review_mode: standard` or `thorough`, use the Skill tool to load the Superpowers `requesting-code-review` skill and request a lightweight review that checks only correctness, security, and edge cases; when `review_mode: off`, skip automatic code review and record the skip reason in the verification report

The lightweight code review input should be limited to this change's diff, tasks.md, and necessary test results; the review scope covers implementation correctness, security risk, and edge cases only, and does not perform spec coverage, Design Doc consistency, or drift checks. If the review finds CRITICAL or IMPORTANT issues, treat verification as failed and enter Step 1b. `review_mode: off` only skips automatic code review, not build, test, security checks, or debug gate protocol.

**Dedup with build-phase review**: if the build phase (`executing-plans` or `subagent-driven-development`) already completed a final code review of the same diff under `review_mode`, this lightweight verify review focuses on "whether the implementation is correct against spec/tasks" and "changes added after build", and does not re-review the diff that build already reviewed and that has not changed.

**Pass criteria**: All 6 items OK, no CRITICAL or IMPORTANT issues.

**When not passing**: Report failures, enter Step 1b verification failure decision blocking point. Only after user confirms fix, execute the following command to record failure and roll back to build phase, then invoke `/comet-build` to fix:

```bash
# Execute only after user confirms fix
node "$COMET_STATE" transition <change-name> verify-fail
```

**Report format**: Brief table listing 6 check results + PASS/FAIL.

**Skipped items** (not checked in lightweight verification):
- spec scenario coverage
- design doc consistency deep comparison
- code pattern consistency suggestions that do not affect correctness, security, or edge cases
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
node "$COMET_STATE" transition <change-name> verify-fail
```

**Spec Drift Handling** (user decision point):
- If check item 6 finds contradictions (delta spec has content but design doc does not reflect it), **must use the current platform's available user input/confirmation mechanism as a single-select question to pause and wait for the user to choose the handling method**; must not select automatically. Options:
  - Option A: Append "Implementation Divergence" section to design doc recording deviation reason. Option A is a verify phase allowed artifact; after writing, must not re-trigger Step 1b dirty-worktree decision due to that design doc change
  - Option B: After user selects B, run `node "$COMET_STATE" transition <change-name> verify-fail`, then invoke `/comet-build`; `/comet-build`'s Spec Incremental Update rules will load the Superpowers `brainstorming` skill to update Design Doc + delta spec
  - Option C: Confirm deviation is acceptable, continue verification (design doc will be marked as `superseded-by-main-spec` during archiving)

### 3. Finishing (Superpowers)

**Immediately execute:** Use the Skill tool to load the Superpowers `finishing-a-development-branch` skill. Skipping this step is prohibited.

If the Superpowers `finishing-a-development-branch` skill is unavailable, stop the process and prompt to install or enable Superpowers skills. Do not substitute this step with normal conversation.

After the skill loads, follow its guidance to finish. Branch handling options:
1. Merge to main branch locally
2. Push and create PR
3. Keep branch (handle later)
4. Discard work

This is a user decision point. **Must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to choose branch handling method**. Must not select based on recommendations, defaults, or current branch status. Only after the user completes selection and the corresponding operation finishes, may `branch_status: handled` be written.

**Confirmation items**:
- All tests pass
- No hardcoded keys or security issues

### 4. Record Verification Evidence

Verification report must be saved to disk and recorded in `.comet.yaml`; after branch handling completes, state fields must also be written. Do not manually set `verify_result: pass`; use guard for auto-transition.

```bash
mkdir -p docs/superpowers/reports
# Write verification conclusions to report file, e.g.:
# docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md

node "$COMET_STATE" set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
node "$COMET_STATE" set <change-name> branch_status handled
```

## Exit Conditions

- Verification report passed
- Branch handled
- `verification_report` in `.comet.yaml` points to an existing verification report file
- `branch_status: handled` in `.comet.yaml`
- **Phase guard**: Run `node "$COMET_GUARD" <change-name> verify --apply`; after all PASS, auto-transitions to `phase: archive` through `comet-state transition verify-pass`

After both verification and branch handling are complete, run guard for auto-transition:

```bash
node "$COMET_GUARD" <change-name> verify --apply
```

State file auto-updates to `phase: archive`, `verify_result: pass`, `verified_at: YYYY-MM-DD`.

## Context Compression Recovery

Follow `comet/reference/context-recovery.md` with phase set to `verify`.

## Automatic Handoff to Next Phase

Follow `comet/reference/auto-transition.md`. Key command:

```bash
node "$COMET_STATE" next <change-name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to enter the next phase
- `NEXT: manual` → do not invoke the next skill; prompt user to run `/<SKILL>` manually
- `NEXT: done` → workflow is complete, no further action needed

Note: after `comet-archive` starts, it must first execute the final archive confirmation blocking point and wait for the user to explicitly choose "Confirm archive" before running the archive script. Must not automatically archive just because verification passed.
