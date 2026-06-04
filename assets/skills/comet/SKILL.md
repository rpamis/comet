---
name: comet
description: "Comet — OpenSpec + Superpowers dual-star development workflow. Start with /comet for automatic phase detection and dispatch to subcommands. Five phases: open → design → build → verify → archive."
---

# Comet — OpenSpec + Superpowers Dual-Star Development Workflow

OpenSpec and Superpowers orbit the same goal like a binary star system.

```
OpenSpec handles WHAT  — outline, proposal, spec lifecycle, archive
Superpowers handles HOW — technical design, planning, execution, closing
```

**Core principle: brainstorming cannot be skipped. Every change must undergo deep design (except hotfix and tweak presets).**

---

## Decision Core

Agents need only read this section for decision-making. Refer to the Reference Appendix as needed.

### Output Language Rule

Use the language of the user request that triggered this workflow as the default output language. This applies to Comet's own responses and to prompts, arguments, and artifact requirements passed to OpenSpec / Superpowers.

- For new changes, write proposal.md, design.md, tasks.md, delta specs, Design Docs, Plans, verification reports, and archive notes in that language.
- When resuming an existing change, preserve the clear dominant language of existing OpenSpec/Superpowers artifacts unless the user explicitly asks to switch.
- If the user explicitly specifies an output language, follow that explicit request.
- Every OpenSpec or Superpowers skill invocation must pass this output-language constraint in ARGUMENTS instead of allowing the external skill to fall back to English.

### Automatic Phase Detection

**Step 0: Active Change Discovery and Intent Detection**

1. Detect presets first; if hotfix/tweak matches, invoke the corresponding preset skill directly and do not enter the normal open branch
2. When no preset matches, run `openspec list --json` to get all active changes

**Preset detection has highest priority**:
- User explicitly describes a bug fix / hotfix + meets hotfix conditions → directly invoke `/comet-hotfix`
- User explicitly describes copy/config/docs/prompt small adjustment + meets tweak conditions → directly invoke `/comet-tweak`
- No preset match → follow the table below

| Active changes | User input | Behavior |
|----------------|------------|----------|
| None | non-preset input | → Invoke `/comet-open` |
| Exactly 1 | `/comet <description>` | → **Ask**: continue this change or create a new change |
| Multiple | `/comet <description>` | → **Ask**: continue existing or create new; if continuing, list changes for selection |
| Exactly 1 | `/comet` with no description | → Auto-select, enter Step 1 |
| Multiple | `/comet` with no description | → List changes for user selection |

<IMPORTANT>
When the user chooses "create a new change", **must invoke `/comet-open`**. Do not call `/opsx:new` directly.
`/comet-open` performs dual initialization: OpenSpec artifacts (created by internal `/opsx:new`) plus `.comet.yaml` state file.
Calling `/opsx:new` directly leaves `.comet.yaml` missing and breaks later phase detection.
</IMPORTANT>

**Step 1: Read `.comet.yaml` state metadata**

Prefer reading `openspec/changes/<name>/.comet.yaml`. If not available, fall back to `openspec status --change "<name>" --json`, `tasks.md`, and `docs/superpowers/` file checks.

**Resume rules**:
- On every context resume, rerun Step 0 and Step 1; do not trust conversation history for phase detection
- If there is an active change and the worktree has uncommitted changes, handle them through `comet/reference/dirty-worktree.md`. That protocol defines checks, attribution, and prohibitions; this file does not repeat them
- If `phase: build`, first check `build_pause`, `plan`, `build_mode`, and `isolation`:
  - If `build_pause: plan-ready` and the plan file exists, return to the `/comet-build` plan-ready resume point, prompt the user to continue choosing isolation and execution method, and do not regenerate the plan
  - If `build_pause: plan-ready` but the plan file is missing, return to `/comet-build` to handle corrupted state or regenerate the plan
  - If `build_mode` or `isolation` is unset, return to the corresponding `/comet-build` step to supplement before executing
  - If both are set, read the next unchecked task from tasks.md and continue
