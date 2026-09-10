---
name: comet-verify
description: 'Phase 4 of Comet Classic — verify a change, record evidence, and drive repair loops.'
---

# Comet Phase 4: Verify

After entry returns layout, bind logical roots under `comet-classic/reference/classic-layout.md`; do not reload the protocol if it is already in context. OpenSpec CLI calls use the adapter and paths use the bound `<classic-*>` roots, without a separate root show first.

## Prerequisites

- Code committed (Phase 3 complete)
- All tasks.md tasks completed

## Steps

### 0a. Output Language Constraint

Verification reports use this entry's configuration.language without an extra field query.

### 0b. Entry State Verification (Entry Check)

Use the stable `comet` CLI described in `comet-classic/reference/scripts.md`, then run entry verification. When resuming from any entry point, first run the recovery check in `comet-classic/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <change-name> verify --json
```

Continue using entry layout, configuration, nextAction, task and coordination summaries. With valid checks and integrated review already present, complete only missing actions without restarting the phase. For full cold-recovery records, use --recover --details --json. Resolve specific failures.

If the `select` / `check` output is `BLOCKED` because `bound_branch` does not match the current branch, immediately pause under `comet-classic/reference/decision-point.md` and let the user choose one option: switch back to the bound branch and rerun entry verification, or run `comet state rebind <change-name>` after the user explicitly confirms the current branch should take over this change, then rerun entry verification. Do not switch branches or rebind on your own.

**Recovery**: If `verify_result` is `pass`, continue Archive; keep `branch_status: pending` until the archive commit and branch handling finish. If pending, inspect reports and evidence and resume unfinished checks. Follow `evidence.scopes` on cold recovery: reuse `revalidated` local evidence and rerun `rerun-required` scopes without repeating still-valid requirements analysis or review. Do not assume external checks are idempotent or their environment stable.

### 1. Scale Assessment

Execute scale assessment:

```bash
comet state scale <change-name>
```

The script reports task, delta spec, and changed-file counts with a light/full recommendation; it does not modify `verify_mode`. Use `--json` for `data.recommendation`, `data.selected`, and `data.metrics`. Preserve selected depth. If unselected, assess risk and explicitly record `comet state set <change-name> verify_mode <light|full>`. A full recommendation is triggered by tasks > 3, delta spec capabilities > 1, or changed files > 8.

`comet state scale` resolves the commit baseline from the plan's `base-ref` and falls back to state `base_ref` when the plan is unavailable. Verify does not reread plan frontmatter or maintain a second manual scale calculation.

Before verification begins, handle uncommitted changes through `comet-classic/reference/dirty-worktree.md` protocol. Verify phase special handling:

1. If dirty diff clearly belongs to the current change, it is verification input. Continue verification, but do not modify or commit implementation, tests, tasks, delta specs, or the Design Doc in verify
2. If dirty diff is only a verify phase artifact such as a verification report draft, may continue and record state in verify phase
3. If dirty diff shows implementation but tasks.md remains unchecked, treat it as lagging build state. This has one valid next action: run `verify-fail`, return to build, verify evidence, and update task state without asking whether to accept incomplete tasks
4. If dirty diff cannot be attributed or belongs to another change, report a stop condition through the dirty-worktree protocol. Do not disguise attribution failure as a continue/ignore choice

When repair or state reconciliation must return to build, run:

```bash
comet state transition <change-name> verify-fail
```

**Override mechanism**: If the agent or user believes the automated assessment is inappropriate, override at any time with `comet state set <change-name> verify_mode <light|full>`.

Scale does not waive risk checks: authentication/authorization, migration, concurrency, public APIs, and cross-module contracts require their risk acceptance even for small changes. Upgrade to full if coverage is insufficient.

### 1b. Automatic Verification Repair and Exception Decisions

On failure, use the latest entry's consecutive failure count and nextAction. Query `comet state get <change-name> verify_failures` only if absent; missing is not zero. Automatically return to build for the first 3 repairable failures: report failures, run `comet state transition <change-name> verify-fail`, then invoke `/comet-build` to complete only missing implementation, checks, review, or checkoff, without repeated implementation or another confirmation.

The report must list:

