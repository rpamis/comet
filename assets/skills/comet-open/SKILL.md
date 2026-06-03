---
name: comet-open
description: "Comet Phase 1: Open. Invoke with /comet-open. Explore ideas through OpenSpec, confirm requirements clarification, then create change structure (proposal + design + tasks)."
---

# Comet Phase 1: Open

## Prerequisites

- No active change, or user wants to create a new change

## Steps

### 1. Explore Ideas and Clarify Requirements

**Immediately execute:** Use the Skill tool to load the `openspec-explore` skill. Skipping this step is prohibited.

After the skill loads, explore the problem space following its guidance, but do not treat one Q&A turn as sufficient clarification. You must continue asking, align with the user, and form a clarification summary covering:
- Goals: the problem the user truly wants to solve and the expected outcome
- Non-goals: what is explicitly out of scope for this change
- Scope boundaries: included/excluded modules, users, platforms, or data
- Key unknowns: unresolved assumptions, risks, or dependencies
- Draft acceptance scenarios: at least the core success scenario and important boundary scenarios

The clarification summary must include: goals, non-goals, scope boundaries, key unknowns, and draft acceptance scenarios.

### 1b. Requirements Clarification Completion Confirmation (Blocking Point)

Before creating OpenSpec artifacts, must use the current platform's available user input/confirmation mechanism to pause and wait for the user to confirm requirements clarification is complete. If the current platform has no structured question tool, present the clarification summary in the conversation, ask a confirmation question, stop the workflow, and wait for the user's reply before continuing.

When pausing, present the clarification summary: goals, non-goals, scope boundaries, key unknowns, and draft acceptance scenarios.

Must not create proposal.md, design.md, or tasks.md before the user confirms requirements clarification is complete, and must not use the Skill tool to load the `openspec-propose` skill to generate all artifacts in one pass.

### 2. Create Change Structure + Initialize State

**Immediately execute:** Use the Skill tool to load the `openspec-new-change` skill. Skipping this step is prohibited.

Full `/comet` workflow must not use the Skill tool to load the `openspec-propose` skill by default; only load it when the user explicitly requests generating the proposal and artifacts in one pass.

After the skill loads, follow its guidance to create the change skeleton and fill in proposal.md, design.md, and tasks.md one by one; every document must be based on the confirmed clarification summary.

**Naming and scope guard**: Change name must use a user-specified name or a name confirmed through the current platform's available user input/confirmation mechanism — must not auto-generate or infer. Change scope must match the user's description — must not expand or narrow it independently.

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

After the three documents are created and content completeness check passes, **must use the current platform's available user input/confirmation mechanism to pause and wait for user confirmation**. Must not execute phase guard or auto-transition before user confirmation. If the current platform has no structured question tool, ask an equivalent single-select question in the conversation, stop the workflow, and wait for the user's reply before continuing.

The user confirmation question must be presented as a single-select question with the following summary and options:

**Summary content**:
- **proposal.md**: problem background, goals, scope
- **design.md**: high-level architecture decisions, approach selection
- **tasks.md**: task count and key task descriptions

**Options**:
- "Confirm, proceed to next phase" — artifacts meet expectations, execute phase guard transition
- "Needs adjustment" — include adjustment notes, modify and re-request confirmation

After user selects "Confirm", proceed to exit conditions. When user selects "Needs adjustment", modify the corresponding files per their notes, then request confirmation again.

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
