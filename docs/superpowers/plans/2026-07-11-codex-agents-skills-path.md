# Codex `.agents/skills` Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make current Codex CLI installations place Comet Skills in `.agents/skills` while safely managing legacy `.codex/skills` installs and retaining Codex-specific files under `.codex`.

**Architecture:** Extend platform metadata so the canonical Skill root, configuration/rules root, detection markers, and legacy Skill roots are independent. Installation writes only to the canonical root; update and uninstall scan explicitly declared legacy roots for managed Comet entries; ordinary Skill discovery prefers the canonical root. Codex rules and plugin-cache detection remain `.codex`-specific.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest, pnpm/npm repository scripts.

## Global Constraints

- Canonical project destination: `<project>/.agents/skills`.
- Canonical global destination: `~/.agents/skills`.
- Codex rules, hooks, configuration, and plugin caches remain under `.codex`.
- Legacy `.codex/skills` is compatibility input only; do not permanently dual-write.
- Never delete unrelated user or third-party Skills.
- A shared `.agents/skills` directory alone must not identify Codex automatically.
- Keep package version `0.4.0-beta.4`; append the user-visible fix to the existing changelog entry.

## File Structure

- `platform/install/platforms.ts`: declare canonical, detection, rules, and legacy roots and expose canonical/compatibility root helpers.
- `platform/install/detect.ts`: separate platform auto-detection from managed Skill compatibility scans.
- `domains/skill/platform-install.ts`: install to the canonical root and clean only known legacy Comet entries after a successful update/install.
- `domains/skill/uninstall.ts`: remove managed entries from canonical and declared legacy roots.
- `domains/skill/find.ts`: use the canonical Codex root for ordinary Skill inventory.
- `app/commands/update.ts`: inspect and report legacy Codex installs during update.
- `app/commands/doctor.ts`: distinguish canonical installs from legacy-only installs.
- `test/platform/detect.test.ts`, `test/domains/skill/symlink-install.test.ts`, `test/domains/skill/skill-find.test.ts`, `test/app/update.test.ts`, `test/app/uninstall.test.ts`: lifecycle regression coverage.
- `CHANGELOG.md`: user-visible beta.4 compatibility fix.

---

### Task 1: Model Codex canonical and legacy Skill roots

**Files:**
- Modify: `platform/install/platforms.ts`
- Test: `test/platform/detect.test.ts`

**Interfaces:**
- Produces: `Platform.legacySkillsDirs?: string[]` and `getPlatformSkillsDirs(platform, scope)` returning canonical first followed by unique compatibility roots.
- Preserves: `getPlatformSkillsDir(platform, scope): string` as the canonical write destination.

- [ ] **Step 1: Write failing platform-path tests**

Add assertions that the Codex platform has canonical project/global root `.agents`, rules base `.codex`, detection marker `.codex`, and compatibility scan roots `['.agents', '.codex']`. Add a detection case proving an unrelated `.agents/skills/personal-skill` directory does not automatically select Codex.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run test/platform/detect.test.ts`

Expected: FAIL because Codex still reports `.codex` as canonical and `.agents` currently participates only through other platform definitions.

- [ ] **Step 3: Implement the metadata split**

Extend `Platform` with `legacySkillsDirs?: string[]`; make `getPlatformSkillsDirs` return a de-duplicated canonical-first list; configure Codex as:

```ts
{
  id: 'codex',
  name: 'Codex',
  skillsDir: '.agents',
  globalSkillsDir: '.agents',
  legacySkillsDirs: ['.codex'],
  detectionPaths: ['.codex'],
  openspecToolId: 'codex',
  rulesBaseDir: '.codex',
  rulesDir: 'rules',
  rulesFormat: 'md',
  supportsHooks: true,
  hookFormat: 'claude-code',
}
```

Keep `detectPlatforms` using `detectionPaths` for Codex so a generic shared Skill directory does not prove platform identity.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npx vitest run test/platform/detect.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/install/platforms.ts test/platform/detect.test.ts
git commit -m "fix(codex): use agents skill discovery roots"
```

### Task 2: Write Codex Skills to the canonical root while retaining `.codex` rules

**Files:**
- Modify: `domains/skill/platform-install.ts`
- Test: `test/domains/skill/symlink-install.test.ts`
- Test: `test/app/init-e2e.test.ts`

**Interfaces:**
- Consumes: `getPlatformSkillsDir()` canonical root and existing `computeRuleDestPath()` rules-root separation.
- Produces: copy and symlink installations under `.agents/skills`; no legacy Skill writes.

- [ ] **Step 1: Write failing copy, symlink, and rules tests**

Use the real Codex platform definition. Assert copy mode creates `.agents/skills/comet/SKILL.md` and not `.codex/skills/comet/SKILL.md`; assert symlink mode links managed entries under `.agents/skills`; assert phase rules remain `.codex/rules/comet-phase-guard.md`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run test/domains/skill/symlink-install.test.ts test/app/init-e2e.test.ts`

Expected: at least the canonical-path assertion fails before Task 1 metadata is applied, and the complete assertions expose any path helper still bypassing canonical metadata.

- [ ] **Step 3: Replace direct platform-root reads in installation paths**

Ensure every Skill destination in `platform-install.ts` uses `getPlatformSkillsDir(platform, scope)`. Keep `computeRuleDestPath()` resolving Codex rules through `rulesBaseDir: '.codex'`. Do not add `.codex/skills` as a second write destination.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run test/domains/skill/symlink-install.test.ts test/app/init-e2e.test.ts`

Expected: PASS, including preservation of unrelated `.agents/skills` entries.

- [ ] **Step 5: Commit**

