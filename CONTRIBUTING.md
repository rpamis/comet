# Contributing to Comet

Languages: [English](CONTRIBUTING.md) | [中文](CONTRIBUTING-zh.md)

Thank you for helping improve Comet. This guide is meant to be practical: it
explains how to set up the project, prepare a change, keep branches healthy,
submit a pull request, and update project-specific assets such as skills and
shell scripts.

## Before You Start

- For bug fixes, first check whether an issue or recent PR already covers the
  same problem.
- For larger behavior changes, open an issue or draft PR early so the direction
  can be discussed before too much code is written.
- Keep each contribution focused on one purpose. Split unrelated changes into
  separate PRs.
- Include tests or explain why a change does not need tests.
- Update documentation when behavior, commands, workflows, or user-facing text
  changes.

## Development Setup

```bash
git clone https://github.com/rpamis/comet
cd comet
pnpm install
pnpm build
```

Use the Node.js and pnpm versions supported by the repository lockfile and CI.
If dependency installation or build behavior differs locally, mention it in the
PR.

## Commands

| Command              | Purpose                                |
| -------------------- | -------------------------------------- |
| `pnpm dev`           | Watch mode (TypeScript)                |
| `pnpm build`         | Compile TypeScript                     |
| `pnpm test`          | Run unit tests                         |
| `pnpm test:coverage` | Run tests with coverage                |
| `pnpm test:shell`    | Run shell script tests (requires bats) |
| `pnpm lint`          | Run ESLint                             |
| `pnpm format`        | Run Prettier                           |

For shell-script work, the most useful targeted check is:

```bash
npx vitest run test/ts/comet-scripts.test.ts
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
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Examples:

```text
docs: expand contribution workflow
fix: preserve stderr when superpowers install fails
test: cover comet state transitions
```

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

For documentation-only changes, run at least the relevant formatter check, for
example:

```bash
npx prettier --check CONTRIBUTING.md CONTRIBUTING-zh.md README.md README-zh.md
```

## Project Structure

```text
src/
├── cli/index.ts       # Commander registration
├── commands/          # Command orchestrators
│   ├── init.ts        # comet init
│   ├── status.ts      # comet status
│   ├── doctor.ts      # comet doctor
│   └── update.ts      # comet update
├── core/              # Business logic (platform-agnostic)
│   ├── platforms.ts   # Platform definitions
│   ├── detect.ts      # Platform detection
│   ├── skills.ts      # Skill file operations
│   ├── openspec.ts    # OpenSpec installation
│   └── superpowers.ts # Superpowers installation
└── utils/
    └── file-system.ts # File I/O utilities
```

## Adding a New Platform

1. Add an entry to `PLATFORMS` in `src/core/platforms.ts`.
2. Add the mapping to `SKILLS_AGENT_MAP` in `src/core/superpowers.ts` if it
   differs.
3. Add or update tests that cover detection, installation paths, and generated
   instructions.
4. Update README documentation if the platform is user-facing.

## Adding or Updating a Skill

1. Write or update the Chinese version first under `assets/skills-zh/`.
2. Get the wording and behavior confirmed.
3. Sync the English version under `assets/skills/`.
4. Add new skills to `assets/manifest.json`.
5. Add tests for generated assets or installer behavior when applicable.

Skill design guidance:

- **Decision Core first**: Agent-facing instructions go at the top, including
  phase detection, dispatch logic, and error handling.
- **Reference Appendix**: Field reference, script locations, and best practices
  go at the bottom.
- Keep Chinese and English versions behaviorally equivalent, even when wording
  differs naturally.

## Shell Scripts

Shell scripts live under `assets/skills/comet/scripts/` and must work on macOS,
Linux, and Windows Git Bash.

Rules:

- Do not use `sed -i`; GNU and BSD behavior differ. Use `awk` for field
  replacement.
- Support both `sha256sum` on GNU systems and `shasum -a 256` on BSD/macOS.
- Add `|| true` to optional `grep` results so `pipefail` does not abort the
  script.
- Add new scripts to the `beforeEach` copy list in
  `test/ts/comet-scripts.test.ts`.
- Add new scripts to `assets/manifest.json`.

Script dependencies:

```text
comet-state.sh <- comet-guard.sh, comet-handoff.sh, comet-archive.sh
comet-yaml-validate.sh <- comet-guard.sh (preflight phase)
comet-handoff.sh <- comet-state.sh (writes handoff_context/handoff_hash)
```

If two scripts need the same small helper, such as hashing or YAML parsing, it
is acceptable to implement it independently in each script instead of forcing a
shared shell library.

## `.comet.yaml` State Changes

When changing fields in a `.comet.yaml` state file, update all three places:

1. `assets/skills/comet/scripts/comet-state.sh` for the `cmd_set` whitelist and
   enum validation.
2. `assets/skills/comet/scripts/comet-yaml-validate.sh` for schema validation
   and `KNOWN_KEYS`.
3. `test/ts/comet-scripts.test.ts` for YAML examples and assertions.

## Changelog

Update `CHANGELOG.md` for user-facing behavior changes. New version entries go
at the top and the version must match `package.json`.

Use this shape:

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

Guidelines:

- Group entries in this order: Added, Changed, Fixed, Tests, Removed, Security.
- Start each entry with `- **Bold keyword**: `.
- Describe behavior and rationale, not implementation trivia.
- In `### Tests`, summarize coverage areas instead of listing every test case.

## Security

- Scan for API keys, secrets, tokens, and private keys before publishing.
- Keep `.npmignore` aligned so source-only and local configuration files are not
  published to npm.
- Keep `.gitignore` coverage for secrets, credentials, and IDE-specific files.
- Validate user-provided change names against path traversal before using them
  in filesystem paths.
