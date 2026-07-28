---
name: comet-native
description: Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry routes to Native; clarify requirements, read state, and drive Shape → Build → Verify → Archive.
---

# Comet Native

Native stores requirements, complete target specifications, state, and evidence. You own understanding, implementation, and verification; the Runtime owns state, boundaries, and recovery.

Run the entire workflow inside this Skill. Do not load phase Skills or impose fixed Plan, TDD, Debug, or Review methods.

## Clarification Protocol

Read `native.clarification_mode`, `native.archive_confirmation`, and `native.max_verify_failures` from `.comet/config.yaml`. The first allows `sequential` or `batch` and defaults to `sequential`; the Archive policy allows `automatic` or `required` and defaults to `automatic`; the Verify-failure limit must be a positive integer and defaults to `5`. `clarification_mode` determines how user questions are organized and which confirmation contract applies before leaving Shape. `archive_confirmation` only determines whether a successful Archive preview commits automatically or waits for final user confirmation. `max_verify_failures` bounds the completion loop for one confirmed contract. These settings do not add a Native phase or change the change schema.

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

Treat the current goal as a decision tree of user-visible results. Run the following loop when entering Shape, after every user answer, and whenever relevant repository facts change:

1. First investigate repository, tool, and runtime facts required by the current branch. Do not ask the user for facts you can establish yourself.
2. Traverse every reasonably reachable user-visible branch from the goal, including downstream edge cases, failure results, and defaults introduced by the current answer. Do not stop after finding the first workable interpretation, and do not silently close an unconfirmed branch with the recommendation.
3. Maintain reviewable unresolved items and only the necessary dependency summary in the formal artifacts; do not persist hidden reasoning or a complete internal exploration. If several independent decisions remain, choose the most upstream one whose prerequisites are settled and leave the others for later rounds.
4. Record only the current `- [blocking] <question>` in the brief. Ask only the most upstream question: each round asks exactly this one user decision, without packing independent decisions into a multi-select or several parallel clauses.
5. Provide “Question / Recommendation / Impact,” using options, examples, or counterexamples that make the difference decidable, then end the turn. State the recommendation clearly, but never choose it for the user. Every downstream or dependent question surfaced by a new answer must retain all three parts; do not merely present a candidate collection and ask the user to edit it.

After the user answers, immediately write the confirmed content into Decisions and the complete target specifications, remove the current blocking item, and traverse the entire decision tree again from the goal. If a target specification does not exist yet, create it in the same turn that handles the answer; updating only the brief and deferring the specification until final confirmation or Build is incomplete persistence. Treat the answer as a product constraint, not as approval of an implementation algorithm: one answer closes only the input-to-output result explicitly selected by that question. Do not silently settle independent empty-input, failure, or embedded-boundary examples merely because one possible implementation would handle them as a side effect. Branches introduced by the new answer must enter later rounds; ambiguous, partial, or unanswered content stays `[blocking]`.

When no unresolved user decision remains, do not enter Build directly. Perform one completeness review and actively look for omitted or silently assumed user-visible branches. Then present a shared-understanding summary covering the outcome, scope, key decisions, acceptance criteria, and explicit non-goals, and record `- [blocking] CONFIRM: <confirmation>`. This review is also a traceability check: every product behavior in the summary and acceptance examples must trace to the user's words, a confirmed answer from an earlier round, or a published contract that clearly applies. “Consistent,” “intuitive,” “usual,” and repository convention are not confirmation. If a policy appears for the first time in the summary, the clarification loop is incomplete; restore it as a user question instead of deciding it through the final confirmation. Until the user confirms explicitly, do not modify project implementation, enter Build, or call `next`. If the user adds or rejects anything, update the formal artifacts and run the loop again. After explicit confirmation, remove the blocking item, record the confirmation, and advance with `--confirmed`.

### Batch mode

Treat the current goal as a decision tree of user-visible results and organize unresolved user decisions by their prerequisite relationships. Maintain only reviewable open items, dependency summaries, and formal artifacts; do not persist hidden reasoning or a complete internal exploration.

