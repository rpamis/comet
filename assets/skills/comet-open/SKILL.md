---
name: comet-open
description: "Use only when explicitly invoked as /comet-open or routed by the root Comet skill/runtime to the open phase; create or recover an OpenSpec change and its proposal/design/tasks/.comet.yaml artifacts."
---

# Comet Phase 1: Open

## Prerequisites

- No active change, or user wants to create a new change

## Steps

### 0. Output Language Constraint

Every prompt and artifact request passed to OpenSpec must include the resolved Comet artifact language, using normalized ids such as `en` or `zh-CN`. Before `.comet.yaml` exists, read `language` from project `.comet/config.yaml`, then fall back to global `~/.comet/config.yaml`; after the change is initialized, use `comet state get <name> language`. If no configured language exists, fall back to the current user request language. The generated `proposal.md`, `design.md`, and `tasks.md` must use that language as their main language.

### 0a. Current Change Binding

When resuming an existing change, inspect `openspec/changes/<change-name>/.comet.yaml` first:

- If it exists and parses, select the change as the first state operation
- If it is missing but the change directory is valid, run `comet state init <change-name> full`, then select the change
- If it is malformed, stop and report the parse error; repair it manually from version control, a backup, or verifiable artifacts before continuing, and never overwrite a damaged file with `state set`

```bash
comet state select <change-name>
```

When creating a new change, initialize `.comet.yaml` first, then immediately run the same command; never fabricate a selection before state exists.

### 0b. OpenSpec Compatibility Check

Before any OpenSpec status or instructions command, run:

```bash
openspec --version
```

This flow requires **OpenSpec >= 1.5.0**. Stop immediately if the version is older than 1.5.0, cannot be parsed, the command is unavailable, or it exits non-zero. Ask the user to run `npm install -g @fission-ai/openspec@latest` and retry. Never continue with an older CLI that lacks the `applyRequires`, `artifactPaths`, `changeRoot`, or `resolvedOutputPath` contracts.

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

Immediately after the user confirms multiple changes, persist the accepted split to `.comet/batches/<batch-id>.json`. Use a stable kebab-case `batch-id`. The file must record at least `version`, the original goal summary, creation time, the ordered change names, and each item's goals, scope, non-goals, acceptance scenarios, and `pending|open-complete|selected` status. Atomically update it after each item is created or completed. This is a batch orchestration manifest, not a replacement for each change's `.comet.yaml`.

In batch split mode, entering `/comet-open` for each split item must explicitly mark it as a "confirmed split item" and carry that split item's goals, scope, non-goals, and acceptance scenarios. Confirmed split items skip the PRD split preflight by default, unless the split item itself still clearly contains multiple independent capabilities.

In batch split mode, a single split item must not auto-advance to `/comet-design` after completing the open phase.

**Batch completion hard check (must not be skipped)**: after every split item completes its own open phase, run the following for each `<name>` in the user-confirmed list:

```bash
openspec status --change "<name>" --json
comet state check <name> design
```

The OpenSpec JSON must satisfy all of these conditions:
- Resolved `changeRoot` must equal repository-local `openspec/changes/<name>`; stop if it does not, because Classic runtime does not support an external change root
- The schema must include core artifact ids `proposal`, `design`, and `tasks`; extra artifacts are allowed, but a missing core id is an incompatible schema
- Every artifact listed in `applyRequires` must be `done` in `artifacts`
- Concrete outputs in `artifactPaths.<artifact-id>.existingOutputPaths` (or `resolvedOutputPath` from instructions) must exist and be non-empty
- Treat `isComplete` as diagnostic only; it neither replaces the `applyRequires` implementation-readiness check nor lets optional artifacts block phase advancement

If any split item fails these checks, must not report splitting complete or ask which change to start. Stop and resume `/comet-open` from that change's first `ready` or `blocked` artifact. If OpenSpec passes but Comet state fails, repair `.comet.yaml` initialization or phase, then rerun the checks for the entire batch.

Only after every split item passes both CLI checks may you pause and ask which change to start. Mark the chosen item `selected` in the batch manifest, then advance only that change into `/comet-design`; other changes remain active and can be resumed later through `/comet`.

