---
name: comet-native
description: Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry routes to Native; clarify requirements, read state, and drive Shape → Build → Verify → Archive.
---

# Comet Native

Native stores requirements, complete target specifications, state, and evidence. You own understanding, implementation, and verification; the Runtime owns state, boundaries, and recovery.

Run the entire workflow inside this Skill. Do not load phase Skills or impose fixed Plan, TDD, Debug, or Review methods.

## Clarification Protocol

Read `native.clarification_mode` from `.comet/config.yaml`. Allowed values are `sequential` and `batch`; use `sequential` when the field is absent. This setting changes only how user questions are organized. It does not change Native phases, state, Guards, safety confirmations, or caller-defined stop points.

First identify undefined branches that would change user-visible results. Words such as “normalize,” “intuitive,” “standard,” and “expected” are not product contracts. Only the user's words, a confirmed answer, or a published contract that clearly applies to the current behavior can close such a branch.

Repository conventions, dependency defaults, adjacent features, and industry practice may support a recommendation. They do not replace a user decision. “Preserve existing behavior” constrains existing results; it does not define new behavior automatically.

First determine whether a branch affects only implementation and leaves every user-visible result unchanged. If you cannot prove that, treat it as a user decision. Even when the user says not to ask about implementation choices, do not reclassify a product decision as an implementation choice.

You are responsible for investigating facts available from the repository, tools, or runtime environment. Do not ask the user to supply them. When the host supports parallel work, independent facts may be investigated in parallel, but parallel capability must not be a workflow prerequisite. An unresolved fact blocks only questions that depend on it, not other questions that are ready.

Combine details only when they jointly define the same user decision. Do not merge independent user decisions: Sequential mode handles them in separate rounds, while Batch mode numbers each one separately. Do not manufacture ambiguity to increase the question count or include implementation choices in the user question list. If a question still leaves a reasonable interpretation of that same decision uncovered, broaden that question instead of creating another question with an unclear dependency.

### Question interface

Before asking, inspect the current host's tool list. When the current tool list provides `AskUserQuestion`, prefer it in Claude Code for presenting structured options; on other hosts, use an equivalent user-input tool. Give every option a short label and an impact description. Mark the recommended option in its description, but never select it on the user's behalf.

- Sequential mode submits one structured question per round. Use single-select when the options are mutually exclusive. Use multi-select only when the same user decision genuinely permits multiple compatible selections. Do not compress independent user decisions into one multi-select question.
- In Batch mode, when the complete set fits the current tool's limits on questions, options, and fields, put the entire ready question set in the same call. Do not split the same round across multiple tool calls so that later questions remain hidden until after an earlier answer.
- When the current host has no structured question tool, or a Batch round cannot be expressed completely in one call, use the numbered-text fallback for the entire round. Preserve the same questions, options, recommendations, and impacts, then stop and wait for the user to reply with the numbers.
- If the first call fails or the host reports an error, treat structured questions as unavailable for this session. Use the text fallback for the current round and do not retry it again during this session. After a successful tool call, wait for the user's answers and do not also output a duplicate set of text questions.

### Sequential mode

When a user decision remains:

1. Record one `[blocking]` question in the brief.
2. Ask only the most upstream question.
3. Provide “Question / Recommendation / Impact,” then end the turn.

When no user decision remains, continue directly without adding a generic final confirmation.

### Batch mode

Organize unresolved user decisions by their prerequisite relationships. Maintain only reviewable open items, dependency summaries, and formal artifacts; do not persist hidden reasoning or a complete internal exploration.

For each round, compute the ready question set. Every question in the set must have all prerequisite decisions settled, all required environment facts established, and an answer that does not depend on another question in the same round. Defer questions that depend on an unresolved decision or a fact still under investigation.

For the ready question set:

1. Under Open questions in the brief, persist each item using the exact forms `- [blocking] Q1: <question>`, `- [blocking] Q2: <question>`, and so on. Do not replace this prefix with a Markdown ordered list.
2. Ask the entire set together, giving “Question / Recommendation / Impact” for each item. Numbering must let the user reply in forms such as “1 use the recommendation; 2 choose B.”
3. After updating the formal artifacts and asking the questions, end the turn. Do not enter Build or call `next`.

Use this format:

```text
1. Question: …
   Recommendation: …
   Impact: …

2. Question: …
   Recommendation: …
   Impact: …
```