- If `phase: verify` and `verify_result: fail`, enter the verification failure decision blocking point: pause and ask the user to fix or accept deviation; only after the user chooses fix, run `"$COMET_BASH" "$COMET_STATE" transition <name> verify-fail` and invoke `/comet-build`
- If `phase: open` but proposal/design/tasks are complete, first run `"$COMET_BASH" "$COMET_GUARD" <change-name> open --apply` to repair state, then continue detection
- If `phase: archive`, only invoke `/comet-archive`; after archive succeeds, the change moves to the archive directory, so do not run guard against the old active directory

**Step 2: Phase Determination** (check in order, first match wins)

1. `archived: true` or change moved to archive → Workflow complete
2. `verify_result: pass` and `archived` is not `true` → Invoke `/comet-archive`
3. `verify_result: fail` → Enter verification failure decision blocking point (pause and ask fix or accept deviation; only after user chooses fix, run `verify-fail` then `/comet-build`)
4. `phase: verify` or tasks.md all checked → Invoke `/comet-verify`
5. `phase: build` or has Design Doc but plan/execution incomplete → Route by workflow: `hotfix` → `/comet-hotfix`, `tweak` → `/comet-tweak`, `full` → `/comet-build`
6. `phase: design` or has change but no Design Doc → Invoke `/comet-design`
7. `phase: open` or active change exists but `.comet.yaml` is missing → Invoke `/comet-open`
8. No active change → Invoke `/comet-open`

If metadata conflicts with file state, use verifiable file state as source of truth and correct `.comet.yaml` before continuing.

### Preset Upgrade Criteria

**hotfix → full** (upgrade if any condition met):
- Change involves **3+ files**
- Architecture changes (new modules, new interfaces, new dependencies)
- Database schema changes
- Fix introduces new public API
- Fix scope exceeds a single function/module

**tweak → full** (upgrade if any condition met):
- Change involves **5+ files**
- Cross-module coordination required
- **5+** new test cases needed
- Config item additions or deletions (not value changes)

### Error Handling Quick Reference

| Scenario | Handling |
|----------|----------|
| `openspec list --json` fails | Check if openspec is installed, prompt user to run `openspec init` |
| Sub-skill unavailable | Stop workflow, prompt to install or enable the corresponding skill |
| `.comet.yaml` malformed or missing | Use file state as source of truth, correct with `"$COMET_BASH" "$COMET_STATE" set` then continue |
| Build/test fails | Return to build phase for fixes, do not enter verify |
| Incomplete change directory structure | Fill missing files according to `comet-open` artifact requirements |

### Phase Transitions

<IMPORTANT>
A single `/comet` invocation starts from the detected phase and advances to the next phase when exit conditions are met.

Flow chain: open → design → build → verify → archive

**Continuous execution requirement**: starting from the detected phase, the agent automatically continues through all later phases. But **auto-advancing only applies at transition points without user decisions**. When encountering user decision points, **must use the AskUserQuestion tool to pause and wait for the user's explicit response**. Must not use recommendation rules, defaults, or historical preferences to substitute for user confirmation, and must not just output a text prompt and then continue executing.

**Decision points are blocking points**: whenever reaching any of the following nodes, the current `/comet` invocation must stop, **using the AskUserQuestion tool to wait for the user's choice**. Only after the user explicitly chooses can the corresponding state fields be written and operations executed, then auto-advance resumes.

Nodes requiring user participation (pause only at these nodes):
1. Open phase proposal/design/tasks review and confirmation
2. Confirm design approach during brainstorming
3. Plan-ready pause choice during build phase, followed by workflow configuration selection (isolation + execution method)
4. Decide to fix or accept deviation when verify fails (including Spec drift handling)
5. Choose branch handling method for finishing-branch
6. Encounter upgrade conditions (hotfix/tweak → full workflow)
7. Build phase scope expansion requiring redesign or new change split

Agents should not skip these decision points; other unambiguous phase transitions must proceed automatically, must not exit midway. At decision points, **text output must NOT substitute for tool-based waiting — must explicitly obtain the user's choice via AskUserQuestion before continuing**.

