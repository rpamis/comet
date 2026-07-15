# Native artifact reference

## Layout

```text
<project>/comet.config.yaml
<artifact-root>/comet/
  specs/<capability>/spec.md
  changes/<change-name>/
    change.yaml
    brief.md
    specs/
    verification.md
    runtime/
  archive/YYYY-MM-DD-<change-name>/
  runtime/
    current-change.json
    locks/
    transactions/
```

Project configuration names the single artifact root. Native does not use a hidden change directory and never discovers state from other requirements directories.

## Project configuration

```yaml
schema: comet.project.v1
default_workflow: native
native:
  artifact_root: docs
```

During an artifact-root move, the runtime-managed `pending_root_move` field is present. Ordinary write commands must stop while it exists; never choose the old or new root yourself.

## Change state

```yaml
schema: comet.native.v1
name: add-sentence-counting
language: en
phase: shape
brief: brief.md
approval: null
spec_changes:
  - capability: sentence-counting
    operation: create
    source: specs/sentence-counting/spec.md
    base_hash: null
verification_result: pending
verification_report: null
archived: false
created_at: 2026-07-14
run_id: null
```

Do not edit runtime-managed fields directly. The runtime owns `approval`, `spec_changes`, operation, and `base_hash`. To change requirements, edit only the brief and `specs/<capability>/spec.md`; remove a capability with `comet native spec remove`, then let the command validate and advance the state.

## Brief

`brief.md` uses exactly eight level-one headings:

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

The first four sections require substantive content. Prefix unresolved implementation-blocking questions under Open questions with `- [blocking]`; ordinary notes do not block Shape.

## Complete target specifications

A proposed specification lives at `changes/<change-name>/specs/<capability>/spec.md` and describes the complete behavior the capability should have after archive, rather than an incremental fragment meaningful only against old text. Each capability has exactly one operation:

| operation | canonical state | source | base_hash |
| --- | --- | --- | --- |
| `create` | Must not exist | Required | `null` |
| `replace` | Must exist | Required | SHA-256 of the current canonical file |
| `remove` | Must exist | Forbidden | SHA-256 of the current canonical file |

On first discovery, `next` infers create/replace and freezes its hash; `spec remove` freezes the remove hash. Archive recalculates hashes while holding the lock. When the actual value differs from `base_hash`, re-read and rewrite the complete target specification, then use `spec rebase` to refresh the baseline under runtime control, return to Build, and verify again. Never overwrite the concurrent change or edit the hash manually.

## Verification

`verification.md` uses six non-empty level-one headings:

```text
# Acceptance evidence
# Commands and results
# Skipped checks
# Spec consistency
# Known limitations and risks
# Conclusion
```

Persist reviewable facts, not hidden reasoning. Put unrun checks under Skipped checks, and never describe a failed result as pass.
