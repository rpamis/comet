# Context Compression Recovery Protocol

Canonical path: `comet/reference/context-recovery.md`

This protocol is shared by all comet sub-skills that may trigger context compression. When the agent suspects context compression has occurred (previous conversation summarized, cannot find previously discussed content), follow this protocol to recover.

## Any-Entry Recovery Principle

The user may resume the workflow directly from `/comet-open`, `/comet-design`, `/comet-build`, `/comet-verify`, `/comet-archive`, `/comet-hotfix`, or `/comet-tweak`. On entry to any sub-skill, first locate scripts via `comet/reference/scripts.md`, then run the entry check or recovery check for that sub-skill's phase. Do not infer phase from conversation history.

```bash
comet state check <change-name> <phase> --recover
```

If the check shows the actual phase, workflow, or evidence belongs to another skill, switch according to script output and `/comet` routing rules; do not keep writing state in the wrong phase. If the worktree has uncommitted changes, attribute them first via `comet/reference/dirty-worktree.md`.

## Recovery Without Explicit `/comet`

If the user did not mention `/comet`, but this repository may have an active change, run the Ambient Resume probe before starting work that may need code changes or investigation. First locate scripts via `comet/reference/scripts.md` and ensure `$COMET_RESUME_PROBE` is available, then pass the current user request on stdin:

```bash
node "$COMET_RESUME_PROBE" probe --stdin
```

Only `auto_resume` should resume automatically; `ask_user` must ask one short question; `out_of_scope` and `none` do not enter the workflow.

## Recovery Steps

```bash
comet state check <change-name> <phase> --recover
```

The script outputs structured recovery context (phase, completed fields, pending fields, recovery action). Follow the **Recovery action** output for next steps.

## Build Phase Special Recovery

If the recovery script outputs `build_mode: subagent-driven-development`:

1. Use the Skill tool to reload the Superpowers `subagent-driven-development` skill
2. Re-read `comet/reference/subagent-dispatch.md` for Comet-specific extensions
3. Read `openspec/changes/<name>/.comet/subagent-progress.md` to recover the current task or final review, implementation commit, RED/GREEN evidence, passed reviews, unresolved feedback, and review-fix round
4. Do not execute tasks directly in the main session
5. Resume from the checkpoint's exact stage; begin implementer dispatch for the first unchecked task only when the checkpoint is missing or mismatched
6. After `review_mode` validation and targeted checkoff verification pass, immediately continue to the next task without summarizing or asking whether to continue

## Design Phase Special Recovery

- If the user has not yet confirmed the design approach, return to brainstorming
- If the user has confirmed, continue creating the Design Doc
- On recovery, reload `brainstorm-summary.md` + handoff context files

## Verify/Archive Phase Recovery

- Verify: script outputs verification status, branch status, and recovery action
- Archive: if `archived: true` and archive directory exists, archival is complete — do not re-execute
