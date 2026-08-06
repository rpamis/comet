# Native Command Reference

Read this file only for advanced inputs, receipts, partial scope, or diagnostic actions requested by Runtime. The CLI owns command signatures, options, examples, and output:

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

Do not copy stale arguments from this file. Prefer the continuation's `commandArgs` and fill real values according to `inputOptions`. Every command supports `--json` and `--project-root`.

## Structured output

The JSON envelope contains `command`, `exitCode`, `data`, and `error` on failure. Important action fields are:

- `continuation.disposition`: `continue | await-user | blocked | done`;
- `commandArgs`: complete executable and argv template;
- `inputOptions`: required inputs, flags, choices, repeatability, and alternatives;
- `workspace` / `preparation`: actual change directory and creation result;
- `nextPageArgs`: the next status or acceptance page action;
- `findings`: `requiredAction`, `retryCommand`, `repairCommand`, and whether a user decision is required;
- `workspaceFinishResult`: Git finish result and recovery action after Archive.

Never execute angle-bracket placeholders literally or auto-execute a template while disposition is `await-user`.

## Semantics to preserve

- Shape or Build reconfirmation: use `--confirmed` only after the user confirms shared understanding.
- Build: use artifact input for real files; choose no-code only when that fact is true.
- Mid-change work from Verify/Archive: use `--return-to-build` and reread status before editing implementation.
- Partial scope: use the exact hash, reason, and confirmation only after the user accepts Runtime-reported gaps.
- Verify: the report references real automated/manual receipts; never fabricate a required-check receipt.
- Receipt refresh: defaults to read-only classification. Only source-revision-only manual receipts can be safely re-issued. Automated receipts must rerun; contract, scope, snapshot, or artifact mismatch requires fresh verification.
- Repair override: use only the current status signature for one concrete new hypothesis.
- Archive: `--finish` only persists an approved isolated-workspace choice; execute against the preflight returned by that same inspection.

## Diagnostics

Run read-only `doctor` first. Use `--repair` and a strategy only when its output offers that action. Never delete locks, edit hashes, or change transactions manually.

## Exit codes

| Exit | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Built-in checks found issues or stale results |
| `64` | Invalid arguments or usage |
| `65` | Invalid configuration, state, or artifact |
| `70` | Unexpected internal failure |
| `73` | Lock, transaction, concurrency, workspace, or finish conflict |
| `75` | Repair stagnation or failure budget blocks progress |
