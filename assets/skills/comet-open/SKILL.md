---
name: comet-open
description: 'Create a Classic change, clarify its requirements, and obtain user confirmation. Use when the user invokes /comet-open or Classic enters Open or resumes initialization.'
---

# Comet Phase 1: Open

Before starting or resuming, read and follow `comet-classic/reference/classic-layout.md`. All OpenSpec CLI calls in this file must use the adapter, and all paths must use the `<classic-*>` logical roots bound by that protocol.

## Prerequisites

- There is no active change, or the user wants to create a new one.

## Steps

### 0. Set the output language

Every question and artifact-generation request passed to OpenSpec must specify the resolved Comet artifact language using a normalized ID such as `en` or `zh-CN`. Before `.comet.yaml` exists, read `classic.language` from project `.comet/config.yaml`, then global `~/.comet/config.yaml`. After initialization, use `comet state get <name> language`. Fall back to the current request's language only when no language is configured. `proposal.md`, `design.md`, and `tasks.md` must primarily use that language.

### 0a. Bind the current change

When resuming an existing change, first inspect `<classic-change-dir>/.comet.yaml`:

- If it exists and parses, run `comet classic workspace resolve <change-name> --json`, enter the returned `projectRoot`, and select the change there.
- If state is missing but the change directory is valid, prepare the workspace using the selected isolation mode. Enter the returned `projectRoot`, run `comet state init <change-name> full --isolation <selected-isolation>`, and then select the change.
- If state is malformed, stop and report the parse error. Resume only after manual repair using version control, a backup, or verifiable artifacts. Do not overwrite damaged state with `state set`.

```bash
comet classic workspace resolve <change-name> --json
# Enter the returned projectRoot
comet state select <change-name>
```

For a new change, initialize `.comet.yaml` first and immediately run the select command above. Do not manually write a selection before state exists.

### 0b. Choose and prepare the workspace before Open

Read `comet-classic/reference/workspace.md` when creating a Classic change. Choose the workspace before creating OpenSpec artifacts or `.comet.yaml`; do not defer this to Build.

- If the user explicitly requests parallel work, use `worktree` directly. Prepare the independent workspace before creating OpenSpec artifacts or state.
- If isolation is unspecified, follow the reference. When a choice is needed, present the available `current`, `branch`, and `worktree` options; a recommendation does not replace the user's choice.
- `current` and `branch` still require serial work. Do not describe them as suitable for concurrent sessions.

Prepare the workspace before running OpenSpec `new`:

```bash
comet classic workspace prepare <name> --isolation <current|branch|worktree> --json
# Enter projectRoot; run subsequent OpenSpec/state commands and artifact writes there
```

The prepare command reuses a registered worktree with the matching branch. If the branch remains but the registered worktree was removed, it recreates the worktree. Request an explicit rebind only if the branch was renamed, taken over for other work, or its ownership cannot be established.

### 0c. Check OpenSpec compatibility

Run this once on first use or after the upstream installation changes, and record the version for troubleshooting:

```bash
comet classic openspec -- --version
```

Check actual capabilities rather than inferring compatibility from the version. Status must provide `changeRoot`, `applyRequires`, and each artifact's `requires`, `outputPath`, and `status`. Instructions must provide a usable `resolvedOutputPath`. The adapter has been checked against the state interfaces in OpenSpec 1.11.0/1.12.0; compatibility with every historical version is not guaranteed. If a command is unavailable, exits nonzero, or lacks a required capability, stop with the error and upgrade guidance. Do not upgrade the user's environment automatically.

After creation, `comet state artifacts <name> --json` checks paths, all required dependencies, and actual files. It recursively expands `applyRequires` together with Classic's mandatory proposal/tasks into the full dependency closure. If that closure requires design, do not skip it because instructions call it optional; design outside the closure is not mandatory.

Skipping specs is valid only when the request changes no behavioral specification, `.openspec.yaml` explicitly sets `skip_specs: true`, and no conflicting spec files exist. Supported roles are proposal/specs/design/tasks. Report unsupported mandatory roles or output patterns instead of guessing how to handle them.

