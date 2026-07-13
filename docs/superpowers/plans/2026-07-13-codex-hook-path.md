# Codex Hook Path Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project and global Codex installs use `.codex/hooks.json`, safely migrate Comet-managed hooks from the historical `.codex/settings.local.json`, and keep every non-Comet setting intact.

**Architecture:** Keep `hookFormat` responsible for JSON schema and add platform metadata for the current and historical hook filenames. Installation, removal, and Bundle planning consume that metadata so Codex no longer needs scattered platform-ID special cases; the command stored in the hook continues to target `.agents/skills` independently of the `.codex` config root.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Vitest, Prettier, ESLint, pnpm build scripts.

## Global Constraints

- Project and global Codex hook files are respectively `<repo>/.codex/hooks.json` and `~/.codex/hooks.json`.
- Codex Skill scripts remain under `.agents/skills`; Codex config, rules, and hooks remain under `.codex`.
- Migration removes only handlers whose command resolves to a manifest-owned Comet hook script.
- User fields, third-party events, matcher groups, and handlers must remain unchanged.
- Invalid historical JSON must remain byte-for-byte unchanged and must not prevent the canonical hook file from being installed.
- Claude Code, Amazon Q, and all other platform hook destinations must remain unchanged.
- Do not alter the hook matcher, phase-guard runtime, or hook output protocol.
- Because `0.4.0-beta.4` is already the latest release tag, bump the project release metadata to `0.4.0-beta.5` and add one English user-facing `Fixed` bullet in a new `0.4.0-beta.5` Changelog section.
- Do not comment on GitHub, open a pull request, or push without explicit user approval.

---

## File Map

- `platform/install/platforms.ts`: owns platform hook filename metadata and Codex values.
- `domains/skill/platform-install.ts`: installs canonical hook JSON and performs post-write legacy cleanup.
- `domains/skill/uninstall.ts`: removes Comet handlers from canonical and historical hook files.
- `domains/bundle/bundle-platform.ts`: resolves Bundle hook destinations from platform metadata.
- `test/platform/detect.test.ts`: locks the Codex platform metadata contract.
- `test/domains/skill/skills.test.ts`: covers project/global installation, migration, idempotence, and malformed legacy JSON.
- `test/app/init-e2e.test.ts`: verifies the real project init path.
- `test/app/update.test.ts`: verifies the real update migration path.
- `test/app/uninstall.test.ts`: verifies canonical plus legacy cleanup through the uninstall helper.
- `test/domains/bundle/bundle-platform.test.ts`: verifies the Codex Bundle destination.
- `package.json`, `package-lock.json`, and `assets/manifest.json`: keep the next prerelease version synchronized at `0.4.0-beta.5`.
- `test/app/cli-help.test.ts`: locks package, lockfile, and shipped manifest versions to the same release.
- `CHANGELOG.md`: records the final user-visible fix under `0.4.0-beta.5`.

### Task 1: Model the Codex hook destination and use it in Bundle planning

**Files:**
- Modify: `platform/install/platforms.ts`
- Modify: `domains/bundle/bundle-platform.ts`
- Test: `test/platform/detect.test.ts`
- Test: `test/domains/bundle/bundle-platform.test.ts`

**Interfaces:**
- Produces: `Platform.hookConfigFile?: string`, `Platform.legacyHookConfigFiles?: string[]`, and `PlatformBundleLayout.configRoot: string`.
- Consumes: existing `Platform.hookFormat` and `BundlePlatformTarget.platform`.
- Invariant: missing `hookConfigFile` preserves the existing destination selected from `hookFormat`.

- [ ] **Step 1: Add failing platform metadata assertions**

In the existing Codex platform test in `test/platform/detect.test.ts`, add:

```ts
expect(codex?.hookConfigFile).toBe('hooks.json');
expect(codex?.legacyHookConfigFiles).toEqual(['settings.local.json']);
```

- [ ] **Step 2: Add a failing Codex Bundle destination test**

In `test/domains/bundle/bundle-platform.test.ts`, add this test beside the existing native rules/hooks test:

