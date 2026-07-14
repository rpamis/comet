# Comet Phase Awareness (Anti-Drift Rules)

> This rule is injected every round to prevent forgetting Comet workflow state during long context.
> The Hook platform additionally executes `comet-hook-guard.mjs` for hard interception;
> this Rule is a universal soft defense line for all platforms.

## Global Rules

### Phase Awareness (Highest Priority)

When there is an active comet change (`openspec/changes/<name>/.comet.yaml` exists), **before starting any operation** you must read the `phase` field to confirm the current phase.

When multiple active changes exist, resolve the current change first, then run:

```bash
comet state select <change-name>
```

Ordinary source writes are governed only by the selected change phase. With multiple active changes and no valid selection, the Hook must block and ask for a choice; it must not guess alphabetically or let an unrelated open, design, or archive change globally block a legal build. A single active change may retain automatic routing.

**Phases and allowed operations:**

| Phase | Allowed | Prohibited |
|-------|---------|------------|
| `open` | Create proposal/design/tasks, run guard | Write source code |
| `design` | brainstorming, create Design Doc, run guard | Write source code |
| `build` | Write source code, tests, execute plans | Skip user confirmation points |
| `verify` | Verification, record verification report | Skip failure handling, handle the branch early |
| `archive` | Confirm archive, run archive script, commit archive changes, handle the branch | Write source code |

The hook hard interception allowlist includes workflow and platform workspaces such as `openspec/*`, `docs/superpowers/*`, `.superpowers/*`, `.claude/*`, and `.comet/*`; write access to these paths does not allow skipping the current phase's artifacts or confirmation requirements.

### Phase-Entry Self-Consistency Check (Before Writing Source Code)

Reading the `phase` field alone is not enough — you must also confirm **how** that phase was reached. Before writing any source code, self-check whether `.comet.yaml` is in an **illegal jump** state (a prior phase was skipped) using the table below. If any row matches, immediately stop writing source code, go back to the corresponding phase to fill the missing artifact, and do not trust the `phase` field to keep going.

| Detected | Verdict | Action |
|----------|---------|--------|
| `phase: build` + `workflow: full` + `design_doc` empty/null | Skipped design | Stop writing source; run `/comet-design` to create the Design Doc and pass guard |
| `phase: build` + any of proposal/design/tasks missing or empty | Skipped open | Return to `/comet-open` to fill the three artifacts |
| `phase: archive` + `verify_result` ≠ `pass` | Skipped verify | Return to `/comet-verify` to complete verification |

> Note: the table above only covers what the hook hard-gate actually detects (the `design_doc` empty-jump at the build phase; proposal/design/tasks completeness is validated at the open→build guard exit). The `verify` phase is not covered by this write-source self-consistency gate — if artifacts are found missing during verify, follow the verify-fail rewind handling under "Verify Phase Specifics" below.

Exception: `workflow: hotfix/tweak` intentionally skips design, so an empty `design_doc` is normal and not an illegal jump.

Upgrade state note: after a preset (hotfix/tweak) hits an upgrade signal and the user confirms upgrading, `comet state transition <name> preset-escalate` legally converts it to `workflow: full` + `phase: design` + `design_doc: null` and clears preset-only build settings. At this point `phase: design` with an empty `design_doc` **is a normal upgrade pre-state**, not an illegal jump — the agent should enter `/comet-design` to supplement the Design Doc, then choose the full workflow configuration again in build. This terminal state does not match the "skipped design" row above (that row only detects `phase: build`).

### Skill Invocation (Cannot Replace with Normal Conversation)

The following operations must be loaded through the Skill tool. When Skill is unavailable, stop the workflow and prompt to install:

- **brainstorming** — design phase, build phase medium-scale spec changes
- **writing-plans** — build phase creating implementation plans
- **executing-plans** / **subagent-driven-development** — build phase execution
- **test-driven-development** — in `executing-plans`, the main session loads it before the first task; in `subagent-driven-development`, each background implementer and fix agent loads it
- **systematic-debugging** — when encountering crashes/test failures/build failures
- **verification-before-completion** — verify phase
- **using-git-worktrees** — build phase when selecting worktree isolation

### Script Execution (Cannot Skip)

- **Phase exit**: `comet guard <name> <phase> --apply` (must see ALL CHECKS PASSED)
- **Compression recovery**: `comet state check <name> <phase> --recover`
- **State update**: After key operations, update fields through `comet state set`; manually editing .comet.yaml is prohibited
- **Phase advancement only via guard/transition**: directly running `comet state set <name> phase <value>` to jump phases is prohibited. A preset (hotfix/tweak) upgrade to full must use `comet state transition <name> preset-escalate`
- **handoff generation**: `comet handoff <name> design --write` (handwriting summaries is prohibited)

