# comet-design Compat operations

Read only for runtimeFormat: compat. SDK uses the main Skill and SDK methods.

## Prerequisites

- An active change exists and its required Open artifacts have passed checks.
- Runtime is in the design phase. Resume existing design work where applicable; a design file alone does not replace user confirmation.

> Document responsibilities: proposal records goals and scope; spec defines behavior and acceptance requirements; the Design Doc records technical decisions; the plan describes implementation steps; tasks.md records completion. Extend an existing `design.md` in place instead of creating another copy of the design. Use the file referenced by `design_doc` as the formal technical design, preserving a different path already recorded for an older change. Other files reference that design rather than maintaining duplicate decisions.

## Steps

### 0. Entry Check

Use the supported Comet CLI described in `comet-classic/reference/scripts.md`. When resuming from any entry, first follow `comet-classic/reference/context-recovery.md` to check recovery state:

```bash
comet state select <change-name>
comet state check <name> design --json
```

When the previous phase's guard already returned this phase's state, continue from that state and `agent.continuation` without repeating select/check; run the entry checks above only when resuming, after workspace changes, or after external state changes. After a successful check, use the returned layout, configuration, nextAction, and coordination progress summary. Avoid individual field queries or another root show. Normal entry requires only the entry check; follow context-recovery.md when resuming without context or retrieving details. Address the reported cause if validation fails.

**Recovery**: Check existing artifacts and confirmation records, then complete only unfinished steps. Both normal entry and recovery preserve a registered, still-valid design and inspect `data.designReadiness`, `data.issues`, and `data.nextAction`. Restore missing files, correct the change associated with a file, or refresh an outdated handoff without clearing `design_doc`. Once the user has confirmed the design, execute the returned complete-design action; it preserves completed work. If Runtime is already in Build, the command only returns that phase's entry information.

### 1a. Reference the Original Requirements

Run `comet handoff <change-name> design --write` to register source references and continue the original Run without copying artifact bodies. This change proposal, existing design, tasks, and `specs/**/spec.md` define the requirements. Read original text needed for design and retain confirmed requirements. `handoff_context` references the original proposal; historical derived indexes only support reference recovery.

When a complete readable handoff is needed, explicitly run `comet handoff <change-name> design --write --full`. This generates one view at `<classic-change-dir>/.comet/handoff/design-context.md`, without JSON proof. The view does not replace source files or user approval.

### 1b. Run Brainstorming with Context

**Immediately execute:** Use the Skill tool to load the Superpowers `brainstorming` skill. Skipping this step is prohibited.

After the skill loads, use the following language requirement:

```text
Language: Use the Comet artifact language from entry configuration.language
```

After the skill loads, follow its guidance and use the following context:

```text
Change: <change-name>
OpenSpec Sources: <classic-change-dir>/proposal.md, design.md, tasks.md, specs/**/spec.md

Read source files needed for design, retain confirmed requirements, and clarify only unresolved technical decisions. An optional handoff view aids reading; original files and user records remain authoritative.


Use the original requirements for technical design: implementation approach, technical risks, test strategy, and boundary conditions.
Clarify any remaining gaps in goals, scope, non-goals, acceptance scenarios, or key constraints. If the information is sufficient, develop the design directly; there is no minimum number of question rounds.
Before asking questions, read comet-classic/reference/decision-point.md. Each question needs a clear decision, a recommendation with reasons based on current constraints, and the effects of each option. Prefer an available AskUserQuestion and wait for the answer. If missing facts do not support genuine options, request the missing information directly. Reuse valid confirmations; a single technical solution does not replace the formal design confirmation in Step 1c.
Do not rewrite proposal/spec. If an OpenSpec delta spec lacks acceptance scenarios, propose a Spec Patch and write it back to that delta spec, rather than creating another requirements spec in the Design Doc. Limit Spec Patches to missing acceptance scenarios, ambiguous wording, or boundary conditions; do not substantially rewrite the delta spec's structure or scope. If a larger change is needed, record the requirements issue found during design and return to brainstorming for user confirmation.

Organize the Design Doc using project conventions. The Agent judges coverage of confirmed requirements; frontmatter is not required to pass Guard.

Match design depth to risk. Compare 2-3 options when there are real tradeoffs. When existing architecture already determines the solution, explain why rather than inventing alternatives. High-risk interfaces, migrations, security, and concurrency require failure paths and a validation strategy.
Use only brainstorming's exploration and design methods. Present related design sections together and obtain formal confirmation once in Comet Step 1c. The external Skill must not require another approval of the complete design document, automatically invoke writing-plans, switch workspaces, or begin implementation. Do not write the Design Doc before confirmation.
```

