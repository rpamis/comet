# Native clarification reference

## Clarification

Read this section on entering Shape. Do not edit the project implementation or advance to Build until necessary questions, implicit assumptions, and final requirements confirmation are complete.

### When to ask

- **Investigable fact**: repository state, tool capabilities, dependency defaults, and the execution environment. The Agent investigates; independent fact-finding can be delegated to subagents.
- **User decision**: alternatives materially change output, default behavior, failure outcomes, scope, or irreversible effects. The user decides.
- **Implementation choice**: algorithms, structure, and working methods that do not change user-visible outcomes. The Agent decides.

Ask only when ambiguity materially changes user-visible outcomes and cannot be resolved reliably from the request, formal Specs, project documentation, existing Agent instructions, or project rules. Express ambiguous behavior as comparable “input → output” or “trigger → result” alternatives. Each question must include:

- **Question**: the outcome difference the user must decide.
- **Recommendation**: the preferred option and why.
- **Impact**: the actual effect of each option on the result.

When a file, attachment, link, or local path is a requirements source, first follow [source-document full coverage](artifacts.md#source-document-full-coverage). Save complete source requirements and coverage status in the brief before asking about ambiguities, omissions, or unstated constraints. Material used only for debugging, evidence gathering, review, or implementation reference does not trigger this automatically; clarify an unclear purpose first.

### Unresolved questions and dependencies

For simple requests, list unresolved questions and necessary dependencies; a tree and fixed node fields are not mandatory. Only when several decisions depend on each other and answers change later branches, create and continuously maintain a decision tree. Establish prerequisite facts and resolve earlier decisions before asking a dependent question. Waiting for one fact pauses only dependent branches; continue independent investigations and questions.

The Agent tracks these relationships while working; do not introduce Runtime files or state fields. Save genuine unresolved user questions in the brief's `# Open questions`. After each user answer or factual conclusion, update affected questions, prerequisites, and downstream branches, then determine which questions are ready. Ambiguous, partial, or missing answers remain `[blocking]`; an answer confirms only what the user explicitly addressed.

### Question tools and modes

Wait for an explicit selection when a user decision is needed. If only one option meets current conditions, explain why and use it directly. With two or more clear, executable options and an available `AskUserQuestion` or equivalent tool, prefer a structured question; single-choice options must be mutually exclusive. Use text for open questions or unavailable tools. Respect platform tool limits. After a successful call, wait without duplicating the text options. If the tool is unavailable or fails, continue using text for this session.

- Sequential mode submits one single-choice or multiple-choice question at a time. Among ready questions, prioritize decisions that affect more later choices or user outcomes.
- Batch mode submits the complete current question set in one request: prerequisites are resolved and answers are independent. If the tool cannot accommodate the set, use text for the entire batch; do not split it to fit tool limits.
- Use short option labels, explain actual impacts, and put the recommendation first with its reason. A recommendation is not confirmation. Text questions must state single or multiple choice, number the options, describe impacts, and ask the user to select before waiting.

#### Batch text format

For Batch text questions, retain `Q1`, `Q2`, and subsequent IDs. Give each question its own bold heading, explanation, options, and recommendation. Mark questions with 💬 and recommendations with 💡, and separate questions with horizontal rules. Repeat this block for the complete current set in one message:

```markdown
💬 **Q1｜<Question title> (single choice)**

<Explain the background and outcome difference the user must decide. Split complex explanations into paragraphs.>

| Option | Approach     | Actual impact                        |
| ------ | ------------ | ------------------------------------ |
| A      | <Short name> | <What changes and the relevant cost> |
| B      | <Short name> | <What changes and the relevant cost> |

💡 **Recommended answer: A (<Short name>)**

Reason: <Why this fits the current requirements and constraints.>

---
```

Reuse the stable `Qn` IDs saved in the brief. An unanswered `Q3` remains `Q3`; do not renumber later rounds. Label multiple-choice questions accordingly. Label open questions “Open answer” and omit the option table. Give a recommended answer and reason only when supported; otherwise say “Your input is needed” and provide just the background or format needed to answer. Do not invent a recommendation. Put the recommendation first only where option order is flexible. Preserve existing IDs and complete impacts in fixed Supervisor or workspace tables, placing them in the relevant question block with a separate recommendation.

After all questions, explain how to reply, for example `Q1: A; Q2: A+C; Q3: additional information`. The user may also supply their own answer by question ID; examples are not defaults. Prefer the structured tool when it accommodates the entire current set. Put the same information in its title, description, and option fields; it need not render Markdown tables. Do not repeat text question blocks after a successful call.

#### Sequential mode

1. Investigate prerequisite facts; pause only branches whose prerequisites are unresolved.
2. Select one ready question and first save `- [blocking] <question>` in the brief's `# Open questions`.
3. Ask only this question, including the recommendation, reason, and each option's impact, then wait.
4. Immediately record confirmed decisions in Decisions, the brief, and complete target Specs, then remove resolved blockers. Save follow-up answers in the same change.
5. Update question dependencies, determine what is ready next, and begin the next round.

#### Batch mode

1. Identify every question ready for this round: prerequisite facts and decisions are resolved, and answers are independent. Keep each independent decision as a separate question.
2. Before asking, save all questions in the brief's `# Open questions` with stable IDs such as `- [blocking] Q1: <question>` and `- [blocking] Q2: <question>`. Never reuse an existing ID for another question in later rounds.
3. Ask the complete current set at once, giving each question its own recommendation, reason, and impacts, then wait. Do not split the round because of tool limits.
4. Update Decisions, the brief, and complete target Specs item by item, removing resolved questions. Preserve original IDs and `[blocking]` for partial, ambiguous, or unanswered questions.
5. Update answered and unanswered questions and their dependencies, then determine the next complete set.

In either mode, if no questions are ready, continue investigating unresolved facts and checking for missed cases. An empty current list does not mean clarification is complete; all final-confirmation conditions still apply.

### Final confirmation

Before final confirmation of a large request, assess [Supervisor decomposition and confirmation](#supervisor-decomposition-and-confirmation). Length and item count alone do not require decomposition. When requirements sources exist, check every current source item under [source-document full coverage](artifacts.md#source-document-full-coverage), including additions, replacements, Spec locations, and acceptance IDs.

Completion requires every outcome-affecting decision to be confirmed, relevant facts and implicit assumptions to be checked, no `[blocking]` in the brief, and specific, verifiable, nonduplicative acceptance items. Then:

1. Execute `prepare-shape-confirmation` from the current continuation. Submit outcome, scope, key decisions, acceptance criteria, and non-goals through `--summary`; do not create another confirmation blocker.
2. After Runtime saves the summary and returns `await-user`, show the complete summary and `userCommunication`, and wait for explicit confirmation.
3. If the user adds to or rejects the summary, update formal artifacts and prepare confirmation again. Only after explicit confirmation may you execute the current `commandAlternatives` command with `--confirmed` and its state-version and expected-action guards.

The initial request does not replace final confirmation. Ordinary implementation choices belong in formal requirements only when they affect user-visible behavior.

## Supervisor decomposition and confirmation

Before final Shape confirmation of a large request, perform a decomposition preflight to assess whether a Supervisor Change should coordinate children. Recommend it only when at least two results can be implemented and verified independently, every acceptance item can be assigned clearly, and real dependencies or parallel work justify coordination.

Do not decompose tightly coupled goals, work that repeatedly touches the same core area, work with greater coordination cost, or a request for a single Native Change. Requirement text length and task count alone must not trigger decomposition.

When recommending decomposition, present the `children.yaml` draft, dependencies and order, acceptance ownership, and coordination mode together. The user can adjust the decomposition, continue with one Native Change, or select a mode:

| Option | Coordination mode                        | Actual impact                                                                                                                                                                                                 |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Multi-session coordination (recommended) | The current session coordinates only. Prefer independent sessions for ready children; automatically switch to a subagent if independent sessions or Agent Teams are unavailable, and keep reporting progress. |
| B      | Single-session progression               | Do not create Codex independent sessions or a Claude Code Agent Team. The current session handles all children sequentially under the same scope, dependencies, and acceptance requirements.                  |

Whenever mode selection is needed, show both A and B. Use this table for text; in a structured question, use the mode as the short label and its impact as the description, explain the recommendation, and wait for explicit selection. A recommendation, a generic “confirm,” or no answer does not select a mode.

An explicit request for “multiple sessions,” “independent sessions,” “cross-session coordination,” or an “Agent Team” selects A; do not ask again. Before confirmation, do not create child changes, worktrees, Codex independent sessions, a Claude Code Agent Team, or dispatch tasks.

When final Shape contains a Supervisor Change with two or more children, explicitly record the Supervisor Change and every Child in Decisions. Before preparing final requirements confirmation, require a choice between multi-session coordination and single-session progression; a generic confirmation is insufficient and there is no implicit default. Then execute `prepare-shape-confirmation` from continuation. Runtime saves the mode and separately waits for confirmation of the complete Shape. The user must explicitly confirm the complete Shape before the `--confirmed` alternative is executed.

During confirmation preparation, Runtime writes `coordination_mode` to `comet-state.yaml`. Only after the user confirms the complete Shape does Runtime enter Build, create the Supervisor integration branch and worktree, and prepare child task packages from the integration branch's current commit, including role, worktree, baseline commit, and `runId`. Do not write the mode into `children.yaml`; it does not change Runtime's `readyChildren`, `runId`, verification, or integration rules. Start only children listed in `readyChildren`. Mode A starts at most two children without unresolved dependencies concurrently; mode B runs them sequentially. Every child stays within confirmed Supervisor scope. Return to Supervisor Shape for a new decision that changes user-visible outcomes.

On `/comet-native` resume, use Runtime's saved `coordination_mode`; do not duplicate children or worktrees and do not ask for the coordination mode again. `multi-session` continues multi-session coordination with automatic subagent fallback when independent sessions or Agent Teams are unavailable. `single-session` continues sequentially in the current session. If original Codex sessions or a Claude Code Agent Team no longer exist, reread Runtime state first. Do not infer child completion from old session or team state, and do not automatically switch to single-session progression.

Unresolved questions remain `[blocking]`; do not edit the implementation while blockers remain. Completion requires all outcome-affecting choices confirmed, implicit assumptions checked, no `[blocking]`, explicit user confirmation of outcome, scope, key decisions, acceptance items, and non-goals, and Runtime in Build. Use continuation commands containing `--confirmed` only after explicit user confirmation.

Before editing `children.yaml`, read [formal artifacts](artifacts.md#formal-artifacts) for acceptance mappings and dependencies. After the complete Shape is confirmed and Runtime enters Build, read [Supervisor coordination](commands.md#supervisor-coordination) before the first dispatch. Follow the package's role and working directory and preserve task identifiers when returning results.
