# Public CLI Reference

Canonical path: `comet-classic/reference/scripts.md`

This file defines how Classic Skills call Comet Runtime. Use only the public `comet` CLI on PATH. Bundled `comet/scripts/*.mjs` files are internal to installation and Runtime; Skills must not search for or invoke them directly.

## CLI Bootstrap

At workflow entry, run the public `comet` command needed below. For `command not found`, `executable not found`, or `ENOENT`, stop and explain that the Comet CLI installation is incomplete. Do not bypass it by searching Skill files, walking platform directories, or invoking internal bundles. If the CLI starts but returns a nonzero exit code, report the original error instead of retrying with an internal script.

## Public Workflow Commands

Use the public CLI for everyday workflow operations:

```bash
comet classic workspace prepare <change-name> --isolation <current|branch|worktree> --json
comet classic workspace resolve <change-name> --json
comet state select <change-name>
comet state current
comet state clear-selection
comet state check <change-name> <phase> --json
comet state check <change-name> <phase> --recover --json
comet state check <change-name> <phase> --recover --details --json
comet state checkpoint <change-name>
comet state checkpoint <change-name> --file <json-path>
comet state sync-plan <change-name>
comet state delivery <change-name>
comet state delivery <change-name> --verify
comet state delivery <change-name> --file <json-path>
comet state complete-build <change-name> --checks <checks-json-file>
comet guard <change-name> verify --report <report-ref> --apply --checks <checks-json-file>
# Compat: record the actual platform result without executing command text.
comet state record-check <change-name> <build|verify> --command "<actual command>" --exit-code <actual exit code>
comet guard <change-name> <phase> --apply
comet handoff <change-name> design --write
comet archive <change-name>
comet resume-probe . --stdin --json
comet classic intent route --stdin
```

Run workspace prepare during Open. If the workspace is unknown, changes, or its previous selection is invalid, run workspace resolve, enter the returned projectRoot, then select. For normal phase handoffs, reuse valid selection without rescanning Worktrees. Source writes must belong to the selected change.

Entry check --json returns layout, configuration, nextAction, task summaries, coordination, and delivery. Do not separately query fields already returned. If session recovery lacks context, start with --recover for a summary; add --details only for complete tasks, checkpoints, or evidence. See context-recovery.md.

Query only information still missing for the current action. Putting multiple `comet` commands in one shell call reduces tool round trips; each CLI still starts separately. Reduce redundant calls by reusing fields already returned. For dependent commands, run the next only after the previous succeeds and check every exit code; a successful last command must not hide an earlier failure.

Task reads, stable IDs, completion, and checkpoints support SDK and Compat. They do not advance the SDK Run or replace checks, phase approval, or complete-build. The same tasks.md remains completion authority. Continue from the current Run after coordination updates without querying again just to discover the next step.

checkpoint input requires schemaVersion:1 and taskIds/stage/sessionId/evidence/unresolved/reviewRounds; reads return `{checkpoint, stale}`. Runtime validates the data and generates Markdown. See context-recovery.md for JSON. task-complete automatically synchronizes legacy-plan tasks with established comet-task ID mappings. Use sync-plan for a separate update; planSync mapping-required requires completing mappings, not reimplementing tasks.

delivery input includes action (local|push|pr), targetBranch, and optional remote, commit, and prUrl; see comet-archive for examples. Normal entry and delivery reads do not access the network. Only `state delivery <change-name> --verify` checks remote and PR state read-only, returning `{delivery, verification}`. A successful record write does not prove delivery success. Stop for unavailable commands, rejected operations, or inconsistent records; do not bypass checks by editing internal state.

guard `--apply` updates state after checks pass. Use `comet state transition` when directly invoking a state-machine event. After phase advancement, follow auto-transition.md using the successful result's `agent.continuation`. Query next only when returned state is missing or invalid.

## Automatic State Updates

guard accepts `--apply` to update the actual state file automatically after validation:

```bash
comet guard <change-name> <phase> --apply
```

`--apply` invokes state-machine transitions internally. To invoke an event directly, use:

```bash
comet state transition <change-name> open-complete
comet state transition <change-name> design-complete
comet state transition <change-name> build-complete
comet state transition <change-name> verify-pass
comet state transition <change-name> verify-fail
comet state transition <change-name> archive-confirm
comet state transition <change-name> archive-reopen
comet state transition <change-name> archived
comet state transition <change-name> preset-escalate
```

