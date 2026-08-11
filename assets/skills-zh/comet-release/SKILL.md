---
name: comet-release
description: 根据真实版本和分支范围准备 Comet 发布或发布说明更新，保持 Changelog 面向用户、双语网站文档一致、生成资产已验证，并明确 Git 交付边界。Beta、hotfix、版本检查、发布说明或发布就绪检查时使用。
disable-model-invocation: true
---

# Comet Release

Load `../comet-github/references/maintainer-contract.md` first. This skill prepares release artifacts; commit, push, tag, GitHub release, and npm publication remain separate authorized actions.

## Establish the release boundary

1. Read `package.json`, the lockfile metadata, the active top Changelog heading, current branch, `origin/master`, the previous release tag, and the release/hotfix branch range.
2. Determine whether the branch already has a version higher than master. Append or rewrite that same version instead of inventing a duplicate entry.
3. Build a candidate list from the actual release range, then keep only changes a user upgrading from the previous release would notice.
4. Classify entries as Added, Changed, Fixed, Removed, or Security. Use Fixed only for a user-facing problem that already existed in the released baseline.

## Write the release surface

Write professional, neutral, user-visible English Changelog text. Describe behavior and benefit, not implementation chronology, bundle/cache details, generated file names, Git object IDs, review follow-ups, or ordinary test refactors.

When website release docs are in scope, call `comet-bilingual-docs` to synchronize the accepted semantics across the main repository and `D:\Project\comet-website-docs`. Keep English and Chinese structures aligned.

## Verify readiness

Run checks proportional to the release risk: affected tests and formatting for docs-only changes; build, generated-asset checks, package dry-run, and full tests when Runtime, install, routing, or release metadata changes. Validate the website from its own repository with the available Mintlify command and report timeouts as unverified.

Show the final release version, included user-visible changes, validation results, and remaining unknowns. Use `comet-safe-delivery` for any explicitly authorized commit or push. Do not publish to npm as part of this Skill.
