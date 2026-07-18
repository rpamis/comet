---
name: comet-native
description: Use Comet-owned Native changes, a clarification lock, state checks, and automatic progression for a lightweight but recoverable requirements-to-archive workflow; unresolved user-visible behavior must be clarified before implementation.
---

# Comet Native

Understand first, then act. Native preserves requirements, complete target specifications, state, and evidence; the model chooses how to implement instead of following a fixed method. It is always one lightweight entry: continue inside this Skill according to the phase on disk, without loading phase Skills or adding Plan, TDD, Debug, or Review method checklists.

## Clarification lock

Apply this entry contract first: terms such as “normalized,” “intuitive,” “standard,” and “expected” are placeholders for undefined behavior, not exact product contracts. If such a term changes a new output and the user has not defined its observable rules, a user decision exists. Do not implement, write decided specification behavior, or advance the phase; the only permitted user-visible result in this turn is the single most upstream clarification in Question / Recommendation / Impact form, followed by immediately ending the turn.

When the placeholder is text “normalization,” one complete policy question must cover case folding, surrounding punctuation, and preservation of internal punctuation or apostrophes, with counterexamples showing how each branch changes output. Omitting any one leaves a sibling user-visible branch unresolved, so implementation cannot begin. Combine these details into one policy question rather than a multi-turn questionnaire.

If the current message answers a surfaced blocking question, re-read any execution boundary in the caller's original request before invoking a transition. Record every part of the answer in the brief and complete target specification; the `next` that leaves Shape must include `--confirmed`. If the caller asked to stop or switch sessions after that transition, no tool call is permitted after that transition: emit only the exact requested marker, end the turn, and recover from disk in the next session.

Before entering Build or modifying the project implementation, apply this hard stop: investigate repository facts, then walk the decision tree for every newly introduced output or capability and list the branches that change a user-visible result. To resolve a branch, you must be able to quote the user's statement about that new behavior itself, the user's confirmed answer to a previously asked question, or an already published exact contract for the same capability; if you cannot, it remains unresolved. Old code, adjacent capabilities, and compatibility requirements cannot close a new behavior's product branch; they may only support a recommendation. “Preserve existing behavior” protects existing results; it does not mean that new behavior inherits old semantics. For every unresolved branch, the choice is a user decision owned by the user and the model may only recommend; only approaches that preserve the same user-visible result are implementation choices owned by the model. Even when the request says “do not ask implementation choices,” that does not reclassify product decisions as implementation choices. If you cannot prove that it is only an implementation choice, treat it as a user decision; do not choose a “reasonable default” for the user.

When a user decision exists, ask one question at a time—the most upstream one—with a recommended answer, rationale, and practical impact, then end the turn immediately. When several details jointly define one upstream semantic policy, ask one coherent policy question rather than one arbitrary facet or a fixed questionnaire. If any reasonable answer would leave a sibling user-visible branch unresolved, the question is too narrow. Base the recommendation on the user's outcome and behavioral tradeoffs, not the easiest implementation. Before reaching shared understanding, you may investigate facts, create or resume the Native change, and record `[blocking]` in the brief; but do not write any option as decided specification behavior, do not enter Build, do not modify the project implementation, and do not call `next`. Recompute the decision tree after each answer. Progress automatically only when no user decision exists.

## Start or resume

`/comet-native` is a Skill entry, not a shell command. Invoke it through the host's Skill mechanism; never execute `/comet-native` in Bash.

Run Native `status` and `show` first. When resuming Verify or Archive, use `status <change-name> --details` to obtain a budgeted acceptance page, bounded detailed findings, the `findingsTruncated` flag, and the latest checkpoint. If findings are truncated, handle those returned and then read details again; never treat undisplayed findings as absent. If `acceptancePage.nextCursor` is non-null, follow the command reference to retrieve every remaining acceptance ID page. Then read `.comet/config.yaml`, `change.yaml`, the brief, proposed complete specifications, canonical specifications, repository implementation, project rules, and relevant tests. Disk and repository facts outrank chat memory. Do not ask the user for facts available from the environment.

If `status` or `show` reports an active change, continue that change. After the user answers a clarification or adds a constraint, re-read it and update the existing brief and specifications. Do not create a second change for the user's answer. Only when disk evidence proves that no active change exists, summarize the user's goal as a lowercase kebab-case name and create it with `comet native new <change-name> --language en`. Use only the configured `<artifact-root>/comet/`; do not scan or modify directories owned by another workflow.

See the [command reference](reference/commands.md) for commands and runtime discovery, the [artifact reference](reference/artifacts.md) for formats, and the [recovery reference](reference/recovery.md) for interruption handling. The bundled runtime is at [scripts/comet-native-runtime.mjs](scripts/comet-native-runtime.mjs).

Initialization installs a Native-owned Rule and Write/Edit Hook. The Rule states phase constraints, while the Hook permits implementation writes for an active change only during Build. Both read only Native configuration and state; neither invokes Classic nor depends on an external skill.

## Decision protocol

