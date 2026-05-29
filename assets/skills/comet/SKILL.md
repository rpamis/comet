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

## Auto-Pilot Mode (v0.4+)

When the SessionStart Hook injects `<comet-auto-resume>` context or you manually invoke `/comet-auto`, the pipeline enters autonomous mode.

### Auto-Mode Detection

Enter auto-mode when any of these conditions is met:
1. Context contains `<comet-auto-resume>` marker
2. User manually invokes `/comet-auto` or `/comet-auto --dry-run`
3. `comet-auto.yaml` has `auto.enabled: true` and manual `/comet` is invoked with `--auto` flag

### Auto-Mode Behavior

**Key differences from manual mode**:

| Scenario | Manual Mode | Auto Mode |
|----------|-------------|-----------|
| Step 0 multiple changes | Ask user to choose | Auto-select highest priority |
| Step 0 single change + description | Ask continue or new | Auto-resume existing change |
| design confirmation | Pause for user | Follow `confirm_design` policy |
| build isolation/execution choice | Ask user | Use pre-configured defaults |
| Phase transitions | Wait for user confirmation | Auto-advance |
| Blocking conditions | Pause | Retry per policy, pause when exhausted |

### Auto-Config Loading

```bash
# Load project-level config
if [ -f comet-auto.yaml ]; then
  # Read auto config
fi

# Change-level override (auto: field in .comet.yaml)
if [ -f "openspec/changes/<name>/.comet.yaml" ]; then
  # Merge change-level auto config
fi
```

Priority: change-level `.comet.yaml` > project-level `comet-auto.yaml` > global defaults.

### Compatibility with Manual Mode

Users can always type `/comet` to take control. Auto-mode degrades to reminder-only when:
- `auto.enabled: false`
- A `preset_upgrade` condition is detected (hotfix/tweak meeting upgrade criteria)

---

## Decision Core

Agents need only read this section for decision-making. Refer to the Reference Appendix as needed.

### Automatic Phase Detection

**Pre-check: Auto-Pilot Mode Detection**

Before entering Step 0, check if running in auto-mode:
- If context contains `<comet-auto-resume>` marker → **load `comet-auto` skill directly**, skip manual Decision Core
- If user manually invoked `/comet-auto` → **load `comet-auto` skill directly**
- Otherwise → continue with manual flow below

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
- If there is an active change and the worktree has uncommitted changes, handle them through `comet/reference/dirty-worktree.md`
- If `phase: build`, first check whether `build_mode` and `isolation` are set; if any fields are unset, return to `/comet-build` corresponding step to supplement before executing
- If `phase: verify` and `verify_result: fail`, enter the verification failure decision blocking point
- If `phase: open` but proposal/design/tasks are complete, first run `bash "$COMET_GUARD" <change-name> open --apply` to repair state
- If `phase: archive`, only invoke `/comet-archive`

**Step 2: Phase Determination** (check in order, first match wins)

**Decision points are blocking**: when any of the following nodes is reached, the current `/comet` invocation must stop. Only after the user makes an explicit choice should you write the corresponding state field, perform the corresponding action, then continue auto-transition.

User decision points (pause only at these):
1. brainstorming to confirm design
2. build phase: choose isolation + execution mode (single interaction)
3. verify failure: decide fix or accept deviation (including spec drift handling)
4. finishing-branch: choose branch handling
5. upgrade conditions (hotfix/tweak → full workflow)
6. build phase scope expansion requiring redesign or new change split

The agent must not skip these decision points; all other unambiguous phase transitions must auto-continue without stopping.

1. `archived: true` or change moved to archive → Workflow complete
2. `verify_result: pass` and `archived` is not `true` → Invoke `/comet-archive`
3. `verify_result: fail` → Enter verification failure decision blocking point
4. `phase: verify` or tasks.md all checked → Invoke `/comet-verify`
5. `phase: build` or has Design Doc but plan/execution incomplete → Route by workflow: `hotfix` → `/comet-hotfix`, `tweak` → `/comet-tweak`, `full` → `/comet-build`
6. `phase: design` or has change but no Design Doc → Invoke `/comet-design`
7. `phase: open` or active change exists but `.comet.yaml` is missing → Invoke `/comet-open`
8. No active change → Invoke `/comet-open`

### Preset Upgrade Criteria

