---
name: comet-review
description: 'Manually review the implementation diff for the current Comet change. Report correctness, security, and edge-case issues without advancing the workflow.'
disable-model-invocation: true
---

# Comet Manual Code Review

Perform one on-demand, read-only code review of the currently selected Comet change. This entry is not a workflow phase and does not replace Build or Verify checks and reviews.

This entry is independent of `review_mode`. That field controls automatic reviews within the workflow; `/comet-review` is a single review explicitly requested by the user. Do not read, modify, or override the current change's `review_mode` during this invocation.

## Perform read-only operations

The entire Skill invocation must remain read-only:

- Do not modify, create, or delete files.
- Do not stage, commit, switch branches, create branches, or create worktrees.
- Do not run `comet state select`, `comet native select`, `comet state set`, `comet state transition`, phase guards, `comet native next`, or archive commands.
- Do not fix findings, advance phase, or update tasks, state, verification reports, or review records.
- Do not call this review a Verify pass or treat “no findings” as proof that tests passed.

Only run commands needed to read files, query state, and inspect Git diffs. Checks that might execute project code, install dependencies, or produce files are outside this entry's scope.

## 1. Locate the project and current change

1. Use read-only Git queries to find the project root. Outside a Git repository, use the current Comet project root.
2. Run at the project root:

   ```bash
   comet status . --json
   ```

3. Read `.comet/current-change.json` and choose the review target in this order:
   - If the file contains a valid `comet.selection.v2`, use its `workflow` and `change`.
   - If selection is absent and status lists exactly one unarchived Comet change, use that change for this review only; do not write selection.
   - If selection is absent and several changes exist, list their names, workflows, and phases, ask the user to choose one, and end this invocation.
   - If selection points to a missing, archived, or invalid change, report the stale/invalid selection and stop without repairing it.

Ignore ordinary OpenSpec changes that Comet does not manage. Do not replace the selected workflow with the default workflow merely because they differ.

## 2. Gather review context

Read only the context needed for this change. Keep a source path or command for each fact.

### Classic

1. Read and follow `comet-classic/reference/classic-layout.md` to resolve the project's Classic logical roots.
2. Read the current change's `proposal.md`, `design.md`, `tasks.md`, and `specs/*/spec.md`. Also read any linked Design Doc.
3. Use these read-only queries for the phase, baseline, and existing evidence references:

   ```bash
   comet state get <change-name> phase
   comet state get <change-name> base_ref
   comet state get <change-name> plan
   comet state get <change-name> verification_report
   ```

4. Read the existing plan, verification report, and build/verify command checks returned by `comet status . --json`. Mark missing evidence as “not provided”; do not infer failure or success.

### Native

Run these read-only commands:

```bash
comet native show <change-name> --json
comet native status <change-name> --details --json
```

Follow the returned references to read the brief, complete proposed Specs, acceptance, Builder handoff, checks, verification, risks, blockers, and verification report. Use evidence for the current candidate/iteration only. Historical iterations may explain remaining risks but must not override current state.

## 3. Establish the implementation diff

1. Run `git status --short --untracked-files=all` to list all staged, unstaged, and untracked files in the worktree.
2. Use the current change's requirements, workspace binding, Git history, and worktree state to establish the most reliable relevant scope. For Classic, prefer a valid plan `base-ref`; if it is absent or invalid, fall back to the state `base_ref`. The two values do not need to match. Only when both values are invalid is the Classic baseline missing. For Native, use the workspace relationships in state and the evidence defining the current candidate's implementation scope.
3. Inspect the complete diff from the reliable baseline to the current worktree, including committed, staged, and unstaged changes. Read all untracked files belonging to this change, including source, tests, documentation, configuration, and metadata such as `SKILL.md` and `agents/openai.yaml`. Clearly identify them as untracked.
4. Exclude changes clearly belonging to other changes or unrelated user work. Ask the user only when ambiguity would materially affect the review conclusions. Otherwise, continue with the available evidence and state your scope assumptions in the report.

If the available evidence still cannot establish a reliable, verifiable baseline, review the visible worktree diff and prominently label the review scope as incomplete.

## 4. Perform the review

Review the requirements, tasks, and current diff, focusing only on:

- Implementation correctness and clear logic errors.
- Security, permission, and path-boundary risks.
- Error handling, compatibility, and important edge cases.
- Missing tasks or implementation that contradicts explicit requirements for this change.
- Whether tests cover the changed behavior and whether the available test evidence supports the conclusions.

Do not report style preferences, unrelated refactoring, or speculation without a concrete impact. Each finding must identify a file and line number and explain the input or situation that triggers the error or risk. Lower its severity or place it under “Open questions” when evidence is insufficient.

Use only these severity levels:

- `CRITICAL`: security compromise, data loss, or an unusable core workflow.
- `IMPORTANT`: a clear correctness error, missing core acceptance requirement, or likely regression.
- `WARNING`: a real, non-blocking edge-case risk or test gap.
- `SUGGESTION`: a concrete improvement that does not affect current correctness.

## 5. Report the results

List findings first, ordered by severity. Use this format:

```text
[IMPORTANT] Short title — path/to/file.ts:123
Impact: The input or situation and the resulting error.
Evidence: The specific relationship to the diff, task, spec, or verification record.
```

Then include:

- `Review scope`: workflow, change, phase, baseline, included diffs, and any scope limitations.
- `Evidence status`: the test, build, and verification records inspected and whether they still apply to the current changes. Do not rerun tests.
- `Open questions`: only questions that actually prevent a judgment.
- `Conclusion`: the finding count, or an explicit “No concrete findings.”

Even with no findings, state remaining risks and checks not performed. End with this reminder:

> This was a read-only manual review. It does not advance the Comet phase and cannot replace `/comet-verify` or Native Verify.

If the user subsequently requests fixes, treat that as a new write task: leave this Skill and resume development under the repository's current workflow rules.
