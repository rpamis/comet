# Native artifact reference

## Layout

```text
<project>/.comet/config.yaml
<project>/.comet/current-change.json       # Shared Native/Classic current owner selection
<artifact-root>/comet/
  specs/<capability>/spec.md
  changes/<change-name>/
    comet-state.yaml
    brief.md
    specs/
    verification.md
    runtime/
      baseline-manifest.json
      workspace.json                 # Process-free physical root identity; advisory only
      run-state.json                 # Read and written through Native Protected Run I/O
      trajectory.jsonl               # Event-count, per-event, and total-byte budgets
      pending-action.json            # Optional; present only when the Run has pending work
      context.md                     # Optional; Run context ref
      artifacts.json                 # Optional; Run artifact refs
      transition.json                # Optional; incomplete phase-transition journal
      checkpoint-journal.json        # Optional; incomplete progress-checkpoint journal
      checkpoints/
        latest.json                  # Most recent phase-boundary checkpoint
        progress.json
        manifests/<sha256>.json
      evidence/
        scopes/<sha256>.json
        snapshots/<sha256>.json
        allowances/<sha256>.json
        verifications/<sha256>.json
        check-receipts/<sha256>.json
  archive/YYYY-MM-DD-<change-name>/
  runtime/
    locks/
    transactions/<transaction-id>/
      transaction.json
      events.jsonl
```

Project configuration names the single `artifact-root`. Native does not use a hidden change directory and never discovers state from other requirements directories. The project-level `.comet/config.yaml` is the persistent-configuration exception. During interrupted `root move` recovery, runtime-managed staging or quarantine directories may also appear beside the source or target artifact root; the transaction removes them when it settles. They are not a second writable Native change root.

## Project configuration

```yaml
schema: comet.project.v1
default_workflow: native
workflows:
  - native
native:
  artifact_root: docs
  language: en
  clarification_mode: sequential
```

`clarification_mode` controls how Native organizes user decisions and which confirmation contract applies before leaving Shape. `sequential` asks one most-upstream question per round, while `batch` asks every question whose prerequisites are settled. The default is `sequential` when the field is absent. It does not change the change schema, lifecycle, safety confirmations, or caller-defined stop points.

During an artifact-root move, the runtime-managed `pending_root_move` field is present. Ordinary write commands must stop while it exists; never choose the old or new root yourself.

## Current request ownership

```json
{
  "schema": "comet.selection.v2",
  "workflow": "native",
  "change": "add-sentence-counting",
  "branch": null
}
```

`.comet/current-change.json` is the current-request selection shared by Native and Classic, not a Native change artifact. Native `new` and `select` write `workflow: native`; the Hook Router then sends each write to only that workflow's Guard. Without a selection, read-only ownership can be inferred only when exactly one active Comet change exists across the project. Multiple candidates, stale selections, and archived targets fail closed.

Project configuration is capped at 64 KiB, selection at 16 KiB, and change YAML at 256 KiB. The brief and each proposed specification are capped at 1 MiB. A change may contain at most 64 proposed specifications, and contract reads across the brief and specifications are capped at 4 MiB. The proposed-spec directory also has an entry budget, and the serialized `show` payload is capped at 10 MiB. On overflow, the runtime preserves the source and fails closed instead of silently truncating complete requirements.

## Change state

```yaml
schema: comet.native.v3
minimum_runtime_version: 3
revision: 1
name: add-sentence-counting
language: en
phase: shape
brief: brief.md
approval: null
approved_contract_hash: null
spec_changes:
  - capability: sentence-counting
    operation: create
    source: specs/sentence-counting/spec.md
    base_hash: null
verification_result: pending
verification_report: null
implementation_scope: null
verification_evidence: null
partial_allowance: null
archived: false
created_at: 2026-07-14
run_id: null
```

Do not edit Runtime-managed fields directly. The Runtime owns `phase`, `revision`, `approval`, `approved_contract_hash`, `spec_changes`, operation, `base_hash`, all three evidence refs, `run_id`, and `archived`.

`approved_contract_hash` binds approval to the brief/spec contract from that moment. Later contract drift requires fresh user confirmation. To change requirements, edit only the brief and `specs/<capability>/spec.md`; remove a capability with `comet native spec remove`, then let the command validate and advance state.

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

In Sequential mode, Open questions holds one most-upstream blocking question at a time. In Batch mode, persist the current ready question set as `- [blocking] Q1: <question>`, `- [blocking] Q2: <question>`, and so on. This unordered-list prefix is the fixed form recognized by the Runtime and must not be replaced with a Markdown ordered list. Unanswered items remain `[blocking]`. After all questions for the current mode are resolved and the completeness review passes, both modes persist the shared-understanding confirmation as `- [blocking] CONFIRM: <confirmation>`. Build cannot begin before explicit confirmation.

Question numbers apply only to the current clarification round. Write confirmed answers into Decisions and the complete target specifications. Do not add a decision-tree artifact or persist hidden reasoning in the brief.

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

The runtime derives at most 1024 acceptance items from the brief and proposed specifications. It rejects overflow rather than first creating an unbounded list and truncating it. Each `acceptancePage` contains at most 16 items. Text is capped at 512 UTF-8 bytes, context at four entries of at most 256 bytes each, and a full page at 32 KiB. Text or context truncation is marked explicitly, while acceptance IDs are never lost to paging or truncation. Cursors bind to the current acceptance hash and fail after the contract changes.

