# Contributing to Comet

Languages: [English](CONTRIBUTING.md) | [中文](CONTRIBUTING-zh.md)

Thank you for helping improve Comet. This guide explains how to set up the
project, prepare a change, keep branches healthy, submit a pull request, and
update project-specific assets such as skills and workflow runtimes.

Deeper project conventions (Chinese terminology, changelog authoring, bilingual
skill sync, restraint on README updates, etc.) live in `CLAUDE.md`. This guide
covers only the contribution flow itself and does not repeat those rules.

## Before You Start

- First-time contributors can look for issues labeled `good first issue`.
- For bug fixes, first check whether an issue or recent PR already covers the
  same problem.
- For larger behavior changes, open an issue or draft PR early so the direction
  can be discussed before too much code is written.
- Keep each contribution focused on one purpose. Split unrelated changes into
  separate PRs.
- Include tests or explain why a change does not need tests.
- Update documentation and `CHANGELOG.md` when behavior, commands, workflows, or
  user-facing text changes.
- A PR version may only be ahead of `master` by exactly one version. For
  example, if `master` is `0.3.0`, the PR version must be `0.3.1`.

## Standard Contribution Workflow

- Leave a comment under the issue you want to claim, to avoid duplicate work.
- Create a task branch from the latest `master`, named after the feature or fix
  area, for example `fix/dev-resync-docs` or `docs/contributing-guide`.
- Implement the change locally, add tests, and run targeted checks.
- Before PR review, run the full verification command:
  `pnpm build && pnpm lint && pnpm format:check && pnpm test`, unless the change
  is documentation-only.
- Open a PR against `master` and follow the template to describe what changed,
  why it changed, and how it was verified.
- After the PR is submitted, three AI reviewers will leave feedback. Their
  suggestions are not always correct — you need to identify which comments are
  actionable and which are AI misjudgments, and address everything genuinely
  related to your PR.
- Once you fix the AI review comments, just push your changes; the PR updates
  automatically. You must reply to every AI comment and click
  `Resolve conversation` on the ones you consider resolved.
- After everything is resolved, wait for the human maintainer's review
  feedback.

## Issues You Can Claim

- Issues labeled `good first issue`.
- Issues labeled `task`.
- Issues labeled `bug`.
- Before claiming, confirm the issue has not already been claimed by or
  assigned to someone else, to avoid duplicate work.

## Development Setup

```bash
git clone https://github.com/rpamis/comet
cd comet
pnpm install
pnpm build
```

- Node.js `>=22`. The pnpm version is pinned in `package.json`'s `packageManager`
  field (currently `pnpm@10.18.3`).
- If dependency installation or build behavior differs locally, mention it in
  the PR.

## Commands

