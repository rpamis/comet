# DeepSeek Harness Platform Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class `dsh` support to Comet beta20 so `init`, `update`, and `uninstall` manage dsh Skills, Rules, Hooks, OpenSpec assets, and Superpowers assets without duplicating the external dependency installers.

**Architecture:** Register dsh as a platform with the official project `.dsh/skills` and global `$DSH_HOME/skills` roots. Reuse Claude-shaped OpenSpec and Superpowers staging as source formats, then mirror their generated Skills into dsh. Manage dsh instructions through marked `AGENTS.local.md`/`$DSH_HOME/AGENTS.md` blocks and manage dsh Hooks through `hooks.json` plus a Cordis patch row; project patch activation remains explicit because dsh does not auto-discover it.

**Tech Stack:** TypeScript, Vitest, Node.js filesystem/process adapters, generated Classic/Native runtime assets, JSON/Markdown platform metadata.

## Global Constraints

- The canonical platform registry remains `platform/install/platforms.ts`; no second dsh whitelist may be added.
- dsh uses `.dsh/skills` for project scope and `$DSH_HOME/skills` for global scope, with `~/.dsh/skills` as the default when `DSH_HOME` is unset.
- Classic initialization must install a compatible OpenSpec CLI and Superpowers Skills for dsh; Native-only initialization must not install those dependencies.
- `uninstall` removes only Comet-managed dsh assets and integration rows; it must not uninstall the user’s global OpenSpec CLI or Superpowers package.
- Existing user content in `AGENTS.md`, `AGENTS.local.md`, Hook JSON, and Cordis patch files must be preserved outside Comet-owned markers/rows.
- Project dsh Hooks are reported with the explicit `--patch .dsh/cordis.patch.yml` activation requirement.
- Tests must fail before production behavior is added, then pass with the smallest implementation.

## File Map

- Modify `platform/install/platforms.ts` and `platform/install/detect.ts` for dsh registry metadata and `$DSH_HOME` resolution.
- Modify `domains/integrations/openspec.ts`, `domains/integrations/superpowers.ts`, `app/commands/init.ts`, and `app/commands/update.ts` to stage Claude-compatible dependency assets and mirror them into dsh.
- Modify `domains/skill/platform-install.ts`, `domains/skill/platform-inspect.ts`, and `domains/skill/uninstall.ts` for dsh instruction blocks, Hook JSON, Cordis patch ownership, and cleanup.
- Modify `test/platform/detect.test.ts`, `test/domains/integrations/openspec.test.ts`, `test/domains/integrations/superpowers.test.ts`, `test/domains/skill/skills.test.ts`, `test/domains/skill/uninstall.test.ts`, `test/app/init-e2e.test.ts`, and `test/app/update.test.ts` for focused lifecycle contracts.
- Modify generated manifests/bundles only through the repository build scripts.
- Add the user-visible beta20 entry to `CHANGELOG.md` after the implementation is complete and the actual behavior is verified.

### Task 1: Lock the dsh registry and dependency source contract

**Files:**
- Modify: `test/platform/detect.test.ts`
- Modify: `test/domains/integrations/openspec.test.ts`
- Modify: `test/domains/integrations/superpowers.test.ts`
- Modify: `platform/install/platforms.ts`
- Modify: `platform/install/detect.ts`
- Modify: `domains/integrations/openspec.ts`
- Modify: `domains/integrations/superpowers.ts`

- [ ] **Step 1: Write failing tests**

  Add tests that assert the registered `dsh` platform exposes `.dsh` project Skills, honors `DSH_HOME` for global Skills, uses Claude as the OpenSpec staging tool, and builds a Superpowers staging flow that copies into dsh rather than passing an unsupported Skills CLI agent id.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

  Run:

  ```bash
  pnpm exec vitest run test/platform/detect.test.ts test/domains/integrations/openspec.test.ts test/domains/integrations/superpowers.test.ts
  ```

  Expected: failures for the missing `dsh` registry entry and missing mirror/staging behavior.

- [ ] **Step 3: Implement the minimal registry and source mapping**

  Add `dsh` to the canonical registry with `openspecToolId: 'claude'`, a Claude OpenSpec source mapping, and dsh-specific global root resolution. Add a dsh Superpowers staging branch that uses the existing Claude staging command and copies staged `.claude/skills` into the dsh Skill root. Extend OpenSpec mirroring with a source-tool/platform mapping so dsh receives generated Claude assets without claiming that OpenSpec supports a `dsh` tool id.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run the same Vitest command and confirm all existing platform/dependency tests remain green.

### Task 2: Add dsh instruction Rule ownership

**Files:**
- Modify: `test/domains/skill/skills.test.ts`
- Modify: `test/domains/skill/uninstall.test.ts`
- Modify: `domains/skill/platform-install.ts`
- Modify: `domains/skill/platform-inspect.ts`
- Modify: `domains/skill/uninstall.ts`

- [ ] **Step 1: Write failing tests**

  Add project and global tests proving Comet writes a bounded managed block to `AGENTS.local.md` and `$DSH_HOME/AGENTS.md`, preserves surrounding user text, updates the selected language content, and removes only the managed block during uninstall.

