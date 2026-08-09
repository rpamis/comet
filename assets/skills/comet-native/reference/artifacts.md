# Native Artifact Reference

Read this file only when editing the brief or complete target specifications, or viewing the Runtime-generated acceptance report.

## Editing boundary

Each active change directory contains only user-readable formal artifacts that can travel through Git:

```text
<artifact-root>/comet/changes/<change-name>/
  comet-state.yaml
  brief.md
  specs/<capability>/spec.md
  verification.md
```

The Agent edits only the brief and complete target specifications. Runtime manages `comet-state.yaml` and `verification.md`; the report may be absent before the first valid Verify.

Local Runtime lives under the Git-ignored `.comet/runtime/native/`. Each active change uses only `changes/<change-name>/state.json` and `logs/`; project-level locks and short-lived transactions live under the same Runtime root. Do not create, migrate, or repair these files manually.

## Portable state and report

`comet-state.yaml` is the portable semantic authority at stable workflow boundaries. It stores phase, status, state version, Loop counters, acceptance results, Builder handoff, blockers, next action, check summaries, and compact history. It does not store local processes, absolute paths, or complete command output, and the Agent must not edit it.

`verification.md` is the human-readable projection Runtime generates from the same YAML state version. When the report is missing or behind, regenerate only the report without rerunning checks or the Verifier; Markdown body text cannot advance machine state.

`.comet/config.yaml` selects the workflow and artifact root. Synchronize it for cross-device discovery of a non-default root; every other `.comet/*` path remains local-only.

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

Acceptance criteria must be specific, observable, and non-duplicated. Use simple sequential IDs such as `A1`, `A2`, and `A3`; an ID only maps results, is not calculated from content, and does not identify a file. Runtime stores each full item and its source when Shape is confirmed.

## Complete target specifications

Each `specs/<capability>/spec.md` describes the capability's complete behavior after Archive, not an incremental patch:

- new capability: write a complete specification;
- existing capability: write the complete modified specification;
- removed capability: use CLI `spec remove`, not only file deletion.

On canonical conflict, reread the latest specification, rewrite the complete target according to user intent, and use the Runtime-provided rebase action. Do not edit operations or state.

## Verification

Runtime generates `verification.md` with this recommended structure:

```text
# Verification
## Current result
## Acceptance
## Checks
## Blockers
## Risks and skipped work
## Previous iterations
## Conclusion
```

The report shows every acceptance result and reason, redacted command previews and statuses for real checks, blockers, risks, and compact Loop history. Complete stdout and stderr remain only in local logs.

Do not handwrite or patch the report to change a conclusion. Failed, blocked, unrun, or timed-out work cannot appear as passed; only complete acceptance decisions and successful required checks for the current candidate in YAML can produce a final pass.
