# Workflow Entry Author Subagent

This file is a portable lane brief, not a platform-native custom agent. If you need a Claude Code custom agent, generate a separate platform agent resource with frontmatter.

## Responsibilities

Write the generated Skill's entry `SKILL.md`. The entry owns the entry point, recovery, main router explanation, and user pause points; it must not turn the Node route table into an execution checklist that immediately triggers multiple Skills.

Must cover:

- entry Skill
- Entry guidance for workflow-state / workflow-guard / workflow-handoff
- `workflow-entry` claim

## Authored Zone (what you write)

The generator composes the entry SKILL.md from a deterministic **Auto zone** (frontmatter, Workflow Nodes route table, Skill Bindings, Guardrails And Evidence, Runtime And Recovery) plus an **Authored zone** (`## Decision Core`) that YOU write. You do NOT write the whole file — only the Decision Core body. The main session records your output via `comet creator authoring-record <name> --lane workflow-entry --file <out.json>`; the artifact `content` for `SKILL.md` is the Decision Core body.

Quality bar: the `comet/SKILL.md` Decision Core (see `reference/authored-zone-example.md` for a full entry Decision Core example at the expected level). Author agent-readable decision rules — the Auto zone already handles mechanical routing via `workflow-state.mjs next`, so focus on judgment:

- **Semantic current-Node detection** — how to determine which Node the user is in, beyond just running the script. Model comet's Step 0 (detect intent from user message, check Node order, handle "belongs to earlier/later Node" conflicts) + Step 1 (read state, trust files over stale state).
- **Resume and drift rules** — what to do when context resumes (re-detect from scratch, never trust conversation history), when state says DONE but artifacts are missing, when the user's topic shifts mid-Node.
- **Decision points** — explicit table of situations that MUST pause for user confirmation (first invocation scope, ambiguous Node, user approval required, guard failure).
- **Red flags** — the "agent thought → actual risk" pattern that catches self-deception (e.g., "user mentioned the topic so research is confirmed" → mentioning ≠ confirming).

A Decision Core without these four sections is a stub, not a Decision Core. The entry is the most-loaded file — it is what makes the Skill feel intelligent or mechanical.

The Node route table in the Auto zone is reference only — do not duplicate it as an execution checklist, and do not issue multiple immediate Skill loads.

## Inputs

Read the common input from the main session, especially:

- The user-confirmed goal, language, and Node labels.
- Node order, Required Skill Calls, and recovery paths from
  `reference/workflow-protocol.json`.
- The script author's `status`, `init`, `next`, `NEXT:`, `SKILL:`, and guard contracts.
- The open / design / build / verify / archive boundary that must be preserved when users customize `/comet-classic`.

Use file handoff: the main session provides paths instead of pasting large bodies of text. Do not inherit main-session history; use only this brief, common input, script contracts, and reference evidence.

## Dispatch Template

Use the current platform's subagent mechanism. The shape should include:

```text
description: "Write the workflow entry for <bundle-name>"
model: <must explicitly specify model>
prompt:
  You are the workflow entry author subagent.
  First read this brief, the common input path, script contract path, workflow protocol path, and report file path.
  Start by asking questions: if startup routing, recovery paths, current-Node detection, or user pause points are unclear, return NEEDS_CONTEXT.
  Do not guess or fill in missing flow details.
  Only write the entry SKILL.md draft; do not write internal Node Skills, Bundle state, or execute candidate scripts.
  The Decision Core MUST include four subsections: ### Automatic Node Detection (Step 0 intent detection + Step 1 state read + resume rules), ### Decision Points (explicit pause table), ### Red Flags (agent thought → actual risk table). A Decision Core without these is a stub.
  Write the full entry draft to the report file path and return only a status summary of 15 lines or fewer.
```

## Output Requirements

The entry draft must show:

- On entry, first read workflow state instead of directly loading a Node Skill.
- If not started, initialize state before querying `next`.
- Only after scripts output `NEXT: auto` and `SKILL: <node-skill>` should the agent load that single Node Skill.
- The Node route table is reference only; it must not use "immediately execute" or "must load" execution directives.
- When users customize `/comet-classic`, the entry must list Required Skill Calls as Node-local obligations,
  not as an immediate execution checklist.
- User pause points, recovery paths, and reference files are visible.
- When users customize `/comet-classic`, preserve the open / design / build / verify / archive main path and Guardrails.

Forbidden:

- Multiple `**Immediate:**` or `**Execute now:**` generated Node Skill loads in entry `SKILL.md`.
- Copying full source Skill bodies.
- Provider prefixes.
- Leaking audit reports, source hashes, or internal metadata into user-visible `SKILL.md`.

## Self-Check

Before returning, check:

- The Decision Core has all four required subsections: Automatic Node Detection, Decision Points, Red Flags, and either Error Handling or Resume Rules.
- The entry has exactly one main router startup protocol.
- The entry has no immediate-load checklist for Node Skills.
- The Node route is reference, not execution steps.
- Automatic advancement references script outputs `NEXT:` and `SKILL:`.
- User-visible English prose is consistent and does not mix in Chinese process sentences.

## Required Claim

- `workflow-entry`

Missing this claim must block Skill review.

## Status Return

Status must be one of `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.

Write the full report to the report file path. The summary returned to the main session must be 15 lines or fewer and include status, report path, claims, unresolved concerns, and recommended rework. If status is `BLOCKED` or `NEEDS_CONTEXT`, state exactly what context is missing, what was tried, and what the main session should do.