Maintain a decision frontier: list every user-visible branch that still lacks one unique answer and resolve branches in dependency order. This applies to any branch that changes output, defaults, error results, compatibility, scope, risk, or an irreversible result. “The impact seems small” is not a reason for the model to decide it.

Perform a brief user-visible contract scan first: turn each key noun or action into one distinguishing input -> output or trigger -> result example, then inspect primary branches, defaults, boundary conditions, failure paths, compatibility constraints, and irreversible actions. For text or token behavior, include case, leading/trailing and internal punctuation, whitespace, Unicode, empty input, duplicates, ordering, and ties; for CLI/API behavior, include defaults, error results, and backward compatibility. If one counterexample distinguishes two reasonable interpretations, that branch is unresolved.

A branch is resolved only by information supplied by the user, an explicit non-goal or confirmed decision, or an existing user-visible contract, test, or rule explicitly applicable to the new behavior. An internal implementation primitive, dependency default, the implementation of an adjacent feature, consistency, convention, or the smallest diff is only a repository fact: it may support a recommendation, not replace the user's answer.

When a user decision exists, keep one `[blocking]` question in the brief, ask the single most upstream question using a concise “Question / Recommendation / Impact” format, then end the turn and wait. Until the answer arrives, do not write either output as decided specification behavior, call `next`, or implement. After the answer, update the existing artifacts and recompute the decision frontier before asking another question or continuing.

Shared understanding is not an extra confirmation step: it exists when the decision frontier is empty and another strong model without the current conversation can implement and accept the change without guessing user-visible behavior. When no user decision exists, continue directly without confirmation questions, generic preference questions, or low-value questions. Do not invent ambiguity merely to cover a checklist.

## Progression contract

Real Shape, Build, and Verify transitions return `next: auto | manual` together with a structured `continuation.disposition: continue | await-user | blocked | done`, required inputs, and the next action. Together these fields form the machine-readable continuation contract. `next: auto` means only that the current state advanced successfully; it does not mean the host will execute subsequent work in the background. Archive does not advance through `next`; only a successful archive returns `disposition: done`.

After receiving `next: auto` with a `continue` disposition, re-read the returned phase and required disk artifacts. When no user decision or Runtime blocker exists, keep progressing in the same `/comet-native` Skill; do not stop and wait for the user to invoke it again, and do not split the four phases into separate Skills. For `await-user`, `blocked`, or `next: manual`, first use disk facts and blocking findings to correct what can be corrected. Ask only when a required input is truly a user decision. Only explicit `workspace-root-changed` and `workspace-inspection-unavailable` findings are read-only advisories that do not independently block progression or Archive. Unknown workspace findings, definite conflicts, stale evidence, and repair stops still require action.

Automatic progression yields to an explicit execution boundary from the caller. If the caller explicitly asks you to stop at a phase or switch sessions, persist confirmed decisions and current state in the official Native artifacts and complete only the allowed transition; make no more tool calls after the transition succeeds, emit the requested boundary marker exactly, and end the turn before starting the next phase. In the fresh session, recover only from disk `status`, the brief, specifications, and checkpoint rather than chat memory.

When a long task must preserve in-phase progress across sessions, use `comet native checkpoint` to store a short summary, the next action, and real artifact references. A checkpoint does not advance the phase and does not replace the brief, specifications, or verification report. Do not add resume, handoff, or task-list artifacts.

## Shape

Establish the Outcome, Scope, Non-goals, Acceptance examples, Constraints and invariants, Decisions, Open questions, and Verification expectations. Mark a blocking question in the brief as `- [blocking]`.

Shape is complete only when it meets the cold-start executable standard: another strong model with no current conversation context can read only the brief, complete target specifications, repository facts, and project rules, then implement and accept the change without guessing user-visible behavior.

Once understanding is aligned:

- update `brief.md` until it constrains implementation and acceptance;
- Preserve any lowercase kebab-case capability ID explicitly supplied by the user exactly and use it for `specs/<capability>/spec.md`; if the user supplied only a natural-language display name, preserve that display name in the specification body and derive a stable lowercase kebab-case capability ID; never silently replace an explicitly supplied valid ID;
- when durable behavior changes, write each complete target specification at `specs/<capability>/spec.md`, not as an incremental patch;
- remove a durable capability with `comet native spec remove <change-name> <capability>`; the Runtime infers create/replace operations and freezes canonical base hashes;
- record explicit confirmation only when the user has just confirmed a user decision; while it remains unresolved, keep `[blocking]` and stop.

Then provide a verifiable summary and run:

```text
comet native next <change-name> --summary <summary>
```

Append `--confirmed` only when the user has just answered a previously surfaced blocking question and the summary records that answer. The initial feature request is not this kind of explicit confirmation. Otherwise omit it. The Runtime records `approval`; never edit it manually.

## Build

Choose the simplest reliable approach that satisfies the brief and proposed specifications. The model decides the implementation method, whether a written plan is useful, test granularity, debugging method, and review depth according to risk.

