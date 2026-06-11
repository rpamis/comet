---
name: comet-open
description: "Comet Phase 1: Open. Invoke with /comet-open. Explore ideas through OpenSpec, confirm requirements clarification, then create change structure (proposal + design + tasks)."
---

# Comet Phase 1: Open

## Prerequisites

- No active change, or user wants to create a new change

## Steps

### 0. Output Language Constraint

Every prompt and artifact request passed to OpenSpec must include the output-language constraint: use the language of the user request that triggered this workflow. When resuming an existing change with a clear dominant artifact language, preserve that language unless the user explicitly asks to switch.

### 1. Explore Ideas and Clarify Requirements

**Immediately execute:** Use the Skill tool to load the `openspec-explore` skill. Skipping this step is prohibited.

After the skill loads, explore the problem space following its guidance, but do not treat one Q&A turn as sufficient clarification. You must continue asking, align with the user, and form a clarification summary covering:
- Goals: the problem the user truly wants to solve and the expected outcome
- Non-goals: what is explicitly out of scope for this change
- Scope boundaries: included/excluded modules, users, platforms, or data
- Key unknowns: unresolved assumptions, risks, or dependencies
- Draft acceptance scenarios: at least the core success scenario and important boundary scenarios

The clarification summary must include: goals, non-goals, scope boundaries, key unknowns, and draft acceptance scenarios.

### 1a. PRD Split Preflight (Blocking Point)

When the user input is a large PRD, roadmap, complete product plan, or the clarification summary shows multiple independent capabilities, modules, user journeys, or milestones, must evaluate whether it should be split into multiple changes before creating OpenSpec artifacts.

The split preflight must be based on clarified information and output a proposed split list. Each proposed split item must include:
- Suggested change name
- Goals and scope boundaries
- Explicit non-goals
- Dependencies or recommended execution order
- Core acceptance scenarios

Recommend splitting when any condition applies:
- The PRD contains multiple capabilities that can be independently designed, built, verified, and archived
- Multiple modules or user journeys are involved, and part of them can be delivered independently
- Clear phased milestones exist
- The work is expected to produce multiple delta specs or more than 3 large tasks
- Failure or delay in one part should not block other parts from entering later phases

When splitting is recommended, must use the current platform's available user input/confirmation mechanism to pause and wait for the user's choice. If the current platform has no structured question tool, ask an equivalent single-select question in the conversation, stop the workflow, and wait for the user's reply before continuing.

The user choices must include:
- "Create multiple OpenSpec changes" — create independent changes from the proposed split
- "Keep everything as one change" — continue the single-change flow and record the reason for not splitting in proposal/design/tasks
- "Adjust the split plan before continuing" — after the user describes the adjustment, output the revised proposed split list and ask for confirmation again

Every accepted split item must be created as an independent change through `/comet-open`, not by calling `/opsx:new` directly. `/comet-open` creates both OpenSpec artifacts and `.comet.yaml`, ensuring each change enters the Comet state machine.

Must not create proposal.md, design.md, or tasks.md before the user completes the PRD split choice. If the user chooses to create multiple changes, the current `/comet-open` invocation only completes split confirmation and coordination, then enters `/comet-open` for each split item in the user-confirmed order.

In batch split mode, entering `/comet-open` for each split item must explicitly mark it as a "confirmed split item" and carry that split item's goals, scope, non-goals, and acceptance scenarios. Confirmed split items skip the PRD split preflight by default, unless the split item itself still clearly contains multiple independent capabilities.

In batch split mode, a single split item must not auto-advance to `/comet-design` after completing the open phase. After splitting is complete, must pause and ask the user which change to start; after the user chooses, advance only that change into `/comet-design`, while other changes remain active and can be resumed later through `/comet`.

Minimal resume rule: do not add a dedicated batch state file. On resume, first check already-created active changes; split items that already exist and contain `.comet.yaml` must not be created again, while uncreated split items continue through `/comet-open` according to the user-confirmed split list. If the confirmed split list cannot be recovered from the conversation, must ask the user to confirm the split list again before continuing.

### 1b. Requirements Clarification Completion Confirmation (Blocking Point)

Before creating OpenSpec artifacts, must use the current platform's available user input/confirmation mechanism to pause and wait for the user to confirm requirements clarification is complete. If the current platform has no structured question tool, present the clarification summary in the conversation, ask a confirmation question, stop the workflow, and wait for the user's reply before continuing.

When pausing, present the clarification summary: goals, non-goals, scope boundaries, key unknowns, and draft acceptance scenarios.

Must not create proposal.md, design.md, or tasks.md before the user confirms requirements clarification is complete, and must not use the Skill tool to load the `openspec-propose` skill to generate all artifacts in one pass.

### 2. Create Change Structure + Initialize State

**Immediately execute:** Use the Skill tool to load the `openspec-new-change` skill. Skipping this step is prohibited.

Full `/comet` workflow must not use the Skill tool to load the `openspec-propose` skill by default; only load it when the user explicitly requests generating the proposal and artifacts in one pass.

After the skill loads, follow its guidance to create the change skeleton, but override its "STOP and wait for user direction" behavior when a confirmed clarification summary from Step 1b is already available in the conversation context. Specifically:

1. Run `openspec new change`, `openspec status`, and `openspec instructions` as the skill directs
2. If the user has already confirmed a clarification summary (Step 1b), use that summary directly to draft proposal.md — do NOT ask the user to describe the change again
3. If no clarification summary exists (edge case), fall back to the skill's default behavior of asking the user

Then fill in design.md and tasks.md one by one; every document must be based on the confirmed clarification summary.

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

## Automatic Handoff to Next Phase

> **Terminology distinction**: the "phase advancement" above is performed by guard `--apply`, which updates the `.comet.yaml` `phase` field. This step **always happens** and is not controlled by `auto_transition`. This section's "automatic handoff" only controls whether to automatically invoke the next skill.

After user confirmation and guard-based phase advancement, run:

```bash
"$COMET_BASH" "$COMET_STATE" next <change-name>
```

The script determines the next action from `phase`, `workflow`, and `auto_transition`:
- `NEXT: auto` -> invoke the `SKILL` target to continue to the next phase
- `NEXT: manual` -> do not invoke the next skill; follow `HINT` and ask the user to run `/<SKILL>` manually
- `NEXT: done` -> workflow is complete; no further action needed

Hotfix/tweak presets are controlled by their preset skills (phase goes directly to build), and their `next` output points to the preset path.
