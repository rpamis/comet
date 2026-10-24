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

## 🐛 User-Issue Regression Registration

<!-- Required: edit the single machine-readable declaration below. Empty fixes is incomplete. -->
<!-- For each resolved behavior, list its source and stable case IDs from config/workflow-regressions.json. Existing tests may be reused with a precise behavior-to-assertion mapping. -->
<!-- If this PR does not fix user behavior, replace the JSON with {"status":"no-user-behavior-fix","reason":"Explain the concrete scope and evidence","fixes":[]}. Do not use this status to hide an untested fix. -->
<!-- See docs/architecture/badcase-maintenance.zh.md for the exact schema and commands. -->

<!-- badcase-registration
{"status":"fixes","fixes":[]}
-->

- Source and separate behaviors:
- Reproduction and root cause (mark unreproduced/unresolved items explicitly):
- Expected and forbidden outcomes; case IDs and exact executable tests:
- Old-code failure / new-code pass evidence, or concrete limitation and alternative evidence:
- Public CLI / shipped bundle / state transitions / recovery / migration checks, as applicable:
- Actual model Eval / platform Hook / browser evidence, as applicable; list anything not run:
- Historical cases retained; any proposed migration and equivalent coverage:

## ✅ Checklist

- [ ] PR title follows Conventional Commits, for example `fix: handle project-scope init`
- [ ] User-facing behavior is documented in `README.md`, `README-zh.md`, or `CONTRIBUTING.md`
- [ ] `CHANGELOG.md` is updated when behavior changes
- [ ] Skill changes were made in Chinese first when applicable, then synced to English
- [ ] New shipped Runtime assets are registered in `assets/manifest.json` and relevant tests
- [ ] Existing SDK recovery fixtures are retained; new versions use new fixture directories
- [ ] Shell scripts remain portable across macOS, Linux, and Windows Git Bash
- [ ] No unrelated generated files or local artifacts are included
- [ ] Every resolved user behavior is declared and mapped to executable cases, or the no-user-behavior-fix declaration has a concrete justification
- [ ] Required evidence boundaries, forbidden outcomes, and unresolved checks are explicit; no historical case was silently removed or weakened

## 👀 Notes for Reviewers

<!-- Anything reviewers should pay special attention to? -->
<!-- Distinguish focused tests, package consumers, real platform Hooks, and model Eval; report failures and skipped checks explicitly. -->

<!-- Reviewers must check omitted behaviors, source-to-assertion coverage, and exception evidence. Automation validates declared cases; it cannot discover every undeclared user bug. -->
