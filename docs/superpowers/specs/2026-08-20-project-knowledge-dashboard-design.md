# Project Knowledge Dashboard Design

## Status

Approved MVP direction: expose the first-party `comet.project-knowledge` plugin in Dashboard at the same level as personal memory.

## Problem

Project Knowledge is already a first-party Plugin Runtime capability, but its provider state and runtime diagnostics are not visible in Dashboard. Personal memory has a plugin page while project knowledge is only observable indirectly through task context. This makes the two first-party plugins inconsistent and makes Local/Remote configuration failures harder to understand.

## Goals

- Show `comet.project-knowledge` as a normal Dashboard plugin page.
- Reuse the existing Plugin Runtime and `DashboardPluginHost` lifecycle behavior.
- Show Local/Remote provider state, plugin status, project pause state, configuration validity, and bounded recent diagnostics.
- Show a safe Remote configuration summary without reading or exposing token values.
- Keep the page read-only for configuration; lifecycle operations remain the existing generic plugin actions.
- Preserve the existing non-blocking retrieval contract and diagnostics boundaries.

## Non-goals

- No interactive project-knowledge search page.
- No index, embedding, watcher, or retrieval-history UI.
- No Dashboard editor for `knowledge.remote.endpoint`, `token_env`, `scope`, or `timeout_ms`.
- No changes to the archived `project-knowledge-retrieval` Native change.
- No new workflow-specific retrieval command or Skill.

## Architecture

The Project Knowledge plugin will add a `dashboard` contribution to its existing module. The contribution supplies a localized label, a stable route, and a `load` function that returns a serializable, non-secret status snapshot derived from the normalized project knowledge configuration.

The existing flow remains unchanged:

```text
project-knowledge plugin
  -> PluginRuntime.dashboardPages()
  -> DashboardPluginHost.list()/get()/lifecycle()
  -> Dashboard server plugin API
  -> existing plugin page registry and renderer
```

The plugin page will not duplicate lifecycle logic. `DashboardPluginHost` continues to provide enable, disable, project pause, and uninstall behavior and already attaches the latest bounded Runtime diagnostics to the page summary. The page load snapshot supplies provider-specific state and the sanitized Remote summary.

## Status snapshot

The page data will contain only user-visible, serializable fields:

- `provider`: `local` or `remote`;
- `configured`: whether the normalized provider configuration is valid;
- `remote`: endpoint, scope, timeout, and token environment-variable name when configured;
- `retrieval`: a short explanation of the active provider and its bounded behavior;
- `diagnostics`: at most the existing bounded recent diagnostic entries, without token, Authorization header, absolute path, or full remote response content.

The plugin page uses the host-provided status for enabled/disabled state and project pause state rather than inventing a second lifecycle model. Missing Remote environment variables remain a diagnostic/configuration state, not a new Dashboard mutation.

## UI behavior

Use the existing compact Dashboard visual language and Ant Design components. The page has:

1. a status row for provider, plugin state, project pause state, and configuration validity;
2. a configuration summary panel with safe Remote fields and a clear Local/Remote explanation;
3. a diagnostics panel showing recent bounded diagnostics or an empty state;
4. the existing plugin lifecycle controls supplied by the host.

The page must not imply that Local maintains an index or that a displayed Remote endpoint means a successful connection. It should distinguish configured state from the result of a particular retrieval.

## Error handling and security

- A page-load failure is converted through the existing Dashboard host error boundary and does not block task execution.
- Missing or invalid configuration is shown as a diagnostic/status state; the page never attempts a network request or provider construction merely to render status.
- Token values and Authorization headers are never loaded into page data.
- Endpoint, scope, and diagnostics use the existing length and redaction boundaries.
- Lifecycle actions continue to be authorized by `DashboardPluginHost`; a disabled or project-paused plugin cannot be invoked through the page.

## Testing

- Add a Project Knowledge plugin-module test covering the Dashboard contribution and sanitized Local/Remote snapshots.
- Extend Dashboard plugin host tests to discover, load, and lifecycle-manage the Project Knowledge page.
- Add web source/state tests for status, safe Remote summary, diagnostics, empty state, and disabled/paused rendering.
- Add or extend Dashboard E2E coverage for page discovery and lifecycle state transitions.
- Run the focused suites, formatting, lint, build, and the repository test suite before completion.

## Acceptance criteria

- `comet dashboard` lists Project Knowledge beside Personal Memory.
- Local and Remote configuration summaries are visible without exposing secrets.
- Enable/disable, project pause, and uninstall use the existing plugin lifecycle contract.
- Recent diagnostics are visible and bounded.
- No search, index, history, or configuration-editing UI is introduced.
- Existing project-knowledge retrieval behavior and archived change artifacts remain unchanged.
