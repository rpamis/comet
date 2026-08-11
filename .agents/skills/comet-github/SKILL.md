---
name: comet-github
description: Route Comet GitHub maintenance requests to the correct evidence-first workflow for pull request review, issue triage, local idea intake, CI diagnosis, or issue implementation. Use when a request mentions a Comet GitHub issue or PR without a precise workflow, or asks to decide what to do next.
---

# Comet GitHub

Use this skill as the explicit entry point for Comet GitHub work. Load [the shared maintainer contract](references/maintainer-contract.md) before routing.

## Route by intent

- “审阅 PR / 看这个 PR” → `comet-github-pr-review`
- “看下这个 Issue 是否成立 / 是不是 bug” → `comet-github-issue-triage`
- “把这个本地想法提成 Issue” → `comet-github-idea-to-issue`
- “CI 有报错 / 哪个 job 失败了” → `comet-github-ci-triage`
- “按照这个 Issue 修复” → `comet-github-issue-fix`

If the request combines review and repair, complete the read-only diagnosis first, then state the proposed handoff. Do not silently cross from analysis into code or GitHub mutation.

## Shared routing rules

1. Identify the repository, issue/PR number or URL, current local branch, and requested mutation level.
2. Refresh live GitHub state before relying on pasted comments, old CI results, or remembered SHAs.
3. Keep evidence, diagnosis, proposed action, and completed action as separate sections.
4. Report uncertainty explicitly: `confirmed`, `likely`, `insufficient evidence`, `blocked`, or `unverified`.
5. Default to read-only. Posting comments, changing labels, closing issues, creating issues, committing, pushing, or opening PRs requires explicit authorization.

## Handoff output

Return a short routing decision, the selected Skill, the evidence that makes the route appropriate, and the next safe action. Preserve the user's requested scope and do not treat a generated draft as a published GitHub change.
