# Authored Zone Quality Bar (example)

This is a concrete quality bar for the **Authored zone** you write (`## Decision Core` for the entry, `## Guidance` for nodes). The generator composes your Authored zone onto a deterministic **Auto zone** (frontmatter, route table, Entry/Exit checks, evidence format, recovery). You write ONLY the Authored zone. Calibrate against this example, not against a one-line boilerplate node.

## What "Auto" vs "Authored" means

- **Auto zone (template, do not rewrite)**: the invariant control plane. For a node: `## Node Goal`, `## Entry Check`, `## Skill Implementation`, `## Required Skill Calls`, `## Output Schemas`, `## Evidence Record`, `## Guardrails`, `## Exit Check`, `## Recovery`. For the entry: `## Workflow Nodes`, `## Skill Bindings`, `## Guardrails And Evidence`, `## Runtime And Recovery`.
- **Authored zone (you write)**: the domain decisions the Auto zone cannot know. This is what makes the Skill usable, not just runnable.

## Example: a `substance` node Guidance zone (workflow-kernel)

This is the `## Guidance` body for a "Research" producer node in a research-writer workflow. Notice it is **decision content**: prerequisites, ordered domain steps, completion judgment beyond the mechanical Exit Check, and red flags. It references the bound Skill by name without copying its body.

