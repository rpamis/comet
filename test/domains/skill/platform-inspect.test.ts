import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  getPlatformRuleDestinations,
  getLegacyPlatformRuleDestinations,
  inspectCometHooksForPlatform,
} from '../../../domains/skill/platform-inspect.js';
import {
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  matchesZcodeRouterInvocation,
} from '../../../domains/skill/platform-install.js';
import {
  removeCometHooksForPlatform,
  removeCometRulesForPlatform,
} from '../../../domains/skill/uninstall.js';
import {
  buildNodeHookCommand,
  readNodeHookArguments,
} from '../../../platform/process/hook-command.js';
import { PLATFORMS, type Platform } from '../../../platform/install/platforms.js';

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return { ...original, existsSync: vi.fn(original.existsSync) };
});

function mapHookConfigStrings(value: unknown, map: (value: string) => string): unknown {
  if (typeof value === 'string') return map(value);
  if (Array.isArray(value)) return value.map((entry) => mapHookConfigStrings(entry, map));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, mapHookConfigStrings(entry, map)]),
    );
  return value;
}

function replaceHookArgument(config: string, from: string, to: string): string {
  const replace = (value: string) =>
    value.replaceAll(from, to).replaceAll(from.replaceAll('/', '\\'), to.replaceAll('/', '\\'));
  return JSON.stringify(
    mapHookConfigStrings(JSON.parse(config), (value) => {
      const args = readNodeHookArguments(value);
      return args ? buildNodeHookCommand(args.map(replace)) : replace(value);
    }),
  );
}

function readableHookConfig(config: string): string {
  return JSON.stringify(
    mapHookConfigStrings(JSON.parse(config), (value) => {
      const args = readNodeHookArguments(value);
      return args ? args.join(' ') : value;
    }),
  );
}