On resume, read `.comet/batches/<batch-id>.json` first, then run the CLI checks above for already-created active changes. Do not recreate items that fully pass; resume incomplete items from the first `ready` artifact returned by OpenSpec. Create missing items from the persisted manifest. If the manifest is missing or damaged, stop and ask the user to rebuild/confirm it instead of inferring the original batch boundary from directory names.

### 1b. Resolve Requirements and Change Name (Non-blocking by Default)

Before creating OpenSpec artifacts, turn Step 1 clarification into a resolved brief containing the goal, non-goals, scope boundaries, key unknowns, and draft acceptance scenarios. Derive one kebab-case English change name that accurately represents that scope.

- **Continue directly when scope and naming are both unambiguous**. Do not pause merely to approve a summary or name; final review confirms the change name, scope, and artifacts together
- If the user supplied a name, normalize it to kebab-case and echo it in the progress update. Do not re-confirm when normalization preserves meaning
- Reuse a confirmed batch item's persisted summary and name. Re-clarify only when scope drift or missing manifest data is detected
- Use `comet/reference/decision-point.md` for one joint question only when mutually exclusive choices still change scope or the target change identity. Naming preference alone is not a blocking point

OpenSpec names must be kebab-case English using lowercase letters, digits, and single hyphens. When a collision exists but the target remains clear, derive a stable non-conflicting name and continue. Ask only when Comet cannot determine whether to reuse the existing change or create a new one.

Do not run `openspec new change` or create proposal/design/tasks while the resolved brief or name remains ambiguous. Continue clarification or resolve the genuine user decision before Step 2.

### 2. Create Change Structure + Initialize State

**Immediately execute:** Use the Skill tool to load the `openspec-new-change` skill. Skipping this step is prohibited.

Full `/comet` workflow must not use the Skill tool to load the `openspec-propose` skill by default; only load it when the user explicitly requests generating the proposal and artifacts in one pass.

After the skill loads, follow its guidance to create the change skeleton. When Step 1b has produced an unambiguous resolved brief, override its "STOP and wait for user direction" behavior to avoid a duplicate question.

Use the Step 1b resolved brief directly to populate artifact content. Fall back to the skill's question flow only when ambiguity remains that would change scope.

Immediately after creating the change skeleton, initialize recoverable state instead of waiting until every artifact is generated:

```bash
comet state init <name> full
comet state select <name>
comet state check <name> open
```

Stop if any command fails. Then run `openspec status --change "<name>" --json` once and perform compatibility preflight:

- Resolved `changeRoot` must equal repository-local `openspec/changes/<name>`, and `planningHome` (when present) must remain inside the current repository
- `artifacts` must contain core ids `proposal`, `design`, and `tasks`; extra artifacts are allowed
- `applyRequires` must be a parseable list of artifact ids and every id must exist in `artifacts`
- Stop on missing fields, escaping paths, or missing core ids; never fall back to a guessed fixed template

After preflight, generate the implementation-required artifacts from the OpenSpec schema and dependency graph:

**OpenSpec status-driven artifact loop**:

1. Run `openspec status --change "<name>" --json` and parse the complete JSON.
2. Exit when every item in `applyRequires` is `done`; record `isComplete` as diagnostic only and do not use it as a phase blocker.
3. From unfinished `ready` artifacts, prioritize items that advance the `applyRequires` dependency closure and process them in CLI-returned order. Must not hard-code generation order or assume the schema contains only proposal/design/tasks.
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
6. Re-run status after creating each artifact and revalidate `changeRoot`, core ids, and `applyRequires`. Do not regenerate items that become `done`; process newly `ready` items in the next loop.

**Blocking and failure handling**: if `applyRequires` is incomplete and no ready artifact can advance its dependency closure, report `missingDeps` for the relevant `blocked` artifacts and stop. Do not guess order or skip dependencies. Also stop if status/instructions fails, returns invalid JSON, escapes the repository, or provides no usable `resolvedOutputPath`. Must not fall back to hard-coded artifact prose.

**Naming and scope guard**: Use the kebab-case English name resolved in Step 1b; never use a non-kebab-case name. Change scope must match the resolved brief and user request; do not expand or narrow it independently.

Confirm the following artifacts have been created:

