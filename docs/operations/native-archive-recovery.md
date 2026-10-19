# Recover Native SDK Archive

Start with `comet native status <change> --json`. Preserve the original Action, verification report, and transaction. Do not edit Run state or delete transaction files manually.

- New archives check the candidate implementation at preparation, Spec application, finalization, and outcome commit. Drift detected before Spec writes returns to the Verify repair decision. Follow the returned `revise-implementation` command, then verify and approve again.
- If finalization explicitly stops before writing because the candidate changed, restore the confirmed implementation and materials, then run `comet native archive <change>`. This continues the existing Spec transaction without applying Specs again.
- For an unknown outcome, first have the original executing agent confirm that execution has stopped, then run `comet native archive <change> --recover`. A completed finalization is reconciled from its complete durable receipt without repeating the move.
- If finalization was interrupted and the original transaction remains, `--recover` checks the original Run, transaction, candidate implementation, applied Specs, and report before continuing unfinished finalization. An already moved directory is not moved again. Mismatched evidence preserves the transaction and blocks recovery. `resumedFinalization: true` does not mean verification checks ran again.
- `doctor --repair` does not execute SDK Archive transactions. An incomplete transaction or unknown Action produces a blocker and recovery command, rather than deleting the transaction or reporting a healthy workflow. Resolve environment issues and confirm the original executor stopped before using `archive --recover`.
- Older transactions that already applied Specs lack the new archive candidate binding. The Runtime reconstructs original Spec inputs read-only and requires an exact match to the saved candidate digest. It first tries Git index/HEAD versions matching the original target hash. It never writes these versions to the worktree or index.
- When finalization already completed and its durable receipt is complete, recovery reports `historicalRecovery: true` and `currentImplementationRevalidated: false`. This records historical completion; it does not verify subsequent implementation changes.

## No usable Git version of the original Spec

If the error requests original content, provide a genuine pre-archive backup. Do not substitute the new Spec or current implementation. Put new backup files outside the project: a new JSON file inside the project also changes the original candidate inputs. The file must be a regular file, at most 8 MiB, and not a symbolic link. An absolute path only authorizes reading that backup; it does not expand the workflow's writable scope. Relative paths must stay inside the project and cannot contain `..`.

Use this JSON format. `runId` and `transactionId` must identify the original Run and archive transaction. Each `ref` is a project-relative canonical Spec target in that transaction; `content` is its complete original UTF-8 text.

```json
{
  "schema": "comet.native.archive-originals.v1",
  "runId": "my-change",
  "transactionId": "original-archive-transaction-id",
  "files": [
    {
      "ref": "docs/comet/specs/example/spec.md",
      "content": "# Example\nComplete pre-archive Spec.\n"
    }
  ]
}
```

```bash
comet native archive my-change --legacy-spec-backup /absolute/path/original-specs.json
# Only for an unknown original Action whose executing agent has confirmed it stopped:
comet native archive my-change --recover --legacy-spec-backup /absolute/path/original-specs.json
```

The Runtime rejects unknown fields, duplicate or unrelated paths, wrong Run/transaction IDs, incorrect original hashes, links, and path escapes. The reconstructed inputs must still match the original candidate digest exactly: correct Spec backups cannot authorize unrelated implementation drift. Validated backups are saved atomically as evidence bound to this workspace, Run, and transaction. Resubmitting the same evidence is idempotent; different content cannot overwrite it.

For example:

- A schema/Run/transaction identity error means the backup does not match the original record. Correct the backup identity; do not create a replacement transaction.
- A path outside the original transaction must be removed from the backup.
- Candidate implementation drift means the confirmed implementation must be restored; a Spec backup does not authorize new code.
- A missing original candidate digest cannot be repaired by manufacturing verification evidence. Before Spec application, use the returned Verify repair path and verify again.

If the original candidate digest is missing and Specs have already been written, preserve the transaction, artifacts, and check records to reconcile the original evidence. This damaged-evidence case cannot be finalized automatically.
