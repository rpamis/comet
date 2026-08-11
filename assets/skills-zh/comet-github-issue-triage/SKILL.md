---
name: comet-github-issue-triage
description: 对照当前仓库契约、源码、Runtime、测试和安装行为，验证并分类 Comet GitHub Issue。用户询问 Issue 是否真实、可复现、重复、已实现、属于配置问题，或是否适合后续处理时使用。
disable-model-invocation: true
---

# Comet GitHub Issue Triage

Load `../comet-github/references/maintainer-contract.md` first. Keep the workflow read-only unless the user explicitly authorizes a GitHub or code change.

## Gather current evidence

1. Read the full issue body, comments, labels, author, timestamps, linked PRs, and previous triage notes.
2. Search existing issues by domain concept, not only by the reporter's wording. Identify duplicates, superseding issues, and already-implemented behavior.
3. Inspect the current source, configuration, install path, generated assets, and relevant tests. Use the repository's actual contract as the reference point.
4. For a bug with sufficient steps, reproduce the smallest meaningful path. For an environment or credential report, separate local setup from product behavior.

Do not infer a defect from a convincing description alone. A report may be valid, overstated, stale, or caused by a local installation/configuration mismatch.

## Classify the result

Choose one primary classification:

- `confirmed defect` — current behavior violates a user-visible or repository contract and evidence identifies the path;
- `likely defect` — strong evidence exists but reproduction or a decisive boundary is missing;
- `configuration/install issue` — current product behavior is correct or the local installation is stale/misconfigured;
- `duplicate/already implemented` — the behavior or issue already exists elsewhere;
- `insufficient information` — ask for specific missing steps, versions, logs, platform, or project state;
- `feature request` — the report describes a desired capability rather than a regression.

## Report and next action

Return:

1. classification and confidence;
2. evidence inspected and the relevant code/runtime path;
3. what is confirmed, what is not, and what would change the conclusion;
4. recommended next action: request information, fix locally, create a focused follow-up, link an existing PR, or close as duplicate/already implemented.

Do not close, label, comment, or create a follow-up issue automatically. If a follow-up issue is appropriate, let `comet-github-idea-to-issue` draft it after the user confirms scope.
