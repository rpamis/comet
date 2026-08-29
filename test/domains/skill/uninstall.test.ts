import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { PLATFORMS } from '../../../platform/install/platforms.js';
import {
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
} from '../../../domains/skill/platform-install.js';
import {
  removeCometHooksForPlatform,
  removeCometRulesForPlatform,
} from '../../../domains/skill/uninstall.js';

describe('removeCometHooksForPlatform', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-uninstall-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes an exec-form Claude Code Router while preserving user hooks', async () => {
    const claude = PLATFORMS.find((platform) => platform.id === 'claude')!;
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');

    await installCometHooksForPlatform(tmpDir, claude, 'project');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    settings.hooks.PreToolUse[0].hooks.unshift({
      type: 'command',
      command: 'node',
      args: ['D:/user-hooks/check.mjs'],
    });
    await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

    await expect(removeCometHooksForPlatform(tmpDir, claude, 'project')).resolves.toEqual({
      removed: 1,
      failed: 0,
    });

    const updated = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(updated.hooks.PreToolUse[0].hooks).toEqual([
      { type: 'command', command: 'node', args: ['D:/user-hooks/check.mjs'] },
    ]);
  });

  it('counts malformed historical Codex hooks after canonical cleanup succeeds', async () => {
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
    const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
    const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
    const malformedLegacy = '{\n  "hooks": {\n';

    await installCometHooksForPlatform(tmpDir, codex, 'project');
    await fs.writeFile(legacyPath, malformedLegacy, 'utf8');

    await expect(removeCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
      removed: 1,
      failed: 1,
    });

    const cleanedCanonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
    expect(cleanedCanonical.hooks.PreToolUse[0].hooks).toEqual([]);
    await expect(fs.readFile(legacyPath, 'utf8')).resolves.toBe(malformedLegacy);
  });

  it('removes only the dsh-managed instruction block and Hook patch row', async () => {
    const dsh = PLATFORMS.find((platform) => platform.id === 'dsh')!;
    const instructionPath = path.join(tmpDir, 'AGENTS.local.md');
    await fs.writeFile(instructionPath, '# User instructions\n', 'utf8');

    await copyCometRulesForPlatform(tmpDir, dsh, true, 'en', 'project', 'classic');
    await installCometHooksForPlatform(tmpDir, dsh, 'project', 'classic');

    const patchPath = path.join(tmpDir, '.dsh', 'cordis.patch.yml');
    const patch = await fs.readFile(patchPath, 'utf8');
    await fs.writeFile(
      patchPath,
      `${patch}- user-plugin: {}\n- dsh-hooks-claude-code:\n    configPath: ./.dsh/custom-hooks.json\n    projectDir: .\n`,
      'utf8',
    );

    const hookResult = await removeCometHooksForPlatform(tmpDir, dsh, 'project');
    expect(hookResult).toEqual({ removed: 2, failed: 0 });
    expect(await fs.readFile(patchPath, 'utf8')).toContain('user-plugin');
    expect(await fs.readFile(patchPath, 'utf8')).toContain('./.dsh/custom-hooks.json');

    await expect(removeCometRulesForPlatform(tmpDir, dsh, 'project')).resolves.toEqual({
      removed: 1,
      failed: 0,
    });
    await expect(fs.readFile(instructionPath, 'utf8')).resolves.toBe('# User instructions\n');
  });

  it('counts unreadable historical Codex hook paths after canonical cleanup succeeds', async () => {
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
    const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');

    await installCometHooksForPlatform(tmpDir, codex, 'project');
    await fs.mkdir(legacyPath, { recursive: true });

    await expect(removeCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
      removed: 1,
      failed: 1,
    });
  });

  it.each([
    { id: 'qwen', configPath: ['.qwen', 'settings.json'] },
    { id: 'gemini', configPath: ['.gemini', 'settings.json'] },
    { id: 'windsurf', configPath: ['.windsurf', 'hooks.json'] },
    { id: 'trae', configPath: ['.trae', 'hooks.json'] },
    { id: 'trae-cn', configPath: ['.trae', 'hooks.json'] },
  ])('fails closed when canonical $id Hook JSON is malformed', async ({ id, configPath }) => {
    const platform = PLATFORMS.find((candidate) => candidate.id === id)!;
    const settingsPath = path.join(tmpDir, ...configPath);
    const malformedSettings = '{\r\n  "hooks": {\r\n';
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, malformedSettings, 'utf8');

    await expect(removeCometHooksForPlatform(tmpDir, platform, 'project')).resolves.toEqual({
      removed: 0,
      failed: 1,
    });
    await expect(fs.readFile(settingsPath, 'utf8')).resolves.toBe(malformedSettings);
  });

  it.each([
    { id: 'qwen', configPath: ['.qwen', 'settings.json'] },
    { id: 'gemini', configPath: ['.gemini', 'settings.json'] },
    { id: 'windsurf', configPath: ['.windsurf', 'hooks.json'] },
    { id: 'trae', configPath: ['.trae', 'hooks.json'] },
    { id: 'trae-cn', configPath: ['.trae', 'hooks.json'] },
  ])('fails closed when canonical $id Hook JSON is an array', async ({ id, configPath }) => {
    const platform = PLATFORMS.find((candidate) => candidate.id === id)!;
    const settingsPath = path.join(tmpDir, ...configPath);
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, '[]\n', 'utf8');

    await expect(removeCometHooksForPlatform(tmpDir, platform, 'project')).resolves.toEqual({
      removed: 0,
      failed: 1,
    });
    await expect(fs.readFile(settingsPath, 'utf8')).resolves.toBe('[]\n');
  });

  it.each([
    { id: 'qwen', groupName: 'PreToolUse' },
    { id: 'gemini', groupName: 'BeforeTool' },
  ])(
    'preserves unknown $id group metadata after removing its last managed handler',
    async ({ id, groupName }) => {
      const platform = PLATFORMS.find((candidate) => candidate.id === id)!;
      const settingsPath = path.join(tmpDir, `.${id}`, 'settings.json');
      await installCometHooksForPlatform(tmpDir, platform, 'project');
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      settings.hooks[groupName][0].description = 'user-owned group metadata';
      settings.hooks[groupName][0].custom = { keep: true };
      await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

      await expect(removeCometHooksForPlatform(tmpDir, platform, 'project')).resolves.toEqual({
        removed: 1,
        failed: 0,
      });

      const updated = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      expect(updated.hooks[groupName]).toEqual([
        expect.objectContaining({
          description: 'user-owned group metadata',
          custom: { keep: true },
          hooks: [],
        }),
      ]);
    },
  );

  it.each([
    {
      id: 'claude',
      accessPath: ['.claude', 'settings.local.json'],
      snapshotPath: ['.claude', 'settings.local.json'],
    },
    {
      id: 'qwen',
      accessPath: ['.qwen', 'settings.json'],
      snapshotPath: ['.qwen', 'settings.json'],
    },
    {
      id: 'gemini',
      accessPath: ['.gemini', 'settings.json'],
      snapshotPath: ['.gemini', 'settings.json'],
    },
    {
      id: 'windsurf',
      accessPath: ['.windsurf', 'hooks.json'],
      snapshotPath: ['.windsurf', 'hooks.json'],
    },
    {
      id: 'trae',
      accessPath: ['.trae', 'hooks.json'],
      snapshotPath: ['.trae', 'hooks.json'],
    },
    {
      id: 'trae-cn',
      accessPath: ['.trae', 'hooks.json'],
      snapshotPath: ['.trae', 'hooks.json'],
    },
    {
      id: 'kiro',
      accessPath: ['.kiro', 'hooks'],
      snapshotPath: ['.kiro', 'hooks', 'comet-hook-router.kiro.hook'],
    },
  ])(
    'fails closed when canonical $id Hook configuration is unreadable',
    async ({ id, accessPath, snapshotPath }) => {
      const platform = PLATFORMS.find((candidate) => candidate.id === id)!;
      const blockedPath = path.join(tmpDir, ...accessPath);
      const preservedPath = path.join(tmpDir, ...snapshotPath);
      await installCometHooksForPlatform(tmpDir, platform, 'project');
      const before = await fs.readFile(preservedPath, 'utf8');
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const accessSpy =
        id === 'kiro'
          ? undefined
          : vi.spyOn(fs, 'access').mockImplementation(async (filePath) => {
              if (path.resolve(String(filePath)) === path.resolve(blockedPath)) {
                throw permissionError;
              }
            });
      const readdirSpy =
        id === 'kiro' ? vi.spyOn(fs, 'readdir').mockRejectedValue(permissionError) : undefined;

      try {
        await expect(removeCometHooksForPlatform(tmpDir, platform, 'project')).resolves.toEqual({
          removed: 0,
          failed: 1,
        });
      } finally {
        accessSpy?.mockRestore();
        readdirSpy?.mockRestore();
      }

      await expect(fs.readFile(preservedPath, 'utf8')).resolves.toBe(before);
    },
  );

  it('counts unreadable historical Codex Hook access after canonical cleanup', async () => {
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
    const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
    const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
    await installCometHooksForPlatform(tmpDir, codex, 'project');
    const canonicalSource = await fs.readFile(canonicalPath, 'utf8');
    await fs.writeFile(legacyPath, canonicalSource, 'utf8');
    const access = fs.access.bind(fs);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const accessSpy = vi.spyOn(fs, 'access').mockImplementation(async (filePath, mode) => {
      if (path.resolve(String(filePath)) === path.resolve(legacyPath)) throw permissionError;
      await access(filePath, mode);
    });

    try {
      await expect(removeCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        removed: 1,
        failed: 1,
      });
    } finally {
      accessSpy.mockRestore();
    }

    const cleanedCanonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
    expect(cleanedCanonical.hooks.PreToolUse[0].hooks).toEqual([]);
    await expect(fs.readFile(legacyPath, 'utf8')).resolves.toBe(canonicalSource);
  });

  it('reports a regular-file Kiro canonical hooks path without changing its content', async () => {
    const kiro = PLATFORMS.find((platform) => platform.id === 'kiro')!;
    const hooksPath = path.join(tmpDir, '.kiro', 'hooks');
    const content = 'user-owned regular file\n';
    await fs.mkdir(path.dirname(hooksPath), { recursive: true });
    await fs.writeFile(hooksPath, content, 'utf8');

    await expect(removeCometHooksForPlatform(tmpDir, kiro, 'project')).resolves.toEqual({
      removed: 0,
      failed: 1,
    });
    await expect(fs.readFile(hooksPath, 'utf8')).resolves.toBe(content);
  });

  it.each(['trae', 'trae-cn'])(
    'removes managed %s hooks while preserving user handlers and events',
    async (id) => {
      const platform = PLATFORMS.find((candidate) => candidate.id === id)!;
      const hooksPath = path.join(tmpDir, '.trae', 'hooks.json');
      await installCometHooksForPlatform(tmpDir, platform, 'project');
      const hooks = JSON.parse(await fs.readFile(hooksPath, 'utf8'));
      hooks.userSetting = 'keep';
      hooks.hooks.PostToolUse = [
        { matcher: 'Read', hooks: [{ type: 'command', command: 'echo post' }] },
      ];
      hooks.hooks.PreToolUse.unshift({
        matcher: 'Write|Edit',
        hooks: [{ type: 'command', command: 'echo user-write-check', timeout: 5 }],
      });
      await fs.writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, 'utf8');

      await expect(removeCometHooksForPlatform(tmpDir, platform, 'project')).resolves.toEqual({
        removed: 1,
        failed: 0,
      });

      const updated = JSON.parse(await fs.readFile(hooksPath, 'utf8'));
      expect(updated.userSetting).toBe('keep');
      expect(updated.hooks.PostToolUse).toEqual(hooks.hooks.PostToolUse);
      expect(updated.hooks.PreToolUse).toEqual([
        {
          matcher: 'Write|Edit',
          hooks: [{ type: 'command', command: 'echo user-write-check', timeout: 5 }],
        },
      ]);
    },
  );
});
