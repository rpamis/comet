# Native workspace reference

## Create a change

Choose a kebab-case name using lowercase letters, digits, and hyphens, and use the configured artifact directory. Before creation, the CLI associates branches or worktrees, reuses or recreates registered change worktrees, maintains repository-local exclusions, and checks configuration. If preparation fails, preserve created branches and directories and follow the cause and recovery advice in `preparation`.

Read this section only when creating a change to choose its working directory. After creation, enter `preparation.projectRoot`. `comet init` initializes `native.language` from the selected Skill language; subsequent artifacts follow the project setting. `--language` is only for an explicit user override.

Supervisor children returned in `readyChildren` always use independent `worktree` isolation and target the Supervisor Change's `workspace.changeBranch`. For other changes, directly use an explicitly chosen `current`, `branch`, or `worktree` mode.

An explicit request for parallel work, simultaneous tasks, or multiple sessions selects `worktree` without asking about the three modes again. If no isolation mode or clear parallel intent was specified, ask only when:

- The current directory has uncommitted work.
- Another active Native change exists.
- The user requests parallel or isolated work without specifying how.

Otherwise use Runtime's default `current`.

When needed, ask one single-choice question about isolation:

| Option | Mode                          | Actual impact                                                                                                    |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A      | Current directory (`current`) | Reuse the current branch and directory without creating a Git branch or working directory.                       |
| B      | New branch (`branch`)         | Switch the current directory to a new change branch; requires a clean workspace.                                 |
| C      | New worktree (`worktree`)     | Create or reuse an independent branch and directory, suitable for parallel changes or existing uncommitted work. |

Show every option consistent with current state and user intent; do not remove options merely because a later command might fail. Recommend A when the user wants the current branch, B for an independent branch without parallel work, and C for parallel work, existing edits, or another active Native change.

A recommendation does not replace a choice; create the workspace after selection. Runtime reuses a registered `worktree` still associated with the change branch, or recreates it if the branch remains but that worktree was removed.

Only when a branch was renamed, repurposed by the user, or has unclear ownership, first read [workspace recovery](recovery.md#workspace), then request rebind as Runtime directs. Before asking, read [question tools and modes](clarification.md#question-tools-and-modes): prefer a structured single-choice tool; otherwise use numbered text and wait. If only one option meets current conditions, explain why and use it directly.

## Archive completion

Continue only when `continuation` permits Archive. Reuse the accepted verification result. A `current` workspace needs no finish choice: show the current branch and directory, explain that no merge, push, or PR creation will occur, and follow the latest `continuation`.

For `branch` or `worktree` isolation that needs a finish choice, show the actual change branch, target branch, and directory once and offer all options below as single choice. Text questions must use this table. Structured questions must use the mode as the short label and its actual impact as the description, not just `merge`, `push`, `pull-request`, or `keep`.

| Option | Mode                                          | Actual impact                                                                                                                   |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A      | Archive and keep workspace (`keep`)           | Archive and create an archive commit on the change branch. Do not merge, push, or create a PR; retain the branch and directory. |
| B      | Local merge (`merge`)                         | Archive and create an archive commit, then merge the change branch into the target branch locally. Do not push or create a PR.  |
| C      | Archive and push (`push`)                     | Archive and create an archive commit, then push the change branch. Do not merge into the target branch or create a PR.          |
| D      | Archive, push, and create PR (`pull-request`) | Archive and create an archive commit, push the change branch, then create a PR using the target branch as its base.             |
| E      | Do not archive yet                            | Do not archive or finish the workspace. Retain the active change and workspace for later continuation.                          |

After A, B, C, or D, execute Runtime's complete command for `keep`, `merge`, `push`, or `pull-request` respectively. Stop after E. At Archive-ready:

Before archiving, prepare the archive commit message under the project's active commit conventions; also prepare a merge message for local merge. Apply known format, language, and body requirements directly without asking again. Ask only for conflicting requirements or missing information the user must supply. Pass the archive message through public `--commit-message <text>` and use `--merge-message <text>` only for merge. Pass Unicode or multiline text as one complete argument. Keep default messages when neither project conventions nor the user require a custom message. Project Git hooks continue to run normally.

1. First execute Runtime's complete `archive --dry-run` command, adding the message options above when custom messages are needed. If an isolated workspace has no finish choice, wait for the user: with default messages, run `comet native archive <change-name> --confirmed --finish <chosen mode>` to archive in one step; with custom messages, use the matching `--dry-run --finish` command to preview the archive message and, for merge, the merge message. Apart from the public message options, preserve Runtime's workspace, confirmation, and serial-archive arguments without adding or removing them.
2. On `ready: false`, address only blockers in that response. Do not first query `status`, repeat Archive, or manually commit Native state and verification files.
3. After `ready: true`, check that `commitMessages` match the prepared messages, then execute the single returned `archive --confirmed` command with its message contents intact. Do not repeat the same preview or reconstruct the messages.
4. If dry-run or confirmed fails, follow only the latest structured `continuation` and `workspaceFinishResult.recoveryArgs`; do not infer commands from error text.

A retains the branch and directory; do not remove that worktree during the same Archive. For other ordinary changes, offer cleanup for an archived worktree with no uncommitted changes. Do not ask again if Runtime already cleaned it. Run `git worktree remove` only after user confirmation; keep any worktree with uncommitted changes or active use.

After final Supervisor delivery, Runtime automatically cleans only child and integration worktrees and their branches that are clean and unused. Uncommitted files, a current process inside a directory, or unfinished Git steps cause Runtime to preserve them and return a blocker; never force deletion.

Commit only this change's implementation and formal artifacts; preserve other user edits. After executing Runtime's `commandArgs`, inspect `workspaceFinishResult`. If `blocked`, preserve the workspace and execute the recovery commands in `recoveryArgs`.

When a project Git hook rejects a commit or merge message, the archive may already be sealed while Git finishing remains incomplete. Correct the message for the unfinished step under project conventions and pass its message option in the returned recovery command. Runtime reuses completed archive commits, Spec publication, and merges. Recovery cannot rewrite a completed commit's message; do not bypass hooks or create a replacement change.

If the user or Agent already completed Git finishing manually under valid authorization, first run `comet native doctor <change-name> --json`, then follow its returned recovery command. For local keep / merge finishing, `doctor --repair` clears records only after proving archive identity, committed contents, and the selected completion conditions. Push / pull-request still use Archive to check remote and platform results. Doctor does not commit, merge, or push. An archive directory or portable `done` state does not establish workspace delivery completion; use public status and finish results.

Complete when state is `done` and authorized workspace finishing is `completed` or `kept`; otherwise follow `continuation`. At task completion, call `comet task --complete` with the original request saved at startup, workflow, change, and the same session. Do not run `printenv COMET_TASK` or inspect undeclared environment variables to guess the task.