- Failed items
- Whether CRITICAL or IMPORTANT (build failure, test failure, security issues, core acceptance scenario failure, lightweight code review correctness/security/edge-case issue)
- Recommended handling approach

**Uncertainty principle**: Use a lower severity when evidence is unclear. Reserve CRITICAL for build failures, test failures, and security issues; use IMPORTANT for confirmed core-acceptance or correctness failures; mark ambiguous findings WARNING or SUGGESTION.

Handle failures as follows:

- **CRITICAL/IMPORTANT or objectively repairable in-scope issues**: automatically return to build below the retry limit. Do not manufacture a "whether to fix" decision, and never accept these as deviations
- **WARNING/SUGGESTION whose fix introduces a behavior, scope, or risk tradeoff**: use `comet-classic/reference/decision-point.md` to ask whether to fix or accept. Record the reason and impact scope when accepted
- **WARNING/SUGGESTION with a safe, local, tradeoff-free fix**: repair automatically below the retry limit; low severity alone does not justify a pause

Only accepting WARNING/SUGGESTION deviations or choosing a strategy after the 4th failure is a user decision point. When `verify_failures >= 3`, do not automatically execute another `verify-fail`. Offer only "Continue fixing" or "Stop this workflow and seek an external decision" under the decision protocol. Record the next failure and return to build only after the user chooses continue. CRITICAL/IMPORTANT findings are never waivable.

### 2. Artifact Context Loading (Hash On-Demand Read)

Use handoff status already provided by entry. Only when current hash verification is absent, run:

```bash
comet handoff <change-name> --hash-only
```

- Compare current hash with the recorded entry value. Only if the recorded value is absent, query `comet state get <change-name> handoff_hash`. For matching nonempty, non-null values, reuse content only if that version remains in context; read missing acceptance sections and still inspect task checkoff.
- If `RECORDED_HASH` is empty, is `null`, or differs from `CURRENT_HASH`: artifacts have changed or hash was never recorded. Read all required files in full normally.

A matching hash does not mean the Agent remembers the contents. After cold recovery, summary truncation, or missing load records, read the relevant canonical sources again; a handoff summary cannot replace unseen acceptance clauses.

Autonomous directly follows this Skill's actual-check and evidence loop without a mandatory external verification Skill. Other strategies load Superpowers `verification-before-completion`. No strategy may declare success based only on self-assessment.

Verify owns the only final integrated code review for the entire change. Build keeps only task-level or segmented reviews. Before following the `verify_mode` branch, run one integrated review over the final diff, including Build review fixes:

- `review_mode: off`: skip automatic code review and record the reason in the verification report
- `review_mode: standard|thorough`: dispatch an independent reviewer over the entire change, inspecting requirements, actual diff, checks, and fixes for correctness, security, and edge cases. Autonomous needs no external review Skill; other strategies load requesting-code-review once. Reuse valid review covering the current final diff; after input changes, review affected work instead of unconditionally repeating the whole review. Stop if review is unavailable; implementer self-review is not a substitute

For CRITICAL/IMPORTANT findings, return to Build under Step 1b. Handle non-CRITICAL deviations under Step 1b's tradeoff rules. Then follow the `verify_mode` branch:

### 2a. Lightweight Verification (Small Changes)

Run these 7 checks:

1. All tasks.md tasks completed `[x]`
2. Changed files match tasks.md descriptions (`git diff --stat` / `git diff --cached --stat` / `git diff --stat <base-ref>...HEAD` compared against tasks content)
3. Build passes (reuse Build evidence only when Runtime confirms it is still valid; rerun otherwise)
4. Related tests pass
5. No obvious security issues (no hardcoded keys, no new unsafe operations)
6. The final integrated code review passed, or an off skip reason is recorded outside full autonomous; full autonomous cannot skip independent review
7. Core success scenarios, critical failure/boundary scenarios, and applicable high-risk contracts pass; small changes do not waive them

Limit integrated code review input to this change's diff, tasks.md, and necessary test results. It does not replace spec coverage, Design Doc consistency, or drift checks. `review_mode: off` only skips automatic code review, not build, test, security checks, or debug gate protocol.

