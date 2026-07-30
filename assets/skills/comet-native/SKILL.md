---
name: comet-native
description: Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry router selects Native; clarify requirements, read state, and drive Shape → Build → Verify → Archive.
---

# Comet Native

Native stores requirements, complete target specifications, state, and evidence. You understand, implement, and verify; the Runtime owns state, boundaries, and recovery.

## Core rules

Read these values from `.comet/config.yaml`:

- `native.clarification_mode`: defaults to `sequential`;
- `native.archive_confirmation`: defaults to `automatic`;
- `native.max_verify_failures`: defaults to `5`.

Config, selection, change state, and formal artifacts on disk take precedence over chat memory. Do not directly edit Runtime-managed state, evidence, locks, or transaction files.

The Native main workflow does not depend on any external Skill.

## Start or resume

1. Run `comet native status` to identify the current change and phase.
2. Run `comet native show <change-name>` for the target. In Verify, Archive, or Build after a failure, also run `status <change-name> --details`.
3. When more acceptance items are needed, follow `acceptancePage.nextCursor`. If findings are truncated, handle the returned findings and then read details again.
4. After confirming the target, run `comet native select <change-name>`.

If multiple reasonable candidates remain, ask the user to select one. Create a change only after confirming that no matching active change exists:

```text
comet native new <change-name> \
  --language en
```

Use only the Native artifact root selected by project configuration.

## On-demand loading

After confirming the current change and phase, read one corresponding reference on demand:

- When entering Shape, you must first read and execute the [clarification reference](reference/clarification.md). Do not skip it because “the requirements look clear.” Do not modify project implementation or advance to Build until shared understanding is confirmed.
- If you need advanced options, receipts, or partial-scope commands, read the [command reference](reference/commands.md).
- If you need to edit the brief, specifications, or verification report, read the [artifact reference](reference/artifacts.md).
- If interruption, stale evidence, a repair stop, conflict, lock, or migration occurs, read the [recovery reference](reference/recovery.md).

## Shape

First investigate facts available from the repository, tools, and runtime environment. Ask the user only when different choices would materially change user-visible results and the existing requirements do not resolve the choice reliably. You own implementation choices.

Follow the clarification reference according to `clarification_mode`. Even when the initial assessment finds no unresolved behavior, complete its information classification and silent-assumption check. After every user answer, immediately update Decisions, the brief, and the complete target specifications in the same change. Keep unresolved items `[blocking]`; do not modify project implementation or advance while a blocker remains.

After all user decisions are resolved, check again for silent assumptions. Give the user a shared-understanding summary covering the goal, scope, key decisions, acceptance criteria, and non-goals. Only after explicit confirmation may you remove the final blocker and advance:

```text
comet native next <change-name> --summary <summary> --confirmed
```

If the brief or specifications change confirmed behavior, obtain confirmation again. Do not edit confirmation state manually.

## Build

Implement the simplest reliable solution that satisfies the brief and complete target specifications. Work may proceed in batches. Long tasks may use a checkpoint for recovery context, but a checkpoint is not completion evidence.

When requirements change, update the formal artifacts first. If a new user decision appears, stay in Build but repeat the Shape clarification and confirmation boundary: save a `[blocking]` item, pause implementation, and ask the user. After confirmation, update Decisions, the brief, and the complete target specifications, then remove the blocker. When leaving Build, run the command returned by the Runtime and pass `--confirmed`.

After the candidate implementation is complete, review it against the complete specifications and every acceptance item for omissions, then advance with real project artifacts:

```text
comet native next <change-name> \
  --summary <summary> \
  --artifact <project-path> \
  [--confirmed]
```

If no code changed or the Runtime cannot prove complete scope, read the command reference. Never describe unknown or incomplete scope as complete.

## Completion Loop

After entering Build, converge through this loop:

1. Run `status <change-name> --details` and read the currently required acceptance pages. After a Verify failure, prioritize failed or missing acceptance items and failed checks.
2. Complete one related batch of real repairs. You may write a checkpoint before interruption, but a checkpoint is not completion evidence.
3. When a candidate implementation exists, reread the brief, complete specifications, and every acceptance item, then perform one complete review.
4. Run real validation and submit the Verify result.
5. `fail` returns to Build and repeats from step 1 without running Archive; only `pass` enters Archive.

`blocked` pauses the normal Build → Verify loop and enters a recovery branch. After handling the findings, resume from step 1 according to the new continuation. End the current work only at `done`, `await-user`, or an explicit caller stop point. One Agent turn, one checkpoint, one `blocked` result, or the Agent saying “complete” is not a terminal state. The Agent finds and repairs gaps; the Runtime decides whether completion has been proven.

## Verify

Run real validation based on the acceptance items, complete target specifications, and change risk. Record actual results in `verification.md` and the acceptance evidence. A check that did not run or failed cannot be reported as passed.

Use acceptance IDs and receipts returned by the Runtime. Read the artifact and command references when you need to generate the evidence block or record an automated or manual receipt.

Submit `pass` only when the Runtime accepts the complete, fresh acceptance matrix and required checks. Reverify after relevant implementation, specification, report, or evidence changes.

`fail` returns to Build. Fix the failed or missing acceptance items and failed checks reported by the Runtime before verifying again; another `next` call is not itself a repair. For `repair-stagnation-stop`, follow the recovery reference to form a new hypothesis and use the Runtime-provided override. Wait for the user only when the continuation requires `repair-continuation-decision`.

An intermediate Verify failure never runs Archive or triggers archive confirmation. Continue Build → Verify until pass, a Runtime block, or a required user decision.

## Archive

Preview only after the final Verify pass:

```text
comet native archive <change-name> --dry-run
```

After a successful preview:

- `automatic`: run the exact commit command returned by the continuation;
- `required`: show the implementation, verification, and specification-operation summary, then wait for the user to archive now or keep the change active.

Do not reuse an old preflight. If facts drift or a canonical conflict or unfinished transaction appears, follow the continuation and the recovery reference.

## Continuation and stop points

Shape, Build, and Verify transitions return `next: auto | manual` together with `continuation.disposition: continue | await-user | blocked | done`, required inputs, and the next action. Archive does not advance through `next`; a successful archive returns `done`. After every transition, act on that Runtime continuation:

- `continue`: reread the phase and currently required artifacts, then continue;
- `await-user`: wait for a decision or missing input that genuinely requires the user;
- `blocked`: pause the normal loop, handle the findings, and read the recovery reference when needed; then resume according to the new continuation rather than ending the task because it was `blocked`;
- `done`: the change is complete.

`next: auto` means only that the current transition succeeded; later work has not run automatically. If the caller explicitly requests a stop after a transition, update the formal artifacts, run the one allowed transition, make no tool calls after the transition succeeds, then output the agreed marker and end the turn, even when the continuation is `continue`.

`workspace-root-changed` and `workspace-inspection-unavailable` are read-only advisories and do not block progression or Archive by themselves. Unknown workspace-integrity findings, confirmed conflicts, stale evidence, and repair stops must be resolved; when the Runtime requires workspace identity repair, run read-only doctor and then follow its explicit `doctor --repair` report.

Never place tokens, passwords, private keys, connection strings, or other credentials in summaries, reasons, reports, or artifacts.
