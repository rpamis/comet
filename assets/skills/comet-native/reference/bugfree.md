# bugfree verification

Follow this reference when the SDK returns `verifyMode: bugfree`. The mode is fixed when the Run is created; later project configuration changes affect new Runs only. bugfree applies to final Verify. Supervisor Child verification and integration checks continue using their existing protocols.

## Start verification

Give the current `verificationContext` and claim template to one Verifier who did not participate in implementation. The Verifier reviews independently, reads code without modifying it, and does not launch additional review Agents.

Start a new session for the first review. When `session.strategy` is `resume`, continue the registered review session. If that session cannot be restored, start a new independent session. If the original task is still running or its result is unknown, establish its status first.

Save complete command output locally. Give the Verifier only the current `pendingActions[].verificationContext`, claim template, and result submission template; after claiming, read `action.input`. Use Runtime's materials, retaining approved requirements, every acceptance item, code changes, check results, and unresolved issues. There is no need to include Builder self-assessment, the complete development conversation, historical Run data, or another full result template. Reuse context that still applies to the current Action, adding only missing or invalidated content.

## Review the code

Read the requirements and final code first, then inspect callers, data structures, and configuration as needed. When the code is enough to decide, give the conclusion directly. When execution is needed to decide, request the necessary checks using the current `request-checks` template. Checks explicitly required by the user, project rules, or acceptance criteria must still have passing records applicable to the current implementation.

Reuse check records that remain valid. After a repair, focus on the difference between the two candidates, assess which behavior changed, and confirm that the other acceptance items still hold. The submitted result must cover every acceptance item.

Diagnostic checks added by an Agent in a previous iteration do not have to run every time. If reading the repaired code establishes that the original problem is resolved, explain why, and retain the facts that the original check failed and whether it ran again this iteration. Checks registered for the current candidate must still pass. Failures, incomplete inputs, and unknown results cannot be recorded as passed.

Mark code that does not meet the requirements as `failed`, identifying the trigger and location. If necessary information or an environment is unavailable and prevents a decision, mark the item `blocked` and explain what is missing. Finish when every acceptance item passes and no unresolved issue remains. There is no need to add a test for each item, accumulate proof material, or review everything again.

## Submit verification results

The Verifier claims the task and submits results under its own session identity. Fill the current compact template: `passedAcceptanceIds` lists passed IDs; `acceptance` contains only failed or blocked items and their reasons. Together they must cover every current acceptance item. Any failed item makes the overall verdict `fail`; with no failures but at least one blocked item, it is `blocked`.

After requested checks finish, have the original Verifier read the results, claim the successor Action, and continue the review. Use the current Action's templates for claims and result submissions, rather than a previous candidate's claim. After a wait-tool timeout, keep tracking the original task. Follow the existing recovery procedure for execution failure or an unknown result.

Runtime generates the final report. Tell the user the review conclusion, which checks actually ran, and which reused existing records. If no commands ran, state: "No command checks were run this iteration." Enter Archive only after the user explicitly accepts the result. If report generation fails, recover the report step without dispatching another review.