```ts
it('plans Codex hooks in .codex/hooks.json while scripts remain under .agents', async () => {
  const codex = targets.find((target) => target.id === 'codex')!;

  const report = await compileBundleForPlatform(ir(), codex, {
    projectRoot,
    scope: 'project',
    locale: 'zh',
  });

  expect(report.executableDisclosures).toEqual([
    expect.objectContaining({
      id: 'protect-write',
      destination: path.join(projectRoot, '.codex', 'hooks.json'),
      command: expect.stringContaining(path.join('.agents', 'skills')),
    }),
  ]);
});
```

- [ ] **Step 3: Run the two tests and verify RED**

Run:

```bash
npx vitest run test/platform/detect.test.ts test/domains/bundle/bundle-platform.test.ts
```

Expected: failures show missing `hookConfigFile` / `legacyHookConfigFiles` and the actual Codex destination ending in `.codex/settings.local.json`.

- [ ] **Step 4: Add hook path metadata to `Platform` and Codex**

Add these fields after `hookFormat` in `platform/install/platforms.ts`:

```ts
  /** Hook config filename relative to the platform config root when it differs from the format default. */
  hookConfigFile?: string;
  /** Historical hook config filenames checked during migration and uninstall. */
  legacyHookConfigFiles?: string[];
```

Add these values to the Codex platform entry:

```ts
    hookConfigFile: 'hooks.json',
    legacyHookConfigFiles: ['settings.local.json'],
```

- [ ] **Step 5: Make Bundle planning honor the override**

Import `getPlatformConfigDir` beside `getPlatformSkillsDir`, add this required field to `PlatformBundleLayout`:

```ts
  configRoot: string;
```

Populate it inside `listBundlePlatformTargets()`:

```ts
        configRoot: path.join(baseDir, getPlatformConfigDir(platform, options.scope)),
```

Then replace the first line of `hookDestination()` with:

```ts
  const platformRoot = target.layout.configRoot;
  if (target.platform.hookConfigFile) {
    return path.join(platformRoot, target.platform.hookConfigFile);
  }
```

Keep the existing switch unchanged so every platform without an override retains its current filename under its config root. The explicit `configRoot` is necessary for Codex because its Skill root is `.agents` while its Hook root is `.codex`.

- [ ] **Step 6: Run the tests and verify GREEN**

Run:

```bash
npx vitest run test/platform/detect.test.ts test/domains/bundle/bundle-platform.test.ts
```

Expected: both test files pass, including Claude Code still targeting `.claude/settings.local.json`.

- [ ] **Step 7: Commit the metadata and Bundle slice**

```bash
git add platform/install/platforms.ts domains/bundle/bundle-platform.ts test/platform/detect.test.ts test/domains/bundle/bundle-platform.test.ts
git commit -m "fix(codex): route hooks to hooks.json"
```

### Task 2: Install canonical Codex hooks and migrate the historical file

**Files:**
- Modify: `domains/skill/platform-install.ts`
- Test: `test/domains/skill/skills.test.ts`
- Test: `test/app/init-e2e.test.ts`
- Test: `test/app/update.test.ts`

**Interfaces:**
- Consumes: `Platform.hookConfigFile` and `Platform.legacyHookConfigFiles` from Task 1.
- Produces: exported `removeManagedHooksFromJsonFile(settingsPath: string, scriptRelPaths: string[]): Promise<{ removed: number; failed: number }>` for Task 3.
- Preserves: `installCometHooksForPlatform(...): Promise<{ installed: boolean; reason?: string }>`.

- [ ] **Step 1: Add failing project and global install tests**

In `test/domains/skill/skills.test.ts`, add:

```ts
it.each([
  { scope: 'project' as const, baseDir: () => tmpDir },
  { scope: 'global' as const, baseDir: () => path.join(tmpDir, 'home') },
])('writes $scope Codex hooks to .codex/hooks.json', async ({ scope, baseDir }) => {
  const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
  const root = baseDir();

  await expect(installCometHooksForPlatform(root, codex, scope)).resolves.toEqual({
    installed: true,
  });

  const hooks = JSON.parse(
    await fs.readFile(path.join(root, '.codex', 'hooks.json'), 'utf-8'),
  );
  expect(hooks.hooks.PreToolUse[0].hooks[0].command.replaceAll('\\', '/')).toContain(
    '/.agents/skills/comet/scripts/comet-hook-guard.mjs',
  );
  await expect(
    fs.access(path.join(root, '.codex', 'settings.local.json')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
```