### 1. Explore the idea and clarify requirements

**Required now:** Load the `openspec-explore` skill using the Skill tool. Do not skip this step.

<!-- external-openspec-skill-override -->

**Adapt external OpenSpec instructions:** Use its exploration method only. Do not follow instructions that directly invoke the official CLI, change to a fixed cwd, or read/write hard-coded OpenSpec directories. Use `comet classic openspec -- <args...>` for every CLI call and this invocation's bound `<classic-*>` roots for every path.

Reuse the user's PRD, designs, and confirmed facts first. Identify gaps in the following areas and produce a clarification summary. Ask only about unknowns that would change scope, the solution, or acceptance. If information is sufficient, proceed without additional questions; there is no minimum number of clarification rounds.

- Goal: the user's actual problem and desired result.
- Non-goals: what this change explicitly excludes.
- Scope: included and excluded modules, users, platforms, or data.
- Key unknowns: unresolved assumptions, risks, or dependencies.
- Draft acceptance scenarios: at least the core success path and important edge cases.

The summary must include all five areas: goal, non-goals, scope, key unknowns, and draft acceptance scenarios.

Before asking the user, read `comet-classic/reference/decision-point.md`. State the question, recommendation and reasoning, and each option's impact; prefer an available `AskUserQuestion` tool. Ask only about current gaps. If missing facts or materials cannot support real options, explain what is missing and request it. Apply this protocol to questions from the external exploration skill as well; loading that skill does not permit omitting choices or deciding for the user.

Reference a full PRD by path and relevant sections rather than copying it. Do not reconfirm settled facts; clarify only actual contradictions. OpenSpec skills remain mandatory dependencies. Return to Comet when exploration ends; external skills must not independently enter design, implementation, or archive. Exploration approval does not replace Open's final artifact confirmation.

### 1a. Confirm whether to split the PRD before creation

For a large PRD, roadmap, complete product proposal, or a clarification summary containing multiple independent features, modules, user journeys, or milestones, assess whether multiple changes are needed before creating OpenSpec artifacts.

Use the clarified information to present a proposed split. Each item must include:

- Suggested change name.
- Goal and scope.
- Explicit non-goals.
- Dependencies or recommended execution order.
- Core acceptance scenarios.

Recommend splitting when any of these apply:

- The PRD contains multiple features that can be designed, built, verified, and archived independently.
- It spans multiple modules or user journeys, with a portion that can ship independently.
- It has distinct delivery milestones.
- Several delta specs serve independent goals that can be accepted and shipped separately. Document or task counts alone do not determine a split.
- Failure or delay in one part should not prevent the others from proceeding.

If you recommend splitting, pause under `comet-classic/reference/decision-point.md` and wait for the user's choice. Include all these options:

- “Create multiple OpenSpec changes”: create each proposed item as an independent change.
- “Keep one change”: continue with one change and record the reason in proposal/design/tasks.
- “Revise the split”: ask for the desired adjustments, revise the list, and obtain confirmation again.

Create every accepted item through `/comet-open`, not directly through `/opsx:new`. `/comet-open` creates both OpenSpec artifacts and `.comet.yaml`, keeping each change under the Comet state machine.

Do not create proposal.md, design.md, or tasks.md before the user chooses how to split the PRD. If they choose multiple changes, this `/comet-open` invocation handles split confirmation and scheduling only, then invokes `/comet-open` for each item in the approved order.

Immediately save the confirmed batch to `.comet/batches/<batch-id>.json`. Use a stable kebab-case `batch-id`. Record at least `version`, the original goal summary, creation time, ordered change names, and each item's goal, scope, non-goals, acceptance scenarios, and `pending|open-complete|selected` status. Atomically update the file after each item is created or completed. This list tracks batch order and progress; it does not replace each change's `.comet.yaml`.

