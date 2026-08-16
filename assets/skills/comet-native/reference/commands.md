# Native command and exception reference

During the normal flow, execute the command returned in Runtime `continuation`. This file explains returned fields and handles these cases: command input is rejected, the Verifier cannot start, the Verifier task fails, the Verifier cannot decide because external information is missing, or the Runtime asks the user to confirm degraded verification. `continuation.disposition` says whether to continue, wait for the user, resolve a blocker, or finish. Use a follow-up command containing `--confirmed` only after explicit user confirmation.

Treat CLI help as authoritative for command signatures and current arguments:

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

## Next action returned by the Runtime

- `disposition`: whether to continue, wait for the user, resolve a blocker, or finish.
- `commandArgs`: the complete command arguments the Runtime requires.
- `inputOptions`: fields and a JSON template for this command.
- `workspace` / `preparation`: the actual working directory and change-creation result.
- `stateVersion` / `loop`: the current state version and acceptance Loop progress.
- `acceptance` / `children` / `readyChildren` / `supervisor` / `nextPageArgs`: the acceptance summary, the same-source Supervisor Change Child projections, currently startable Children, the integration branch and current task-package summary, and the command for the next page.
- `verifierDispatch`: inputs needed to start an independent Verifier.
- `workspaceFinishResult` / `recoveryArgs`: the post-Archive workspace result and recovery command.

Angle brackets in a template mark values to fill in. `await-user` means wait for the user's decision before running an advancing command. `localExecution: absent` means only that this machine has no currently running local task; it does not mean the change is damaged.

## Fill command input

Copy `inputOptions.template` into a temporary system JSON file, replace only the requested values, then execute `continuation.commandArgs`. Delete the temporary file afterward. Preserve the acceptance iteration, Verifier attempt, state version, and task identifiers already present in the template. Fill only the fields exposed by the template.

- `builder-handoff`: submit the implementation summary for this round, addressed acceptance IDs, development checks the Builder actually ran, and known limitations. Leave acceptance conclusions to the Verifier.
- `dispatch-verifier`: list the checks the Runtime should execute for the current candidate. Submit an empty list when no command-based check applies.
- `verifier-response`: request additional checks or submit a final result that covers every acceptance ID.
- Supervisor task operations use `supervisor-builder-result`, `supervisor-builder-failure`, `supervisor-verifier-result`, `supervisor-reconnect`, `supervisor-cancel`, and `supervisor-integrate`; Builder/Verifier/reconnect/cancel operations carry the current Runtime task package's `runId`, and late, wrong-role, or duplicate results are rejected. `supervisor-integrate` uses the verified Child and integration checks without a runId. Use `comet native next <change> --max-parallel 1` for explicit serial fallback; the default cap is 2.
- `verifier-execution-error` / `verifier-unavailable`: report that the Verifier task failed or could not start. Preserve the task-binding fields from the template so a late message from an old task cannot affect a new Verifier.

The Runtime executes and records verification checks. Development checks listed in the Builder handoff only describe the candidate; the Verifier relies on actual Runtime check results. The latest `continuation` decides whether to add checks, retry, or start a new Verifier.

## Exceptional cases

- Independent Verifier cannot start: first confirm that all applicable checks are listed and every Runtime check passes. Then report unavailable using the template and wait for the user to decide whether to accept degraded verification with command checks only and no independent semantic review.
- Verifier is temporarily unable to decide (`semantic blocked`): if only user or external information is missing, execute the resolution action returned by the Runtime. If the implementation must change, return to Build.
- A Skill-coordinated Verifier reports all items passed (`skill-coordinated pass`): checks completed, but the system cannot confirm that the verifier was independent. Runtime shows “Checks completed, but your confirmation is required”; execute the returned command only after confirmation.
- If Runtime shows “Full verification was unavailable; only automatic checks completed”, no semantic verifier was available. Archive only after explicit user confirmation.
- After the user accepts that incomplete result, Runtime shows “You accepted the incomplete verification result”; this records acceptance of the downgrade and does not turn it into independent verification.
- Verifier task fails (`execution error`): submit the error using the template, then read the new `continuation`. The Runtime decides which checks to reuse and whether to retry.

## Diagnostics

Run read-only `doctor` first. Execute a repair command only when `doctor` explicitly returns one; the Runtime continues to manage locks, cross-device state, and transactions.