For each round, compute the ready question set. Every question in the set must have all prerequisite decisions settled, all required environment facts established, and an answer that does not depend on another question in the same round. These questions form the current frontier. Defer questions that depend on an unresolved decision or a fact still under investigation.

When a candidate branch needs an environment fact, investigating it remains your responsibility. When the host supports sub-agents or other parallel work, you must start independent fact investigations in parallel. A fact under investigation defers only its downstream questions; other frontier questions must still be asked in the current round. When the host does not support parallel work, investigate directly. Parallel capability is not a workflow prerequisite, and facts available from the environment must never be delegated to the user.

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

When the ready question set is empty, all relevant facts are established, and every identified user decision is resolved, perform one completeness review. Recheck that no user-visible branch remains unaddressed or silently assumed. Present a shared-understanding summary that covers the outcome, scope, key decisions, acceptance criteria, and explicit non-goals, then persist the final confirmation as `- [blocking] CONFIRM: <confirmation>` in the brief. Until the user confirms explicitly, do not enter Build or call `next`. If the user adds or rejects anything, update the affected branches and continue with another round. After explicit confirmation, remove the blocking item, record the confirmation, and advance with `--confirmed`.

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

Before creating a change, the host/project owner must provision the controller trust root at `~/.comet/native-controller-trust.json` in an external read-only boundary the current Agent cannot replace, binding the physical project root to the controller's public identity. A regular POSIX file must be owned by a different UID, and neither the file nor its parent chain may be writable by the current process. Windows requires a host-provided read-only mount capability trusted by the Runtime; a same-user local file fails closed. Native commands only read this store; they never create or modify it. The external controller then signs the public in-project `.comet/native-review-trust.json` v2 policy and issues a creation authorization for the exact change. The policy fixes the public Ed25519 identities for implementation, review, and waiver signing. The controller, implementation, every reviewer, and every waiver signer must use globally distinct keys.

The current Agent must not hold, request, or read controller, reviewer, or waiver-signer private keys. It must not run `trust policy` or `trust authorize`, or sign on behalf of an external reviewer or waiver signer. Give the current Agent only public identities, the creation authorization, and receipt refs. Each external role injects its private-key environment variable into a one-shot owner-controlled signer/helper and clears it immediately after the command. Private keys must never enter the current session, project, Native artifacts, command output, or reports. Remain blocked when an external signature is missing: provide the exact pending command and wait for its owner instead of generating a replacement key, reusing the implementation key, forging a receipt, or downgrading to legacy.

```text
comet native new <change-name> \
  --creation-authorization <controller-owned-path> \
  --language en
```

`new` creates `verification_protocol: signed-v2` by default. While holding the mutation lock, it validates the external controller trust, the controller-signed policy, and a creation authorization bound to the physical project root, policy hash, protocol, and change name, then stores a creation-time policy snapshot. Any missing or invalid prerequisite fails before the change directory is created. An old active change remains readable and completable as `legacy-v1` only when the controller store explicitly lists it as legacy. Never edit the marker or downgrade a new change to bypass signed-v2.

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

For parsing, counting, tokenization, or boundary detection, the completeness review also uses counterexamples for empty and whitespace-only input, no delimiter, consecutive or mixed delimiters, and delimiter-like characters embedded in valid content, such as periods in abbreviations, decimal points in numbers, or escaped separators. Ask only about examples inside the stated scope; explicit non-goals close the rest. If two counterexamples can independently choose different results, they are not one user decision. A contract limited to “non-empty input” cannot justify an empty-input policy.

Only user-provided information, explicit non-goals, confirmed decisions, or a clear published contract for the current capability may close a branch. When blocked, follow the Clarification Protocol to compute and ask either one question or the ready question set for the configured mode. Do not call `next` or modify project implementation before the answer.

When no unresolved branch remains and the brief, complete target specifications, repository facts, and project rules are sufficient to implement and accept the work, both modes first complete the final shared-understanding confirmation. Sequential still asks only one user decision per round; Batch still asks the ready question set together.

## Progression Contract

