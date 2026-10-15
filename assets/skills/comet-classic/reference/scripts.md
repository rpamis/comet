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
comet check run <change-name> <build|verify> --local -- <program> [args...]
comet check rerun <change-name> <build|verify>
comet guard <change-name> <phase> --apply
comet handoff <change-name> design --write
comet archive <change-name>
comet resume-probe . --stdin --json
comet classic intent route --stdin
```

Run workspace prepare during Open. If the workspace is unknown, changes, or its previous selection is invalid, run workspace resolve, enter the returned projectRoot, then select. For normal phase handoffs, reuse valid selection without rescanning Worktrees. Source writes must belong to the selected change.

Entry check --json returns layout, configuration, nextAction, task summaries, coordination, and delivery. Do not separately query fields already returned. If session recovery lacks context, start with --recover for a summary; add --details only for complete tasks, checkpoints, or evidence. See context-recovery.md.

Query only information still missing for the current action. Putting multiple `comet` commands in one shell call reduces tool round trips; each CLI still starts separately. Reduce redundant calls by reusing fields already returned. For dependent commands, run the next only after the previous succeeds and check every exit code; a successful last command must not hide an earlier failure.

checkpoint input requires schemaVersion:1 and taskIds/revision/stage/sessionId/evidence/unresolved/reviewRounds; reads return `{checkpoint, stale}`. Runtime validates the data and generates Markdown. See context-recovery.md for JSON. task-complete automatically synchronizes legacy-plan tasks with established comet-task ID mappings. Use sync-plan for a separate update; planSync mapping-required requires completing mappings, not reimplementing tasks.

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

## Check Evidence and Input Declarations

Check evidence reuses by "input scope": the default inputs are working-tree file contents. Commits, staging, ticking tasks.md checkboxes, and environment variable changes no longer invalidate evidence by default; when a build or test actually reads such information, declare the binding through `.comet/check-policy.json`.

The same full command recorded with `--local` (matching argv, cwd, inputs, and environment) can be reused across Build and Verify. Runtime binds the existing evidence to the current phase and returns `reused=true`; do not rerun it merely because the phase name changed. An explicit failure, manual declaration, stale record, or cwd mismatch is reported with its recovery command before any detected build command is considered.

After a Runtime-recorded command fails or is interrupted while snapshotting inputs or launching, use `comet check rerun <change-name> <build|verify>`. Runtime persists argv, cwd, timeout, and reuse tier before execution, so an interrupted attempt retries unchanged instead of running another auto-detected build or reconstructing shell syntax. Guard keeps showing a fresh `comet check run` template only for manual legacy records that have no Runtime argv.

When guard reports evidence as not reusable, it prints the invalidation reason and the changed file list (`Why:`, `Changed inputs:`, `Relevance scope:`). Use that list to decide which command to rerun instead of rerunning everything.

`--incremental` records phase-local evidence: guard previews accept it for quick confirmation, while `--apply` still requires one full rerun of the complete command before advancing the phase. The caller chooses the incremental command (for example, running only related tests); incremental evidence always requires a rerun after cold recovery.

```bash
comet check run <change-name> build --local -- <program> [args...]
comet check run <change-name> verify --local --incremental -- <program> [args...]
```

`.comet/check-policy.json` declares an input scope per command. In the v2 format each command is scoped independently and only the entry matching `argv` and `cwd` applies; editing or adding other entries does not affect this command's existing evidence. `files` accepts literal paths and the `*`, `?`, and `**` wildcards; newly added matching files are picked up automatically without changing the declaration. When a build rewrites files inside its input area, declare those artifacts with `outputs`; Runtime excludes them from that command's input snapshot so the command does not invalidate itself:

```json
{
  "version": 2,
  "commands": [
    {
      "argv": ["pnpm", "build"],
      "cwd": ".",
      "files": ["src/**", "package.json", "tsconfig.json"],
      "outputs": ["dist/**"],
      "git": "all"
    },
    { "argv": ["vitest", "run"], "cwd": ".", "files": ["src/**", "test/**"] }
  ]
}
```

Omitted fields keep the defaults: `git` defaults to `none` (no HEAD or index binding), `env` binds no variables (the resolved executable path and its file identity plus the Node version always bind, so switching Node versions still invalidates evidence), and `taskCheckboxes` defaults to `ignore` (ticking tasks does not invalidate evidence; task text changes still do). Declare `git: "all"` when build artifacts embed a commit SHA, list variable names in `env` when the result depends on them, and declare `taskCheckboxes: "include"` when completion marks themselves affect the check result. The older v1 single-command format remains valid and keeps its original semantics.

An entry's `cwd` also declares where that command's evidence belongs. By default the guard reuses only evidence whose cwd matches its own invocation directory; a command matched by a v2 entry may record evidence in the entry's declared `cwd` instead. When a build or verification entry point lives in a subdirectory, declare the command as actually executed (for example `{ "argv": ["npm", "run", "build"], "cwd": "ui/frontend" }`), record it with `--cwd ui/frontend`, and a guard invoked from the project root reuses it. Undeclared commands still require evidence from the guard's invocation directory.

## Resolving the Next Step

After the phase Guard advances phase, follow auto-transition.md and prefer `agent.continuation` from the successful JSON result. The next phase can use this returned state without repeating next, select, or check. Query only when session recovery lacks context, external state changes, or an older result lacks this information:

```bash
comet state next <change-name>
```

Output includes `NEXT: auto|manual|done|delivery`, `SKILL: <skill-name>` (omitted for `done`), and `HINT` (only for `manual`). `auto_transition: false` returns `manual`: it prevents automatic invocation of the next Skill without changing the phase already advanced. `delivery` means the change is archived: finish delivery from the delivery summary instead of advancing phases.

## Archive Command

Run all archive steps with:

```bash
comet archive <change-name>
```

## Task Context and Artifact Language

Every OpenSpec and Superpowers artifact must use the configured Comet artifact language, a normalized language ID: `en` or `zh-CN`. For an existing change, prefer `configuration.language` from the current valid entry. Only if entry omits it, read `language` in the actual state file through `comet state get <name> language`. When neither state filename exists, read `classic.language` from project `.comet/config.yaml`, then global `~/.comet/config.yaml`. Use the current user request's language only when neither is configured. Explicitly include the resolved language in prompts or ARGUMENTS sent to external OpenSpec/Superpowers Skills.

On first entering a phase, handing work to a new Agent, or restoring context, retrieve task context once using the current `agent.continuation.contextRequest`. For a claimed SDK Action, prefer that Action's `contextRequest` in `data.continuation.current.actions[]`. This protocol covers full, hotfix and tweak in SDK and Compat, including direct stage Skill invocation. Ordinary status reads, waiting for an existing task and uninterrupted work within a phase do not require another retrieval.

Without a request descriptor, bind the actual workspace, read the current `phase`, and run `comet task <project-root> --task "<original user request>" --phase "<phase>" --session "<stable receiving session id>" --context-mode snapshot --json`. Recover a missing task goal from the current proposal, specs and task scope. Keep the current Agent's session ID across phase changes; a new Agent uses its own ID, never the dispatcher's or another Action owner's ID. A restored Agent keeps its original ID and requests a snapshot so earlier delivery records do not suppress the restored context.

Add `context[].text` to context. Context Manifest (`manifest` / `<context_manifest>`) contains summaries, selection reasons and stable IDs; add `--expand-context "<id>"` to the same request when full text, sources or verification methods are needed. During uninterrupted work in one phase, use the same `--session` with updated `--path` or `--operation` and `--context-mode incremental` for new content. A repeated `contextRequest` in a status response does not itself require another retrieval. Continue with explicit instructions after empty or failed retrieval; do not loop on retries.

When dispatching implementation, review or another child task, pass the phase, task scope, actual workspace, valid configuration, applicable preferences and project constraints, together with this context request. Each receiver retrieves once with its own session ID. Use `verify` only for an independent acceptance phase; reviews within Build still use `build`. Preserve child task boundaries: inherited preferences cannot expand write scope or remove independent review.

When a preference requests a Skill, load it through the current host's actual capabilities and specify the required method. Explain conflicts with confirmed execution, TDD or review configuration or fixed Skills. Use the existing approval flow for configuration changes; do not silently replace configuration or ask again about valid decisions. Explain unavailable or incompatible choices and continue the executable work. Distinguish preference delivery, Skill loading and method execution; retrieval success is not execution success. Keep memory out of `handoff_context`, `handoff_hash` and other approval or acceptance bindings. Memory changes alone do not trigger rollback and cannot replace Runtime checks, user authorization or required review.

If `<active_policies>` includes `<verification command="...">`, add those commands to current Verify checks and record their actual results. Only commands that have actually passed can promote the corresponding policy to enforced.

Use `comet memory remember ... --scope global|project` when the user explicitly asks to retain a preference or project convention long-term. Add repeatable `--phase` only for explicitly limited applicability, for example `--phase build --phase verify`; correct an existing record with `comet memory correct <project-root> --id <id> --phase build --phase verify --json`. Save only explicit phase conditions without expanding their scope. Use `comet memory observe --text "<preference>" --workflow <classic|native> --change <change-id> --candidate-key <change-id>-<behavior-slug>` only for stable collaboration habits reusable across tasks without an explicit request (all three options are required; build `--candidate-key` from the change ID plus a short behavior slug). Neither may store task summaries, progress, command output, or test results.

Project Memory and Personal Memory are separate. Before every task ends, write project-validated and reusable experience to Project Memory:

```text
comet knowledge remember <project-root> --title "<concise title>" --text "<symptom, approach, verification>" --type <fact|decision|pattern|procedure|constraint|failure-resolution> --workflow classic --change <change-id> --evidence "<source files, comma-separated>" --json
```

The same title updates the existing entry. `--evidence` binds project files that support the conclusion; omit it for collaboration decisions without file evidence. Before applying an existing lesson, expand it with `--expand-context "project-memory:<slug>"` and check its sources. Verify and update it when sources change or become unreadable. Never save task summaries, one-off command output, or unverified guesses.

Before task completion, the Agent performs a separate project learning check:

1. Run `comet knowledge review <project-root> --workflow classic --change <change-id> --json` and process only this change's pending reviews.
2. Using the returned `recordFields` and source evidence, the Agent writes actions and submits them with `--id <id> --file <actions.json>`. Submit `[]` when there is no reusable lesson. The user does not write JSON. Confirm `submission.status` is `applied`; `accepted` means the actions were received.
3. After saving project lessons, pass `--project-learning-check submitted --memory <returned slug>` to completion; separate multiple receipts with commas. Pass `no-observation` if there is no reusable lesson, or `not-run` if no check occurred.
4. Report project learning complete only when `projectLearning.submissionVerified` is `true` and both `pendingHostReviewCount` and `pendingReflectionCount` are `0`. Otherwise follow `nextActions` and report unfinished work. Learning failures do not block completed development work.

Before every task ends, complete one learning check. If there is a user correction, preference, or collaboration habit with a clear reuse condition, call `comet memory observe` and pass `--learning-check submitted` to the completion command. If you checked and found no qualifying observation, pass `--learning-check no-observation`; if no check was performed, pass `--learning-check not-run`. The first observation creates only a `trial` candidate, while a second independent successful observation from another change may promote it. Use the observation JSON `learning.result` and `status.learning.lastCheck` to diagnose the result.

After actually using an item and learning its result, take `applications[].applicationId` from JSON (or `application_id` from Hook text) and run `comet task <project-root> --task "<original user request>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`. Report outcomes truthfully; never mark unused items as successfully used. At task end, run `comet task` with `--complete --workflow classic --change <change-id> --learning-check submitted|no-observation|not-run --project-learning-check submitted|no-observation|not-run [--memory <slug>]` to record the two learning checks independently.

Without Hooks, the Skill calls the same interface. `comet memory context` is only a compatibility entry. Missing plugin results or failed calls do not block the workflow.
