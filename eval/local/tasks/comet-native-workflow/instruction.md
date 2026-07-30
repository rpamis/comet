You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Use its bundled Native runtime and no other workflow Skill to add sentence counting:

- initialize Comet Native with `artifact_root: docs`, automatic archive confirmation, and
  `max_verify_failures: 5`;
- create `sentence-counting` directly;
- create and manage a Native change;
- add a `--sentences` CLI flag;
- count sentences by splitting on `.`, `!`, and `?`;
- print `Sentences: N`;
- cover empty input, input without punctuation, and multiple terminators with tests;
- write a detailed brief and a complete target specification for the `sentence-counting` capability;
- exercise the completion loop before the final candidate: submit one honest failed Verify report
  that omits at least one acceptance entry, confirm from Build `status --details` that Runtime
  projects the omitted item as `missing` and returns `work-phase`, then implement or evidence the
  remaining gap and continue to the final Verify;
- issue current typed acceptance and required-check receipts before archiving the change;
- implement, verify, and archive the change.

Continue automatically while the requirements are unambiguous. Do not create `openspec/` or any
hidden `.comet/` workflow artifact beyond `config.yaml`. Do not use Classic, OpenSpec,
Superpowers, or any external Skill.
