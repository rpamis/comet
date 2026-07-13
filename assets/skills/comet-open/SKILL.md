---
name: comet-open
description: "Use when Comet needs to create a new OpenSpec change, or an active change is missing proposal/design/tasks/.comet.yaml initialization artifacts."
---

# Comet Phase 1: Open

## Prerequisites

- No active change, or user wants to create a new change

## Steps

### 0. Output Language Constraint

Every prompt and artifact request passed to OpenSpec must include the resolved Comet artifact language, using normalized ids such as `en` or `zh-CN`. Before `.comet.yaml` exists, read `language` from project `.comet/config.yaml`, then fall back to global `~/.comet/config.yaml`; after the change is initialized, use `"$COMET_BASH" "$COMET_STATE" get <name> language`. If no configured language exists, fall back to the current user request language. The generated `proposal.md`, `design.md`, and `tasks.md` must use that language as their main language.

### 0a. Current Change Binding

When resuming an existing change, the first state operation must be:

```bash
comet state select <change-name>
```

When creating a new change, initialize `.comet.yaml` first, then immediately run the same command; never fabricate a selection before state exists.

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

When splitting is recommended, must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user's choice.

The user choices must include:
- "Create multiple OpenSpec changes" — create independent changes from the proposed split
- "Keep everything as one change" — continue the single-change flow and record the reason for not splitting in proposal/design/tasks
- "Adjust the split plan before continuing" — after the user describes the adjustment, output the revised proposed split list and ask for confirmation again

Every accepted split item must be created as an independent change through `/comet-open`, not by calling `/opsx:new` directly. `/comet-open` creates both OpenSpec artifacts and `.comet.yaml`, ensuring each change enters the Comet state machine.

Must not create proposal.md, design.md, or tasks.md before the user completes the PRD split choice. If the user chooses to create multiple changes, the current `/comet-open` invocation only completes split confirmation and coordination, then enters `/comet-open` for each split item in the user-confirmed order.

In batch split mode, entering `/comet-open` for each split item must explicitly mark it as a "confirmed split item" and carry that split item's goals, scope, non-goals, and acceptance scenarios. Confirmed split items skip the PRD split preflight by default, unless the split item itself still clearly contains multiple independent capabilities.

In batch split mode, a single split item must not auto-advance to `/comet-design` after completing the open phase.

**Batch completion hard check (must not be skipped)**: after every split item completes its own open phase, run the following for each `<name>` in the user-confirmed list:

```bash
openspec status --change "<name>" --json
comet state check <name> design
```

The OpenSpec JSON must satisfy all of these conditions:
- `isComplete` must be `true`
- Every item in `artifacts` must have `status: "done"`
- Existing output paths returned in `artifactPaths` must exist and be non-empty; a fixed filename list must not replace the CLI status

If any split item fails these checks, must not report splitting complete or ask which change to start. Stop and resume `/comet-open` from that change's first `ready` or `blocked` artifact. If OpenSpec passes but Comet state fails, repair `.comet.yaml` initialization or phase, then rerun the checks for the entire batch.

Only after every split item passes both CLI checks may you pause and ask which change to start. After the user chooses, advance only that change into `/comet-design`; other changes remain active and can be resumed later through `/comet`.

Minimal resume rule: do not add a dedicated batch state file. On resume, run the CLI checks above for already-created active changes. Do not recreate split items that fully pass; resume incomplete items from the first unfinished artifact returned by OpenSpec. Continue creating missing split items through `/comet-open` according to the user-confirmed list. If the confirmed list cannot be recovered from the conversation, ask the user to confirm it again before continuing.

### 1b. Requirements Clarification Completion Confirmation (Blocking Point)

Before creating OpenSpec artifacts, must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to confirm requirements clarification is complete.

When pausing, present the clarification summary: goals, non-goals, scope boundaries, key unknowns, and draft acceptance scenarios.

Must not create proposal.md, design.md, or tasks.md before the user confirms requirements clarification is complete, and must not use the Skill tool to load the `openspec-propose` skill to generate all artifacts in one pass.

