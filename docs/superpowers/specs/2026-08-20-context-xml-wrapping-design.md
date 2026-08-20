# Context XML Wrapping Design

## Goal

Make the two automatically injected context sources unambiguous to the Agent by
wrapping each source in its own stable XML element without changing retrieval,
filtering, ordering, or failure behavior.

## Contract

- Personal memory context is wrapped in `<personal_memory>...</personal_memory>`.
- Project knowledge context is wrapped in `<project_knowledge>...</project_knowledge>`.
- The existing Markdown-like body remains inside the corresponding element.
- XML-sensitive characters in the body are escaped (`&`, `<`, `>`, `"`, and `'`).
- Empty or unavailable contributions remain omitted; no empty wrapper is emitted.
- The two contributions remain separate so the Agent can distinguish user
  preferences from project-owned evidence.

## Scope and compatibility

Only the context rendering boundary changes. Retrieval limits, source citations,
memory policies, diagnostics, Dashboard pages, and non-blocking error handling
remain unchanged. Existing callers still receive one contribution per plugin;
only each contribution's `text` gains its XML wrapper.

## Verification

Add focused renderer/plugin-context regression tests for both wrappers, XML
escaping, and omission of empty contributions. Run the affected Vitest tests,
then the project formatting and type checks before the final build.