To reuse a build, call `comet check run <change-name> build --local -- <program> [args...]` with the original cwd, program, and arguments. Only Runtime `reused=true` proves reuse; changed inputs or environment trigger execution. A previous conversation's pass claim is insufficient.

Both light and full must execute actual verification through Runtime. Record the intended report path first so the report does not invalidate the input fingerprint; fill its results after executing tests and acceptance checks:

```bash
comet state set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
comet check run <change-name> verify --local -- <program> [args...]
```

Only deterministic local checks use `--local`. External-service evidence supports one successful transition: preview does not consume it; `--apply` revalidates and consumes it on success. Follow Runtime rerun requirements after cold recovery or input/environment changes. Ordinary Windows npm/pnpm shims are adapted; batch arguments containing shell metacharacters are rejected. Combine required checks through an existing project entry that propagates every failure. Manual `record-check` claims cannot advance automatically. Build and Verify evidence remain separate, and `COMET_SKIP_BUILD=1` is not auditable evidence. Read logs on demand through `logRef`.

**Pass criteria**: All 7 items OK, no CRITICAL or IMPORTANT issues.

**When not passing**: Report failures and classify them under Step 1b. Below the automatic retry limit, when an issue must or should be repaired, run the following command directly and invoke `/comet-build`:

```bash
comet state transition <change-name> verify-fail
```

**Report format**: Brief table listing 7 check results, evidence references, and PASS/FAIL.

**Skipped items** (not checked in lightweight verification):

- exhaustive per-scenario spec coverage statistics (core and high-risk scenarios still require checks)
- design doc consistency deep comparison
- code pattern consistency suggestions that do not affect correctness, security, or edge cases
- delta spec and design doc drift detection

### 2b. Full Verification (Large Changes)

When scale assessment result is "large":

**Immediately execute:** Use the Skill tool to load the `openspec-verify-change` skill. Skipping this step is prohibited.

<!-- external-openspec-skill-override -->

**External OpenSpec Skill override:** Use only its verification semantics. Replace every direct official CLI, fixed-cwd, or fixed physical OpenSpec path instruction with `comet classic openspec -- <args...>` and the resolver-returned `<classic-*>` logical roots.

After the skill loads, follow its guidance to verify. Check items:

1. All tasks.md tasks completed (`[x]`)
2. Implementation matches `<classic-change-dir>/design.md` high-level design decisions
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

- If check item 6 finds contradictions (delta spec has content but design doc does not reflect it), **pause, present the handling methods as a single-select question, and wait for the user to choose**; must not select automatically. Options:
  - Option A: Append "Implementation Divergence" section to design doc recording deviation reason. Option A is a verify phase allowed artifact; after writing, must not re-trigger Step 1b dirty-worktree decision due to that design doc change
  - Option B: After user selects B, run `comet state transition <change-name> verify-fail`, then invoke `/comet-build`; `/comet-build`'s Spec Incremental Update rules will load the Superpowers `brainstorming` skill to update Design Doc + delta spec
  - Option C: Confirm deviation is acceptable, continue verification (design doc will be marked as `superseded-by-main-spec` during archiving)

### 3. Record Verification Evidence

Save the verification report and record it in `.comet.yaml`. Do not handle, merge, or discard branches in verify and do not write `branch_status: handled`: archive creates spec and metadata changes that belong in the final commit, so `/comet-archive` owns branch finishing after that commit. Do not set `verify_result: pass` manually; use the phase guard.

```bash
comet state set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
```

Use the file tool to create `docs/superpowers/reports/` and the report file; do not depend on a POSIX-only directory command.

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

Follow `comet-classic/reference/context-recovery.md` with phase set to `verify`.

## Automatic Handoff to Next Phase

Follow `comet-classic/reference/auto-transition.md`. Key command:

```bash
comet state next <change-name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to enter the next phase
- `NEXT: manual` → do not invoke the next skill; return control with `HINT`, end the invocation, and do not create another confirmation point
- `NEXT: done` → workflow is complete, no further action needed

Note: both NEXT auto and manual require explicit archive authorization. Confirm first-time archive under comet-archive; on recovery inspect persisted delivery without asking again about valid choices. Verification success alone does not authorize archive.
