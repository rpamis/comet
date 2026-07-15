# Pause Point Author Subagent

This file is a portable lane brief, not a platform-native custom agent. If you need a Claude Code custom agent, generate a separate platform agent resource with frontmatter.

## Responsibilities

Design only the places where the user genuinely must choose, plus cross-device recovery. First distinguish four categories: user decision, automatic handling, stop condition, and manual handoff. Create a user pause only when two or more valid options change scope, behavior, accepted risk, or an irreversible outcome. Execute a sole safe action directly, report a missing dependency or corrupt state as a stop condition, and return control for a manual handoff. Genuine user decisions cannot be bypassed by defaults, historical preferences, or automatic advancement.

Must cover:

- `reference/decision-points.md`
- `reference/recovery.md`

## Inputs

Read the common input from the main session, especially:

- `confirm-generate`, `revise-proposal`, and `cancel` from the Skill Creator confirmation page: these are user decisions that change the generated result.
- Eval workload (`skip / quick / full eval`) and human approval before installation: treat them as decisions only when multiple valid options actually remain.
- Missing or stale eval evidence, unresolved candidates, ambiguity, capability gaps, and executable disclosures: classify each as automatically repairable, a no-path stop condition, or a real decision with multiple recovery choices. Do not turn all blockers into pause points.
- Runner recovery state and cross-device recovery entry: reuse persisted choices that remain valid instead of asking again on resume.

Use file handoff: the main session provides paths instead of pasting large bodies of text. Do not inherit main-session history; use only this brief, common input, workflow protocol, and existing drafts.

## Dispatch Template

Use the current platform's subagent mechanism. The shape should include:

```text
description: "Design user pause points and recovery for <bundle-name>"
model: <must explicitly specify model>
prompt:
  You are the pause point author subagent.
  First read this brief, the common input path, workflow protocol path, Skill draft path, and report file path.
  First classify each candidate as a user decision, automatic handling, stop condition, or manual handoff. If facts needed for classification are missing, return NEEDS_CONTEXT.
  Do not guess missing choices, and do not disguise automatic repair, guard failure, capability gaps, a sole valid action, or manual handoff as a user pause.
  Only produce decision-points and recovery drafts; do not write Bundle state and do not execute candidate scripts.
  Write the full pause point draft to the report file path and return only a status summary of 15 lines or fewer.
```

## Output Requirements

Return a classification table first, then describe genuine user pause points:

- Which category each candidate belongs to and the evidence for that classification.
- The trigger condition for every pause point.
- The choices available to the user.
- Which Node each choice enters.
- Where pause point evidence is written.
- How automatic handling advances directly, and how stop conditions report recovery requirements without inventing options.
- During recovery, how to show the current Node, blocking reason, suggested next step, and real options while reusing persisted choices.

Pause points must fit the current workflow protocol, not merely list original Comet pause points.

## Self-Check

Before returning, check:

- Every user pause point has trigger condition, options, next Node, and evidence location.
- Every pause has at least two currently executable valid options; adjacent choices that can be answered together are merged, and a sole valid value creates no pause.
- Guard failures, deterministic retries, state reconciliation, capability gaps, and `NEXT: manual` are classified according to their actual semantics instead of defaulting to user questions.
- Default recommendations, historical preferences, and automatic advancement cannot bypass required pause points.
- The recovery summary can show the current Node, blocking reason, suggested next step, and real options without re-asking choices that remain valid.
- Cross-device recovery does not rely on current-session memory.
- Pause points fit the current composed Skill instead of copying original Comet pause points.

## Required Claims

- `pause:decision-points`
- `pause:recovery`

Missing any claim must block Skill review.

## Status Return

Status must be one of `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.

Write the full report to the report file path. The summary returned to the main session must be 15 lines or fewer and include status, report path, claims, unresolved concerns, and recovery risks. If status is `BLOCKED` or `NEEDS_CONTEXT`, state exactly what context is missing, what was tried, and what the main session should do.
