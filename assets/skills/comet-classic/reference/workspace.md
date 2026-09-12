# Classic Workspace Selection

Read this reference only when creating a change. Existing changes use their saved workspace binding and enter the returned `projectRoot`.

For explicit parallel, simultaneous, or multi-session work, select `worktree` directly without asking the three-way question again. When isolation is unspecified and parallel intent is not explicit, ask only if one of these applies:

- The current directory has uncommitted work.
- Another active Classic change already exists.
- The user requests parallel development or isolated work without specifying how.

Otherwise, use Runtime's default `current`.

When needed, ask for one workspace isolation choice:

| Option | Method                        | Effect                                                                                                                               |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A      | Current directory (`current`) | Reuse the current branch and directory without creating a Git branch or working directory.                                           |
| B      | New branch (`branch`)         | Switch the current directory to a new change branch; requires a clean workspace.                                                     |
| C      | New worktree (`worktree`)     | Create or reuse a separate branch and working directory, suitable for parallel changes or uncommitted work in the current directory. |

Present all valid choices for the current state and request. Do not rule out choices by predicting later command failures. Recommend A when the user explicitly wants the current branch, B when a separate branch is needed without parallel work, and C for parallel development, existing local changes, or another active Classic change.

A recommendation is explanatory only: wait for the user's choice before creating the workspace. Runtime reuses a registered Worktree for an existing change's branch; if the branch remains but its registered Worktree was removed, Runtime recreates it. Request rebind through recovery only when the branch was renamed, taken over, or ownership cannot be established. Follow the [decision reference](decision-point.md): prefer a structured single-select tool; if unavailable, use numbered text options and wait. When only one valid option exists, explain why and apply it directly.
