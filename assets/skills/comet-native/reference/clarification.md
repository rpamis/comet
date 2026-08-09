# Native Clarification Reference

You must read this file after entering Shape. Do not modify project implementation or advance to Build until problem classification, the silent-assumption check, and shared-understanding confirmation are complete.

## Whether to ask

Separate information into three categories:

- **Investigable fact**: repository state, tool capability, dependency defaults, and runtime environment. The Agent investigates it and may delegate independent fact investigations to subagents.
- **User decision**: alternatives materially change output, defaults, failure behavior, scope, or irreversible effects. The user confirms it.
- **Implementation choice**: algorithm, structure, or working method that does not change user-visible results. The Agent decides it.

Ask only when ambiguity would materially change user-visible results and cannot be resolved reliably from the user's request, formal specifications, or applicable project rules. Do not invent questions to cover a checklist or send implementation choices to the user.

Rewrite ambiguous behavior as comparable “input → output” or “trigger → result” cases. Each question includes:

- Question: the user-visible difference to decide;
- Recommendation: the preferred option and why;
- Impact: the practical result of each option.

## Decision tree and fact investigation

Before asking the first user question, build and continuously maintain a decision tree. Include only user decisions that materially change user-visible results. Treat investigable facts as prerequisites and implementation choices as Agent-owned work instead of disguising either as user decisions.

For every decision node, identify at least the behavior to decide, its parent or prerequisite decisions, required facts, and whether it is waiting on prerequisites, currently askable, or resolved. An unresolved node is a currently askable node when its parent decisions and required facts are settled. Currently askable nodes must not depend on one another's answers.

The decision tree is the Agent's working model, not a new Runtime artifact or schema. Persist only actual unresolved user questions in the brief through the existing `[blocking]` lines. After every user answer or fact-finding conclusion, immediately update affected nodes, add, remove, or rewrite their descendants, and recompute the currently askable nodes.

Fact investigation must not stall unrelated branches. When a fact remains unresolved, pause only the node and descendants that depend on that fact, then continue with other currently askable nodes. A temporarily empty set of currently askable nodes does not permit the Agent to ignore material branches still awaiting facts or inspection.

## Sequential

1. Investigate facts required by the decision tree and isolate branches still waiting on facts as described above.
2. Select one most-upstream node from the currently askable nodes. When several qualify, prefer the node that unlocks more descendants or has greater impact on user-visible results.
3. Save one `- [blocking] <question>` in the brief.
4. Ask exactly one currently askable node and wait for the answer. Do not ask a second user decision in the same round.
5. After the answer, immediately update Decisions, the brief, and the complete target specifications.
6. Update the decision tree and recompute the currently askable nodes before starting the next round.

Keep ambiguous, partial, or unanswered content `[blocking]`. An answer decides only the behavior it covers explicitly.

## Batch

For each round, take the complete set of currently askable nodes from the decision tree. Their prerequisite decisions and environmental facts are settled, and their answers do not depend on one another.

1. Save `- [blocking] Q1: <question>`, `- [blocking] Q2: <question>` in the brief.
2. Ask every currently askable node in this round together, giving Question, Recommendation, and Impact for each item.
3. Update the formal artifacts after the answer. Keep unanswered or ambiguous questions `[blocking]`.
4. Update answered and unanswered nodes in the decision tree, then compute the complete node set for the next round.

Do not compress independent decisions into one multi-select question or split one ready batch across multiple rounds.

## Persistence and final confirmation

Write every confirmed answer immediately into Decisions and the complete target specifications of the existing change. Do not update only the brief, wait until final confirmation to write specifications, or create another change for a clarification answer.

Begin final confirmation only when every identified branch has been handled, no pending investigable fact can change user-visible behavior, the set of currently askable nodes is empty, and the silent-assumption check adds no new node:

1. Check for remaining silent assumptions.
2. Give the user a summary of the goal, scope, key decisions, acceptance criteria, and non-goals.
3. Save `- [blocking] CONFIRM: <confirmation>` in the brief.
4. Wait for explicit user confirmation.
5. Remove the blocker and advance with `--confirmed`.

The initial feature request is not the final shared-understanding confirmation. If the user changes or rejects the summary, update the formal artifacts and continue clarification.
