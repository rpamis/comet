You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Initialize Native under `docs/comet/`, create one change named `add-unique-counting`, and add a `--unique-words` flag that prints `Unique words: N` while preserving existing word and line behavior.

Follow Native's Shape requirements before Build. Do not ask for repository facts or implementation choices.

If the user supplies a product decision, record it in the brief, use Native's explicit confirmation path, write a complete target specification for capability `unique-word-counting`, and transition to Build. Then end that turn with exactly `COMET_NATIVE_COLD_RESUME_READY` without implementing the feature. The harness will start a new session containing only a continuation request. In that fresh session, recover the same change from Native state and artifacts on disk, save the runtime's exact JSON status output to `.cache/comet-native-eval/resume-status.json`, then implement focused tests and verify. Save the exact ready Archive dry-run as `.cache/comet-native-eval/archive-preview.json`, commit with `--expect-preflight` using that exact hash, and save the exact successful envelope as `.cache/comet-native-eval/archive-commit.json`.

Do not fabricate, paraphrase, or hand-author runtime JSON evidence. Use only the Comet Native Skill and its bundled runtime; do not create OpenSpec, Classic, `.comet`, or external workflow artifacts.
