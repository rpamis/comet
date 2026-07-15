# CometIntentFrame Field Reference

Read this file only when field meanings are needed. Normal `/comet-classic` routing only needs the minimal skeleton in the main Skill; the runtime fills omitted defaults and outputs the final `route`.

## Top-Level Fields

| Field | Meaning |
|-------|---------|
| `schema_version` | Frame version. Currently fixed to `comet.intent.v1`. |
| `utterance` | The user request that triggered `/comet-classic`. |
| `intent` | High-level user intent and confidence. If confidence is below the runtime threshold, routing falls back to `ask_user`. |
| `slots` | Routing slots normalized from the user request. |
| `context` | Repository context read from local state; this is not extracted from the user utterance. |
| `evidence` | Evidence for key routing conclusions. Missing key evidence makes the runtime prefer `ask_user`. |
| `proposed_route` | Agent-submitted route candidate. Minimal input only needs `name` and `confidence`; the runtime reviews it and outputs the final `route`. |

## `intent`

| Field | Meaning |
|-------|---------|
| `intent.name` | High-level user intent: start, resume, fix bug, make tweak, ask question, or unknown. |
| `intent.confidence` | Agent confidence in the high-level intent. This participates in low-confidence fallback; `proposed_route.confidence` does not. |

## `slots`

| Field | Meaning |
|-------|---------|
| `requested_action` | The action the user wants, such as `start`, `resume`, `continue`, `fix`, `modify`, `create`, `verify`, `archive`, or `question`. |
| `workflow_candidate` | Agent-inferred candidate workflow: `full`, `hotfix`, `tweak`, or `null`. This is an inference and the runtime reviews it. |
| `user_explicit_workflow` | Whether the user explicitly named a workflow. If the user says "use hotfix", set `hotfix`; otherwise set `null`. Explicit workflow still falls back to `ask_user` when it conflicts with risk signals. |
| `change_id` | Active change name explicitly requested by the user for resume or operation. Use `null` when unspecified. |
| `existing_behavior` | Whether the request fixes existing behavior or a regression. `true` with no new capability/API/schema/cross-module risk tends toward `hotfix`. |
| `new_capability` | Whether the request adds a new capability. Usually tends toward `full`. |
| `public_api_change` | Whether the request changes a user-visible contract, such as CLI flags, config fields, JSON output, or public Skill flow. Usually tends toward `full`. |
| `schema_change` | Whether the request changes structured data formats, such as `.comet.yaml`, `run-state.json`, eval manifests, bundle manifests, or config schema. Usually tends toward `full`. |
| `cross_module_change` | Whether the request crosses module or workflow boundaries. Usually tends toward `full`. |
| `target_area` | Optional explanation field for the target area the user mentioned. The minimal skeleton does not need it. |
| `scope` | Optional explanation field for rough scope size. The current scorer does not let it drive routing by itself, and the minimal skeleton does not need it. |

## `context`

| Field | Meaning |
|-------|---------|
| `active_changes_count` | Number of unarchived active changes from `openspec list --json`. Multiple active changes without a `change_id` route to `ask_user`. |
| `active_change_names` | Names of active changes. When the user supplies `change_id`, the runtime checks it against this list. |
| `dirty_worktree` | Optional state field. The entry-route minimal skeleton does not need it; dirty worktree handling belongs to `comet/reference/dirty-worktree.md`. |

## `evidence`

Each evidence item contains:

| Field | Meaning |
|-------|---------|
| `field` | Frame field supported by the evidence, such as `intent.name` or `slots.workflow_candidate`. |
| `quote` | Evidence snippet from the user request, repository state, or `.comet.yaml`. |
| `source` | Evidence source: `user`, `repo`, or `state`. |

## `proposed_route`

| Field | Meaning |
|-------|---------|
| `name` | Agent route candidate: `full`, `hotfix`, `tweak`, `resume`, `ask_user`, or `out_of_scope`. |
| `confidence` | Agent confidence in the route candidate. Diagnostic only; it does not participate in low-confidence fallback. |
| `next_skill` | Derived field normalized by the runtime. The minimal skeleton does not need it. |
| `requires_confirmation` | Derived field normalized by the runtime. The minimal skeleton does not need it. |
| `fallback_reason` | Derived field normalized by the runtime. The minimal skeleton does not need it. |

## Routing Notes

- Existing bug, regression, or broken behavior with no new capability/API/schema/cross-module risk: prefer `hotfix`.
- Copy, config, docs, prompt, or lightweight/medium single OpenSpec change: prefer `tweak`.
- New capability, public API, schema change, cross-module coordination, or architecture work: prefer `full`.
- Multiple active changes without an explicit change: `ask_user`.
- Low confidence, missing key evidence, or explicit workflow conflicting with risk signals: `ask_user`.
