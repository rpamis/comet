# Comet Native Evidence Projection

- Change: separate-native-runtime-storage
- Phase: archive
- Revision: 6
- Generated-at: 2026-08-07T19:55:50.590Z

Generated-by: comet-native

<!--
  This file is a read-only projection of the content-addressed evidence under
  .comet/runtime/native directory. The Native Runtime regenerates it on every evidence-bearing
  transition. Do not hand-edit, and never cite this file as verification proof —
  the canonical facts live in the hash-named evidence documents.
-->

## Implementation scope

- Source: evidence/snapshots/1d6877f54438ec3d26267e4e35a763675d9400d092d2594c67c0d9c99ef0aa0a.json
- Current: evidence/snapshots/8dcce1dfcc4b340401f54dca42fab21de130636b15fca64e41b14ca04c03da8e.json
- Scope: evidence/scopes/aa244e7a11c5.json
- Status: complete
- Declared artifacts: 16

- CHANGELOG.md modified 156939→157778 bytes (covers: CHANGELOG.md)
- assets/manifest.json modified 3989 bytes (covers: assets/manifest.json)
- assets/skills-zh/comet-native/reference/artifacts.md modified 3246→3754 bytes (covers: assets/skills-zh/comet-native)
- assets/skills-zh/comet-native/reference/recovery.md modified 3059→3630 bytes (covers: assets/skills-zh/comet-native)
- assets/skills/comet-native/reference/artifacts.md modified 3650→4194 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/reference/recovery.md modified 3463→4121 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-archive.mjs modified 457049→466666 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-check.mjs modified 372947→375093 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-checkpoint.mjs modified 442331→446556 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-doctor.mjs modified 567617→573962 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-evidence.mjs modified 151805→151929 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-hook-guard.mjs modified 207886→208899 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-init.mjs modified 171362→171866 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-new.mjs modified 449870→455325 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-next.mjs modified 516525→523915 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-receipt.mjs modified 371280→373499 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-root.mjs modified 251563→228131 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-runtime.mjs modified 712450→722338 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-select.mjs modified 425398→429827 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-show.mjs modified 193567→194593 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-spec.mjs modified 443703→448127 bytes (covers: assets/skills/comet-native)
- assets/skills/comet-native/scripts/comet-native-status.mjs modified 413928→418313 bytes (covers: assets/skills/comet-native)
- assets/skills/comet/scripts/comet-entry-runtime.mjs modified 131214→131231 bytes (covers: assets/skills/comet/scripts/comet-entry-runtime.mjs)
- assets/skills/comet/scripts/comet-hook-router.mjs modified 229395→230299 bytes (covers: assets/skills/comet/scripts/comet-hook-router.mjs)
- domains/comet-native/native-archive-transaction.ts modified 51775→52275 bytes (covers: domains/comet-native)
- domains/comet-native/native-archive.ts modified 21190→23484 bytes (covers: domains/comet-native)
- domains/comet-native/native-change.ts modified 35942→38725 bytes (covers: domains/comet-native)
- domains/comet-native/native-check-receipt-storage.ts modified 8895→9001 bytes (covers: domains/comet-native)
- domains/comet-native/native-checkpoint-command.ts modified 1696→1368 bytes (covers: domains/comet-native)
- domains/comet-native/native-checkpoint-storage.ts modified 23007→23345 bytes (covers: domains/comet-native)
- domains/comet-native/native-continuation.ts modified 11060→11506 bytes (covers: domains/comet-native)
- domains/comet-native/native-diagnostics.ts modified 24369→26022 bytes (covers: domains/comet-native)
- domains/comet-native/native-doctor.ts modified 29389→32594 bytes (covers: domains/comet-native)
- domains/comet-native/native-evidence-projection.ts modified 12600→12607 bytes (covers: domains/comet-native)
- domains/comet-native/native-evidence-retention.ts modified 39567→39733 bytes (covers: domains/comet-native)
- domains/comet-native/native-evidence-storage.ts modified 24358→24506 bytes (covers: domains/comet-native)
- domains/comet-native/native-findings.ts modified 10217→10665 bytes (covers: domains/comet-native)
- domains/comet-native/native-lock.ts modified 17103→17194 bytes (covers: domains/comet-native)
- domains/comet-native/native-paths.ts modified 5883→10920 bytes (covers: domains/comet-native)
- domains/comet-native/native-repair-integration.ts modified 13045→13062 bytes (covers: domains/comet-native)
- domains/comet-native/native-resume-view.ts modified 5015→4692 bytes (covers: domains/comet-native)
- domains/comet-native/native-root-move.ts modified 38478→37991 bytes (covers: domains/comet-native)
- domains/comet-native/native-run-consistency.ts modified 4662→4597 bytes (covers: domains/comet-native)
- domains/comet-native/native-run-store.ts modified 20796→20829 bytes (covers: domains/comet-native)
- domains/comet-native/native-schema-migration.ts modified 43265→43561 bytes (covers: domains/comet-native)
- domains/comet-native/native-snapshot.ts modified 116621→116910 bytes (covers: domains/comet-native)
- domains/comet-native/native-specs.ts modified 11813→11846 bytes (covers: domains/comet-native)
- domains/comet-native/native-trajectory-recovery.ts modified 6992→6911 bytes (covers: domains/comet-native)
- domains/comet-native/native-transaction.ts modified 37950→38652 bytes (covers: domains/comet-native)
- domains/comet-native/native-transition-journal.ts modified 41403→43344 bytes (covers: domains/comet-native)
- domains/comet-native/native-transitions.ts modified 30301→36330 bytes (covers: domains/comet-native)
- domains/comet-native/native-types.ts modified 20734→20952 bytes (covers: domains/comet-native)
- domains/comet-native/native-workspace-finish.ts modified 11835→11542 bytes (covers: domains/comet-native)
- domains/comet-native/native-workspace.ts modified 26639→26909 bytes (covers: domains/comet-native)
- domains/dashboard/native-collector.ts modified 25938→26937 bytes (covers: domains/dashboard/native-collector.ts)
- package-lock.json modified 264357 bytes (covers: package-lock.json)
- package.json modified 5493 bytes (covers: package.json)
- test/app/cli-help.test.ts modified 10317 bytes (covers: test/app/cli-help.test.ts)
- test/domains/comet-native/native-archive-inspection.test.ts modified 8114→8135 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-archive-recovery.test.ts modified 24762→24925 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-archive.test.ts modified 13907→15605 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-change.test.ts modified 13584→13633 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-check-receipt.test.ts modified 23667→23801 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-check.test.ts modified 12557→12927 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-cli.test.ts modified 63652→63836 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-diagnostics.test.ts modified 16550→17303 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-doctor.test.ts modified 14548→15707 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-evidence-projection.test.ts modified 14933→14990 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-evidence-retention.test.ts modified 25137→25133 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-evidence-storage.test.ts modified 22924→23002 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-evidence-transitions.test.ts modified 21566→21749 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-paths.test.ts modified 2189→3180 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-phase1-matrix.test.ts modified 16128→16130 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-progress-checkpoint.test.ts modified 23092→23094 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-repair-transitions.test.ts modified 25354→25439 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-resume-view.test.ts modified 6572→6519 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-root-move.test.ts modified 19191→19326 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-root-recovery.test.ts modified 16944→16721 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-run-store.test.ts modified 8247→8024 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-schema-migration.test.ts modified 28038→28173 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-selection.test.ts modified 2891→2920 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-snapshot.test.ts modified 76341→76237 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-transaction.test.ts modified 12498→12658 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-transition-recovery.test.ts modified 61163→61250 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-transitions.test.ts modified 19025→22574 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-verification-runtime.test.ts modified 22464→22548 bytes (covers: test/domains/comet-native)
- test/domains/comet-native/native-wave-b-cli.test.ts modified 6466→6406 bytes (covers: test/domains/comet-native)
- test/domains/dashboard/native-collector.test.ts modified 11586→11715 bytes (covers: test/domains/dashboard/native-collector.test.ts)
- test/helpers/native-archive.ts modified 6067→6070 bytes (covers: test/helpers/native-archive.ts)
- test/repository/native-boundaries.test.ts modified 3091→3116 bytes (covers: test/repository/native-boundaries.test.ts)
- test/repository/release-metadata.test.ts modified 993 bytes (covers: test/repository/release-metadata.test.ts)