| Command                      | Purpose                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm dev`                   | Watch mode (TypeScript)                                                               |
| `pnpm build`                 | Full build (Classic, Native, and entry runtimes + dashboard)                          |
| `pnpm build:classic-runtime` | Build only the Classic runtime (`scripts/build/build-classic-runtime.mjs`)            |
| `pnpm build:native-runtime`  | Build only the Native runtime (`scripts/build/build-native-runtime.mjs`)              |
| `pnpm build:entry-runtime`   | Build only the shared entry and Hook Router (`scripts/build/build-entry-runtime.mjs`) |
| `pnpm build:dashboard`       | Build only the `comet dashboard` frontend (Vite)                                      |
| `pnpm dev:dashboard`         | Dashboard frontend dev mode                                                           |
| `pnpm test`                  | Run unit tests (Vitest)                                                               |
| `pnpm test:coverage`         | Run tests with coverage                                                               |
| `pnpm test:script-smoke`     | Run the Classic launcher smoke suite; CI entry point                                  |
| `pnpm test:watch`            | Vitest watch mode                                                                     |
| `pnpm lint`                  | ESLint + architecture linter                                                          |
| `pnpm lint:architecture`     | Repository layering linter (`scripts/lint/architecture.mjs`)                          |
| `pnpm lint:fix`              | ESLint auto-fix                                                                       |
| `pnpm format`                | Prettier formatting for `app/`, `domains/`, `platform/`                               |
| `pnpm format:check`          | Prettier check (CI-enforced)                                                          |
| `pnpm benchmark:context`     | Context compression benchmark                                                         |
| `pnpm benchmark:execution`   | Context execution benchmark                                                           |
| `pnpm benchmark:classic`     | Classic baseline regression benchmark                                                 |
| `pnpm benchmark:bundle`      | Bundle compatibility benchmark (includes build)                                       |

For workflow runtime work, first check freshness for the affected owner. Classic
launchers also have a focused smoke suite:

```bash
node scripts/build/build-classic-runtime.mjs --check
node scripts/build/build-native-runtime.mjs --check
node scripts/build/build-entry-runtime.mjs --check
npx vitest run test/domains/comet-classic/comet-scripts.test.ts
```

Before opening or updating a PR, run the full verification command unless the
change is documentation-only:

```bash
pnpm build && pnpm lint && pnpm format:check && pnpm test
```

## Branching Model

- `master` is the canonical development and release base.
- Create task branches from the latest `master`.
- Open PRs against `master`.
- Merge PRs with **Squash and merge**.
- Treat squashed PR branches as disposable: delete them after merge, or
  recreate/reset them from `master` before reuse.

Squash merge creates a new commit on `master`. If the source branch still keeps
the original commits, Git cannot always recognize that both histories contain
equivalent changes. Because of that, do not keep merging `master` back into a
branch that has already been squashed.

## Preparing a Change

```bash
git fetch origin
git switch master
git pull --ff-only origin master
git switch -c <type>/<short-topic>
```

Use a short branch name that describes the change, for example
`fix/dev-resync-docs` or `docs/contributing-guide`.

While working:

- Keep commits small enough to review.
- Prefer adding tests before or with the implementation.
- Run targeted tests during development.
- Re-run formatting before the final diff.
- Avoid broad rewrites, formatting sweeps, or unrelated metadata churn.

## Keeping a PR Current

If a PR branch falls behind `master`, prefer rebasing your task branch onto the
latest `master`:

```bash
git fetch origin
git switch <your-branch>
git rebase origin/master
# resolve conflicts, then run the relevant checks
git push --force-with-lease
```

Use `--force-with-lease` after a rebase because it protects remote work that you
do not have locally. Avoid plain `--force`.

If the branch has become tangled with unrelated commits, create a clean branch
from `origin/master` and cherry-pick only the commits that belong to the PR:

```bash
git fetch origin
git switch -c <topic>-take-2 origin/master
git cherry-pick <commit-1> <commit-2>
# run checks
git push --force-with-lease origin <topic>-take-2:<original-branch>
```

This keeps the PR reviewable and prevents accidental merges of unrelated work.

## Shared `dev` Branch

If you keep a shared `dev` branch, use it only as a temporary working branch.
After a PR from `dev` is squashed into `master`, do not merge `master` back into
`dev`. Reset `dev` to `origin/master` after confirming there is no unsquashed
work that still needs to be preserved:

```bash
git fetch origin
git switch dev
git status --short
git branch backup/dev-before-sync-YYYYMMDD
git reset --hard origin/master
git push --force-with-lease origin dev
```

If `dev` contains work that has not been merged to `master`, move that work to a
new branch from `origin/master` before resetting `dev`.

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>: <description>
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`

Examples:

```text
feat: add eval report language switch
fix(eval): prevent chart labels from overlapping
docs: update contributor commit rules
```

## Local Pre-commit Hook

The repository ships a Git pre-commit hook (`.husky/pre-commit` + `lint-staged`)
that runs `prettier --write` on every `git commit` against staged source files
under `app/`, `domains/`, and `platform/`. The scope matches CI `format:check`,
is editor-independent, and applies to every contributor.

- The hook is installed by `husky` during `pnpm install`.
- On Windows with `core.autocrlf=true`, untouched legacy files may be falsely
  flagged by `prettier --check` due to CRLF. The hook only processes staged
  files; legacy files are auto-converted to LF the next time they are edited.
- You should still run `pnpm lint`, `pnpm build`, and `pnpm test` manually
  before committing — CI enforces all of them.

## PR Process

1. Update `master` and create a feature branch from it.
2. Implement a focused change with tests.
3. Run targeted checks while developing.
4. Run `pnpm build && pnpm lint && pnpm format:check && pnpm test` before PR
   review, unless the change is documentation-only.
5. Open a PR against `master`.
6. Describe what changed, why it changed, and how it was verified.
7. Respond to review feedback with follow-up commits.
8. Use **Squash and merge** when the PR is approved.
9. Delete or recreate the source branch after merge; do not keep merging
   `master` back into a squashed branch.