Shape, Build, and Verify transitions return `next: auto | manual` together with `continuation.disposition: continue | await-user | blocked | done`, required inputs, and the next action. Archive does not advance through `next`; successful archive returns `done`.

These fields form the machine-readable continuation contract. `next: auto` means that the current transition succeeded; it does not mean that the host executes later work in the background.

After `next: auto` with disposition `continue`, reread the returned phase and required artifacts. When no user decision or Runtime blocker remains, continue into the next phase inside this Skill without waiting for another invocation.

For `await-user`, `blocked`, or `next: manual`, first resolve the returned disk facts and blocking findings. Ask only when the missing input is genuinely a user decision.

The current Sequential question and final shared-understanding confirmation, as well as unanswered Batch questions and its final shared-understanding confirmation, remain `[blocking]`. They are normal stop points for user input and cannot be bypassed by automatic progression.

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
comet native next <change-name> --summary <summary> [--confirmed]
```

Append `--confirmed` only when this turn recorded the user's answer to an existing blocking question; both Sequential and Batch modes must first obtain the final shared-understanding confirmation. The Runtime binds approval to the current brief/spec contract hash. If the contract changes during Build, obtain user confirmation for the current contract and retry with the command returned by status. Do not edit `approval` or `approved_contract_hash` manually.

## Build

Choose the simplest reliable implementation that satisfies the brief and proposed specifications. Decide implementation details, whether to save a plan, test granularity, debugging method, and review depth according to risk.

Do not create extra documents merely to satisfy the workflow. If requirements or specifications drift, update the Native artifacts first. If a new user decision appears, mark it `[blocking]` and follow the configured clarification protocol. Sequential mode must traverse the decision tree again, while Batch mode must recompute the ready question set; both modes must obtain final confirmation of the updated shared understanding before implementation continues.

Build may be completed in batches. At the start of each iteration, use `status <change> --details` to page through the complete acceptance set and the previous `failed` / `missing` states, then prioritize a small related batch of gaps. For long work, use the existing checkpoint to save a recovery summary, next action, and real artifact refs. A checkpoint is recovery state, not proof that acceptance is satisfied or Archive is ready.

Once there is a candidate implementation, reread the current brief, complete specs, every acceptance page, the implementation scope, and the verification entry points for one complete spec audit. Then provide real project artifacts. If no code changed, provide a concrete reason. Then run:

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

In the fixed acceptance evidence block of `verification.md`, use every Runtime-provided `acceptance_id`. Every `passed` item references a typed acceptance receipt on the current bindings. Use `receipt automated` for a real command, or `receipt manual --confirmed` only for genuine human observation with steps, observations, and a responsible actor. A failed or skipped result is not a pass. For a real waiver, preserve the blocking receipt and give the reason, risk, and alternative typed receipt to the external pre-trusted waiver signer, who runs `receipt waive`; the current Agent receives only the `waiver_ref`, and the report entry uses `status: waived` with that ref. Serialize entries with `comet native evidence format`; never hand-format the JSON.

When you need reproducible text-hygiene evidence, run the built-in read-only check:

```text
comet native check <change-name>
```

This command scans a bounded set of regular project text files in the current implementation scope/current snapshot. It does not invoke Git, a shell, project scripts, external processes, or external Skills. It does not modify project files, phase, Run, or trajectory; it writes a content-addressed receipt. It does not replace risk-based project tests.

`pass` requires a typed required-check receipt bound to the current scope, snapshot, and contract. When `--receipt` is omitted, Runtime runs its built-in `check` under the lock and creates a typed static-inspection receipt. A required failed, skipped, blocked, scan-limited, timed-out, or invalid result blocks the pass. `receipt automated` defaults to 120 seconds and accepts at most 3,600,000 milliseconds; timeout terminates the process tree and produces a blocked receipt.

Every signed-v2 pass requires an independent acceptance-applicability review. The Runtime first creates an implementation preparation bound to the current change/revision/contract/scope/snapshot, complete acceptance set, and run/scope execution ID. An owner-controlled pure signer reads only the complete preparation and returns a detached signature; the Runtime then revalidates current state and finalizes without the private key:

```text
comet native receipt implement <change-name> prepare \
  --identity <implementation-identity.json> --output <implementation-preparation.json>
