---
name: comet-verify
description: 'Verify a Classic change and record the results. Use when the user invokes /comet-verify or Classic Runtime enters Verify.'
---

# Comet Phase 4: Verify

After entry returns layout, follow `comet-classic/reference/classic-layout.md` to bind each logical root to its directory. Do not reload the protocol if it is already in context. Use the adapter for OpenSpec CLI calls and the bound `<classic-*>` roots for paths; do not run an extra root show first.

## Prerequisites

- Code is committed; Phase 3 is complete.
- Every task in tasks.md is complete.

## Steps

### 0a. Set the output language

Use configuration.language from this invocation's entry result for the report. Do not query the language field separately.

### 0b. Validate entry state

Use the supported `comet` CLI in `comet-classic/reference/scripts.md` for these checks. When resuming from any entry, first follow `comet-classic/reference/context-recovery.md`:

```bash
comet state select <change-name>
comet state check <change-name> verify --json
```

Continue from the returned layout, configuration, nextAction, task information, and coordination summary. If checks and the integration review remain valid, finish only the missing work instead of rerunning the phase. After context loss, use --recover --details --json when full records are needed. Handle the reported cause of any failure.

If select/check returns `BLOCKED` because `bound_branch` differs from the current branch, pause under `comet-classic/reference/decision-point.md`. Offer a single choice: return to the bound branch and rerun entry checks, or, after the user explicitly confirms that the current branch should take over this change, run `comet state rebind <change-name>` and rerun entry checks. Do not switch or rebind branches yourself.

**Continue from recorded results:** If `verify_result` is `pass`, proceed to archive. Keep `branch_status` at `pending` until the archive commit and final branch handling are complete. If `verify_result` is `pending`, inspect existing reports and results, then resume unfinished checks.

After context loss, follow `evidence.scopes`: reuse local results marked `revalidated`; rerun the parts marked `rerun-required`. Do not repeat completed requirements analysis or reviews that still apply. Do not assume external checks are idempotent or their environments remain unchanged.

### 1. Assess the change size

Run:

```bash
comet state scale <change-name>
```

The script counts tasks, delta specs, and changed files, returning a light/full recommendation without changing `verify_mode`. Use `--json` for `data.recommendation`, `data.selected`, and `data.metrics`. Preserve an already selected mode. Otherwise, choose based on risk and record it with `comet state set <change-name> verify_mode <light|full>`. Scale recommends full if any of these hold: tasks > 3, delta-spec capabilities > 1, or changed files > 8.

`comet state scale` resolves the baseline from the plan's `base-ref`, falling back to state `base_ref` when the plan is unavailable. Do not reread plan frontmatter or build a second scale calculation manually.

Before verification, inspect uncommitted changes under `comet-classic/reference/dirty-worktree.md`. Apply these Verify-specific rules:

1. Include uncommitted changes clearly belonging to this change in the verification input. Continue verifying, but do not modify or commit implementation, tests, tasks, delta spec, or the Design Doc in Verify.
2. If uncommitted changes are Verify artifacts, such as a draft report, continue completing them and recording state in Verify.
3. If implementation exists but tasks.md is unchecked, Build's task record is behind the code. Run `verify-fail` directly to return to Build, inspect evidence, and update task state. Do not ask whether to accept unfinished tasks.
4. If ownership cannot be established or the changes belong to another change, report the stopping condition from dirty-worktree. Do not offer “continue/ignore” before ownership is known.

To return to Build for repairs or missing state:

```bash
comet state transition <change-name> verify-fail
```

**Adjust verification mode:** If the Agent or user considers the automatic recommendation unsuitable, change the mode with `comet state set <change-name> verify_mode <light|full>`.

Small changes do not waive risk checks. Authentication/authorization, data migrations, concurrency, public APIs, and cross-module interface requirements need their relevant risk scenarios verified. Use full when light cannot cover them.

### 1b. Repair verification failures and handle user decisions

On failure, read the consecutive failure count and nextAction from the latest entry. Query `comet state get <change-name> verify_failures` only if the field is missing; do not treat a missing field as zero. Automatically return to Build for the first 3 repairable failures: report the failure, run `comet state transition <change-name> verify-fail`, then invoke `/comet-build` to finish only missing implementation, checks, reviews, or task marks. Do not repeat completed work.

Report:

- The failed items.
- Whether they are CRITICAL or IMPORTANT: build/test failures, security issues, core acceptance failures, or correctness/security/edge-case issues from the simplified code review.
- The recommended response.

**When severity is uncertain**, use the lower level. Use CRITICAL only for build failures, test failures, or security issues. Use IMPORTANT for definite effects on core acceptance or correctness. Mark vague or uncertain issues WARNING or SUGGESTION.

