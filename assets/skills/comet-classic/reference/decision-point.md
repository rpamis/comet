# Decision Point Protocol

Canonical path: `comet-classic/reference/decision-point.md`

All comet sub-skills with user decision points share this protocol. Every step labeled a blocking point or user decision point must follow it.

## First Decide Whether User Input Is Actually Required

Distinguish user decisions, automatic handling, and stop conditions:

- **User decision**: two or more valid actions differ in scope, behavior, responsibility for risk, or irreversible outcomes. The user must choose. Explicit phase requirements to approve artifacts or designs are also user decisions: offer approval, adjustment, or deferral. A single technically recommended solution does not authorize automatic approval.
- **Automatic handling**: exactly one safe next action remains within the request, such as repairing a failure with a known cause, reconciling state from evidence, retrying an idempotent check, or following saved configuration. Execute and report without another confirmation.
- **Stop condition**: a missing dependency, corrupt state, path escape, or unavailable external command leaves no valid next action. Report the blocker and recovery condition without inventing choices.
- **Manual handoff**: `NEXT: manual` returns control; it is not a new user decision point. Print `HINT`, end the invocation, and do not ask whether to continue.

Only the first category requires a decision. Open/Design questions about unclear scope, solutions, or acceptance requirements must also use the format below. If facts, paths, or other missing information cannot be represented by real options, state what is missing and request it without inventing answers.

Ask related questions together when they can be answered together. Do not re-ask saved choices that remain valid. Do not add preflight checks to predict whether a later tool or operation might fail and filter out options. Present all workflow-supported choices; execute the selected action, and stop with the original error if it fails. If a configuration field has only one workflow-valid value, explain why and apply it without a separate pause. This rule does not replace explicit phase confirmation requirements.

## Core Rules

A pause or stop applies only to actions that depend on the decision or are blocked by the current problem. Other investigation, evidence preparation, and permitted work within the same authorized scope may continue. This does not allow bypassing phase Guards, implementing unconfirmed scope, or choosing for the user.

- Decision points are blocking points. Wait for an explicit user choice before continuing dependent work.
- Use `AskUserQuestion` for single-select or multi-select choices when it is present; otherwise present clear text options and wait for the reply.
- If `AskUserQuestion` cannot be used, record that structured questions are unavailable for this session. Do not repeatedly retry it at later decision points; use text options directly.
- Never substitute recommendations, defaults, historical preferences, or an assumption that the user would agree for current confirmation.
- Before an explicit choice, do not write the corresponding state fields, execute the corresponding branch operation, or automatically continue to the next phase.

## Reusing file-count authorization in Classic presets

The hotfix and tweak file-count thresholds prompt a scope review only; they are not substantive escalation signals. A preset may reuse `Preset file-count authorization` in `<classic-change-dir>/.comet/rulings.md`, but it is valid only when `status` is active, `workflow` matches the current change, scope, acceptance, and risk assumptions are unchanged, and file count is the only trigger. The record must contain `status: active|invalidated`, `workflow`, `decision: continue-on-file-count-only`, the authorized scope, `allowed-file-categories`, `authorization-basis`, and `reason`.

With valid authorization, do not ask again, but first report the total and category breakdown of delivery files, their mapping to the confirmed scope, the ruling record, and the evidence that no substantive escalation signal was found. On task recovery, read the same ruling first and recheck it against the current scope and workflow. Delivery files include only implementation/source, tests, user documentation, configuration, and generated output; count committed changes after the baseline, staged, unstaged, and untracked files, deduplicated by path. Exclude OpenSpec artifacts in the change directory, `.comet` metadata, and unrelated dirty files. Valid authorization bypasses only the prompt for “file count exceeded and no substantive escalation signal”; it never bypasses review of new modules, public APIs, schemas, capabilities, cross-module work, or architecture risk.

Ordinary start-repair instructions, Skill invocation, historical preferences, and Personal Memory cannot create authorization. If the user revokes it, the workflow changes, scope or acceptance changes, a substantive escalation signal appears, or a file falls outside the authorized categories, mark the ruling `invalidated`; missing, unreadable, ambiguous, or invalid `rulings.md` means there is no valid authorization and the existing pause flow applies. When escalating to full, also mark the ruling `invalidated`; do not reuse this authorization afterward.