- [ ] **Step 2: Add failing migration and malformed-legacy tests**

Add to the same describe block:

```ts
it('migrates only Comet hooks from the historical Codex settings file', async () => {
  const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
  const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
  const legacy = {
    model: 'gpt-5',
    hooks: {
      PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo post' }] }],
      PreToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [
            { type: 'command', command: staleCometCommand },
            { type: 'command', command: 'node my-user-hook.mjs' },
          ],
        },
      ],
    },
  };
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  await fs.writeFile(legacyPath, JSON.stringify(legacy, null, 2), 'utf-8');

  await installCometHooksForPlatform(tmpDir, codex, 'project');

  const migrated = JSON.parse(await fs.readFile(legacyPath, 'utf-8'));
  expect(migrated.model).toBe('gpt-5');
  expect(migrated.hooks.PostToolUse).toEqual(legacy.hooks.PostToolUse);
  expect(migrated.hooks.PreToolUse[0].hooks).toEqual([
    { type: 'command', command: 'node my-user-hook.mjs' },
  ]);
  await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).resolves.toBeUndefined();
});

it('installs canonical Codex hooks without changing invalid historical JSON', async () => {
  const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
  const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
  const invalid = '{\r\n  "hooks": {\r\n';
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  await fs.writeFile(legacyPath, invalid, 'utf-8');

  await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
    installed: true,
  });

  await expect(fs.readFile(legacyPath, 'utf-8')).resolves.toBe(invalid);
  await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).resolves.toBeUndefined();
});
```

- [ ] **Step 3: Update the init and update expectations to RED**

In `test/app/init-e2e.test.ts`, change the Codex E2E test to read `.codex/hooks.json` and assert `.codex/settings.local.json` does not exist.

In `test/app/update.test.ts`, before `updateCommand`, seed the historical file with:

```ts
const legacyHookPath = path.join(tmpDir, '.codex', 'settings.local.json');
await fs.mkdir(path.dirname(legacyHookPath), { recursive: true });
await fs.writeFile(
  legacyHookPath,
  JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Write|Edit',
            hooks: [
              {
                type: 'command',
                command: 'node .codex/skills/comet/scripts/comet-hook-guard.mjs',
              },
              { type: 'command', command: 'node my-user-hook.mjs' },
            ],
          },
        ],
      },
    },
    null,
    2,
  ),
  'utf8',
);
```

Run `updateCommand`, then assert:

```ts
const hooks = JSON.parse(await fs.readFile(path.join(tmpDir, '.codex', 'hooks.json'), 'utf8'));
expect(hooks.hooks.PreToolUse[0].hooks[0].command.replaceAll('\\', '/')).toContain(
  '/.agents/skills/comet/scripts/comet-hook-guard.mjs',
);
const legacy = JSON.parse(
  await fs.readFile(path.join(tmpDir, '.codex', 'settings.local.json'), 'utf8'),
);
expect(legacy.hooks.PreToolUse[0].hooks).toEqual([
  { type: 'command', command: 'node my-user-hook.mjs' },
]);
```

- [ ] **Step 4: Run installation lifecycle tests and verify RED**

Run:

```bash
npx vitest run test/domains/skill/skills.test.ts test/app/init-e2e.test.ts test/app/update.test.ts
```

Expected: Codex tests fail because the implementation still writes `.codex/settings.local.json`; existing non-Codex tests remain green.

- [ ] **Step 5: Add a reusable managed-handler removal helper**

In `domains/skill/platform-install.ts`, add this helper after `asHookGroup()` and export it at the bottom of the file:

```ts
async function removeManagedHooksFromJsonFile(
  settingsPath: string,
  scriptRelPaths: string[],
): Promise<{ removed: number; failed: number }> {
  if (!(await fileExists(settingsPath))) return { removed: 0, failed: 0 };

  let settings: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await readFile(settingsPath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { removed: 0, failed: 1 };
    }
    settings = parsed as Record<string, unknown>;
  } catch {
    return { removed: 0, failed: 1 };
  }

  const existingHooks = settings.hooks as Record<string, unknown> | undefined;
  const existingPreToolUse = existingHooks?.PreToolUse;
  if (!existingHooks || !Array.isArray(existingPreToolUse)) {
    return { removed: 0, failed: 0 };
  }

  let removed = 0;
  const filtered = existingPreToolUse.map((group) => {
    if (!group || typeof group !== 'object') return group;
    const record = group as Record<string, unknown>;
    if (!Array.isArray(record.hooks)) return record;
    const handlers = record.hooks.filter((handler) => {
      const command =
        handler && typeof handler === 'object'
          ? (handler as Record<string, unknown>).command
          : undefined;
      const managed = isManagedHookCommand(command, scriptRelPaths);
      if (managed) removed++;
      return !managed;
    });
    return { ...record, hooks: handlers };
  });

  if (removed === 0) return { removed: 0, failed: 0 };
  existingHooks.PreToolUse = filtered;
  settings.hooks = existingHooks;
  try {
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  } catch {
    return { removed: 0, failed: 1 };
  }
  return { removed, failed: 0 };
}
```

The helper must preserve every matcher group and all group-level fields. When the last managed
handler is removed, it writes `hooks: []`; non-object handlers such as `null` are preserved as-is.
If one file cannot be written, the helper reports `{ removed: 0, failed: 1 }` because no removal was
persisted. Installation keeps the successfully written canonical file and does not fail solely
because historical cleanup could not be written.

Add the existing regression `keeps canonical Codex hook installation successful when legacy
cleanup cannot be written`: mock the historical write failure, assert installation still returns
`{ installed: true }`, and verify the historical bytes are unchanged.

Add `removeManagedHooksFromJsonFile` to the existing export block.

- [ ] **Step 6: Route Claude-shaped installation through the configured filename**

Change the `claude-code` branch in `installCometHooksForPlatform()` to:

```ts
      case 'claude-code': {
        const result = await installClaudeCodeHooks(
          baseDir,
          platformBase,
          skillsDir,
          hooksConfig,
          platform.hookConfigFile ?? 'settings.local.json',
          Boolean(platform.hookConfigFile),
        );
        if (result.installed) {
          for (const legacyFile of platform.legacyHookConfigFiles ?? []) {
            await removeManagedHooksFromJsonFile(
              path.join(platformBase, legacyFile),
              Object.keys(hooksConfig),
            );
          }
        }
        return result;
      }
```

Extend `installClaudeCodeHooks()` with `configFile: string` and `strictJson: boolean`, resolve `settingsPath` with `configFile`, and read current settings with:

```ts
  let settings: Record<string, unknown> = {};
  if (await fileExists(settingsPath)) {
    if (strictJson) {
      settings = await readSettingsJsonObject(settingsPath, 'codex');
    } else {
      try {
        settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        settings = {};
      }
    }
  }
```

This keeps legacy Claude/Amazon Q parsing behavior unchanged while ensuring an invalid canonical Codex `hooks.json` is never overwritten.

- [ ] **Step 7: Run installation lifecycle tests and verify GREEN**

Run:

```bash
npx vitest run test/domains/skill/skills.test.ts test/app/init-e2e.test.ts test/app/update.test.ts
```

Expected: project/global Codex installs use `hooks.json`, update migrates only Comet handlers, malformed legacy content remains unchanged, and all three test files pass.

- [ ] **Step 8: Commit the installation migration slice**

```bash
git add domains/skill/platform-install.ts test/domains/skill/skills.test.ts test/app/init-e2e.test.ts test/app/update.test.ts
git commit -m "fix(codex): migrate hook configuration"
```

### Task 3: Remove Codex hooks from canonical and historical files

**Files:**
- Modify: `domains/skill/uninstall.ts`
- Test: `test/app/uninstall.test.ts`

