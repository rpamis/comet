# Native and Both CodeGraph Init Selection

## Goal

Make the interactive `comet init` dependency selection consistent with the selected workflow. Native initialization must offer CodeGraph, and Both initialization must continue to offer CodeGraph alongside the Classic dependencies.

## Design

`selectNpmDeps` will receive the full `InitWorkflowSelection` (`native`, `classic`, or `both`) instead of a reduced `CometWorkflow` value.

- `native`: show only the CodeGraph dependency.
- `classic`: keep the existing OpenSpec, Superpowers, and CodeGraph choices.
- `both`: show OpenSpec, Superpowers, and CodeGraph.

The existing installed-state defaults, `--yes` behavior, and explicit `--codegraph init|skip` handling remain unchanged. Native and Both will therefore use the same CodeGraph installation path already used by Classic, without changing CodeGraph's project-index or global-scope semantics.

## Testing

Add focused init E2E coverage that inspects the actual interactive dependency checkbox choices for Native and Both, while retaining the existing Classic and explicit CodeGraph JSON coverage. The test must prove that Native exposes CodeGraph without exposing Classic-only dependencies.

## Non-goals

- No changes to CodeGraph installation, indexing, or diagnostic behavior.
- No changes to workflow selection names or project configuration.
- No new CLI flag.