```
openspec/changes/<name>/
├── .openspec.yaml
├── .comet.yaml
├── proposal.md       # Why + What: problem, goals, scope
├── design.md         # How (high-level framework): architecture decisions, approach selection (deep technical design is refined in the design phase Design Doc)
└── tasks.md          # Task checklist (checkboxes)
```

### 3. Entry State Verification

Verify state machine has been correctly initialized:

```bash
comet state check <name> open
```

Proceed to Step 4 after verification passes. The script outputs specific failure reasons when verification fails.

**Idempotent recovery algorithm**: all open phase operations can be safely re-executed. On recovery, process the status in this order:

1. If state is missing, run `comet state init <name> full`; if malformed, stop and repair it instead of overwriting it. Then select the change and run `comet state check <name> open`.
2. Run status and revalidate `changeRoot`, core ids, `applyRequires`, `artifacts`, and `missingDeps`.
3. `done`: keep the artifact unchanged and do not regenerate it.
4. `ready`: fetch its instructions, write the returned output, and immediately rerun status.
5. `blocked`: follow `missingDeps` and first complete dependencies in the `applyRequires` closure; never generate a blocked artifact directly.
6. Repeat until every item in `applyRequires` is `done`.

If the required dependency graph cannot advance, list the relevant blocked artifacts and `missingDeps`, then stop. Directory or fixed-file presence cannot replace the CLI decision; conversely, an optional artifact outside `applyRequires` must not block implementation solely because `isComplete` is false.

### 4. Content Completeness Check

Run status again. Confirm core ids exist, every item in `applyRequires` is `done`, and concrete files in `artifactPaths.<id>.existingOutputPaths` for required artifacts exist and are non-empty. If any condition fails, do not enter Step 5 or execute the phase guard.

Then check key artifact content: proposal covers problem, goals, scope, and non-goals; design covers high-level decisions and data flow; tasks contains clear work items. If the schema returns specs or other artifacts, check their content against their instructions as well; the fixed three documents must not hide an incomplete schema artifact.

### 5. User Review and Confirmation (Blocking Point)

After all OpenSpec artifacts are complete and the content check passes, **must follow the `comet/reference/decision-point.md` protocol to pause and wait for user confirmation**. Must not execute the phase guard or auto-transition before user confirmation.

The final review confirms the change name, scope, and artifact content together. Do not skip it because Step 1b resolved the brief, and do not add another routine summary/name confirmation before it.

The user confirmation question must be presented as a single-select question with the following summary and options:

**Summary content**:
- **Change name and resolved brief**: final name, goal, non-goals, scope boundaries, and key unknowns
- **proposal.md**: problem background, goals, scope
- **specs and other schema artifacts**: capabilities, requirements, and key acceptance scenarios
- **design.md**: high-level architecture decisions, approach selection
- **tasks.md**: task count and key task descriptions

**Options**:
- "Confirm, proceed to next phase" — artifacts meet expectations, execute phase guard transition
- "Needs adjustment" — include adjustment notes, modify and re-request confirmation

After user selects "Confirm", proceed to exit conditions. When user selects "Needs adjustment", modify the corresponding files per their notes, then request confirmation again.

## Exit Conditions

- OpenSpec compatibility preflight passes, every `applyRequires` item is `done`, and required outputs are non-empty
- **User has confirmed** all OpenSpec artifact content meets expectations
- **Phase guard**: Run `comet guard <change-name> open --apply`; after all PASS, auto-transitions to next phase

Must use `--apply` before exit, otherwise `.comet.yaml` remains at `phase: open` and the next phase entry check will fail.

```bash
comet guard <change-name> open --apply
```

Full workflow auto-transitions to `phase: design`; hotfix/tweak presets auto-transition to `phase: build`.

## Automatic Handoff to Next Phase

Follow `comet/reference/auto-transition.md`. Key command:

```bash
comet state next <change-name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to enter the next phase
- `NEXT: manual` → do not invoke the next skill; return control with `HINT`, end the invocation, and do not create another confirmation point
- `NEXT: done` → workflow is complete, no further action needed

hotfix/tweak presets are controlled by their corresponding preset skill (phase goes directly to build); their `next` returns the corresponding preset skill.
