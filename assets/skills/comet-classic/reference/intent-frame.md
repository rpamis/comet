# CometIntentFrame Field Reference

Read when starting a new request, when the target change is unclear, or when routing-field meanings are needed. Normal handoffs for a bound change follow Runtime continuation without refilling intent data.

First run `comet classic openspec -- list --json` to list active changes. Fill the example below from the user's words, that list, and necessary repository information. After `comet classic intent route --stdin`, Runtime fills omitted defaults and computes the final `route`.

**Minimal CometIntentFrame Example**:

```json
{
  "schema_version": "comet.intent.v1",
  "utterance": "<user request>",
  "intent": { "name": "start_change", "confidence": 0.8 },
  "slots": {
    "requested_action": "start",
    "workflow_candidate": "full",
    "user_explicit_workflow": null,
    "change_id": null,
    "existing_behavior": null,
    "new_capability": null,
    "public_api_change": null,
    "schema_change": null,
    "cross_module_change": null
  },
  "context": {
    "active_changes_count": 0,
    "active_change_names": []
  },
  "evidence": [],
  "proposed_route": {
    "name": "ask_user",
    "confidence": 0.5
  }
}
```

**Extracting Intent Fields from the Request**:
The minimal example is normally sufficient; field meanings follow below. These rules guide extraction. Runtime still computes the final route.

- `fix_bug` with `existing_behavior: true` and no new capability, public API, schema, or cross-module change → tends toward `hotfix`.
- The user explicitly describes a lightweight or medium change that fits within one OpenSpec change, needs OpenSpec apply, and does not require full `/comet-classic` deep design and an implementation plan → tends toward `tweak`.
- Copy, configuration, documentation, prompts, or lightweight-to-medium edits within one OpenSpec change → tends toward `tweak`.
- New capabilities, public API or schema changes, cross-module coordination, or architectural changes → tends toward `full`.
- Multiple active changes without a user-specified target → `ask_user`.
- Insufficient confidence, missing key evidence, or an explicit workflow that does not fit actual risks → `ask_user`.

## Target Selection and Routing

- `hotfix` / `tweak`: load the corresponding Skill when the user explicitly selected it and risks fit the preset. For an Agent recommendation, request confirmation through decision-point.md and retain full as an option.
- `full`: use the table below to decide whether to create or resume. New changes must go through `/comet-open` to create both OpenSpec artifacts and `.comet.yaml`.
- `resume`: once the target is clear, return to the entry to bind its workspace. Query actual phase and recover through context-recovery.md.
- `ask_user`: wait for a target or scope choice through decision-point.md.
- `out_of_scope`: explain that this request does not start or resume the workflow; do not initialize a change.

| Active changes | User input                           | Behavior                                                                                                 |
| -------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| None           | `full` route                         | Invoke `/comet-open`.                                                                                    |
| Exactly one    | `/comet-classic <description>`       | **Ask** whether to continue this change or create a new one.                                             |
| Multiple       | `/comet-classic <description>`       | **Ask** whether to continue existing work or create new work; if continuing, list changes for selection. |
| Exactly one    | `/comet-classic` with no description | Select it automatically, then return to the entry to bind the workspace and read state.                  |
| Multiple       | `/comet-classic` with no description | List changes for the user to select.                                                                     |

## Top-Level Fields

