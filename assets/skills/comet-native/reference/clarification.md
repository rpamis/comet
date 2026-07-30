# Native Clarification Reference

You must read this file after entering Shape. Do not modify project implementation or advance to Build until problem classification, the silent-assumption check, and shared-understanding confirmation are complete.

## Whether to ask

Separate information into three categories:

- **Investigable fact**: repository state, tool capability, dependency defaults, and runtime environment. The Agent investigates it.
- **User decision**: alternatives materially change output, defaults, failure behavior, scope, or irreversible effects. The user confirms it.
- **Implementation choice**: algorithm, structure, or working method that does not change user-visible results. The Agent decides it.

Ask only when ambiguity would materially change user-visible results and cannot be resolved reliably from the user's request, formal specifications, or an applicable contract. Do not invent questions to cover a checklist or send implementation choices to the user.

Rewrite ambiguous behavior as comparable “input → output” or “trigger → result” cases. Each question includes:

- Question: the user-visible difference to decide;
- Recommendation: the preferred option and why;
- Impact: the practical result of each option.

## Sequential

1. Investigate facts required by the current question.
2. Find the most upstream unresolved question whose prerequisites are settled.
3. Save one `- [blocking] <question>` in the brief.
4. Ask only that question and wait for the answer.
5. After the answer, immediately update Decisions, the brief, and the complete target specifications, then inspect the remaining questions.

Keep ambiguous, partial, or unanswered content `[blocking]`. An answer decides only the behavior it covers explicitly.

## Batch

Each round contains only questions whose prerequisite decisions and environmental facts are settled and whose answers do not depend on one another:

1. Save `- [blocking] Q1: <question>`, `- [blocking] Q2: <question>` in the brief.
2. Ask the entire round together, giving Question, Recommendation, and Impact for each item.
3. Update the formal artifacts after the answer. Keep unanswered or ambiguous questions `[blocking]`.
4. Compute the next round from the new answers.

Do not compress independent decisions into one multi-select question or split one ready batch across multiple rounds.

## Persistence and final confirmation

Write every confirmed answer immediately into Decisions and the complete target specifications of the existing change. Do not update only the brief, wait until final confirmation to write specifications, or create another change for a clarification answer.

After all identified questions are resolved:

1. Check for remaining silent assumptions.
2. Give the user a summary of the goal, scope, key decisions, acceptance criteria, and non-goals.
3. Save `- [blocking] CONFIRM: <confirmation>` in the brief.
4. Wait for explicit user confirmation.
5. Remove the blocker and advance with `--confirmed`.

The initial feature request is not the final shared-understanding confirmation. If the user changes or rejects the summary, update the formal artifacts and continue clarification.
