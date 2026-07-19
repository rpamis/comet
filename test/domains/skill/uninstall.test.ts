import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { PLATFORMS } from '../../../platform/install/platforms.js';
import { installCometHooksForPlatform } from '../../../domains/skill/platform-install.js';
import { removeCometHooksForPlatform } from '../../../domains/skill/uninstall.js';

describe('removeCometHooksForPlatform', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-uninstall-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('ignores malformed historical Codex hooks after canonical cleanup succeeds', async () => {
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
    const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
    const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
    const malformedLegacy = '{\n  "hooks": {\n';

    await installCometHooksForPlatform(tmpDir, codex, 'project');
    await fs.writeFile(legacyPath, malformedLegacy, 'utf8');

    await expect(removeCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
      removed: 1,
      failed: 0,
    });

    const cleanedCanonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
    expect(cleanedCanonical.hooks.PreToolUse[0].hooks).toEqual([]);
    await expect(fs.readFile(legacyPath, 'utf8')).resolves.toBe(malformedLegacy);
  });

  it('ignores unreadable historical Codex hook paths after canonical cleanup succeeds', async () => {
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
    const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');

    await installCometHooksForPlatform(tmpDir, codex, 'project');
    await fs.mkdir(legacyPath, { recursive: true });

    await expect(removeCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
      removed: 1,
      failed: 0,
    });
  });

  it.each([
    { id: 'qwen', configPath: ['.qwen', 'settings.json'] },
    { id: 'gemini', configPath: ['.gemini', 'settings.json'] },
    { id: 'windsurf', configPath: ['.windsurf', 'hooks.json'] },
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

  it('keeps unreadable historical Codex Hook access best-effort after canonical cleanup', async () => {
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
        failed: 0,
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
});