Handle them as follows:

- **CRITICAL/IMPORTANT or a clearly repairable in-scope issue:** return to Build automatically while below the limit. Do not add “should I fix it?” approval or allow the deviation to be accepted.
- **WARNING/SUGGESTION whose fix changes behavior, scope, or risk tradeoffs:** follow `comet-classic/reference/decision-point.md` and let the user choose repair or acceptance. Record the reason and affected scope if accepted.
- **WARNING/SUGGESTION with a safe, local fix and no tradeoff:** repair automatically while below the limit; low severity alone does not require a pause.

Accepting WARNING/SUGGESTION deviations or choosing a strategy after the fourth failure requires a user decision. When current `verify_failures >= 3`, do not automatically run another `verify-fail`. Offer only “Continue repairing” or “Stop this workflow and seek an external decision.” Record the next failure and return to Build only after the user chooses to continue. CRITICAL/IMPORTANT findings can never be waived.

### 2. Read the artifacts needed for verification

When verification needs OpenSpec artifacts, use the handoff status already returned by entry. Run this only if entry lacks the current hash comparison:

```bash
comet handoff <change-name> --hash-only
```

- Compare the current hash with the recorded value from entry. Query `comet state get <change-name> handoff_hash` only if that value is absent. If both hashes are nonempty, non-null, and equal, reuse content only if that version is still in context. Read any missing sections needed for acceptance, and still verify task completion marks.
- If `RECORDED_HASH` is empty, `null`, or differs from `CURRENT_HASH`, read every required source file in full because artifacts changed or the hash was not recorded.

Matching hashes do not mean the content remains in context. After context loss, truncation, or uncertainty about what was read, reload the corresponding sources. A handoff summary cannot replace acceptance clauses that have not been read.

Autonomous performs the actual checks and records results under this Skill without requiring an external verification skill. Other strategies load Superpowers `verification-before-completion` through the Skill tool. No strategy may declare verification successful based only on self-assessment.

Verify owns the single final integration code review for the whole change. Build retains task/section reviews only. Before taking the verify_mode branch, review the final diff, including fixes from Build reviews:

- `review_mode: off`: skip automatic code review and record why in the report.
- `review_mode: standard|thorough`: dispatch an independent reviewer across the entire change. Check requirements, actual diffs, check results, and repairs, focusing on correctness, security, and edge cases. Autonomous needs no external review skill; other strategies load requesting-code-review once. Reuse a valid review covering the current final diff. After input changes, review affected parts rather than unconditionally repeating the whole review. Stop if independent review is unavailable; implementer self-review is not a substitute.

Return CRITICAL/IMPORTANT integration-review findings to Build under Step 1b. Handle non-CRITICAL deviations using Step 1b's tradeoff rules. Then follow verify_mode:

### 2a. Light verification

Check all 7 items:

1. Every tasks.md task is completed `[x]`.
2. Changed files match tasks.md; compare task content against `git diff --stat` / `git diff --cached --stat` / `git diff --stat <base-ref>...HEAD`.
3. Compilation passes; reuse Build evidence only when Runtime confirms it remains valid, otherwise rerun it.
4. Relevant tests pass.
5. No obvious security issues, such as hard-coded secrets or new unsafe operations.
6. Final integration review passes, or its omission under non-full-autonomous `review_mode: off` is recorded. Full autonomous cannot skip independent review.
7. Core success, important failure/edge cases, and the high-risk requirements affected by this change all pass. Small changes may not omit these.

To reuse a build, call `comet check run <change-name> build --local -- <program> [args...]` with the same cwd, program, and arguments used in Build. Reuse counts only when Runtime returns `reused=true`; changed inputs or environment cause an actual rerun. A past conversation saying “build passed” does not justify skipping the check.

Both light and full must execute actual verification commands through Runtime. Record the intended report path first so changes to the report are not counted as changes to verification inputs. Fill in results after tests and acceptance checks finish:

```bash
comet state set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
comet check run <change-name> verify --local -- <program> [args...]
```

Use `--local` only for deterministic local checks. Omit it for external-service checks; their results may support only one successful phase transition. Guard preview does not consume them. `--apply` rechecks them and makes them unusable again after successful advancement. After context loss or input/environment changes, let Runtime decide which checks need rerunning.

The platform adapter handles ordinary Windows npm/pnpm shims. Batch arguments containing shell metacharacters are rejected. Execute multiple required commands through an existing project verification entry that propagates any failure; a successful last command must not hide an earlier failure. Manual `record-check` only stores a declaration and cannot automatically advance the phase. Verify and Build evidence are separate and cannot substitute for one another. `COMET_SKIP_BUILD=1` is not a verifiable check record. Read logs through `logRef` as needed.

