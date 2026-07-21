You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Initialize Native under `docs/comet/`, create one change named `add-sentence-counting`, and add a `--sentences` CLI flag that prints `Sentences: N` while preserving the existing word and line counters.

Before Shape is complete, resolve these three independent product decisions with the user:

1. Whether abbreviations such as `e.g.` and `Dr.` end a sentence.
2. What sentence count empty input should print.
3. Whether consecutive terminators such as `?!` count as one boundary or multiple boundaries.

These decisions do not depend on one another, and the repository does not determine them. Follow the `native.clarification_mode` already selected by the treatment. Do not choose the clarification mode yourself or change it. Give a recommendation and practical impact for every question, persist all answers in the brief and complete target specification, and satisfy any confirmation required by the configured mode before implementation.

After clarification, write a complete target specification using Native's `## Requirement:` and `### Scenario:` structure. Then implement focused tests for all three decisions, verify the result, and archive the change. Use no other workflow Skill.