**Interfaces:**
- Consumes: `removeManagedHooksFromJsonFile()` from Task 2 and `Platform.hookConfigFile` / `legacyHookConfigFiles` from Task 1.
- Produces: the existing `RemovalResult` with totals combined across all configured files.

- [ ] **Step 1: Replace the Codex uninstall test with a failing canonical-plus-legacy case**

In `test/app/uninstall.test.ts`, replace the current Codex hook removal test with:

```ts
it('removes Codex hooks from canonical and historical files while preserving user config', async () => {
  const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
  const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
  const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
  const userHandler = { type: 'command', command: 'node my-user-hook.mjs' };

  await installCometHooksForPlatform(tmpDir, codex, 'project');
  const canonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
  const cometHandler = canonical.hooks.PreToolUse[0].hooks[0];
  canonical.hooks.PreToolUse[0].hooks.push(userHandler);
  await fs.writeFile(canonicalPath, JSON.stringify(canonical, null, 2), 'utf8');
  await fs.writeFile(
    legacyPath,
    JSON.stringify(
      {
        model: 'gpt-5',
        hooks: {
          PreToolUse: [{ matcher: 'Write|Edit', hooks: [cometHandler, userHandler] }],
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const result = await removeCometHooksForPlatform(tmpDir, codex, 'project');

  expect(result).toEqual({ removed: 2, failed: 0 });
  const cleanedCanonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
  expect(cleanedCanonical.hooks.PreToolUse[0].hooks).toEqual([userHandler]);
  const cleanedLegacy = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
  expect(cleanedLegacy.model).toBe('gpt-5');
  expect(cleanedLegacy.hooks.PreToolUse[0].hooks).toEqual([userHandler]);
});
```

- [ ] **Step 2: Run the uninstall test and verify RED**

Run:

```bash
npx vitest run test/app/uninstall.test.ts
```

Expected: the Codex case fails because uninstall still inspects only `.codex/settings.local.json` through the Claude default.

- [ ] **Step 3: Reuse the shared removal helper for Claude-shaped formats**

Import `removeManagedHooksFromJsonFile` from `./platform-install.js`, then replace the `claude-code` switch branch in `removeCometHooksForPlatform()` with:

```ts
      case 'claude-code': {
        const files = [
          platform.hookConfigFile ?? 'settings.local.json',
          ...(platform.legacyHookConfigFiles ?? []),
        ];
        let removed = 0;
        let failed = 0;
        for (const file of new Set(files)) {
          const result = await removeManagedHooksFromJsonFile(
            path.join(platformBase, file),
            scriptRelPaths,
          );
          removed += result.removed;
          failed += result.failed;
        }
        return { removed, failed };
      }
```

Each helper call handles its own parse/write failure and returns a count, so the loop must continue
through every canonical and historical file and accumulate both successful removals and failures.

Add the existing regression `continues Codex cleanup across files and counts each write failure`:
seed canonical plus two historical files, fail two writes, and assert the third file is still
cleaned with the combined result `{ removed: 1, failed: 2 }`.

Delete `removeClaudeCodeHooks()` after confirming no remaining callers. Keep the other platform removal functions unchanged.

- [ ] **Step 4: Run uninstall and hook installation tests and verify GREEN**

Run:

```bash
npx vitest run test/app/uninstall.test.ts test/domains/skill/skills.test.ts
```

Expected: both files pass; Codex reports two removals while Claude Code still removes only `.claude/settings.local.json`. Per-file write failures are counted without stopping cleanup of later files.

- [ ] **Step 5: Commit the uninstall compatibility slice**

```bash
git add domains/skill/uninstall.ts test/app/uninstall.test.ts
git commit -m "fix(codex): clean legacy hook files"
```

### Task 4: Record the released behavior and run final verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `assets/manifest.json`
- Modify: `CHANGELOG.md`
- Modify: `test/app/cli-help.test.ts`
- Verify: all files changed by Tasks 1-3

**Interfaces:**
- Consumes: completed project/global installation, update migration, uninstall cleanup, and Bundle path behavior.
- Produces: synchronized `0.4.0-beta.5` release metadata, one final user-facing release note, and fresh verification evidence.