Archive through `comet archive <change-name>`. OpenSpec first moves the change into a date-prefixed archive directory; Comet then records state. Update pre-archive confirmation through `archive-confirm` or `archive-reopen`. Do not manually run the `archived` transition outside the archive procedure.

## Check Commands and Result Reuse

Follow [ordinary commands and checks](../../comet/reference/platform-execution.md): use platform tools, inspect original tasks and side effects, judge result applicability, and submit actual reports. Comet does not repeat checks or maintain ordinary-command content snapshots, process supervision, or recovery. Guard and status do not start builds or tests.

## Resolving the Next Step

After the phase Guard advances phase, follow auto-transition.md and prefer `agent.continuation` from the successful JSON result. The next phase can use this returned state without repeating next, select, or check. Query only when session recovery lacks context, external state changes, or an older result lacks this information:

```bash
comet state next <change-name>
```

Plain `state next` only reads the next step. When the response gives `comet state next <change-name> --continue --json`, execute that business command. CLI submits accepted artifacts and actual check receipts in the original Run and continues recorded commands and approved internal steps. The Agent need not fill SDK Actions, claim tokens, or evidence digests. Missing selected commands, Agent work, user decisions, real failures, and unknown executions return the current next step. Submitting an original check receipt does not execute its command again.

Output includes `NEXT: auto|manual|done|delivery`, `SKILL: <skill-name>` (omitted for `done`), and `HINT` (only for `manual`). `auto_transition: false` returns `manual`: it prevents automatic invocation of the next Skill without changing the phase already advanced. `delivery` means the change is archived: finish delivery from the delivery summary instead of advancing phases.

## Archive Command

Run all archive steps with:

```bash
comet archive <change-name>
```

## Shared phase entry

After entry returns layout, follow [artifact layout](classic-layout.md) to bind the `<classic-*>` logical roots. Reuse the protocol when it is already loaded and its binding remains valid in this session. Use the Comet adapter for OpenSpec CLI calls and these logical roots for file paths, without an extra root show.

When edits need an impact judgement or continuation points to content judgement, read and follow [edit continuation](../../comet/reference/edit-review.md). The current Agent handles changes in the original Run, retains valid approvals and checks, and adds only affected evidence. User confirmations, implementation methods, TDD, reviews, and fixed-application requirements still follow the current phase's instructions.

## Task Context and Artifact Language

When troubleshooting a familiar issue, checking a project convention, or saving a reusable lesson after a fix passes verification, see [Use and save memory on demand](../../comet/reference/task-learning.md). Prefer the single-item commands below. Use `comet task --complete --learning-file <file>` when combining several items.

Every OpenSpec and Superpowers artifact must use the configured Comet artifact language, a normalized language ID: `en` or `zh-CN`. For an existing change, prefer `configuration.language` from the current valid entry. Only if entry omits it, read `language` in the actual state file through `comet state get <name> language`. When neither state filename exists, read `classic.language` from project `.comet/config.yaml`, then global `~/.comet/config.yaml`. Use the current user request's language only when neither is configured. Explicitly include the resolved language in prompts or ARGUMENTS sent to external OpenSpec/Superpowers Skills.

When a claim response includes `data.contextDelivery`, read `data.context[].text` and start work without repeating `contextRequest`. Use `data.contextActions.expand`, `restore`, and `complete` for full text, recovery, and learning submission respectively. New Agents use their own session IDs. Empty or unavailable retrieval does not block the task.

Without automatic delivery, retrieve task context using the current `agent.continuation.contextRequest`; for a claimed SDK Action, prefer that Action's `contextRequest`. When the same session has verifiable delivery records and the full text remains in context, keep its session ID across phase changes and use `--context-mode incremental` to retrieve newly applicable content. Phase-specific rules still need loading. Use a full snapshot for a new Agent, compressed or restored context, or incomplete delivery records. This protocol covers full, hotfix, tweak, SDK, Compat, and standalone phase entry. Ordinary status reads, waiting for an existing task, and uninterrupted work within a phase do not require another retrieval.

Without a request descriptor, bind the actual workspace, read the current `phase`, and run `comet task <project-root> --task "<original user request>" --phase "<phase>" --session "<stable receiving session id>" --context-mode snapshot --json`. Recover a missing task goal from the current proposal, specs and task scope. Keep the current Agent's session ID across phase changes; a new Agent uses its own ID, never the dispatcher's or another Action owner's ID. A restored Agent keeps its original ID and requests a snapshot so earlier delivery records do not suppress the restored context.

