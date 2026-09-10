# Context Compaction Recovery Protocol

Canonical path: `comet-classic/reference/context-recovery.md`

## Entry and On-Demand Recovery

Follow scripts.md to confirm the public CLI and selected workspace. Ordinary phase handoffs run one entry check:

```bash
comet state check <change-name> <phase> --json
```

Normal and cold-recovery entry both provide layout, configuration, nextAction, taskState, coordination, and delivery. taskState is `{authority, revision, total, completed, needsIds, next}`; coordination is `{path, stale, taskIds, stage, sessionId, reviewRounds, unresolved}`. Bind logical paths under classic-layout.md and route by actual phase. Do not query returned summaries field by field again. Refresh affected state after writes or workspace/requirement changes.

nextAction is `{kind, reason, taskId?}`. Read reason first, then continue by kind: reconcile-task inspects actual work, review completes review, checkoff records accepted completion, check completes checks, reconcile-plan repairs legacy mapping/synchronization, plan restores a valid plan, configure completes settings, workspace restores ownership, and delivery handles authorized delivery. This is not permission to bypass acceptance; taskId must match the task authority.

Use recovery only on cold start, after compaction, or when recovery evidence is insufficient:

```bash
comet state check <change-name> <phase> --recover --json
```

Locate the unfinished action using the compact recovery pack first. Request `--details` explicitly when full tasks and checkpoints are needed: this adds tasks to taskState and checkpoint to coordination:

```bash
comet state check <change-name> <phase> --recover --details --json
```

Read only the text missing for the current action. Runtime marks check evidence `revalidated` or `rerun-required`; only the former is reusable. Rerun only the corresponding checks when local inputs, environment, logs, or single-use evidence fail validation. Recovery does not clear plans, tasks, reviews, or used review rounds.

When Classic was not explicitly invoked but the repository may contain an active change, follow scripts.md and send the current request on stdin to `comet resume-probe . --stdin --json`. Only auto_resume resumes automatically; ask_user requires a short question; out_of_scope/none do not enter the workflow.

## Task Reconciliation and Checkoff

`tasks.md` is the sole authority for task completion; the plan describes implementation methods. An unchecked box is not a reason to reimplement, and a checked box does not replace current acceptance evidence.

1. Match stable task IDs, requirement revision, and plan base-ref against current files, Git diff/commits, check results, reviews, and unresolved feedback. Attribute uncommitted work under dirty-worktree.md first.
2. When implementation, checks, and required review are satisfied, use task-complete to check off directly without repeating implementation.
3. If implementation exists but evidence is incomplete, complete only missing checks or independent review; for partial implementation, finish only the remainder. Report missing historical TDD RED honestly; do not revert code to fabricate evidence or declare TDD satisfied yourself.
4. If evidence no longer matches current inputs, revalidate only affected work, then check off after acceptance.
5. Use `comet state task-complete <name> <task-id> --expect <revision> --json`. On revision conflict, reassess task meaning instead of merely obtaining a new revision and retrying.

For legacy plan checkboxes, establish explicit comet-task ID mappings first. task-complete automatically synchronizes mapped legacy plans from tasks.md. To refresh the projection separately:

```bash
comet state sync-plan <name>
```

On `planSync: mapping-required`, repair explicit ID mappings and run sync-plan; do not reimplement or reassess already accepted tasks. The plan is a display projection, not a second completion criterion. Assign stable IDs to legacy tasks through tasks --assign-ids. Do not guess mappings by number, position, or similar titles. Reconcile scope and add genuine extra legacy-plan tasks to tasks.md. Record unresolved mappings and clarify rather than deleting items to pass. A checked plan box is not implementation evidence.

## Runtime Coordination Records

The coordination record managed by `state checkpoint` lives at `<classic-change-dir>/.comet/coordination.json`; its human-readable projection remains `.comet/subagent-progress.md`. `.comet/checkpoint.json` belongs to Engine, not coordination. Never manually modify or overwrite it, or use it as an output target for --file.

Do not read again when the entry coordination summary is sufficient. To read full records or save state:

```bash
comet state checkpoint <change-name>
comet state checkpoint <change-name> --file <json-path>
```

JSON must include `schemaVersion: 1`, plus taskIds/revision/stage/sessionId/evidence/unresolved/reviewRounds. Replace the task IDs, revision, and session identifier in this example with actual values:

```json
{
  "schemaVersion": 1,
  "taskIds": ["task-1"],
  "revision": "<task-revision>",
  "stage": "implementing",
  "sessionId": "<implementer-session-id>",
  "evidence": [],
  "unresolved": [],
  "reviewRounds": 0
}
```

evidence contains actual commit, RED/GREEN, and review references; unresolved contains outstanding issues, not the full conversation. stage identifies the actual implementation/review/checkoff step; reviewRounds preserves used rereview rounds. Runtime validates and generates Markdown. Do not handwrite subagent-progress.md or treat coordination as the task completion list.

Reads return `{checkpoint, stale}`. If stale is true, reconcile revision, scope, and actual work before replaying actions; a null checkpoint does not mean unimplemented. Reread after repairing records to confirm success. Do not bypass validation by editing internal state.

Persist task scope and the coordinating session before dispatch. Save sessionId as soon as dispatch returns it, before further waiting or processing responses. Save new evidence and the next action at phase handoff, review, acceptance, and blocked boundaries. Coalesce fragmentary messages within a step rather than copying every reply. On save failure, stop further dispatch and progression while preserving files for inspection.

For missing records, unavailable sessions, or revision mismatch, inspect actual work and rebuild the smallest necessary record. No checkpoint does not mean no implementation. Preserve valid reviews and used rounds; do not reset the budget for a new session.

## Phase-Specific Recovery

- Build: retain valid plans and configuration. Autonomous does not load external execution Skills; other strategies load methods only when absent from context. Follow subagent-dispatch.md to restore bounded work packages and original implementers; subagent-driven-development does not allow main-session takeover. When tasks are complete, return to Build exit checks, not old Build final-review/final-fix states.
- Design: continue clarifying unconfirmed proposals; after confirmation, complete only the formal Design Doc or missing state writes. Read brainstorm-summary.md and one Markdown handoff as needed; Runtime validates machine JSON by default. Do not reload all duplicate context.
- Verify: reconcile the report, actual diff, and valid review evidence. Complete only missing checks or affected review, without restarting the whole phase from scale assessment.
- Archive: ordinary entry and delivery reads do not access the network. Use `comet state delivery <change-name> --verify` for read-only Git/remote/PR verification and inspect `{delivery, verification}` for authorization and actual results. Do not repeat existing archives or commits, or push/create PRs already delivered. handled implies neither authorization nor success; follow Archive confirmation rules for missing records or changed targets.