comet native receipt implement sign \
  --preparation <implementation-preparation.json> \
  --identity <implementation-identity.json> \
  --private-key-env <implementation-secret-env> \
  --output <implementation-attestation.json>
comet native receipt implement <change-name> finalize \
  --preparation <implementation-preparation.json> \
  --attestation <implementation-attestation.json> \
  --confirmed
```

Finish the final `verification.md`, then give the code, specifications, complete acceptance matrix, implementation attestation, required-check receipt, and all typed evidence/waiver refs to an external pre-trusted reviewer distinct from the implementation identity. Runtime `prepare` freezes the review inputs. In an isolated environment, the external reviewer runs `approve`, independently replays automated/static evidence, explicitly attests every manual receipt, records findings, and confirms acceptance applicability. A pure signer signs only the complete approval, and a private-key-free Runtime finalizes it. The current implementation Agent cannot run reviewer approval/signing or sign for the reviewer:

```text
comet native receipt review <change-name> prepare \
  --implementation-receipt <implementation-receipt-ref> \
  --report verification.md \
  --required-receipt <required-check-receipt-ref> \
  --identity <reviewer-identity.json> \
  [--unified-io-receipt <typed-receipt-ref> \
   --adversarial-paths-receipt <typed-receipt-ref> \
   --generated-assets-receipt <typed-receipt-ref> \
   --lifecycle-eval-receipt <typed-receipt-ref>] \
  --output <review-preparation.json>
comet native receipt review <change-name> approve \
  --preparation <review-preparation.json> \
  [--attest-manual <manual-receipt-ref>]... \
  [--findings <findings.json>] \
  --checked-acceptance-applicability \
  --output <review-approval.json>
comet native receipt review sign \
  --approval <review-approval.json> \
  --identity <reviewer-identity.json> \
  --private-key-env <reviewer-secret-env> \
  --output <review-attestation.json>
comet native receipt review <change-name> finalize \
  --preparation <review-preparation.json> \
  --approval <review-approval.json> \
  --attestation <review-attestation.json> \
  --confirmed
```

The review covers the complete current acceptance set in the final report and has no unresolved P0/P1 finding. On the reviewer path, the Runtime re-executes automated receipts, reruns static inspection, and requires explicit reviewer attestation for manual receipts. The signature binds the canonical acceptance matrix, complete evidence/waiver graph, and replay refs. A high-risk change (`app/`, `domains/`, `platform/`, `config/`, bundled Skills/manifest, relevant runtime/build/install/release scripts, dependency manifests, and incomplete or deletion-containing scopes) must provide a real typed receipt for each unified-I/O, adversarial-path, generated-asset, and real lifecycle Eval check; boolean self-attestation is insufficient. Verify and Archive share the same graph validator, so any report, receipt, or graph change makes the review stale. A signed review is a trusted accountability boundary for these review facts, not a formal proof of semantic correctness.

Inject the external reviewer's private-key environment variable only into the project-agnostic `receipt review sign` process and clear it immediately afterward. That signer performs no filesystem, project, Git, or subprocess access. `approve` must be run outside the current Agent by a real reviewer; manual confirmations supplied by the current Agent cannot become reviewer attestations. Remain blocked when an external approval or signature is missing. The current Agent cannot self-sign or use a review as direct acceptance evidence. After review, pass every acceptance receipt from the report through `--evidence-receipt`, and pass the review only through the independent-review parameter:

```text
comet native next <change-name> --summary <summary> \
  --result pass|fail \
  --report verification.md \
  [--receipt <required-receipt-ref>] \
  [--evidence-receipt <acceptance-receipt-ref>]... \
  [--waiver <waiver-ref>]... \
  [--independent-review-receipt <review-receipt-ref>]