After the user answers, write confirmed content into Decisions and the complete target specifications, then remove the corresponding `[blocking]` items. Keep unanswered or ambiguous items `[blocking]`; never fill them from the recommendation. Recompute the ready question set from the new answers and continue round by round as new branches become available.

When the ready question set is empty, all relevant facts are established, and every identified user decision is resolved, perform one completeness review. Recheck that no user-visible branch remains unaddressed or silently assumed. Present a shared-understanding summary that covers the outcome, scope, key decisions, acceptance criteria, and explicit non-goals, then persist the final confirmation as `- [blocking] CONFIRM: <confirmation>` in the brief. Until the user confirms explicitly, do not enter Build or call `next`. If the user adds or rejects anything, update the affected branches and continue with another round. After explicit confirmation, remove the blocking item, record the confirmation, and follow the normal transition.

For text “normalization,” for example, cover case folding, surrounding punctuation, preservation of internal punctuation or apostrophes, and use counterexamples to show how each choice changes output.

Before shared understanding, you may inspect repository facts, create or resume the Native change, and record `[blocking]` in the brief. Do not enter Build, modify project implementation, or call `next`.

After the user answers, update the existing change's brief and complete target specifications, then check again for unresolved user decisions. Do not create another change for a clarification answer or write an unconfirmed option as decided behavior.

When leaving Shape, pass `--confirmed` only if this turn recorded the user's answer to an existing blocking question. Batch mode's final shared-understanding confirmation qualifies; the initial feature request does not.

If the caller requires a stop or session switch after that transition, use this exact sequence: update the formal artifacts → run the one allowed transition → make no tool calls after the transition succeeds → output the agreed marker and end the turn. A Runtime response of `continuation.disposition: continue` does not override that stop point.

## Execution Boundaries and Point-in-Time Evidence

When the caller defines a stop point, complete only the work allowed before it. In the next session, invoke `/comet-native` again and recover from status, selection, and formal artifacts on disk. Do not reconstruct progress from chat memory.

If the caller asks for a Runtime envelope from before a state change or another exact point in time, generate it before crossing that point with the real command in machine-readable mode and redirect stdout directly to the target. The file is immutable evidence. After confirming that it is complete, do not rebuild, refresh, or overwrite it after state changes. Evidence records only what the Runtime actually returned at that time.

## Start or Resume

`/comet-native` is a Skill entry, not a shell command. Invoke it through the host's Skill mechanism; do not execute `/comet-native` in a shell.

Run Native `status` and `show` first. When resuming Verify or Archive, run `status <change-name> --details` and read the bounded acceptance page, detailed findings, `findingsTruncated`, and the latest checkpoint.

- If findings are truncated, address the returned items and read details again.
- If `acceptancePage.nextCursor` is non-null, continue paging as documented in the command reference.
- Then read `.comet/config.yaml` and determine `native.clarification_mode` before reading `comet-state.yaml`, the brief, proposed specifications, canonical specifications, repository implementation, project rules, and relevant tests.
- Disk and repository facts outrank chat memory. Do not ask the user for facts available from the environment.

When active changes exist, first confirm read-only which change matches the current goal. Then select the confirmed change explicitly:

```text
comet native select <change-name>
```

This establishes the project-wide shared selection. Do not add a `resume` command or rely on side effects from read-only `status` or `show` calls.

If several active changes exist and the selection does not identify the target uniquely, ask the user to choose. Create a new change only when disk facts prove that no active change exists:

```text
comet native new <change-name> --language en
```

Derive the name as lowercase kebab-case. Use only the configured `<artifact-root>/comet/`; do not scan or modify another workflow's directories.

See the [command reference](reference/commands.md) for commands and Runtime location, the [artifact reference](reference/artifacts.md) for formats, and the [recovery reference](reference/recovery.md) for interruption handling. The bundled Runtime is [scripts/comet-native-runtime.mjs](scripts/comet-native-runtime.mjs).

Installations have one Comet workflow Rule per platform and one `comet-hook-router.mjs` on platforms that support Hooks. The Rule and Router use `.comet/config.yaml` and `.comet/current-change.json` to identify the current workflow. Each write is routed to at most one Guard.

For a Native change, apply only Native Shape, Build, Verify, and Archive boundaries. Do not run the Native and Classic Guards together or guess ownership from the default workflow. The Native flow does not depend on any external Skill.

## Decision Protocol

Maintain a list of unresolved user-visible branches and handle them in dependency order. Check especially:

- output and default behavior;
- edge cases and failure results;
- scope, risk, and irreversible actions;
- existing constraints that clearly apply to the current behavior.

Rewrite important nouns or actions as distinguishing “input → output” or “trigger → result” examples. If one counterexample separates two reasonable interpretations, the branch still needs a user decision.

For text or token behavior, normally inspect case, surrounding and internal punctuation, whitespace, Unicode, empty input, duplicates, ordering, and tied results. For CLI or API behavior, inspect defaults and error results. Do not invent ambiguity merely to cover a checklist.

Only user-provided information, explicit non-goals, confirmed decisions, or a clear published contract for the current capability may close a branch. When blocked, follow the Clarification Protocol to compute and ask either one question or the ready question set for the configured mode. Do not call `next` or modify project implementation before the answer.

When no unresolved branch remains and the brief, complete target specifications, repository facts, and project rules are sufficient to implement and accept the work, Sequential mode continues directly. Batch mode first completes its final shared-understanding confirmation.

## Progression Contract

Shape, Build, and Verify transitions return `next: auto | manual` together with `continuation.disposition: continue | await-user | blocked | done`, required inputs, and the next action. Archive does not advance through `next`; successful archive returns `done`.

These fields form the machine-readable continuation contract. `next: auto` means that the current transition succeeded; it does not mean that the host executes later work in the background.

After `next: auto` with disposition `continue`, reread the returned phase and required artifacts. When no user decision or Runtime blocker remains, continue into the next phase inside this Skill without waiting for another invocation.

For `await-user`, `blocked`, or `next: manual`, first resolve the returned disk facts and blocking findings. Ask only when the missing input is genuinely a user decision.

In Batch mode, unanswered questions and the final shared-understanding confirmation remain `[blocking]`. They are normal stop points for user input. They do not change the continuation contract and cannot be bypassed by automatic progression.

`workspace-root-changed` and `workspace-inspection-unavailable` are read-only advisories and do not block progress or archive by themselves. Unknown workspace findings, confirmed conflicts, stale evidence, and repair stops must be resolved.

For long work that must resume within a phase, use `comet native checkpoint` to save a short summary, next action, and real artifact references. A checkpoint does not advance phase or replace the brief, specifications, or verification report. Do not create separate resume, handoff, or task-list artifacts.

## Shape

Confirm and record Outcome, Scope, Non-goals, Acceptance examples, Constraints and invariants, Decisions, Open questions, and Verification expectations. Mark blocking questions in the brief as `- [blocking]`; Batch mode may preserve the entire ready question set at once.

Shape is complete only when the brief, complete target specifications, repository facts, and project rules let the next executor implement and accept the change without guessing user-visible behavior.

- Update `brief.md` so it constrains implementation and acceptance.
- Preserve a user-provided lowercase kebab-case capability ID exactly in `specs/<capability>/spec.md`.
- If the user provided only a display name, preserve it in the body and derive a stable lowercase kebab-case capability ID.
- When lasting behavior changes, write the complete post-archive target specification, not an incremental patch.
- To remove a capability, run `comet native spec remove <change-name> <capability>`; the Runtime infers and freezes the operation and canonical base hash.
- If unresolved decisions remain, preserve `[blocking]` and stop.

When ready, run:

```text
comet native next <change-name> --summary <summary>
```

Append `--confirmed` only when this turn recorded the user's answer to an existing blocking question; Batch mode must first obtain the final shared-understanding confirmation. The Runtime binds approval to the current brief/spec contract hash. If the contract changes during Build, obtain user confirmation for the current contract and retry with the command returned by status. Do not edit `approval` or `approved_contract_hash` manually.

## Build

Choose the simplest reliable implementation that satisfies the brief and proposed specifications. Decide implementation details, whether to save a plan, test granularity, debugging method, and review depth according to risk.

Do not create extra documents merely to satisfy the workflow. If requirements or specifications drift, update the Native artifacts first. If a new user decision appears, mark it `[blocking]` and follow the configured clarification protocol. Batch mode must recompute the ready question set and obtain a final confirmation of the updated shared understanding before implementation continues.

When implementation is complete, provide real project artifacts. If no code changed, provide a concrete reason. Then run:

```text
comet native next <change-name> --summary <summary> --artifact <project-path> [--confirmed]
```

