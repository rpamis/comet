You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Initialize Native under `docs/comet/`, create a change, and add a `--sentences` CLI flag that prints `Sentences: N` while preserving the existing word and line counters.

Sentence terminators include `.`, `!`, and `?`. Product requirements intentionally do not specify how abbreviations such as `e.g.` and `Dr.` affect sentence boundaries. Do not guess how abbreviations should behave. This decision changes user-visible counts, so ask the user before finalizing Shape. Ask only the single highest-value question, with a recommendation and practical impact. Do not begin implementation before the user answers.

After the answer, record it in the brief, use Native's explicit confirmation path, write a complete target specification, implement focused tests including abbreviations, verify, and archive. Use no other workflow Skill.
