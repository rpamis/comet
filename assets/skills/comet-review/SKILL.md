---
name: comet-review
description: "Manually review the implementation diff for the current Comet change without advancing the workflow."
disable-model-invocation: true
---

# Comet Manual Code Review

Run an on-demand, read-only code review for the currently selected Comet change. This entry is phase-neutral and does not replace Build or Verify validation and review.

This entry is independent of `review_mode`: `review_mode` controls the in-workflow automatic review policy, while `/comet-review` represents a single review manually triggered by the user. Invoking this entry must not read, modify, or override the current change's `review_mode`.

## Invariants

The entire Skill invocation must remain read-only:

- Do not modify, create, or delete files.
- Do not stage, commit, switch branches, create branches, or create worktrees.
- Do not run `comet state select`, `comet native select`, `comet state set`, `comet state transition`, phase guards, `comet native next`, or archive commands.
- Do not fix findings, advance the phase, or update tasks, state, verification reports, or review records.
- Do not describe this review as a passing Verify result or treat “no findings” as proof that tests pass.

Only commands needed to read files, query status, and inspect Git diffs are allowed. Checks that may execute project code, install dependencies, or generate files are outside this entry's scope.

## 1. Resolve the project and current change

1. Use a read-only Git query to locate the project root. If the project is not a Git repository, use the current Comet project root.
2. From the project root, run:

   ```bash
   comet status . --json
   ```

3. Read `.comet/current-change.json` and resolve the review target in this order:
   - When it contains a valid `comet.selection.v2`, use its `workflow` and `change`.
   - When selection is missing and status reports exactly one unarchived Comet change, use that change for this review only without writing a selection.
   - When selection is missing and multiple changes exist, list their names, workflows, and phases, ask the user to choose one, and stop.
   - When selection points to a missing, archived, or invalid change, report the stale or invalid selection and stop without repairing it.

Ignore unmanaged plain OpenSpec changes. Do not replace the selection with the default workflow when they differ.

## 2. Collect review context

Read only the context needed for the current change, retaining a source path or command for every fact.

### Classic

1. Read and follow `comet-classic/reference/classic-layout.md` first to resolve the project's logical Classic roots.
2. Read the current change's `proposal.md`, `design.md`, `tasks.md`, and `specs/*/spec.md`. Read the associated Design Doc when one exists.
3. Use these read-only state queries to obtain the phase, baseline, and existing evidence references:

   ```bash
   comet state get <change-name> phase
   comet state get <change-name> base_ref
   comet state get <change-name> plan
   comet state get <change-name> verification_report
   ```

4. Read the plan and verification report when present, plus build and verify command checks returned by `comet status . --json`. Label missing evidence as “not provided”; do not infer failure or success.

### Native

Run these read-only commands:

```bash
comet native show <change-name> --json
comet native status <change-name> --details --json
```

Read the returned brief, complete proposed Specs, acceptance items, Builder handoff, checks, verification, risks, blockers, and verification report reference. Use evidence from the current candidate and iteration only. Historical iterations may explain residual risk but must not override current state.

## 3. Establish the implementation diff

1. Run `git status --short --untracked-files=all` first to fully enumerate staged, unstaged, and untracked worktree state.
2. Use the current change's requirements, workspace binding, Git history, and worktree state to determine the most credible review scope related to the current change. For Classic, prefer a valid plan `base-ref`; when it is missing or invalid, fall back to the state `base_ref`. The two values do not need to match. Only when both values are invalid is the Classic baseline missing. For Native, treat the workspace relationship in state and the current candidate's implementation-scope evidence as inputs to this judgment.
3. Inspect the complete diff from the trusted baseline to the current worktree, including committed, staged, and unstaged changes. Directly read all untracked files owned by the current change, including source, tests, documentation, configuration, and metadata (for example, `SKILL.md` and `agents/openai.yaml`), and label them as untracked.
4. Exclude diffs clearly owned by another change or unrelated user work. Ask the user only when ambiguity would materially affect the review conclusions; otherwise continue from the available evidence and report the scope judgment and assumptions.

If the evidence above still does not yield a trusted, verifiable baseline, continue reviewing the visible worktree diff and prominently label the review scope as incomplete.

## 4. Perform the review

Review requirements, tasks, and the current diff, focusing only on:

- implementation correctness and concrete logic defects;
- security, permission, and path-boundary risks;
- error handling, compatibility, and important edge cases;
- omitted tasks or implementation that contradicts explicit current-change requirements;
- whether tests cover the behavior change and whether existing evidence supports the stated conclusion.

Do not report style preferences, unrelated refactors, or speculation without a concrete impact as findings. Every finding must identify a file and line and explain the triggering behavior or risk. When evidence is insufficient, lower the severity or place the item under open questions.

Use only these severities:

- `CRITICAL`: security compromise, data loss, or an unusable core workflow;
- `IMPORTANT`: a concrete correctness defect, missing core acceptance behavior, or a high-probability regression;
- `WARNING`: a real but non-blocking edge risk or test gap;
- `SUGGESTION`: an improvement with a concrete benefit that does not affect current correctness.

## 5. Report

Lead with findings ordered by severity. Use this format for every finding:

```text
[IMPORTANT] Short title — path/to/file.ts:123
Impact: Which input or scenario produces which failure.
Evidence: The concrete relationship to the diff, task, specification, or recorded evidence.
```

Then report:

- `Review scope`: workflow, change, phase, baseline, included diffs, and any scope limitations;
- `Evidence status`: test, build, and verification evidence read and its freshness, without rerunning tests;
- `Open questions`: only questions that genuinely block a conclusion;
- `Conclusion`: finding counts, or an explicit “No concrete findings.”

Even with no findings, state residual risks and checks that were not run. End with this fixed reminder:

> This is a read-only manual review. It does not advance the Comet phase and cannot replace `/comet-verify` or Native Verify.

If the user subsequently asks to fix a finding, treat that as a new write task, exit this Skill, and re-enter development through the repository's current workflow rules.
