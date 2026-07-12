import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { getProjectRegistryPath } from '../../platform/install/project-registry.js';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  checkbox: vi.fn(),
}));

vi.mock('../../app/commands/platform-select-prompt.js', () => ({
  platformSelectPrompt: vi.fn(),
}));

vi.mock('../../platform/version/version.js', () => ({
  printVersionInfo: vi.fn(async (log: (message: string) => void) => {
    log('  Comet vtest');
    return {
      currentVersion: 'test',
      latestVersion: null,
      hasUpdate: false,
      checked: false,
    };
  }),
}));

vi.mock('../../app/cli/comet-banner.js', () => ({
  printCometBanner: vi.fn(async () => undefined),
}));

const manifestPath = path.resolve('assets', 'manifest.json');
const INIT_E2E_TIMEOUT_MS = 60_000;

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

async function captureTextOutput(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = vi.fn((...args: unknown[]) => lines.push(args.map(String).join(' ')));
  console.error = vi.fn((...args: unknown[]) => errors.push(args.map(String).join(' ')));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  return [...lines, ...errors].join('\n');
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
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(tmpDir, 'fake-home'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('enables the banner for text output and disables it for JSON output', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    const { printCometBanner } = await import('../../app/cli/comet-banner.js');
    const { initCommand } = await import('../../app/commands/init.js');

    await captureTextOutput(() => initCommand(tmpDir, { yes: true, language: 'en' }));
    expect(printCometBanner).toHaveBeenLastCalledWith({ enabled: true });

    await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));
    expect(printCometBanner).toHaveBeenLastCalledWith({ enabled: false });
  });

  it('waits for the banner before printing version info', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    let resolveBanner!: () => void;
    const bannerDone = new Promise<void>((resolve) => {
      resolveBanner = resolve;
    });
    const { printCometBanner } = await import('../../app/cli/comet-banner.js');
    const { printVersionInfo } = await import('../../platform/version/version.js');
    vi.mocked(printCometBanner).mockImplementationOnce(() => bannerDone);
    const { initCommand } = await import('../../app/commands/init.js');

    const initPromise = captureTextOutput(() => initCommand(tmpDir, { yes: true, language: 'en' }));
    await vi.waitFor(() => expect(printCometBanner).toHaveBeenCalledWith({ enabled: true }));
    expect(printVersionInfo).not.toHaveBeenCalled();

    resolveBanner();
    await initPromise;

    expect(vi.mocked(printCometBanner).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(printVersionInfo).mock.invocationCallOrder[0],
    );
  });

  it(
    'installs Comet skills at project scope with --yes --json',
    async () => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

      const { initCommand } = await import('../../app/commands/init.js');
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

      await expect(
        fs.stat(path.join(tmpDir, 'docs', 'superpowers', 'specs')),
      ).resolves.toBeDefined();
      await expect(
        fs.stat(path.join(tmpDir, 'docs', 'superpowers', 'plans')),
      ).resolves.toBeDefined();
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs Comet skills at global scope',
    async () => {
      mockExternalSuccess();

      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const { initCommand } = await import('../../app/commands/init.js');
      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
      );

      expect(result.scope).toBe('global');
      expect(result.workingDirsCreated).toBe(false);

      const config = await fs.readFile(path.join(fakeHome, '.comet', 'config.yaml'), 'utf-8');
      expect(config).toContain('language: en');

      const manifest = await readManifest();
      for (const skillPath of manifest.skills) {
        const dest = path.join(fakeHome, '.claude', 'skills', skillPath);
        await expect(fs.access(dest)).resolves.toBeUndefined();
      }

      await expect(fs.stat(path.join(tmpDir, 'docs', 'superpowers', 'specs'))).rejects.toThrow();
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs Codex skills under .agents while keeping phase rules under .codex',
    async () => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });

      const { initCommand } = await import('../../app/commands/init.js');
      const result = await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));

      expect(result.selectedPlatforms).toEqual(['codex']);
      await expect(
        fs.access(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(tmpDir, '.codex', 'skills', 'comet', 'SKILL.md')),
      ).rejects.toThrow();

      const ruleDest = path.join(tmpDir, '.codex', 'rules', 'comet-phase-guard.md');
      await expect(fs.access(ruleDest)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(tmpDir, '.agents', 'rules', 'comet-phase-guard.md')),
      ).rejects.toThrow();

      const settings = JSON.parse(
        await fs.readFile(path.join(tmpDir, '.codex', 'settings.local.json'), 'utf8'),
      );
      const hookCommand = settings.hooks.PreToolUse[0].hooks[0].command as string;
      expect(hookCommand.replaceAll('\\', '/')).toContain(
        '/.agents/skills/comet/scripts/comet-hook-guard.mjs',
      );
      await expect(
        fs.access(path.join(tmpDir, '.agents', 'settings.local.json')),
      ).rejects.toThrow();
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it('records project-scope Comet installs in the user project registry', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(fakeHome, { recursive: true });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    try {
      const { initCommand } = await import('../../app/commands/init.js');
      await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, scope: 'project', json: true, language: 'en' }),
      );
    } finally {
      homedirSpy.mockRestore();
    }

    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8'));
    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0]).toMatchObject({
      path: path.resolve(tmpDir),
      lastSource: 'init',
    });
    expect(registry.projects[0].lastTargets.length).toBeGreaterThan(0);
  });

  it('does not record global-scope installs in the user project registry', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-global');
    await fs.mkdir(fakeHome, { recursive: true });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    try {
      const { initCommand } = await import('../../app/commands/init.js');
      await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, scope: 'global', json: true, language: 'en' }),
      );
    } finally {
      homedirSpy.mockRestore();
    }

    await expect(fs.access(getProjectRegistryPath(fakeHome))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it(
    'skips already-installed Comet skills with --yes',
    async () => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

      const { initCommand } = await import('../../app/commands/init.js');
      const result1 = await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));
      const claude1 = (result1.results as { platform: string; comet: string }[]).find(
        (r) => r.platform === 'claude',
      );
      expect(claude1?.comet).toBe('installed');

      vi.resetModules();
      vi.resetAllMocks();
      vi.spyOn(os, 'homedir').mockReturnValue(path.join(tmpDir, 'fake-home'));
      mockExternalSuccess();

      const { initCommand: init2 } = await import('../../app/commands/init.js');
      const result2 = await captureJsonOutput(() => init2(tmpDir, { yes: true, json: true }));
      const claude2 = (result2.results as { platform: string; comet: string }[]).find(
        (r) => r.platform === 'claude',
      );
      expect(claude2?.comet).toBe('skipped');
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'overwrites existing Comet skills with --overwrite',
    async () => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

      const { initCommand } = await import('../../app/commands/init.js');
      await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));

      vi.resetModules();
      vi.resetAllMocks();
      vi.spyOn(os, 'homedir').mockReturnValue(path.join(tmpDir, 'fake-home'));
      mockExternalSuccess();

      const { initCommand: init2 } = await import('../../app/commands/init.js');
      const result = await captureJsonOutput(() =>
        init2(tmpDir, { yes: true, overwrite: true, json: true }),
      );
      const claude = (result.results as { platform: string; comet: string }[]).find(
        (r) => r.platform === 'claude',
      );
      expect(claude?.comet).toBe('installed');
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs all platforms from clean directory with --yes',
    async () => {
      mockExternalSuccess();

      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      try {
        const { initCommand } = await import('../../app/commands/init.js');
        const result = await captureJsonOutput(() =>
          initCommand(tmpDir, { yes: true, json: true }),
        );

        expect((result.results as unknown[]).length).toBeGreaterThanOrEqual(33);

        const manifest = await readManifest();
        const platformDirs = [
          '.claude',
          '.cursor',
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
          '.trae-cn',
          '.github',
          '.zcode',
          '.mimocode',
        ];
        for (const platform of platformDirs) {
          for (const skillPath of manifest.skills) {
            const dest = path.join(tmpDir, platform, 'skills', skillPath);
            await expect(fs.access(dest)).resolves.toBeUndefined();
          }
        }

        await expect(
          fs.access(path.join(tmpDir, '.codex', 'skills', 'comet', 'SKILL.md')),
        ).rejects.toThrow();

        await expect(
          fs.access(path.join(tmpDir, '.opencode', 'commands', 'comet-open.md')),
        ).resolves.toBeUndefined();
        await expect(
          fs.access(path.join(tmpDir, '.mimocode', 'commands', 'comet-open.md')),
        ).resolves.toBeUndefined();
        await expect(
          fs.access(path.join(tmpDir, '.pi', 'extensions', 'comet-commands.ts')),
        ).resolves.toBeUndefined();
      } finally {
        homedirSpy.mockRestore();
      }
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs Antigravity and Antigravity 2.0 Comet skills to their respective global skills directories',
    async () => {
      mockExternalSuccess();

      await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      try {
        const { initCommand } = await import('../../app/commands/init.js');
        const result = await captureJsonOutput(() =>
          initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
        );

        expect(result.selectedPlatforms).toEqual(['antigravity', 'antigravity2']);

        const manifest = await readManifest();
        for (const skillPath of manifest.skills) {
          const dest = path.join(fakeHome, '.gemini', 'antigravity', 'skills', skillPath);
          await expect(fs.access(dest)).resolves.toBeUndefined();

          const dest2 = path.join(fakeHome, '.gemini', 'config', 'skills', skillPath);
          await expect(fs.access(dest2)).resolves.toBeUndefined();
        }
      } finally {
        homedirSpy.mockRestore();
      }
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs OpenCode global Comet skills and commands to the OpenCode config directory',
    async () => {
      mockExternalSuccess();

      await fs.mkdir(path.join(tmpDir, '.opencode'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const { initCommand } = await import('../../app/commands/init.js');
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
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs MimoCode global Comet skills and commands to the MimoCode config directory',
    async () => {
      mockExternalSuccess();

      await fs.mkdir(path.join(tmpDir, '.mimocode'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const { initCommand } = await import('../../app/commands/init.js');
      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
      );

      expect(result.selectedPlatforms).toEqual(['mimocode']);

      const manifest = await readManifest();
      for (const skillPath of manifest.skills) {
        const dest = path.join(fakeHome, '.config', 'mimocode', 'skills', skillPath);
        await expect(fs.access(dest)).resolves.toBeUndefined();
      }

      await expect(
        fs.access(path.join(fakeHome, '.config', 'mimocode', 'commands', 'comet.md')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(fakeHome, '.config', 'mimocode', 'commands', 'comet-open.md')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(fakeHome, '.mimocode', 'skills', 'comet', 'SKILL.md')),
      ).rejects.toThrow();
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs Pi global skills and commands to the Pi agent directory',
    async () => {
      mockExternalSuccess();

      await fs.mkdir(path.join(tmpDir, '.pi'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const { initCommand } = await import('../../app/commands/init.js');
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
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs Lingma global Comet skills to the user Lingma skills directory',
    async () => {
      mockExternalSuccess();

      await fs.mkdir(path.join(tmpDir, '.lingma'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const { initCommand } = await import('../../app/commands/init.js');
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
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs Kimi Code global Comet skills to the user Kimi Code skills directory',
    async () => {
      mockExternalSuccess();

      await fs.mkdir(path.join(tmpDir, '.kimi-code'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const { initCommand } = await import('../../app/commands/init.js');
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
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs ZCode global Comet skills to the user ZCode skills directory',
    async () => {
      mockExternalSuccess();

      await fs.mkdir(path.join(tmpDir, '.zcode'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const { initCommand } = await import('../../app/commands/init.js');
      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, scope: 'global', json: true }),
      );

      expect(result.selectedPlatforms).toEqual(['zcode']);

      const manifest = await readManifest();
      for (const skillPath of manifest.skills) {
        const dest = path.join(fakeHome, '.zcode', 'skills', skillPath);
        await expect(fs.access(dest)).resolves.toBeUndefined();
      }

      // Comet rules are distributed to the platform rules directory, but only
      // the selected language's variant (default init selects English here) —
      // not every language variant listed in the manifest.
      const ruleDest = path.join(fakeHome, '.zcode', 'rules', 'comet-phase-guard.md');
      await expect(fs.access(ruleDest)).resolves.toBeUndefined();
      const ruleContent = await fs.readFile(ruleDest, 'utf-8');
      expect(ruleContent).toContain('Comet Phase Awareness');

      await expect(
        fs.access(path.join(fakeHome, '.zcode', 'rules', 'comet-phase-guard.en.md')),
      ).rejects.toThrow();

      await expect(
        fs.access(path.join(tmpDir, '.zcode', 'skills', 'comet', 'SKILL.md')),
      ).rejects.toThrow();
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'installs only the zh Comet rule variant when initialized with language zh',
    async () => {
      mockExternalSuccess();

      await fs.mkdir(path.join(tmpDir, '.zcode'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const { initCommand } = await import('../../app/commands/init.js');
      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, scope: 'global', json: true, language: 'zh' }),
      );

      expect(result.selectedPlatforms).toEqual(['zcode']);

      const config = await fs.readFile(path.join(fakeHome, '.comet', 'config.yaml'), 'utf-8');
      expect(config).toContain('language: zh-CN');

      // With zh selected, only the normalized zh rule file should be installed —
      // the .en.md variant must not appear alongside it.
      const ruleDest = path.join(fakeHome, '.zcode', 'rules', 'comet-phase-guard.md');
      await expect(fs.access(ruleDest)).resolves.toBeUndefined();
      const ruleContent = await fs.readFile(ruleDest, 'utf-8');
      expect(ruleContent).toContain('Comet 阶段感知');

      await expect(
        fs.access(path.join(fakeHome, '.zcode', 'rules', 'comet-phase-guard.en.md')),
      ).rejects.toThrow();
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'summarizes partial OpenCode failures by failed component only once',
    async () => {
      mockedExecFileSync.mockImplementation((command: unknown, args?: unknown) => {
        const cmd = String(command);
        const cmdArgs = Array.isArray(args) ? args.map((arg) => String(arg)) : [];

        if ((cmd === 'which' || cmd === 'where') && cmdArgs[0] === 'openspec') {
          return Buffer.from('/usr/bin/openspec');
        }
        if (cmd === 'openspec' && cmdArgs[0] === 'init') {
          throw new Error('OpenSpec init failed for opencode');
        }
        if ((cmd === 'which' || cmd === 'where') && cmdArgs[0] === 'codegraph') {
          return Buffer.from('/usr/bin/codegraph');
        }
        if (cmd === 'codegraph') {
          return Buffer.from('ok');
        }
        if ((cmd === 'npx' || cmd === 'npx.cmd') && cmdArgs[0] === 'skills') {
          return Buffer.from('installed');
        }
        return Buffer.from('');
      });

      await fs.mkdir(path.join(tmpDir, '.opencode'), { recursive: true });

      const { initCommand } = await import('../../app/commands/init.js');
      const output = await captureTextOutput(() =>
        initCommand(tmpDir, { yes: true, language: 'en' }),
      );

      expect(output).not.toContain('Installed:\n    OpenCode -> .opencode/skills/');
      expect(output).toContain('Failed:');
      expect(output).toContain('OpenCode (OpenSpec failed)');
      expect(output.match(/OpenCode \(OpenSpec failed\)/g) ?? []).toHaveLength(1);
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it('uses platform selection prompt with selected summary labels in English', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });

    const { checkbox } = await import('@inquirer/prompts');
    const { platformSelectPrompt } = await import('../../app/commands/platform-select-prompt.js');
    vi.mocked(platformSelectPrompt).mockResolvedValue(['codex']);
    vi.mocked(checkbox).mockResolvedValue([]);

    const { initCommand } = await import('../../app/commands/init.js');

    await captureJsonOutput(() =>
      initCommand(tmpDir, { json: true, scope: 'project', language: 'en' }),
    );

    expect(platformSelectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Select platforms to set up:',
        selectedLabel: 'Selected:',
        emptyLabel: 'none',
        requiredErrorLabel: 'Select at least one platform.',
        required: true,
      }),
    );
    expect(platformSelectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({
            value: 'codex',
            name: 'Codex (detected)',
            summaryName: 'Codex',
            checked: true,
          }),
        ]),
      }),
    );
    expect(checkbox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Select npm dependencies to install/upgrade:',
      }),
    );
  });

  it('uses localized selected summary labels in Chinese', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });

    const { checkbox } = await import('@inquirer/prompts');
    const { platformSelectPrompt } = await import('../../app/commands/platform-select-prompt.js');
    vi.mocked(platformSelectPrompt).mockResolvedValue(['codex']);
    vi.mocked(checkbox).mockResolvedValue([]);

    const { initCommand } = await import('../../app/commands/init.js');

    await captureJsonOutput(() =>
      initCommand(tmpDir, { json: true, scope: 'project', language: 'zh' }),
    );

    expect(platformSelectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '选择要配置的平台：',
        selectedLabel: '已选择：',
        emptyLabel: '无',
        requiredErrorLabel: '请至少选择一个平台。',
        required: true,
      }),
    );
  });
});