**hotfix → full** (upgrade if any condition met):
- Change involves **3+ files**
- Architecture changes (new modules, new interfaces, new dependencies)
- Database schema changes
- Fix introduces new public API
- Fix scope exceeds a single function/module

**tweak → full** (upgrade if any condition met):
- Change involves **5+ files**
- Cross-module coordinated changes
- New test cases needed **5+**
- Config item additions or deletions (not value changes)

### Error Handling Quick Reference

| Scenario | Handling |
|----------|----------|
| `openspec list --json` fails | Check openspec installation, suggest `openspec init` |
| Sub-skill loading fails | Output specific error and pause; never degrade to plain conversation |
| Guard script returns non-zero | Read output, correct, retry |
| `.comet.yaml` field conflicts | File system takes precedence, auto-correct |
| Preset upgrade triggered | Pause and ask user to confirm upgrade |

## Reference Appendix

### .comet.yaml State Machine Fields

Required fields:

| Field | Meaning |
|-------|---------|
| `phase` | Current phase: `open`, `design`, `build`, `verify`, or `archive` |
| `workflow` | Workflow type: `full`, `hotfix`, or `tweak` |
| `design_doc` | Design Doc path, can be empty |
| `plan` | Implementation plan path, can be empty |
| `isolation` | Workspace isolation: `branch`, `worktree`, or `null`; hotfix/tweak default `branch` |
| `verify_mode` | `light` or `full`, can be empty |
| `verify_result` | `pending`, `pass`, or `fail` |
| `verification_report` | Verification report file path, must point to existing file before verify pass |
| `branch_status` | `pending` or `handled` after branch handling completes |
| `created_at` | Change creation date (auto-set at init), format `YYYY-MM-DD` |
| `verified_at` | Verification pass time, can be empty |
| `archived` | Whether change is archived |

Optional fields:

| Field | Meaning |
|-------|---------|
| `direct_override` | `true`/`false`. Full workflow may use `build_mode: direct` only when this is explicitly `true` |
| `build_command` | Project build command. Guard runs this first and prints failure output |
| `verify_command` | Project verification command. Verify guard runs this first; if absent, falls back to build command |
| `auto` | Auto-Pilot config override (change-level), same structure as `auto:` in `comet-auto.yaml` |

State-machine hard constraints:
- Before `build → verify`, `isolation` must be `branch` or `worktree`
- Before `build → verify`, `build_mode` must be selected
- `build_mode: direct` is allowed by default only for `hotfix` / `tweak`; full workflow requires `direct_override: true`

### Script Location

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"

if [ -z "$COMET_GUARD" ] || [ -z "$COMET_STATE" ] || [ -z "$COMET_HANDOFF" ] || [ -z "$COMET_ARCHIVE" ]; then
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed." >&2
  return 1
fi
```

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
│   │   ├── .comet/auto/               # Auto-Pilot runtime (audit trails, logs)
│   │   └── tasks.md                   # Task checklist
│   └── archive/YYYY-MM-DD-<name>/     # Archived
└── specs/<capability>/spec.md         # Main specs

docs/superpowers/                      # Superpowers — HOW
├── specs/YYYY-MM-DD-<topic>-design.md # Design doc
└── plans/YYYY-MM-DD-<feature>.md      # Implementation plan

comet-auto.yaml                        # Auto-Pilot project-level config (optional)
```

### Best Practices

1. **brainstorming cannot be skipped** — Every change must undergo deep design (except hotfix and tweak)
2. **delta spec is a living document** — Freely modify during phase 3, sync at archive
3. **Handoff packages are generated by scripts** — OpenSpec → Superpowers context must be generated through `comet-handoff.sh`
4. **Keep tasks.md in sync** — Check off each completed task
5. **Commit frequently** — One commit per task, message reflects design intent
6. **Verify before archive** — Execute `/comet-archive` only after `/comet-verify` passes
7. **Classify incremental updates** — Small edits, medium brainstorming, large new changes
8. **Plan must associate with change** — File header contains `change:` and `design-doc:` metadata
9. **Archive closure** — design doc and plan must mark `archived-with` status
10. **Modifying existing features** — Just open a new change
11. **Preset has limits** — Switch to full workflow when hotfix/tweak meet upgrade conditions
12. **Auto-Pilot mode** — Set up `comet-auto.yaml` and the SessionStart Hook will auto-resume incomplete changes; manual `/comet` can take over anytime
