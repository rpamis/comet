# Comet Native Evidence Projection

- Change: native-parallel-worktree-tests
- Phase: archive
- Revision: 4
- Generated-at: 2026-08-08T08:51:47.296Z

Generated-by: comet-native

<!--
  This file is a read-only projection of the content-addressed evidence under
  .comet/runtime/native directory. The Native Runtime regenerates it on every evidence-bearing
  transition. Do not hand-edit, and never cite this file as verification proof —
  the canonical facts live in the hash-named evidence documents.
-->

## Implementation scope

- Source: evidence/snapshots/ff7bbcfe845327a6c5eaee0dd506bb4016eb9fb57bc0fdb60bfb27e47be80403.json
- Current: evidence/snapshots/67c22fb44f1e164c48343dee6f5b9269d5d1b017f8c62cb2ff5585c98a3eb945.json
- Scope: evidence/scopes/401f0c3945bf.json
- Status: partial (has unresolved scope)
- Declared artifacts: 3
- Unattributed changes: 1

- .github/workflows/ci.yml modified 6417→6456 bytes (covers: .github/workflows/ci.yml)
- docs/superpowers/specs/2026-08-08-native-parallel-worktree-test-design.md removed 4175→0 bytes
- package.json modified 5493→5594 bytes (covers: package.json)
- test/domains/comet-native/native-parallel-worktree.test.ts added 0→11554 bytes (covers: test/domains/comet-native/native-parallel-worktree.test.ts)

### Unresolved scope

- Changed path is not covered by a declared artifact: docs/superpowers/specs/2026-08-08-native-parallel-worktree-test-design.md

## Verification

- Result: pass
- Freshness: partial
- Evidence: evidence/verifications/72ff616882d7.json
- Contract: b7731ca895db
- Acceptance criteria: 6f5568322da5
- Partial allowance: evidence/allowances/9ed2fc1388399debfd9b2d12dba0d48b78b11bfa7dead2c4fe949b8718ba3d3d.json
- Acceptance coverage: 18/18 evidenced, 0 skipped

### Acceptance trace

- acceptance-0 (brief-example, brief.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-1 (spec-must, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-2 (spec-must, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-2 (spec-scenario, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-3 (spec-must, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-3 (brief-example, brief.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-4 (brief-example, brief.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-5 (spec-must, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-5 (spec-scenario, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-6 (spec-scenario, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-7 (spec-scenario, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-7 (spec-scenario, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-8 (spec-scenario, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-8 (brief-example, brief.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-8 (spec-scenario, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-9 (brief-example, brief.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-d (spec-scenario, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)
- acceptance-f (spec-must, specs/native-parallel-worktree-tests/spec.md) passed (evidence/receipts/cb72294255dcb99f473371fa4de4774c2a253a706f914e5b10fbf6617a877c56.json)

### Check receipts

- automated-check (acceptance-evidence) passed — evidence/receipts/cb72294255dc.json
  - command: `pnpm.cmd test:native-parallel`
  - exit code: 0
  - summary: > @rpamis/comet@0.4.0-beta.17 test:native-parallel D:\Project\Comet
> vitest run test/domains/comet-native/native-parallel-worktree.test.ts

 RUN  v4.1.6 D:/Project/Comet

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  16:23:32
   Duration  76.79s (transform 54ms, setup 0ms, import 97ms, tests 76.44s, environment 0ms)
