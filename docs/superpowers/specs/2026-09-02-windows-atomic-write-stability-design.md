# Windows Atomic Write Stability Design

## Goal

Prevent Windows from treating metadata finalized by `FileHandle.close()` as an external mutation, while retaining Comet's checks for a replaced temporary file, a symlink, a displaced parent directory, or a post-baseline write.

## Scope

The fix covers the three code paths named by Issue #379:

- `domains/workflow-contract/contained-atomic-write.ts`, used by project configuration finalization.
- `domains/comet-native/native-atomic-file.ts`, used by Native Runtime state writes.
- `domains/comet-native/native-lock.ts`, used by Native mutation and transition locks.

It does not change Git isolation semantics, retry policy, or the supported Node floor (`>=22`).

## Decision

Use a post-close filesystem snapshot as the trusted baseline. Do not special-case Windows by discarding `ctime` checks.

For a contained atomic write, the Runtime will write and sync the temporary file, record its pre-close object identity, close the handle, then immediately re-read the path. The post-close read must still be a regular non-symlink file inside the verified directory chain and must name the same file object. That post-close stat becomes the reference used by the existing pre-commit comparison.

For a Native lock, `writeNativeLockFile` will close the handle before reading and returning the lock snapshot. It must verify that the parsed owner id and file object identity still match the just-written lock. Later lock release continues to compare the returned post-close version, including `ctimeNs` and `mtimeNs`.

## Security Properties

- A temporary file replacement, symlink substitution, or directory displacement remains rejected before commit.
- A write or metadata modification that occurs after the post-close snapshot remains rejected by the existing version comparison.
- A lock replacement using the same owner payload remains rejected because the lock object identity changes.
- The unavoidable interval between `close()` and the first post-close read is minimized and validated by object identity plus parent containment; it is the only interval newly treated as filesystem finalization rather than a distinct external version.

## Test Strategy

The current host does not deterministically reproduce the Windows metadata transition. Each atomic-write module will therefore expose an internal test seam immediately after close and before the post-close baseline is captured. A test uses that seam to finalize the temporary file metadata, proving that the Runtime snapshots afterward. Existing replacement, symlink, and displaced-parent cases remain regression coverage.

The Native lock test will wrap the pre-close handle stat to simulate a changed `ctimeNs`; releasing the lock must succeed only when the implementation returns the post-close snapshot. The existing same-owner replacement test remains unchanged.

## Delivery

This is a user-visible fix from `0.4.0-rc.2`, so the release version becomes `0.4.0-rc.3` with one concise English `Fixed` changelog entry. Because Runtime sources change, release validation rebuilds every generated Runtime asset before the full test suite and PR creation.
