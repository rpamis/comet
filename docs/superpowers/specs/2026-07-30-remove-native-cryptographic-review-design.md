# Remove Native Cryptographic Review

## Goal

Remove the Native cryptographic external-review subsystem completely. A normal Native workflow must be able to pass Verify using current acceptance evidence, required checks, implementation scope, snapshot bindings, and the verification report without provisioning cryptographic identities or obtaining an external signature.

## Removed behavior

The following concepts and commands are removed without a compatibility layer:

- controller-owned review trust roots and project review trust policies;
- implementation, reviewer, and waiver-signer Ed25519 identities;
- implementation attestation and independent-review signing handoffs;
- cryptographic waiver approval;
- high-risk scope classification whose only purpose is to require signed external review;
- `trust keygen`, `trust identity`, and `trust policy`;
- `review sign`;
- `receipt implement`, `receipt review`, and `receipt waiver`;
- `implementation-attestation` and `independent-review` verification receipt kinds;
- waiver receipts and their evidence-envelope/archive fields.

Existing Native changes or persisted evidence that depend on these removed schemas are not migrated. Users must recreate the change or regenerate verification evidence with the remaining receipt model.

## Retained verification model

Verify remains fail-closed for evidence it still owns:

- every acceptance criterion must be passed by a current automated or manual receipt;
- every required check must have a current passing receipt;
- receipts remain content-addressed and bound to the current change revision, contract, scope, snapshot, and declared artifacts;
- the implementation scope must be complete;
- the verification report and typed evidence envelope remain required;
- stale, failed, skipped, blocked, malformed, or out-of-scope evidence cannot produce a passing result.

Manual evidence continues to require explicit confirmation and a named responsible party. It is not a cryptographic external approval.

## Runtime and data-model changes

The Native verification receipt union is reduced to:

- `automated-check`;
- `static-inspection`;
- `manual-evidence`.

Verification graph construction and validation no longer load a review trust policy, validate signatures, require implementation attestations, require independent-review coverage, or resolve waiver coverage. Transition and archive evidence no longer carry independent-review or waiver references.

The cryptographic review identity, signer, trust-policy, independent-review, and waiver modules are deleted when they no longer contain retained behavior. Shared receipt and verification modules are simplified in place.

The generated Native runtime is rebuilt from `domains/comet-native/`; generated assets are never edited as the source of truth.

## CLI and Skill behavior

The CLI help and dispatcher no longer expose removed commands or accept their options.

Chinese Skill content is updated first, followed by the English mirror. Both versions explain only the retained automated/manual receipt flow. External-role handoff, private-key handling, reviewer identity, trust provisioning, signed review, and waiver guidance are deleted.

## Error handling

Inputs using removed commands fail as unknown commands through the normal CLI usage path. Persisted documents containing removed fields or receipt kinds fail current-schema parsing; no legacy adapter or migration command is added.

Verify errors should describe missing or invalid acceptance/check evidence directly. It must never request a reviewer identity, review trust policy, implementation attestation, signed acceptance-applicability review, or waiver.

## Testing

Implementation follows test-driven deletion:

1. Add or rewrite focused tests proving ordinary and formerly high-risk source/Skill changes can pass without cryptographic review artifacts.
2. Assert CLI help and Skill contracts no longer expose removed commands or terminology.
3. Assert current receipt/evidence schemas reject removed kinds and fields.
4. Retain coverage for acceptance completeness, required checks, stale bindings, manual confirmation, and archive preflight.
5. Rebuild the Native runtime and run focused Native tests first.
6. Because the change crosses Runtime, CLI, generated assets, schemas, and Skill contracts, run the full test suite, lint, build, and affected-file formatting checks before delivery.

## Release behavior

This is a user-visible breaking simplification. The existing unreleased version entry above `origin/master` is updated rather than adding another version. The changelog describes the final behavior only: Native Verify no longer requires cryptographic external-review provisioning or signed review artifacts.
