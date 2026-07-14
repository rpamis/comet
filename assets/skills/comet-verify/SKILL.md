---
name: comet-verify
description: "Use only when explicitly invoked as /comet-verify or routed by the root Comet skill/runtime to the verify phase; verify a Comet change, record evidence, and manage repair loops."
---

# Comet Phase 4: Verify

## Prerequisites

- Code committed (Phase 3 complete)
- All tasks.md tasks completed

## Steps

### 0a. Output Language Constraint

Verification reports must use the configured Comet artifact language from `comet state get <name> language`.

### 0b. Entry State Verification (Entry Check)

Use the stable `comet` CLI described in `comet/reference/scripts.md`, then run entry verification. When resuming from any entry point, first run the recovery check in `comet/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <change-name> verify
```

Proceed to Step 1 after verification passes. The script outputs specific failure reasons when verification fails.

**Idempotency**: All verify checks are safe to repeat. If `verify_result` is already `pass`, verification is complete and archive should continue; keep `branch_status: pending` until archive changes are committed and final branch handling finishes. If `verify_result` is `pending`, start verification from the beginning.

### 1. Scale Assessment

Execute scale assessment:

```bash
comet state scale <change-name>
```

The script automatically counts tasks, delta spec count, changed file count, determines light or full verification mode, and sets the verify_mode field. Decision rule (any condition triggers full): tasks > 3, delta spec capabilities > 1, changed files > 8.

Before verification begins, handle uncommitted changes through `comet/reference/dirty-worktree.md` protocol. Verify phase special handling:

1. If dirty diff clearly belongs to the current change, it is verification input. Continue verification, but do not modify or commit implementation, tests, tasks, delta specs, or the Design Doc in verify
2. If dirty diff is only a verify phase artifact such as a verification report draft, may continue and record state in verify phase
3. If dirty diff shows implementation but tasks.md remains unchecked, treat it as lagging build state. This has one valid next action: run `verify-fail`, return to build, verify evidence, and update task state without asking whether to accept incomplete tasks
4. If dirty diff cannot be attributed or belongs to another change, report a stop condition through the dirty-worktree protocol. Do not disguise attribution failure as a continue/ignore choice

When repair or state reconciliation must return to build, run:

```bash
comet state transition <change-name> verify-fail
```

Note: If every task in build phase was committed, the script's file count based on working tree diff may underestimate change scale. In this case, must read plan file header `base-ref` and verify with commit range:

```bash
comet state get <change-name> plan
git diff --stat <base-ref read from plan frontmatter>...HEAD
```

The first command returns the plan path. Use the host's file reader to parse the single `base-ref` frontmatter field, validate it as a commit, then substitute it into the second command. Do not depend on POSIX text pipelines.

If commit range shows changes exceed lightweight threshold (> 8 files, cross-module coordination, or delta spec spans more than 1 capability), manually set to full verification:

```bash
comet state set <change-name> verify_mode full
```

**Override mechanism**: If the agent or user believes the automated assessment is inappropriate, override at any time with `comet state set <change-name> verify_mode <light|full>`.

### 1b. Automatic Verification Repair and Exception Decisions

Run `comet state get <change-name> verify_failures` first to read the persisted consecutive failure count. Automatically return to build for the first 3 repairable failures: report the failures, run `comet state transition <change-name> verify-fail`, then invoke `/comet-build` without asking for confirmation.

The report must list:
- Failed items
- Whether CRITICAL or IMPORTANT (build failure, test failure, security issues, core acceptance scenario failure, lightweight code review correctness/security/edge-case issue)
- Recommended handling approach

**Uncertainty principle**: Use a lower severity when evidence is unclear. Reserve CRITICAL for build failures, test failures, and security issues; use IMPORTANT for confirmed core-acceptance or correctness failures; mark ambiguous findings WARNING or SUGGESTION.

Handle failures as follows:
- **CRITICAL/IMPORTANT or objectively repairable in-scope issues**: automatically return to build below the retry limit. Do not manufacture a "whether to fix" decision, and never accept these as deviations
- **WARNING/SUGGESTION whose fix introduces a behavior, scope, or risk tradeoff**: use `comet/reference/decision-point.md` to ask whether to fix or accept. Record the reason and impact scope when accepted
- **WARNING/SUGGESTION with a safe, local, tradeoff-free fix**: repair automatically below the retry limit; low severity alone does not justify a pause

Only accepting WARNING/SUGGESTION deviations or choosing a strategy after the 4th failure is a user decision point. When `verify_failures >= 3`, do not automatically execute another `verify-fail`. Offer only "Continue fixing" or "Stop this workflow and seek an external decision" under the decision protocol. Record the next failure and return to build only after the user chooses continue. CRITICAL/IMPORTANT findings are never waivable.

