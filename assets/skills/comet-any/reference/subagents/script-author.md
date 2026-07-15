# Script Author Subagent

This file is a portable lane brief, not a platform-native custom agent. If you need a Claude Code custom agent, generate a separate platform agent resource with frontmatter.

## Responsibilities

Design the generated Skill's script contract instead of copying Comet Classic scripts. Scripts must use the current workflow protocol, user-selected Node labels, and real composed Skill outputs to define automatic advancement, exit checks, recovery, and evidence recording.

Must cover:

- `scripts/workflow-state.mjs`
- `scripts/workflow-guard.mjs`
- `scripts/workflow-handoff.mjs`

The factory also deterministically generates `scripts/comet-plan.mjs`, `scripts/comet-check.mjs`, and `scripts/comet-hook-guard.mjs` from the same `workflow-protocol.json`. Do not duplicate or redesign those three; your contract is for the `workflow-*.mjs` scripts that the Skill core author and entry author reference.

## Inputs

Read the common input from the main session, especially:

- `reference/workflow-protocol.json`
- `workflow.kind`, `workflow.nodes`, `engineMode`, and `runnerMode` from `plan.json`, plus the
  derived internal `callChain` source inventory from Skill Creator metadata
- `reference/resolved-skills.json`
- Protected `.comet.yaml` semantics when users customize `/comet-classic`; `comet-five-phase-overlay` primary state comes only from `openspec/changes/<name>/.comet.yaml` and must not create `.comet/runs/<workflow>/state.json` as the Comet overlay primary state.

Use file handoff: the main session provides paths instead of pasting large bodies of text. Do not read main-session history or ask the user to restate content already written to artifacts.

## Dispatch Template

Use the current platform's subagent mechanism. The shape should include:

```text
description: "Write the script contract for <bundle-name>"
model: <must explicitly specify model>
prompt:
  You are the script author subagent.
  First read this brief, the common input path, workflow protocol path, resolved skills path, and report file path.
  Start by asking questions: if script boundaries, Node completion conditions, state writes, or recovery semantics are unclear, return NEEDS_CONTEXT.
  Do not guess or fill in missing protocol details.
  Do not call comet bundle, comet publish, or comet skill, and do not execute candidate Skill scripts.
  Write the full script contract to the report file path and return only a status summary of 15 lines or fewer.
```

## Output Requirements

Return a script contract draft that explains, for each script:

- Which state it reads.
- Which state and evidence it writes.
- How it decides whether the current Node goal is complete.
- How it outputs `NEXT:`, `SKILL:`, and blocking reasons.
- How it stays in the current Node when the Node is incomplete instead of forcing an exit.
- How it supports cross-device recovery.
- For `comet-five-phase-overlay`, how it blocks when there is no active change or multiple active changes and asks the user to choose.

Exit checks must come from the current workflow protocol and composed Skill goal, not copied Comet Classic scripts.

## Self-Check

Before returning, check:

- Every script has inputs, outputs, state reads/writes, evidence writes, and failure behavior.
- Node completion conditions come from the workflow protocol, not fixed Node labels.
- `NEXT:` and `SKILL:` output conditions can be directly referenced by the Skill core author.
- Cross-device recovery does not rely on current-session memory.
- No candidate script was executed and no Bundle state was written.

## Required Claims

- `script:workflow-state`
- `script:workflow-guard`
- `script:workflow-handoff`

Missing any claim must block Skill review.

## Status Return

Status must be one of `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.

Write the full report to the report file path. The summary returned to the main session must be 15 lines or fewer and include status, report path, claims, test/check notes, and concerns. If status is `BLOCKED` or `NEEDS_CONTEXT`, state exactly what context is missing, what was tried, and what the main session should do.
