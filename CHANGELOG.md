# Changelog

All notable changes to @rpamis/comet will be documented in this file.

## What's Changed [0.3.11] - 2026-06-24

### Added

- **`comet dashboard` command**: New command that boots a local read-only HTTP server (default port 4321 with automatic fallback) and opens a single-page dashboard in the user's browser. The page surfaces every active and archived change in the current project's `openspec/changes/` tree, including phase progress (Open → Design → Build → Verify → Archive), artifact checklist, task breakdown, verify status, next-action recommendation, project-level Git snapshot, and rule-driven risk list — so users can `cd` into a repo and inspect Comet workflow health at a glance instead of grepping `tasks.md` or `.comet.yaml` by hand.
- **Dashboard JSON API**: `GET /api/dashboard` returns the same `DashboardSnapshot` the frontend renders, so scripts and other tooling can consume the same shape. `comet dashboard --json` prints one snapshot to stdout and exits without starting the server, useful for CI and one-off inspection.
- **`--port` and `--no-open` flags on `comet dashboard`**: Pin the server to a fixed port (helpful when running multiple repos side by side) or skip the auto-open call (useful for SSH / containers / CI where opening a browser would fail).

### Changed

- **Stricter `--port` validation**: `comet dashboard --port` now rejects values that are not entirely numeric (for example `4321abc`) instead of silently accepting the parsed prefix. Invalid ports fail fast with a clear error message.

### Fixed

- **Per-change failure isolation in the dashboard collector**: A single malformed `.comet.yaml` or unreadable change directory no longer aborts the whole dashboard snapshot. The offending change is logged and skipped, and the rest of the sweep continues so the dashboard always renders.
- **Defensive defaults in the Git snapshot frontend card**: A partial or stale `/api/dashboard` response (missing `recentCommits` / `dirtyFileList` / `dirtyFiles`) now renders an empty card instead of throwing a TypeError.

### Security

- **Path traversal guard for `verification_report`**: The `verification_report` field in `.comet.yaml` is now resolved with a containment check against the change directory. Absolute paths and `..` escapes are rejected and the parser falls back to the default `.comet/verify-result.md` location, preventing a malicious repository from coaxing the dashboard into reading arbitrary local files into its API response and UI.

### Tests

- **Dashboard module coverage**: Added unit tests for the tasks parser, verify parser (including absolute-path and `..`-traversal regressions), Git collector, snapshot collector (including per-change failure isolation), HTTP server (snapshot endpoint, static serving, path traversal guard, port fallback), and the `dashboard --json` command.

## What's Changed [0.3.9] - 2026-06-17

### Added