`# Acceptance evidence` must contain exactly one fixed machine block. The runtime derives IDs from the brief/specifications and returns them through Build or `status --details`; never calculate or rewrite them yourself:

```text
<!-- comet-native:acceptance-evidence:start -->
[
  {
    "acceptance_id": "acceptance-<sha256>",
    "evidence_refs": [
      "src/feature.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-<sha256>",
    "evidence_refs": [],
    "skipped_reason": "This platform is currently unavailable."
  }
]
<!-- comet-native:acceptance-evidence:end -->
```

The array is sorted by `acceptance_id`, and every `evidence_refs` list is sorted. Each item chooses exactly one path: at least one project-relative evidence ref, or an empty array plus a non-empty `skipped_reason`. Never provide both evidence and a skip reason, and never reference an absolute path, a path outside Native, `.git`, or `.env*`.

## Content-addressed evidence

- `baseline-manifest.json`: a bounded project snapshot captured when the change is created. It records only project-relative paths, sizes, hashes, the capture provider, and omission facts, never file contents. The Git provider includes tracked and non-ignored untracked files and treats each submodule/gitlink as an atomic entry; non-Git projects use a bounded physical-tree provider with before/after enumeration fences. If project-owned entries are still omitted, `new` fails and removes the unfinished change.
  - `git-selection-changed`: wait until Git writes settle and retry. It cannot be authorized as partial scope.
  - `git-enumeration-limit`: first reduce or clean the project-owned universe. Use the partial protocol with the exact hash, a reason, and `--confirmed` only when a current snapshot returns an authorizable scope and the user accepts the specific unknown-tail risk.
  - `physical-selection-changed` and `physical-enumeration-limit`: stabilize or reduce the project tree and retry. Neither can be authorized as partial scope.
  - Never edit evidence or guess unenumerated paths.
- `evidence/scopes/`: implementation scope derived from the baseline, current snapshot, declared artifacts, and contract when leaving Build. An incomplete current snapshot never guesses deletions. When changes exceed the detail budget, only bounded details are expanded and the remainder is represented by a `scope-detail-overflow` count and content hash. The runtime stops when scope is incomplete; it creates an `allowances/` record only after explicit user acceptance.
- `evidence/verifications/`: the Verify conclusion envelope, bound to runtime identity, change revision, contract, acceptance coverage, scope, report hash, and an optional check receipt. Any bound fact change makes it stale.
- `evidence/check-receipts/`: built-in policy results from `comet native check`. A receipt records only policy/version, scope/snapshot binding, bounded issues, and counts. It stores no file contents and does not prove test completeness.
- `checkpoints/`: in-phase recovery summaries and manifests of real artifacts. A checkpoint increments revision without changing phase and cannot replace the brief, specifications, scope, or verification.

The runtime writes every hash ref and recomputes it when reading. Never copy old refs into new state, hand-edit JSON, or treat a receipt as a pass; `next`, status, and Archive reread it and check freshness.

Evidence retention is an explicit doctor capability and never deletes files in the background during normal workflow. Read-only doctor reports candidates. `doctor --repair` removes only active-change snapshots, scopes, allowances, verifications, and check receipts that are at least 30 days old, are outside the latest 32 items of their evidence kind, and are proven unreferenced from current state refs and the dependency closure.

Candidates are ordered dependents before dependencies. After parent-chain and identity checks, each file is renamed into a unique same-directory `.gc` quarantine, checked again, then removed. A later doctor detects interrupted quarantine; explicit repair restores without overwrite only when the original path is absent and content and identity remain valid.

Cleanup is deferred or rejected for source/quarantine conflicts, multiple quarantines, archived changes, pending transitions or checkpoints, missing dependencies, damaged documents, unknown directory entries, symlinks, or other special files. Retention is not a way to repair damaged evidence.

Build and Verify use inspect-then-persist. They compute and validate the contract, scope, acceptance, repair, Run, and trajectory first, then write final evidence refs into state and transition. A partial Build may content-address a candidate scope so it can return a stable hash, but it creates no allowance and does not advance without confirmation. A Verify blocked by a later check leaves no verification evidence that could be mistaken for a committed conclusion.

Run state, trajectory, checkpoint, pending action, context, and artifact refs may be accessed only through Native Protected Run I/O. Reads reject symlinks/junctions, non-regular files, changed path or file identity, and boundary escape, with before/after-open validation. Writes revalidate parent chains and target identity before atomic commit. Current budgets are: Run state 256 KiB; trajectory 8 MiB, 4096 events, and 256 KiB per event; checkpoint and pending action 256 KiB each; context and artifact refs 1 MiB each. Generic Engine storage helpers are not the Native file boundary.

The phase-transition journal is capped at 512 KiB and the baseline manifest at 8 MiB. Archive/root-move transaction journals are capped at 256 KiB; `events.jsonl` at 1 MiB and 1024 events, with 16 KiB per event. Summaries, no-code reasons, partial reasons, repair-override summaries, and skip reasons are length-checked and screened for credential-like content before persistence. Never write tokens, passwords, private keys, or connection strings as workflow evidence.
