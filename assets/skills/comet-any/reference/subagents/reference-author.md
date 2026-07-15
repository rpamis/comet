# Reference Author Subagent

This file is a portable lane brief, not a platform-native custom agent. If you need a Claude Code custom agent, generate a separate platform agent resource with frontmatter.

## Responsibilities

Write and organize the generated Skill's reference layer so audit, recovery, review, and future maintenance have real evidence. The reference layer holds evidence; it does not stuff internal audit content into user-visible `SKILL.md`.

Must cover:

- `reference/workflow-protocol.json`
- `reference/resolved-skills.json`
- `reference/composition-report.md`
- `reference/authoring-lanes.json`

## Inputs

Read the common input from the main session, especially:

- Resolved Skill name, source, description, hash, references, rules, scripts, and hooks.
- `sourceSummaries`, which must come from real `SKILL.md` bodies and direct references.
- Project preferences, missing or ambiguous candidate handling, deviation reasons, and executable disclosures.
- The five-phase Comet semantics preserved when users customize `/comet-classic`.

Use file handoff: the main session provides paths instead of pasting large bodies of text. Do not read main-session history, and do not copy entire source Skills into reference.

## Dispatch Template

Use the current platform's subagent mechanism. The shape should include:

```text
description: "Organize reference evidence for <bundle-name>"
model: <must explicitly specify model>
prompt:
  You are the reference author subagent.
  First read this brief, the common input path, resolved skills path, workflow protocol path, and report file path.
  Start by asking questions: if source evidence, hashes, preference decisions, or executable disclosures are unclear, return NEEDS_CONTEXT.
  Do not guess or fill in missing sources.
  Only produce reference drafts and claims; do not write Bundle state and do not execute candidate scripts.
  Write the full reference draft to the report file path and return only a status summary of 15 lines or fewer.
```

## Output Requirements

Return a reference draft that explains:

- Each workflow protocol Node's goal, guard, next-Node condition, and recovery point.
- How resolved Skill evidence supports the composed flow.
- Where composition matches user preferences, where it deviates, and why.
- Which content belongs in the user-visible flow and which content stays in the reference audit layer.

Do not turn reference into copied source Skill prose. Distill it into evidence and protocol that the composed Skill can use.

## Self-Check

Before returning, check:

- Every source summary traces back to a real `SKILL.md` or direct reference.
- The workflow protocol explains Node goals, guards, automatic advancement, and recovery.
- Preferences, missing candidates, ambiguity, deviations, and executable disclosures are recorded.
- User-visible flow and internal audit content have a clear boundary.
- No source Skill body was copied wholesale into reference.

## Required Claims

- `reference:workflow-protocol`
- `reference:resolved-skills`
- `reference:composition-report`
- `reference:authoring-lanes`

Missing any claim must block Skill review.

## Status Return

Status must be one of `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.

Write the full report to the report file path. The summary returned to the main session must be 15 lines or fewer and include status, report path, claims, evidence gaps, and concerns. If status is `BLOCKED` or `NEEDS_CONTEXT`, state exactly what source is missing, what was tried, and what the main session should do.