```

`fail` returns to Build. Runtime derives `failed` / `missing` acceptance IDs from the validated acceptance matrix/envelope, and continuation returns `action: work-phase` so those gaps are repaired first; do not treat a default `next` command as the repair action. Fix the evidenced problem, verify again, and submit stable, non-sensitive failure facts through `--failure-category` and `--failed-check`.

The failure signature binds only the current contract, unsatisfied acceptance IDs, and failed check IDs. Code, snapshot, or implementation-scope churn alone is not semantic progress. The second identical gap warns, the third stops, and the signature returned by status permits one `--override-repair`; never repeat an override for the same signature. One contract accepts at most five Verify failures by default, or the positive integer configured by `native.max_verify_failures`. Ordinary implementation changes and configuration edits do not erase the accumulated count; only a newly confirmed contract starts a new budget. A stagnation or total-budget stop returns `blocked`; never weaken checks or fabricate a pass.

After entering Archive, changes to the brief, specifications, implementation scope, report, receipt, waiver, review trust policy, or review make the evidence stale. Archive preview, the fence before its first transaction operation, and the final freshness fence after spec operations but before moving the change all revalidate bound facts. Follow the Runtime continuation back to Build, reseal the scope, and verify again. Do not reuse a stale pass. Intermediate failed Verify loops must not run Archive preview or trigger Archive confirmation; only the final pass follows `native.archive_confirmation` through the final Archive path.

## Archive

After the state reaches Archive with a passing Verify result, preflight first:

```text
comet native archive <change-name> --dry-run
```

Inspect create/replace/remove operations, evidence freshness, visible overlap with other changes in the current Native root, and recovery state. The preview returns a `preflightHash`, `archiveConfirmation`, and continuation bound to the current configuration and facts.

For `archiveConfirmation: automatic`, follow the exact continuation command and commit without creating a user stop point:

```text
comet native archive <change-name> --expect-preflight <sha256>
```

For `archiveConfirmation: required`, show the user the change, implementation and verification conclusion, and a create/replace/remove summary after preview, then pause for a single choice:

- **Archive now** — archive only the exact hash from this preview
- **Keep this change active** — do not archive; preserve the active change and Archive phase for adjustments or later resume

Only after the user explicitly chooses **Archive now** at this decision point may you run:

```text
comet native archive <change-name> --expect-preflight <sha256> --confirmed
```

Do not treat the initial request, historical preferences, an automatic Loop, or “Verify already passed” as the final confirmation required by `required` mode. Failed Build ↔ Verify repair iterations must not trigger an archive question; apply this setting only after every acceptance converges, Verify passes, and the preview succeeds. If the user requests changes, stop this archive attempt. The edits make the old evidence and preflight stale, and Runtime continuation returns to Build. Only a newly successful cycle produces another preview and applies the then-current setting again.

If the caller asks to preserve a preflight or commit envelope, the first invocation itself must use machine-readable mode and write to the target file. Commit with the hash from the saved preflight. Once validated, keep the file immutable; do not overwrite it by rerunning commands after archive.

The Runtime recomputes the facts under lock and rejects drift. On success, it updates canonical specifications and moves the change into a date-prefixed archive directory.

For a canonical conflict, reread and rewrite the complete target specification, then run `comet native spec rebase <change-name> --summary <summary>`. This returns the change to Build under Runtime control; implement, confirm, verify, and archive again. Follow the recovery reference for incomplete transactions.

## Invariants

- Never edit `phase`, `approval`, `spec_changes`, Run state, trajectory, locks, or transaction journals directly.
- Never skip phase checks. Shape, Build, and Verify use `comet native next`; Archive uses the two-step preflight and commit protocol and follows `native.archive_confirmation`.
- Never invoke external Skills. The Native flow depends only on the bundled Comet Runtime.
- Do not persist hidden reasoning. Save summaries, artifact references, command results, hashes, state changes, and timestamps.
- Do not write tokens, passwords, private keys, connection strings, or other credentials into summaries, reasons, or reports.
- Continue while no user decision or Runtime blocker remains. When a user decision remains, Sequential mode asks only the most upstream question; Batch mode asks the entire ready question set, then waits for the user's answers.
