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
| `verify` | Verification, branch handling | Skip failure handling |
| `archive` | Confirm archive, run archive script | Write source code |

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

Upgrade state note: after a preset (hotfix/tweak) hits an upgrade signal and the user confirms upgrading, `comet-state transition <name> preset-escalate` legally converts it to `workflow: full` + `phase: design` + `design_doc: null`. At this point `phase: design` with an empty `design_doc` **is a normal upgrade pre-state**, not an illegal jump — the agent should enter `/comet-design` to supplement the Design Doc. This terminal state does not match the "skipped design" row above (that row only detects `phase: build`).
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

- **Phase exit**: `comet-guard <name> <phase> --apply` (must see ALL CHECKS PASSED)
- **Compression recovery**: `comet-state check <name> <phase> --recover`
- **State update**: After key operations, update fields through `comet-state set`; manually editing .comet.yaml is prohibited
- **Phase advancement only via guard/transition**: directly running `comet-state set <name> phase <value>` to jump phases is prohibited (it bypasses evidence checks and the script now hard-blocks it); use the `COMET_FORCE_PHASE=1` escape hatch only to repair a malformed state. A preset (hotfix/tweak) upgrade to full must use `comet-state transition <name> preset-escalate` — this is the only channel that can legally rewind phase to design and sync workflow/classic_profile; direct `set phase design` and `set classic_profile` are both hard-blocked
- **handoff generation**: `comet-handoff <name> design --write` (handwriting summaries is prohibited)

### User Confirmation (Cannot Auto-Skip)

The following decision points must pause to wait for explicit user selection; do not auto-fill based on recommendation rules:

- **open**: Requirements clarification completion confirmation, artifact review confirmation
- **design**: brainstorming proposal confirmation (Design Doc cannot be created before confirmation)
- **build**: plan-ready pause, four choices: `isolation` / `build_mode` / `tdd_mode` / `review_mode` (workspace isolation, execution method, TDD mode, code review mode), spec large-scale change confirmation, preset (hotfix/tweak) upgrade-assessment two-choice (when a qualitative-change signal or file-count tripwire is hit, let the user decide whether to continue the preset or upgrade to full)
- **verify**: Verification failure handling strategy, branch handling selection
- **archive**: Final confirmation before archiving

## Design Phase Specifics

1. First script operation = `comet-handoff <name> design --write` (loading brainstorming before generating handoff is prohibited)
2. brainstorming in progress: incrementally update brainstorm-summary.md (update recovery checkpoint after each clarification round or proposal iteration; unconfirmed content marked as pending/candidate)
3. After brainstorming completes, next step = brainstorm-summary.md finalization → Design Doc → guard
4. active compaction gate: after brainstorm-summary.md is finalized and before creating Design Doc, prioritize triggering host platform's native context compression; when programmatic triggering is unavailable, pause to prompt user to manually compress or confirm continuing
5. **Absolutely cannot start writing implementation code directly** — must first create Design Doc and pass guard

## Build Phase Specifics

1. After plan creation, must ask user to choose continue or pause (`build_pause` mechanism)
2. After each task acceptance, must: tasks.md checkmark → git commit (do not accumulate). `subagent-driven-development` must complete acceptance according to the current `review_mode`, then the coordinator performs targeted verification by unique task text; do not use an incomplete task summary table to replace current task verification
3. When encountering failures, must load **systematic-debugging** skill; do not propose source code fixes before root cause is located
4. spec change grading: small changes edit directly | medium changes load brainstorming | large changes pause and wait for user confirmation to split

## Verify Phase Specifics

1. First step run `comet-state scale <name>` to determine verification level
2. After verification fails, list failed items and wait for user selection; CRITICAL must be fixed
3. After 3 consecutive failures, must let user choose to accept deviation or continue fixing
4. When the user chooses to fix, run `comet-state transition <name> verify-fail`: this transition rewinds `phase` back to `build` (not staying in verify), then enter `/comet-build` to fix; after fixing, re-run the build→verify guard

## Context Compression Recovery

If context compression is suspected (previous conversation was summarized, previous discussion cannot be found), immediately run:

```bash
node "$COMET_STATE" check <name> <phase> --recover
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
comet-state next <change-name>
```

If `comet-env.mjs` has already located the scripts, the equivalent command is:

```bash
node "$COMET_STATE" next <change-name>
```

Decide the next step from the script output:

- `NEXT: auto` → use the Skill tool to load the skill named by `SKILL`
- `NEXT: manual` → do not load the next skill; show `HINT` so the user can continue manually
- `NEXT: done` → the workflow is complete; no further action is needed
