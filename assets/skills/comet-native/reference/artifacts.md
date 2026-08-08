# Native Artifact Reference

Read this file only when editing the brief, complete target specifications, verification, or acceptance evidence.

## Editing boundary

Each active change directory contains only user-readable formal artifacts that can travel through Git:

```text
<artifact-root>/comet/changes/<change-name>/
  comet-state.yaml
  brief.md
  specs/<capability>/spec.md
  verification.md
  evidence.md
```

The Agent edits only the brief, complete target specifications, and verification. Runtime manages `comet-state.yaml` and `evidence.md`. Files that have not yet been generated may be absent.

Machine Runtime lives under the project-local, Git-ignored `.comet/runtime/native/`: per-change baseline, workspace, Run, trajectory, scope, receipts, and checkpoints live under `changes/<change-name>/`; global locks and transactions live under `locks/` and `transactions/`. Only `.comet/config.yaml` selects the artifact root, and it does not relocate machine Runtime. Do not migrate or repair Runtime files manually.

## Evidence projection

After every evidence-bearing transition (entering or leaving Build, Verify), the Runtime regenerates a read-only, human-readable projection at the change root:

```text
<artifact-root>/comet/changes/<change-name>/evidence.md
```

It translates the hash-named, content-addressed evidence in project-local Runtime into readable text — implementation scope (which files changed, byte deltas), verification outcome (acceptance pass/fail, coverage totals), and check receipts (command, exit code, summary). Open it when debugging or inspecting a change instead of parsing machine files.

The projection is a read-only derivative: the Runtime overwrites it on every transition, it must not be hand-edited, and it must never be cited as verification evidence. Machine references in state keep the stable logical `runtime/...` form regardless of physical storage.

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