For documentation-only changes, run at least the relevant formatter check. Root
`README.md` and `README-zh.md` are listed in `.prettierignore` and are not
checked by Prettier, for example:

```bash
npx prettier --check CONTRIBUTING.md CONTRIBUTING-zh.md
```

## Project Structure

Source code is layered by responsibility, with each layer having a clear scope:

```text
app/                 # CLI entry and command orchestration. Composes domain/platform capabilities only; holds no domain rules.
├── cli/             # Commander registration
└── commands/        # comet init / status / doctor / update / bundle / publish / skill / creator / eval / dashboard ...

domains/             # Business domain modules
├── bundle/          # Skill bundle compilation, publishing, loading
├── comet-classic/   # Classic workflow (state / guard / handoff / archive / intent / hook-guard)
├── comet-entry/     # Shared Native/Classic entry, selection, and Hook Router
├── comet-native/    # Native workflow (change / state / evidence / archive / guard)
├── dashboard/       # comet dashboard backend + frontend (web/)
├── engine/          # Generic execution engine (loop / state / guardrails / evals)
├── eval/            # comet eval harness
├── factory/         # Skill creator artifact packaging
├── integrations/    # Third-party integrations (openspec / superpowers / codegraph)
├── skill/           # Skill install, discovery, preferences, snapshot
└── workflow-contract/ # Cross-workflow contracts

platform/            # Platform adaptation; domain code does not leak platform differences
├── fs/              # Filesystem utilities
├── install/         # Platform definitions, detection, install paths
├── paths/           # Repository layout resolution
├── process/         # Subprocesses, error handling, shell quoting
└── version/         # Version comparison

scripts/             # Repository automation (build / release / benchmark / lint / install)
├── benchmark/       # Benchmark suites
├── build/           # Classic, Native, and entry runtime builders
├── install/         # postinstall.js
├── lib/             # Cross-script utilities
├── lint/            # architecture.mjs, gitignore-top-level.mjs
└── release/         # prepare.js, prepublish-check.js

assets/              # Release assets: built-in skill content and install manifest
├── skills/          # English skills
├── skills-zh/       # Chinese skills
└── manifest.json    # Install entry point

docs/                # Architecture, operations, and design docs (docs/superpowers/ is written by the workflow)
```

`bin/comet.js` is the npm `bin` entry; `build.js` is the top-level build
script; `vitest.config.ts` / `eslint.config.js` / `tsconfig.json` are tooling
configurations.

## Architecture Linter

`pnpm lint:architecture` (`scripts/lint/architecture.mjs`) verifies:

