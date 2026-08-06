# Native Artifact Reference

Read this file only when editing the brief, complete target specifications, verification, or acceptance evidence.

## Editing boundary

The Agent primarily edits:

```text
<artifact-root>/comet/changes/<change-name>/
  brief.md
  specs/<capability>/spec.md
  verification.md
```

Only `.comet/config.yaml` selects the artifact root. Runtime state, workspace, scope, evidence, checkpoints, locks, and transactions are read-only; do not migrate or repair them manually.

## Brief

`brief.md` uses these non-empty level-one headings:

```text
# Outcome
# Scope
# Non-goals
# Acceptance examples
# Constraints and invariants
# Decisions
# Open questions
# Verification expectations
```

Only real unresolved user questions use these forms under Open questions:

```text
- [blocking] <current Sequential question>
- [blocking] Q1: <Batch question>
- [blocking] CONFIRM: <final shared understanding>
```

After each decision is confirmed, write it immediately into Decisions and complete target specifications before removing the blocker. Do not store hidden reasoning.

## Complete target specifications

Each `specs/<capability>/spec.md` describes the capability's complete behavior after Archive, not an incremental patch:

- new capability: write a complete specification;
- existing capability: write the complete replacement;
- removed capability: use CLI `spec remove`, not only file deletion.

On canonical conflict, reread the latest specification, rewrite the complete target according to user intent, and use the Runtime-provided rebase action. Do not edit operations, base hashes, or state.

## Verification

`verification.md` uses these non-empty level-one headings:

```text
# Acceptance evidence
# Commands and results
# Skipped checks
# Spec consistency
# Known limitations and risks
# Conclusion
```

Record actual commands, results, and reviewable facts. Put unrun checks under Skipped checks. Failed, skipped, blocked, or timed-out results cannot be reported as passed.

## Acceptance evidence

Use Runtime-provided acceptance IDs and receipt refs; do not calculate IDs or reuse evidence across changes. Prepare a JSON entries array, run `evidence format`, and place its machine block unchanged under `# Acceptance evidence`.

Basic entries:

```json
[
  {
    "acceptance_id": "acceptance-<sha256>",
    "status": "passed",
    "evidence_refs": ["runtime/evidence/receipts/<sha256>.json"]
  },
  {
    "acceptance_id": "acceptance-<sha256>",
    "status": "failed",
    "evidence_refs": [],
    "skipped_reason": "actual failure or incomplete reason"
  }
]
```

Do not hand-format the machine block. Every receipt must represent a real execution or observation and bind to the current revision, contract, scope, snapshot, and artifacts.