```markdown
## Prerequisites

- The entry Decision Core has confirmed the research topic and scope.
- `research-skill` is resolvable in the project Skill pool; if missing, stop and ask the user before improvising.

## Steps

1. Load `research-skill` and follow its discovery method for the confirmed topic. Do not substitute a generic web search when the project Skill defines a specific source order.
2. Gather sources in priority order; for each source, capture origin, date, and the claim you will reuse. Reject sources that fail the project's credibility bar rather than noting them as "weak".
3. Distill findings into note files under `notes/*.md` — one note per distinct claim, with a verbatim quote and the source pointer. Synthesis happens in the writer node, not here.
4. Record the `research.notes.v1` `summary` evidence with a one-paragraph distillation and the count of notes produced.

## Completion reasoning

This node is complete ONLY when both hold: (a) the `summary` evidence is recorded, and (b) at least one artifact matches `notes/*.md`. Do not exit merely because the step list is exhausted — if notes are sparse relative to the topic scope, continue researching rather than declaring done. The Exit Check script enforces the artifact + evidence requirement mechanically; your job is to judge whether the research is genuinely sufficient.

## Red flags

- Exiting after recording `summary` but producing zero `notes/*.md` files (the guardrail will block this — do not attempt to bypass).
- Copying source text into notes without a quote marker or source pointer.
- Advancing to the Write node while a source is still "to be verified" — verification belongs in this node.
- Treating a single source as sufficient for a multi-perspective topic.
```

Use `###` subsections so they nest under `## Guidance`. The four sections above (Prerequisites / Steps / Completion reasoning / Red flags) are the expected shape for a `substance` node.

## Example: an entry Decision Core (workflow-entry)

This is the `## Decision Core` body for the entry SKILL.md. The entry is the **most-loaded file** — every invocation reads it first. A thin Decision Core ("run next, load what it says") makes the entire Skill feel mechanical. A rich Decision Core is what makes comet-level Skills feel intelligent.

The Decision Core should model three concerns that the Auto zone does NOT handle: (1) **semantic current-Node detection** (how to determine which Node the user is in, beyond script output), (2) **resume and drift rules** (what to do when context resumes or state conflicts with files), and (3) **decision points and red flags** (where to pause for the user, and what false progress looks like).

```markdown
### Automatic Node Detection

**Step 0: Determine the current Node and intent**

1. Check the workflow protocol for the ordered Node list. The first incomplete Node (no recorded Exit evidence) is the candidate current Node.
2. If the user's message describes work that clearly belongs to a later Node (e.g., "verify the results" when research is not complete), pause and explain: the earlier Node must finish before the later one starts. Do not skip ahead.
3. If the user's message describes work that belongs to an earlier Node that is already marked complete, treat this as a correction — reset that Node's completion and re-enter it.

**Step 1: Read workflow state**

Run `node "$WORKFLOW_STATE" status` to confirm the detected Node. If the script's `NEXT:` output conflicts with file evidence (e.g., script says DONE but no artifacts exist), trust file evidence and correct state before continuing.

**Resume rules**:
- On every context resume, rerun Step 0 and Step 1. Do not trust conversation history for Node detection.
- If workflow state shows a Node as complete but its expected artifacts are missing, treat the Node as incomplete and re-enter it.
- If the user resumes mid-Node with a different topic, confirm whether to continue the current Node or start a new one.

### Decision Classification And Decision Points

Classify before acting: a user decision has two or more valid options that change scope, behavior, accepted risk, or an irreversible outcome; a sole safe next action is automatic handling; a missing dependency, corrupt state, or guard failure with no valid continuation is a stop condition; `NEXT: manual` only returns control. Only the first category must pause.

| Situation | Action |
|-----------|--------|
| First invocation with an unambiguous topic and scope | Initialize state automatically and enter the first Node; do not pause to approve known information |
| Topic, scope, or target Node has two or more mutually exclusive valid interpretations | Merge them into one question and let the user choose; do not guess |
| Node requires user approval of output before advancing | Stop after recording evidence; wait for explicit confirmation |
| Accepting a WARNING/deviation or performing an irreversible publish has a real tradeoff | Show only currently executable options and persist the choice |

When a Node guard fails, inspect evidence and perform the sole safe repair first. If a missing dependency or corrupt state prevents progress, report the stop condition and recovery requirement. Escalate to the decision table only when multiple valid recovery options would change scope or risk.

### Red Flags

| Agent Thought | Actual Risk |
|--------------|-------------|
| "Every first invocation needs another confirmation" | Clear input does not need duplicate approval; ask only when mutually exclusive interpretations still change scope. |
| "The script returned NEXT: auto, so I should immediately load the next Skill" | `NEXT: auto` means the Node is done, not that you should skip confirmation. Check if the next Node has a decision point. |
| "The guard failed, so ask the user what to do" | Diagnose automatically and apply the sole safe repair first; if no valid action exists, report a stop condition instead of inventing options. |
| "This looks like the same topic as last time, resume from where we left off" | Always re-read state. Conversation memory is unreliable after context compaction. |
| "The exit check passed, so the work is good enough" | Exit checks are mechanical. Your job is to judge quality beyond the check — sparse notes, shallow analysis, or missing perspectives are not caught by scripts. |
```

This example models comet's Decision Core in miniature: semantic detection (Step 0 reads Node order, not just script output), state-fidelity (trust files over stale state), resume rules (re-detect on every resume), blocking decision points (explicit table), and red flags (the "thought → risk" pattern that catches agent self-deception).

## substance vs delegates

- **substance** node (workflow-kernel): the example above is the bar. Rich Guidance is mandatory; without it the node renders `AUTHORING PENDING` and the Bundle cannot become ready.
- **delegates** node (comet-five-phase-overlay, delegating to an installed rich Skill): the delegate carries the execution richness, so do NOT duplicate it. But if the node declares **Required Skill Calls** (e.g. require `elementui` at the execute node), author a focused integration note — when, during the delegate's flow, the required Skill must be loaded and what evidence it adds — rather than a generic "load X" line. Example for a delegates execute node requiring `elementui`:

```markdown
This node runs `comet-build` for execution. In addition to that flow, load `elementui` whenever a change touches the component library, and confirm the change uses project-approved components before recording the `required-skill:execute.elementui` check. Do not re-implement what `comet-build` already does.
```

## Anti-patterns (do not write)

- A one-line Guidance like "Run this node and record evidence." — that is what the Auto zone already implies; it adds nothing.
- Copying the bound Skill's body verbatim.
- Restating the route table or the Output Schema list (already in the Auto zone).
- No `### Red flags` section on a substance node — red flags are where most of the real-world value lives.
