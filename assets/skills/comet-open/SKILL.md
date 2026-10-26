---
name: comet-open
description: 'Create a Classic change, clarify its requirements, and obtain user confirmation. Use when the user invokes /comet-open or Classic enters Open or resumes initialization.'
---

# Comet Phase 1: Open

On first entering a phase, handing off to a new Agent, or restoring context, read and follow [Task Context and Artifact Language](../comet-classic/reference/scripts.md#task-context-and-artifact-language). Prefer the current continuation or claimed Action's `contextRequest`; do not retrieve repeatedly during uninterrupted work in the same phase.

Before starting or resuming, read and follow `comet-classic/reference/classic-layout.md`. All OpenSpec CLI calls in this file must use the adapter, and all paths must use the `<classic-*>` logical roots bound by that protocol.

## Prerequisites

- There is no active change, or the user wants to create a new one.

## Steps

### 0. Set the output language

Every question and artifact-generation request passed to OpenSpec must specify the resolved Comet artifact language using a normalized ID such as `en` or `zh-CN`. Before a change is initialized, read `classic.language` from project `.comet/config.yaml`, then global `~/.comet/config.yaml`. After initialization, reuse `configuration.language` from the current valid response; use `comet state get <name> language` only when it is missing. Fall back to the current request's language only when no language is configured. `proposal.md`, `design.md`, and `tasks.md` must primarily use that language.

### 0a. Bind the current change

When the response already includes `agent.continuation.mode`, follow `comet-classic/reference/auto-transition.md` first. `wait` distinguishes manual handoff from waiting for the original executor under auto-transition.md, without running recovery queries merely because the compatibility field says `nextAction.kind: reconcile`. Use the current response’s commands and inputs; submit `completion` only after the Skill’s actual work is complete. Recovery rules below based on `nextAction.kind` apply only to older responses without `mode`.

When resuming an existing change, reuse the latest valid continuation and ownership for the same workspace and Run. Query `comet state next <name> --json` only on cold recovery, external changes, or missing information:

- `sdk`: reuse the Run and recover according to `data.nextAction.kind`. Investigate a claimed Action with an unknown outcome before recreating or redispatching work.
- `compat`: reuse the original flow and `.comet.yaml`; never migrate it automatically.
- If the command fails, inspect its error, ownership record, Run, and actual state file. Stop on conflict or malformed state. If local Run history is missing, first check `run_checkpoint` in the state file and follow `/comet-classic`'s recovery steps to resume the saved phase. Only an older state without a checkpoint may return to Open after the user explicitly consents to restoration and fresh evidence and approvals. Prepare and initialize a workspace only when no Runtime owns a valid change directory. A missing filename alone is not evidence that initialization is needed.

For SDK and Compat, resolve and bind the workspace on cold recovery, changed workspace, or missing bindings. Reuse an existing valid selection and projectRoot:

```bash
comet classic workspace resolve <change-name> --json
# Enter the returned projectRoot
comet state select <change-name>
```

For a new change, initialize the SDK Run immediately after creating the basic OpenSpec directory, then select it. Never write a selection before initialization.

### 0b. Choose and prepare the workspace before Open

Read `comet-classic/reference/workspace.md` when creating a Classic change. Choose the workspace before creating OpenSpec artifacts or the SDK Run; do not defer this to Build.

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

When the user provides a large PRD, roadmap, complete product proposal, or multiple independently deliverable goals, read and follow [PRD splitting and batch recovery](reference/batch-changes.md) before creating artifacts. Also read it when resuming a batch recorded in `.comet/batches/<batch-id>.json`. Continue directly for a single change; reuse the approved scope for a confirmed split item.

### 1b. Summarize requirements and choose the change name

Before creating artifacts, turn Step 1's findings into a resolved brief containing goal, non-goals, scope, key unknowns, and draft acceptance scenarios. Derive an English kebab-case change name that accurately describes that scope.

- **Continue directly when scope and name are clear.** Do not add a pause solely to approve the summary or name; final review confirms the name, scope, and artifact content together.
- If the user supplied a name, normalize it to kebab-case and echo it in a progress update. No reconfirmation is needed when normalization preserves meaning.
- Reuse a confirmed batch item's summary and name. Clarify again only if scope has changed or the list lacks needed information.
- Ask a joint question under `comet-classic/reference/decision-point.md` only when mutually exclusive scope or target-change choices remain. Naming preference alone is not a reason to pause.

OpenSpec change names must use English kebab-case: lowercase letters, digits, and single hyphens. If a name conflicts but the goal is clear, choose a nonconflicting name with the same meaning and continue. Ask the user only when you cannot determine whether to reuse an existing change or create a new one.

While the resolved brief or change identity is still unclear, do not run `comet classic openspec -- new change` or create proposal/design/tasks. Resolve the missing information or genuine user decision before Step 2.

### 2. Create the change structure and initialize state

Follow the shared [creation and recovery order](../comet-classic/reference/sdk-methods.md#entry-and-artifacts): create the OpenSpec base directory before SDK initialization; resume an existing Run instead of creating it again.

**Required now:** Load the `openspec-new-change` skill using the Skill tool. Do not skip this step.

<!-- external-openspec-skill-override -->

**Adapt external OpenSpec instructions:** Use its change-creation method only. Do not directly invoke the official CLI, adopt a fixed cwd, or write to a fixed OpenSpec root. Route creation, status, and instructions through `comet classic openspec -- <args...>`. Use this invocation's logical roots, including `<classic-change-dir>`, for all paths.

Do not load `openspec-propose` by default in the full `/comet-classic` flow. Load it only if the user explicitly requests a proposal and artifacts generated together.

<!-- external-openspec-skill-override -->

**Adapt external OpenSpec instructions:** The same restrictions apply to `openspec-propose`: no direct official CLI, fixed cwd, or fixed physical OpenSpec path. Commands must use the adapter and artifacts must use resolver-provided `<classic-*>` roots.

Create the change's initial structure following the loaded skill. If Step 1b already produced a clear resolved brief, override its “STOP and wait for user direction” behavior and proceed without repeating the question.

Use that resolved brief to populate the artifacts. Return to the skill's questions only if the brief still has ambiguity that would change scope.

Initialize a recoverable SDK Run immediately after creating the initial structure; do not wait for every artifact to be generated (the entry check runs once in Step 3, not here):

```bash
comet state init <name> full --isolation <selected-isolation>
comet state select <name> --json
```

Stop if any command fails. The selection response must include `runtimeFormat: sdk`, `phase: open`, and the current Run Action; run `comet state next <name> --json` only if these fields are missing. Then run `comet classic openspec --agent-json -- status --change "<name>" --json` once and check compatibility:

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
6. After each artifact is created, validate the closure locally with `comet state artifacts <name> --json` (no OpenSpec subprocess); refresh status once only when it reports a missing dependency or ordering error, or when new live instructions are needed, then recheck paths and the full dependency closure. Do not regenerate `done` items. Process only newly ready items in the closure, not unrelated optional artifacts.

**Handle failures and blocked dependencies:** If `applyRequires` is incomplete but no required dependency is ready, report the relevant `blocked` artifacts and their `missingDeps`, then stop. Do not guess order or skip dependencies. Also stop and report the OpenSpec error if adapter `status` / `instructions` fails, returns invalid JSON, escapes the repository, or lacks a usable `resolvedOutputPath`. Do not substitute a hard-coded document structure.

**Check the name and scope:** Use the English kebab-case name resolved in Step 1b; non-kebab-case names, including Chinese names, are not allowed. Keep scope consistent with the resolved brief and the user's request. Do not expand or narrow it on your own.

Confirm these artifacts exist:

```text
<classic-change-dir>/
├── .openspec.yaml
├── proposal.md       # Why + What: problem, goal, scope
├── design.md         # When required or useful; keep technical decisions here without duplicating them
└── tasks.md          # Task checklist
```

The SDK Run is stored in the user-level workspace Runtime directory. New changes save `comet-state.yaml`; historical `.comet.yaml` files remain in place. Recover through `state next` and `state check`; do not edit Run storage directly.

### 3. Validate entry state

Reuse a successful initialization or selection response containing the same Run, Open phase, workspace, and revision, then continue to Step 4. Check initialization only on cold recovery, external changes, or missing information:

```bash
comet state check <name> open
```

Continue to Step 4 when it passes. On failure, the script reports the specific cause.

**Resume unfinished creation steps:** Open operations can be safely retried. On recovery, process the status in this order, retaining completed work:

1. First run `comet state next <name> --json` to identify ownership. Reuse an SDK Run; retain the original flow for `runtimeFormat: compat`. Only when there is no Run, ownership record, or state file under either name may you prepare the workspace and run `comet state init <name> full --isolation <selected-isolation>`. Stop on malformed state or ownership conflicts. Then select and run `comet state check <name> open`.
2. Run `comet classic openspec --agent-json -- status --change "<name>" --json` and recheck `changeRoot`, core IDs, `applyRequires`, `artifacts`, and `missingDeps`.
3. `done`: keep the artifact unchanged and do not regenerate it.
4. `ready`: fetch its instructions with `comet classic openspec --agent-json -- instructions <artifact-id> --change "<name>" --json`, write the artifact accordingly, then validate the closure locally with `comet state artifacts <name> --json` instead of refreshing status.
5. `blocked`: follow `missingDeps` and complete dependencies in the `applyRequires` closure first. Validate with `comet state artifacts <name> --json` after each dependency and refresh status only when it reports a new problem; do not generate a blocked artifact directly.
6. Repeat until the full required closure is done or legitimately skipped and `comet state artifacts <name> --json` passes.

If required dependencies cannot progress, list the relevant blocked artifacts and `missingDeps`, then stop and report. Existing directories or three fixed files do not replace the CLI's checks. Conversely, an optional artifact outside `applyRequires` must not block implementation merely because `isComplete: false`.

### 4. Check content completeness

Use the most recent successful `comet state artifacts <name> --json` result to check required artifacts. Rerun it after file or schema changes. Do not enter Step 5 or run the phase guard while any issue remains.

Then inspect content: proposal must cover the problem, goals, scope, and non-goals; design must cover high-level decisions and data flow; tasks must be explicit. If the schema returns specs or other artifacts, check their content against their instructions too. The presence of proposal, design, and tasks does not make other required content optional.

### 5. Check authorization and complete Open

After all OpenSpec artifacts and content checks are complete, use `runtimeFormat` from the current valid response; run `comet state next <name> --json` only if ownership information is missing or external state has changed. For SDK, run `comet guard <change-name> open --json` to obtain the preview, content summary, and `data.approvalHash`; repair any failed checks. Then check authorization under `comet-classic/reference/decision-point.md`. If no valid authority covers the current artifacts, ask for a decision before applying the phase guard.

The final review checks the change name, scope, and artifact content against the authorized requirements. Do not add routine summary or naming confirmation when name and scope are already clear.

Check current artifacts against existing authorization under `comet-classic/reference/decision-point.md`. Record the basis and continue when authority still covers the content. Present the matters requiring confirmation and wait only when a new decision is needed.

When user confirmation is needed, present a single-choice question with this summary and both options:

**Summary:**

- **Change name and resolved brief:** final name, goal, non-goals, scope, and key unknowns.
- **proposal.md:** background, goal, and scope.
- **Schema artifacts such as specs:** features, requirements, and key acceptance scenarios.
- **design.md:** high-level architecture decisions and solution choices.
- **tasks.md:** task count and key tasks.

**Options:**

- “Confirm and continue”: artifacts meet expectations; run the phase guard to advance.
- “Adjust the artifacts”: collect the requested changes, apply them, and ask for confirmation again.

After confirmation, complete the exit conditions. For SDK, use the `approvalHash` from the preview shown to the user. If adjustments are requested, update the relevant files, rerun the preview, and obtain confirmation again; do not reuse the old hash.

## Exit conditions

- `comet state artifacts <name> --json` passes: the full required closure is complete or legitimately skipped, and required outputs are nonempty.
- **The user has confirmed** that all OpenSpec artifact content meets expectations.
- **Phase guard:** for SDK, apply with the current preview's `approvalHash`; for compat, retain `comet guard <change-name> open --apply`. The guard advances only after every check passes.

Apply the phase guard before exiting; otherwise the Run or old `.comet.yaml` remains in Open. If SDK artifacts change after preview, preview again and obtain confirmation of the current content.

```bash
comet guard <change-name> open --apply --approval-hash <approvalHash>  # SDK
comet guard <change-name> open --apply                           # compat
```

The full workflow moves to `phase: design`; hotfix/tweak presets move to `phase: build`.

## Continue to the next phase

For SDK, use the successful response’s phase, `nextAction.kind`, and `agent.continuation` for the same Run; query `comet state next <change-name> --json` only if they are missing: load the next Skill only for `action`; resolve `decision`, `evidence`, and `reconcile` in the current Run without replay. For compat, follow `comet-classic/reference/auto-transition.md` and `agent.continuation` from the successful result. Do not repeat next, select, or check when valid state is already available. Run the following only after context loss, external state changes, or when an older result lacks that information:

```bash
comet state next <change-name>
```

- `NEXT: auto`: invoke the skill named by `SKILL` to continue.
- `NEXT: manual`: do not invoke the next skill. Follow `HINT`, return control, and end this invocation without another confirmation question.
- `NEXT: done`: the workflow is complete.

Hotfix/tweak skills control their own continuation after phase moves directly to build. Their `next` result names the corresponding preset skill.
