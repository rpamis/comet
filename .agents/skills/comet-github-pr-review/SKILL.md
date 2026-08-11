---
name: comet-github-pr-review
description: Perform a read-only, evidence-first review of a Comet community pull request, including current diff, linked issue, review-thread state, mergeability, and CI. Use when asked to review a PR, assess whether comments still apply, or prepare a concise merge-blocker comment.
---

# Comet GitHub PR Review

Load `../comet-github/references/maintainer-contract.md` first. Keep the review read-only unless the user separately authorizes a fix or GitHub response.

## Refresh the target

1. Resolve the PR number or URL and confirm the repository.
2. Fetch current PR metadata: base branch, head branch and SHA, author, linked issues, labels, mergeable state, and update time.
3. Read the complete PR body, commits, diff, comments, and review threads. Check whether threads are resolved or outdated instead of treating every visible comment as active.
4. Query current checks for the exact head. If a check fails, hand the detailed investigation to `comet-github-ci-triage`.

Use the live PR head/base for conclusions. A green test report does not prove that the PR is mergeable if the head is behind the base or has current conflicts.

## Review the implementation

For each claimed behavior:

- find the real production call path;
- compare the implementation with the linked Issue/spec;
- inspect affected tests and generated/runtime assets when relevant;
- reproduce a reachable failure when the report is a bug or blocker;
- check whether the concern is already fixed in the current head.

Review-bot output is evidence to investigate, not an authority. Distinguish production logic, test/fixture drift, generated-output drift, environment noise, and merge conflicts.

## Report only actionable findings

Prefer findings that are reachable and block correctness, data integrity, security, user-visible behavior, or merging. Omit style-only suggestions, theoretical edge cases, and speculative improvements unless they are required by the repository contract.

For each finding include:

- severity and concise title;
- exact file/line or runtime path;
- why the current behavior fails;
- a minimal correction direction;
- evidence status: confirmed, likely, or unverified.

End with a verdict such as `没有必须修复项`, `存在必须修复项`, `需要先解决合并/CI问题`, or `证据不足`.

## Comment and fix boundaries

- If the user asks for a comment, provide copy-paste-ready Chinese Markdown after the analysis.
- Do not post the comment unless explicitly asked.
- If the user asks to fix findings, pass the confirmed scope to `comet-github-issue-fix` or the existing Comet workflow; do not patch based on unresolved bot suggestions.
