Use `/comet-native` and the current `comet` CLI, never the compat Runtime. In this Python wordcount project, create exactly one SDK change, `sentence-counting`, to add `--sentences` (split on `.`, `!`, `?`, ignore empty segments), preserving word and line counts. Test empty input, unpunctuated input, and repeated terminators.

Use these exact five business acceptance cases when drafting the brief. With `--sentences --lines`, each case must print the listed word, line and sentence totals. The word and line totals come from the supplied baseline: verify them with the unchanged `wordcount.py --lines` before the first Shape confirmation. Do not invent different numeric examples or change baseline counting behavior.

<!-- canonical-acceptance -->

```text
[
  {{ "id": "A1", "input": "One. Two! Three?", "words": 3, "lines": 1, "sentences": 3 }},
  {{ "id": "A2", "input": "", "words": 0, "lines": 0, "sentences": 0 }},
  {{ "id": "A3", "input": "hello world", "words": 2, "lines": 1, "sentences": 1 }},
  {{ "id": "A4", "input": "Hi!!! There... Again?", "words": 3, "lines": 1, "sentences": 3 }},
  {{ "id": "A5", "input": "hello\nworld", "words": 2, "lines": 2, "sentences": 1 }}
]
```

Exercise all of these boundaries on this same candidate, not separate throwaway changes:

1. During Shape, write a detailed brief and complete sentence-counting specification. Include a `## Spec → 测试名与断言计划` Markdown table with columns `Test`, `Assertion`, `计划行号`. Initially use `planned` for line numbers. Request real Shape confirmation through the harness. During Build replace only those planned line numbers with actual test line ranges, without changing test names, assertions or requirements. This auxiliary edit must retain the approved Shape and goal cycle, not restart Shape.
2. Implement the feature and focused tests. Submit one Builder handoff with a real Runtime check plan running the tests. Include one non-repeatable check named `recovery-once`: run `python3 recovery_once.py`. That supplied script writes to ignored `.cache/comet-sdk-recovery/check-count` and rejects a second execution. Do not edit the script or counter. All check commands must run from the project root, with the same explicit PATH across shell sessions.
3. Exercise a genuine unavailable-verifier boundary: the first verifier execution must report `blocked`, with every acceptance item honestly marked blocked because that execution intentionally has no independent review. Do not report a fake failure or pass. Save no invented Runtime state and do not modify the candidate after checks. End the turn with exactly `COMET_SDK_RECOVERY_READY` while the change awaits recovery. The harness starts a fresh model session.
4. In that new session inspect the existing SDK change and follow the exact `resolve-verifier-blocker` continuation with the user's harness reply. Do not choose revise-implementation, revise-requirements, recreate the change or rerun checks. Use a new independent read-only verifier, distinct from the Builder and blocked execution. Execute its Runtime-provided context command in a separate shell process with the same PATH and project root as the checks. Independently verify every acceptance item on the retained candidate, then submit the real result.
5. Follow required acceptance/Archive confirmations and complete Archive and delivery. Inspect the completed SDK Run. Preserve the original Builder handoff and check outcome, with exactly one `verify.checks` execution and one recovery-once count. Do not hand-author checkpoints, owner files, approval records, Runtime output or reports. All SDK state must come from current CLI execution.