### User Confirmation (Cannot Auto-Skip)

The following decision points must pause to wait for explicit user selection; do not auto-fill based on recommendation rules:

- **open**: Final artifact review, which also confirms the change name and scope. Add an earlier decision only for unresolved target/scope alternatives or a large-PRD split
- **design**: brainstorming proposal confirmation (Design Doc cannot be created before confirmation)
- **build**: After capability preflight, use one joint decision for a plan-ready pause or every executable `isolation` / `build_mode` / `tdd_mode` / `review_mode`; include the branch name when branch is selected, plus large spec-change and preset-upgrade decisions
- **verify**: Accepting WARNING/SUGGESTION deviations, handling Spec drift, or choosing continue/stop after the automatic repair limit
- **archive**: Final confirmation before archiving, plus branch-handling selection after the archive commit

## Design Phase Specifics

1. First script operation = `comet handoff <name> design --write` (loading brainstorming before generating handoff is prohibited)
2. brainstorming in progress: incrementally update brainstorm-summary.md (update recovery checkpoint after each clarification round or proposal iteration; unconfirmed content marked as pending/candidate)
3. After brainstorming completes, next step = brainstorm-summary.md finalization → Design Doc → guard
4. Active context compaction is optional only after the Design Doc, state evidence, and latest handoff are persisted; when programmatic triggering is unavailable, provide a non-blocking suggestion and continue
5. **Absolutely cannot start writing implementation code directly** — must first create Design Doc and pass guard

## Build Phase Specifics

1. After plan creation, filter unavailable options, then ask one joint question: pause, or submit workspace/execution/TDD/review settings and any conditional branch name together
2. After each task acceptance, must: tasks.md checkmark → git commit (do not accumulate). `subagent-driven-development` must complete acceptance according to the current `review_mode`, then the coordinator performs targeted verification by unique task text; do not use an incomplete task summary table to replace current task verification
3. When encountering failures, must load **systematic-debugging** skill; do not propose source code fixes before root cause is located
4. spec change grading: small changes edit directly | medium changes load brainstorming | large changes pause and wait for user confirmation to split

## Verify Phase Specifics

1. First step run `comet state scale <name>` to determine verification level
2. For the first 3 clearly repairable failures, automatically run `comet state transition <name> verify-fail`, return to build, and enter `/comet-build`. CRITICAL/IMPORTANT failures cannot be accepted as deviations
3. The state machine owns `verify_failures`. After it reaches `3`, the next failure must ask whether to continue fixing or stop the workflow for an external decision
4. Ask whether to fix or accept WARNING/SUGGESTION only when repair introduces a behavior, scope, or risk tradeoff. Safe, local, tradeoff-free repairs close automatically

## Context Compression Recovery

If context compression is suspected (previous conversation was summarized, previous discussion cannot be found), immediately run:

```bash
comet state check <name> <phase> --recover
```

Decide next step according to the script's **Recovery action** output.

After recovery, first re-run the "Phase-Entry Self-Consistency Check" table: if `phase` is inconsistent with the artifacts (design_doc / three artifacts / verify_result mismatch), treat it as an illegal jump, return to the corresponding phase to fill the gap, and do not trust the `phase` field to keep going.

**Special attention to `build_mode`**: If recovery script outputs `build_mode: subagent-driven-development`, you are the coordinator, not the executor. Must:
1. Use the Skill tool to reload the Superpowers `subagent-driven-development` skill
2. Re-read `comet/reference/subagent-dispatch.md` for Comet-specific extensions
3. Read `openspec/changes/<name>/.comet/subagent-progress.md` to recover the exact stage, evidence, and review-fix round
4. Do not execute tasks directly in the main session
5. Resume from the checkpoint; start from the first unchecked task only when it is missing or mismatched
6. Tasks already committed but not yet validated according to `review_mode` remain unchecked; continue the corresponding validation/review/fix loop
7. After a task passes `review_mode` validation and targeted checkoff verification, immediately continue to the next task without summarizing or asking whether to continue

## Automatic Transition After Phase Exit

After guard `--apply` succeeds, do not hardcode the next skill in this rule. First run:

```bash
comet state next <change-name>
```

Decide the next step from the script output:

- `NEXT: auto` → use the Skill tool to load the skill named by `SKILL`
- `NEXT: manual` → do not load the next skill; return control with `HINT`, end the invocation, and do not create another confirmation point
- `NEXT: done` → the workflow is complete; no further action is needed
