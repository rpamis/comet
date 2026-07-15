You are working on a Python project named `wordcount-cli` after another process stopped during a Comet Native phase transition.

Begin by invoking the `/comet-native` Skill. Inspect `status` and `doctor`, recover the existing `add-character-counting` change through the Native runtime, and do not create a replacement change or hand-edit runtime-owned state.

After recovery, add a `--characters` flag that prints `Characters: N`, counting every input character including whitespace and newlines. Preserve word and line behavior, add focused tests, complete Build and Verify with real evidence, and archive the existing complete target specification.

Use only the Comet Native Skill and bundled runtime. Do not create OpenSpec, Classic, `.comet`, or external workflow artifacts.
