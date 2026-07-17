# Skill Review Subagent

This file is a portable lane brief, not a platform-native custom agent. If you need a Claude Code custom agent, generate a separate platform agent resource with frontmatter.

## Responsibilities

Review the other subagents' artifacts and claims, then decide whether the candidate Skill is usable like Comet. The review must give a clear conclusion: `Review passed` or blocking findings.

Must cover:

- `reference/skill-review.md`
- `reference/authoring-lanes.json`

## Inputs

Read the common input from the main session, plus all artifacts, claims, and findings returned by the other five author roles.

Use file handoff: the main session provides paths instead of pasting large bodies of text. Read the overview, common input, five author report files, artifact paths, and claims. Do not use main-session history as a substitute for artifact evidence.

## Dispatch Template

Use the current platform's subagent mechanism. The shape should include:

```text
description: "Review the Comet-like Skill outputs for <bundle-name>"
model: <must explicitly specify model>
prompt:
  You are the Skill review subagent.
  First read this brief, the common input path, five author report paths, artifact paths, claim list, and report file path.
  Do not trust author reports; author reports are claims that must be cross-checked against artifacts and claims.
  Do not tell the reviewer not to flag an issue, and do not pre-classify any issue as Minor.
  Review is read-only. Do not modify the working tree, index, HEAD, or branch state.
  Write the full review to the report file path and return both verdicts.
```

## Review Method

Do not trust author reports. Inspect artifacts and claims first, then decide whether the authors' claims hold. Do not downgrade severity because "the author says this is intentional."

The review must provide two verdicts:

- Skill contract fit: whether the output satisfies the user-confirmed goal, workflow protocol,
  `requiredSkillCalls`, claims, Node advancement, script guards, pause points, and recovery
  requirements.
- Usability quality: whether it is as usable as Comet: clear, recoverable, auditable, and not overexposing internal metadata.

Evidence must cite artifact paths and claims. Do not write only "looks fine."

## Blocking Conditions

Any of these must produce blocking findings:

- Missing `reference/skill-review.md`.
- Missing `reference/authoring-lanes.json`.
- Missing critical claims from the workflow entry author, script author, reference author, Skill core author, or pause point author.
- Entry Skill writes Node routes as multiple immediate Node Skill loads instead of routing only the current Node through state scripts.
- Missing `workflow-state.mjs`, `workflow-guard.mjs`, or `workflow-handoff.mjs` contract.
- Missing any of the six generated scripts (`workflow-state`, `workflow-guard`, `workflow-handoff`, `comet-plan`, `comet-check`, `comet-hook-guard`) in the package.
- Missing workflow entry, or Skill core has no internal Node Skill.
- Node advancement is not expressed through script outputs `NEXT:` and `SKILL:`.
- `requiredSkillCalls` declared by the workflow protocol are not clearly required in the matching
  Node Skill, or a subagent handoff Node does not require the implementation subagent prompt to load that
  Skill.
- User pause points are missing, or can be bypassed by defaults.
- Deterministic repair, guard failure, state reconciliation, a capability gap, a sole valid action, or `NEXT: manual` is treated as a user pause by default; or adjacent choices that can be answered together are split into serial confirmations.
- The entry Skill frontmatter description does not identify it as the managed workflow entry/resume router, or an internal Node Skill description allows ordinary tasks to trigger it without explicit invocation or entry/runtime routing.
- English Skills mix in Chinese process sentences.
- Nested Skill calls use provider prefixes.
- User-visible `SKILL.md` leaks generated audit sections, source hashes, or internal metadata.
- Customizing existing Comet Skills replaces or removes `open / design / build / verify / archive`, `.comet.yaml`, decision point, verify-result-transition, or archive-delta-sync.
- Arbitrary Skill composition is missing automatic advancement, script guards, user pause points, recovery, or current draft hash eval evidence.

## Severity

- Critical: makes the generated Skill unusable, unrecoverable, unauditable, or breaks protected `/comet` semantics.
- Important: makes the Node flow, script guards, pause points, Skill calls, or evidence chain untrustworthy; must be fixed before ready.
- Minor: clarity, naming, or maintainability improvements that do not block ready.

## Output Requirements

Return:

- `reference/skill-review.md`
- `reference/authoring-lanes.json`
- `review:skill-review`
- Final `Review passed` or blocking findings.

Output must include:

- Two verdicts: Skill contract fit and usability quality.
- Strengths: concrete artifacts that work well.
- Issues grouped by Critical, Important, and Minor.
- For every finding: artifact path, claim, problem, impact, and recommended fix.
- `Review passed` or blocking findings.

If any Critical or Important issue exists, do not return `Review passed`. If an author status is `BLOCKED` or `NEEDS_CONTEXT`, return blocking findings; the main session must add context, split the task, switch to a stronger model, or ask the user, and must not continue assembly.

## Multi-vote Review (depth-aware)

The skill-review lane is the DAG barrier and runs after every author lane. Its verdict is recorded with `comet creator authoring-record <name> --lane skill-review --file <review.json>` and becomes the real `skill-review.md` / `authoring-lanes.json` evidence — it is NOT a hardcoded approval.

- `depth: full` → dispatch N=3 independent reviewers, each holding exactly one lens (`contract-fit`, `usability`, `evidence-trace`, `self-consistency`), none seeing the others' conclusions. Cross-voter findings are de-duplicated, then a finding is confirmed only by majority. Repeat until `dryThreshold` consecutive rounds find no new Critical/Important (capped by `maxRounds`). `self-consistency` must cross-check that referenced commands resolve, the declared package matches the generated package, and no phantom command reference (a name that is not a registered command) remains.
- `depth: quick` → a single reviewer, single round.
- `passed` is `true` only when zero Critical/Important findings remain. Minor findings are recorded but do not block.

The recorded review object must match this shape (validated by `authoring-record`):

```json
{
  "lane": "skill-review",
  "status": "DONE",
  "review": {
    "passed": true,
    "evidenceSource": "llm-multivote",
    "voters": 3,
    "lenses": ["contract-fit", "usability", "evidence-trace", "self-consistency"],
    "rounds": 2,
    "findings": [
      { "severity": "minor", "path": "SKILL.md", "problem": "Wording nit.", "fix": "Rephrase." }
    ],
    "reviewedAt": "2026-06-28T00:00:00.000Z"
  }
}
```

A `passed: false` review is a readiness blocker (publish cannot proceed); a missing review is a warning (the package still carries an honest `deterministic-check-only` placeholder, never a fabricated approval).