- [ ] **Step 2: Run the tests and verify they fail for the missing dsh instruction adapter**

  Run:

  ```bash
  pnpm exec vitest run test/domains/skill/skills.test.ts test/domains/skill/uninstall.test.ts
  ```

- [ ] **Step 3: Implement marked instruction merging and inspection**

  Add dsh-specific instruction helpers with stable start/end markers. Use `AGENTS.local.md` for project scope and `AGENTS.md` under the resolved dsh home for global scope. Do not overwrite unmarked files, and return inspection/removal counts based on the managed block.

- [ ] **Step 4: Run the tests and verify they pass**

  Re-run the focused Skill and uninstall tests.

### Task 3: Add dsh Hook JSON and Cordis patch lifecycle

**Files:**
- Modify: `test/domains/skill/skills.test.ts`
- Modify: `test/domains/skill/uninstall.test.ts`
- Modify: `test/app/init-e2e.test.ts`
- Modify: `test/app/update.test.ts`
- Modify: `domains/skill/platform-install.ts`
- Modify: `domains/skill/platform-inspect.ts`
- Modify: `domains/skill/uninstall.ts`

- [ ] **Step 1: Write failing tests**

  Add tests that install the Claude-shaped `hooks.json`, add one Comet-owned dsh bridge row to `cordis.patch.yml`, preserve unrelated rows, make repeated update idempotent, report project `--patch` activation guidance, and remove only Comet-owned Hook/patch entries.

- [ ] **Step 2: Run the tests and verify the expected failures**

  Run:

  ```bash
  pnpm exec vitest run test/domains/skill/skills.test.ts test/domains/skill/uninstall.test.ts test/app/init-e2e.test.ts test/app/update.test.ts
  ```

- [ ] **Step 3: Implement the dsh Hook adapter**

  Reuse the existing Claude-shaped command generation for `hooks.json`; add a dsh-specific patch reconciler that owns a stable package/id row for `@deepseek-ai/dsh-hooks-claude-code`. Use relative project config paths for project scope and resolved dsh-home paths for global scope. Return a non-failing installed result plus activation guidance for project patches.

- [ ] **Step 4: Run the focused lifecycle tests and verify they pass**

  Re-run the tests from Step 2 and confirm existing platform Hook behavior is unchanged.

### Task 4: Wire init/update/uninstall end-to-end

**Files:**
- Modify: `app/commands/init.ts`
- Modify: `app/commands/update.ts`
- Modify: `app/commands/uninstall.ts`
- Modify: relevant `test/app/*.test.ts`

- [ ] **Step 1: Write failing end-to-end tests**

  Add dsh project-scope Classic tests asserting `init` invokes OpenSpec CLI setup and Superpowers installation, writes dsh assets, `update` refreshes all three dependency/asset families, and `uninstall` removes dsh files while leaving external dependency state untouched.

- [ ] **Step 2: Run the tests and verify the expected failures**

  Run:

  ```bash
  pnpm exec vitest run test/app/init-e2e.test.ts test/app/update.test.ts test/app/uninstall.test.ts
  ```

- [ ] **Step 3: Implement lifecycle wiring**

  Pass dsh-specific base directories into per-platform operations, include dsh in the existing Classic dependency plans, pass dsh mirror targets into OpenSpec initialization/update, and keep uninstall limited to Comet-managed files. Ensure result summaries and JSON output identify dsh consistently.

- [ ] **Step 4: Run the end-to-end tests and verify they pass**

  Re-run the focused app tests and inspect JSON/result summaries.

### Task 5: Regenerate assets, docs metadata, changelog, and verify

**Files:**
- Modify: generated runtime/asset files through build scripts
- Modify: `CHANGELOG.md`
- Test: repository/runtime asset contract tests

- [ ] **Step 1: Run the focused platform and lifecycle test suite**

  ```bash
  pnpm exec vitest run test/platform/detect.test.ts test/domains/integrations/openspec.test.ts test/domains/integrations/superpowers.test.ts test/domains/skill/skills.test.ts test/domains/skill/uninstall.test.ts test/app/init-e2e.test.ts test/app/update.test.ts test/app/uninstall.test.ts
  ```

- [ ] **Step 2: Regenerate required assets**

  Run the repository build commands required by the changed runtime/asset entry points, then verify generated files are synchronized and no generated file contains hand-written business logic.

- [ ] **Step 3: Update the English beta20 changelog entry**

  Add one user-visible entry describing dsh project/global Skill installation, Classic OpenSpec/Superpowers dependency support, Hook/Rule lifecycle support, and explicit project Hook patch activation.

- [ ] **Step 4: Run final verification proportional to the cross-module risk**

  ```bash
  pnpm format:check
  pnpm lint
  pnpm build
  pnpm exec vitest run
  git diff --check
  ```

- [ ] **Step 5: Review the final worktree**

  Confirm only the dsh worktree contains implementation changes, the main worktree’s unrelated deletion is untouched, no external GitHub action was taken, and no OpenSpec/Superpowers global CLI was removed by uninstall.
