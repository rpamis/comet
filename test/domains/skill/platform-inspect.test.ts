import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
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
} from '../../../domains/skill/platform-install.js';
import { removeCometHooksForPlatform } from '../../../domains/skill/uninstall.js';
import { PLATFORMS, type Platform } from '../../../platform/install/platforms.js';

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
    case 'amazon-q':
      return path.join(baseDir, '.amazonq', 'settings.local.json');
    case 'qwen':
      return path.join(baseDir, '.qwen', 'settings.json');
    case 'qoder':
      return path.join(baseDir, '.qoder', 'settings.json');
    case 'codebuddy':
      return path.join(baseDir, '.codebuddy', 'settings.json');
    case 'gemini':
      return path.join(baseDir, '.gemini', 'settings.json');
    case 'windsurf':
      return path.join(baseDir, '.windsurf', 'hooks.json');
    case 'github-copilot':
      return path.join(baseDir, '.github', 'hooks', 'comet-guard.json');
    case 'kiro':
      return path.join(baseDir, '.kiro', 'hooks', 'comet-hook-router.kiro.hook');
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
    ['github-copilot', '.github/instructions/comet-workflow-guard.instructions.md'],
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

  it.each(['claude', 'cursor', 'codex', 'github-copilot'])(
    'replaces both legacy %s Rules with one unified Rule while preserving user files',
    async (id) => {
      const target = platform(id);
      const legacy = getLegacyPlatformRuleDestinations(tmpDir, target, 'project');
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

  it.each([
    'claude',
    'codex',
    'amazon-q',
    'qwen',
    'qoder',
    'codebuddy',
    'gemini',
    'windsurf',
    'github-copilot',
    'kiro',
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

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
    });
    expect(await fs.readFile(configPath, 'utf8')).toBe(before);
  });

  it.each([
    'claude',
    'codex',
    'amazon-q',
    'qwen',
    'qoder',
    'codebuddy',
    'gemini',
    'windsurf',
    'github-copilot',
    'kiro',
  ])('removes only the managed %s Router while preserving user configuration', async (id) => {
    const target = platform(id);
    const configPath = hookConfigPath(tmpDir, id);
    if (id === 'kiro' || id === 'github-copilot') {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        path.join(path.dirname(configPath), id === 'kiro' ? 'personal.kiro.hook' : 'personal.json'),
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

  it.each([
    'claude',
    'codex',
    'amazon-q',
    'qwen',
    'qoder',
    'codebuddy',
    'gemini',
    'windsurf',
    'github-copilot',
    'kiro',
  ])('does not accept an unmanaged command in an existing %s Hook config', async (id) => {
    const target = platform(id);
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, id);
    const unmanaged = (await fs.readFile(configPath, 'utf8')).replaceAll(
      'comet-hook-router',
      'user-hook',
    );
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
    'gemini',
    'windsurf',
    'github-copilot',
    'kiro',
  ])('migrates a legacy managed %s Hook command to one Router', async (id) => {
    const target = platform(id);
    await installManagedHookScripts(tmpDir, target);
    await installCometHooksForPlatform(tmpDir, target, 'project');
    const configPath = hookConfigPath(tmpDir, id);
    const legacy = (await fs.readFile(configPath, 'utf8')).replaceAll(
      'comet/scripts/comet-hook-router.mjs',
      'comet-native/scripts/comet-native-hook-guard.mjs',
    );
    await fs.writeFile(configPath, legacy);

    await expect(installCometHooksForPlatform(tmpDir, target, 'project')).resolves.toMatchObject({
      status: 'installed',
    });
    const migrated = await fs.readFile(configPath, 'utf8');
    expect(migrated).toContain('comet-hook-router.mjs');
    expect(migrated).not.toContain('comet-native-hook-guard.mjs');
    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: true,
    });
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
    const legacy = (await fs.readFile(configPath, 'utf8')).replaceAll(
      'comet-hook-router.mjs',
      'comet-hook-router.sh',
    );
    await fs.writeFile(configPath, legacy, 'utf8');

    await expect(inspectCometHooksForPlatform(tmpDir, target, 'project')).resolves.toEqual({
      present: false,
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