**Red Flags** — when these thoughts appear, STOP and check:

| Agent Thought | Actual Risk |
|--------------|-------------|
| "The user would probably agree with this approach" | Cannot decide for the user — use AskUserQuestion |
| "This is a small change, confirmation isn't needed" | Decision points have no size exception — blocking points must wait |
| "The user chose A last time, so A again" | Historical preference cannot substitute for current confirmation |
| "I explained the plan and the user didn't object" | No objection ≠ consent — must use tool to get explicit choice |
| "The flow has reached this point, should be fine" | Verification not passed ≠ passed — check verify_result |
</IMPORTANT>

---

## Subcommand Quick Reference

| Command | Phase | Owner | Artifacts |
|---------|-------|-------|-----------|
| `/comet-open` | 1. Open | OpenSpec | proposal.md, design.md, tasks.md |
| `/comet-design` | 2. Deep Design | Superpowers | Design Doc, delta spec |
| `/comet-build` | 3. Plan and Build | Superpowers | Implementation plan, code commits |
| `/comet-verify` | 4. Verify and Close | Both | Verification report, branch handling |
| `/comet-archive` | 5. Archive | OpenSpec | delta→main spec sync, design doc markup, archive |
| `/comet-hotfix` | Preset path | Both | Quick fix (skip brainstorming) |
| `/comet-tweak` | Preset path | Both | Small change (skip brainstorming and full plan) |

```
/comet
  ↓ Auto-detect
/comet-open ──→ /comet-design ──→ /comet-build ──→ /comet-verify ──→ /comet-archive
  (OpenSpec)      (Superpowers)     (Superpowers)     (Both)          (OpenSpec)

/comet-hotfix (preset, skip brainstorming)
  open ──→ build ──→ verify ──→ archive
    ↑ If upgrade triggered → block for confirmation → supplement Design Doc → return to full workflow

/comet-tweak (preset, skip brainstorming and full plan)
  open ──→ lightweight build ──→ light verify ──→ archive
    ↑ If upgrade triggered → block for confirmation → supplement Design Doc → return to full workflow
```

---

## Reference Appendix

### .comet.yaml Field Reference

```yaml
workflow: full
phase: build
design_doc: docs/superpowers/specs/YYYY-MM-DD-topic-design.md
plan: docs/superpowers/plans/YYYY-MM-DD-feature.md
base_ref: a1b2c3d4e5f6...
build_mode: subagent-driven-development
build_pause: null
isolation: branch
verify_mode: light
verify_result: pending
verification_report: null
branch_status: pending
created_at: 2026-05-26
verified_at: null
archived: false
```

| Field | Meaning |
|-------|---------|
| `workflow` | `full`, `hotfix`, or `tweak` |
| `phase` | Current phase: `open`, `design`, `build`, `verify`, `archive` (init sets to `open` uniformly, guard handles transitions) |
| `design_doc` | Associated Superpowers Design Doc path, can be empty |
| `plan` | Associated Superpowers Plan path, can be empty |
| `base_ref` | Git commit SHA recorded at init, used for scale assessment. Serves as fallback when no plan exists |
| `build_mode` | Selected execution method, can be empty |
| `build_pause` | Internal build-phase pause point. `null` means no pause; `plan-ready` means the plan has been generated and the user chose to pause for switching models |
| `isolation` | `branch` or `worktree`, workspace isolation method. Full workflow init may leave this as `null`, but only until `/comet-build` Step 3; hotfix/tweak default to `branch` |
| `verify_mode` | `light` or `full`, can be empty |
| `verify_result` | `pending`, `pass`, or `fail` |
| `verification_report` | Verification report file path; must point to an existing file before verify can pass |
| `branch_status` | `pending` or `handled`; set to `handled` after branch handling completes |
| `created_at` | Change creation date (auto-set at init), format `YYYY-MM-DD` |
| `verified_at` | Verification pass time, can be empty |
| `archived` | Whether change is archived |

Optional fields:

