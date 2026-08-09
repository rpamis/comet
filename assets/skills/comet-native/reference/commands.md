# Native Command Reference

Read this file only for advanced inputs, Verifier dispatch, or diagnostic actions requested by Runtime. The CLI owns command signatures, options, examples, and output:

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

Do not copy stale arguments from this file. Prefer the continuation's `commandArgs` and fill real values according to `inputOptions`. Every public command supports `--json` and `--project-root`.

## Structured output

The JSON envelope contains `command`, `exitCode`, `data`, and `error` on failure. Important action fields are:

- `continuation.disposition`: `continue | await-user | blocked | done`;
- `commandArgs`: complete executable and argv template;
- `inputOptions`: required inputs, flags, choices, repeatability, and alternatives;
- `workspace` / `preparation`: actual change directory and creation result;
- `stateVersion` / `loop`: current stable state version, stage, iteration, and attempt;
- `acceptance` / `nextPageArgs`: acceptance state and later page actions;
- `builderHandoff` / `verifierDispatch`: candidate summary and independent verification execution to start;
- `blockers` / `findings`: owner, reason, allowed resolution, and whether a user decision is required;
- `localExecution`: this machine's running, completed, interrupted, or absent operation;
- `workspaceFinishResult`: Git finish result and recovery action after Archive.

Never execute angle-bracket placeholders literally or auto-execute a template while disposition is `await-user`. `localExecution: absent` means only that this machine has no current operation; valid portable state means the change is not damaged.

## Skill coordination bridge

When `continuation.runnerAction` requires coordination, follow its `commandArgs` and use these exact JSON shapes with the same `next --runner-input <file>`. Put the file in the OS temporary directory and delete it in `finally`; never put it in the project or Runtime directory. For an execution error or unavailable Verifier, copy `stateVersion`, `iteration`, `attempt`, and `verifierExecutionRef` exactly from the current `verifierDispatch`; these are Runtime-issued stale-message guards, not Agent-authored identity.

```jsonl
{"kind":"builder-handoff","summary":"iteration implementation summary","addressed_acceptance_ids":["A1"],"checks":[{"name":"development check","result":"passed","note":null}],"known_limits":[]}
{"kind":"dispatch-verifier","checks":[{"id":"focused-test","name":"Focused tests","executable":"pnpm","argv":["vitest","run","path/to/test.ts"],"cwdRef":".","timeoutMs":120000,"repeatable":true}]}
{"kind":"verifier-response","response":{"kind":"request-checks","iteration":1,"attempt":1,"checks":[{"id":"extra-check","name":"Extra check","executable":"pnpm","argv":["test"],"cwdRef":".","timeoutMs":120000,"repeatable":true}]}}
{"kind":"verifier-response","response":{"kind":"final-result","result":{"iteration":1,"attempt":1,"verdict":"pass","acceptance":[{"id":"A1","result":"passed","reason":"Observed the behavior"}],"risks":[],"summary":"Reviewed every acceptance item"}}}
{"kind":"verifier-execution-error","summary":"Why the Verifier execution failed","stateVersion":7,"iteration":1,"attempt":2,"verifierExecutionRef":"skill-coordinated:verifier:<from verifierDispatch>"}
{"kind":"verifier-unavailable","summary":"The platform cannot start a new independent semantic-verification execution","stateVersion":7,"iteration":1,"attempt":2,"verifierExecutionRef":"skill-coordinated:verifier:<from verifierDispatch>"}
```

The Skill explicitly resolves the check plan from repository guidance and the change; Runtime executes it. Use `"checks":[]` only when no command check applies, and still have the Verifier cover every acceptance item. `verifierDispatch` returns Runtime-allocated candidate/iteration/attempt values, all acceptance items, brief/Spec refs, the identity-free handoff, and real check results.

After `request-checks`, resume the same Verifier/attempt with the updated `verifierDispatch`. If the platform can start neither a subagent nor a new independent Agent execution, submit `verifier-unavailable` only after `dispatch-verifier` explicitly resolved the check plan and every Runtime result is `passed`; an explicit `checks: []` also counts as resolved. Runtime stops at degraded `await-user` with `semantic-verification-unavailable` assurance. Only explicit user confirmation enters Archive with `user-confirmed-degraded` assurance; this path is never host-attested or a normal independent acceptance result.

When a valid Verifier returns semantic `blocked` and the user confirms that no implementation change is needed, execute the continuation's `next --resolve-verifier-blocker --summary`. Runtime increments `retry_epoch`, reuses completed checks for the same candidate, and dispatches a new attempt. Continue to use `--return-to-build` when implementation changes are needed.
The released public bridge is always `skill-coordinated` and cannot resist a malicious local caller. A normal Skill-coordinated pass stops at `await-user`; ask once for boundary confirmation, then use Runtime's `next --confirmed --summary` to enter Archive.

## Semantics to preserve

- Shape confirmation: use `--confirmed` only after the user confirms shared understanding and the acceptance list.
- Build handoff: submit the real implementation summary, addressed acceptance IDs, development checks actually run or not run, and known limitations; do not submit an acceptance verdict.
- Mid-change work from Verify/Archive: use `--return-to-build` and reread status before editing implementation; return to Shape and reconfirm when acceptance criteria change.
- Runtime checks: the Skill explicitly resolves a structured plan, and Runtime only executes and records that plan. Complete output goes to logs; the Agent does not wrap prose as a successful result.
- Verifier dispatch: use a new read-only subagent or independent Agent execution with the brief, target Specs, actual implementation, check results, every acceptance item, and Builder handoff.
- Verifier requests: request extra checks in one batch for Runtime to deduplicate and execute; do not repeatedly request equivalent checks in one attempt.
- Verifier result: return every acceptance ID exactly once, with every item `passed` for a `pass`. The Agent does not self-report candidate, provider, or execution identity in a body or CLI.
- Loop: `fail` returns to Build, while execution errors increment only attempt-related counters. A semantic `blocked` result retries the same candidate or returns to Build only after user choice; obey `blocked` / `await-user` at stagnation or budget limits.
- Archive: `--finish` only persists an approved isolated-workspace choice. Execute only for the current state version without repeating checks or independent verification.

## Diagnostics

Run read-only `doctor` first. Use `--repair` and a strategy only when its output offers that action. Never delete locks, rewrite state, or change transactions manually.

## Exit codes

| Exit | Meaning |
| --- | --- |
| `0` | Success |
| `1` | A check, acceptance decision, or execution reported a problem |
| `64` | Invalid arguments or usage |
| `65` | Invalid configuration, state, or formal artifact |
| `70` | Unexpected internal failure |
| `73` | Lock, transaction, concurrency, workspace, or finish conflict |
| `75` | Loop stagnation or failure budget blocks progress |