Do not continue without loading the skill.

If Superpowers `brainstorming` is unavailable, stop and ask the user to install or enable Superpowers skills. Do not replace the required step with ordinary conversation.

After the skill loads, use its method to present the proposed design in the conversation:

- Technical approach: architecture, data flow, key technology choices, and risks.
- Test strategy.
- Requirements or scope gaps and proposed Spec Patches.
- Any acceptance scenarios to add, identifying the delta spec changes to write back.

Brainstorming produces proposals for user confirmation in Step 1c, not a formal Design Doc. Create or update the formal design and delta spec only after confirmation. Preserve existing Open-stage design.md content; record proposed changes in a checkpoint without overwriting confirmed decisions.

Keep `brainstorm-summary.md` updated throughout brainstorming so discussion can resume after context compression. After any clarification or design revision that adds confirmed facts, key constraints, proposals, tradeoffs, risks, test strategy, or proposed Spec Patches, update the file. Mark unconfirmed content as “pending confirmation” or “proposed.” This checkpoint records discussion progress; it is not the Design Doc and does not replace Step 1c confirmation.

### 1c. Ask the User to Confirm the Design

After brainstorming produces a design, **follow `comet-classic/reference/decision-point.md` and wait for the user to explicitly confirm the design**. Before that confirmation, do not create the final Design Doc, set `design_doc`, run the design guard, or enter `/comet-build`.

