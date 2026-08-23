# Native workspace selection reference

Read this file only when creating a change. Children returned in a Supervisor Change's `readyChildren` always use independent `worktree`s targeting the Supervisor Change's `workspace.changeBranch`. For other changes, use the user's existing choice of `current`, `branch`, or `worktree` directly.

When the user explicitly says parallel, simultaneous, or multiple sessions, select `worktree` directly without asking for a three-way choice. When no isolation mode is specified and parallel intent is not explicit, ask the user only if any of these conditions is true:

- The current directory has uncommitted work.
- Another active Native change already exists.
- The user requested parallel or isolated work without choosing how.

If none applies, use the Runtime default, `current`.

When asking, present isolation mode as one single-choice decision:

| Option | Mode | Actual impact |
| --- | --- | --- |
| A | Current directory (`current`) | Keep the current branch and directory; create no Git branch or working directory |
| B | New branch (`branch`) | Switch the current directory to a new change branch; requires a clean worktree |
| C | New worktree (`worktree`) | Create or reuse a separate branch and working directory; suitable for parallel changes or uncommitted work in the current directory |

Show every valid option consistent with the current state and user request. Do not filter out an option merely because a later command might fail. Recommend A when the user explicitly wants to stay on the current branch; recommend B when an independent branch is needed without parallel work; recommend C for parallel work, uncommitted work in the current directory, or another active Native change.

A recommendation is explanatory only. Wait for the user's choice before creating anything. Runtime reuses a registered `worktree` bound to the change branch; if the branch remains but its `worktree` was removed, Runtime recreates it. Ask the user to rebind only when the branch was renamed, taken over, or ownership is ambiguous. Follow the [clarification reference](clarification.md) for the question: prefer a structured single-choice tool, or use numbered text and pause when the tool is unavailable. If only one valid option exists, explain why and adopt it directly.
