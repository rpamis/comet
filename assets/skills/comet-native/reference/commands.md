# Native command and exception reference

During the normal flow, execute the command returned in Runtime `continuation`. This file explains returned fields and handles these cases: command input is rejected, the Verifier cannot start, the Verifier task fails, the Verifier cannot decide because external information is missing, or the Runtime asks the user to confirm degraded verification. `continuation.disposition` says whether to continue, wait for the user, resolve a blocker, or finish. Use a follow-up command containing `--confirmed` only after explicit user confirmation. CLI text is user-first (`summary`, one `NEXT:`, optional `RELAY TO USER:`); use `--json` for the additive envelope and `--verbose` only for structured machine troubleshooting.

Treat CLI help as authoritative for command signatures and current arguments:

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

## Next action returned by the Runtime

- `disposition`: whether to continue, wait for the user, resolve a blocker, or finish; when `userCommunication.required` is true, relay its message and wait before executing any confirmation command.
- `commandArgs` / `commandAlternatives`: complete command arguments from the Runtime. Alternatives are complete commands for mutually exclusive user decisions; execute the matching one and do not combine them.
- `inputOptions`: fields and a JSON template for this command.
- `workspace` / `preparation`: the actual working directory and change-creation result.
- `stateVersion` / `loop`: the current state version and acceptance Loop progress.
- `acceptance` / `childSummary` / `readyChildren` / `supervisor` / `details.nextPageArgs`: acceptance counts, Supervisor Change child counts, currently ready children, the integration branch and current task-package summary, and the next detail-page command.
- `verifierDispatch`: workspace and evidence locations, current `scopeIds`, counts, content refs, detail-page args, review summary, and check results needed to start an independent Verifier; when present, `recoveryContext` is the latest recovery or user-provided context and must be passed directly to the Verifier.
- `workspaceFinishResult` / `recoveryArgs`: the post-Archive workspace result and recovery command.

Angle brackets in a template mark values to fill in. `await-user` means wait for the user's decision before running an advancing command. If `commandArgs` is `null` and `commandAlternatives` is present, confirm the user's decision, then execute the selected alternative's complete `commandArgs` while preserving `--expected-state-version` and `--expected-action`. If the command fails because the state or action binding is stale, reread the latest `continuation` and continue from the current state; do not construct an unguarded replacement command. `localExecution: absent` means only that this machine has no currently running local task; it does not mean the change is damaged.

When starting a Verifier, pass the location fields in `verifierDispatch` unchanged: `projectRoot` is the control directory used to run Native commands; `verificationRoot` is the workspace containing the implementation under verification, and a Supervisor parent uses the integration worktree; `changeDir` is the relative-path base for `briefRef` and `specRefs[].ref`; `supervisorStateRef` points to local state containing child verification and integration evidence, and is `null` for an ordinary change. When present, pass `recoveryContext` unchanged as the latest recovery or user-provided context. `detailsPageArgs` already includes `--project-root`; preserve it when querying from any working directory. After requesting additional checks, return their results and the handoff information to the same Verifier and continue waiting for its final result.

## Fill command input

Copy `inputOptions.template` into a temporary system JSON file, replace only the requested values, then execute `continuation.commandArgs` or the selected `commandAlternative.commandArgs`. Delete the temporary file afterward. Preserve the acceptance iteration, Verifier attempt, state version, and task identifiers already present in the template. Fill only the fields exposed by the template.

- `builder-handoff`: submit the implementation summary for this round, addressed acceptance IDs, development checks the Builder actually ran, known limitations, and `review.status=passed`, `review.summary`, and `review.reviewer_execution_ref` from a fresh read-only code review. Leave acceptance conclusions to the Verifier.
- `dispatch-verifier`: list the checks the Runtime should execute for the current candidate. An ordinary change may submit an empty list when no command-based check applies; a Supervisor parent must provide at least one integration check, with `cwdRef` relative to the integration worktree. The result is a task packet plus an attempt identity; the Agent must immediately start a platform-native read-only Verifier subagent. There is no separate Verifier service, process, endpoint, or callback to start or configure.
- `verifier-response`: request additional checks or submit a result covering exactly the current `scopeIds`. After a repair scope passes, Runtime requests one final full verification covering every acceptance scenario.
- Supervisor task operations use `supervisor-builder-result`, `supervisor-builder-failure`, `supervisor-verifier-result`, `supervisor-reconnect`, `supervisor-cancel`, and `supervisor-integrate`; Builder, Verifier, reconnect, and cancel operations carry the current Runtime task package's `runId`, and stale, wrong-role, or duplicate results are rejected. `supervisor-integrate` uses the verified child and integration checks without a `runId`. Use `comet native next <change> --max-parallel 1` to run in order; the default cap is 2.
- `verifier-execution-error` / `verifier-unavailable`: use the former when the platform supports subagents but this task does not start, fails, times out, or ends without returning a result; use the latter only when the current platform truly has no usable subagent capability. Preserve the task-binding fields from the template so a late message from an old task cannot affect a new Verifier.
- `retry-verifier` / `confirm-verifier-unavailable`: Runtime returns these `commandAlternatives` for an unavailable Verifier. Choose the former when the user asks to retry; the candidate and completed checks remain preserved. Choose the latter only when the user explicitly accepts the degraded automatic-check-only result.

The Runtime executes and records verification checks. Development checks listed in the Builder handoff only describe the candidate; the Verifier relies on actual Runtime check results. The latest `continuation` decides whether to add checks, retry, or start a new Verifier.

## Exceptional cases

- Independent Verifier cannot start: first confirm that all applicable checks are listed and every Runtime check passes. Then report unavailable using the template and wait for the user to decide whether to accept degraded verification with command checks only and no independent semantic review.
- Verifier is temporarily unable to decide (`semantic blocked`): if only user or external information is missing, execute the resolution action returned by the Runtime. If the implementation must change, return to Build.
- A Skill-started Verifier reports all items passed (`skill-coordinated pass`): checks completed, but the system cannot confirm that the verifier was independent. Runtime shows “Checks completed, but your confirmation is required”; execute the returned command only after confirmation.
- If Runtime shows “Full verification was unavailable; only automatic checks completed”, no semantic verifier was available. Archive only after explicit user confirmation.
- After the user accepts that incomplete result, Runtime shows “You accepted the incomplete verification result”; this records acceptance of the downgrade and does not turn it into independent verification.
- Verifier task fails (`execution error`): submit the error using the template, then read the new `continuation`. The Runtime decides which checks to reuse and whether to retry.

## Diagnostics

Run read-only `doctor` first. Execute a repair command only when `doctor` explicitly returns one; the Runtime continues to manage locks, cross-device state, and transactions.
