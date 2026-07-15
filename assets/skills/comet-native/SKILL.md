---
name: comet-native
description: Use Comet-owned Native changes, phase checks, and automatic progression for a lightweight but recoverable requirements-to-archive workflow designed for strong coding models.
---

# Comet Native

Understand first, then act. Native preserves requirements, complete target specifications, state, and evidence; the model chooses how to implement instead of following a fixed method.

## Start or resume

Run Native `status` and `show` first. Then read `comet.config.yaml`, `change.yaml`, the brief, proposed complete specifications, canonical specifications, repository implementation, project rules, and relevant tests. Do not ask the user for facts available from the environment.

If no change exists, summarize the user's goal as a lowercase kebab-case name and create it with `comet native new <change-name> --language en`. Use only the configured `<artifact-root>/comet/`; do not scan or modify directories owned by other workflows.

See the [command reference](reference/commands.md) for commands and runtime discovery, the [artifact reference](reference/artifacts.md) for formats, and the [recovery reference](reference/recovery.md) for interruption handling. The bundled runtime is at [scripts/comet-native-runtime.mjs](scripts/comet-native-runtime.mjs).

## Decision protocol

Maintain a decision frontier: focus only on unresolved choices that would materially change scope, user-visible behavior, compatibility, risk, or irreversibility.

When such a choice exists:

1. Ask only the single most important question, then wait for the user's answer.
2. Include a recommended answer, a short rationale, and the practical impact of each option.
3. Resolve dependent decisions in order; do not send the user a batch of questions.
4. Stay in Shape and do not implement until the necessary decision is available.

Investigate ordinary facts, current code, dependency constraints, and test methods yourself. Only decisions belong to the user; do not make the user perform repository research.

## Shape

Establish the Outcome, Scope, Non-goals, Acceptance examples, Constraints and invariants, Decisions, Open questions, and Verification expectations. Mark a blocking question in the brief as `- [blocking]`.

Once understanding is aligned:

- update `brief.md` until it constrains implementation and acceptance;
- when durable behavior changes, write each complete target specification at `specs/<capability>/spec.md`, not as an incremental patch;
- remove a durable capability with `comet native spec remove <change-name> <capability>`; the runtime infers create/replace operations and freezes canonical base hashes;
- record explicit confirmation only when the user has just confirmed a high-impact decision; while it remains unresolved, keep `[blocking]` and stop.

Then provide a verifiable summary and run:

```text
comet native next <change-name> --summary <summary>
```

Append `--confirmed` when the summary includes a high-impact decision the user just confirmed. Otherwise omit it. The runtime records `approval`; never edit it manually.

## Build

Choose the simplest reliable approach that satisfies the brief and proposed specifications. The model decides the implementation method, whether a written plan is useful, test granularity, debugging method, and review depth according to risk.

Do not create extra documents or steps merely to satisfy a process. If implementation reveals requirement or specification drift, update the Native artifacts first. When a new high-impact user decision appears, mark it `[blocking]` and ask only one question. After the answer, update Decisions, remove the blocker, continue implementation, and pass `--confirmed` when leaving Build.

When complete, provide real artifact references. If no code changed, provide an explicit reason. Then run:

```text
comet native next <change-name> --summary <summary> --artifact <project-relative-path> [--confirmed]
```

## Verify

Run verification appropriate to the brief's Acceptance examples, complete target specifications, and risk. Record actual commands, results, skipped checks, specification consistency, known limitations, and the conclusion. Never report an unrun check as passing.

Write both passing and failing results to `verification.md`, then run:

```text
comet native next <change-name> --summary <summary> --result pass|fail --report verification.md
```

A failure returns to Build. Fix the problem identified by the evidence and verify again. Pause only when the user must accept an explicit deviation.

## Archive

Archive only after the state reaches Archive with Verify marked pass:

```text
comet native archive <change-name>
```

Archive updates canonical specifications only when their hashes still match, then moves the change into a date-prefixed archive directory. On a canonical conflict, re-read and rewrite the complete target specification, then run `comet native spec rebase <change-name> --summary <summary>` to refresh the baseline and reopen Build for implementation, confirmation, and verification. Never overwrite concurrent changes. Follow the recovery reference for an incomplete transaction.

## Invariants

- Do not edit `phase`, `approval`, `spec_changes`, Run state, trajectory, locks, or transaction journals directly.
- Do not bypass phase checks; advance each phase with `comet native next` or the bundled runtime equivalent.
- Do not invoke external Skills; the Native core workflow depends only on Comet's bundled runtime.
- Do not persist hidden reasoning. Persist only summaries, artifact references, command results, hashes, state changes, and timestamps.
- Keep progressing when no user decision blocks the work. When one does, ask only the highest-value question and wait for the answer.