```bash
git add domains/skill/platform-install.ts test/domains/skill/symlink-install.test.ts test/app/init-e2e.test.ts
git commit -m "fix(codex): install skills under agents directory"
```

### Task 3: Migrate update, doctor, inventory, and uninstall lifecycle behavior

**Files:**
- Modify: `platform/install/detect.ts`
- Modify: `domains/skill/find.ts`
- Modify: `domains/skill/uninstall.ts`
- Modify: `app/commands/update.ts`
- Modify: `app/commands/doctor.ts`
- Test: `test/domains/skill/skill-find.test.ts`
- Test: `test/app/update.test.ts`
- Test: `test/app/uninstall.test.ts`

**Interfaces:**
- Consumes: canonical `getPlatformSkillsDir()` and canonical-plus-legacy `getPlatformSkillsDirs()`.
- Produces: current Skill discovery from `.agents`; compatibility detection/removal from `.codex`; legacy-only doctor status that recommends update.

- [ ] **Step 1: Write failing lifecycle tests**

Add these concrete scenarios:

```ts
// update
// Given .codex/skills/comet/SKILL.md and .codex/skills/personal/SKILL.md,
// update creates .agents/skills/comet/SKILL.md, removes only legacy comet,
// and preserves legacy personal.

// uninstall
// Given managed comet entries in both roots and unrelated entries in both roots,
// uninstall removes only managed comet entries.

// inventory
// Given the same skill name in .agents and .codex,
// ordinary discovery returns the canonical .agents source rather than a duplicate.

// doctor
// Given only .codex/skills/comet, report a legacy installation requiring update;
// given .agents/skills/comet, report the current installation as healthy.
```

- [ ] **Step 2: Run focused lifecycle tests and verify RED**

Run: `npx vitest run test/domains/skill/skill-find.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/app/doctor.test.ts`

Expected: FAIL because the lifecycle currently treats `.codex` as canonical and has no Codex-specific legacy-only state.

- [ ] **Step 3: Implement canonical discovery and safe compatibility cleanup**

Change ordinary inventory to use only `getPlatformSkillsDir()` for Codex. Use `getPlatformSkillsDirs()` only in lifecycle compatibility scans. During update, write canonical content first and then invoke the existing manifest-driven managed removal logic against legacy roots; skip cleanup if canonical installation failed. During uninstall, iterate unique canonical and legacy roots. Preserve existing managed-entry checks and never recursively delete a root merely because it exists.

For doctor, calculate canonical and compatibility presence separately:

```ts
const canonicalPresent = await hasManagedCometSkill(canonicalRoot);
const legacyPresent = !canonicalPresent && (await hasManagedCometSkill(legacyRoot));
```

Report `legacyPresent` as actionable migration guidance rather than a healthy current install.

- [ ] **Step 4: Run focused lifecycle tests and verify GREEN**

Run: `npx vitest run test/domains/skill/skill-find.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/app/doctor.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/install/detect.ts domains/skill/find.ts domains/skill/uninstall.ts app/commands/update.ts app/commands/doctor.ts test/domains/skill/skill-find.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/app/doctor.test.ts
git commit -m "fix(codex): migrate legacy skill installations"
```

### Task 4: Update repository-wide Codex path expectations and release note

**Files:**
- Modify: Codex-specific fixtures and assertions under `test/domains/bundle/`, `test/domains/skill/`, and `test/app/`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: canonical `.agents/skills` contract from Tasks 1-3.
- Produces: repository-wide tests and user-facing release documentation consistent with the new contract.

- [ ] **Step 1: Find stale public-path expectations**

Run:

```bash
rg -n "\.codex[/\\]skills" app domains platform test assets README.md README-zh.md
```

Classify each match: change Codex user Skill fixtures to `.agents/skills`; retain `.codex/plugins/cache` and explicit legacy-migration fixtures.

- [ ] **Step 2: Update failing fixtures without changing unrelated platform semantics**

Replace Codex canonical fixture roots with `.agents/skills`. Label retained `.codex/skills` fixtures as legacy compatibility cases. Do not bulk-replace plugin cache, configuration, rules, or hook paths.

- [ ] **Step 3: Append the beta.4 changelog entry**

Under the existing `0.4.0-beta.4` `### Fixed` section add:

```markdown
- **Codex CLI Skill discovery**: Codex project and global installs now place Comet Skills in the current `.agents/skills` discovery directory while keeping Codex-specific configuration under `.codex`; update and uninstall safely migrate managed legacy `.codex/skills` installs without removing unrelated Skills.
```

- [ ] **Step 4: Run verification**

Run in order:

```bash
npx vitest run test/platform/detect.test.ts test/domains/skill/symlink-install.test.ts test/domains/skill/skill-find.test.ts test/app/init-e2e.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/app/doctor.test.ts
npx prettier --check platform/install/platforms.ts platform/install/detect.ts domains/skill/platform-install.ts domains/skill/find.ts domains/skill/uninstall.ts app/commands/update.ts app/commands/doctor.ts test/platform/detect.test.ts test/domains/skill/symlink-install.test.ts test/domains/skill/skill-find.test.ts test/app/init-e2e.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/app/doctor.test.ts CHANGELOG.md
npx eslint platform/install/platforms.ts platform/install/detect.ts domains/skill/platform-install.ts domains/skill/find.ts domains/skill/uninstall.ts app/commands/update.ts app/commands/doctor.ts
npx tsc --noEmit
npx vitest run
git diff --check
```

Expected: all commands exit 0; retained `.codex/skills` matches occur only in explicit legacy tests or migration code.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md app domains platform test
git commit -m "test(codex): cover current skill installation paths"
```
