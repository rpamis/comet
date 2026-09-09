# Context Compression Recovery Protocol

Canonical path: `comet-classic/reference/context-recovery.md`

This protocol is shared by all comet sub-skills that may trigger context compression. When the agent suspects context compression has occurred (previous conversation summarized, cannot find previously discussed content), follow this protocol to recover.

## Any-Entry Recovery Principle

The user may resume the workflow directly from `/comet-open`, `/comet-design`, `/comet-build`, `/comet-verify`, `/comet-archive`, `/comet-hotfix`, or `/comet-tweak`. On entry to any sub-skill, use `comet-classic/reference/scripts.md` to run the public CLI command, then run the entry check or recovery check for that sub-skill's phase. Do not infer phase from conversation history.

```bash
comet state check <change-name> <phase> --json
```

If the check shows the actual phase, workflow, or evidence belongs to another skill, switch according to script output and `/comet-classic` routing rules; do not keep writing state in the wrong phase. If the worktree has uncommitted changes, attribute them first via `comet-classic/reference/dirty-worktree.md`.

## Recovery Without Explicit `/comet-classic`

If the user did not mention `/comet-classic`, but this repository may have an active change, run the Ambient Resume probe before starting work that may need code changes or investigation. Use `comet-classic/reference/scripts.md` to run the public CLI command, then pass the current user request on stdin:

```bash
comet resume-probe . --stdin --json
```

Only `auto_resume` should resume automatically; `ask_user` must ask one short question; `out_of_scope` and `none` do not enter the workflow.

## Recovery Steps

```bash
comet state check <change-name> <phase> --recover --json
```

The recovery package returns change/workspace identity, phase, configuration, taskState (canonical tasks.md path, revision, stable IDs and completion), checkpoint, evidence.scopes, and required file paths. Route by actual phase. Read only files needed for the action; do not repeat returned configuration or checkpoint reads.

Use `--recover` only for cold start or genuine context loss; ordinary phase handoffs use the entry check without that flag. Runtime rechecks Build/Verify evidence independently: `revalidated` means local evidence passed current input, environment, and log validation; `rerun-required` means that scope needs execution. Nonreusable evidence still requires rerunning, not an Agent validity claim. Recovery preserves task, plan, and review records without unconditionally rerunning all checks.

Inspect actual files, commits, task IDs, and unresolved feedback. Refresh entry after requirement or implementation changes; do not retain conclusions from an old recovery package. Checkbox completion alone is not a requirements change and cannot replace independent review.

## Build Phase Special Recovery

If the recovery script outputs `build_mode: subagent-driven-development`:

1. Use the Skill tool to reload the Superpowers `subagent-driven-development` skill
2. Re-read `comet-classic/reference/subagent-dispatch.md` for Comet-specific extensions
3. Read `<classic-change-dir>/.comet/subagent-progress.md` to recover the task, original implementer session, commit, RED/GREEN evidence, passed reviews, unresolved feedback, and review-fix round; do not restore a Build final review
4. Do not execute tasks directly in the main session
5. Align taskState, checkpoint, and `.comet/rulings.md` by stable ID. Resume the original implementer and exact review stage. If checkpoints are absent or mismatched, inspect implementation, commits, and review evidence before reconstructing one; unchecked does not mean unimplemented. Migrate legacy tasks explicitly under Build rules, never by position alone
6. After acceptance under `review_mode`, use task-complete with the ID and inspected revision. Reevaluate semantic conflicts instead of retrying blindly. Do not restore old Build final-review/final-fix states: Verify owns final review. Normal task handoffs need no continuation question

## Design Phase Special Recovery

- If the user has not yet confirmed the design approach, return to brainstorming
- If the user has confirmed, continue creating the Design Doc
- On recovery, reload `brainstorm-summary.md` + handoff context files

## Verify/Archive Phase Recovery

- Verify: script outputs verification status, branch status, and recovery action
- Archive: if `archived: true` and archive directory exists, archival is complete — do not re-execute
