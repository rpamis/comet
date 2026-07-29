You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Use its bundled Native runtime and no other workflow Skill to add sentence counting:

- initialize Comet Native with `artifact_root: docs`, automatic archive confirmation, and
  `max_verify_failures: 5`;
- consume the controller-owned fixture at
  `/workspace/_eval_trusted_oracles/native-review-fixture.json`: the public review policy and
  external controller trust are already installed read-only, and the fixture names the
  external-verifier client;
- create `sentence-counting` directly. Do not run `trust keygen` or `trust policy`, and do not
  inspect or copy any controller/reviewer/waiver private material;
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
- issue typed acceptance and required-check receipts, a signed implementation attestation, and
  an independent signed acceptance-applicability review before archiving the change. Invoke the
  fixture's external-verifier client first with role `implementation` and the change name. After
  the verification report and typed receipts exist, invoke it with role `reviewer`, the change
  name, the implementation receipt/report/required-check/high-risk receipt refs, and one
  `--attest-manual <ref>` for every manual receipt in the review graph. The external verifier
  independently rebuilds and replays the review, while a separate signer sidecar with no
  workspace mount returns only detached proofs;
- implement, verify, and archive the change.

Continue automatically while the requirements are unambiguous. Do not create `openspec/` or any
hidden `.comet/` workflow artifact beyond `config.yaml` and the public review trust policy. Do not
use Classic, OpenSpec, Superpowers, or any external Skill.
