---
name: comet-any
description: "Use only when explicitly invoked as /comet-any or when the user explicitly wants to customize the /comet-classic five-phase workflow or create/upgrade a workflow Skill managed by Comet Creator. Do not use for general Skill authoring, cleanup, or review."
---

# Comet Any - Skill Creator

`/comet-any` is the Comet Skill creation guide. The user describes the workflow they want; this Skill resolves real Skills, proposes a plan, waits for confirmation, generates a verifiable Comet-native Skill Bundle, and internally drives eval, review, publish readiness, and install preview.

Ordinary users see three starting points:

- `customize /comet-classic five-phase Skills`: overlay the existing `open / design / build / verify / archive` Skills without modifying the permanent `/comet-classic` entry itself.
- `create a new workflow Skill`: generate a new `workflow-kernel` from the goal and candidate Skills.
- `upgrade an existing Skill`: read existing Skills and add Workflow Nodes, Skill Bindings, Output Schemas, Guardrails, Handoffs, eval, and readiness.

Bundle, Factory, and composition are backend audit terms, not the first-screen user model.

## Core Model

Every path compiles to one Workflow Contract:

- `Workflow Node`: a resumable workflow node such as `open`, `design`, `plan`, `execute`, `subagent-execute`, `review`, `verify`, or `archive`.
- `Node Responsibility`: the responsibility this Node owns in the Agent workflow, explaining why it exists, what it must produce, and whether it can be replaced.
- `Skill Binding`: the implementation or helper Skill bound to a Node.
- `Required Skill Call`: a Skill that must be called inside a Node without replacing the Node implementation. For example, `execute` and `subagent-execute` may require `elementui`, while `review` may require `whitebox-code-standard`.
- `Output Schema`: the artifacts, state, or evidence a Node must produce. Output Schema must be attached to a concrete Workflow Node before it is effective; defining it only in `workflow.outputSchemas` does not trigger guard, eval, or readiness. Scripts, eval, and readiness depend on Node-attached Output Schemas, not Skill names.
- `Guardrail`: a check that blocks or allows Node advancement.
- `Handoff`: evidence returned by a subagent or cross-Node delegation.
- `workflow-protocol.json`: the package's single runtime source of truth, with kind `comet-five-phase-overlay` or `workflow-kernel`.

## Protected Boundary

`comet-five-phase-overlay` preserves the Comet Classic five-phase control flow and `.comet.yaml` state semantics. In ordinary mode:

- `comet-five-phase-overlay` primary state comes only from `openspec/changes/<name>/.comet.yaml`; no active change or multiple active changes must block and ask the user to choose.
- The overlay must not create `.comet/runs/<workflow>/state.json` as the Comet overlay primary state. Bundle drafts, eval evidence, and publish readiness may keep their own evidence files, but they cannot replace `.comet.yaml`.
- `control` Nodes cannot be overridden: `open`, `execute`, `verify`, `archive`.
- `producer` Nodes may be overridden: `design`, `plan`, but only when the replacement satisfies the matching Output Schema.
- `handoff` and `guardrail` Nodes may require or augment Skills.
- If the user insists on replacing a control Node, switch to advanced `workflow-kernel` and require a new state model, Output Schemas, and Guardrails.
- Every Node must explain its responsibility; internal coordinates are not part of the user-facing workflow model.

## Steps

1. Resume state: run `comet creator guide --project . --json` and show a resume summary.
2. Read preferences: load `.comet/skill-preferences.yaml`, then use `comet creator candidates --json` to discover real local Skills and `comet skill show <name> --json` to read each candidate's real content and hash. Do not guess capability from a Skill name.
3. Build proposal: express the goal as Workflow Nodes, Skill Bindings, Output Schemas, Guardrails, Handoffs, and Evidence.
4. Show confirmation: list each Node, bound Skill, Required Skill Call, Output Schema, executable disclosure, and readiness impact. The confirmation must show enforcement for each new binding or schema: `guarded`, `handoff-guarded`, `evidence-only`, or `advisory`.
5. Wait for confirmation: do not write a Bundle draft before confirmation; pause for missing or ambiguous Skills.
6. Initialize backend state: after confirmation, call `comet creator init <name> --file <plan.json> --confirmed-proposal --json`.
7. Run the authoring pipeline and generate the Bundle: run `comet creator authoring-plan <name> --depth quick|full --json` for the lane DAG. Dispatch lanes by the DAG — wave1 (`script`, `reference`, `pause-points`) in parallel where the platform supports subagents (otherwise inline, in dependency order), wave2 (`workflow-entry`, `skill-core`) after the script contract, and `skill-review` as the barrier. Record each lane via `comet creator authoring-record <name> --lane <id> --file <out.json> --json` (schema-validated; BLOCKED/NEEDS_CONTEXT is rejected). Then run `comet creator generate <name> --json`; it merges recorded content-leaf drafts (entry/node SKILL.md, decision-points, recovery) into the package while the deterministic backbone (protocol/scripts/manifest) stays templated, and renders real review evidence. Outputs entry Skill, Node Skills, `reference/workflow-protocol.json`, the six scripts, rules, hooks, and `comet/eval.yaml`.
8. Validate: show quick/full eval workload and run or record current draft hash eval evidence; failed eval, skipped eval, or stale-hash evidence cannot become ready.
9. Review readiness: read `comet publish review <name> --platform <reference-platform> --json` and show `Readiness:`, `Blockers:`, `Warnings:`, and `Evidence:`.
10. Publish and install preview: publish only after human approval; installation must start with preview and show `No files were written`.

## Plan Example

Component-library and whitebox-review requirements should produce a plan like:

```json
{
  "goal": "Customize /comet-classic five-phase Skills with component and whitebox review requirements.",
  "skillCreatorIntent": "customize-comet",
  "workflow": {
    "kind": "comet-five-phase-overlay",
    "name": "team-comet",
    "goal": "Require component and whitebox review Skills.",
    "nodes": {
      "execute": {
        "requiredSkillCalls": [
          {
            "skill": "elementui",
            "reason": "Use project component library during direct implementation."
          }
        ]
      },
      "subagent-execute": {
        "requiredSkillCalls": [
          {
            "skill": "elementui",
            "scope": "handoff"
          }
        ]
      },
      "review": {
        "requiredSkillCalls": [
          {
            "skill": "whitebox-code-standard",
            "scope": "review"
          }
        ]
      }
    }
  }
}
```

## Hard Rules

- Show the proposal confirmation page before generation.
- The confirmation must show enforcement for each new binding or schema: `guarded`, `handoff-guarded`, `evidence-only`, or `advisory`.
- A Required Skill Call does not replace Node implementation.
- A producer override must declare the Output Schema it satisfies.
- Output Schema must be attached to a concrete Workflow Node before it is effective; defining it only in `workflow.outputSchemas` does not trigger guard, eval, or readiness.
- Ordinary mode must not override control Nodes.
- Eval, review, and publish readiness must read the same `workflow-protocol.json`.
- Readiness blockers must stop publish: missing current draft hash eval evidence, missing human approval, required capability gaps, or unconfirmed executable disclosures cannot become ready.
- Handoff must require subagents to load Required Skill Calls and return evidence.
- Scripts read protocol and state; they do not use Skill names as validation authority.
- Ask before installation. Never install automatically.

## References

- `comet-any/reference/authoring-protocol.json`
- `comet-any/reference/authored-zone-example.md`
- `comet-any/reference/bundle-authoring.md`
- `comet-any/reference/authoring-subagents.md`
- `comet-any/reference/eval-provider.md`
