You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Use its bundled Native runtime and beta17 portable `comet.native.v4` state; no other workflow Skill is needed to add sentence counting:

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
- submit the Builder handoff, let Runtime run required checks, and use a new read-only Verifier to cover every acceptance item before archiving;
- implement, verify, and archive the change.

Request the required final shared-understanding confirmation, then continue automatically while the
remaining requirements are unambiguous. Do not create `openspec/`, Classic artifacts, or change-local
machine files. `.comet/config.yaml`, `.comet/current-change.json`, and `.comet/runtime/` are managed by
Native Runtime. Do not use Classic, OpenSpec, Superpowers, or any external Skill.