| Field            | Meaning                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version` | Frame version. Currently fixed to `comet.intent.v1`.                                                                                     |
| `utterance`      | The user request that triggered `/comet-classic`.                                                                                        |
| `intent`         | High-level user intent and confidence. If confidence is below the runtime threshold, routing falls back to `ask_user`.                   |
| `slots`          | Routing slots normalized from the user request.                                                                                          |
| `context`        | Repository context read from local state; this is not extracted from the user utterance.                                                 |
| `evidence`       | Evidence for key routing conclusions. Missing key evidence makes the runtime prefer `ask_user`.                                          |
| `proposed_route` | Agent-submitted route candidate. Minimal input only needs `name` and `confidence`; the runtime reviews it and outputs the final `route`. |

## `intent`

| Field               | Meaning                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `intent.name`       | High-level user intent: start, resume, fix bug, make tweak, ask question, or unknown.                                          |
| `intent.confidence` | Agent confidence in the high-level intent. This participates in low-confidence fallback; `proposed_route.confidence` does not. |

## `slots`

| Field                    | Meaning                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requested_action`       | The action the user wants, such as `start`, `resume`, `continue`, `fix`, `modify`, `create`, `verify`, `archive`, or `question`.                                                                       |
| `workflow_candidate`     | Agent-inferred candidate workflow: `full`, `hotfix`, `tweak`, or `null`. This is an inference and the runtime reviews it.                                                                              |
| `user_explicit_workflow` | Whether the user explicitly named a workflow. If the user says "use hotfix", set `hotfix`; otherwise set `null`. Explicit workflow still falls back to `ask_user` when it conflicts with risk signals. |
| `change_id`              | Active change name explicitly requested by the user for resume or operation. Use `null` when unspecified.                                                                                              |
| `existing_behavior`      | Whether the request fixes existing behavior or a regression. `true` with no new capability/API/schema/cross-module risk tends toward `hotfix`.                                                         |
| `new_capability`         | Whether the request adds a new capability. Usually tends toward `full`.                                                                                                                                |
| `public_api_change`      | Whether the request changes a user-visible interface or agreed behavior, such as CLI flags, config fields, JSON output, or public Skill flow. Usually tends toward `full`.                             |
| `schema_change`          | Whether the request changes structured data formats, such as `.comet.yaml`, `run-state.json`, eval manifests, bundle manifests, or config schema. Usually tends toward `full`.                         |
| `cross_module_change`    | Whether the request requires coordination across modules or involves several workflows. Usually tends toward `full`.                                                                                   |
| `target_area`            | Optional explanation field for the target area the user mentioned. The minimal skeleton does not need it.                                                                                              |
| `scope`                  | Optional explanation field for rough scope size. The current scorer does not let it drive routing by itself, and the minimal skeleton does not need it.                                                |

## `context`

| Field                  | Meaning                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active_changes_count` | Number of unarchived active changes from `comet classic openspec -- list --json`. Multiple active changes without a `change_id` route to `ask_user`.     |
| `active_change_names`  | Names of active changes. When the user supplies `change_id`, the runtime checks it against this list.                                                    |
| `dirty_worktree`       | Optional state field. The entry-route minimal skeleton does not need it; dirty worktree handling belongs to `comet-classic/reference/dirty-worktree.md`. |

## `evidence`

Each evidence item contains:

| Field    | Meaning                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| `field`  | Frame field supported by the evidence, such as `intent.name` or `slots.workflow_candidate`. |
| `quote`  | Evidence snippet from the user request, repository state, or `.comet.yaml`.                 |
| `source` | Evidence source: `user`, `repo`, or `state`.                                                |

## `proposed_route`

| Field                   | Meaning                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `name`                  | Agent route candidate: `full`, `hotfix`, `tweak`, `resume`, `ask_user`, or `out_of_scope`.                    |
| `confidence`            | Agent confidence in the route candidate. Diagnostic only; it does not participate in low-confidence fallback. |
| `next_skill`            | Derived field normalized by the runtime. The minimal skeleton does not need it.                               |
| `requires_confirmation` | Derived field normalized by the runtime. The minimal skeleton does not need it.                               |
| `fallback_reason`       | Derived field normalized by the runtime. The minimal skeleton does not need it.                               |

## Routing Notes

- Existing bug, regression, or broken behavior with no new capability/API/schema/cross-module risk: prefer `hotfix`.
- Copy, config, docs, prompt, or lightweight/medium single OpenSpec change: prefer `tweak`.
- New capability, public API, schema change, cross-module coordination, or architecture work: prefer `full`.
- Multiple active changes without an explicit change: `ask_user`.
- Low confidence, missing key evidence, or explicit workflow conflicting with risk signals: `ask_user`.
