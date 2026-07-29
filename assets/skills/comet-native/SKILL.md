---
name: comet-native
description: Use when the user explicitly invokes /comet-native, asks to start or resume a Native change, or the entry router selects Native; clarify requirements, read state, and drive Shape → Build → Verify → Archive.
---

# Comet Native

Native stores requirements, complete target specifications, state, and evidence. You understand, implement, and verify; the Runtime owns state, boundaries, and recovery.

## Progressive loading

Start with this file only. Read one reference when the corresponding task appears:

- If Shape contains unresolved user-visible behavior, read the [clarification reference](reference/clarification.md).
- If you need advanced options, receipts, partial scope, or an external-role handoff command, read the [command reference](reference/commands.md).
- If you need to edit the brief, specifications, or verification report, read the [artifact reference](reference/artifacts.md).
- If interruption, stale evidence, a repair stop, conflict, lock, or migration occurs, read the [recovery reference](reference/recovery.md).

## Core rules

Read these values from `.comet/config.yaml`:

- `native.clarification_mode`: defaults to `sequential`;
- `native.archive_confirmation`: defaults to `automatic`;
- `native.max_verify_failures`: defaults to `5`.

Config, selection, change state, and formal artifacts on disk take precedence over chat memory. Do not directly edit Runtime-managed state, evidence, locks, or transaction files.

The Native main workflow does not depend on any external Skill.

Do not receive signing private keys or impersonate an external approval role. When an external action is missing, follow the Runtime continuation, wait, and hand off the required command.

## Start or resume

1. Run `comet native status` to identify the current change and phase.
2. Run `comet native show <change-name>` for the target. In Verify, Archive, or Build after a failure, also run `status <change-name> --details`.
3. When more acceptance items are needed, follow `acceptancePage.nextCursor`. If findings are truncated, handle the returned findings and then read details again.
4. After confirming the target, run `comet native select <change-name>`.
5. Read only the formal artifacts, implementation, tests, and project rules needed by the current phase.

If multiple reasonable candidates remain, ask the user to select one. Create a change only after confirming that no matching active change exists:

```text
comet native new <change-name> \
  --language en
```

Use only the Native artifact root selected by project configuration.

## Shape

First investigate facts available from the repository, tools, and runtime environment. Ask the user only when different choices would materially change user-visible results and the existing requirements do not resolve the choice reliably. You own implementation choices.

When behavior is unresolved, read the clarification reference and follow `clarification_mode`. After every user answer, immediately update Decisions, the brief, and the complete target specifications in the same change. Keep unresolved items `[blocking]`; do not modify project implementation or advance while a blocker remains.

After all user decisions are resolved, check again for silent assumptions. Give the user a shared-understanding summary covering the goal, scope, key decisions, acceptance criteria, and non-goals. Only after explicit confirmation may you remove the final blocker and advance:

```text
comet native next <change-name> --summary <summary> --confirmed
```

If the brief or specifications change confirmed behavior, obtain confirmation again. Do not edit confirmation state manually.

## Build

Implement the simplest reliable solution that satisfies the brief and complete target specifications. Work may proceed in batches. Long tasks may use a checkpoint for recovery context, but a checkpoint is not completion evidence.

When requirements change, update the formal artifacts first. If a new user decision appears, return to the Shape clarification and confirmation boundary.

After the candidate implementation is complete, review it against the complete specifications and every acceptance item for omissions, then advance with real project artifacts:

```text
comet native next <change-name> \
  --summary <summary> \
  --artifact <project-path>
```

If no code changed or the Runtime cannot prove complete scope, read the command reference. Never describe unknown or incomplete scope as complete.

## Completion Loop

After entering Build, converge through this loop:

1. Run `status <change-name> --details` and read the currently required acceptance pages. After a Verify failure, prioritize failed or missing acceptance items and failed checks.
2. Complete one related batch of real repairs. You may write a checkpoint before interruption, but a checkpoint is not completion evidence.
3. When a candidate implementation exists, reread the brief, complete specifications, and every acceptance item, then perform one complete review.
4. Run real validation and submit the Verify result.
5. `fail` returns to Build and repeats from step 1 without running Archive; only `pass` enters Archive.

The loop ends only at `done`, `await-user`, `blocked`, or an explicit caller stop point. One Agent turn, one checkpoint, or the Agent saying “complete” is not a terminal state. The Agent finds and repairs gaps; the Runtime decides whether completion has been proven.

## Verify

Run real validation based on the acceptance items, complete target specifications, and change risk. Record actual results in `verification.md` and the acceptance evidence. A check that did not run or failed cannot be reported as passed.

Use acceptance IDs and receipts returned by the Runtime. Read the artifact and command references when you need to generate the evidence block, record an automated or manual receipt, request a waiver, or hand off independent review. The current Agent does not perform external signing.

Submit `pass` only when the Runtime accepts the complete, fresh acceptance matrix, required checks, and independent review. Reverify after relevant implementation, specification, report, or evidence changes.

`fail` returns to Build. Fix the failed or missing acceptance items and failed checks reported by the Runtime before verifying again; another `next` call is not itself a repair. When the Runtime reaches its repeated-gap stop condition or the `native.max_verify_failures` budget, stop and wait for a user decision.

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
- `await-user`: wait for input that genuinely belongs to the user or an external role;
- `blocked`: handle the findings and read the recovery reference when needed;
- `done`: the change is complete.

`next: auto` means only that the current transition succeeded; later work has not run automatically. If the caller explicitly requests a stop after a transition, update the formal artifacts, run the one allowed transition, make no tool calls after the transition succeeds, then output the agreed marker and end the turn, even when the continuation is `continue`.

`workspace-root-changed` and `workspace-inspection-unavailable` are read-only advisories and do not block progression or Archive by themselves. Unknown workspace-integrity findings, confirmed conflicts, stale evidence, and repair stops must be resolved; when the Runtime requires workspace identity repair, run read-only doctor and then follow its explicit `doctor --repair` report.

Never place tokens, passwords, private keys, connection strings, or other credentials in summaries, reasons, reports, or artifacts.
