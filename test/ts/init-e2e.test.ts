import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  checkbox: vi.fn(),
}));

const manifestPath = path.resolve('assets', 'manifest.json');

async function readManifest() {
  return JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
}

function mockExternalSuccess() {
  mockedExecFileSync.mockImplementation((command: unknown, args?: unknown, opts?: unknown) => {
    const cmd = String(command);
    const cmdArgs = Array.isArray(args) ? args.map((arg) => String(arg)) : [];

    if (
      (cmd === 'npx' || cmd === 'npx.cmd') &&
      cmdArgs[0] === 'skills' &&
      cmdArgs.includes('--agent') &&
      cmdArgs.includes('claude-code')
    ) {
      const cwd = (opts as { cwd?: string } | undefined)?.cwd ?? os.tmpdir();
      const stagedSkillsDir = path.join(cwd, '.claude', 'skills', 'comet');
      mkdirSync(stagedSkillsDir, { recursive: true });
      writeFileSync(path.join(stagedSkillsDir, 'SKILL.md'), '# Lingma Comet\n');
      return Buffer.from('installed');
    }

    if ((cmd === 'which' || cmd === 'where') && cmdArgs[0] === 'openspec') {
      return Buffer.from('/usr/bin/openspec');
    }
    if (cmd === 'openspec' && cmdArgs[0] === 'init') {
      return Buffer.from('ok');
    }
    if ((cmd === 'npx' || cmd === 'npx.cmd') && cmdArgs[0] === 'skills') {
      return Buffer.from('installed');
    }
    return Buffer.from('');
  });
}

async function captureJsonOutput(fn: () => Promise<void>): Promise<Record<string, unknown>> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = vi.fn((...args: unknown[]) => lines.push(String(args[0])));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return JSON.parse(lines.join('\n'));
}

