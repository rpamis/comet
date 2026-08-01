# Acceptance evidence

<!-- comet-native:acceptance-evidence:start -->
[
  {
    "acceptance_id": "acceptance-0747c64052476b2b2dd9206abac80c0b76b062e03e529f4248c52969e64c1e46",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/baee05dc5cb674e8a5bf17a4103977890a9c7d7207dbed0fa0e820b4f0386791.json"
    ]
  },
  {
    "acceptance_id": "acceptance-12918a0111dcc0ff7875c7e8e63128672300c005c04a251ee5979dc39d78df91",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-1603cb82f7b33866eed752910821e09fac6b9127bf947443d037ab508a07c0f9",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-1865abbd8e8c3e046893db4a3fa5816026ab253fda935106c39462a5b720ee4b",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-3451f2463d18effad2c06aa06a5a33df44f6ff58c68dad57215464aaf47123e2",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-3daac07dd6df06820d21f0ea2a3a99d9aa2a26e08dbfeff5069b9af17e08b54f",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-4f56de560dcc6b5860721fdd4a3b962ccc431ca7cd9eaa3535b8b1f708b73d8f",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-65f4e9e4173457e1d4e219d6194dafff725b36aead7fc56592a42854e68f079e",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-a9ebdb0fdc75c8fc722dfa4ac8fc8455876d322009e5ba7ec2d02e7a01963b18",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-b6fc776472a0f1519f9ce6315ada2e88607d47ed6f018d12271cbd34bc41d8fe",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-c9044839dc3d007b3172ffc714228d23b2d64d41e517c288ca218a75bab731d5",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-d3337e46bd50fb539da937cdb91ee679d243a8fbb8450a093793b561f60e4954",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-d5a900129394dbc5ae44aa73934485e2597aed0abc66605036f0e4d6fee9c7d9",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-e5fcfb659026ec946cd51849b46d3c5f76068c591544f09747440fb0bdcbe9ed",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  },
  {
    "acceptance_id": "acceptance-fd9d6669be204721263f89f67bb4621bbe8be7c9f968c36051c9a191b9a162e9",
    "status": "passed",
    "evidence_refs": [
      "runtime/evidence/receipts/b61de2fb7648d976c2c119f2593e04d93f6e8b2252a37523eb542466f801eab5.json"
    ]
  }
]
<!-- comet-native:acceptance-evidence:end -->

# Commands and results

- `npx tsc --noEmit` — passed.
- `npx vitest run test/app/uninstall.test.ts` — passed: 1 file, 100 tests.
- `pnpm build` — passed, including Classic, Native, Entry runtime generation and TypeScript compilation.
- `npx vitest run` — passed: 230 files, 3,077 tests passed, 36 skipped.
- `git diff --check` — passed.

# Skipped checks

- `pnpm lint` ran ESLint successfully, but its architecture stage is blocked by pre-existing untracked top-level `.zcode/` and `.codex-remote-attachments/`, which are outside this change and intentionally left untouched.

# Spec consistency

The interactive target flow detects installed Native and Classic Skills, lets the user select one or both, preserves shared Comet components for a retained workflow, and rewrites project configuration only after safe cleanup. Classic selections separately offer unchecked OpenSpec and Superpowers cleanup; non-interactive invocations retain the previous full-Comet behavior without deleting either companion integration.

# Known limitations and risks

Superpowers cleanup delegates to the installed `skills` CLI and is scoped to the selected platform agent and the `obra/superpowers` source. If that CLI cannot enumerate or remove a selected Skill, uninstall reports the failure instead of silently treating the companion cleanup as complete.

# Conclusion

Pass.