### 1c. Change Name Confirmation (Blocking Point)

Before creating the change directory (`openspec new change`), must follow the `comet/reference/decision-point.md` protocol to pause and let the user decide the change name. Must not auto-generate or silently infer the change name.

OpenSpec change names must be **kebab-case English** (lowercase letters, digits, hyphens; e.g. `refine-requirements-doc`). Chinese or other non-conforming names are invalid.

When pausing, present:
- **2-3 recommended kebab-case English names** derived from the confirmed clarification summary, each with a one-line description of the scope it implies
- An explicit option for the user to **enter their own name**
- A note that **if the user enters Chinese (or any non-kebab-case text), it will be converted into a compliant kebab-case English name**, and the converted result must be shown back to the user for confirmation before use

The decision options must include:
- Pick one of the recommended names
- "Enter a custom name" — accept the user's input; if it is already valid kebab-case English, use it directly; if it is Chinese or otherwise non-conforming, convert it to compliant kebab-case English and show the converted name for confirmation before continuing

Must not run `openspec new change` or create `.comet.yaml` before the user confirms the final change name. If the chosen/converted name collides with an existing change, report the collision and ask the user to choose another name.

### 2. Create Change Structure + Initialize State

**Immediately execute:** Use the Skill tool to load the `openspec-new-change` skill. Skipping this step is prohibited.

Full `/comet` workflow must not use the Skill tool to load the `openspec-propose` skill by default; only load it when the user explicitly requests generating the proposal and artifacts in one pass.

After the skill loads, follow its guidance to create the change skeleton, but override its "STOP and wait for user direction" behavior when a confirmed clarification summary from Step 1b is already available in the conversation context.

If the user has already confirmed a clarification summary (Step 1b), use that summary directly to populate artifact content. If no clarification summary exists (edge case), fall back to the skill's default behavior of asking the user.

After creating the change skeleton, generate every artifact required by the schema and dependency graph returned by the OpenSpec CLI until the CLI explicitly reports completion:

**OpenSpec status-driven artifact loop**:

1. Run `openspec status --change "<name>" --json` and parse the complete JSON.
2. If `isComplete: true`, exit the loop and initialize `.comet.yaml`; otherwise continue.
3. From the status payload, select every item in `artifacts` with `status: "ready"` and process them one by one in CLI-returned order. Must not hard-code the artifact order or assume the schema contains only proposal/design/tasks.
4. Fetch current instructions for each ready `<artifact-id>`:

   ```bash
   openspec instructions <artifact-id> --change "<name>" --json
   ```

5. For the returned JSON instruction payload, you must:
   - Read every completed dependency artifact listed in `dependencies`
   - Use `template` as the artifact structure
   - Follow `instruction` guidance
   - Apply `context` and `rules` as constraints — **must not copy them into artifact content**
   - Write to `resolvedOutputPath`; for wildcard outputs, create each concrete file required by the instruction
   - Verify the concrete output files returned by the CLI exist and are non-empty
6. Re-run status after creating each artifact. Do not regenerate items that become `done`; process newly `ready` items in the next loop.

**Blocking and failure handling**: if `isComplete: false` and there is no ready artifact, report `missingDeps` for every `blocked` artifact and stop. Do not guess the order or skip dependencies. Also stop and report the OpenSpec error if `openspec status` or `openspec instructions` fails, returns invalid JSON, or provides no usable `resolvedOutputPath`. Must not fall back to hard-coded artifact prose.

**Naming and scope guard**: Change name must be the kebab-case English name confirmed by the user in Step 1c — must not auto-generate, infer, or use a non-kebab-case (e.g. Chinese) name. Change scope must match the user's description — must not expand or narrow it independently.

Confirm the following artifacts have been created:

```
openspec/changes/<name>/
├── .openspec.yaml
├── .comet.yaml
├── proposal.md       # Why + What: problem, goals, scope
├── design.md         # How (high-level framework): architecture decisions, approach selection (deep technical design is refined in the design phase Design Doc)
└── tasks.md          # Task checklist (checkboxes)
```

