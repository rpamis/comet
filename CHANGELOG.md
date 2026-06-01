# Changelog

All notable changes to @rpamis/comet will be documented in this file.

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
* @felanny made their first contribution in #38
* @Joechan11 made their first contribution in #44
* @bevishe made their first contribution in #47
* @kathy32 made their first contribution in #39
* @gleami made their first contribution in #46

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