The integration review uses this change's diff, tasks.md, and necessary test results. It does not replace spec coverage, Design Doc consistency, or divergence checks. `review_mode: off` skips only automatic code review, not builds, tests, security checks, or the debugging protocol.

**Pass criteria:** all 7 items pass, with no CRITICAL or IMPORTANT issues.

**On failure:** report and classify under Step 1b. If repair is required or suitable and the automatic limit has not been reached, return to Build and invoke `/comet-build`:

```bash
comet state transition <change-name> verify-fail
```

**Report:** use a compact table for all 7 results, evidence references, and PASS/FAIL.

**Not included in light verification:**

- A scenario-by-scenario coverage count for all specs; core and high-risk scenarios remain mandatory.
- Detailed comparison of implementation against the Design Doc.
- Code-pattern consistency suggestions unrelated to correctness, security, or edge cases.
- Delta-spec/Design-Doc divergence detection.

### 2b. Full verification

When the size assessment selects a large change:

**Required now:** Load `openspec-verify-change` using the Skill tool. Do not skip this step.

<!-- external-openspec-skill-override -->

**Adapt external OpenSpec instructions:** Use its verification method only. Replace direct official CLI calls, fixed cwd, and fixed physical OpenSpec paths with `comet classic openspec -- <args...>` and resolver-provided `<classic-*>` logical roots.

Follow the skill and check:

1. Every tasks.md task is completed `[x]`.
2. Implementation follows the high-level decisions in `<classic-change-dir>/design.md`.
3. Implementation follows the Design Doc, the technical design document under `docs/superpowers/specs/`.
4. All capability-spec scenarios pass.
5. proposal.md goals are met.
6. Delta spec and Design Doc do not conflict; if Build updated the spec, check for corresponding design records.
7. The linked design document under `docs/superpowers/specs/` exists and belongs to this change.

On failure, report missing items and classify them under Step 1b. If they can be completed within this change and the automatic repair limit has not been reached, return to Build and invoke `/comet-build`:

```bash
comet state transition <change-name> verify-fail
```

**Resolve spec divergence with the user:**

- If item 6 finds content in delta spec that the Design Doc does not reflect, **pause, present a single-choice question, and wait for the user**. Do not choose automatically. Include:
  - A: append an “Implementation Divergence” section explaining the deviation to the Design Doc. This is an allowed Verify artifact; do not trigger another Step 1b dirty-worktree decision because of this design edit.
  - B: run `comet state transition <change-name> verify-fail` after the user chooses B, then invoke `/comet-build`. Build loads Superpowers `brainstorming` under its spec-update rules to update the Design Doc + delta spec.
  - C: accept the deviation and continue verification. Archive will mark the Design Doc `superseded-by-main-spec`.

### 3. Record verification evidence

Save the report as a file and record its path in `.comet.yaml`. Do not handle, merge, or discard branches in Verify, or write `branch_status: handled`. Archive still produces spec and metadata changes that must be in the final commit, so `/comet-archive` handles branches after that commit. Do not manually set `verify_result: pass`; the phase guard with `--apply` updates state and advances.

```bash
comet state set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
```

Create `docs/superpowers/reports/` and the report with file tools, not POSIX-only directory commands.

## Exit conditions

- The verification report passes.
- `.comet.yaml` `verification_report` points to an existing report file.
- `branch_status` remains `pending`.
- **Phase guard:** run `comet guard <change-name> verify --apply`. After all checks pass, the guard uses `comet state transition verify-pass` to advance to `phase: archive`, independently of `auto_transition`.

After recording all evidence, advance with the guard:

```bash
comet guard <change-name> verify --apply
```

State becomes `phase: archive`, `verify_result: pass`, and `verified_at: YYYY-MM-DD`.

## Recover after context compaction

Follow `comet-classic/reference/context-recovery.md` with phase `verify`.

## Continue to the next phase

Follow `comet-classic/reference/auto-transition.md` and `agent.continuation` from the successful result. Do not repeat next, select, or check while valid state information is available. Run this only after context loss, external state changes, or when an older result lacks that information:

```bash
comet state next <change-name>
```

- `NEXT: auto`: invoke the skill named by `SKILL`.
- `NEXT: manual`: do not invoke the next skill. Follow `HINT`, return control, and end this invocation without another confirmation question.
- `NEXT: done`: the workflow is complete.

Archive always requires explicit user authorization, whether NEXT is auto or manual. On first archive, obtain confirmation under comet-archive. On recovery, inspect saved delivery records and do not repeat a still-valid choice. Passing verification alone does not authorize archive.
