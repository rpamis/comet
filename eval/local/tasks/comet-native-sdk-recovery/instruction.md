Use `/comet-native` and the current `comet` CLI, never the compat Runtime. In this Python wordcount project, create exactly one SDK change, `sentence-counting`, to add `--sentences` (split on `.`, `!`, `?`, ignore empty segments), preserving word and line counts. Test empty input, unpunctuated input, and repeated terminators.

Use capability `sentence-counting`. Author its change specification at `docs/comet/changes/sentence-counting/specs/sentence-counting/spec.md`; Archive must publish the canonical specification at `docs/comet/specs/sentence-counting/spec.md`.

## Execution discipline

After invoking the required Skill, the first workflow command in this fresh fixture can be `comet native new sentence-counting --project-root /workspace --json`. Follow its actual continuation. Do not probe absent project state, repeat initialization, search bundled JavaScript, or collect command help when the current response already supplies the required command, paths and request templates.

Read independent small source, test and reference files together. Within one phase, batch already authorized shell operations in one tool call, keeping CLI operations sequential and stopping on an error or a decision that needs a new user reply. A small temporary Python helper may call the public CLI, parse its complete JSON stdout and carry the exact latest response into the next request. Keep stderr separate; do not truncate JSON with `head`, search for its first brace, reconstruct stale action identities, or edit Runtime-owned files.

Each independent verifier still receives its own real execution reference, retrieves its own context and checks every acceptance item. The controlled blocked execution must honestly report blocked without performing an independent review; it must not spend time re-reading implementation or running acceptance tests that it cannot independently assess. Preserve all recovery and approval boundaries below.

In the Builder check plan, `executable` is separate from `argv`: never repeat the executable as the first argument. For example, the one-shot check uses `executable: "python3"`, `argv: ["recovery_once.py"]`, `cwdRef: "."`, `repeatable: false`; the test check uses `executable: "python3"`, `argv: ["-m", "pytest", "-q"]`, `cwdRef: "."`. Apply the same explicit PATH to both. Confirm this command shape before submitting the single Builder handoff: a failed check followed by a replacement handoff still violates this task's original-check uniqueness requirement, even if the script did not run.

After the requested SDK Run is completed and its Archive and authorized delivery are actually verified, report completion and stop. This isolated core-workflow task does not request optional memory or knowledge learning, indexing, daemon setup, extra features or additional workflow runs. Do not perform those after-completion operations.

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

For temporary JSON request, context and result files, use Python `tempfile.TemporaryDirectory()` or remove only the precisely named files before `rmdir`. The fixed safety check rejects `rm -rf`, `git reset --hard` and downloading scripts into a shell, including during temporary-file cleanup. Do not use those commands. This does not replace any recovery, approval, isolation or one-shot check requirement below.

1. During Shape, write a detailed brief and complete sentence-counting specification. Include in the brief a `## Spec → 测试名与断言计划` Markdown table with columns `Test`, `Assertion`, `计划行号`. Initially use `planned` for line numbers. Request real Shape confirmation through the harness. During Build replace only those planned line numbers with numeric line ranges such as `28-32`; do not put filenames or paths in that column. Record test filenames outside the line-number cells before Shape confirmation. Keep test names, assertions and requirements unchanged. This auxiliary edit must retain the approved Shape and goal cycle, not restart Shape.
2. Implement the feature and focused tests. Submit one Builder handoff with a real Runtime check plan running the tests. Include one non-repeatable check named `recovery-once`: run `python3 recovery_once.py`. That supplied script writes to ignored `.cache/comet-sdk-recovery/check-count` and rejects a second execution. Do not edit the script or counter. All check commands must run from the project root, with the same explicit PATH across shell sessions.
3. Exercise a genuine unavailable-verifier boundary. Start a separate read-only execution for this controlled no-review scenario before claiming `verify.verifier`. Use that execution's actual platform task or agent reference in `claimRequest.sessionId`; never use the Builder's session. If the receiver cannot discover its own session ID, the dispatcher may supply the actual reference returned by the platform, without inventing one. This execution must report `blocked`, with every acceptance item honestly marked blocked because it intentionally has no independent review. Do not report a fake failure or pass. Save no invented Runtime state and do not modify the candidate after checks. End the turn with exactly `COMET_SDK_RECOVERY_READY` while the change awaits recovery. The harness starts a fresh model session.
4. In that new session inspect the existing SDK change and follow the exact `resolve-verifier-blocker` continuation with the user's harness reply. Do not choose revise-implementation, revise-requirements, recreate the change or rerun checks. Use a new independent read-only verifier, distinct from the Builder and blocked execution. Execute its Runtime-provided context command in a separate shell process with the same PATH and project root as the checks. Independently verify every acceptance item on the retained candidate, then submit the real result.
5. Follow required acceptance/Archive confirmations and complete Archive and delivery. Inspect the completed SDK Run. Preserve the original Builder handoff and check outcome, with exactly one `verify.checks` execution and one recovery-once count. Do not hand-author checkpoints, owner files, approval records, Runtime output or reports. All SDK state must come from current CLI execution.
