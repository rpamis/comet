# Authoring Subagents Overview

## Core Principles

`/comet-any` authoring outputs should be drafted by platform-native subagents, then assembled and recorded by the main session through the backend CLI. Claude Code, Codex, Gemini, Copilot, and other platforms expose subagents differently; this reference defines responsibilities, inputs, and outputs, not a provider-specific dispatch API.

`reference/subagents/*.md` are portable lane briefs; Claude Code custom agents must be generated separately as platform agent resources with `name`, `description`, `tools`, and `model` frontmatter. Do not install these portable lane briefs directly as platform-native custom agent resources.

Read this overview first, then give only the matching role brief to each subagent. Do not merge the six role briefs into one large prompt. The main session keeps global context, aggregates outputs, and calls `comet bundle` and `comet publish`; subagents only produce reviewable drafts.

When the platform supports subagents, dispatch is required. If no platform subagent capability exists, the main session may execute the same briefs inline, but must mark that path as fallback in the user-facing summary and `reference/authoring-lanes.json`.

All subagents only return Markdown outputs and structured review findings. They must not write Bundle state directly, execute candidate Skill scripts, or run publish, install, or distribution commands. CLI state remains owned by the main session.

## Role Briefs

After the user confirms the Skill Creator proposal, and before `comet creator generate` or source generation, the main session reads and dispatches these briefs in order:

1. Script author subagent: `comet-any/reference/subagents/script-author.md`
2. Reference author subagent: `comet-any/reference/subagents/reference-author.md`
3. Workflow entry author subagent: `comet-any/reference/subagents/workflow-entry-author.md`
4. Skill core author subagent: `comet-any/reference/subagents/skill-core-author.md`
5. Pause point author subagent: `comet-any/reference/subagents/pause-points-author.md`
6. Skill review subagent: `comet-any/reference/subagents/skill-reviewer.md`

The relative paths inside this Skill are:

- `reference/subagents/script-author.md`
- `reference/subagents/reference-author.md`
- `reference/subagents/workflow-entry-author.md`
- `reference/subagents/skill-core-author.md`
- `reference/subagents/pause-points-author.md`
- `reference/subagents/skill-reviewer.md`

Subagent outputs first become reviewable drafts, then flow into `reference/authoring-lanes.json`, `reference/skill-review.md`, and the final Bundle draft. If any subagent reports a blocking finding, stop in draft repair and do not continue to ready.

## Dispatch by DAG

The Role Briefs order above is a linearization of the authoring DAG, not a mandate to run strictly sequential. The authoritative DAG lives in `reference/authoring-protocol.json` and `comet creator authoring-plan <name> --depth quick|full --json`:

- **wave1** (`script`, `reference`, `pause-points`): no dependencies on each other. On platforms that expose subagents, dispatch these three concurrently. Each gets only its own role brief, common input, and the protocol/resolved-skills paths (file handoff, no shared history).
- **wave2** (`workflow-entry`, `skill-core`): depend on the script contract (`NEXT:`/`SKILL:` outputs). Start only after the script lane is DONE. The two may run concurrently with each other.
- **barrier** (`skill-review`): the single synchronization point. Run only after wave1 and wave2 are all DONE; the reviewer must read every artifact and claim.

Regardless of platform:

- Sequencing follows DAG dependencies; only the barrier truly waits for all prior lanes.
- On platforms without subagent capability, the main session runs the same lanes inline in dependency order — semantics are identical, only latency changes. Record `dispatchMode: "subagent"` or `"inline"` per lane in `reference/authoring-lanes.json`.
- Claude Code may delegate a wave's fan-out to its `Workflow` tool as an optional accelerator; this is an implementation choice, not part of the contract. The contract is the protocol + schemas + DAG, which every platform can interpret.
- Every lane output is validated and recorded via `comet creator authoring-record <name> --lane <id> --file <out.json> --json` before the next dependent wave begins.

## Common Inputs

Every subagent must receive the same common context:

- The user-confirmed goal, starting point, and language.
- `goal`, `workflow.kind`, `workflow.nodes`, `engineMode`, and `runnerMode` from `plan.json`, plus
  the derived internal `callChain` source inventory from Skill Creator metadata.
- `reference/resolved-skills.json` or an equivalent real Skill source summary.
- `reference/workflow-protocol.json` or the workflow protocol that will be written there.
- For `/comet-classic` customization, the protected boundary is `open / design / build / verify / archive`, `.comet.yaml`, decision point, verify-result-transition, and archive-delta-sync.
- Project preferences, missing or ambiguous candidate decisions, deviation reasons, and scripts/hooks executable disclosures.

## Output Format

Each subagent returns:

```json
{
  "lane": "<lane-name>",
  "artifacts": [
    {
      "path": "reference/example.md",
      "kind": "reference",
      "content": "..."
    }
  ],
  "claims": [
    {
      "id": "reference:example",
      "kind": "reference",
      "paths": ["reference/example.md"],
      "summary": "What this output guarantees"
    }
  ],
  "findings": []
}
```

`claims` are review evidence, not decoration. Missing critical claims must block in the Skill review subagent.

## Dispatch Notes

- Create a fresh subagent for every dispatch; do not inherit main-session history. The main session provides only the role brief, input paths, and necessary background for that role.
- Explicitly specify a model. If the platform does not support model selection, record `platform-default` in `reference/authoring-lanes.json`.
- Use file handoff: provide paths instead of pasting large bodies of text. Common input, resolved Skill summaries, draft artifacts, and reports should move by path.
- Each subagent receives only its role brief, common input, and necessary artifacts, not every other role's full brief.
- The Skill review subagent must run after the other five author roles and must read all artifacts and claims.
- The main session may ask a role to rework its output, but the rework still returns to `reference/authoring-lanes.json` and `reference/skill-review.md`.
- Subagents cannot call `comet bundle`, `comet publish`, or `comet skill`, and cannot execute candidate Skill scripts.
- If a status is `BLOCKED` or `NEEDS_CONTEXT`, the main session must add context, split the task, switch to a stronger model, or ask the user; it must not continue assembly.
- Without platform subagent capability, inline fallback must preserve the same lane, claim, and finding structure.
