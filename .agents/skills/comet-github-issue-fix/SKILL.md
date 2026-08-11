---
name: comet-github-issue-fix
description: Implement a confirmed Comet GitHub issue or review blocker with isolated scope, the owning Native or Classic workflow, proportional tests, generated-runtime checks, and cautious delivery. Use when the user explicitly asks to fix a verified issue or PR finding.
---

# Comet GitHub Issue Fix

Load `../comet-github/references/maintainer-contract.md` first. Treat the issue or review as an input contract, not as permission to modify GitHub or publish code.

## Confirm the work boundary

1. Read the live issue/PR and verify that the reported problem is real. Do not implement unresolved review-bot speculation.
2. Identify the current target branch, repository state, existing dirty files, and linked worktrees.
3. Preserve the user's current checkout. Use an isolated worktree/branch when the target branch or dirty workspace makes direct edits unsafe.
4. Define the minimal behavior, files, tests, generated assets, docs, and non-goals before editing.

## Implement through Comet ownership

- Route Native work through the Native workflow and Classic work through the Classic workflow.
- If scope expands after implementation begins, return to the owning Build/scope confirmation step before adding files or behavior.
- Keep Runtime-managed state and generated assets under their supported commands; do not hand-edit machine state or generated bundles as the source of truth.
- Use the smallest production change that satisfies the confirmed issue and add a focused regression test when the defect is reproducible.

## Verify and hand off

Run the smallest relevant tests first. Add build, generated-asset, lint, or full-suite checks when the change crosses those boundaries. Report local results, failures unrelated to the change, and remote CI separately.

Decide explicitly whether the final behavior is user-visible and needs a Changelog entry. Do not create a Changelog entry for branch-internal iteration or a bug found only while developing a new feature.

Do not commit, push, comment, or open a PR unless the user asks. When authorized, hand the exact file scope to `comet-safe-delivery`.