When reconfirming changed requirements or acceptance, first read [reconfirmation after requirement changes](../../comet-classic/reference/decision-point.md#reconfirmation-after-requirement-changes). Explain changes, acceptance impact, retained work, and repeated steps, then show the complete current proposal. The current proposal must cover:

- Selected technical approach.
- Key tradeoffs and risks.
- Test strategy.
- Any Spec Patch changes to write back to delta specs.

Offer these three options as a single-choice question:

- **Approve the design**: continue to Step 2 with this design.
- **Request changes**: continue brainstorming until the user confirms the revised design.
- **Defer confirmation**: keep the brainstorming checkpoint and design proposal without creating the final Design Doc or advancing; the user confirms in a later invocation.

Continue to Step 2 only after the user approves. If the user requests changes, continue brainstorming until they confirm the revised design.

### 1d. Save the Confirmed Design Summary

After confirmation and before creating the Design Doc, create or update the checkpoint with the user's confirmed design.

Use file tools to ensure `<classic-change-dir>/.comet/handoff/` exists; do not depend on POSIX-only directory commands.

Structure of `<classic-change-dir>/.comet/handoff/brainstorm-summary.md`:

```markdown
# Brainstorm Summary

- Change: <change-name>
- Date: <YYYY-MM-DD>

## Confirmed Technical Approach

<Summary of the approach confirmed by the user>

## Key Tradeoffs and Risks

<Main tradeoffs and risks>

## Test Strategy

<Overview of the test approach>

## Spec Patch

<Delta spec changes to write back, or "None">
```

**Context compression**: Use brainstorm-summary.md to resume interrupted discussions. Defer proactive compression until the formal design, state, and handoff are saved. If compression has already occurred, load the following as needed before continuing to Step 2:

- `<classic-change-dir>/.comet/handoff/brainstorm-summary.md`.
- Read the original proposal, design, tasks, and relevant Specs needed for this task; an optional handoff view only aids reading.

### 1e. Continue Writing the Design Before Compressing Context

`brainstorm-summary.md` supports recovery, but do not proactively discard the design context before saving the Design Doc. Continue directly to Step 2 and compress only after the Design Doc, state, and latest handoff have been saved.

### 2. Create the Design Doc

Create the Design Doc from the full brainstorming context in the main session.

Record the implementation approach, actual tradeoffs, effects, and validation. The Agent judges sufficiency; Runtime requires the registered file to exist, be readable, and be nonempty.

Choose one `<design-doc-path>`: preserve an existing `design_doc`; otherwise prefer `<classic-change-dir>/design.md` and extend the Open-stage technical decisions in place. Use `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` only when an existing project convention requires a separate Superpowers document. In that case, Open's design.md keeps only the summary required by the schema and a link to the formal design, without duplicating technical detail. Match detail to risk instead of creating empty sections or repetitive alternatives.

Write any Spec Patch to the relevant `specs/**/spec.md` at the same time. Maintain behavioral requirements only in the spec. The formal design references the relevant capability or acceptance clauses and must not introduce another requirements specification.

**After context compression**: Read `brainstorm-summary.md` and the handoff to restore the design discussion. If the user has not confirmed the proposal, return to Step 1b/1c. If they have, continue creating the Design Doc. The checkpoint supplies recovery details, but use the full restored context when writing the design.

### 3. Update Comet State

After explicit user confirmation and saving the formal design, use the repository-relative path from `data.artifactRefs.designDoc` as `<design-doc-ref>`. If the user confirmed another design file, use its path relative to `projectRoot`. File reads and writes still use the absolute `<design-doc-path>`. Register the design, refresh the handoff when needed, and apply the existing Guard checks in one command:

```bash
comet state complete-design <name> --design-doc "<design-doc-ref>" --json
```

Refresh the handoff whenever any source content changes, including proposal, design, task meaning, delta specs, or OpenSpec metadata; checking only Spec Patches is insufficient and the design guard will reject an outdated handoff. Skip regeneration only when all source content is unchanged. Checking task completion boxes alone does not change the requirements hash. Runtime updates state automatically; do not manually edit other fields.

### 3a. Optional Proactive Context Compression

Consider proactive compression after the Design Doc and state records are saved, before Build. Confirm that the original Run, design path, user decisions, and next step can be recovered.

- If context capacity is under pressure and a native compression mechanism is callable, invoke it once. Include the change, next step, and Design Doc/handoff files to reload in the recovery prompt.
- If compression requires a manual user action, offer one nonblocking suggestion and continue. **Do not block** or create another confirmation step.
- Do not fake context compression with shell commands or summaries.

## Exit Conditions

- The Design Doc has been created and saved.
- Handoff references this change original requirements, and the original user decisions and Run remain recoverable.
- OpenSpec delta specs have been created or updated for any new capabilities or additional acceptance scenarios.
- `design_doc` is recorded in `.comet.yaml`.
- **Phase guard**: Run `comet guard <change-name> design --apply`. After all checks PASS, the guard advances to `phase: build`; this updates `phase` independently of `auto_transition`.

If Step 3 successfully returned `data.phase: build`, the Guard has already passed and been applied; do not run it again. On failure, address `data.issues`, preserve completed work, and retry the same complete-design command.

## Recovery After Context Compression

Follow `comet-classic/reference/context-recovery.md` with phase `design`.

## Automatic Transition to the Next Phase

Follow `comet-classic/reference/auto-transition.md` and the successful result's `agent.continuation` without another next query. Query again only when resuming without context, external state changes, or an older response did not include the next action:

```bash
comet state next <change-name>
```

- `NEXT: auto` → Load the skill named by `SKILL` to enter the next phase.
- `NEXT: manual` → Do not load the next skill. Return control using `HINT` and end this invocation without another confirmation.
- `NEXT: done` → The workflow is complete.