function platform(id: string): Platform {
  const found = PLATFORMS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing platform fixture: ${id}`);
  return found;
}

function hookConfigPath(baseDir: string, platformId: string): string {
  switch (platformId) {
    case 'claude':
      return path.join(baseDir, '.claude', 'settings.local.json');
    case 'codex':
      return path.join(baseDir, '.codex', 'hooks.json');
    case 'grok':
      return path.join(baseDir, '.grok', 'hooks', 'comet.json');
    case 'amazon-q':
      return path.join(baseDir, '.amazonq', 'settings.local.json');
    case 'qwen':
      return path.join(baseDir, '.qwen', 'settings.json');
    case 'qoder':
      return path.join(baseDir, '.qoder', 'settings.json');
    case 'codebuddy':
      return path.join(baseDir, '.codebuddy', 'settings.json');
    case 'workbuddy':
      return path.join(baseDir, '.workbuddy', 'settings.json');
    case 'gemini':
      return path.join(baseDir, '.gemini', 'settings.json');
    case 'windsurf':
      return path.join(baseDir, '.devin', 'hooks.json');
    case 'trae':
    case 'trae-cn':
      return path.join(baseDir, '.trae', 'hooks.json');
    case 'github-copilot':
      return path.join(baseDir, '.github', 'hooks', 'comet-guard.json');
    case 'kiro':
      return path.join(baseDir, '.kiro', 'hooks', 'comet-hook-router.kiro.hook');
    case 'oh-my-pi':
      return path.join(baseDir, '.omp', 'hooks', 'pre', 'comet-hook-router.ts');
    case 'dsh':
      return path.join(baseDir, '.dsh', 'hooks.json');
    case 'zcode':
      return path.join(baseDir, '.zcode', 'config.json');
    default:
      throw new Error(`missing Hook path fixture: ${platformId}`);
  }
}

async function installManagedHookScripts(
  baseDir: string,
  target: Platform,
  _workflow: 'classic' | 'native' = 'classic',
): Promise<void> {
  const manifest = JSON.parse(
    await fs.readFile(path.resolve('assets', 'manifest.json'), 'utf8'),
  ) as { hooks?: Record<string, unknown> };
  const hooks = manifest.hooks;
  for (const scriptRelPath of Object.keys(hooks ?? {})) {
    const scriptPath = path.join(baseDir, target.skillsDir, 'skills', ...scriptRelPath.split('/'));
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, '// managed Hook script\n', 'utf8');
  }
}

describe('platform component inspection', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-platform-inspect-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it.each([
    ['claude', '.claude/rules/comet-workflow-guard.md'],
    ['cursor', '.cursor/rules/comet-workflow-guard.mdc'],
    ['codex', '.codex/rules/comet-workflow-guard.md'],
    ['grok', '.grok/rules/comet-workflow-guard.md'],
    ['github-copilot', '.github/instructions/comet-workflow-guard.instructions.md'],
    ['oh-my-pi', '.omp/rules/comet-workflow-guard.mdc'],
    ['dsh', 'AGENTS.local.md'],
  ])(
    'returns the normalized language-independent Rule destination for %s',
    async (id, relative) => {
      const destinations = await getPlatformRuleDestinations(tmpDir, platform(id), 'project');

      expect(destinations).toEqual([path.join(tmpDir, ...relative.split('/'))]);
      expect(await fs.readdir(tmpDir)).toEqual([]);
    },
  );

  it('returns no Rule destinations for an unsupported platform without changing disk', async () => {
    await expect(
      getPlatformRuleDestinations(tmpDir, platform('gemini'), 'project'),
    ).resolves.toEqual([]);
    expect(await fs.readdir(tmpDir)).toEqual([]);
  });

  it.each(['claude', 'cursor', 'codex', 'github-copilot', 'oh-my-pi'])(
    'replaces both legacy %s Rules with one unified Rule while preserving user files',
    async (id) => {
      const target = platform(id);
      const legacy = await getLegacyPlatformRuleDestinations(tmpDir, target, 'project');
      const current = await getPlatformRuleDestinations(tmpDir, target, 'project');
      expect(legacy).toHaveLength(2);
      expect(current).toHaveLength(1);
      await fs.mkdir(path.dirname(legacy[0]), { recursive: true });
      await Promise.all(legacy.map((file) => fs.writeFile(file, '# Legacy\n')));
      const userRule = path.join(path.dirname(legacy[0]), 'personal-rule.md');
      await fs.writeFile(userRule, '# Personal\n');

      await expect(
        copyCometRulesForPlatform(tmpDir, target, true, 'zh', 'project', 'both'),
      ).resolves.toMatchObject({ failed: 0 });

      await expect(fs.access(current[0])).resolves.toBeUndefined();
      for (const file of legacy) {
        await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      }
      await expect(fs.readFile(userRule, 'utf8')).resolves.toBe('# Personal\n');
    },
  );

  it('recognizes and migrates legacy Windsurf Rules under the Devin-compatible platform', async () => {
    const target = platform('windsurf');
    const legacyTarget: Platform = {
      ...target,
      skillsDir: '.windsurf',
      globalSkillsDir: '.windsurf',
      legacySkillsDirs: undefined,
    };

    await expect(
      copyCometRulesForPlatform(tmpDir, legacyTarget, true, 'en', 'project', 'classic'),
    ).resolves.toMatchObject({ failed: 0 });
    await expect(
      fs.access(path.join(tmpDir, '.windsurf', 'rules', 'comet-workflow-guard.md')),
    ).resolves.toBeUndefined();

    const legacyDestinations = await getLegacyPlatformRuleDestinations(tmpDir, target, 'project');
    expect(legacyDestinations).toContain(
      path.join(tmpDir, '.windsurf', 'rules', 'comet-workflow-guard.md'),
    );

    await expect(removeCometRulesForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      removed: 1,
      failed: 0,
    });
    await expect(
      fs.access(path.join(tmpDir, '.windsurf', 'rules', 'comet-workflow-guard.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    await copyCometRulesForPlatform(tmpDir, legacyTarget, true, 'en', 'project', 'classic');

    await expect(
      copyCometRulesForPlatform(tmpDir, target, true, 'en', 'project', 'classic'),
    ).resolves.toMatchObject({ failed: 0 });
    await expect(
      fs.access(path.join(tmpDir, '.devin', 'rules', 'comet-workflow-guard.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmpDir, '.windsurf', 'rules', 'comet-workflow-guard.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    await copyCometRulesForPlatform(tmpDir, target, true, 'en', 'project', 'classic');
    await expect(removeCometRulesForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      removed: 1,
      failed: 0,
    });
    await expect(
      fs.access(path.join(tmpDir, '.devin', 'rules', 'comet-workflow-guard.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    'claude',
    'codex',
    'amazon-q',
    'qwen',
    'qoder',
    'codebuddy',
    'workbuddy',
    'gemini',
    'windsurf',
    'trae',
    'trae-cn',
    'github-copilot',
    'kiro',
    'oh-my-pi',
    'grok',
    'zcode',
  ])('recognizes the managed Hook command in the %s format', async (id) => {
    const target = platform(id);
    await installManagedHookScripts(tmpDir, target);
    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'installed',
    });
    const configPath = hookConfigPath(tmpDir, id);
    const before = await fs.readFile(configPath, 'utf8');
    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'installed',
    });

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject(
      id === 'zcode'
        ? { present: false, managedPresent: true, activationRequired: true }
        : { present: true },
    );
    expect(await fs.readFile(configPath, 'utf8')).toBe(before);
  });

  it('reports a ZCode Hook as managed but dormant while the runner is disabled', async () => {
    const target = platform('zcode');
    await installManagedHookScripts(tmpDir, target);
    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'installed',
    });

    const configPath = hookConfigPath(tmpDir, 'zcode');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.hooks.events.PreToolUse[0].hooks[0].enabled = true;
    config.hooks.enabled = false;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
      managedPresent: true,
      activationRequired: true,
      activationMessage: expect.stringContaining('Manually enable'),
    });

    config.hooks.enabled = true;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
    });
  });

  it.each([undefined, true, false])(
    'preserves the ZCode project Router when its enabled field is %s',
    async (enabled) => {
      const target = platform('zcode');
      await installManagedHookScripts(tmpDir, target);
      const configPath = hookConfigPath(tmpDir, 'zcode');
      const router = {
        type: 'process',
        command: 'node',
        args: [
          path.join(tmpDir, '.zcode', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs'),
          '--platform',
          'zcode',
          '--project-root',
          tmpDir,
        ],
        timeoutMs: 60_000,
        ...(enabled === undefined ? {} : { enabled }),
      };
      const config = {
        hooks: {
          enabled: true,
          events: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [router] }] },
        },
      };
      const source = JSON.stringify(config);
      await fs.writeFile(configPath, source, 'utf8');

      await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
        status: 'installed',
      });
      expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual({
        ...config,
        cometRouterProjectRoot: tmpDir,
      });
      await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject(
        enabled === false ? { present: false, activationRequired: true } : { present: true },
      );
    },
  );

  it.each(['dedicated', 'shared'])(
    'keeps the ZCode project Router in place in a %s group',
    async (layout) => {
      const target = platform('zcode');
      const install = () => installCometHooksForPlatform(tmpDir, target, 'project');
      await installManagedHookScripts(tmpDir, target);
      await expect(install()).resolves.toEqual({ status: 'installed' });

      const configPath = hookConfigPath(tmpDir, 'zcode');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      const [routerGroup] = config.hooks.events.PreToolUse;
      const [router] = routerGroup.hooks;
      const userHook = (script: string) => ({ type: 'process', command: 'node', args: [script] });
      const readGroup = { matcher: 'Read', hooks: [userHook('read.mjs')] };
      const writeGroup = { matcher: 'Write|Edit', hooks: [userHook('write.mjs')] };
      config.hooks.events.PreToolUse =
        layout === 'dedicated'
          ? [routerGroup, writeGroup]
          : [
              readGroup,
              {
                ...routerGroup,
                hooks: [userHook('before.mjs'), router, userHook('after.mjs')],
              },
              writeGroup,
            ];
      const source = JSON.stringify(config);
      await fs.writeFile(configPath, source, 'utf8');

      await expect(install()).resolves.toEqual({ status: 'installed' });
      await expect.soft(fs.readFile(configPath, 'utf8')).resolves.toBe(source);

      router.timeoutMs = 1_000;
      await fs.writeFile(configPath, JSON.stringify(config), 'utf8');
      router.timeoutMs = 60_000;
      await expect(install()).resolves.toEqual({ status: 'installed' });
      expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual(config);
    },
  );

  it('matches moved ZCode project Routers without probing the old script', () => {
    const skillsDir = '.zcode';
    const routerPath = 'skills/comet/scripts/comet-hook-router.mjs';
    const previousRoot = path.join(tmpDir, 'old');
    const args = (root: string) => [
      path.join(root, skillsDir, routerPath),
      '--platform',
      'zcode',
      '--project-root',
      root,
    ];
    const previous = { type: 'process', command: 'node', args: args(previousRoot) };
    const current = { command: 'node', args: args(tmpDir) };
    const probe = vi.mocked(existsSync);
    probe.mockClear();
    probe.withImplementation(
      () => false,
      () => {
        expect(matchesZcodeRouterInvocation(previous, current, skillsDir, previousRoot)).toBe(true);
        expect(matchesZcodeRouterInvocation(previous, current, skillsDir, tmpDir)).toBe(false);
        expect(probe).not.toHaveBeenCalled();
      },
    );
  });

  it('ignores user-owned ZCode process Hooks during inspection, install, and uninstall', async () => {
    const target = platform('zcode');
    const configPath = hookConfigPath(tmpDir, 'zcode');
    const routerPath = path.join(
      tmpDir,
      '.zcode',
      'skills',
      'comet',
      'scripts',
      'comet-hook-router.mjs',
    );
    const router = {
      type: 'process',
      command: 'node',
      args: [routerPath, '--platform', 'zcode', '--project-root', tmpDir],
    };
    const userHooks = [
      {
        ...router,
        args: [path.join(tmpDir, 'tools', 'comet-hook-router.mjs'), ...router.args.slice(1)],
      },
      { ...router, args: [routerPath.replace('.zcode', '.other'), ...router.args.slice(1)] },
      { ...router, args: [...router.args, '--custom'] },
      { ...router, args: router.args.slice(0, 3) },
      {
        ...router,
        args: [routerPath, '--platform', 'zcode', '--project-root', path.join(tmpDir, 'other')],
      },
      { ...router, type: 'command' },
    ];
    const userGroup = { matcher: 'Write|Edit', hooks: userHooks };
    const config = { hooks: { enabled: true, events: { PreToolUse: [userGroup] } } };
    await installManagedHookScripts(tmpDir, target);
    await fs.writeFile(configPath, JSON.stringify(config), 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
    });
    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      status: 'installed',
    });
    const installed = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const groups = installed.hooks.events.PreToolUse;
    expect(groups[0]).toEqual(userGroup);
    expect(groups[1].hooks[0].enabled).toBe(false);

    groups[1].hooks = [{ ...router, enabled: false }, router];
    groups.push({ matcher: 'Read', hooks: [{ ...router, enabled: true }] });
    await fs.writeFile(configPath, JSON.stringify(installed), 'utf8');
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
      duplicatePresent: true,
    });
    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      status: 'installed',
    });
    const repaired = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(repaired.hooks.events.PreToolUse).toEqual([
      userGroup,
      { matcher: 'Write|Edit', hooks: [{ ...router, timeoutMs: 60_000 }] },
    ]);
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
    });
    await expect(removeCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      removed: 1,
      failed: 0,
    });
    expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual(config);
  });

  it('reports dsh Hook config as awaiting the profile bridge', async () => {
    const target = platform('dsh');
    await installManagedHookScripts(tmpDir, target);
    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'installed',
      reason: expect.stringContaining('--patch .dsh/cordis.patch.yml'),
    });

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      present: true,
      activationRequired: true,
    });
  });

  it.each([
    'claude',
    'codex',
    'amazon-q',
    'qwen',
    'qoder',
    'codebuddy',
    'workbuddy',
    'gemini',
    'windsurf',
    'trae',
    'trae-cn',
    'github-copilot',
    'kiro',
    'oh-my-pi',
    'grok',
  ])('removes only the managed %s Router while preserving user configuration', async (id) => {
    const target = platform(id);
    const configPath = hookConfigPath(tmpDir, id);
    if (id === 'kiro' || id === 'github-copilot' || id === 'oh-my-pi' || id === 'grok') {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        path.join(
          path.dirname(configPath),
          id === 'kiro'
            ? 'personal.kiro.hook'
            : id === 'oh-my-pi' || id === 'grok'
              ? id === 'grok'
                ? 'personal.json'
                : 'personal.ts'
              : 'personal.json',
        ),
        '{"userSetting":"keep"}\n',
      );
    } else {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, '{"userSetting":"keep"}\n');
    }

    await installManagedHookScripts(tmpDir, target);
    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'installed',
    });
    await expect(removeCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      removed: 1,
      failed: 0,
    });
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
    });

    const preservedPath =
      id === 'kiro'
        ? path.join(path.dirname(configPath), 'personal.kiro.hook')
        : id === 'github-copilot'
          ? path.join(path.dirname(configPath), 'personal.json')
          : id === 'oh-my-pi'
            ? path.join(path.dirname(configPath), 'personal.ts')
            : id === 'grok'
              ? path.join(path.dirname(configPath), 'personal.json')
              : configPath;
    expect(await fs.readFile(preservedPath, 'utf8')).toContain('userSetting');
  });

  it('recognizes the structured Native Copilot Hook command', async () => {
    const target = platform('github-copilot');
    await installManagedHookScripts(tmpDir, target, 'native');
    await installCometHooksForPlatform(tmpDir, target, 'project', 'native');

    await expect(
      inspectCometHooksForPlatform(tmpDir, target, 'project', 'native'),
    ).resolves.toEqual({ present: true });
  });

  it('reports duplicate managed Router commands', async () => {
    const target = platform('claude');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, 'claude');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.hooks.PreToolUse[0].hooks.push({ ...config.hooks.PreToolUse[0].hooks[0] });
    await fs.writeFile(configPath, JSON.stringify(config), 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
      duplicatePresent: true,
    });
  });

  it('reports a structurally mismatched extra grouped Router as a duplicate', async () => {
    const target = platform('claude');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, target.id);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const duplicate = structuredClone(config.hooks.PreToolUse[0]);
    duplicate.matcher = 'Read';
    config.hooks.PreToolUse.push(duplicate);
    await fs.writeFile(configPath, JSON.stringify(config), 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
      duplicatePresent: true,
    });
  });

  it('installs the Grok Hook matcher that covers write and search_replace', async () => {
    const target = platform('grok');
    await installManagedHookScripts(tmpDir, target);
    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'installed',
    });
    const config = JSON.parse(await fs.readFile(hookConfigPath(tmpDir, 'grok'), 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    expect(config.hooks.PreToolUse[0]?.matcher).toBe('Write|Edit|write|search_replace');
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
    });
  });

  it.each([
    ['codex', 'matcher'],
    ['codex', 'type'],
    ['qwen', 'matcher'],
    ['gemini', 'matcher'],
  ] as const)('rejects a structurally mismatched %s grouped Hook (%s)', async (id, field) => {
    const target = platform(id);
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, id);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const groupName = id === 'gemini' ? 'BeforeTool' : 'PreToolUse';
    const group = config.hooks[groupName][0];
    if (field === 'matcher') group.matcher = 'Read';
    else group.hooks[0].type = 'prompt';
    await fs.writeFile(configPath, JSON.stringify(config), 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
      managedPresent: true,
    });
  });

  it.each(['matcher', 'powershell'] as const)(
    'rejects a structurally mismatched Copilot Hook (%s)',
    async (field) => {
      const target = platform('github-copilot');
      await installManagedHookScripts(tmpDir, target);
      await installCometHooksForPlatform(tmpDir, target, 'project');
      const configPath = hookConfigPath(tmpDir, target.id);
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      const entry = config.hooks.preToolUse[0];
      if (field === 'matcher') entry.matcher = '*';
      else delete entry.powershell;
      await fs.writeFile(configPath, JSON.stringify(config), 'utf8');

      await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
        present: false,
        managedPresent: true,
      });
    },
  );

  it('reports a structurally mismatched extra Copilot Router as a duplicate', async () => {
    const target = platform('github-copilot');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, target.id);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const duplicate = { ...config.hooks.preToolUse[0], matcher: '*' };
    config.hooks.preToolUse.push(duplicate);
    await fs.writeFile(configPath, JSON.stringify(config), 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
      duplicatePresent: true,
    });
  });

  it('reports an invalid legacy Kiro Hook instead of treating the Router as healthy', async () => {
    const target = platform('kiro');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    await fs.writeFile(
      path.join(tmpDir, '.kiro', 'hooks', 'comet-hook-guard.kiro.hook'),
      '{not-json',
      'utf8',
    );

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
      error: expect.stringContaining('Invalid Hook JSON'),
    });
  });

  it.each(['enabled', 'when-type', 'tool-name', 'then-type'] as const)(
    'rejects a structurally mismatched Kiro Hook (%s)',
    async (field) => {
      const target = platform('kiro');
      await installManagedHookScripts(tmpDir, target);
      await installCometHooksForPlatform(tmpDir, target, 'project');
      const configPath = hookConfigPath(tmpDir, target.id);
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      if (field === 'enabled') config.enabled = false;
      if (field === 'when-type') config.when.type = 'postToolUse';
      if (field === 'tool-name') config.when.toolName = 'read';
      if (field === 'then-type') config.then.type = 'askAgent';
      await fs.writeFile(configPath, JSON.stringify(config), 'utf8');

      await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
        present: false,
        managedPresent: true,
      });
    },
  );

  it('rejects a Windsurf Router whose output contract is disabled', async () => {
    const target = platform('windsurf');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, target.id);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.hooks.pre_write_code[0].show_output = false;
    await fs.writeFile(configPath, JSON.stringify(config), 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
      managedPresent: true,
    });
  });

  it('reports a managed Codex Hook in the legacy settings file', async () => {
    const target = platform('codex');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const canonicalPath = hookConfigPath(tmpDir, target.id);
    const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
    await fs.copyFile(canonicalPath, legacyPath);

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
      legacyPresent: true,
    });
  });

  it('recognizes, migrates, and removes legacy Windsurf Hooks under .windsurf', async () => {
    const target = platform('windsurf');
    const legacyTarget: Platform = {
      ...target,
      skillsDir: '.windsurf',
      globalSkillsDir: '.windsurf',
      legacySkillsDirs: undefined,
    };

    await expect(installCometHooksForPlatform(tmpDir, legacyTarget, 'project')).resolves.toEqual({
      status: 'installed',
    });
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
      managedPresent: true,
      legacyPresent: true,
    });

    await expect(removeCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      removed: 1,
      failed: 0,
    });
    const removedLegacyHooks = JSON.parse(
      await fs.readFile(path.join(tmpDir, '.windsurf', 'hooks.json'), 'utf8'),
    ) as { hooks?: { pre_write_code?: Array<{ command?: string }> } };
    expect(removedLegacyHooks.hooks?.pre_write_code ?? []).toHaveLength(0);

    await installCometHooksForPlatform(tmpDir, legacyTarget, 'project');

    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      status: 'installed',
    });
    const legacyHooks = JSON.parse(
      await fs.readFile(path.join(tmpDir, '.windsurf', 'hooks.json'), 'utf8'),
    ) as { hooks?: { pre_write_code?: Array<{ command?: string }> } };
    expect(legacyHooks.hooks?.pre_write_code ?? []).toHaveLength(0);

    await expect(removeCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      removed: 1,
      failed: 0,
    });
    await expect(fs.access(path.join(tmpDir, '.windsurf', 'hooks.json'))).resolves.toBeUndefined();
    const remainingLegacyHooks = JSON.parse(
      await fs.readFile(path.join(tmpDir, '.windsurf', 'hooks.json'), 'utf8'),
    ) as { hooks?: { pre_write_code?: Array<{ command?: string }> } };
    expect(remainingLegacyHooks.hooks?.pre_write_code ?? []).toHaveLength(0);
  });

  it('reports invalid Codex legacy Hook JSON even when the canonical Router is current', async () => {
    const target = platform('codex');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
    await fs.writeFile(legacyPath, '{not-json', 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      present: false,
      error: expect.stringContaining('settings.local.json'),
    });
  });

  it.each([
    'claude',
    'codex',
    'amazon-q',
    'qwen',
    'qoder',
    'codebuddy',
    'workbuddy',
    'gemini',
    'windsurf',
    'github-copilot',
    'kiro',
    'grok',
  ])('does not accept an unmanaged command in an existing %s Hook config', async (id) => {
    const target = platform(id);
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, id);
    const unmanaged = replaceHookArgument(
      await fs.readFile(configPath, 'utf8'),
      'comet-hook-router',
      'user-hook',
    );
    expect(unmanaged).not.toBe(await fs.readFile(configPath, 'utf8'));
    expect(readableHookConfig(unmanaged)).toContain('user-hook');
    await fs.writeFile(configPath, unmanaged);

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
    });
    expect(await fs.readFile(configPath, 'utf8')).toBe(unmanaged);
  });

  it.each([
    'claude',
    'codex',
    'amazon-q',
    'qwen',
    'qoder',
    'codebuddy',
    'workbuddy',
    'gemini',
    'windsurf',
    'github-copilot',
    'kiro',
    'grok',
  ])('migrates a legacy managed %s Hook command to one Router', async (id) => {
    const target = platform(id);
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, id);
    const legacy = replaceHookArgument(
      await fs.readFile(configPath, 'utf8'),
      'comet/scripts/comet-hook-router.mjs',
      'comet-native/scripts/comet-native-hook-guard.mjs',
    );
    expect(readableHookConfig(legacy)).toContain('comet-native-hook-guard.mjs');
    await fs.writeFile(configPath, legacy);

    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'installed',
    });
    const migrated = readableHookConfig(await fs.readFile(configPath, 'utf8'));
    expect(migrated).toContain('comet-hook-router.mjs');
    expect(migrated).not.toContain('comet-native-hook-guard.mjs');
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
    });
  });

  it('recognizes a literal legacy shell command as managed but requiring repair', async () => {
    const target = platform('codex');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, target.id);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const handler = config.hooks.PreToolUse[0].hooks[0];
    const args = readNodeHookArguments(handler.command);
    expect(args).not.toBeNull();
    handler.command = `node ${args!.map((arg) => JSON.stringify(arg.replaceAll('\\', '/'))).join(' ')}`;
    await fs.writeFile(configPath, JSON.stringify(config));
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
      managedPresent: true,
    });
    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'installed',
    });
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
    });
  });

  it('preserves an encoded command with appended user code during uninstall', async () => {
    const target = platform('codex');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, target.id);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const handler = config.hooks.PreToolUse[0].hooks[0];
    handler.command += '; echo user-owned';
    await fs.writeFile(configPath, JSON.stringify(config));
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
    });
    await expect(removeCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      removed: 0,
      failed: 0,
    });
    expect(
      JSON.parse(await fs.readFile(configPath, 'utf8')).hooks.PreToolUse[0].hooks[0].command,
    ).toBe(handler.command);
  });

  it('returns a parse error for malformed canonical Hook JSON without rewriting it', async () => {
    const configPath = hookConfigPath(tmpDir, 'claude');
    const malformed = '{\r\n  "hooks": {\r\n';
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, malformed);

    const result = await inspectCometHooksForPlatform(tmpDir, platform('claude'), 'project');

    expect(result.present).toBe(false);
    expect(result.error).toContain('Invalid Hook JSON');
    expect(await fs.readFile(configPath, 'utf8')).toBe(malformed);
  });

  it('does not overwrite or remove a user-owned Oh My Pi Hook at the Comet path', async () => {
    const target = platform('oh-my-pi');
    const hookPath = hookConfigPath(tmpDir, target.id);
    const userSource = 'export default function userHook() {}\n';
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, userSource, 'utf8');

    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('user-owned'),
    });
    await expect(removeCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      removed: 0,
      failed: 0,
    });
    await expect(fs.readFile(hookPath, 'utf8')).resolves.toBe(userSource);
  });

  it('does not report a current Hook healthy when its manifest-owned script is missing', async () => {
    const target = platform('claude');
    await installCometHooksForPlatform(tmpDir, target, 'project');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      present: false,
      error: expect.stringContaining('script'),
    });
  });

  it('does not accept a legacy .sh command as the current manifest Hook', async () => {
    const target = platform('claude');
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, 'claude');
    const legacy = replaceHookArgument(
      await fs.readFile(configPath, 'utf8'),
      'comet-hook-router.mjs',
      'comet-hook-router.sh',
    );
    await fs.writeFile(configPath, legacy, 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
      managedPresent: true,
    });
  });

  it('returns an error for an unreadable canonical Hook path without changing it', async () => {
    const configPath = hookConfigPath(tmpDir, 'claude');
    await fs.mkdir(configPath, { recursive: true });

    const result = await inspectCometHooksForPlatform(tmpDir, platform('claude'), 'project');

    expect(result.present).toBe(false);
    expect(result.error).toBeDefined();
    expect((await fs.stat(configPath)).isDirectory()).toBe(true);
  });

  it('does not create a missing Hook config or report unsupported Hooks as present', async () => {
    await expect(
      inspectCometHooksForPlatform(tmpDir, platform('claude'), 'project'),
    ).resolves.toEqual({ present: false });
    await expect(
      inspectCometHooksForPlatform(tmpDir, platform('cursor'), 'project'),
    ).resolves.toEqual({ present: false });
    expect(await fs.readdir(tmpDir)).toEqual([]);
  });
});
