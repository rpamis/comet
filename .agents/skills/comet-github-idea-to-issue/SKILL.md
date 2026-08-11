---
name: comet-github-idea-to-issue
description: Turn a local Comet idea, observed regression, or proposed improvement into a focused GitHub issue draft grounded in the current codebase. Use when asked to convert local investigation into an issue, follow-up issue, bug report, feature request, or maintenance task.
---

# Comet Local Idea to GitHub Issue

Load `../comet-github/references/maintainer-contract.md` first. Drafting is local/read-only; creating the GitHub issue requires explicit confirmation.

## Establish the issue

1. Understand the local observation and inspect the current implementation, tests, Runtime path, and relevant documentation.
2. Search existing GitHub issues and PRs by domain concept. Decide whether this is a duplicate, a follow-up to an existing issue, or a new report.
3. Choose the smallest matching repository template: bug, feature, task, or question. Read the current YAML template before drafting fields.
4. Separate the user-visible problem from the suspected implementation cause. Include implementation details only when they help reproduce or scope the work.

## Draft the body

Produce:

- a concise title using the repository's template prefix;
- the affected workflow, platform, and version/state;
- current behavior and expected behavior;
- reproduction or motivating workflow;
- evidence and suspected boundary, marked as hypothesis when unverified;
- explicit scope and non-goals;
- acceptance criteria that can be checked independently;
- related issue/PR links and a duplicate-search note.

For a feature, describe the workflow problem and desired behavior before proposing implementation. For a bug, preserve exact commands, logs, versions, and project state when they are necessary to reproduce it.

## Publish only after confirmation

Show the complete proposed title, template type, labels, and body first. Ask for confirmation before calling `gh issue create`. After explicit approval, create the issue, verify the returned URL and title, and report the identifier. Do not modify labels, close related issues, or create additional tickets unless separately requested.