- **CLI i18n shared module**: Extracted the init-time translation table to `src/commands/i18n.ts` so init, update, and future commands can share English/Chinese strings consistently instead of duplicating tables per command.
- **Optional npm dependency prompts in init/update**: `comet init` and `comet update` now present a multi-select for OpenSpec CLI, Superpowers (via `npx skills add`), and CodeGraph CLI instead of force-installing them. Items not yet detected on the system default to checked; already-installed items default to unchecked so users can opt into upgrades without being forced. The Superpowers entry also surfaces a recommendation to install v6.0.0+ (≈2× faster, ≈50% fewer tokens).
- **`--language` option for `comet init`**: New CLI flag (`en`/`zh`) that selects skill language non-interactively, mirroring the existing `comet update --language` option ([#109](https://github.com/rpamis/comet/pull/109)).
- **`review_mode` field for code review control**: Added `.comet.yaml` field `review_mode` (`off` / `standard` / `thorough`) controlling automatic code review during build and verify phases. `comet-build` requires user selection before execution; `comet-verify` and subagent dispatch adapt behavior per mode; `comet-hotfix` defaults to `off`. Validated by `comet-state.sh`, `comet-guard.sh`, and `comet-yaml-validate.sh`.
- **Project-level review mode defaults**: `.comet/config.yaml` can now set `review_mode: off|standard|thorough`, which is snapshotted into new full workflow changes so teams can choose a project-wide automatic review default while preserving existing per-change state behavior. Newly generated config files include enum comments for `context_compression`, `review_mode`, and `auto_transition` so users can adjust supported values without searching the docs.
- **Uninstall by platform selection**: `comet uninstall` now shows a checkbox prompt when multiple platforms are detected, allowing users to selectively uninstall specific platforms instead of removing all at once. Single-target scenarios use a simple yes/no confirmation. `--force` and `--json` flags retain the existing all-at-once behavior.
- **Codex plugin-installed Superpowers detection**: `comet init` now detects Superpowers already installed via the Codex plugin cache (`~/.codex/plugins/cache/...`), preventing duplicate re-installation — parallel to the existing Claude Code and OpenCode plugin detection ([#115](https://github.com/rpamis/comet/pull/115)).

### Changed

- **Release notes alignment**: Updated `NEWS.md` and the README highlight blocks so the visible documentation covers the 0.3.8 and 0.3.9 releases, including the new review mode behavior and the `off` / `standard` / `thorough` review-strength semantics, instead of leaving the front-page summary on 0.3.7.
- **Tagline rebrand**: Changed the Comet tagline in the `comet init` banner and the `package.json` / CLI `--description` from "OpenSpec + Superpowers dual-star development workflow" to "Agent Skill Harness Phase-Guarded Automation From Idea To Archive", positioning Comet by its core value (a phase-guarded agent skill harness) rather than by its underlying OpenSpec + Superpowers dependencies.
- **Change name confirmation as a blocking decision point**: `comet-open` SKILL.md (Chinese and English) now adds a dedicated Step 1c that pauses before `openspec new change` to confirm the change name. The agent must recommend 2-3 kebab-case English candidate names derived from the clarification summary, always offer a custom-input option, and warn that Chinese (or any non-kebab-case) input will be converted into a compliant kebab-case English name and shown back for confirmation — preventing agents from auto-generating non-compliant Chinese change names.
- **Non-ASCII change name prevention**: Added explicit ASCII validation rules to `comet-open` SKILL.md (both Chinese and English) to prevent agents from auto-generating non-compliant change names containing Chinese, Japanese, Korean characters, spaces, or special characters. The agent must now ask the user for an ASCII-compliant name.
- **Chinese gate-term normalization**: Updated Chinese Comet wording to avoid translating `gate` literally as "门": Design Step 1e now uses "主动式上下文压缩", the shared debugging guidance now uses "异常调试协议", and `CLAUDE.md` / `AGENTS.md` now define this as the standard Chinese translation rule for future skill edits.
- **Full i18n coverage for CLI prompts**: Extended translation coverage from `init`-only to also cover `update` (banner, npm update progress, skills copy progress, summary, codegraph prompt). All user-facing strings now have English and Chinese variants ([#109](https://github.com/rpamis/comet/pull/109)).

### Fixed

- **Phase-skip enforcement across all guard layers**: Fixed agents jumping from `open` to `build` (skipping `design`) undetected. `comet-state.sh` now enforces evidence on every forward transition; direct `set phase` is blocked (with `COMET_FORCE_PHASE=1` escape hatch); `comet-hook-guard.sh` blocks source writes when `design_doc` is null; `comet-phase-guard` rule adds a phase-entry self-consistency check requiring prerequisite artifacts before writing source.
- **Hook guard cross-change false positives**: Fixed `comet-hook-guard.sh` letting one change's phase wrongly block writes to a different change. Writes targeting `openspec/changes/<name>/` are now governed by that change's own `.comet.yaml` phase instead of the first active change found in the directory. This covers two cases that previously blocked a brand-new change's artifact writes: (1) an old change marked `archived: true` but not yet physically moved to the `archive/` subdirectory, and (2) an old change stalled in the `archive` phase with `archived: false` (not yet run through the archive script). Additionally, a new change directory whose `.comet.yaml` does not exist yet (artifacts are written before the state file during `/comet-open`) is treated as `open`, so `proposal/design/tasks/specs` writes are allowed.
- **CodeGraph setup detection**: Fixed `comet init` and `comet update` prompting for CodeGraph setup even when the project already has a `.codegraph/` index. Existing project indexes now skip the optional CodeGraph prompt and install step, and CodeGraph CLI resolution can use a pnpm global binary before falling back to npm global installation.
- **Phase guard auto-transition handoff**: Fixed the injected Comet phase guard rule hardcoding the next skill after `guard --apply`, which could bypass `auto_transition: false`. The rule now delegates post-guard handoff to `comet-state next <change-name>` and follows `NEXT: auto|manual|done` so manual phase boundaries are respected.
- **Executable permission loss on macOS after update**: `bin/comet.js` and all shell scripts under `assets/skills/comet/scripts/` were committed with git mode `100644` (non-executable). After an npm update, macOS users lost execute permissions on the `comet` CLI entry point. Changed all 8 files to `100755` in git so npm installs always preserve the executable bit.
- **Preset workflow open transition**: Fixed `comet-state.sh` requiring `design.md` before `hotfix`/`tweak` changes could leave `open`, aligning state transitions with the guard rules that only require `proposal.md` and `tasks.md` for preset workflows.
- **Review mode build gating**: Fixed `comet-guard.sh` allowing full-workflow changes with a missing `review_mode` field to pass build checks before `comet-state.sh` rejected the transition, so both guard layers now report the same required review-mode decision.
- **Hook guard blocked-message language**: Changed `comet-hook-guard.sh` blocked-write guidance to English so the English-distributed hook script no longer emits Chinese-only recovery instructions during phase enforcement.

### Tests

- **Phase-skip enforcement coverage**: Added shell-script tests covering the hardened guard layers — `open-complete` blocked when an open artifact is missing, `design-complete` blocked/allowed by `design_doc` presence, `archived` blocked until `verify_result: pass`, direct `set phase` blocked while the `COMET_FORCE_PHASE` escape hatch is allowed, and hook-guard blocking full-workflow `build` source writes when `design_doc` is null while still allowing preset workflows and full workflows with a valid `design_doc`.
- **Project review mode default coverage**: Added regression coverage for `.comet/config.yaml` `review_mode` snapshotting into full workflow changes, invalid project review mode rejection, and enum comments in generated project config files.
- **CodeGraph setup coverage**: Added regression tests for existing `.codegraph/` index detection, skipping redundant CodeGraph installation, pnpm global CLI resolution, and suppressing the update-time CodeGraph prompt when a project index already exists.
- **Phase guard handoff coverage**: Added skill-rule regression coverage ensuring the phase guard delegates to `comet-state next` and no longer embeds a fixed next-skill mapping that can ignore `auto_transition`.
- **`review_mode` integration coverage**: Added regression tests verifying `review_mode` is wired through state, guard, and validation scripts, with correct mode-specific behavior in `comet-build`/`comet-verify`/`comet-hotfix`.
- **Uninstall platform selection coverage**: Added tests for single-target auto-select, multi-target checkbox selection, user cancellation, `--force` skip, `--json` output, and no-targets-found handling.
- **CI regression coverage**: Added state-machine regression coverage for preset workflows leaving `open` without `design.md`, missing full-workflow `review_mode` being blocked consistently, and repair-only phase resets using `COMET_FORCE_PHASE`.
- **Hook guard message coverage**: Added regression coverage ensuring `comet-hook-guard.sh` blocked-write messages remain English and do not reintroduce Chinese-only guidance.
- **CI fixture alignment**: Updated shell-script test fixtures to preserve executable permissions after copying scripts, include required `review_mode` decisions in full-workflow build states, and use the repair-only `COMET_FORCE_PHASE` escape hatch only when constructing phase states for guard checks.

## What's Changed [0.3.8] - 2026-06-13

### Added

- **Kimi Code CLI support**: Added Kimi Code as the 29th supported platform, including project/global skill installation under `.kimi-code/`, OpenSpec `kimi` tool integration, Superpowers `kimi-code-cli` mapping, detection, documentation, and cross-platform regression coverage ([#90](https://github.com/rpamis/comet/pull/90)).
- **Version info and update check**: `comet init` and `comet update` now display the current installed Comet version at the start of command output and check the npm registry for newer versions. If an update is available, users see a prompt to upgrade; if already on the latest version, a confirmation message is shown; if the registry is unreachable, the check is skipped silently without error ([#99](https://github.com/rpamis/comet/issues/99)).
- **Official registry enforcement for update**: `comet update` now passes `--registry https://registry.npmjs.org` to npm when updating the `@rpamis/comet` package, ensuring it always fetches from the official npm registry regardless of the user's local `.npmrc` or mirror configuration. Other packages continue using the user's normal registry settings. If the official registry is unreachable, a clear error message indicates the registry issue ([#100](https://github.com/rpamis/comet/issues/100)).
- **Subagent dispatch Comet extensions**: Rewrote the inline subagent dispatch protocol from `comet-build/SKILL.md` into `comet/reference/subagent-dispatch.md` (Chinese and English) as Comet-specific extensions layered on top of the Superpowers `subagent-driven-development` skill. The skill provides the core dispatch loop; the Comet extensions add real background dispatch, durable per-task checkpoints (`subagent-progress.md`), coordinator-only source execution, TDD ownership by background agents, bounded review-fix rounds (3 max), continuous task execution without pauses, and precise context recovery from checkpoint stages.
- **`task-checkoff` subcommand**: Added `comet-state task-checkoff <file> <task-text>` to verify a specific task is uniquely checked in a markdown file. Used by the subagent dispatch protocol for targeted completion verification after dual review passes. Includes path traversal prevention, CRLF handling, and exact-match validation.
- **`comet uninstall` command**: Added `comet uninstall [path]` CLI command to safely remove Comet-distributed skills, rules, and hooks across all 29 supported AI coding platforms. Supports `--scope` (project/global), `--force` (skip confirmation), and `--json` output. Auto-detects installed targets, removes only Comet-managed artifacts while preserving user-defined hooks and non-Comet configuration, cleans up empty directories and working directories (`.comet/`, `docs/superpowers/`), and handles all 7 hook formats (Claude Code, Qwen, Qoder, Gemini, Windsurf, GitHub Copilot, Kiro) and all 3 rule formats (md, mdc, copilot instructions) ([#95](https://github.com/rpamis/comet/issues/95)).
- **Progressive loading reference docs**: Extracted four reference documents from inline skill content to enable on-demand loading and reduce per-invocation token cost (both Chinese and English): `auto-transition.md` (auto-transition protocol, replacing 7 × ~10 lines of repeated content across sub-skills), `context-recovery.md` (context compression recovery, replacing 4 × ~8 lines), `comet-yaml-fields.md` (`.comet.yaml` field table, ~40 lines), and `file-structure.md` (directory structure, ~20 lines). Main `comet/SKILL.md` retains critical state machine hard constraints inline while pointing to reference docs for detailed field descriptions. Estimated per-invocation savings: 600–1,500 tokens depending on skill; cumulative ~4,100 tokens across a full workflow.
- **Pre-commit formatting hook**: Added a `husky` + `lint-staged` pre-commit hook that automatically runs `prettier --write` on staged source files under `src/` at every `git commit` (scope aligned with CI `format:check`). Editor-agnostic — enforced for all contributors regardless of IDE or agent — preventing Prettier formatting issues from reaching CI. The `prepare` script installs the hook on `pnpm install`, and `.husky/` is excluded from the published package via the `files` whitelist.

### Changed

- **Skills progressive loading refactor**: All 7 sub-skills (`comet-open`, `comet-design`, `comet-build`, `comet-verify`, `comet-archive`, `comet-hotfix`, `comet-tweak`) in both Chinese and English now reference shared protocol documents for auto-transition and context recovery instead of embedding full content inline, while retaining critical inline commands (`next` command and output interpretation) for safe standalone loading.
- **Phase guard recovery with durable checkpoints**: Updated recovery steps in `comet-phase-guard.md` (Chinese and English) to reload the Superpowers `subagent-driven-development` skill, read `subagent-progress.md` for exact stage recovery (implementation commit, RED/GREEN evidence, passed reviews, unresolved feedback, review-fix round), and resume from the checkpoint's precise phase instead of always starting from the first unchecked task. Both `.claude/rules/` and `assets/skills/comet/rules/` copies include consistent references with bilingual identifiers for cross-language test compatibility.
- **Decision point protocol extraction**: Extracted inline user-decision-point text from all 7 sub-skills (`comet-open`, `comet-design`, `comet-build`, `comet-verify`, `comet-archive`, `comet-hotfix`, `comet-tweak`) and main `comet/SKILL.md` into shared `comet/reference/decision-point.md` (both Chinese and English). Sub-skills now reference the protocol by path instead of repeating the full blocking-point rules, reducing per-invocation token cost and ensuring consistency across skills.
- **Debug gate protocol extraction**: Extracted the inline systematic-debugging four-stage flow from `comet-build`, `comet-hotfix`, and `comet-tweak` into shared `comet/reference/debug-gate.md` (both Chinese and English). Sub-skills now reference the debug gate protocol by path, centralizing the investigation, minimal failing test, fix verification, and verification-loop rules.
- **Lightweight verification review**: Lightweight verification now requires a scoped Superpowers `requesting-code-review` review focused on correctness, security, and edge cases, adding review coverage without running full spec or design drift checks ([#86](https://github.com/rpamis/comet/pull/86)).

### Fixed

- **Pi slash command discovery**: `comet init` and `comet update` now generate a Pi extension that registers all shipped `/comet*` workflows as native slash commands forwarding to `/skill:*`. Pi settings are merged non-destructively with skill commands enabled, global resources now use Pi's documented `~/.pi/agent/` directory, legacy `~/.pi/skills/` installs are detected for update and cleanup, and `comet uninstall` removes only Comet-managed assets while preserving shared settings and unrelated extensions ([#89](https://github.com/rpamis/comet/issues/89)).
- **OpenCode plugin-installed Superpowers detection**: `comet init` now correctly detects Superpowers already installed via the OpenCode plugin system (configured in `opencode.json`), preventing duplicate re-installation. Previously, only skills placed directly under `~/.config/opencode/skills/` were detected, missing the plugin source directory at `~/.config/opencode/superpowers/skills/` and the `plugin` array in `opencode.json`. Added `hasOpenCodePluginSuperpowers()` fallback detection similar to the existing Claude Code plugin cache check ([#105](https://github.com/rpamis/comet/issues/105)).
- **Lightweight verification consistency**: Hotfix documentation now describes the 6-item lightweight verification path, and verification failure handling treats CRITICAL and IMPORTANT findings as blocking so review pass criteria and failure decisions remain consistent.
- **Hook configuration merging during init and update**: Shared hook configuration files for Claude Code, Codex, Amazon Q, Qwen, Qoder, Gemini, and Windsurf now preserve user-defined hooks when Comet installs or updates a hook for the same matcher or event. Existing Comet commands are identified by their manifest script path and replaced in place, preventing stale install paths, duplicate matcher groups, and repeated hook accumulation while leaving unrelated settings untouched.
- **Subagent-driven task isolation and continuity**: `comet-build` now loads the mature Superpowers `subagent-driven-development` loop and applies a stricter Comet extension that requires one fresh background implementer per task, fresh background reviewers and fix agents, coordinator-only source execution, and automatic continuation between tasks without progress summaries or "continue?" prompts. TDD mode requires each implementer/fix agent to load the TDD skill and return auditable RED/GREEN evidence before review. A durable per-task checkpoint preserves implementation commits, review stages, feedback, and the three-round retry budget across context compression; task checkoff remains blocked until both reviews pass ([#94](https://github.com/rpamis/comet/issues/94), [#96](https://github.com/rpamis/comet/issues/96), [#97](https://github.com/rpamis/comet/issues/97)).
- **npm shebang line ending issue on macOS**: When npm packed the project on Windows, `bin/comet.js` shebang line got CRLF line endings, causing macOS to interpret `#!/usr/bin/env node\r` instead of `#!/usr/bin/env node`, resulting in "command not found" after `npm install -g @rpamis/comet`. Added explicit `eol=lf` rules for all text file extensions (`.js`, `.mjs`, `.ts`, `.json`, `.md`, `.yaml`, `.yml`) and binary markers for image files in `.gitattributes` ([#82](https://github.com/rpamis/comet/issues/82)).
- **CodeGraph Codex CLI skip on project scope**: `comet init` with project scope passed `--target` and `--location=local` to `codegraph install`, which caused Codex CLI (no project-local config) to be skipped with a confusing message. Simplified to `codegraph install --yes` without `--target` or `--location` flags, letting CodeGraph auto-detect and configure all installed agents. Removed `filterSupportedPlatforms` and `CODEGRAPH_SUPPORTED_TARGETS` ([#98](https://github.com/rpamis/comet/issues/98)).
- **OpenSpec CLI upgrade and --profile fallback**: `ensureOpenSpecCli` now always installs/upgrades openspec to the latest version, even if an older version is already present, ensuring users get `--profile` support and other improvements. Added fallback logic: if `openspec init` fails with "unknown option --profile" in stderr, retries without the flag for edge cases where the upgrade fails but an older openspec remains ([#84](https://github.com/rpamis/comet/issues/84)).
- **Symlink resolution for skill file copies**: When skill directories are symlinks (e.g. `~/.claude/skills/comet -> ~/.agents/skills/comet`), `copyFile` and `ensureDir` wrote to the literal path instead of following the symlink target. Broken symlinks caused silent copy failures. Added `resolveSymlinkPath()` to `file-system.ts` that walks up the path tree and follows `readlink` targets for broken symlinks. Applied to `ensureDir`, `copyFile`, and `writeFile` ([#85](https://github.com/rpamis/comet/issues/85)).
- **comet-tweak missing debug handling**: `comet-tweak/SKILL.md` was missing the systematic-debugging requirement that `comet-hotfix` already had — when tests or builds fail during tweak execution, the skill now explicitly requires loading the `systematic-debugging` skill before proposing source fixes, matching hotfix behavior.
- **OpenSpec per-artifact instructions compliance**: Chinese and English `comet-open` now apply OpenSpec per-artifact instructions (`openspec instructions proposal/design/tasks --change "<name>" --json`) for each standard artifact, loading `context`, `rules`, `template`, `instruction`, `resolvedOutputPath`, and `dependencies` from the JSON payload instead of hard-coded artifact prose. Stops artifact generation on instruction failure rather than silently bypassing project rules ([#66](https://github.com/rpamis/comet/issues/66)).
- **CI Windows path escaping in skill verification**: The `init-e2e` workflow's Pi settings verification step interpolated a Windows `$RUNNER_TEMP` path (containing backslashes) directly into a `node -e "require('...')"` JS string literal, where `\a`/`\_` were parsed as escape characters and mangled the path (`D:\a\_temp` → `D:a_temp`), failing the `init-e2e (windows-latest)` runners on Node 20 and 22. The path is now passed via an environment variable (`process.env`) so it never enters a JS string literal; Linux/macOS were unaffected.
- **OpenSpec source formatting**: Re-formatted `src/core/openspec.ts` (long-line wrapping) to satisfy `prettier --check`, unblocking the `format:check` CI step.
- **Symlink-safe removal during uninstall**: `removeFile`/`removeDir` no longer resolve symlinks before deleting. A symlinked skill, rules, or hooks directory previously had its _resolved target_ recursively deleted by `comet uninstall`; symlinked directories are now unlinked directly. `isDirEmpty` also no longer reports unreadable directories as empty, so cleanup never deletes a directory it could not inspect.
- **`comet update --json` output corruption**: npm's inherited stdio previously interleaved into the JSON document; npm stdout/stderr are now discarded in JSON mode so machine-readable output stays parseable.
- **`comet update --json` no-targets shape**: the early-return JSON emitted when no installed targets exist now includes `codegraph: 'skipped'`, matching the normal output shape so consumers need not special-case the empty path.
- **JSON-mode version-check latency**: `comet init` and `comet update` now skip the npm-registry version check in JSON mode, emitting output without a network round-trip.
- **Malformed hook settings resilience**: hand-edited settings files storing a hook group as a non-array value no longer throw during init/update hook merging; malformed groups are coerced to empty.
- **Markdown code-fence language tags**: added `text` language tags to fenced code blocks in `file-structure.md` and `subagent-dispatch.md` (Chinese and English) to satisfy MD040 linting, consistent with the existing OpenSpec formatting CI fix.
- **Skills manifest version drift**: bumped `assets/manifest.json` version `0.3.3` → `0.3.8` to match `package.json`.

### Tests

- **Kimi Code platform coverage**: Added detection, project/global installation, OpenSpec tool mapping, Superpowers agent mapping, CI platform-count, and documentation regression coverage for Kimi Code.
- **Lightweight verification review regression**: Added bilingual workflow safeguards for the lightweight code-review requirement, blocking severities, scoped review criteria, and hotfix documentation consistency.
- **Pi command extension lifecycle coverage**: Added project/global init, manifest-driven command generation, argument forwarding, settings preservation, invalid-settings protection, deterministic overwrite, and selective uninstall regression coverage, plus CI assertions for Pi's project and global extension locations.
- **Hook merge regression coverage**: Added real-file tests for Claude-style, Qwen/Qoder, Gemini, and Windsurf hook formats covering same-matcher user hook preservation, stale Comet command replacement, unrelated configuration retention, and idempotent repeated installation.
- **Subagent dispatch contract coverage**: Added Chinese and English skill-content regression coverage for Superpowers/Comet composition, coordinator-only source execution with tracking-file exceptions, one fresh background agent per task and role, prompt/status/reviewer evidence contracts, durable recovery checkpoints, TDD ownership, dual-review checkoff, bounded stop conditions, continuous task execution, Comet-specific final handoff, and the absence of a Stop hook.
- **Reference doc assertions**: Added assertions verifying all skill files that reference `decision-point.md` and `debug-gate.md` include the correct protocol path, and that the shipped reference docs contain the expected core rules and fallback behavior.
- **OpenSpec artifact contract coverage**: Added bilingual contract assertions verifying `comet-open` skills contain explicit JSON instruction commands for `proposal`, `design`, and `tasks`; require applying `context`, `rules`, `template`, `instruction`, `resolvedOutputPath`, and `dependencies`; prohibit copying context/rules into artifacts; refresh status between artifacts; and stop instead of falling back when OpenSpec instructions fail.

## What's Changed [0.3.7] - 2026-06-07

### Added

- **Auto-transition config**: Added `auto_transition` (`true`|`false`) to `.comet.yaml` and the `.comet/config.yaml` project default so teams can choose whether Comet automatically advances to the next phase skill or pauses for a manual transition. When `auto_transition: false`, build/design/open/verify skills stop after meeting exit conditions and print the next manual step instead of invoking the next skill. Includes state-machine whitelist, enum validation, and schema (`comet-yaml-validate.sh`) coverage ([#74](https://github.com/rpamis/comet/pull/74)).
- **Deterministic next-step resolver**: Added `comet-state next <change-name>` to resolve post-guard routing from `.comet.yaml` (`phase`, `workflow`, `auto_transition`) with structured output: `NEXT: auto|manual|done`, `SKILL: <skill-name>`, and `HINT` (manual mode). This centralizes next-skill routing logic in scripts instead of duplicating it across skill prose.
- **Workflow output language**: Comet workflows now propagate the triggering user request language into OpenSpec and Superpowers steps via an explicit Output Language Rule, keeping generated proposals, designs, plans, verification reports, and archive notes readable in the user's language. Resuming an existing change preserves the dominant artifact language unless the user explicitly asks to switch ([#53](https://github.com/rpamis/comet/pull/53), [#37](https://github.com/rpamis/comet/issues/37)).
- **Execution benchmark (Claude Code)**: Added `benchmark:execution`, a benchmark harness with three test phases: L1 (design doc generation from handoff context), L2 (build a note-board module from handoff context + run tests), and L3 (full workflow — implement a dictionary module from spec, run 10 vitest tests). Invokes Claude Code (`claude -p`) and measures actual test pass rate, token usage, retry count, duration, and cost. Compares `off` vs `beta` context compression modes across small/medium/large tiers. Supports `--phase l1|l2|l3|both|all` and `--dry-run` for deterministic verification. Extracted shared utilities (`spawnCapture`, `parseClaudeJson`, `buildClaudeArgs`, etc.) to `scripts/benchmark-utils.mjs`.

- **Token optimization: TDD skill single load**: Build skill now loads `test-driven-development` skill once before the first task (instead of per-task), reducing ~44K tokens per 10-task workflow. Includes compaction recovery guidance to reload once on resume.
- **Token optimization: brainstorming checkpoint**: Design skill now writes `brainstorm-summary.md` after user confirms design approach, providing a compaction recovery point that preserves confirmed decisions across context window compression.
- **Token optimization: incremental brainstorming checkpoint**: Design skill now incrementally updates `brainstorm-summary.md` during brainstorming, preserving confirmed facts, candidate decisions, risks, testing notes, and pending questions before platform-driven context compaction can occur.
- **Token optimization: active compaction gate**: Design skill now requires an active context compaction gate after `brainstorm-summary.md` is finalized and before creating the Design Doc, using the host platform's native compaction mechanism when available and falling back to a manual user prompt when it is not.
- **Token optimization: plan creation subagent offload**: Build skill offloads `writing-plans` execution to a subagent, freeing main session context. Subagent reads Design Doc + tasks.md from files and returns the plan file path. Falls back to inline execution on subagent failure.
- **Token optimization: verification skill dedup**: Verify skill loads `verification-before-completion` once before the light/full branch point instead of in each branch, eliminating redundant skill content.
- **Token optimization: tasks.md incremental scan**: Build skill uses `grep` to find unchecked tasks instead of re-reading the entire `tasks.md` file after each task completion.
- **Token optimization: hash on-demand read in verify**: Verify skill checks `handoff_hash` before re-reading OpenSpec artifacts. When hash matches, only `tasks.md` is skipped (proposal.md and design.md are still read for comparison checks). Uses new `comet-handoff.sh --hash-only` flag.
- **`--hash-only` flag for comet-handoff.sh**: New backward-compatible flag outputs the context hash without generating handoff files, used by verify phase for hash comparison. Validates required files exist before computing hash.
- **CodeGraph integration in comet init**: `comet init` now offers an optional step to install and configure CodeGraph (`@colbymchenry/codegraph`) for semantic code intelligence. It auto-detects supported platforms (Claude Code, Cursor, Codex, OpenCode, Gemini, Kiro, Antigravity), installs the CLI if missing, runs `codegraph install` for agent wiring, and initializes the project index. Skips gracefully under `--json` mode.
- **Stale PR automation**: Added a scheduled and manually runnable GitHub Actions workflow that marks inactive pull requests stale after 90 days and closes them after another 30 days, helping keep long-idle review queues manageable.
- **TDD mode field**: Added `tdd_mode` (`tdd`|`direct`) to `.comet.yaml` state machine so users choose whether to enforce TDD during build. When `tdd_mode: tdd`, subagent dispatches inject an explicit TDD hard constraint, bypassing implementer-prompt.md's conditional trigger. Addresses [#67](https://github.com/rpamis/comet/issues/67).
- **subagent_dispatch field**: Added `subagent_dispatch` (`null`|`confirmed`) to `.comet.yaml` state machine, ensuring `build_mode: subagent-driven-development` can only leave the build phase after the platform's real background dispatch capability is confirmed.
- **Verify retry limit**: Verify skill now enforces a mandatory user decision after 3 consecutive verify-fail cycles, preventing indefinite automated retry loops.
- **Manual verify_mode override**: Users can override automatic verification scale assessment via `comet-state set <name> verify_mode <light|full>` when the auto-detected mode doesn't fit.
- **Local context compression benchmark**: Added `benchmark:context`, a local Codex benchmark harness that creates matched `context_compression: off` and `beta` Comet fixtures, runs `codex exec` against each mode, and reports token savings, spec drift rate, task completion rate, parse success, and timing. Use `--dry-run` for deterministic non-Codex verification.
- **Beta-gated context compression switch**: Project installs now create `.comet/config.yaml` with `context_compression: off`, allowing teams to opt new changes into beta spec projection by setting `context_compression: beta`. This switch controls only the OpenSpec handoff projection path (`spec-context.*`); the workflow token optimizations above are default-on and do not require beta mode.
- **Beta spec projection handoff**: `/comet-design` can now use beta context compression to generate `spec-context.json` and `spec-context.md`, preserving OpenSpec requirement and scenario headings with source hashes so compact design handoffs reduce token load without weakening acceptance coverage.

### Changed

- **executing-plans review gate**: When `build_mode` is `executing-plans`, the build phase now requires loading the Superpowers `requesting-code-review` skill and requesting code review at least once before the build→verify phase guard. CRITICAL findings must be fixed before verify; accepted non-CRITICAL findings must record acceptance rationale in a durable artifact. The build-exit checklist enforces this gate ([#76](https://github.com/rpamis/comet/pull/76), [#41](https://github.com/rpamis/comet/issues/41)).
- **Phase advancement vs handoff wording**: Chinese and English Comet skills now consistently distinguish guard-driven phase advancement (`--apply`, always updates `phase`) from next-skill invocation control (`auto_transition`). Open/design/build/verify/hotfix/tweak guidance now routes through `comet-state next` for auto/manual handoff.
- **Preset continuity wording**: Hotfix and tweak guidance now explicitly documents the `auto_transition: false` exception in continuous execution mode, removing contradictory wording around "always continue" behavior.
- **Verify hash-skip scoped to tasks.md only**: Full verification always reads `proposal.md` and `design.md` even when hash matches, ensuring goal-satisfaction and design-consistency checks have complete context.
- **Design Doc creation stays in main session**: Design Doc is created inline (not offloaded to subagent) to preserve full brainstorming conversation context and prevent information loss for complex requirements.
- **Subagent failure fallback**: Plan creation subagent offload includes explicit degraded fallback — if the subagent fails, the main session loads `writing-plans` inline.
- **Beta spec verbatim projection**: Beta context compression now projects entire spec files verbatim (`cat`) instead of filtering by English keywords (GIVEN/WHEN/THEN/AND/BUT). This eliminates language-dependent matching, ensures zero acceptance-criteria drift for Chinese or non-English specs, and removes the fragile AWK filter entirely.
- **JSON structural validation**: `comet-guard.sh` now validates `spec-context.json` structure (required fields: `change`, `phase`, `mode`, `files`, `context_hash`) and source file reference coverage, replacing the previous English-heading-based markdown check. Guard catches corrupted or incomplete JSON before phase transition.
- **JSON file roles**: `spec-context.json` `files` array now includes a `role` field (`spec` for spec files, `supporting` for proposal/design/tasks), removing the language-dependent `projection` array entirely.
- **--full warning in beta mode**: Running `comet-handoff.sh` with `--full` in beta mode now emits an explicit warning instead of silently ignoring the flag.
- **CodeGraph step in comet update**: `comet update` now prompts to install/update CodeGraph alongside skill file updates, using the same platform detection and CLI installation flow.
- **Rules and hooks distribution in comet update**: `comet update` now distributes anti-drift phase guard rules and hooks to all installed platforms alongside skill files, keeping rules and hooks in sync after a Comet upgrade.
- **Archive confirmation gate**: Chinese `/comet-archive` now pauses for explicit user confirmation before running the archive script, giving users a final chance to adjust or re-run verification before main spec merge and change archival.
- **English archive confirmation parity**: English Comet skills now match the confirmed Chinese archive-confirmation workflow, including `/comet-archive`, `/comet-verify`, `/comet`, hotfix, and tweak guidance.
- **Archive reopen transition**: Added `comet-state transition <change-name> archive-reopen` so users who decline final archive confirmation can return from `phase: archive` to `phase: verify` for adjustment or re-verification without manually editing `.comet.yaml`.
- **OpenSpec clarification gate**: Chinese and English `/comet-open` now require a confirmed requirements clarification summary before proposal, design, or tasks artifacts are created, preventing one Q&A turn from immediately generating a full OpenSpec change.
- **PRD split preflight**: Chinese and English `/comet-open` now triage large PRDs before creating OpenSpec artifacts, allowing users to split independent capabilities into multiple Comet changes while keeping each accepted split on the `/comet-open` state-machine path. Addresses [#62](https://github.com/rpamis/comet/issues/62).
- **Skill invocation wording guidance**: Added repository guidance in `CLAUDE.md` requiring new skill-trigger descriptions to use the existing "use the Skill tool to load..." wording and place context details after the skill loads.
- **Anti-drift phase guard rule**: Added `.claude/rules/comet-phase-guard.md` that re-injects Comet phase awareness, skill invocation requirements, script execution requirements, user confirmation gates, and context compaction recovery instructions every conversation turn, preventing long-context attention drift from breaking the 5-phase workflow. Works on all platforms as a soft reminder.
- **Anti-drift phase guard hook**: Added `comet-hook-guard.sh` PreToolUse hook (configured in `.claude/settings.local.json`) that hard-blocks file writes when the active Comet change is in `open`, `design`, or `archive` phase, providing a platform-specific hard enforcement layer that the model cannot bypass. Whitelists `openspec/*`, `docs/superpowers/*`, `.claude/*`, and `.comet/*` paths.
- **Platform rules/hooks distribution in comet init**: `comet init` now distributes the anti-drift phase guard rule and hook-guard script to all supported platforms during initialization. Platform definitions were corrected: Cline uses `.clinerules/` at project root (not `.cline/rules/`), GitHub Copilot uses `.github/instructions/*.instructions.md` with `applyTo` frontmatter, Kiro uses `.kiro/steering/`, and Gemini CLI has no rules directory (uses GEMINI.md files). Added `rulesDir`/`rulesFormat` to 8 platforms that were missing it, and `supportsHooks`/`hookFormat` to 7 platforms. Hook installation supports 7 format variants: Claude Code, Gemini, Windsurf, Copilot, Qwen, Kiro, and Qoder.
- **Systematic debugging gate**: Chinese and English build and hotfix skills now require loading Superpowers `systematic-debugging` when implementation-time crashes, unexpected behavior, test failures, or build failures appear, ensuring root-cause investigation and in-change regression tests happen before source fixes.
- **Verification-before-completion gate**: Chinese and English `/comet-verify` now require loading Superpowers `verification-before-completion` before executing lightweight or full verification checks, enforcing evidence-based confirmation before any completion claims.
- **Platform-neutral confirmation gates**: Chinese and English Comet skills and recovery messages now refer to the current platform's user input/confirmation mechanism instead of hard-coding `AskUserQuestion`, preventing Codex users from being directed to a tool that may not exist while preserving blocking user decisions.
- **Preset upgrade path**: Hotfix and tweak skills now include `set <name> phase design` step when upgrading to full workflow, preventing comet-design entry check failure after workflow switch.
- **Build-complete conditional field reset**: `build-complete` transition preserves `verification_report` and `branch_status` when the previous verify_result was `fail`, enabling verify-fail→build→build-complete re-verify cycles without data loss.
- **Open phase recovery granularity**: Open phase recovery now distinguishes three states (all artifacts done / none done / partial) with specific recovery actions per state.
- **50% scope threshold option**: Build skill now offers "continue in current change" as a third option when changes exceed 50% scope, avoiding forced change splitting.
- **Worktree plan commit**: Build skill now explicitly instructs committing plan files before creating a worktree when using worktree isolation.

### Removed

- **openspec/config.yaml**: Removed unused example OpenSpec config file containing only placeholder comments.

### Fixed

- **Subagent task persistence**: `/comet-build` now requires every subagent dispatch prompt to persist completed task checks in the Superpowers plan and, when mapped, the corresponding OpenSpec `tasks.md` item before committing. Build guard blocks unchecked Superpowers plan tasks, and build recovery reports both OpenSpec and plan progress before inspecting recent git history/diff or dispatching more work, preventing resume after interruption or context compression from re-running already completed subagent work ([#79](https://github.com/rpamis/comet/issues/79)).

- **skip-all skipping uninstalled components**: `comet init` no longer treats a previously skipped component as already installed. Choosing skip-all now only skips components that are actually present, so uninstalled OpenSpec, Superpowers, Comet, or CodeGraph components are still offered for installation instead of being silently bypassed ([#73](https://github.com/rpamis/comet/pull/73)).

- **Update JSON output for rules/hooks**: `comet update --json` now includes rules and hooks distribution results alongside skill update results, with per-target error isolation so a single platform failure doesn't break the entire update output.

- **Duplicate YAML fields**: `replace_yaml_field` in `comet-state.sh` now deduplicates all fields after replacement, keeping only the last occurrence of each key. Previously, multiple `cmd_set` calls for the same field (e.g., during verify-fail → re-verify cycles) could leave duplicate lines in `.comet.yaml`, confusing downstream parsers. Fixes [#77](https://github.com/rpamis/comet/issues/77).

- **Hook config format**: `installClaudeCodeHooks` and `.claude/settings.local.json` now use the correct `matcher` + `hooks: [{ type, command }]` array format instead of the flat `{ matcher, command, description }` format, fixing the `/doctor` schema validation error.

- **Archive delta merge**: `comet-archive.sh` now delegates archive spec updates to OpenSpec's delta merge semantics instead of copying change specs over main specs, preventing `ADDED/MODIFIED/REMOVED/RENAMED` section headings from leaking into stable specs. Addresses [#69](https://github.com/rpamis/comet/issues/69).
- **Brainstorming depth**: Chinese and English `/comet-design` no longer tell Superpowers `brainstorming` to skip context exploration, so unclear goals, scope, non-goals, acceptance scenarios, or constraints must be clarified before a Design Doc is created.
- **Command injection prevention**: `run_command_string()` in `comet-guard.sh` now rejects build/verify commands containing shell metacharacters (`;`, `|`, `&`, `$`, backtick), preventing command injection through `.comet.yaml` command fields.
- **Path traversal prevention**: `comet-state.sh cmd_set` now validates path fields (design_doc, plan, verification_report, handoff_context, handoff_hash) for `..` traversal sequences before writing.
- **Design guard enforcement**: Design guard now requires `design_doc` for full workflow (FAIL instead of WARN), preventing phase advance without a design document.
- **branch_status preservation on verify-fail**: `verify-fail` transition no longer resets `branch_status`, keeping branch handling state across re-verify cycles.
- **UTC date consistency**: All scripts now use `date -u +%Y-%m-%d` for `created_at`, `verified_at`, and archive naming, eliminating local/UTC date mismatches.
- **macOS SCRIPT_DIR resolution**: All scripts use portable `$(cd "$(dirname "$0")" && pwd -P)` instead of `readlink -f` for cross-platform compatibility.
- **Archive directory resolution fallback**: `comet-archive.sh resolve_archive_dir()` now searches by `*-$CHANGE` pattern when the exact UTC-based path doesn't match, fixing test reliability across timezone differences.
- **Temp file permissions**: All `mktemp` calls now set `chmod 600` on temporary files before writing sensitive data.
- **Pipe hash error propagation**: Hash computation in `comet-handoff.sh` and `comet-guard.sh` captures pipe output in variables before piping to hash stream, preventing silent failures under `pipefail`.

### Tests

- **Auto-transition regression**: Added state-machine and skill coverage for `auto_transition` init defaults, enum validation, `.comet/config.yaml` project default propagation, schema validation, and the manual-transition vs auto-advance branching in build/design/open/verify skills ([#74](https://github.com/rpamis/comet/pull/74)).
- **`comet-state next` regression**: Added shell-script coverage for next-step resolution across full/hotfix/tweak workflows, manual-handoff mode, archived completion (`NEXT: done`), and missing `.comet.yaml` failure behavior.
- **Skill handoff wording regression update**: Updated skill-content assertions to validate next-driven handoff wording (`NEXT: auto|manual|done`) and synchronized Chinese/English expectation checks.
- **Output language regression**: Added skill coverage that Comet propagates the triggering user request language into OpenSpec and Superpowers steps across the open, design, build, verify, hotfix, tweak, and archive skills ([#53](https://github.com/rpamis/comet/pull/53)).
- **Review gate regression**: Added skill coverage that `executing-plans` build mode requires the `requesting-code-review` gate before the build→verify transition, plus updated init-e2e expectations ([#76](https://github.com/rpamis/comet/pull/76)).
- **skip-all regression**: Added `comet init` coverage that skip-all only skips installed components and still offers uninstalled OpenSpec/Superpowers/Comet/CodeGraph components ([#73](https://github.com/rpamis/comet/pull/73)).
- **`--hash-only` flag coverage**: New tests verify correct hash output, change-directory validation, required-file validation, and no handoff file regeneration.
- **Context benchmark runner coverage**: New tests verify benchmark token-savings math, Codex JSONL usage/verdict parsing, and dry-run report generation without invoking Codex.
- **Flaky test timeout fix**: Design guard test without design_doc now has explicit 20s timeout to prevent Windows bash startup flakiness.
- **Chinese spec coverage**: Beta handoff test uses Chinese spec content to verify verbatim projection of all content (headings, descriptions, non-keyword steps) regardless of language.
- **JSON corruption detection**: New test verifies guard blocks design exit when `spec-context.json` is structurally invalid.
- **--full beta warning**: New test verifies the warning message and confirms beta files are still generated when `--full` is passed.
- **Doctor CodeGraph check**: `comet doctor` now reports CodeGraph CLI availability and project initialization status (`.codegraph/` presence).
- **Archive confirmation regression**: Added Chinese skill coverage that `/comet-archive` requires a final confirmation gate before executing the archive script.
- **English archive confirmation regression**: Added English skill coverage for final archive confirmation, archive reopen guidance, and hotfix/tweak preset blocking points.
- **Phase write guard hook coverage**: 10 new tests for `comet-hook-guard.sh` covering phase-based write blocking (open/design/archive block, build/verify allow), whitelist paths (openspec, docs/superpowers, .claude), archived change bypass, and no-active-change passthrough.
- **Archive reopen regression**: Added state-machine coverage for returning an unarchived change from archive confirmation back to verification and rejecting reopen attempts after `archived: true`.
- **Archive spec merge regression**: Added shell-script coverage for archiving a delta spec without copying delta-only requirement section headings into the stable main spec.
- **OpenSpec proposal regression**: Added Chinese and English skill coverage for the pre-artifact clarification gate, the default ban on one-shot `openspec-propose`, and preservation of the Superpowers brainstorming clarification flow.
- **Skill authoring regression**: Added coverage that `CLAUDE.md` documents the required skill invocation wording pattern.
- **Debug gate regression**: Added Chinese skill safeguard coverage for systematic-debugging invocation, minimal failing-test requirements, and keeping crash verification inside the current change.
- **Confirmation mechanism regression**: Added coverage that Chinese workflow decision gates no longer hard-code `AskUserQuestion` and that recovery output points agents to a platform-neutral confirmation mechanism.
- **PRD split workflow regression**: Added Chinese and English skill coverage for open-phase PRD split choices, `/comet-open` state initialization, repeated-triage prevention, split completion selection, and minimal resume guidance.
- **tdd_mode state machine regression**: Added coverage for tdd_mode init defaults (null for full, direct for hotfix), enum validation, build-exit guard, hotfix bypass, and schema validation rejection of invalid values.
- **Review fix regression**: Added coverage for conditional verification_report preservation on re-verify, branch_status preservation across verify-fail, path traversal rejection on design_doc, command injection rejection on build_command, and design guard enforcement for full workflow without design_doc.
- **Context compression regression**: Added coverage for project config defaults, change-level `context_compression` snapshots, environment override during change initialization, beta spec projection generation, and guard rejection when beta projection misses requirement or scenario headings.

## What's Changed [0.3.6] - 2026-06-02

### Added

- **Plan-ready build pause state**: Added `build_pause` as a dedicated build-phase pause marker so Comet can stop after plan generation without confusing the pause with the actual execution method.
- **Plan-ready pause design**: Added a design record for the model-switching pause workflow, covering recovery behavior, stale pause handling, and plan-missing remediation.

### Changed

- **Build recovery routing**: `/comet` and `/comet-build` now recognize `build_pause: plan-ready`, reuse the existing plan, and resume at workspace isolation and execution-method selection instead of regenerating the plan.
- **Bilingual workflow documentation**: Chinese and English Comet skills now describe the plan-ready pause point, clarify that `build_pause` is not `build_mode`, and document the same state field in both README files.

### Fixed

- **GitHub Copilot Superpowers skill names**: Comet skills now invoke the bare Superpowers skill names installed by the GitHub Copilot skills path, avoiding blocked workflows caused by unresolved `superpowers:*` aliases.
- **Windows bash resolution**: Comet now resolves a usable bash executable through `COMET_BASH`, rejects the Windows WSL launcher path, and uses the resolved executable for nested script calls so guard, handoff, and archive flows do not fall back to a broken PATH `bash`.
- **Shell test runner bash resolution**: `run-bats.js` now resolves a usable bash through `COMET_TEST_BASH`, `COMET_BASH`, PATH, or Git Bash defaults, avoiding the broken Windows WSL launcher when running shell tests from Node.
- **Schema validation fatal output**: Guard validation now preserves the final fatal schema-validation message after printing validator diagnostics, making invalid `.comet.yaml` failures easier to recognize.

### Tests

- **Superpowers skill invocation regression**: Added coverage that shipped Comet skill prose does not reference plugin-prefixed Superpowers aliases.
- **Comet bash execution regression**: Added coverage for nested script calls, shipped command examples, and the shell test runner so Comet uses resolved bash paths instead of raw PATH `bash`.
- **Plan-ready pause regression**: Added shell-script coverage for `build_pause` initialization, schema validation, state updates, and build recovery output.
- **README state-field regression**: Added README coverage to ensure `build_pause` appears in examples and field descriptions for both English and Chinese documentation.

## What's Changed [0.3.5] - 2026-05-29

### Added

- **Context compaction recovery (`--recover`)**: `comet-state check <name> <phase> --recover` outputs a structured recovery context, including phase status, field progress, task count, and recovery actions, used for agent context compression to quickly locate breakpoints and resume operations.
- **Red Flags Anti-Rationalization List**: Added 5 red flag warnings to the main scheduling skill (making decisions for the user, skipping confirmation, replacing historical preferences, agreeing without objection, and passing without verification), helping the agent identify its own overreach tendencies.
- **Uncertainty Degradation Principles**: Added SUGGESTION > WARNING > CRITICAL degradation rules to the verify skill. Only build failures, test failures, and security issues are marked CRITICAL; ambiguous issues must be downgraded.
- **Anti-Automatic Selection Guardian**: Added naming and scope anti-automatic selection rules to the open skill. Name changes must be specified by the user or AskUserQuestion. Confirmation: The scope cannot be expanded or narrowed arbitrarily.
- **File Existence Verification**: Before entering user confirmation, the open skill verifies that the proposal/design/tasks files are not empty, preventing empty files from skipping the check.
- **Idempotency Description**: Idempotency descriptions have been added to all skill stages (open/design/build/verify), clarifying which operations can be safely retried and which fields require confirmation before skipping.

### Changed

- **AskUserQuestion Tool Clarification**: All 7 decision blocking points (open confirmation, brainstorming confirmation, build workflow, verify failure decision, spec drift handling, branch handling, upgrade conditions) are uniformly required to use the AskUserQuestion tool; plain text prompts are prohibited.
- **Decision Points Expanded from 6 to 7**: The open stage proposal/design/tasks review confirmation is now the first decision point.
- **Spec Drift Single-Choice Question Format**: Spec drift handling in the verify stage has been changed to an AskUserQuestion single-choice question (A/B/C). (Choose one of three), no longer implicit default option
- **Completely synchronized Chinese and English skills**: The content, structure, and option format of the 7 Chinese skills and 7 English skills are completely aligned.

### Fixed

- **Crash due to unbound variables in `set -u`**: When `comet-state check --recover` is missing `tasks.md` during the build phase, the `pending` variable is not declared, causing the script to exit directly; this is fixed by moving the `local` declaration forward and adding an explicit branch `tasks.md MISSING` to the recovery action chain.
- **Path truncation risk**: `field_status` using `${var%% *}` on `design_doc` may truncate paths containing spaces; changed to `${var% }` to only remove trailing spaces.
- **Inconsistent reading style for optional fields**: `direct_override` uses `|| echo ""` while other optional fields use `|| true`; unified to `|| true` to be consistent with `cmd_scale`.

### Tests

- Added 8 `check --recover` and boundary test cases, covering five phases: open/build/verify/design/archive, as well as boundary scenarios such as missing tasks.md and all tasks completed.
- Total number of tests increased from 34 to 42, all passed.

## What's Changed [0.3.4] - 2026-05-29

### Changed

- **Command execution security**: Refactored all command execution in OpenSpec and Superpowers install paths from `spawn` with shell interpretation to `execFileSync`, eliminating shell injection surface and improving cross-platform reliability (#88bf487)

### Fixed

- **OpenSpec global install path for OpenCode**: `comet init --scope global` now migrates OpenSpec skills from the hardcoded `~/.opencode/` directory to `~/.config/opencode/` where OpenCode actually reads them, with a self-deletion guard when source and destination paths coincide (#46, @gleami)
- **Windows command execution**: Added `shell` option to `execFileSync` calls on Windows so command shims (.cmd) resolve correctly
- **Doctor `.comet.yaml` validation**: `comet doctor` now validates top-level keys instead of silently accepting unknown keys, and `readDir` errors other than ENOENT are no longer swallowed (@felamin)
- **CI JSON parsing**: CI workflow parses command output by finding the first `{` character, preventing non-JSON prefix lines from breaking JSON extraction (@yicochen)
- **CI warning output**: CI now only counts and prints warnings when a step actually fails, reducing noise in successful runs (@yicochen)
- **Spawn stdio noise**: Changed `inherit` to `ignore` for non-interactive spawn stdio so OpenSpec/Superpowers installers don't print unrelated progress to the console (@yicochen)

### Tests

- Added coverage for OpenCode global OpenSpec path migration, self-deletion guard, and homedir mocking
- Added doctor tests for `.comet.yaml` top-level key validation and non-ENOENT `readDir` error propagation
- Fixed timeout for git-based test "uses plan base-ref to scale verification"

### Docs

- Improved README setup guidance with clearer installation instructions and collapsible reference panels (both English and Chinese) (@hepeng)
- Added contributors wall to both README and README-zh (@Joechan11)

### New Contributors

- @felanny made their first contribution in #38
- @Joechan11 made their first contribution in #44
- @bevishe made their first contribution in #47
- @kathy32 made their first contribution in #39
- @gleami made their first contribution in #46

## What's Changed [0.3.3] - 2026-05-27

### Fixed

- **OpenSpec all-workflows installation**: `comet init` now writes the all-workflows config directly to the platform-specific default config path (`%APPDATA%\openspec\` on Windows, `$XDG_CONFIG_HOME/openspec/` on macOS/Linux when set, otherwise `~/.config/openspec/`) in addition to the isolated `XDG_CONFIG_HOME` env override, ensuring all 11 OpenSpec workflows are always installed regardless of the user's previous OpenSpec config state.

## What's Changed [0.3.2] - 2026-05-27

### Added

- **Script discovery helper**: New `comet-env.sh` centralizes script path resolution by sourcing sibling scripts from its own directory, replacing the scattered `COMET_SEARCH_ROOTS` find logic across all English and Chinese skills.
- **OpenCode global config directory**: OpenCode platform now supports a separate `globalSkillsDir` (`.config/opencode`) for global installs, keeping project and user-level skills distinct.
- **Command error diagnostics**: New `command-error.ts` module extracts and cleans stderr/stdout from failed shell commands, used by both OpenSpec and Superpowers install paths to surface actionable failure details.

### Changed

- **Build decision-point wording**: Strengthened the build skill's workspace-isolation and execution-method selection wording so agents cannot choose on behalf of the user based on recommendation rules.
- **Hotfix/Tweak upgrade wording**: Reworded upgrade-condition and verification-failure pause requirements in hotfix and tweak skills for clearer blocking semantics.
- **Comet user decision numbering**: Fixed out-of-sequence numbering in the Chinese comet skill's user decision point list.

### Fixed

- **OpenSpec workflow installation**: `comet init` now runs OpenSpec with `--profile custom` and a temporary config that enables all workflows (`propose`, `explore`, `new`, `continue`, `apply`, `ff`, `sync`, `archive`, `bulk-archive`, `verify`, `onboard`), ensuring Comet installs more than the default core workflow set.
- **OpenCode slash commands**: `comet init` now generates OpenCode command files (`commands/*.md`) that keep the `/comet*` command names while embedding the corresponding Comet workflow content, so OpenCode users can invoke `/comet`, `/comet-open`, etc. directly.
- **Lingma Superpowers path**: `comet init` now keeps Lingma out of the unsupported `skills --agent lingma` path and copies staged Superpowers skills into `.lingma/skills`, preventing the whole external installer batch from failing while preserving Lingma's expected directory layout.
- **Lingma global directory**: Lingma's global skills directory is explicitly `.lingma`, matching `~/.lingma/skills/{skill-name}/SKILL.md` for user-level installs and `.lingma/skills/{skill-name}/SKILL.md` for project installs.
- **Script discovery safety**: `comet-env.sh` no longer changes caller shell options when sourced, returns failure when bundled scripts are missing, and avoids ShellCheck unreachable-command diagnostics.
- **comet-state.sh field whitelist**: Added `created_at` and `base_ref` to the `cmd_set` allowed fields list, aligning validation with fields already written during `.comet.yaml` initialization.

### Tests

- **Script discovery coverage**: Added tests verifying `comet-env.sh` exports all bundled script paths and that no skill file inlines `COMET_SEARCH_ROOTS`.
- **Script discovery safety**: Added regression coverage for sourced shell option preservation and expandable `$HOME` skill-directory globs.
- **OpenCode Comet detection**: Added tests for OpenCode requiring both skill directories and matching command files before reporting Comet as installed.
- **OpenCode E2E init**: Added end-to-end tests for OpenCode project and global scope installs, including command file generation.
- **OpenCode command content**: Added tests that OpenCode command files preserve Comet command names and include full selected-language workflow content instead of a thin skill-delegation stub.
- **English workflow safeguards**: Added parity tests matching the existing Chinese workflow decision-point requirements.
- **OpenSpec profile and diagnostics**: Added tests for custom profile creation, `--profile custom` flag, and stderr/stdout detail printing on install failures.
- **Lingma Superpowers fallback**: Added regression coverage that Lingma is excluded from the unsupported skills CLI agent list and uses a staging install before copying skills to `.lingma`.
- **Lingma global install path**: Added regression coverage for `comet init --scope global` installing Lingma Comet skills under the user `.lingma/skills` directory.

## What's Changed [0.3.1] - 2026-05-26

### Added

- **Workflow state metadata**: `.comet.yaml` initialization now records `base_ref` and `created_at` so scale assessment and validation can reason from a stable change baseline.

### Changed

- **Comet decision points**: Clarified Chinese and English workflow skills so design confirmation, build configuration, verification failures, spec drift, branch handling, and preset upgrades pause for explicit user choice instead of relying on defaults or recommendations.
- **Build workflow selection**: Combined workspace isolation and execution-method selection into one build configuration step, reducing repeated pauses while still requiring `isolation` and `build_mode` before implementation can continue.
- **Hotfix verification flow**: Moved root-cause elimination before the build guard and requires preset upgrades to switch `workflow` to `full`, keeping failed hotfix checks in the build phase and full-flow upgrades in a consistent state.
- **Verification scale assessment**: Scale checks now fall back to `.comet.yaml` `base_ref` and use a four-file threshold for full verification, making committed build changes less likely to be undercounted.
- **English skill parity**: Synced English Comet skills with the Chinese workflow rules, including handoff generation, dirty-worktree handling, spec drift decisions, and verification failure blocking.

### Fixed

- **Windows npm update**: `comet update` now spawns npm through the shell so the package update path works reliably with Windows command shims.
- **Superpowers install diagnostics**: Failed Superpowers installs now print cleaned stderr details, making network or GitHub access failures visible instead of hiding the actionable cause.

### Tests

- **Workflow safeguard coverage**: Added regression coverage for Chinese Comet decision-point requirements and Superpowers install failure diagnostics.

## What's Changed [0.3.0] - 2026-05-25

### Added

- **Dirty worktree recovery protocol**: Added shared English and Chinese `comet/reference/dirty-worktree.md` references so agents consistently protect, inspect, and attribute user or mixed-source working tree changes during resume

### Changed

- **Comet resume behavior**: Updated `/comet`, build, verify, hotfix, and tweak skills so manual code edits made during interruptions are treated as code evidence, not automatic state transitions; agents must attribute dirty worktree changes before continuing or advancing guards

### Fixed

- **Reference skill installation**: Added the dirty worktree reference file to the Comet manifest so installed English and Chinese skill sets can resolve `comet/reference/dirty-worktree.md`

## What's Changed [0.2.9] - 2026-05-24

### Changed

- **Antigravity skill paths**: Updated platform handling so project-scope installs use `.agents/skills` while global installs use Antigravity's `.gemini/antigravity/skills` location, keeping `init`, `doctor`, and `update` aligned with Antigravity's directory model
- **README information architecture**: Reworked English and Chinese README sections so command details, platform lists, skill tables, script tables, `.comet.yaml` fields, and reliability notes are available in collapsible reference panels
- **Spec lifecycle documentation**: Expanded the README explanation of Comet's Spec lifecycle management, including OpenSpec/Superpowers artifact linking, automated handoff, state updates, validation, and archive sync
- **Security guidance location**: Moved repository maintenance security notes from README into `CONTRIBUTING.md`, keeping the README focused on user-facing Comet concepts and setup

### Fixed

- **Antigravity global installs**: Fixed `comet init --scope global` and related health checks so Antigravity no longer installs or searches global skills under the project-style `.agents` directory
- **Missing skills directories**: Added explicit existence checks before scanning project and global skills directories, keeping detection and update logic robust when platform directories exist without `skills/`

### Tests

- **Antigravity path coverage**: Added regression coverage for Antigravity project/global skill directories across detection and init E2E behavior
- **README structure coverage**: Verified the updated README command and reference structure with the existing README test suite

## What's Changed [0.2.8] - 2026-05-24

### Added

- **Design handoff script**: New `comet-handoff.sh` generates deterministic, source-traceable context packages (compact or full mode) from OpenSpec artifacts into `.comet/handoff/`, recording `handoff_context` and `handoff_hash` in `.comet.yaml`
- **Handoff guard checks**: Design phase guard now validates handoff context existence, hash freshness (detects post-handoff OpenSpec mutations), markdown traceability markers, and design doc frontmatter fields (`comet_change`, `role: technical-design`, `canonical_spec: openspec`)
- **`handoff_context` and `handoff_hash` fields**: New `.comet.yaml` fields for tracking script-generated handoff packages, with schema validation (path existence, sha256 hex digest format)
- **`comet init --scope`**: New `--scope <global|project>` CLI flag for non-interactive scope selection
- **CI init E2E job**: GitHub Actions now runs real `comet init` on Ubuntu, macOS, and Windows, verifying Comet skills, Superpowers, OpenSpec, and working directories land in correct filesystem locations for both project and global scope

### Changed

- **Chinese skill docs updated**: `comet-design/SKILL.md` and `comet/SKILL.md` now document the handoff flow, replacing agent-authored summaries with script-generated context packs
- **JSON generation uses process substitution**: `write_json_context` in `comet-handoff.sh` uses `< <(source_files)` instead of pipe subshell, fixing variable scoping
- **Error message formatting**: `comet-state.sh` unknown-field error message split from a single 270+ character line into multiple lines for readability
- **CLAUDE.md and AGENTS.md**: Added project-level instructions covering test commands, shell script conventions, script dependency graph, `.comet.yaml` state machine sync rules, and changelog format

### Fixed

- **YAML and frontmatter parsing**: Comet scripts now ignore unquoted trailing comments in `.comet.yaml` field values and accept Design Doc frontmatter after a UTF-8 BOM or leading blank lines, preventing false guard and handoff failures
- **Init E2E install checks**: CI now verifies Comet-owned skill artifacts in every supported platform directory and checks OpenSpec/Superpowers installer status from `comet init --json` for both project and global installs, avoiding false failures from external CLI-specific directory layouts
- **Windows global init E2E home directory**: CI now sets `USERPROFILE` alongside `HOME` for global-scope init checks on Windows, matching Node's `os.homedir()` resolution and preventing false missing-skill failures
- **README state documentation**: README examples now show accurate `.comet.yaml` build-state defaults, verification evidence timing, handoff fields, and project-only working directory creation
- **Windows Superpowers init timeout**: Superpowers external installer timeout increased to tolerate slower Windows `npx skills add` runs, reducing flaky init E2E failures

### Tests

- Added coverage for `--full` handoff mode, missing OpenSpec artifacts rejection, post-handoff hash mismatch detection, and design doc frontmatter validation
- Added `comet init` E2E tests covering project scope install, global scope install, skip-existing with `--yes`, overwrite with `--overwrite`, and multi-platform detection
- Added regression coverage for `.comet.yaml` trailing comments and Design Doc frontmatter with a UTF-8 BOM or leading blank lines
- Added CI workflow regression coverage for project and global installation checks across Comet-owned files and external OpenSpec/Superpowers installer statuses
- Added CI workflow regression coverage for Windows global init using the temporary `USERPROFILE` home directory
- Added regression coverage for the longer Superpowers installer timeout used by init

## What's Changed [0.2.7] - 2026-05-24

### Fixed

- **OpenSpec global init**: `comet init` global scope now passes the home directory as OpenSpec's init target instead of using the unsupported `openspec init --global` flag
- **Cross-platform path quoting**: OpenSpec init targets are shell-quoted for Windows, macOS, and Linux paths, including home directories with spaces
- **Installer argument quoting**: OpenSpec `--tools` values and Superpowers `--agent` values are now shell-quoted, and Windows OpenSpec paths preserve trailing backslashes before the closing quote
- **Superpowers multi-platform install**: Superpowers installation now passes repeated `--agent` flags instead of a comma-separated agent list, matching the `skills` CLI behavior
- **Superpowers agent mappings**: Updated Comet platform mappings to valid `skills` CLI agent IDs, with unsupported platform-specific IDs falling back to `universal`

### Tests

- Added regression coverage for OpenSpec global init command construction across Windows, macOS, and Linux
- Added regression coverage for OpenSpec Windows trailing-backslash quoting and quoted installer arguments
- Added Superpowers coverage for valid `skills` CLI agent mappings and multi-agent argument formatting
- Smoke-tested project and global initialization outputs for all 28 supported platforms in isolated temporary directories

## What's Changed [0.2.6] - 2026-05-23

### Added

- **Build decision enforcement**: Build guard and `comet-state.sh transition build-complete` now require `isolation` and `build_mode` before moving from build to verify
- **Direct mode override**: Full workflows must set `direct_override: true` before using `build_mode: direct`; hotfix/tweak remain allowed by default
- **Configurable guard commands**: Guard scripts now read `build_command` and `verify_command` from the change `.comet.yaml` or repo-root Comet config before falling back to auto-detected build commands
- **Archive diff preview**: Archive sync prints a unified diff before overwriting an existing main spec when it differs from the delta spec
- **Cross-platform script smoke CI**: Added Ubuntu, macOS, and Windows smoke coverage for Comet shell scripts and portable shell tests
- **Shell line-ending policy**: Added `.gitattributes` rules to keep shell and Bats scripts on LF endings

### Changed

- **Guard failure output**: Guard checks now preserve and print command failure output, plus actionable `Next:` hints for missing build decisions and unfinished tasks
- **Command handling**: Project commands run through `bash -lc`, Maven uses `mvnw` or `mvn.cmd` where appropriate, and Windows Git Bash paths are handled in shell test helpers
- **Archive step counting**: Dry-run, delta sync, annotation, move, and archive status steps now count real executed steps without double-counting repeated operations
- **English docs and skills**: Synced the English README and Comet skill text with the Chinese build-decision, command-config, and archive behavior descriptions

### Fixed

- **macOS shell script state updates**: Replaced GNU-only `sed -i` writes in `comet-state.sh` with portable temp-file updates, fixing macOS CI failures during `scale`, `transition`, and YAML field updates
- **Optional field reads under pipefail**: Guard and state scripts now tolerate missing optional YAML fields without exiting early under `set -euo pipefail`
- **Bash detection fallback**: Shell test helpers now handle failed `bash` probes without crashing on empty `spawnSync` output
- **Configured command persistence**: `comet-state.sh set` now escapes sed replacement metacharacters so command values containing `&`, `|`, or backslashes are preserved
- **Optional schema fields**: YAML validation now recognizes `direct_override`, `build_command`, and `verify_command`
- **Quoted YAML values**: State, guard, and validator scripts now strip only wrapping quotes instead of deleting all quote characters from values

### Tests

- Added coverage for missing build decisions, direct-mode override blocking and allowance, configured build/verify commands, command metacharacter preservation, unfinished-task remediation output, archive step counts, cross-platform path handling, BSD/GNU sed portability, optional YAML field reads under `pipefail`, and failed bash probe handling

## What's Changed [0.2.5] - 2026-05-22

### Added

- **PR title lint workflow**: Added GitHub Actions validation for semantic PR titles with Comet-specific scopes (`cli`, `commands`, `core`, `skills`, `assets`, `scripts`, `docs`, `ci`, `deps`, `release`)
- **Structured JSON output**: `comet init --json` and `comet update --json` now emit machine-readable results instead of mixed human logs
- **`doctor --scope`**: `comet doctor` can diagnose `auto`, `project`, or `global` scope, with `auto` checking both project and global installs
- **Next-step status hint**: `comet status` now reports the next workflow command (`/comet-open`, `/comet-design`, `/comet-build`, `/comet-verify`, `/comet-archive`) in text and JSON output
- **README asset guard**: Added tests and prepublish validation to keep README images on npm-friendly absolute URLs

### Changed

- **`comet update` preserves installed context**: Update now detects existing Comet skill targets across project/global scopes, preserves installed scope, detects Chinese vs English skills, and updates only platforms where Comet skills are already installed
- **`comet update` self-updates npm package**: Update now prints and runs the matching npm update command for the detected package scope before refreshing installed skills
- **Friendlier update output**: Update logs the npm command, per-target skill copy command, final npm status, updated target count, scope, and language summary
- **Init overwrite flow**: Interactive `comet init` now offers a bulk overwrite/skip choice when multiple existing components are detected on the same platform
- **CLI option validation**: `update --language`, `update --scope`, and `doctor --scope` now validate accepted values through Commander choices
- **README CLI docs**: Updated English and Chinese README command sections to document JSON output, doctor scope, update behavior, status next-step hints, and init overwrite behavior
- **CONTRIBUTING link**: Added contribution guide references to both English and Chinese README development sections

### Fixed

- **Doctor false positives**: `comet doctor` now recognizes current `.comet.yaml` fields including `verification_report` and `branch_status`
- **npm README images**: README images now use absolute GitHub URLs so package pages can render them

### Tests

- Added coverage for update language/scope detection, JSON output, friendly command display, status next-step hints, doctor current-state validation, README image URLs, init bulk overwrite selection, and PR title workflow configuration

## What's Changed [0.2.4] - 2026-05-21

### Added

- **Verification evidence enforcement**: `verify-pass` transition now requires `verification_report` (file must exist) and `branch_status: handled` before allowing phase advance. Guard checks these as hard prerequisites
- **`verification_report` and `branch_status` fields** in `.comet.yaml`: New state fields track verification report path and branch handling status
- **Verification evidence step** in comet-verify (zh): New Step 4 requiring report file creation and branch status recording before guard apply
- **`branch_status` enum validation**: `comet-state.sh set` validates `branch_status` as `pending` or `handled`
- **Guard verify checks**: `comet-guard.sh` now checks `verification_report exists` and `branch_status=handled` during verify phase
- **Bats test CRLF fix**: Shell tests strip `\r` from scripts before execution, fixing Windows compatibility
- **`test:shell` runner**: Replaced direct `bats` call with `node scripts/run-bats.js` for cross-platform support

### Changed

- **Hotfix root cause check reordered**: Moved root cause elimination check **before** comet-verify loading (Step 3a → 3b split), preventing it from being skipped during verify flow
- **Hotfix header description simplified**: Replaced ambiguous "not a separate parallel process" with direct "Quick bug fix workflow" for standalone invocation clarity
- **Removed non-action steps from comet-design**: Deleted Step 3 (Dual Spec Division table) and Step 4 (Document Hierarchy) — pure reference material with no agent actions
- **Removed duplicate script location blocks**: comet-open (Step 3) and comet-archive (Step 1) no longer repeat the full `COMET_SEARCH_ROOTS` find block when variables already cached
- **Removed duplicate 50% threshold in comet-build**: Single mention in threshold determination table instead of table + bullet repetition
- **Generic error handling**: Error table in comet main skill changed "Maven compile/test" → "Build/test" for language-agnostic wording
- **comet-state.sh usage help**: Fixed `check` parameter order in help text (`check <change-name> <phase>`)

### Fixed

- **comet-state.sh `init` change directory resolution**: `cmd_init` now resolves `change_dir` before checking if `.comet.yaml` already exists, fixing path resolution for nested directories
- **Guard deadlock on verify**: `verify-pass` transition now resets `verification_report` and `branch_status` when rolling back via `verify-fail`, preventing stale evidence from allowing false transitions

### Tests

- **+66 lines** in `comet-scripts.test.ts`: New tests for verification evidence blocking, branch status validation, and guard verify with evidence
- **+12 lines** in `comet-state.bats`: New tests for `branch_status` enum validation, CRLF stripping, and new field presence in init output

## What's Changed [0.2.3] - 2026-05-19

### Added

- **"Why Comet" section**: README now explains the rationale behind Comet — how it combines OpenSpec's WHAT management with Superpowers' HOW execution into a unified 5-phase pipeline
- **"Screenshots" section**: Added three screenshots demonstrating platform selection, initialization, and skill execution in action
- **"What You'll Learn" section**: New section showcasing Comet as a reference for stable nested skill triggering and multi-phase auto-flow patterns
- **State Management YAML example**: Extended documentation with complete `.comet.yaml` field example showing all key configuration values

### Changed

- **comet-build skill description**: Clarified that execution mode (subagent vs executing-plans) is user-selectable based on task complexity, not always subagent-driven
- **Enhanced State Management docs**: Added explanation of how all states and phases are updated via scripts with completion validation before phase transitions

## What's Changed [0.2.2] - 2026-05-18

### Fixed

- **Ctrl+Z/Ctrl+C crash during `comet init`**: Wrapped inquirer prompts in try/catch to handle `ExitPromptError`, showing `Cancelled.` and exiting cleanly instead of printing a raw stack trace
- **Duplicate Superpowers installation**: `comet init` now detects Superpowers installed via Claude Code plugin system (`~/.claude/plugins/cache/`), skipping redundant `npx skills add` when Superpowers plugin is already present

## What's Changed [0.2.1] - 2026-05-18

### Fixed

- **CI pnpm version**: Added `packageManager` field for pnpm/action-setup v4
- **Shell scripts**: Fixed `SCRIPT_DIR` typo, renamed `maven_compiles` → `build_passes` (language-agnostic), fixed `check_nonempty` path bug, fixed `cmd_set` sed delimiter for path values, corrected shellcheck directive placement
- **Node version**: Bumped minimum to Node 20 (vitest v4 coverage requires `node:inspector/promises`)

## What's Changed [0.2.0] - 2026-05-18

Comet 0.2.0 is a comprehensive optimization release: skill reliability, CLI completeness, and engineering quality.

### Skill Reliability

- **SKILL.md two-zone structure**: All 8 skills split into "Decision Core" (phase detection, upgrade criteria, error handling) and "Reference Appendix" (field reference, scripts, best practices)
- **Quantified upgrade criteria**: Hotfix/tweak now define explicit thresholds for upgrading to full workflow (file count, cross-module coordination, architecture changes, etc.)
- **Script location caching**: All skills use `${VAR:-$(find ...)}` env-var cache pattern, avoiding repeated `find` calls
- **`manifest.json` fixed**: Added missing `comet-state.sh` and `comet-archive.sh` entries
- **`comet-state.sh init` fixed**: Now writes `workflow` field to `.comet.yaml`, fixing `check design` which always failed

### CLI Commands

- **`comet status`**: Show active changes with phase, task progress, workflow mode, design doc, and plan (`--json` supported)
- **`comet doctor`**: Diagnose installation health — OpenSpec CLI, working directories, skill completeness per platform, script presence, `.comet.yaml` validity (`--json` supported)
- **`comet update`**: Update comet skill files to latest version from npm package (`--language`, `--scope` supported)
- **`--json` on all commands**: `init`, `status`, `doctor`, `update` all accept structured output

### Engineering

- **Test suite**: 54 unit tests (5 suites) with 93.8% statement / 100% function coverage; 26 bats shell tests
- **GitHub Actions CI**: Build + lint + format + test (Node 18/20/22) + shellcheck + bats on push/PR
- **ESLint + Prettier**: Code quality tooling with `pnpm lint` / `pnpm format`
- **Code organization**: Monolithic `init.ts` (620 lines) split into 5 focused core modules + 4 command modules
- **Command injection hardening**: Platform/tool ID validation before shell command construction
- **Per-file error handling**: Copy loop continues past individual file failures

## What's Changed [0.1.8] - 2026-05-17

### Added

- **`comet-state.sh` script**: Unified state management with 5 subcommands — `init` (create .comet.yaml), `set` (update with enum validation), `get` (read field), `check` (entry verification), `scale` (verification mode assessment)
- **`check` subcommand**: Scripted entry verification replacing text checklists in all 8 skills
- **`scale` subcommand**: Scripted scale assessment replacing prose decision rules in comet-verify

### Changed

- **All `.comet.yaml` writes go through `comet-state.sh`**: No more raw `sed -i` — enum validation on every field write
- **All skill Step 0 checklists replaced with `check` subcommand**: Single command replaces text-based entry verification
- **`comet-guard.sh` and `comet-archive.sh` use state.sh internally**: All state mutations through unified interface
- **Removed write-verification blocks**: hotfix and tweak presets no longer have manual verification loops

## What's Changed [0.1.7] - 2026-05-16

### Added

- **`comet-archive.sh` script**: One-command archive automation — validates entry state, syncs delta specs to main specs (overwrite), annotates design doc and plan frontmatter, moves change to archive directory, updates `archived: true`. Supports `--dry-run` for preview
- **`--apply` mode for `comet-guard.sh`**: Opt-in flag that auto-updates `.comet.yaml` state fields after all guard checks pass. No manual state editing required during phase transitions
- **Idempotent frontmatter annotation**: `annotate_frontmatter()` skips existing `archived-with:` lines, safe to re-run

### Changed

- **Removed manual state editing**: All phase transitions (design → build → verify → archive) now use `guard --apply` instead of manual `.comet.yaml` field updates and write-verification loops
- **Removed write-verification blocks**: Eliminated all `【写入验证】` / `【Write verification】` patterns from comet-open, comet-design, comet-build, comet-verify, and comet-archive skills
- **Removed `## ADDED`/`## MODIFIED`/`## REMOVED` delta format**: Delta specs are now complete specs; archive overwrites main spec instead of merging fragments
- **Removed step 2b from comet-open**: Incremental modification of existing capabilities is just a new `/comet-open` — brainstorming reads existing specs as context naturally
- **Simplified archive skill**: Steps 1b–5 replaced with single `comet-archive.sh` call
- **Updated `comet/SKILL.md`**: Script location section now documents both `--apply` mode and archive script

### Removed

- Few-shot YAML examples for `isolation`, `build_mode`, `verify_mode` fields (redundant with agent judgment)
- `openspec-archive-change` skill dependency from comet-archive (archive script handles all steps)

## What's Changed [0.1.6] - 2026-05-16

### Added

- **Workspace Isolation Selection**: `comet-build` now prompts users to choose between creating a branch or a worktree before execution begins (Step 3: Workspace Isolation)
- **`isolation` field in `.comet.yaml`**: New required field (`branch` or `worktree`) to record the user's workspace isolation choice
- **`isolation` enum validation**: `comet-yaml-validate.sh` now validates `isolation` as a required field with allowed values `branch`/`worktree`

### Changed

- `comet-build` step numbering: Step 3 (Select Execution Method) → Step 4, Step 4 (Spec Incremental Updates) → Step 5
- Hotfix and tweak presets default to `isolation: branch` without prompting
- `comet-yaml-validate.sh` `REQUIRED_FIELDS` and `KNOWN_KEYS` updated to include `isolation`

## What's Changed [0.1.5] - 2026-05-15

### Added

- **Bilingual Comet skills**: `comet init` now prompts for language selection (English / 中文) and deploys the corresponding SKILL.md files
- **Language-aware asset structure**: English skills in `assets/skills/`, Chinese skills in `assets/skills-zh/`
- **`languages` field in manifest.json**: Maps language IDs to asset directories for future extensibility

### Changed

- All 8 Comet SKILL.md files in `assets/skills/` are now English (Chinese originals preserved in `assets/skills-zh/`)
- `copyCometSkillsForPlatform` accepts `languageSkillsDir` parameter; script files always sourced from default `skills/` directory
- `--yes` mode defaults to English language selection

## What's Changed [0.1.4] - 2026-05-15

### Fixed

- **Superpowers redundant project-level install**: `comet init` now checks the global directories (`~/{platform}/skills/`) of all user-selected platforms before installing Superpowers. If Superpowers is already installed globally for any selected platform, the project-level install is skipped
- **Unwanted `.agents/` directory creation**: `comet init` now passes `--agent` flag to `skills add`, targeting only the platforms the user selected. This prevents the skills CLI from auto-detecting and installing to all platforms, which previously created an unnecessary `.agents/` directory
- **OpenSpec global detection**: Same global-directory fallback logic applied to OpenSpec detection, avoiding redundant OpenSpec installs when already present globally for selected platforms

### Changed

- `hasSkills()` accepts `selectedPlatforms` parameter to scope global detection to user-chosen platforms only
- `installSuperpowersForPlatform()` replaced with `installSuperpowersForPlatforms()` that accepts platform IDs and maps them to skills CLI agent names via `SKILLS_AGENT_MAP`

## What's Changed [0.1.3] - 2026-05-15

### Added

- **State File Separation**: Comet workflow state now stored in independent `.comet.yaml` file instead of `.openspec.yaml` subtree
- **Three-Layer Reliability Defense**:
  - Entry verification for all phases with `[HARD STOP]` diagnostics
  - Write-then-verify pattern for all state mutations
  - Schema validator script (`comet-yaml-validate.sh`) with field, enum, and path validation
- **Path Traversal Protection**: Input validation for change names to prevent directory traversal attacks
- **Guard Script Integration**: Automatic schema validation during phase transitions

### Changed

- Updated all 9 Comet skills to use `.comet.yaml` instead of `.openspec.yaml` comet: subtree
- Improved error messages with specific field values instead of generic placeholders
- Enhanced project structure documentation

### Security

- Fixed path traversal vulnerability through unvalidated change name inputs
- Schema validation now catches typos and invalid enum values at entry point
