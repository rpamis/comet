# Windows Atomic Write Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows close-time metadata finalization safe for project configuration, Native state, and Native locks without weakening post-baseline mutation detection.

**Architecture:** Each atomic-write implementation records a trusted temporary-file stat only after closing its file handle and verifying object identity plus containment. Native lock creation similarly returns a post-close lock snapshot. Existing pre-commit and release version checks remain the enforcement point for all later mutations.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Vitest, generated Comet Runtime bundles.

## Global Constraints

- Preserve parent-chain, regular-file, symlink, and file-object identity validation.
- Do not add a `process.platform === 'win32'` bypass or remove `ctime`/`mtime` comparisons after the post-close baseline.
- Keep Native and workflow-contract state machines separate; duplicate only the local post-close containment helper needed by their existing independent atomic-write modules.
- Rebuild all Runtime assets and ship the release as `0.4.0-rc.3`.
- Stage only files created or changed by this fix; preserve unrelated linked-worktree state.

---

### Task 1: Lock down post-close atomic-write behavior

**Files:**

- Modify: `test/domains/workflow-contract/contained-atomic-write.test.ts`
- Modify: `test/domains/comet-native/native-atomic-file.test.ts`
- Modify: `domains/workflow-contract/contained-atomic-write.ts`
- Modify: `domains/comet-native/native-atomic-file.ts`

**Interfaces:**

- `ContainedAtomicWriteOptions.afterTemporaryClose?: () => void | Promise<void>` is an internal test seam invoked after `FileHandle.close()` and before the post-close baseline is read.
- `NativeAtomicWriteOptions.afterTemporaryClose?: () => void | Promise<void>` has the same semantics for Native Runtime writes.
- Each module gains a local helper that verifies the closed temporary path is a contained regular file with the same object identity, and returns its post-close `Stats` baseline.

- [x] **Step 1: Write the failing workflow-contract regression**

Add a test that passes `afterTemporaryClose`, updates the temporary file metadata in that callback, and asserts the callback ran, the target was committed, and no `.tmp` remains. The current implementation must fail because it has no post-close hook or baseline.

- [x] **Step 2: Run the workflow-contract regression red**

Run: `pnpm exec vitest run test/domains/workflow-contract/contained-atomic-write.test.ts`

Expected: FAIL at the assertion proving `afterTemporaryClose` was invoked.

- [x] **Step 3: Implement the contained post-close snapshot**

After closing the handle, invoke `afterTemporaryClose`, verify the existing directory chain, then `lstat` and `realpath` the temporary file. Reject a non-file, symlink, escaped real path, or changed file object. Replace `writtenIdentity` with this post-close stat before `beforeCommit`; keep the existing `sameUnchangedFile` comparison at commit time.

- [x] **Step 4: Run the workflow-contract regression green**

Run: `pnpm exec vitest run test/domains/workflow-contract/contained-atomic-write.test.ts`

Expected: PASS; its existing replacement, symlink, parent-displacement, and removal tests stay green.

- [x] **Step 5: Write and run the Native atomic-write regression red/green**

Repeat the same close-time metadata-finalization test for `atomicWriteText`, first confirming it fails because the new hook is not called. Add the Native-local post-close containment snapshot, then rerun:

`pnpm exec vitest run test/domains/comet-native/native-atomic-file.test.ts`

Expected: all normal-write, replacement, and parent-displacement assertions pass.

### Task 2: Return post-close Native lock identities

**Files:**

- Modify: `test/domains/comet-native/native-lock.test.ts`
- Modify: `domains/comet-native/native-lock.ts`

**Interfaces:**

- `writeNativeLockFile(file, owner)` returns the identity from `readNativeLockSnapshot(file)` after closing its writer handle.
- Before returning, it requires the post-close snapshot to retain `owner.id` and `sameNativeLockObject(preCloseIdentity, postCloseIdentity)`.

- [x] **Step 1: Write the failing lock regression**

Wrap the `fs.open` handle used for `wx` locks so its pre-close bigint stat reports a different `ctimeNs` while all other fields remain real. Acquire and release a Native lock. The current implementation must fail release with `Native lock identity changed`.

- [x] **Step 2: Run the lock regression red**

Run: `pnpm exec vitest run test/domains/comet-native/native-lock.test.ts`

Expected: FAIL only in the new close-time `ctimeNs` regression.

- [x] **Step 3: Implement post-close lock snapshotting**

Refactor `writeNativeLockFile` so it stores its pre-close identity, always closes the handle, reads the lock through `readNativeLockSnapshot`, verifies owner id and object identity, and returns the post-close identity. Do not remove `ctimeNs` or `mtimeNs` from `sameNativeLockVersion`.

- [x] **Step 4: Run the lock regression green**

Run: `pnpm exec vitest run test/domains/comet-native/native-lock.test.ts`

Expected: the new release case passes and the existing same-owner replacement case still rejects identity drift.

### Task 3: Build, release metadata, and verify

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Generated: Native, Classic, and Entry Runtime assets under `assets/skills*/**/scripts/`

**Interfaces:**

- `package.json.version` becomes `0.4.0-rc.3`.
- `CHANGELOG.md` gains one top-level `## What's Changed [0.4.0-rc.3] - 2026-09-02` entry with one English `### Fixed` item describing Windows close-time metadata finalization.

- [x] **Step 1: Set release metadata**

Update `package.json` to `0.4.0-rc.3`. Add the user-visible, English changelog entry; do not list internal test or design-plan work.

- [x] **Step 2: Regenerate Runtime assets**

Run: `pnpm build`

Expected: TypeScript compilation and Classic, Native, and Entry Runtime generation complete successfully.

- [x] **Step 3: Run focused validation**

Run:

`pnpm exec vitest run test/domains/workflow-contract/contained-atomic-write.test.ts test/domains/comet-native/native-atomic-file.test.ts test/domains/comet-native/native-lock.test.ts test/app/init-e2e.test.ts`

Expected: all affected atomic-write, lock, and initialization paths pass.

- [x] **Step 4: Run release-scope validation**

Run:

`pnpm check:generated`

`pnpm lint`

`pnpm format:check`

`pnpm test`

`git diff --check`

Expected: each command exits zero; investigate any failure before proceeding.

- [ ] **Step 5: Review and deliver**

Inspect `git diff --check`, `git status --short`, and the final generated-asset diff. Commit only this plan, design, code, tests, generated assets, package version, and changelog using `fix: stabilize Windows atomic write metadata`. Only after the user explicitly authorizes GitHub operations, push `codex/fix-windows-atomic-write` and create a PR against `master` using the repository `fix` template with the reproduction, security-preservation, and validation evidence.
