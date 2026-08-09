You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Initialize Native under `docs/comet/`, create a change, and add a `--paragraphs` flag that prints `Paragraphs: N` while preserving existing word and line counts.

The exact paragraph-boundary rule is already documented somewhere in this repository. Investigate the repository and use that fact; do not ask the user to repeat repository facts or choose an implementation method. Write a detailed brief and a complete `paragraph-counting` target specification, implement focused tests, submit the Builder handoff, let a read-only Verifier check all acceptance items, and archive the passing v4 change.

Use only the Comet Native Skill and bundled runtime. Do not create OpenSpec, Classic, or change-local machine artifacts. `.comet/config.yaml`, `.comet/current-change.json`, and `.comet/runtime/` are Runtime-owned.
