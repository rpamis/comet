---
name: comet-open
description: "Comet Phase 1: Open. Invoke with /comet-open. Explore ideas through OpenSpec, create change structure (proposal + design + tasks)."
---

# Comet Phase 1: Open

## Prerequisites

- No active change, or user wants to create a new change

## Steps

### 0. Output Language Constraint

Every prompt and artifact request passed to OpenSpec must include the output-language constraint: use the language of the user request that triggered this workflow. When resuming an existing change with a clear dominant artifact language, preserve that language unless the user explicitly asks to switch.

### 1. Explore Ideas

**Immediately execute:** Use the Skill tool to load the `openspec-explore` skill. Skipping this step is prohibited.

When loading the skill, ARGUMENTS must include:

```
Language: Use the language of the user request that triggered this workflow.
```

After the skill loads, freely explore the problem space following its guidance. All questions and summaries must use that language.

### 2. Create Change Structure + Initialize State

**Immediately execute:** Use the Skill tool to load the `openspec-new-change` skill. If the user's intent is unclear and needs proposal formation first, load `openspec-propose` instead. Skipping this step is prohibited.

**Naming and scope guard**: Change name must use a user-specified or AskUserQuestion-confirmed name — must not auto-generate or infer. Change scope must match the user's description — must not expand or narrow it independently.

When loading the skill, ARGUMENTS must include:

```
Language: Use the language of the user request that triggered this workflow for proposal.md, design.md, tasks.md, and any required delta specs.
```

Confirm the following artifacts have been created:

```
openspec/changes/<name>/
├── .openspec.yaml
├── .comet.yaml
├── proposal.md       # Why + What: problem, goals, scope
├── design.md         # How (high-level): architecture decisions, approach selection
└── tasks.md          # Task checklist (checkboxes)
```

Create `.comet.yaml` state file:

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"

if [ -z "$COMET_STATE" ] || [ -z "$COMET_GUARD" ]; then
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed." >&2
  return 1
fi

"$COMET_BASH" "$COMET_STATE" init <name> full
```

### 3. Entry State Verification

Verify state machine has been correctly initialized:

```bash
"$COMET_BASH" "$COMET_STATE" check <name> open
```

Proceed to Step 4 after verification passes. The script outputs specific failure reasons when verification fails.

**Idempotency**: All open phase operations can be safely re-executed. If `.comet.yaml` is already at `phase: open` and all three artifact files exist, skip completed steps and continue from the first missing step.

### 4. Content Completeness Check

Confirm the three documents have complete content:
- **proposal.md**: problem background, goals, scope, non-goals
- **design.md**: high-level architecture decisions, approach selection, data flow
- **tasks.md**: task list, each task has a clear description

**File existence verification**: Confirm all three file paths exist and are non-empty. If any file is missing or empty, must not enter Step 5 or execute phase guard — return to creation step to fill the gap.

### 5. User Review and Confirmation (Blocking Point)

After the three documents are created and content completeness check passes, **must use the AskUserQuestion tool to pause and wait for user confirmation**. Must not execute phase guard or auto-transition before user confirmation.

AskUserQuestion must be presented as a single-select question with the following summary and options:

**Summary content**:
- **proposal.md**: problem background, goals, scope
- **design.md**: high-level architecture decisions, approach selection
- **tasks.md**: task count and key task descriptions

**Options**:
- "Confirm, proceed to next phase" — artifacts meet expectations, execute phase guard transition
- "Needs adjustment" — include adjustment notes, modify and re-request confirmation

After user selects "Confirm", proceed to exit conditions. When user selects "Needs adjustment", modify the corresponding files per their notes, then re-use AskUserQuestion to request confirmation.

## Exit Conditions

- proposal.md, design.md, tasks.md all created with complete content
- **User has confirmed** proposal, design, tasks content meets expectations
- **Phase guard**: Run `"$COMET_BASH" "$COMET_GUARD" <change-name> open --apply`; after all PASS, auto-transitions to next phase

Must use `--apply` before exit, otherwise `.comet.yaml` remains at `phase: open` and the next phase entry check will fail.

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> open --apply
```

Full workflow auto-transitions to `phase: design`; hotfix/tweak presets auto-transition to `phase: build`.

## Automatic Transition

After user confirmation and exit conditions are met, auto-transition to next phase:

> **REQUIRED NEXT SKILL (full workflow):** Invoke `comet-design` skill to enter the deep design phase.
>
> Hotfix/tweak presets are controlled by their corresponding preset skill for subsequent transitions (phase goes directly to build), and do not go through this section.
