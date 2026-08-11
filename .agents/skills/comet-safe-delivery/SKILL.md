---
name: comet-safe-delivery
description: Commit, push, merge, or finish a scoped Comet change while preserving unrelated dirty work, linked worktrees, submodules, and explicit user boundaries. Use when the user asks to submit, commit, push, merge back, clean a worktree, or deliver already-prepared changes.
---

# Comet Safe Delivery

Load `../comet-github/references/maintainer-contract.md` first. This skill performs Git delivery only after the user explicitly authorizes the requested action. It never publishes to npm.

## Preflight

1. Record the current branch, upstream, `git status --short --branch`, and `git worktree list --porcelain`.
2. Inspect the diff and identify the exact intended paths. Ask for scope clarification if the requested files overlap unrelated work.
3. Confirm the target branch and remote. Do not silently switch branches or change the delivery target.
4. If a submodule is involved, verify its own branch/status and commit it before updating the parent gitlink.

## Stage and verify

- Stage explicit intended paths only; do not use broad staging in a mixed checkout.
- Inspect `git diff --cached --name-status`, `git diff --cached --stat`, and `git diff --cached --check`.
- Let the repository pre-commit hook run. If it changes staged files, recheck the staged names and diff.
- Use a type-prefixed commit message such as `fix: ...`, `docs: ...`, or `chore: ...`.

## Deliver

Commit only the confirmed staged scope. Push only the explicitly requested branch and remote. Afterward verify the local status, commit SHA, upstream relation, and remote branch SHA. Report commit, push, and any online CI state separately.

Do not create a PR, merge a remote branch, delete a branch, remove a worktree, or rewrite history unless separately requested. Before any worktree/branch deletion, verify linked worktrees, exact targets, and recoverability; never force-delete a broad or unresolved path.
