# Comet Maintainer Contract

Apply these rules to every Comet GitHub, delivery, release, documentation, and Runtime-diagnosis task.

## Evidence first

- Refresh the live branch, worktree, GitHub target, current head/base, and relevant CI before reusing historical conclusions.
- Treat review-bot summaries, pasted comments, stale Codecov output, changelog claims, and static configuration as leads, not proof.
- Compare reported behavior with the current source, tests, installed/generated Runtime, and actual execution path when applicable.

## Read-only by default

Analysis may inspect local files, Git state, GitHub metadata, CI logs, and Runtime behavior. It must not post comments, change labels, close issues, create issues, commit, push, open PRs, delete branches, or remove worktrees unless the user explicitly asks for that action.

When an action is authorized, state the exact target and intended mutation before performing it.

## Scope and workspace safety

- Preserve unrelated dirty files, linked worktrees, submodules, attachments, and user edits.
- Stage explicit paths only. Never use a broad `git add .` when the checkout is mixed.
- Keep diagnosis separate from implementation and keep implementation separate from delivery.
- If the user adds a file or behavior to an active Comet change, update the formal scope and reconfirm through the owning Comet workflow before continuing.

## Verification language

Separate these facts:

- local focused checks;
- local full checks, if run;
- generated-asset or package checks;
- remote CI state for the exact final head;
- checks that were not run, timed out, or remain unverified.

Never call a PR “CI green” until the new checks for the exact final head are successful.

## User-visible writing

Changelogs and release documentation describe behavior users notice and why it matters. Exclude branch-internal iteration, review follow-ups, test refactors, bundle details, cache details, and Git object IDs unless the user explicitly needs technical release notes.

Chinese wording should be professional and natural. Do not translate a workflow “gate” as “门”; use “检查”“协议”“阶段” or another context-appropriate term.

## Comet-specific boundaries

- Use the existing Native or Classic workflow for Comet changes; do not hand-edit Runtime-managed state.
- When source changes affect generated Runtime assets, rebuild through the repository command and run the corresponding generated-asset check.
- Use the canonical platform registry for cross-platform claims; do not replace it with a short hard-coded list.
- This repository-local Skill set is delivered through Git. Do not publish it to npm unless explicitly requested.
