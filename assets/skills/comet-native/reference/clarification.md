# Native clarification reference

You must read this file after entering Shape. Do not modify project implementation or advance to Build until deciding whether questions are needed, checking unstated assumptions, and completing final requirements confirmation.

## Whether to ask

First separate three kinds of information:

- **Investigable fact**: repository state, tool capabilities, dependency defaults, and runtime environment. The Agent investigates these; independent fact-finding can be delegated to subagents.
- **User decision**: choices that materially change output, default behavior, failure results, scope, or irreversible impact. The user confirms these.
- **Implementation choice**: algorithms, structures, and working methods that do not change the visible result. The Agent decides these.

Ask the user only when ambiguity materially changes the visible result and cannot be determined reliably from the request, formal specifications, project documentation, existing Agent instructions, or project rules. Questions must come from real divergence; the Agent decides ordinary implementation details directly. When the user directly supplies a file, attachment, link, or local path as a requirements source, `brief.md` is the durable clarification artifact: first present the complete source requirements and coverage states in `## Source coverage` under `# Scope`, then ask about ambiguity, omissions, or implicit boundaries in `# Open questions`. Materials supplied only for debugging, evidence, review, or implementation reference do not trigger this mode automatically; clarify an unclear purpose first. Split the source into units by headings, paragraphs, lists, tables, code blocks, examples, constraints, links, and boundaries, recording read and coverage states. Executable source units must enter both the complete target Spec and at least one acceptance ID; background and non-goal units retain only a classification and reason and do not require an acceptance ID. When the user corrects the source, mark the old unit `superseded` and link its replacement. Inaccessible links, unparseable files, partially read sources, or unmapped executable units remain `[blocking]`; chunking does not reduce the final coverage set, and a summary cannot replace the source coverage map.
Rewrite ambiguous behavior into comparable “input → output” or “trigger → result” form. Every question should contain:

- Question: the user-visible difference to decide.
- Recommendation: the preferred option and reason.
- Impact: the actual result of each option.

## How to ask the user

Pause at a user decision point and wait for an explicit choice. If only one valid option exists, explain why and adopt it directly. Use a text question for open-ended questions or when the options cannot be listed accurately.
When two or more clear, mutually exclusive, executable options exist and the platform provides `AskUserQuestion`, prefer a structured question:

- Sequential mode submits one single-choice or multiple-choice question at a time.
- Batch mode submits the complete current question set in one request. If the tool cannot hold the complete set, ask the entire batch as text instead of splitting the round because of tool limits.
- Give every option a short label and its actual impact. Put the recommended option first and explain why; a recommendation does not replace user confirmation.
- After a successful tool call, wait for the answer without printing a duplicate text option list.
- If the tool is unavailable or the call fails, use text questions for the rest of this session instead of retrying the same tool repeatedly.

For a text question, state whether it is single-choice or multiple-choice, number the options, recommendation, and impact, ask the user to reply with a number, then pause.

## Decision tree and fact-finding

Before asking the first user question, create and continuously maintain a decision tree. Include only user decisions that materially change the visible result. Treat investigable facts as prerequisites and ordinary implementation choices as Agent-owned.

For every decision node, record at least what must be decided, which decision it depends on, which facts must be investigated first, and whether it is waiting, askable, or resolved. A node becomes askable only after its prerequisite decisions and facts are known. Questions in the same round must be independent.

The decision tree exists only in the Agent's working process and creates no new Runtime file or state field. Write only actual unresolved user questions into the brief as existing `[blocking]` lines. After every user answer or fact-finding conclusion, immediately update affected nodes and later branches, then recompute which nodes are askable.

When a fact is still unknown, pause only the dependent node and its later branches; continue handling unrelated questions. If no node is currently askable, continue investigating pending facts and check for omitted branches.

## Sequential mode

1. Investigate the facts required by the decision tree and isolate branches still waiting on facts.
2. Choose one currently askable node. If several exist, prefer the question that affects more later choices or has greater impact on the visible result.
3. Save one `- [blocking] <question>` in the brief.
4. Ask exactly one currently askable node and wait for the answer. Ask the next user decision in a later round.
5. After the user answers, immediately update Decisions, the brief, and complete target specifications.
6. Update the decision tree, recompute askable nodes, and begin the next round.

Ambiguous, partial, or unanswered content remains `[blocking]`. An answer decides only the behavior it explicitly covers.

## Batch mode

In each round, find the complete set of decision-tree questions that can be asked together: their prerequisite decisions and environment facts are known, and their answers do not depend on one another.

1. Save `- [blocking] Q1: <question>` and `- [blocking] Q2: <question>` in the brief.
2. Ask every currently askable node in one round, giving the question, recommendation, and impact for each.
3. Update formal artifacts after the user answers. Unanswered or unclear questions remain `[blocking]`.
4. Update answered and unanswered nodes in the decision tree, then compute the complete node set for the next round.

Keep every independent decision as a separate question. Ask mutually independent questions together in the same batch.

## Persistence and final confirmation

Write every confirmed decision immediately into Decisions and the complete target specifications of the existing change, synchronizing the brief. Add supplemental answers to the same change.

Begin final confirmation only when every identified branch has been handled, no pending fact could change visible behavior, no askable node remains, and unstated assumptions create no new question:

1. Check again for unstated assumptions that could still affect the result.
2. Present a summary of the outcome, scope, key decisions, acceptance criteria, and non-goals.
3. Save `- [blocking] CONFIRM: <confirmation>` in the brief.
4. Wait for explicit user confirmation.
5. After confirmation, remove the blocker and advance with `--confirmed`.

The initial request does not replace final confirmation. If the user adds to or rejects the confirmation summary, update the formal artifacts and continue clarifying.
