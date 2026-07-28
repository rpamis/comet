# Acceptance evidence

<!-- comet-native:acceptance-evidence:start -->
[
  {
    "acceptance_id": "acceptance-1194688bfb80d7ae33cf674fcd8fb6e0a8e1a3a60ff5d310e58df2209810a987",
    "evidence_refs": [
      "test/domains/comet-native/native-cli.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-3de11b8ed6c3ba2032c1045deecc3ebd1d6b09e095d01bb0d094ed2b8ee9153b",
    "evidence_refs": [
      "test/domains/comet-native/native-repair-stagnation.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-a9f71c7a5167a1dbcb94067a26aad9475e91aac566aaf706f1cd2c2470d0def4",
    "evidence_refs": [
      "domains/comet-native/native-repair-stagnation.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-dd8ee721cc16aff622291b5fe7a1516747bb1958f7071fac44df985a66d59214",
    "evidence_refs": [
      "test/domains/comet-native/native-repair-transitions.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-e099793bcb30b0a7e14013e62b2a6f4bd623500e21265201e6742af4aeb70c86",
    "evidence_refs": [
      "domains/comet-native/native-diagnostics.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-f5c9c8c0f5606ae6e9d8ef80a991c698d1d7976b0ca63955c63fb8dc15baad29",
    "evidence_refs": [
      "test/domains/comet-native/native-cli.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-fc9466b43327a98231a6465ee9d0cc20b72fd3c2c9317c1cd9dd203293734769",
    "evidence_refs": [
      "domains/comet-native/native-continuation.ts"
    ]
  }
]
<!-- comet-native:acceptance-evidence:end -->

# Commands and results

- `npx vitest run test/domains/comet-native` — passed: 65 files, 757 tests passed, 17 skipped.
- `eval/.venv/Scripts/python.exe -m pytest eval/local/tests/scaffold/test_native_wave_evaluations.py -q` — passed: 37 tests passed, 1 skipped.
- Generated Runtime, Entry, Dashboard, and Native Skill contract suites — passed: 23 files, 204 tests passed, 3 skipped.
- `pnpm lint` — passed, including architecture lint.
- `pnpm build` — passed, including all generated runtimes and TypeScript compilation.
- `pnpm test` — passed: 215 files, 2689 tests passed, 37 skipped.
- Targeted Prettier validation for every changed source, test, Skill, Eval, changelog, and specification file — passed.
- `comet native check native-completion-loop` — passed: 40 scoped text files, 3,015,672 bytes, no skipped binary file or issue.

# Skipped checks

None.

# Spec consistency

One final end-to-end review compared issue #242 and the confirmed specification with the implementation, generated assets, bilingual Skills, regression tests, and lifecycle Eval. It found and fixed the remaining gap where failed check IDs could still depend on caller input; non-passing typed required-check receipts now contribute stable Runtime-derived check IDs. The resulting behavior covers Build acceptance paging, failed/missing projection, repair-first continuation, semantic progress, third-repeat stopping, the configurable default-five contract budget, confirmed-contract reset, and the #238/#240 Archive and evidence boundaries.

# Known limitations and risks

The installed beta.9 CLI contains a stale 1 MiB scoped-check limit while its packaged Native runtime uses 5 MiB. The check was executed with that installed CLI limit temporarily aligned to its own packaged runtime and immediately restored; beta.10 source in this branch uses the supported 2 MiB limit and its generated-runtime regression tests pass.

# Conclusion

Pass.
