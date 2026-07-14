# Native recovery reference

## Context recovery order

Resume from facts on disk every time:

1. Read the project's `comet.config.yaml` and confirm the single artifact root. If `pending_root_move` exists, run doctor first.
2. Run `comet native status`. With multiple active changes, read the Native selection or ask the user to choose explicitly.
3. Run `show` for the target change and read `change.yaml`, the brief, proposed complete specifications, and verification report.
4. Read relevant canonical specifications, implementation, rules, tests, and current worktree state.
5. Execute Shape, Build, Verify, or Archive according to the phase instead of guessing from chat history.

When state, Run state, trajectory, or a transaction journal is malformed, stop writing and run read-only doctor. Never bypass the problem by editing `phase` manually.

## Archive transactions

Archive uses a global lock, staged specifications, an append-only per-operation event log, and backups. After interruption, the canonical tree may be mid-transaction, but the journal preserves the unfinished facts.

```text
comet native doctor <change-name>
comet native doctor <change-name> --repair --strategy continue
comet native doctor <change-name> --repair --strategy rollback
```

- `continue` resumes after the last completed operation and converges on a committed archive.
- `rollback` restores canonical files and the active change in reverse order.
- Once finalization starts, only continue is safe; this avoids restoring an active change after completed evidence has been recorded.

Read the paths, transaction id, and conflict details reported by doctor first. If current hashes match neither side of the journal, preserve both trees and stop automated repair.

## Artifact-root moves

`root move` progresses through `copying`, `ready`, and `switched`. Configuration's `pending_root_move` is the recovery source of truth; ordinary Native write commands fail closed while it exists.

- `copying`: the old root is current and target staging may be incomplete.
- `ready`: staging passed per-file path, size, and SHA-256 verification, but configuration has not switched.
- `switched`: configuration points to the new root; the old root is removed only after another verification.

Use doctor's explicit continue or rollback strategy. If the two tree hashes differ, delete neither tree and give the user both reported paths.

## Locks and safe repair

Doctor distinguishes active locks, provably stale local locks, and remote locks whose owners cannot be determined. Remove a stale lock only when its owner process is known not to exist and no unfinished transaction depends on it; never break active or unknown locks automatically.

Doctor may safely clear a selection that points to a missing change. It does not rewrite damaged configuration, change YAML, briefs, specifications, or verification reports; repair those files manually from user intent, then inspect again.