- [ ] **Step 1: Confirm release baseline before editing Changelog**

Run:

```bash
node -p "require('./package.json').version"
git show origin/master:package.json
git describe --tags --abbrev=0
git log 0.4.0-beta.4..HEAD --oneline
```

Expected: local and `origin/master` versions are `0.4.0-beta.4`, and the latest tag is `0.4.0-beta.4`. Because the candidate behavior is a user-visible fix after that published tag, the next release must be `0.4.0-beta.5` rather than modifying the beta.4 release record.

- [ ] **Step 2: Add a failing release-version consistency assertion**

Update the existing metadata assertions in `test/app/cli-help.test.ts` to expect `0.4.0-beta.5` from `package.json`, the lockfile top level, the lockfile root package, and `assets/manifest.json`. Then run:

```bash
npx vitest run test/app/cli-help.test.ts
```

Expected: the test fails because the shipped metadata still reports `0.4.0-beta.4`.

- [ ] **Step 3: Synchronize the next prerelease version**

Set only the project release versions to `0.4.0-beta.5`:

- `package.json` top-level `version`
- `package-lock.json` top-level `version`
- `package-lock.json` root package (`packages[""]`) `version`
- `assets/manifest.json` top-level `version`

Do not change dependency versions. Rerun:

```bash
npx vitest run test/app/cli-help.test.ts
```

Expected: the release-version consistency test passes.

- [ ] **Step 4: Add the Changelog entry**

Before the existing `0.4.0-beta.4` section, add a new release section:

```markdown
## What's Changed [0.4.0-beta.5] - 2026-07-13

### Fixed

- **Codex hook configuration**: Project and global Codex installs now write phase guard hooks to the supported `.codex/hooks.json` location and safely migrate Comet-managed entries from the previously generated `settings.local.json` without changing user-defined hooks or settings ([#199](https://github.com/rpamis/comet/issues/199)).
```

- [ ] **Step 5: Run focused regression tests**

Run:

```bash
npx vitest run test/platform/detect.test.ts test/domains/skill/skills.test.ts test/app/init-e2e.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/domains/bundle/bundle-platform.test.ts
```

Expected: all six test files pass with zero failed tests.

- [ ] **Step 6: Run repository-required checks**

Run each command separately and retain its exit code:

```bash
pnpm format:check
pnpm lint
pnpm build
npx vitest run
```

Expected: formatting, architecture lint/ESLint, TypeScript build, and full Vitest suite exit with code 0. If the default-parallel suite encounters the known shared `dist` race, capture the exact failure and rerun the full suite serially using the repository-supported Vitest worker option; report parallel and serialized evidence separately.

- [ ] **Step 7: Inspect the final diff and requirements**

Run:

```bash
git diff --check
git status --short
git diff --stat c224fbce
git diff c224fbce -- package.json package-lock.json assets/manifest.json platform/install/platforms.ts domains/skill/platform-install.ts domains/skill/uninstall.ts domains/bundle/bundle-platform.ts test/app/cli-help.test.ts CHANGELOG.md
```

Expected: no whitespace errors; only the approved hook path, migration, cleanup, synchronized beta.5 release metadata, tests, plan, and Changelog changes are present.

- [ ] **Step 8: Commit the release metadata and note**

```bash
git add package.json package-lock.json assets/manifest.json CHANGELOG.md test/app/cli-help.test.ts docs/superpowers/plans/2026-07-13-codex-hook-path.md
git commit -m "chore: bump version to 0.4.0-beta.5"
```

- [ ] **Step 9: Run post-commit verification before claiming completion**

Run:

```bash
git status --short
git log -4 --oneline
npx vitest run test/app/cli-help.test.ts
npx vitest run test/platform/detect.test.ts test/domains/skill/skills.test.ts test/app/init-e2e.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/domains/bundle/bundle-platform.test.ts
```

Expected: clean worktree, `0.4.0-beta.5` synchronized across all release metadata, the planned conventional commits at HEAD, and all focused regression tests passing.
