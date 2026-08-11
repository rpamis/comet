---
name: comet-github-ci-triage
description: Diagnose failing or ambiguous GitHub Actions and coverage checks for Comet pull requests using the exact current head, failed job logs, local reproduction boundaries, and mergeability state. Use when a PR has CI errors, Codecov concerns, stale checks, or an unexplained red job.
---

# Comet GitHub CI Triage

Load `../comet-github/references/maintainer-contract.md` first. The default is diagnosis only; implement a patch only when the user asks.

## Inspect the exact remote state

1. Resolve the PR and record the current head SHA and base branch.
2. Run `gh pr checks <pr> --json name,state,bucket,link,workflow,startedAt,completedAt`.
3. For failed jobs, inspect the actual run with `gh run view <run-id> --log-failed` or the narrowest available job log. Do not trust an aggregate helper summary without the failing boundary.
4. Check mergeability and whether the displayed checks belong to the current head. A stale run is not evidence about the current code.
5. For Codecov, inspect impacted files/patch coverage metadata through the available API when the UI is incomplete; report the exact head and coverage scope.

## Classify the failure

Determine whether the red result is caused by:

- production code;
- a test fixture or frozen-contract projection;
- generated-runtime drift or nondeterministic build output;
- dependency/toolchain/platform environment;
- credentials, permissions, or runner setup;
- stale checks or merge conflicts;
- an unresolved coverage threshold.

Reproduce the smallest decisive boundary locally when implementation is requested. On Windows, distinguish sandbox/credential/placeholder-executable noise from a real CI failure before changing product code.

## Report status precisely

Return the current head SHA, failed job, root cause, evidence, and recommended smallest action. Separate remote status from local checks. Use `unverified` for timed out, missing, stale, or not-yet-started checks.

Never claim CI is green until fresh checks for the exact final head succeed. If a fix is needed, hand the confirmed scope to `comet-github-issue-fix` and then use `comet-safe-delivery` only after the user authorizes delivery.