Add `context[].text` to context. Context Manifest (`manifest` / `<context_manifest>`) contains summaries, selection reasons and stable IDs; add `--expand-context "<id>"` to the same request when full text, sources or verification methods are needed. During uninterrupted work in one phase, use the same `--session` with updated `--path` or `--operation` and `--context-mode incremental` for new content. A repeated `contextRequest` in a status response does not itself require another retrieval. Continue with explicit instructions after empty or failed retrieval; do not loop on retries.

When dispatching implementation, review or another child task, pass the phase, task scope, actual workspace, valid configuration, applicable preferences and project constraints, together with this context request. Each receiver retrieves once with its own session ID. Use `verify` only for an independent acceptance phase; reviews within Build still use `build`. Preserve child task boundaries: inherited preferences cannot expand write scope or remove independent review.

When a preference requests a Skill, load it through the current host's actual capabilities and specify the required method. Explain conflicts with confirmed execution, TDD or review configuration or fixed Skills. Use the existing approval flow for configuration changes; do not silently replace configuration or ask again about valid decisions. Explain unavailable or incompatible choices and continue the executable work. Distinguish preference delivery, Skill loading and method execution; retrieval success is not execution success. Keep memory out of `handoff_context`, `handoff_hash` and other approval or acceptance bindings. Memory changes alone do not trigger rollback and cannot replace Runtime checks, user authorization or required review.

If `<active_policies>` includes `<verification command="...">`, add those commands to current Verify checks and record their actual results. Only commands that have actually passed can promote the corresponding policy to enforced.

Use `comet memory remember ... --scope global|project` when the user explicitly asks to retain a preference or project convention long-term. Add repeatable `--phase` only for explicitly limited applicability, for example `--phase build --phase verify`; correct an existing record with `comet memory correct <project-root> --id <id> --phase build --phase verify --json`. Save only explicit phase conditions without expanding their scope. Use `comet memory observe --text "<preference>" --workflow <classic|native> --change <change-id> --candidate-key <change-id>-<behavior-slug>` only for stable collaboration habits reusable across tasks without an explicit request (all three options are required; build `--candidate-key` from the change ID plus a short behavior slug). Neither may store task summaries, progress, command output, or test results.

Project Memory and Personal Memory are separate. To save a lesson verified in this project that could help on a future task, use:

```text
comet knowledge remember <project-root> --title "<concise title>" --text "<symptom, approach, verification>" --type <fact|decision|pattern|procedure|constraint|failure-resolution> --workflow classic --change <change-id> --evidence "<source files, comma-separated>" --json
```

The same title updates the existing entry. Use `--evidence` to reference supporting project files, and omit it for collaboration decisions without file evidence. Before applying a lesson, expand it with `--expand-context "project-memory:<slug>"` and check its applicability against current evidence. If a reference is unavailable or the conclusion has changed, review the lesson and update the existing entry. Never save task summaries, one-off command output, or unverified guesses.

At task completion, run `comet task <project-root> --task "<original user request>" --complete --workflow classic --change <change-id> --json`. When there is no qualifying observation, reusable lesson, or known pending review, use the default `not-run` and finish without calling review or creating an empty actions file.

When submitting learning, use the actual receipts. For submitted personal observations, pass `--learning-check submitted`. For saved project lessons, pass `--project-learning-check submitted --memory <returned slug>`, separating multiple slugs with commas. Use `no-observation` only for a check you performed and found nothing to submit. The first implicit observation enters `trial`. A second independent successful observation from another change may promote it.

When processing a known pending review, run `comet knowledge review <project-root> --workflow classic --change <change-id> --json` for `recordFields` and source evidence. Submit the actions with `--id <id> --file <actions.json>`. Process only this change. If the review yields no reusable conclusion, you can submit `[]`. `applied` means the submission took effect, and `accepted` means it was received. Use the returned `nextActions` for pending work. Development can finish while learning is still pending.

When you know the result of actually using an item, take `applications[].applicationId` from JSON (or `application_id` from Hook text) and pass `--application <id> --outcome <result>` to `comet task`. Successful use requires an actual decision and passing verification evidence. See `comet task --help` for arguments.

Without Hooks, the Skill calls the same interface. `comet memory context` is only a compatibility entry. Missing plugin results or failed calls do not block the workflow.