When invoking `/comet-open` for a batch item, label it “confirmed split item” and pass its goal, scope, non-goals, and acceptance scenarios. Skip the PRD split assessment for a confirmed item unless that item still clearly contains multiple independent features.

Do not automatically move an individual batch item from Open to `/comet-design`. When the batch is complete, pause and ask which change to start. Advance only the selected change to `/comet-design`; leave the others unarchived for later recovery through `/comet-classic`.

**Check every completed batch item; do not skip this:** After all items finish Open, run the following for every `<name>` on the confirmed list:

```bash
comet state check <name> design --json
```

This entry validates the full required closure, actual OpenSpec outputs, and Comet state. Do not repeat a separate status scan. `isComplete` is diagnostic; optional artifacts do not block progress. Query status only after a failed check to locate missing dependencies or diagnose reported path/capability errors.

If any split item fails these checks, do not announce batch completion or ask which change to start. Stop further advancement and resume `/comet-open` at that change's first `ready` or `blocked` artifact. If OpenSpec checks pass but Comet state checks fail, repair `.comet.yaml` initialization or phase first, then rerun the batch checks.

Only after every item passes entry checks may you ask which change to start. Mark the user's chosen item `selected` in the batch list and advance that change alone to `/comet-design`. Leave the others unarchived for later recovery through `/comet-classic`.

On recovery, read `.comet/batches/<batch-id>.json`, then run the checks above for its created, unarchived changes. Do not recreate items that already pass. Resume failed items from the first `ready` artifact returned by OpenSpec. Create the remaining items from the saved list. If the list is missing or damaged, stop and ask the user to rebuild or confirm it; do not infer the original batch from directory names.

### 1b. Summarize requirements and choose the change name

Before creating artifacts, turn Step 1's findings into a resolved brief containing goal, non-goals, scope, key unknowns, and draft acceptance scenarios. Derive an English kebab-case change name that accurately describes that scope.

- **Continue directly when scope and name are clear.** Do not add a pause solely to approve the summary or name; final review confirms the name, scope, and artifact content together.
- If the user supplied a name, normalize it to kebab-case and echo it in a progress update. No reconfirmation is needed when normalization preserves meaning.
- Reuse a confirmed batch item's summary and name. Clarify again only if scope has changed or the list lacks needed information.
- Ask a joint question under `comet-classic/reference/decision-point.md` only when mutually exclusive scope or target-change choices remain. Naming preference alone is not a reason to pause.

OpenSpec change names must use English kebab-case: lowercase letters, digits, and single hyphens. If a name conflicts but the goal is clear, choose a nonconflicting name with the same meaning and continue. Ask the user only when you cannot determine whether to reuse an existing change or create a new one.

While the resolved brief or change identity is still unclear, do not run `comet classic openspec -- new change` or create proposal/design/tasks. Resolve the missing information or genuine user decision before Step 2.

### 2. Create the change structure and initialize state

**Required now:** Load the `openspec-new-change` skill using the Skill tool. Do not skip this step.

<!-- external-openspec-skill-override -->

**Adapt external OpenSpec instructions:** Use its change-creation method only. Do not directly invoke the official CLI, adopt a fixed cwd, or write to a fixed OpenSpec root. Route creation, status, and instructions through `comet classic openspec -- <args...>`. Use this invocation's logical roots, including `<classic-change-dir>`, for all paths.

Do not load `openspec-propose` by default in the full `/comet-classic` flow. Load it only if the user explicitly requests a proposal and artifacts generated together.

<!-- external-openspec-skill-override -->

**Adapt external OpenSpec instructions:** The same restrictions apply to `openspec-propose`: no direct official CLI, fixed cwd, or fixed physical OpenSpec path. Commands must use the adapter and artifacts must use resolver-provided `<classic-*>` roots.

Create the change's initial structure following the loaded skill. If Step 1b already produced a clear resolved brief, override its “STOP and wait for user direction” behavior and proceed without repeating the question.