Create `.comet.yaml` state file:

First locate scripts via `comet/reference/scripts.md`, then initialize state:

```bash
node "$COMET_STATE" init <name> full
```

### 3. Entry State Verification

Verify state machine has been correctly initialized:

```bash
node "$COMET_STATE" check <name> open
```

Proceed to Step 4 after verification passes. The script outputs specific failure reasons when verification fails.

**Idempotent recovery algorithm**: all open phase operations can be safely re-executed. On recovery, process the status in this order:

1. Run `openspec status --change "<name>" --json` and read the latest `isComplete`, `artifacts`, and `missingDeps`.
2. `done`: the artifact is complete; keep its files unchanged and do not regenerate it.
3. `ready`: its dependencies are satisfied and it can be generated now. Run `openspec instructions` for that artifact, write the returned output, then immediately rerun status before choosing the next action.
4. `blocked`: it cannot be generated yet; this does not mean waiting for the user or for time to pass. Read its `missingDeps`, find those dependencies in `artifacts`, and complete the artifacts listed in `missingDeps` first. Rerun status after each dependency completes; never generate the blocked artifact directly.
5. Repeat until status returns `isComplete: true`.

If `isComplete: false` and there is no ready artifact, the dependency graph cannot currently advance. List every blocked artifact and its `missingDeps`, then stop and report the issue; do not guess an order or skip dependencies. Only `isComplete: true` means all OpenSpec open artifacts are complete. Directories, `.comet.yaml`, or the presence of three fixed files cannot replace this decision.

### 4. Content Completeness Check

Run `openspec status --change "<name>" --json` again. Confirm `isComplete: true`, every item in `artifacts` is `done`, and all concrete output files returned by `artifactPaths` exist and are non-empty. If any condition fails, must not enter Step 5 or execute the phase guard.

Then check key artifact content: proposal covers problem, goals, scope, and non-goals; design covers high-level decisions and data flow; tasks contains clear work items. If the schema returns specs or other artifacts, check their content against their instructions as well; the fixed three documents must not hide an incomplete schema artifact.

### 5. User Review and Confirmation (Blocking Point)

After all OpenSpec artifacts are complete and the content check passes, **must follow the `comet/reference/decision-point.md` protocol to pause and wait for user confirmation**. Must not execute the phase guard or auto-transition before user confirmation.

The user confirmation question must be presented as a single-select question with the following summary and options:

**Summary content**:
- **proposal.md**: problem background, goals, scope
- **specs and other schema artifacts**: capabilities, requirements, and key acceptance scenarios
- **design.md**: high-level architecture decisions, approach selection
- **tasks.md**: task count and key task descriptions

**Options**:
- "Confirm, proceed to next phase" — artifacts meet expectations, execute phase guard transition
- "Needs adjustment" — include adjustment notes, modify and re-request confirmation

After user selects "Confirm", proceed to exit conditions. When user selects "Needs adjustment", modify the corresponding files per their notes, then request confirmation again.

## Exit Conditions

- `openspec status --change "<name>" --json` returns `isComplete: true`, every artifact is `done`, and all concrete outputs are non-empty
- **User has confirmed** all OpenSpec artifact content meets expectations
- **Phase guard**: Run `node "$COMET_GUARD" <change-name> open --apply`; after all PASS, auto-transitions to next phase

Must use `--apply` before exit, otherwise `.comet.yaml` remains at `phase: open` and the next phase entry check will fail.

```bash
node "$COMET_GUARD" <change-name> open --apply
```

Full workflow auto-transitions to `phase: design`; hotfix/tweak presets auto-transition to `phase: build`.

## Automatic Handoff to Next Phase

Follow `comet/reference/auto-transition.md`. Key command:

```bash
node "$COMET_STATE" next <change-name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to enter the next phase
- `NEXT: manual` → do not invoke the next skill; prompt user to run `/<SKILL>` manually
- `NEXT: done` → workflow is complete, no further action needed

hotfix/tweak presets are controlled by their corresponding preset skill (phase goes directly to build); their `next` returns the corresponding preset skill.