## Verification

- Result: pass
- Freshness: complete
- Evidence: evidence/verifications/8e78fcb03949.json
- Contract: 9407c91ec1f4
- Acceptance criteria: d4c637cdddd8
- Acceptance coverage: 84/84 evidenced, 0 skipped

### Acceptance trace

- acceptance-0 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-0 (brief-example, brief.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-1 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-1 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-1 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-1 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-1 (brief-example, brief.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-1 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-1 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-1 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-1 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-2 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-2 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-2 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-2 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-2 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-2 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-3 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-3 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-3 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-3 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-4 (brief-example, brief.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-4 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-4 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-4 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-4 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-5 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-5 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-5 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-5 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-5 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-6 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-6 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-6 (brief-example, brief.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-6 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-7 (brief-example, brief.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-7 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-7 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-8 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-8 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (brief-example, brief.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-9 (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-a (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-a (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-a (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-a (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-a (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-a (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-a (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-b (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-b (spec-must, specs/native-init-workspace-defaults/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-b (brief-example, brief.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-c (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-c (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-c (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- acceptance-c (spec-must, specs/native-runtime-storage/spec.md) passed (evidence/receipts/72e7523b4e6364c901a02227b09bd5c73009c0b4e71494d176f1bc486f97d3c6.json)
- ... 20 more acceptance entries truncated

### Check receipts

- manual-evidence (acceptance-evidence) passed — evidence/receipts/72e7523b4e63.json
  - steps: 1
  - observations: 1
