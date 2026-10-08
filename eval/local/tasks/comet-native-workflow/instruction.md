You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Use the current-checkout Comet CLI and SDK-backed Native Runtime; no other workflow Skill is needed to add sentence counting. The public `comet.native.v4` state remains, but the change must be owned by an SDK Run. Confirm this with `comet runtime dispatch --application native` inspection before completion:

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
  with at least one unresolved acceptance item, then confirm from Build `status --details` that
  Runtime projects that item as `failed`, sets `loop.stage` to `repairing`, and offers
  `build.builder` as the next Action. Repair the gap and continue to a passing Verify;
- submit the Builder handoff, let Runtime run required checks, and use a new read-only Verifier to cover every acceptance item before archiving;
- implement, verify, and archive the change.

Before requesting Shape confirmation, run the supplied CLI on every concrete input proposed in your
acceptance examples, using its existing word and line options. Record the observed word and line counts
so preservation requirements match the baseline; derive the new sentence counts from the stated splitting
rules. Resolve contradictory examples before confirmation. Keep the required failed Verify and repair
exercise; checking the baseline does not replace implementation checks or independent verification.

Request the required final shared-understanding confirmation, then continue automatically while the
remaining requirements are unambiguous. Do not create `openspec/`, Classic artifacts, or change-local
machine files. `.comet/config.yaml`, `.comet/current-change.json`, and `.comet/runtime/` are managed by
Native Runtime. Do not use Classic, OpenSpec, Superpowers, or any external Skill.