- The top-level directory whitelist
  (`config/repository-layout.json`'s `allowedTopLevelEntries`).
- Active source roots are restricted to `app` / `domains` / `platform`
  (`sourceRoots`).
- Sub-modules of each layer
  (`appModules` / `domainModules` / `platformModules` / `scriptModules`).
- Classic, Native, and entry runtime entry/output consistency.
- Built-in skill roots and the install manifest are consistent.
- Test ownership (see the next section).
- Migration-legacy directories (e.g. `src/`, `test/ts/`) are not reintroduced.

If you genuinely need to add a top-level directory, source module, test root,
or exception, **you must update `config/repository-layout.json`, the
architecture linter rules, and the relevant sections of this guide before
opening the PR**.

## Test Directory Layout

Test directories strictly follow the ownership of the code under test:

| Test directory           | Coverage                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `test/app/`              | CLI and commands under `app/`                                                                              |
| `test/domains/<domain>/` | The matching `domains/<domain>/` (each domain has a same-named subdirectory)                               |
| `test/platform/`         | The `platform/` adaptation layer                                                                           |
| `test/scripts/`          | The `scripts/` automation scripts                                                                          |
| `test/repository/`       | Cross-layer constraints: README, CI workflows, repository layout, package scripts, workflow runtime assets |
| `test/fixtures/`         | Test data                                                                                                  |
| `test/helpers/`          | Test utilities (`comet-test-utils.ts`, `ensure-cli-built.ts`, `workflow-plan.ts`)                          |

Do not add horizontal buckets like `test/ts/`; legacy files should be migrated
to the directories above. The CI smoke entry point is
`pnpm test:script-smoke`; GitHub Actions and local runs share the same Classic
launcher smoke suite.

## Adding a New Platform

1. Add an entry to `PLATFORMS` in `platform/install/platforms.ts`.
2. Add the mapping to `SKILLS_AGENT_MAP` in `domains/integrations/superpowers.ts`
   if it differs.
3. Add or update tests (`test/platform/` and the relevant domain tests) that
   cover detection, installation paths, and generated instructions.
4. Update `assets/manifest.json` and the README documentation.
5. If the platform is user-facing, record it in `CHANGELOG.md`.

## Adding or Updating a Skill

1. Write or update the Chinese version first under `assets/skills-zh/`.
2. Get the wording and behavior confirmed, then sync the English version under
   `assets/skills/`. The two versions must be behaviorally equivalent.
3. Add new skills to `assets/manifest.json`.
4. Add tests for generated assets or installer behavior when applicable
   (`test/domains/skill/`, `test/repository/classic-runtime-assets.test.ts`).
5. When changing skill boilerplate, sync every copy across all `SKILL.md` and
   `reference/*` files.
6. **Never directly modify the original Superpowers or OpenSpec skills.**

Skill design guidance:

- **Decision Core first**: Agent-facing instructions go at the top, including
  phase detection, dispatch logic, and error handling.
- **Reference Appendix**: Field reference, script locations, and best practices
  go at the bottom.
- Keep Chinese and English versions behaviorally equivalent, even when wording
  differs naturally. Chinese terminology follows the translation rules in
  `CLAUDE.md` (do not translate `gate` as "门").

## Workflow Runtimes and Hook Routing

Workflow scripts are **Node.js launchers or generated bundles** (`.mjs`). They
depend only on Node.js and **never on Bash / Git Bash / WSL**, so behavior is
identical on macOS, Linux, and Windows.

- Classic thin launchers live in `assets/skills/comet/scripts/`; real logic
  lives in `domains/comet-classic/` and `pnpm build:classic-runtime` generates
  `comet-runtime.mjs`.
- Native logic lives in `domains/comet-native/`; `pnpm build:native-runtime`
  generates `assets/skills/comet-native/scripts/comet-native-runtime.mjs`.
  The Native core workflow and Guard must not depend on external Skills.
- Shared entry resolution, selection, and Hook routing live in
  `domains/comet-entry/`; `pnpm build:entry-runtime` generates
  `comet-entry-runtime.mjs` and `comet-hook-router.mjs`.
- Each platform installs one `comet-workflow-guard` Rule. Platforms with Hook
  support install only `comet-hook-router.mjs`. The Router uses
  `.comet/current-change.json` to invoke exactly one Native or Classic Guard per
  write. Their phases, directories, schemas, and Guard logic remain separate.
- `comet-hook-guard.mjs` and `comet-native-hook-guard.mjs` are thin launchers
  for their workflow Guards; neither is installed directly as a platform Hook.
- Cross-platform concerns are handled by Node: hashing via `node:crypto`, YAML
  via the `yaml` package, subprocesses via `child_process`
  (build/validate commands go through `spawnSync(cmd, { shell: true })`). There
  are no `sed -i` / `sha256sum` vs `shasum` / `pipefail` portability hazards.
- `comet-env.mjs` prints its own directory so skill boilerplate can resolve
  sibling launcher paths via `node "$COMET_ENV"`. Commands use the unified form
  `node "$COMET_STATE" ...`.
- When adding or renaming an entry or generated output, sync
  `assets/manifest.json`, the matching runtime mapping in
  `config/repository-layout.json`, and the corresponding
  `test/repository/*-runtime-assets.test.ts`. Classic launchers also require an
  update to the fixture list in
  `test/domains/comet-classic/comet-scripts.test.ts`.

Runtime dispatch:

```text
comet-runtime.mjs        <- domains/comet-classic/*
comet-native-runtime.mjs <- domains/comet-native/*
comet-entry-runtime.mjs  <- domains/comet-entry/*
comet-hook-router.mjs    <- only installed Hook entry -> one Guard selected by current ownership
```

## `.comet.yaml` State Changes

When changing fields in a `.comet.yaml` state file, update all three places (all
in TypeScript):

1. `domains/comet-classic/classic-state-command.ts` for the `set` whitelist and
   enum validation (`SETTABLE_FIELDS` / `MACHINE_OWNED_FIELDS`).
2. `domains/comet-classic/classic-validate-command.ts` for schema validation
   and the known field set.
3. `test/domains/comet-classic/comet-scripts.test.ts` for YAML examples and
   assertions.

Then run `pnpm build` to regenerate `comet-runtime.mjs`, otherwise the freshness
check in `classic-runtime.test.ts` will fail.

## Dashboard / Eval / Skill Creator / Skill CLI

Comet has grown from a single `/comet` workflow bundle into a workflow + skill
authoring platform. When working on these commands, note:

- **`comet dashboard`**: A local read-only browser dashboard. Frontend code
  lives in `domains/dashboard/web/` and is built separately via
  `pnpm build:dashboard`. The backend `domains/dashboard/server.ts` exposes
  `--json` and `GET /api/dashboard`.
- **`comet eval`**: Repository-local evaluation, including profiles,
  manifests, HTML reports, token/cost attribution, pass@k/pass^k. See
  `docs/operations/EVAL-USAGE.md`.
- **`comet creator` / `comet publish`**: Main skill-authoring flow. See
  `docs/operations/SKILL-CREATION.md`. `domains/bundle/*` is their backend
  tooling.
- **`comet skill add|show|run|continue|check`**: Local skill package
  management. Code lives in `domains/skill/`.

When changing the behavior or output of these commands, update the
corresponding `docs/operations/*` document and the matching
`test/domains/<domain>/` tests.

## Documentation and Bilingual Conventions

Detailed rules live in `CLAUDE.md`. Quick reference:

- **Bilingual order**: Write the Chinese version of skills / docs first
  (`assets/skills-zh/`, `README-zh.md`, `CONTRIBUTING-zh.md`,
  `docs/operations/*-ZH.md`), then sync the English version after user
  confirmation. For skill content changes, do not write the changelog entry
  until Chinese and English are fully in sync.
- **README restraint**: After a feature update, do not pile every highlight
  into the README. Necessary features should be referenced via `docs/`.
- **Chinese terminology**: Do not translate `gate` as "门" (e.g. "压缩门" /
  "调试门" reads unnaturally). Translate by context as "协议" (protocol),
  "阶段" (phase), "检查" (check), or "阻塞点" (blocker). Modifying
  `proactive` / `active` translates as "主动式".
- **Skill trigger phrasing**: Chinese uses the unified
  `**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。`
  and English uses the unified
  `**Immediately execute:** Use the Skill tool to load the <skill-name> skill. Skipping this step is prohibited.`.
- **Commit / GitHub conventions**: Do not comment on or open PRs on GitHub
  without explicit approval; do not append a `Co-Authored-By` line to commit
  messages.

## Changelog

`CHANGELOG.md` is written in English and records **user-visible** behavior
changes. See `CLAUDE.md` for the full categorization and the
"release-perspective check" rules. Quick reference:

- The version number must match `package.json`. New version entries go at the
  top, and a PR may only be one version ahead of `master`.
- If the current branch already has a version entry ahead of `master`, append
  to that same entry instead of adding a new running-tally version.
- Group order: `Added → Changed → Fixed → Tests → Removed → Security`. Each
  entry starts with `- **Bold keyword**: `.
- Describe behavior changes and rationale, not implementation trivia.
- Before writing, run `git log <previous-tag>..HEAD --oneline` to see the real
  diff; only write "what a user upgrading from the previous version would
  notice".
- Do not include branch-internal review follow-ups, doc syncs, test refactors,
  or internal fixes in the changelog.
- For skill content changes, the changelog entry must wait until Chinese and
  English are fully in sync.

Template:

```markdown
## What's Changed [x.y.z] - YYYY-MM-DD

### Added

- **Feature name**: Describe what changed and why.

### Changed

### Fixed

### Tests

### Removed

### Security
```

`### Tests` is only used when the testing/evaluation capability itself is a
user-runnable release feature; ordinary regression tests, coverage backfill,
and test file migrations are not recorded in the changelog.

## Security

- Scan for API keys, secrets, tokens, and private keys before publishing.
- Keep `.npmignore` aligned so source-only and local configuration files are not
  published to npm.
- Keep `.gitignore` coverage for secrets, credentials, and IDE-specific files.
- Validate user-provided change names against path traversal before using them
  in filesystem paths.
- In symlink install mode, skill installation must not replace a `skills/`
  directory that contains files outside the managed manifest (see issue #159 in
  the `0.4.0-beta.2` entry of `CHANGELOG.md`).