describe('comet init E2E', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-init-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
    vi.resetAllMocks();
    vi.resetModules();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('installs Comet skills at project scope with --yes --json', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    const { initCommand } = await import('../../src/commands/init.js');
    const result = await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));

    expect(result.projectPath).toBe(tmpDir);
    expect(result.scope).toBe('project');
    expect(result.language).toBe('en');
    expect(result.selectedPlatforms).toContain('claude');
    expect(result.workingDirsCreated).toBe(true);

    const claudeResult = (result.results as { platform: string; comet: string }[]).find(
      (r) => r.platform === 'claude',
    );
    expect(claudeResult?.comet).toBe('installed');

    const manifest = await readManifest();
    for (const skillPath of manifest.skills) {
      const dest = path.join(tmpDir, '.claude', 'skills', skillPath);
      await expect(fs.access(dest)).resolves.toBeUndefined();
    }

    await expect(fs.stat(path.join(tmpDir, 'docs', 'superpowers', 'specs'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(tmpDir, 'docs', 'superpowers', 'plans'))).resolves.toBeDefined();
  }, 20_000);

  it('installs Comet skills at global scope', async () => {
    mockExternalSuccess();

    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(fakeHome, { recursive: true });

    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const { initCommand } = await import('../../src/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
    );

    expect(result.scope).toBe('global');
    expect(result.workingDirsCreated).toBe(false);

    const manifest = await readManifest();
    for (const skillPath of manifest.skills) {
      const dest = path.join(fakeHome, '.claude', 'skills', skillPath);
      await expect(fs.access(dest)).resolves.toBeUndefined();
    }

    await expect(fs.stat(path.join(tmpDir, 'docs', 'superpowers', 'specs'))).rejects.toThrow();
  }, 20_000);

  it('skips already-installed Comet skills with --yes', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    const { initCommand } = await import('../../src/commands/init.js');
    const result1 = await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));
    const claude1 = (result1.results as { platform: string; comet: string }[]).find(
      (r) => r.platform === 'claude',
    );
    expect(claude1?.comet).toBe('installed');

    vi.resetModules();
    vi.resetAllMocks();
    mockExternalSuccess();

    const { initCommand: init2 } = await import('../../src/commands/init.js');
    const result2 = await captureJsonOutput(() => init2(tmpDir, { yes: true, json: true }));
    const claude2 = (result2.results as { platform: string; comet: string }[]).find(
      (r) => r.platform === 'claude',
    );
    expect(claude2?.comet).toBe('skipped');
  }, 20_000);

  it('overwrites existing Comet skills with --overwrite', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    const { initCommand } = await import('../../src/commands/init.js');
    await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));

    vi.resetModules();
    vi.resetAllMocks();
    mockExternalSuccess();

    const { initCommand: init2 } = await import('../../src/commands/init.js');
    const result = await captureJsonOutput(() =>
      init2(tmpDir, { yes: true, overwrite: true, json: true }),
    );
    const claude = (result.results as { platform: string; comet: string }[]).find(
      (r) => r.platform === 'claude',
    );
    expect(claude?.comet).toBe('installed');
  }, 20_000);

  it('installs all platforms from clean directory with --yes', async () => {
    mockExternalSuccess();

    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(fakeHome, { recursive: true });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    try {
      const { initCommand } = await import('../../src/commands/init.js');
      const result = await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));

      expect((result.results as unknown[]).length).toBeGreaterThanOrEqual(29);

      const manifest = await readManifest();
      const platformDirs = [
        '.claude',
        '.cursor',
        '.codex',
        '.opencode',
        '.windsurf',
        '.cline',
        '.roo',
        '.continue',
        '.gemini',
        '.amazonq',
        '.qwen',
        '.kilocode',
        '.augment',
        '.kiro',
        '.kimi-code',
        '.lingma',
        '.junie',
        '.codebuddy',
        '.cospec',
        '.crush',
        '.factory',
        '.iflow',
        '.pi',
        '.qoder',
        '.agents',
        '.bob',
        '.forge',
        '.trae',
        '.github',
      ];
      for (const platform of platformDirs) {
        for (const skillPath of manifest.skills) {
          const dest = path.join(tmpDir, platform, 'skills', skillPath);
          await expect(fs.access(dest)).resolves.toBeUndefined();
        }
      }

      await expect(
        fs.access(path.join(tmpDir, '.opencode', 'commands', 'comet-open.md')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(tmpDir, '.pi', 'extensions', 'comet-commands.ts')),
      ).resolves.toBeUndefined();
    } finally {
      homedirSpy.mockRestore();
    }
  }, 20_000);

  it('installs Antigravity Comet skills to the Gemini global skills directory', async () => {
    mockExternalSuccess();

    await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(fakeHome, { recursive: true });

    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const { initCommand } = await import('../../src/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
    );

    expect(result.selectedPlatforms).toEqual(['antigravity']);

    const manifest = await readManifest();
    for (const skillPath of manifest.skills) {
      const dest = path.join(fakeHome, '.gemini', 'antigravity', 'skills', skillPath);
      await expect(fs.access(dest)).resolves.toBeUndefined();
    }
  }, 20_000);

  it('installs OpenCode global Comet skills and commands to the OpenCode config directory', async () => {
    mockExternalSuccess();

    await fs.mkdir(path.join(tmpDir, '.opencode'), { recursive: true });
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(fakeHome, { recursive: true });

    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const { initCommand } = await import('../../src/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
    );

    expect(result.selectedPlatforms).toEqual(['opencode']);

    const manifest = await readManifest();
    for (const skillPath of manifest.skills) {
      const dest = path.join(fakeHome, '.config', 'opencode', 'skills', skillPath);
      await expect(fs.access(dest)).resolves.toBeUndefined();
    }

    await expect(
      fs.access(path.join(fakeHome, '.config', 'opencode', 'commands', 'comet.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(fakeHome, '.config', 'opencode', 'commands', 'comet-open.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(fakeHome, '.opencode', 'skills', 'comet', 'SKILL.md')),
    ).rejects.toThrow();
  }, 20_000);

  it('installs Pi global skills and commands to the Pi agent directory', async () => {
    mockExternalSuccess();

    await fs.mkdir(path.join(tmpDir, '.pi'), { recursive: true });
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(fakeHome, { recursive: true });

    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const { initCommand } = await import('../../src/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
    );

    expect(result.selectedPlatforms).toEqual(['pi']);

    await expect(
      fs.access(path.join(fakeHome, '.pi', 'agent', 'skills', 'comet', 'SKILL.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(fakeHome, '.pi', 'agent', 'extensions', 'comet-commands.ts')),
    ).resolves.toBeUndefined();
    await expect(
      fs.readFile(path.join(fakeHome, '.pi', 'agent', 'settings.json'), 'utf-8'),
    ).resolves.toContain('"enableSkillCommands": true');
    await expect(
      fs.access(path.join(fakeHome, '.pi', 'skills', 'comet', 'SKILL.md')),
    ).rejects.toThrow();
  }, 20_000);

  it('installs Lingma global Comet skills to the user Lingma skills directory', async () => {
    mockExternalSuccess();

    await fs.mkdir(path.join(tmpDir, '.lingma'), { recursive: true });
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(fakeHome, { recursive: true });

    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const { initCommand } = await import('../../src/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
    );

    expect(result.selectedPlatforms).toEqual(['lingma']);

    const manifest = await readManifest();
    for (const skillPath of manifest.skills) {
      const dest = path.join(fakeHome, '.lingma', 'skills', skillPath);
      await expect(fs.access(dest)).resolves.toBeUndefined();
    }

    await expect(
      fs.access(path.join(tmpDir, '.lingma', 'skills', 'comet', 'SKILL.md')),
    ).rejects.toThrow();
  }, 20_000);

  it('installs Kimi Code global Comet skills to the user Kimi Code skills directory', async () => {
    mockExternalSuccess();

    await fs.mkdir(path.join(tmpDir, '.kimi-code'), { recursive: true });
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(fakeHome, { recursive: true });

    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const { initCommand } = await import('../../src/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
    );

    expect(result.selectedPlatforms).toEqual(['kimicode']);

    const manifest = await readManifest();
    for (const skillPath of manifest.skills) {
      const dest = path.join(fakeHome, '.kimi-code', 'skills', skillPath);
      await expect(fs.access(dest)).resolves.toBeUndefined();
    }

    await expect(
      fs.access(path.join(tmpDir, '.kimi-code', 'skills', 'comet', 'SKILL.md')),
    ).rejects.toThrow();
  }, 20_000);
});