Use that resolved brief to populate the artifacts. Return to the skill's questions only if the brief still has ambiguity that would change scope.

Initialize recoverable state immediately after creating the initial structure; do not wait for every artifact to be generated:

```bash
comet state init <name> full --isolation <selected-isolation>
comet state select <name>
comet state check <name> open
```

Stop if any command fails. Then run `comet classic openspec --agent-json -- status --change "<name>" --json` once and check compatibility:

- Resolved `changeRoot` must equal the bound `<classic-change-dir>`. `planningHome`, when present, must also be inside the repository. External artifact paths are unsupported.
- `artifacts` must include Classic's required IDs `proposal` and `tasks`; recursively follow their `requires`.
- `applyRequires` must be a resolvable list of artifact IDs. All direct and transitive dependencies must exist and be acyclic.
- Stop immediately for missing fields, out-of-repository paths, or missing required IDs. Do not fall back to guessed templates.

Once the checks pass, generate the required artifacts from the schema and dependency graph returned by OpenSpec.

In Agent JSON mode, read upstream fields from `data.upstream.data`. Execute only the complete argv and cwd returned by `data.nextAction`; upstream raw nextSteps are diagnostic only.

**Generate artifacts from OpenSpec state:**

1. Reuse the status from Step 2's compatibility check for the first iteration, and the refreshed status from the preceding write for later iterations. Rerun `comet classic openspec --agent-json -- status --change "<name>" --json` only on recovery or external artifact changes, reading the full upstream JSON from `data.upstream.data`.
2. Expand the full dependency closure of `applyRequires` plus proposal/tasks. Once every item is `done` or legitimately `skipped`, run `comet state artifacts <name> --json` and exit the loop only if it passes. A completed top-level tasks artifact cannot hide incomplete dependencies. `isComplete` is diagnostic.
3. From unfinished artifacts with `status: "ready"`, prioritize those that advance the `applyRequires` dependency closure, following CLI order. Do not hard-code generation order or assume the schema contains only proposal/design/tasks.
4. Get current instructions for each ready `<artifact-id>`:

   ```bash
   comet classic openspec --agent-json -- instructions <artifact-id> --change "<name>" --json
   ```

5. Follow the returned JSON instructions:
   - Read every completed dependency in `dependencies`.
   - Use `template` for the artifact's structure.
   - Follow `instruction`.
   - Apply `context` and `rules` as constraints; **do not copy them into the artifact**.
   - Write to `resolvedOutputPath`. For wildcard outputs, create every actual file required by the instruction.
   - Confirm the actual output files returned by the CLI exist and are nonempty.
6. After each artifact is created, refresh status once, reuse it for the next iteration, and recheck paths and the full dependency closure. Do not regenerate `done` items. Process only newly ready items in the closure, not unrelated optional artifacts.

**Handle failures and blocked dependencies:** If `applyRequires` is incomplete but no required dependency is ready, report the relevant `blocked` artifacts and their `missingDeps`, then stop. Do not guess order or skip dependencies. Also stop and report the OpenSpec error if adapter `status` / `instructions` fails, returns invalid JSON, escapes the repository, or lacks a usable `resolvedOutputPath`. Do not substitute a hard-coded document structure.

**Check the name and scope:** Use the English kebab-case name resolved in Step 1b; non-kebab-case names, including Chinese names, are not allowed. Keep scope consistent with the resolved brief and the user's request. Do not expand or narrow it on your own.

Confirm these artifacts exist:

```text
<classic-change-dir>/
├── .openspec.yaml
├── .comet.yaml
├── proposal.md       # Why + What: problem, goal, scope
├── design.md         # When required or useful; keep technical decisions here without duplicating them
└── tasks.md          # Task checklist
```

### 3. Validate entry state

Check that state was initialized correctly:

```bash
comet state check <name> open
```

Continue to Step 4 when it passes. On failure, the script reports the specific cause.

**Resume unfinished creation steps:** Open operations can be safely retried. On recovery, process the status in this order, retaining completed work:

1. If state is missing, prepare the selected isolation mode, enter the returned `projectRoot`, and run `comet state init <name> full --isolation <selected-isolation>`. Stop and repair malformed state instead of overwriting it. Then select the change and run `comet state check <name> open`.
2. Run `comet classic openspec --agent-json -- status --change "<name>" --json` and recheck `changeRoot`, core IDs, `applyRequires`, `artifacts`, and `missingDeps`.
3. `done`: keep the artifact unchanged and do not regenerate it.
4. `ready`: fetch its instructions with `comet classic openspec --agent-json -- instructions <artifact-id> --change "<name>" --json`, write the artifact accordingly, and immediately refresh status.
5. `blocked`: follow `missingDeps` and complete dependencies in the `applyRequires` closure first. Refresh status after each dependency; do not generate a blocked artifact directly.
6. Repeat until the full required closure is done or legitimately skipped and `comet state artifacts <name> --json` passes.

If required dependencies cannot progress, list the relevant blocked artifacts and `missingDeps`, then stop and report. Existing directories or three fixed files do not replace the CLI's checks. Conversely, an optional artifact outside `applyRequires` must not block implementation merely because `isComplete: false`.

### 4. Check content completeness

Use the most recent successful `comet state artifacts <name> --json` result to check required artifacts. Rerun it after file or schema changes. Do not enter Step 5 or run the phase guard while any issue remains.

Then inspect content: proposal must cover the problem, goals, scope, and non-goals; design must cover high-level decisions and data flow; tasks must be explicit. If the schema returns specs or other artifacts, check their content against their instructions too. The presence of proposal, design, and tasks does not make other required content optional.

### 5. Ask the user to confirm the artifacts

After all OpenSpec artifacts and content checks are complete, **pause under `comet-classic/reference/decision-point.md` and wait for explicit user confirmation**. Do not run the phase guard or advance automatically before confirmation.

This final review confirms the change name, scope, and artifact content together. Step 1b does not replace it; do not add a separate routine summary/name approval before it either.

Present a single-choice question with this summary and both options:

**Summary:**

- **Change name and resolved brief:** final name, goal, non-goals, scope, and key unknowns.
- **proposal.md:** background, goal, and scope.
- **Schema artifacts such as specs:** features, requirements, and key acceptance scenarios.
- **design.md:** high-level architecture decisions and solution choices.
- **tasks.md:** task count and key tasks.

**Options:**

- “Confirm and continue”: artifacts meet expectations; run the phase guard to advance.
- “Adjust the artifacts”: collect the requested changes, apply them, and ask for confirmation again.

After confirmation, complete the exit conditions. If adjustments are requested, update the relevant files and obtain confirmation again.

## Exit conditions

- `comet state artifacts <name> --json` passes: the full required closure is complete or legitimately skipped, and required outputs are nonempty.
- **The user has confirmed** that all OpenSpec artifact content meets expectations.
- **Phase guard:** run `comet guard <change-name> open --apply`. The guard advances only after every check passes; it updates `phase` independently of `auto_transition`.

Use `--apply` before exiting. Without it, `.comet.yaml` remains at `phase: open` and the next entry check fails.

```bash
comet guard <change-name> open --apply
```

The full workflow moves to `phase: design`; hotfix/tweak presets move to `phase: build`.

## Continue to the next phase

Follow `comet-classic/reference/auto-transition.md` and `agent.continuation` from the successful result. Do not repeat next, select, or check when valid state information is already available. Run the following only after context loss, external state changes, or when an older result lacks that information:

```bash
comet state next <change-name>
```

- `NEXT: auto`: invoke the skill named by `SKILL` to continue.
- `NEXT: manual`: do not invoke the next skill. Follow `HINT`, return control, and end this invocation without another confirmation question.
- `NEXT: done`: the workflow is complete.

Hotfix/tweak skills control their own continuation after phase moves directly to build. Their `next` result names the corresponding preset skill.