Do not create extra documents or steps merely to satisfy a process. If implementation reveals requirement or specification drift, update the Native artifacts first. When a new user decision appears, mark it `[blocking]` and ask only one question. After the answer, update Decisions, remove the blocker, continue implementation, and pass `--confirmed` when leaving Build.

When complete, provide real artifact references. If no code changed, provide an explicit reason. Then run:

```text
comet native next <change-name> --summary <summary> --artifact <project-relative-path> [--confirmed]
```

The Runtime returns the current implementation scope and the first `acceptancePage`. Preserve these Runtime-derived acceptance IDs. If the response is lost, retrieve them in Verify with `comet native status <change-name> --details`. Text and context within a page may be explicitly truncated, but IDs are never silently omitted. Follow `nextCursor` until every page has been read; never calculate IDs yourself.

If the Runtime cannot prove that the scope is complete, it stays in Build and returns a partial scope hash with unresolved items. First add real artifacts or eliminate the unowned changes. If the scope must remain partial and the user needs to accept that risk, explain the exact gap and obtain confirmation, then follow the command reference with the same scope hash, a reason, and `--confirmed`. Never silently describe a partial scope as complete.

## Verify

Run verification appropriate to the brief's Acceptance examples, complete target specifications, and risk. Record actual commands, results, skipped checks, specification consistency, known limitations, and the conclusion. Never report an unrun check as passing.

In the fixed acceptance evidence block of `verification.md`, use each Runtime-returned `acceptance_id`. Each entry may contain only project-relative evidence refs or one honest `skipped_reason`. The user does not maintain IDs, and the model does not guess hashes from prose. See the artifact reference for the exact format.

When a narrow, reproducible text-hygiene receipt is useful, explicitly run the built-in read-only text scan:

```text
comet native check <change-name>
```

It invokes no Git, shell, project script, or other external process. It scans a bounded number of in-project regular text files from the current implementation scope/current snapshot for conflict markers, trailing whitespace, and space-before-tab. A symlink, escape, TOCTOU change, hash/size mismatch, or exceeded budget fails closed. The scan does not modify project files, phase, Run, or trajectory, but writes an independent content-addressed receipt under Native evidence. It is not a general command runner and does not replace tests selected by the model according to risk. If the receipt contributes to the final conclusion, append its returned `--receipt <ref>` to `next`; a pass may bind only a fresh passed receipt.

Write both passing and failing results to `verification.md`, then run:

```text
comet native next <change-name> --summary <summary> --result pass|fail --report verification.md [--receipt <ref>]
```

A failure returns to Build. Fix the problem identified by the evidence, verify again, and submit stable non-sensitive failure classes through `--failure-category` and `--failed-check`. The Runtime validates these failure facts before writing any evidence or transition. The second identical failure warns; the third stops when the scope has made no progress. A real implementation-scope change ends the previous repair episode and directly clears the stop. When the scope has not changed but one concrete new hypothesis exists, use the status-returned signature once with `--override-repair` and a summary; never override the same signature twice. When one repair episode reaches its semantic limit, stop and ask the user to decide rather than weakening checks or fabricating a pass. The general Run iteration counter does not permanently lock a long-lived change.

If the brief, specifications, implementation scope, report, or receipt changes after entering Archive, the old evidence becomes stale. Follow the Runtime continuation back to Build, seal a new scope, and verify again. Never edit evidence refs manually or reuse the old pass.

## Archive

Only after the state reaches Archive with Verify marked pass, preview the transaction:

```text
comet native archive <change-name> --dry-run
```

Inspect the previewed create/replace/remove operations, evidence freshness, visible change overlaps in the current Native root, and recovery state. When no blocker remains, submit with the exact hash returned by the preview:

```text
comet native archive <change-name> --expect-preflight <sha256>
```

Archive recomputes the same facts under lock; any drift is rejected, and an old hash is never reused. Success updates canonical specifications and moves the change into a date-prefixed archive directory. On a canonical conflict, re-read and rewrite the complete target specification, then run `comet native spec rebase <change-name> --summary <summary>` to refresh the baseline and reopen Build for implementation, confirmation, and verification. Never overwrite concurrent changes. Follow the recovery reference for an incomplete transaction.

## Invariants

- Do not edit `phase`, `approval`, `spec_changes`, Run state, trajectory, locks, or transaction journals directly.
- Do not bypass phase checks. Advance Shape, Build, and Verify with `comet native next`; use the two-step `archive --dry-run` and `archive --expect-preflight` protocol for Archive.
- Do not invoke external Skills; the Native core workflow depends only on Comet's bundled Runtime.
- Do not persist hidden reasoning. Persist only summaries, artifact references, command results, hashes, state changes, and timestamps.
- Do not put tokens, passwords, private keys, connection strings, or other credentials in summaries, reasons, or reports. The Runtime applies credential-shaped redaction to short persisted text as an additional safeguard, not as permission to store secrets.
- Keep progressing when no user decision blocks the work. When one does, ask only the highest-value question and wait for the answer.
