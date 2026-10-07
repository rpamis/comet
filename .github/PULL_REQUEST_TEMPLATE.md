## ✨ Summary

<!-- What changed, and why? Link related issues when available. -->

## 🎯 Scope

<!-- Check all areas touched by this PR. -->

- [ ] CLI commands (`init`, `status`, `doctor`, `update`, `runtime`, `creator`, `application`)
- [ ] Runtime SDK / workflow applications / Creator / Plugin SDK
- [ ] Core installer / platform detection
- [ ] Comet skills (`assets/skills/`, `assets/skills-zh/`)
- [ ] Generated Classic / Native / Entry Runtime bundles
- [ ] Tests / CI
- [ ] Documentation / changelog
- [ ] Other:

## 🧪 Testing

<!-- List the commands you ran and summarize the result. -->

- [ ] `pnpm build`
- [ ] `pnpm lint`
- [ ] `pnpm run lint:architecture`
- [ ] `pnpm format:check`
- [ ] `pnpm test`
- [ ] `pnpm test:sdk`
- [ ] `pnpm check:sdk-api`
- [ ] `pnpm check:sdk-fixtures --base <comparison-commit>`
- [ ] `pnpm test:package-e2e`
- [ ] `pnpm test -- test/domains/comet-classic/comet-scripts.test.ts`
- [ ] Not run:

## ✅ Checklist

- [ ] PR title follows Conventional Commits, for example `fix: handle project-scope init`
- [ ] User-facing behavior is documented in `README.md`, `README-zh.md`, or `CONTRIBUTING.md`
- [ ] `CHANGELOG.md` is updated when behavior changes
- [ ] Skill changes were made in Chinese first when applicable, then synced to English
- [ ] New shipped Runtime assets are registered in `assets/manifest.json` and relevant tests
- [ ] Existing SDK recovery fixtures are retained; new versions use new fixture directories
- [ ] Shell scripts remain portable across macOS, Linux, and Windows Git Bash
- [ ] No unrelated generated files or local artifacts are included

## 👀 Notes for Reviewers

<!-- Anything reviewers should pay special attention to? -->
<!-- Distinguish focused tests, package consumers, real platform Hooks, and model Eval; report failures and skipped checks explicitly. -->
