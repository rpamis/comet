# Native Command Reference

Read this file only when you need options not listed by the main Skill, receipts, partial scope, an external-role handoff, or recovery commands.

## Project and change

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
comet native root show
comet native root move <artifact-root>

comet native new <change-name> [--language en|zh-CN]
comet native list [--cursor <token>]
comet native show <change-name>
comet native status [--cursor <token>]
comet native status <change-name> [--details [--acceptance-cursor <token>]]
comet native select <change-name>
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
```

`artifact-root` is project-relative. `new` creates default configuration and `<project>/docs/comet/` when configuration is absent. Use `root move` to migrate an existing root; do not edit configuration directly.

`status` and `show` are read-only. `new` and `select` establish the current Native selection. Ask the user when multiple candidates cannot be resolved uniquely.

`status <change-name> --details` returns detailed findings and an acceptance page:

- when `findingsTruncated` is true, handle the returned findings and read details again;
- when `acceptancePage.nextCursor` is non-null, continue with `--acceptance-cursor`;
- when a change collection has a non-null `nextCursor`, continue with `--cursor`.

When concurrent canonical changes cause a conflict, reread and rewrite the complete target specification before running `spec rebase`. Do not edit operations or hashes manually.

## Checkpoints and checks

```text
comet native checkpoint <change-name> \
  --summary <text> \
  --next-action <text> \
  [--artifact <project-relative-path>]... \
  [--expect-revision <n>]

comet native check <change-name>
comet native evidence format [--entries <path>]
```

A checkpoint stores only recovery context and real artifact references. It does not change phase or replace completion evidence.

`check` is a built-in Native check, not a replacement for project tests. It exits with `1` when it finds issues or stale evidence.

`evidence format` reads acceptance entries from stdin or `--entries` and emits the canonical machine block for `verification.md`.

## Acceptance receipts

Automated validation:

```text
comet native receipt automated <change-name> \
  [--acceptance <id>]... \
  [--timeout-ms <milliseconds>] \
  -- <executable> [args...]
```

Manual observation:

```text
comet native receipt manual <change-name> \
  --acceptance <id> \
  --responsible <text> \
  --step <text> \
  --observation <text> \
  --confirmed
```

Create receipts only for commands or manual observations that actually occurred. Failed, skipped, blocked, or timed-out results cannot support pass.

## External review handoff

A high-risk change may require an implementation attestation, independent review, or waiver before it can pass. The current Agent may prepare and finalize handoff artifacts, but must not perform an external role's approve or sign action or receive its private key.

Implementation handoff:

```text
comet native receipt implement <change-name> prepare \
  --identity <implementation-identity> \
  --output <preparation.json>

comet native receipt implement <change-name> finalize \
  --preparation <preparation.json> \
  --attestation <owner-provided-attestation.json> \
  --confirmed
```

Independent-review handoff:

```text
comet native receipt review <change-name> prepare \
  --implementation-receipt <ref> \
  --report <verification.md> \
  --required-receipt <ref> \
  --identity <reviewer-identity> \
  [--unified-io-receipt <ref> \
   --adversarial-paths-receipt <ref> \
   --generated-assets-receipt <ref> \
   --lifecycle-eval-receipt <ref>] \
  --output <preparation.json>

comet native receipt review <change-name> finalize \
  --preparation <preparation.json> \
  --approval <reviewer-provided-approval.json> \
  --attestation <reviewer-provided-attestation.json> \
  --confirmed
```

The external role completes approval or signing from the preparation and returns only public artifacts. When the Runtime requires a waiver, an external waiver signer also executes the command supplied by the continuation; the current Agent submits only the returned waiver ref.

## Phase progression

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--allow-partial-scope <sha256> --partial-reason <text> --confirmed] \
  [--result pass|fail] \
  [--report <change-relative-path>] \
  [--receipt <required-receipt-ref>] \
  [--evidence-receipt <acceptance-receipt-ref>]... \
  [--waiver <waiver-ref>]... \
  [--independent-review-receipt <review-receipt-ref>] \
  [--failure-category <token>]... \
  [--failed-check <token>]... \
  [--override-repair <sha256> --override-summary <text>]

comet native archive <change-name> --dry-run
comet native archive <change-name> --expect-preflight <sha256> [--confirmed]
```

- Shape: pass `--confirmed` only after the user confirms the final shared understanding.
- Build: provide a real `--artifact`; use `--no-code-reason` only when no project file changed.
- Partial scope: explain the exact gaps and risks returned by the Runtime. Changes beyond the returned detail budget are summarized by a `scope-detail-overflow` count and content hash; use the matching scope hash, reason, and `--confirmed` only after the user accepts them.
- Verify: provide `--result` and a complete report. For the standard report path, submit `comet native next <change-name> --summary <summary> --result pass|fail --report verification.md`; pass requires current receipts requested by the Runtime, and fail uses stable, non-sensitive failure categories and check IDs.
- Repair override: use only the signature returned by status and only for one explicit new repair hypothesis.
- Archive: dry-run first, then use the exact preflight hash returned by that preview. `required` mode also requires explicit user confirmation.

## Diagnostics and recovery

```text
comet native doctor [<change-name>]
comet native doctor [<change-name>] --repair
comet native doctor [<change-name>] --repair [--strategy continue|rollback]
```

Run read-only doctor first. Use `--repair` only when its report offers a repair action. Ordinary phase transitions support only `continue`; whether Archive or root move allows rollback is determined by doctor.

## Output and exit codes

Every command supports `--json`. JSON mode returns one object with `command`, `exitCode`, `data`, and `error` on failure.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Built-in check found issues or stale results |
| `64` | Invalid arguments or usage |
| `65` | Invalid configuration, state, or artifact |
| `73` | Lock, transaction, concurrency, or root conflict |
| `75` | Repair stagnation or failure budget blocks progress |
| `70` | Unexpected internal failure |