### 2. Artifact Context Loading (Hash On-Demand Read)

When verification needs to read OpenSpec artifacts, first check whether they have changed since the design phase:

```bash
comet state get <change-name> handoff_hash
comet handoff <change-name> --hash-only
```

- Read the two standard outputs separately. If they match and both are non-empty and non-`null`, OpenSpec artifacts are unchanged. **tasks.md does not need to be re-read in full**; parse its checkboxes to confirm none remain unchecked. proposal.md, design.md, and delta specs must still be read for comparison checks.
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

The lightweight code review input should be limited to this change's diff, tasks.md, and necessary test results; the review scope covers implementation correctness, security risk, and edge cases only, and does not perform spec coverage, Design Doc consistency, or drift checks. If the review finds CRITICAL or IMPORTANT issues, follow Step 1b automatic repair and retry handling. `review_mode: off` only skips automatic code review, not build, test, security checks, or debug gate protocol.

If the project has no automatically inferred verification command, the user or Agent must run the real verification command first, then record its evidence separately:

```bash
comet state record-check <change-name> verify --command "<actual verification command>" --exit-code 0
```

`--command` records command text only; Comet **never executes it**. Verify and build evidence are separate and cannot substitute for each other. Even when a compatibility workflow uses `COMET_SKIP_BUILD=1`, that bypass cannot be treated as auditable verification or build evidence.

**Dedup with build-phase review**: if the build phase (`executing-plans` or `subagent-driven-development`) already completed a final code review of the same diff under `review_mode`, this lightweight verify review focuses on "whether the implementation is correct against spec/tasks" and "changes added after build", and does not re-review the diff that build already reviewed and that has not changed.

**Pass criteria**: All 6 items OK, no CRITICAL or IMPORTANT issues.

**When not passing**: Report failures and classify them under Step 1b. Below the automatic retry limit, when an issue must or should be repaired, run the following command directly and invoke `/comet-build`:

```bash
comet state transition <change-name> verify-fail
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

When verification does not pass, report missing items and classify them under Step 1b. Below the automatic retry limit, when the current change can supply the missing evidence, run the following command directly and invoke `/comet-build`:

```bash
comet state transition <change-name> verify-fail
```

**Spec Drift Handling** (user decision point):
- If check item 6 finds contradictions (delta spec has content but design doc does not reflect it), **must use the current platform's available user input/confirmation mechanism as a single-select question to pause and wait for the user to choose the handling method**; must not select automatically. Options:
  - Option A: Append "Implementation Divergence" section to design doc recording deviation reason. Option A is a verify phase allowed artifact; after writing, must not re-trigger Step 1b dirty-worktree decision due to that design doc change
  - Option B: After user selects B, run `comet state transition <change-name> verify-fail`, then invoke `/comet-build`; `/comet-build`'s Spec Incremental Update rules will load the Superpowers `brainstorming` skill to update Design Doc + delta spec
  - Option C: Confirm deviation is acceptable, continue verification (design doc will be marked as `superseded-by-main-spec` during archiving)

### 3. Record Verification Evidence

Save the verification report and record it in `.comet.yaml`. Do not handle, merge, or discard branches in verify and do not write `branch_status: handled`: archive creates spec and metadata changes that belong in the final commit, so `/comet-archive` owns branch finishing after that commit. Do not set `verify_result: pass` manually; use the phase guard.

```bash
comet state set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
```

Use the host's file API to create `docs/superpowers/reports/` and the report file; do not depend on a POSIX-only directory command.

## Exit Conditions

- Verification report passed
- `verification_report` in `.comet.yaml` points to an existing verification report file
- `branch_status` remains `pending`
- **Phase guard**: Run `comet guard <change-name> verify --apply`; after all PASS, auto-transitions to `phase: archive` through `comet state transition verify-pass`

After verification evidence is complete, run guard for auto-transition:

```bash
comet guard <change-name> verify --apply
```

State file auto-updates to `phase: archive`, `verify_result: pass`, `verified_at: YYYY-MM-DD`.

## Context Compression Recovery

Follow `comet/reference/context-recovery.md` with phase set to `verify`.

## Automatic Handoff to Next Phase

Follow `comet/reference/auto-transition.md`. Key command:

```bash
comet state next <change-name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to enter the next phase
- `NEXT: manual` → do not invoke the next skill; return control with `HINT`, end the invocation, and do not create another confirmation point
- `NEXT: done` → workflow is complete, no further action needed

Note: after `comet-archive` starts, it must first execute the final archive confirmation blocking point and wait for the user to explicitly choose "Confirm archive" before running the archive script. Must not automatically archive just because verification passed.
