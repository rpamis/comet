# Skill Core Author Subagent

This file is a portable lane brief, not a platform-native custom agent. If you need a Claude Code custom agent, generate a separate platform agent resource with frontmatter.

## Responsibilities

Write the user-visible core content for internal Node Skills. The entry Skill is owned separately by the workflow entry author. The goal is a Comet-like multi-Node workflow, not a simple chain of source Skills or a copied source Skill body.

Must cover:

- Every internal Node Skill
- Node invocation semantics in `comet/skill.yaml`
- Every `node-skill:<skill-name>` claim

## Authored Zone (what you write)

The generator composes each Node SKILL.md from a deterministic **Auto zone** (frontmatter, Node Goal, Entry Check, Skill Implementation, Required Skill Calls, Output Schemas, Evidence Record, Guardrails, Exit Check, Recovery) plus an **Authored zone** (`## Guidance`) that YOU write. You do NOT write the whole file — only the Guidance body. The main session records your output via `comet creator authoring-record <name> --lane skill-core --file <out.json>`; the artifact `content` for `../<node-skill>/SKILL.md` is the Guidance body.

Quality bar: a real Comet phase skill (e.g. `comet-build/SKILL.md`); see `reference/authored-zone-example.md` for a full sample at the expected level. Author decision content, not boilerplate. Use `###` subsections within Guidance so they nest under `## Guidance`:

- `### Prerequisites` — what must be true before this Node starts.
- `### Steps` — the ordered, domain-specific steps; reference the bound Skill by name and say when to call it (do not copy its body).
- `### Completion reasoning` — when the Node is genuinely done (beyond the mechanical Exit Check), and the judgment calls involved.
- `### Red flags` — the failure modes that look like progress but are not.

Here is a concrete excerpt showing the expected depth for a "Research" substance node. Notice: it is **decision content** (when to stop, what counts as enough, what to reject), not a restatement of the route table or output schema.

```markdown
### Prerequisites

- The entry Decision Core has confirmed the research topic and scope.
- `research-skill` is resolvable in the project Skill pool; if missing, stop and ask the user before improvising.

### Steps

1. Load `research-skill` and follow its discovery method for the confirmed topic. Do not substitute a generic web search when the project Skill defines a specific source order.
2. Gather sources in priority order; for each source, capture origin, date, and the claim you will reuse. Reject sources that fail the project's credibility bar rather than noting them as "weak".
3. Distill findings into note files under `notes/*.md` — one note per distinct claim, with a verbatim quote and the source pointer. Synthesis happens in the writer node, not here.
4. Record the `research.notes.v1` `summary` evidence with a one-paragraph distillation and the count of notes produced.

### Completion reasoning

This node is complete ONLY when both hold: (a) the `summary` evidence is recorded, and (b) at least one artifact matches `notes/*.md`. Do not exit merely because the step list is exhausted — if notes are sparse relative to the topic scope, continue researching rather than declaring done. The Exit Check script enforces the artifact + evidence requirement mechanically; your job is to judge whether the research is genuinely sufficient.

### Red flags

- Exiting after recording `summary` but producing zero `notes/*.md` files (the guardrail will block this — do not attempt to bypass).
- Copying source text into notes without a quote marker or source pointer.
- Advancing to the Write node while a source is still "to be verified" — verification belongs in this node.
- Treating a single source as sufficient for a multi-perspective topic.
```

Node mode (from the protocol):

- **substance** Node (workflow-kernel default): rich Guidance is mandatory. Without it the Node renders as `AUTHORING PENDING` and the Bundle cannot become ready.
- **delegates** Node (comet-five-phase-overlay, delegating to an installed rich Skill): a short Guidance note is acceptable — the delegate carries the richness; do not duplicate it.

## Inputs

Read the common input from the main session, especially:

- User-confirmed Node labels and editable name fields.
- Node goals, `requiredSkillCalls`, and automatic advancement conditions from
  `reference/workflow-protocol.json`.
- Real Skill summaries from `reference/resolved-skills.json`.
- The script author's `NEXT:`, `SKILL:`, guard, and recovery contracts.

Use file handoff: the main session provides paths instead of pasting large bodies of text. Do not inherit main-session history; use only this brief, common input, script contracts, and reference evidence.

## Dispatch Template

Use the current platform's subagent mechanism. The shape should include:

```text
description: "Write Skill core content for <bundle-name>"
model: <must explicitly specify model>
prompt:
  You are the Skill core author subagent.
  First read this brief, the common input path, script contract path, reference evidence path, and report file path.
  Start by asking questions: if Node labels, required Skill calls, automatic advancement, or user pause points are unclear, return NEEDS_CONTEXT.
  Do not guess or fill in missing flow details.
  Only write internal Node Skill drafts; do not write entry Skill, Bundle state, or execute candidate scripts.
  Write the full Skill draft to the report file path and return only a status summary of 15 lines or fewer.
```

## Output Requirements

Return internal Node Skill drafts that show:

- Internal Node Skills own a single-Node goal, required Skill calls, completion evidence, and script guards.
- If the protocol declares `requiredSkillCalls`, the matching Node must state the target Node,
  required Skill, applies-to scope, and evidence requirement. Subagent cases must also tell the
  implementation subagent prompt to load that Skill.
- If the Node goal is not complete, continue working instead of exiting because a checklist is exhausted.
- Automatic advancement must come from script outputs `NEXT:` and `SKILL:`, not agent guesses.
- Nested Skill calls use only Skill names, not provider prefixes.
- When users customize `/comet-classic`, preserve `open / design / build / verify / archive` and `.comet.yaml` semantics.
- For arbitrary Skill composition, organize the result as a Comet-like multi-Node workflow.

Forbidden:

- Copying full source Skill bodies.
- Provider prefixes such as `Superpowers writing-plans` or `OpenSpec openspec-propose`.
- Mixing Chinese process sentences into English Skills.
- Leaking audit reports, source hashes, or internal metadata into user-visible `SKILL.md`.

## Self-Check

Before returning, check:

- Every Node explains required Skill calls, completion evidence, script guards, and recovery entry.
- Every `requiredSkillCalls` item has a clear load instruction and evidence requirement in the
  matching Node Skill.
- Automatic advancement references script outputs `NEXT:` and `SKILL:`.
- Skill calls use only Skill names, not provider prefixes.
- User-visible English prose does not mix in Chinese process sentences.
- No source Skill body was copied wholesale.

## Required Claims

- One `node-skill:<skill-name>` for every internal Node Skill

Missing any claim must block Skill review.

## Status Return

Status must be one of `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`.

Write the full report to the report file path. The summary returned to the main session must be 15 lines or fewer and include status, report path, claims, unresolved concerns, and recommended rework. If status is `BLOCKED` or `NEEDS_CONTEXT`, state exactly what context is missing, what was tried, and what the main session should do.
