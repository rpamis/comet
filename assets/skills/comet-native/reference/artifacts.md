# Native Artifact Reference

Read this file only when editing the brief, complete target specifications, verification report, or acceptance evidence.

## Artifact boundary

The Agent primarily edits:

```text
<artifact-root>/comet/changes/<change-name>/
  brief.md
  specs/<capability>/spec.md
  verification.md
```

Project configuration, current selection, and change state are read inputs. Do not manually change Runtime-managed phase, confirmation, specification operations, scope, evidence, checkpoints, locks, or transaction fields.

The Native artifact root is selected only by `.comet/config.yaml`. Do not scan another workflow's directories or create a second state root.

## Scope snapshot boundaries

Git snapshots contain tracked and non-ignored untracked files, with each submodule/gitlink treated atomically. Non-Git projects use a bounded physical-tree snapshot.

- `git-selection-changed`: wait until Git writes are stable, then retry. It cannot be authorized as partial scope.
- `physical-selection-changed` or `physical-enumeration-limit`: wait for a stable filesystem or reduce the project tree, then retry. Neither can be authorized as partial scope.
- When scope details exceed the budget, the Runtime reports a `scope-detail-overflow` count and content hash instead of guessing omitted paths. Do not edit evidence or treat an incomplete snapshot as complete.

## Project configuration

Configuration that directly affects Agent behavior:

```yaml
native:
  artifact_root: docs
  language: en
  clarification_mode: sequential
  archive_confirmation: automatic
  max_verify_failures: 5
```

- `clarification_mode`: `sequential` or `batch`.
- `archive_confirmation`: `automatic` or `required`.
- `max_verify_failures`: total Verify-fail submissions allowed for one confirmed contract.

Missing fields default to `sequential`, `automatic`, and `5`. Configuration changes do not keep old evidence fresh or clear existing blockers automatically.

## Brief

`brief.md` uses these level-one headings:

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

Outcome, Scope, Non-goals, and Acceptance examples must contain substantive content.

Blocking items in Open questions use these fixed forms:

```text
- [blocking] <current Sequential question>
- [blocking] Q1: <question>
- [blocking] CONFIRM: <final shared understanding>
```

Keep unanswered or ambiguous questions. After the user confirms a decision, write it into Decisions and the complete target specifications before removing its blocker. Do not preserve hidden reasoning.

## Complete target specifications

Write specifications at:

```text
changes/<change-name>/specs/<capability>/spec.md
```

Each file describes the complete capability behavior after Archive, not an incremental patch against old text.

- New capability: write the complete specification.
- Existing capability: write the complete replacement specification.
- Removed capability: run `comet native spec remove`; do not only delete the file.

The Runtime records create, replace, remove, and the canonical baseline. On a canonical conflict, reread and rewrite the complete target specification before using `spec rebase`. Do not edit Runtime state or hashes manually.

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

Record real commands, results, and reviewable facts. Put checks that did not run under Skipped checks. A failing result cannot be reported as pass.

## Acceptance evidence

Use acceptance IDs returned by the Runtime; do not calculate them. Prepare the entries array, then run:

```text
comet native evidence format [--entries <path>]
```

Place the command output unchanged under `# Acceptance evidence`. The basic input shape is:

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
  },
  {
    "acceptance_id": "acceptance-<sha256>",
    "status": "waived",
    "evidence_refs": [],
    "waiver_ref": "runtime/evidence/waivers/<sha256>.json"
  }
]
```

- `passed` references a currently valid typed receipt.
- `failed` states the actual failure or skipped reason.
- `waived` references the waiver returned by an external signer.

Do not hand-format the machine block, reuse an evidence ref from another change, or report failed, skipped, or blocked results as passed.
