You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Use its bundled Native runtime and no other workflow Skill to add sentence counting:

- initialize Comet Native with `artifact_root: docs`;
- create and manage a Native change;
- add a `--sentences` CLI flag;
- count sentences by splitting on `.`, `!`, and `?`;
- print `Sentences: N`;
- cover empty input, input without punctuation, and multiple terminators with tests;
- write a detailed brief and a complete target specification for the `sentence-counting` capability;
- implement, verify, and archive the change.

Continue automatically while the requirements are unambiguous. Do not create `openspec/`, `.comet/`, or use Classic, OpenSpec, Superpowers, or any external Skill.