| Field | Meaning |
|-------|---------|
| `direct_override` | `true`/`false`. Full workflow may use `build_mode: direct` only when this is explicitly `true` |
| `build_command` | Project build command. Guard runs this first and prints failure output |
| `verify_command` | Project verification command. Verify guard runs this first; if absent, it falls back to the build command |

State-machine hard constraints:
- Before `build → verify`, `isolation` must be `branch` or `worktree`
- Before `build → verify`, `build_mode` must be selected
- `build_mode: direct` is allowed by default only for `hotfix` / `tweak`; full workflow requires `direct_override: true`
- `build_pause` is not an execution method and must not be written to `build_mode`
- These constraints are enforced by both `comet-guard.sh build --apply` and `comet-state.sh transition <name> build-complete`

### Script Location

Comet scripts are distributed in `comet/scripts/`. **Do not hardcode paths** — locate once, cache in env vars:

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"

# Stop workflow when script location fails
if [ -z "$COMET_GUARD" ] || [ -z "$COMET_STATE" ] || [ -z "$COMET_HANDOFF" ] || [ -z "$COMET_ARCHIVE" ]; then
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed." >&2
  echo "Expected path pattern: */comet/scripts/comet-*.sh under project or platform skill directories" >&2
  return 1
fi
```

**Auto state update**: Guard supports `--apply` flag, automatically updating `.comet.yaml` state fields after checks pass:

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> <phase> --apply
```

`--apply` delegates to `comet-state transition`. Use these semantic events when state changes need to be expressed directly:

```bash
"$COMET_BASH" "$COMET_STATE" transition <change-name> open-complete
"$COMET_BASH" "$COMET_STATE" transition <change-name> design-complete
"$COMET_BASH" "$COMET_STATE" transition <change-name> build-complete
"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-pass
"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail
"$COMET_BASH" "$COMET_STATE" transition <archive-name> archived
```

**Archive script**: Complete all archive steps in one command:

```bash
"$COMET_BASH" "$COMET_ARCHIVE" <change-name>
```

After loading comet, agents should run the variable assignments above once, then reuse `$COMET_GUARD`, `$COMET_STATE`, `$COMET_HANDOFF`, `$COMET_ARCHIVE` throughout the session.

### File Structure

```
openspec/                              # OpenSpec — WHAT
├── config.yaml
├── changes/
│   ├── <name>/                        # Active change
│   │   ├── .openspec.yaml
│   │   ├── .comet.yaml
│   │   ├── proposal.md                # Why + What
│   │   ├── design.md                  # High-level architecture decisions
│   │   ├── specs/<capability>/spec.md # Delta capability spec
│   │   ├── .comet/handoff/            # Script-generated phase handoff packages
│   │   └── tasks.md                   # Task checklist
│   └── archive/YYYY-MM-DD-<name>/     # Archived
└── specs/<capability>/spec.md         # Main specs (overwritten from delta at archive)

docs/superpowers/                      # Superpowers — HOW
├── specs/YYYY-MM-DD-<topic>-design.md # Design doc (technical RFC, mark status at archive)
└── plans/YYYY-MM-DD-<feature>.md      # Implementation plan (file header contains change association metadata)
```

### Best Practices

1. **brainstorming cannot be skipped** — Every change must undergo deep design (except hotfix and tweak)
2. **delta spec is a living document** — Freely modify during phase 3, sync at archive
3. **Handoff packages are generated by scripts** — OpenSpec → Superpowers context must be generated through `comet-handoff.sh` as compact traceable excerpts (use `--full` when needed), and validated by guard for source/hash/mode
4. **Keep tasks.md in sync** — Check off each completed task
5. **Commit frequently** — One commit per task, message reflects design intent
6. **Verify before archive** — Execute `/comet-archive` only after `/comet-verify` passes
7. **Classify incremental updates** — Small edits, medium brainstorming, large new changes
8. **Plan must associate with change** — File header contains `change:` and `design-doc:` metadata
9. **Archive closure** — design doc and plan must mark `archived-with` status
10. **Modifying existing features** — Just open a new change
11. **Preset has limits** — Switch to full workflow promptly when hotfix/tweak meet upgrade conditions
