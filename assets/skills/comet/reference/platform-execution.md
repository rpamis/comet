# Ordinary commands and checks

Use Agent platform tools directly for development, tests, and ordinary commands in Build, Verify, Child tasks, and fixed applications. The Agent selects checks from project rules, changes, and acceptance requirements and reads actual results. The platform owns timeouts, cancellation, and process cleanup. Comet records business state, tasks, user approvals, and acceptance reports.

## Execution and results

- One parent Agent writes Comet state for each workspace and Run, waiting for each write command to finish before submitting the next. Parallel children edit only their isolated worktrees and return results to the parent. The parent submits each result and task completion in sequence, preserving the original Action, actual child session, claim identity, and result template. Do not substitute the parent session or reclaim completed tasks. Ordinary workflows do not create locks or run lock recovery.
- Start with checks covering the change. Complete acceptance covers every requirement for the current candidate; it does not mean the repository's full test suite. Preserve the user's execution, TDD, review, and independent-session choices.
- The Agent judges whether previous results still apply after implementation, input, or environment changes. Keep commands, working directories, actual results, and log references. Run only missing or invalidated checks; do not repeat commands to submit a Comet report.
- Follow the same platform task and actual session after dispatch. A wait-tool timeout does not establish failure or termination. Inspect the original task through the platform. On cancellation, use platform cancellation and verify cleanup before recording business cancellation; never fabricate a pass or a stopped process.
- Keep large logs in platform logs or files. Return conclusions, relevant failure excerpts, and readable references; retrieve details when needed instead of repeatedly returning full history, logs, or delivered context.
- Eval, downloads, and other commands actually started by Comet retain their own cleanup contracts. Start Eval only when the user explicitly requests it.

## Submitting to Comet

For Native, submit actual `checks` and acceptance results with the current Action template. For Classic SDK, save a JSON report:

```json
{
  "checks": [
    {
      "name": "command, directory and check name",
      "result": "passed",
      "note": "actual result and log reference"
    }
  ]
}
```

Use `failed` for failures and `not-run` with a reason for omitted checks. If no check applies, use empty `checks` and explain `checksReason`. Unrun, timed-out, and unknown checks cannot pass. Build submits with `comet state complete-build <change> --checks <checks-json-file>`; Verify uses `comet guard <change> verify --report <report-ref> --apply --checks <checks-json-file>`. Runtime still validates tasks, approvals, candidates, and acceptance requirements. Follow its current business continuation on failure.

For Classic Compat, record the actual platform result after execution:

```bash
comet state record-check <change> <build|verify> --command "<actual command>" --exit-code <actual exit code> --cwd <actual directory>
```

This command records results without executing the command text. Then run the current phase's Guard. Reports do not replace task completion, user approval, or acceptance. Legacy `comet check run/rerun` returns platform execution guidance without running or recovering checks.

## Upgrading older versions

Continue the original change and Run using the current entry's templates and continuation. Automatic data conversion preserves approvals, tasks, candidates, and accepted business results. It does not ask again for unchanged decisions or replay Archive or delivery. Retired check scheduling no longer executes. Inspect unfinished or unknown platform tasks through their original platform before submitting actual reports. Historical PIDs, stop receipts, and content snapshots do not authorize execution or acceptance in the current workflow.
