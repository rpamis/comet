# Native Recovery Reference

Read this file only when the Runtime reports interruption, stale evidence, a repair stop, conflict, lock, migration, or damaged state.

## General rule

Stop writing and run read-only diagnostics first:

```text
comet native doctor [<change-name>]
```

Act only on facts returned by doctor or the continuation. Do not edit state, hashes, evidence, locks, or transaction files manually. When the Runtime cannot prove an automatic repair is safe, preserve the scene and wait for the user.

## Workspace advisories

`workspace-root-changed` and `workspace-inspection-unavailable` explain where the current root facts came from; they do not independently block progression or Archive. Do not treat every `workspace-*` finding as advisory: unknown workspace-integrity findings remain errors. When the Runtime requires workspace identity repair, run read-only doctor first and follow its report with explicit `doctor --repair`.

## Unfinished phase transition

When status or doctor reports an unfinished transition, first retry the original action as directed by the continuation. When explicit repair is required:

```text
comet native doctor <change-name> --repair --strategy continue
```

Ordinary Shape, Build, and Verify transitions support only continue, not rollback.

## Missing or incomplete baseline

`baseline-snapshot-missing` and `baseline-snapshot-incomplete` cannot be repaired from current files or by editing evidence.

The only safe options are:

1. restore the original baseline from a trusted backup; or
2. preserve the user's brief, specifications, and implementation facts, then create a new change.

## Stale evidence

Changes to the brief, specifications, implementation, report, or receipts may stale the old scope or Verify pass. Follow the continuation back to Build, reconfirm changed user-visible behavior, generate a new scope, and verify again. Do not reuse an old pass or preflight.

Receipts are bound to revision: every state write (checkpoint, spec refresh, phase advance) bumps the revision, which invalidates receipts issued before that bump. When `next --result` reports `verification-receipt-binding-mismatch`, the finding lists each stale receipt and the diverging field (e.g. `sourceRevision: expected 6, got 5`) and gives the recovery command. Only a source-revision-only mismatch on manual evidence can be refreshed without returning to Verify; run `comet native receipt refresh <change> --apply` to re-issue it at the current revision and rewrite verification.md. Contract, scope, snapshot, or artifact mismatches require fresh verification. Automated receipts must be re-executed with `receipt automated` and are never silently re-issued.

## Verify fail and repair stop

After Verify fail returns to Build:

1. read failed or missing acceptance items and failed checks from status details;
2. actually repair those gaps;
3. rerun the relevant validation;
4. submit the Verify result again.

When the same gap appears for the third time, the Runtime returns `repair-stagnation-stop`. This is not a user decision: read the signature from status, form one concrete new repair hypothesis that differs from the previous attempt, make the corresponding change, and use that signature and hypothesis summary for one repair override. Do not ask the user for a signature, hash, or override argument.

When the override is exhausted or `native.max_verify_failures` is reached, the continuation returns `await-user` with `repair-continuation-decision`. Explain the current failure and attempted approaches, then ask the user to choose only:

1. continue trying: increase `native.max_verify_failures` and continue;
2. change the confirmed contract: return to Shape, update the brief and complete target specification, and reconfirm;
3. stop this repair: preserve the change and current scene without progressing or running Archive.

The user chooses only the direction. You update configuration or formal artifacts, read the Runtime signature, and execute the follow-up commands.

## Canonical specification conflict

When Archive reports that a canonical specification changed:

1. reread the latest canonical specification, brief, and proposed complete specification;
2. rewrite the complete target specification according to user intent;
3. run:

```text
comet native spec rebase <change-name> --summary <summary>
```

4. implement, confirm, and verify again from the phase returned by the Runtime.

Do not edit `base_hash` or overwrite concurrent changes.

## Interrupted Archive

Run doctor first to identify the transaction and allowed recovery direction:

```text
comet native doctor <change-name>
comet native doctor <change-name> --repair --strategy continue
comet native doctor <change-name> --repair --strategy rollback
```

- `continue`: finish Archive;
- `rollback`: restore the active change;
- when doctor does not offer rollback, do not attempt one manually.

If the journal and actual files disagree, paths conflict, or safety cannot be proven, preserve every related directory and stop automatic repair.

## Interrupted artifact-root migration

Ordinary Native writes stop while `pending_root_move` exists. Run doctor and use only the continue or rollback action it offers.

If the old and new roots differ, delete neither tree. Give the user both paths returned by doctor.

## Locks, selection, or damaged artifacts

- Do not delete locks manually. Use `--repair` only when doctor explicitly reports safe takeover.
- Doctor may clear a selection that points to a missing change.
- Damaged config, change state, brief, specification, or verification content is not guessed and rewritten automatically.
- When doctor cannot determine the owner, transaction, or file identity safely, preserve the scene and stop.