Use `--no-code-reason` as documented when no code changed. The Runtime returns the implementation scope and first `acceptancePage`. Preserve Runtime-derived acceptance IDs and read every page through `nextCursor`; never calculate IDs yourself.

Git snapshots contain tracked and non-ignored untracked files, with each submodule/gitlink treated atomically. Non-Git projects use a bounded physical-tree snapshot.

- `git-selection-changed`: wait until Git writes are stable, then retry. It cannot be authorized as partial scope.
- `git-enumeration-limit`: first reduce or clean the project-owned universe. Use the partial protocol only when the Runtime returns an authorizable scope and the user accepts the specific risk from the unenumerated tail.
- `physical-selection-changed` or `physical-enumeration-limit`: wait for a stable filesystem or reduce the project tree, then retry. Neither can be authorized as partial scope.

When the Runtime cannot prove that scope is complete, it remains in Build and returns a partial scope hash with unattributed items. First add real artifacts or eliminate unattributed changes. If partial scope is unavoidable, explain the exact gap, obtain user confirmation, and use the same hash:

```text
--allow-partial-scope <sha256> --partial-reason <reason> --confirmed
```

Never edit snapshots or evidence, guess unenumerated paths, or present partial scope as complete.

## Verify

Run verification appropriate to the Acceptance examples, complete target specifications, and risk. Record actual commands, results, skipped checks, specification consistency, known limitations, and the conclusion. Never record an unrun check as passed.

In the fixed acceptance evidence block of `verification.md`, use every Runtime-provided `acceptance_id`. Each item must contain either project-relative evidence refs or an honest `skipped_reason`. See the artifact reference for the exact format.

When you need reproducible text-hygiene evidence, run the built-in read-only check:

```text
comet native check <change-name>
```

This command scans a bounded set of regular project text files in the current implementation scope/current snapshot. It does not invoke Git, a shell, project scripts, external processes, or external Skills. It does not modify project files, phase, Run, or trajectory; it writes a content-addressed receipt. It does not replace risk-based project tests.

After writing the report, run:

```text
comet native next <change-name> --summary <summary> --result pass|fail --report verification.md [--receipt <ref>]
```

`fail` returns to Build. Fix the evidenced problem, verify again, and submit stable, non-sensitive failure facts through `--failure-category` and `--failed-check`.

The second identical failure warns. The third with no scope progress stops. A real scope change ends the current repair episode. If scope has not changed but one concrete new hypothesis exists, use the signature returned by status with `--override-repair` once. Never repeat an override for the same signature. At a repair stop, ask the user to decide; do not weaken checks or fabricate a pass.

After entering Archive, changes to the brief, specifications, implementation scope, report, or receipt make the evidence stale. Follow the Runtime continuation back to Build, reseal the scope, and verify again. Do not reuse a stale pass.

## Archive

After the state reaches Archive with a passing Verify result, preflight first:

```text
comet native archive <change-name> --dry-run
```

Inspect create/replace/remove operations, evidence freshness, visible overlap with other changes in the current Native root, and recovery state. When no blocker remains, commit with the exact hash returned by this preflight:

```text
comet native archive <change-name> --expect-preflight <sha256>
```

If the caller asks to preserve a preflight or commit envelope, the first invocation itself must use machine-readable mode and write to the target file. Commit with the hash from the saved preflight. Once validated, keep the file immutable; do not overwrite it by rerunning commands after archive.

The Runtime recomputes the facts under lock and rejects drift. On success, it updates canonical specifications and moves the change into a date-prefixed archive directory.

For a canonical conflict, reread and rewrite the complete target specification, then run `comet native spec rebase <change-name> --summary <summary>`. This returns the change to Build under Runtime control; implement, confirm, verify, and archive again. Follow the recovery reference for incomplete transactions.

## Invariants

- Never edit `phase`, `approval`, `spec_changes`, Run state, trajectory, locks, or transaction journals directly.
- Never skip phase checks. Shape, Build, and Verify use `comet native next`; Archive uses the two-step preflight and commit protocol.
- Never invoke external Skills. The Native flow depends only on the bundled Comet Runtime.
- Do not persist hidden reasoning. Save summaries, artifact references, command results, hashes, state changes, and timestamps.
- Do not write tokens, passwords, private keys, connection strings, or other credentials into summaries, reasons, or reports.
- Continue while no user decision or Runtime blocker remains. When a user decision remains, Sequential mode asks only the most upstream question; Batch mode asks the entire ready question set, then waits for the user's answers.