## `AskUserQuestion` Priority Strategy

When using structured questions:

- Use single-select questions for single-choice decisions and multi-select questions for multiple choices.
- Explain what each question decides. Give every option a short label and an impact description. When justified, mark a recommendation and explain why, without choosing for the user.
- If the tool call succeeds, wait for the answer through that question; do not also send duplicate text options.
- If the tool is absent or fails, record that structured questions are unavailable for this session, then use text options.

## What Every Question Must Include

- **Question**: explain what is being decided and provide the facts, constraints, or artifact references needed to decide. Tool names or configuration fields alone are insufficient.
- **Recommendation and reason**: when supported, recommend an option and explain why it fits the request, risks, and existing configuration. If evidence is insufficient, say that no recommendation can yet be made; historical preferences do not replace confirmation.
- **Options and effects**: give clear choices and explain what each will execute, change in scope or behavior, and cost or risk. Single-select options must be mutually exclusive and actionable.
- For text questions, explicitly label single-select or multi-select, number the options, describe their effects, and ask for the option number(s). Pause dependent steps and wait for the reply.
- When asking several questions at once, each question needs its own explanation, recommendation reasons, and option effects. One generic recommendation for the group is insufficient.
- Recommendations advise; they do not confirm. An empty tool answer, no reply, or an answer without a clear choice leaves the decision unconfirmed.
- Execute the corresponding command or state update only after the user chooses.

### Batched Text Question Format

For several text questions in one message, retain `Q1`, `Q2` numbering. Give each question a bold title, explanation, options, and recommended answer. Mark questions with 💬 and recommendations with 💡; separate questions with a horizontal rule. Use this format for each question and send the complete set in one message:

```markdown
💬 **Q1｜<Question title> (single-select)**

<Explain the context and what the choice changes. Use several paragraphs if needed.>

| Option | Approach     | Effect                                 |
| ------ | ------------ | -------------------------------------- |
| A      | <Short name> | <What changes and the associated cost> |
| B      | <Short name> | <What changes and the associated cost> |

💡 **Recommended answer: A (<Short name>)**

Reason: <Why this fits the request and constraints.>

---
```

Keep question numbers stable in follow-ups. Label multi-select questions accordingly. Label open questions “open answer” and omit the option table. Provide a recommended answer and reason only when supported; otherwise state “Input needed” and give only the context or format needed to answer. Do not invent a recommendation. If a phase already defines a fixed option table, preserve its numbering and complete effects under the relevant question; do not renumber or remove options to emphasize a recommendation.

After all questions, explain how to reply once, for example `Q1: A; Q2: A+C; Q3: additional details`. Users may also give their own answer under a question number; the example is not a default selection. Prefer the structured tool when available, putting the same information in its title, description, and option fields. It need not render a Markdown table; do not repeat the text questions after a successful call.

## What Each Phase Must Confirm

Read the detailed phase rules when one of these decisions is actually needed. Do not reconfirm valid saved authorization or configuration.

- Entry/Open: group unresolved choices about the target change, PRD splitting, and workspace isolation. At Open's end, confirm the name, scope, and artifacts together. If the request is already clear, do not require a separate preliminary approval of its summary or name.
- Design: after brainstorming produces a reviewable solution, ask the user to confirm the formal design. With valid confirmation, complete only missing artifacts and state updates.
- Build: before planning, confirm execution/TDD/review configuration together only when it is missing or the user asks to change it. Continue by default after planning. plan-ready means the user requested a pause; after an instruction to continue, reuse the valid plan and configuration without another configuration decision.
- Verify: automatically fix and reverify in-scope failures with a known repair. Ask only to accept WARNING/SUGGESTION deviations, resolve implementation/Spec disagreement, or choose what follows the Runtime automatic-repair limit. CRITICAL/IMPORTANT findings must be resolved.
- Archive: confirm archiving and local/push/pr delivery together. With valid delivery authorization and an unchanged target, complete only remaining operations. If actual results are uncertain, check them read-only first.
- Scope changes: for new capabilities, changed public behavior or interfaces, changed acceptance requirements or responsibility for risk, or preset escalation conditions, the responsible phase presents valid choices such as continuing, adjusting, or splitting. Finer task granularity or more tasks alone does not mean scope has expanded.
