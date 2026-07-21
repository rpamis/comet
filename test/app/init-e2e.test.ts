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

function isNativeInstallSkillPath(skillPath: string): boolean {
  return (
    skillPath === 'comet/SKILL.md' ||
    skillPath === 'comet/scripts/comet-entry-runtime.mjs' ||
    skillPath === 'comet/scripts/comet-hook-router.mjs' ||
    skillPath.startsWith('comet-native/') ||
    skillPath.startsWith('comet-any/')
  );
}

function skillPathsForWorkflow(
  manifest: { skills: string[] },
  workflow: 'native' | 'classic' | 'both',
): string[] {
  if (workflow === 'both') return manifest.skills;
  if (workflow === 'native') return manifest.skills.filter(isNativeInstallSkillPath);
  return manifest.skills.filter((skillPath) => !skillPath.startsWith('comet-native/'));
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
    if (cmd === 'openspec' && cmdArgs[0] === '--version') {
      return Buffer.from('1.5.0');
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

  it('offers Native, Classic, and Both with concise user-facing descriptions', async () => {
    const { workflowChoiceNames } = await import('../../app/commands/init.js');

    expect(workflowChoiceNames('zh')).toEqual([
      expect.objectContaining({ value: 'native', name: expect.stringContaining('强模型') }),
      expect.objectContaining({ value: 'classic', name: expect.stringContaining('Spec/TDD') }),
      expect.objectContaining({ value: 'both', name: expect.stringContaining('两套独立入口') }),
    ]);
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
    'initializes a genuinely new project as self-contained Native with --yes --json',
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
      expect(result).toMatchObject({
        workflow: 'native',
        workflowSource: 'new-project-default',
        projectConfigCreated: true,
        nativeArtifactRoot: 'docs',
      });

      const claudeResult = (
        result.results as {
          platform: string;
          comet: string;
          openspec: string;
          superpowers: string;
        }[]
      ).find((r) => r.platform === 'claude');
      expect(claudeResult?.comet).toBe('installed');
      expect(claudeResult?.openspec).toBe('skipped');
      expect(claudeResult?.superpowers).toBe('skipped');

      const manifest = await readManifest();
      const managedSkillPaths = [
        ...manifest.skills,
        ...(manifest.internalSkills ?? []),
      ] as string[];
      for (const skillPath of managedSkillPaths.filter(isNativeInstallSkillPath)) {
        const dest = path.join(tmpDir, '.claude', 'skills', skillPath);
        await expect(fs.access(dest)).resolves.toBeUndefined();
      }
      for (const skillPath of managedSkillPaths.filter(
        (skillPath) => !isNativeInstallSkillPath(skillPath),
      )) {
        const dest = path.join(tmpDir, '.claude', 'skills', skillPath);
        await expect(fs.access(dest)).rejects.toMatchObject({ code: 'ENOENT' });
      }

      await expect(fs.stat(path.join(tmpDir, 'docs', 'comet', 'specs'))).resolves.toBeDefined();
      await expect(fs.stat(path.join(tmpDir, 'docs', 'comet', 'changes'))).resolves.toBeDefined();
      await expect(fs.stat(path.join(tmpDir, 'docs', 'comet', 'archive'))).resolves.toBeDefined();
      await expect(fs.access(path.join(tmpDir, 'comet'))).rejects.toThrow();
      await expect(fs.stat(path.join(tmpDir, 'docs', 'superpowers'))).rejects.toThrow();
      await expect(fs.stat(path.join(tmpDir, '.comet', 'config.yaml'))).resolves.toBeDefined();
      await expect(
        fs.stat(path.join(tmpDir, '.claude', 'rules', 'comet-workflow-guard.md')),
      ).resolves.toBeDefined();
      await expect(
        fs.stat(path.join(tmpDir, '.claude', 'settings.local.json')),
      ).resolves.toBeDefined();

      const projectConfig = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8');
      expect(projectConfig).toContain('default_workflow: native');
      expect(projectConfig).toContain('artifact_root: docs');
      expect(projectConfig).toContain('clarification_mode: sequential');
      expect(mockedExecFileSync.mock.calls.some((call) => String(call[0]) === 'openspec')).toBe(
        false,
      );
      expect(
        mockedExecFileSync.mock.calls.some(
          (call) =>
            (String(call[0]) === 'npx' || String(call[0]) === 'npx.cmd') &&
            Array.isArray(call[1]) &&
            call[1].includes('skills'),
        ),
      ).toBe(false);
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it('preserves a legacy Classic project and its dependency-aware setup by default', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: en\n', 'utf8');

    const { initCommand } = await import('../../app/commands/init.js');
    const result = await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));

    expect(result).toMatchObject({
      workflow: 'classic',
      workflowSource: 'legacy-project',
      projectConfigCreated: false,
    });
    await expect(fs.access(path.join(tmpDir, 'comet.config.yaml'))).rejects.toThrow();
    await expect(fs.stat(path.join(tmpDir, 'docs', 'superpowers', 'specs'))).resolves.toBeDefined();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'rules', 'comet-workflow-guard.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'settings.local.json')),
    ).resolves.toBeUndefined();
    expect(mockedExecFileSync.mock.calls.some((call) => String(call[0]) === 'openspec')).toBe(true);
  });

  it('supports an explicit Native artifact root through the main init command', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    const { initCommand } = await import('../../app/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, {
        yes: true,
        json: true,
        workflow: 'native',
        artifactRoot: 'docs',
        installMode: 'symlink',
      }),
    );

    expect(result).toMatchObject({
      workflow: 'native',
      workflowSource: 'explicit-option',
      projectConfigCreated: true,
      nativeArtifactRoot: 'docs',
    });
    await expect(fs.stat(path.join(tmpDir, 'docs', 'comet', 'changes'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(tmpDir, 'comet'))).rejects.toThrow();
    await expect(fs.stat(path.join(tmpDir, '.comet'))).resolves.toBeDefined();
  });

  it('initializes Native and Classic independently while defaulting /comet to Native', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    const { initCommand } = await import('../../app/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, {
        yes: true,
        json: true,
        workflow: 'both',
        language: 'en',
      }),
    );

    expect(result).toMatchObject({
      workflow: 'native',
      initializedWorkflows: ['native', 'classic'],
      nativeArtifactRoot: 'docs',
    });
    const config = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8');
    expect(config).toContain('default_workflow: native');
    expect(config).toContain('- native');
    expect(config).toContain('- classic');
    expect(config).toContain('clarification_mode: sequential');
    await expect(fs.stat(path.join(tmpDir, 'docs', 'comet', 'changes'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(tmpDir, 'docs', 'superpowers', 'specs'))).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(tmpDir, '.claude', 'rules', 'comet-workflow-guard.md')),
    ).resolves.toBeDefined();
    for (const skill of ['comet-any', 'comet-native', 'comet-classic', 'comet-open']) {
      await expect(
        fs.access(path.join(tmpDir, '.claude', 'skills', skill, 'SKILL.md')),
      ).resolves.toBeUndefined();
    }
    await expect(
      fs.access(path.join(tmpDir, '.comet', 'current-change.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    {
      label: 'Native',
      workflow: 'native' as const,
      artifactRoot: undefined,
      included: ['docs/comet/'],
      excluded: ['docs/superpowers/'],
    },
    {
      label: 'Native with a custom root',
      workflow: 'native' as const,
      artifactRoot: 'artifacts',
      included: ['artifacts/comet/'],
      excluded: ['docs/comet/', 'docs/superpowers/'],
    },
    {
      label: 'Classic',
      workflow: 'classic' as const,
      artifactRoot: undefined,
      included: ['docs/superpowers/specs/', 'docs/superpowers/plans/'],
      excluded: ['docs/comet/'],
    },
    {
      label: 'Both',
      workflow: 'both' as const,
      artifactRoot: undefined,
      included: ['docs/comet/', 'docs/superpowers/specs/', 'docs/superpowers/plans/'],
      excluded: [],
    },
  ])(
    'prints only the actual $label workspace paths in the text summary',
    async ({ workflow, artifactRoot, included, excluded }) => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

      const { initCommand } = await import('../../app/commands/init.js');
      const output = (
        await captureTextOutput(() =>
          initCommand(tmpDir, {
            yes: true,
            workflow,
            artifactRoot,
            language: 'en',
          }),
        )
      ).replaceAll('\\', '/');

      for (const expected of included) expect(output).toContain(expected);
      for (const unexpected of excluded) expect(output).not.toContain(unexpected);
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it.each([
    { workflow: 'classic' as const, migrated: true },
    { workflow: 'native' as const, migrated: false },
  ])(
    'migrates Classic v1 selection only when init enables Classic ($workflow)',
    async ({ workflow, migrated }) => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
      const selectionPath = path.join(tmpDir, '.comet', 'current-change.json');
      await fs.mkdir(path.dirname(selectionPath), { recursive: true });
      await fs.writeFile(
        selectionPath,
        `${JSON.stringify({ version: 1, change: 'legacy-change', branch: null })}\n`,
      );

      const { initCommand } = await import('../../app/commands/init.js');
      await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, workflow, language: 'en' }),
      );

      const selection = JSON.parse(await fs.readFile(selectionPath, 'utf8'));
      expect(selection).toEqual(
        migrated
          ? {
              schema: 'comet.selection.v2',
              workflow: 'classic',
              change: 'legacy-change',
              branch: null,
            }
          : { version: 1, change: 'legacy-change', branch: null },
      );
    },
  );

  it('materializes an old symlink installation before Native copy without writing through it', async () => {
    mockExternalSuccess();
    const centralSkills = path.join(tmpDir, '.comet', 'skills', 'skills');
    const centralComet = path.join(centralSkills, 'comet');
    const platformSkills = path.join(tmpDir, '.claude', 'skills');
    await fs.mkdir(centralComet, { recursive: true });
    await fs.writeFile(path.join(centralComet, 'SKILL.md'), '# Central stale Comet\n', 'utf8');
    await fs.mkdir(path.dirname(platformSkills), { recursive: true });
    await fs.symlink(
      centralSkills,
      platformSkills,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const { initCommand } = await import('../../app/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, {
        yes: true,
        json: true,
        scope: 'project',
        workflow: 'native',
        installMode: 'symlink',
      }),
    );

    expect(result).toMatchObject({ workflow: 'native', projectConfigCreated: true });
    expect((await fs.lstat(platformSkills)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(platformSkills, 'comet', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('comet workflow resolve . --json');
    await expect(fs.readFile(path.join(centralComet, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# Central stale Comet\n',
    );
    await expect(
      fs.access(path.join(centralSkills, 'comet-native', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['native', 'classic'] as const)(
    'installs project-scoped %s assets even when Comet is installed globally',
    async (workflow) => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
      await fs.mkdir(path.join(os.homedir(), '.claude', 'skills', 'comet'), { recursive: true });
      await fs.writeFile(
        path.join(os.homedir(), '.claude', 'skills', 'comet', 'SKILL.md'),
        '# global Comet\n',
        'utf8',
      );

      const { initCommand } = await import('../../app/commands/init.js');
      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, scope: 'project', workflow }),
      );

      const claudeResult = (result.results as { platform: string; comet: string }[]).find(
        (candidate) => candidate.platform === 'claude',
      );
      expect(claudeResult?.comet).toBe('installed');

      const manifest = await readManifest();
      for (const skillPath of skillPathsForWorkflow(manifest, workflow)) {
        await expect(
          fs.access(path.join(tmpDir, '.claude', 'skills', skillPath)),
        ).resolves.toBeUndefined();
      }
      const excludedPaths = manifest.skills.filter(
        (skillPath: string) => !skillPathsForWorkflow(manifest, workflow).includes(skillPath),
      );
      for (const skillPath of excludedPaths) {
        await expect(
          fs.access(path.join(tmpDir, '.claude', 'skills', skillPath)),
        ).rejects.toMatchObject({ code: 'ENOENT' });
      }
    },
  );

  it('fills missing workflow entries without overwriting an existing Comet Skill', async () => {
    mockExternalSuccess();
    const existingSkill = path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md');
    await fs.mkdir(path.dirname(existingSkill), { recursive: true });
    const bundledEntry = await fs.readFile(
      path.resolve('assets', 'skills', 'comet', 'SKILL.md'),
      'utf8',
    );
    await fs.writeFile(existingSkill, bundledEntry, 'utf8');

    const { initCommand } = await import('../../app/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, {
        yes: true,
        json: true,
        scope: 'project',
        workflow: 'native',
      }),
    );

    expect(result).toMatchObject({
      workflow: 'native',
      projectConfigCreated: true,
      results: [expect.objectContaining({ platform: 'claude', comet: 'installed' })],
    });
    await expect(fs.readFile(existingSkill, 'utf8')).resolves.toBe(bundledEntry);
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills', 'comet-native', 'SKILL.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills', 'comet-classic', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not activate Native with --skip-existing when required Native assets are missing', async () => {
    mockExternalSuccess();
    const skillsRoot = path.join(tmpDir, '.claude', 'skills');
    const preinstalledFiles = ['comet/SKILL.md', 'comet/scripts/comet-entry-runtime.mjs'];

    for (const relativePath of preinstalledFiles) {
      const destination = path.join(skillsRoot, ...relativePath.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.resolve('assets', 'skills', ...relativePath.split('/')), destination);
    }

    const { initCommand } = await import('../../app/commands/init.js');
    await expect(
      initCommand(tmpDir, {
        yes: true,
        json: true,
        scope: 'project',
        workflow: 'native',
        skipExisting: true,
      }),
    ).rejects.toThrow(/required Native asset comet-any\/SKILL\.md is missing/u);

    await expect(fs.access(path.join(tmpDir, '.comet', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(tmpDir, 'comet'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not activate Native over a mismatched existing /comet entry without overwrite', async () => {
    mockExternalSuccess();
    const existingSkill = path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md');
    await fs.mkdir(path.dirname(existingSkill), { recursive: true });
    await fs.writeFile(existingSkill, '# User-pinned legacy Comet\n', 'utf8');

    const { initCommand } = await import('../../app/commands/init.js');
    await expect(
      initCommand(tmpDir, {
        yes: true,
        json: true,
        scope: 'project',
        workflow: 'native',
      }),
    ).rejects.toThrow(/differs from the bundled routing contract.*--overwrite/iu);

    await expect(fs.readFile(existingSkill, 'utf8')).resolves.toBe('# User-pinned legacy Comet\n');
    await expect(fs.access(path.join(tmpDir, '.comet', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(tmpDir, 'comet'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed on malformed project config before installer writes', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    const configPath = path.join(tmpDir, '.comet', 'config.yaml');
    const malformed = 'schema: [broken\n';
    await fs.writeFile(configPath, malformed, 'utf8');

    const { initCommand } = await import('../../app/commands/init.js');
    await expect(initCommand(tmpDir, { yes: true, json: true, scope: 'project' })).rejects.toThrow(
      /Invalid \.comet\/config\.yaml/u,
    );

    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(malformed);
    await expect(fs.access(path.join(tmpDir, '.claude', 'skills'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, 'comet'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, '.comet'))).resolves.toBeUndefined();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('uses detected platforms without prompting in JSON mode', async () => {
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    const { platformSelectPrompt } = await import('../../app/commands/platform-select-prompt.js');

    const { initCommand } = await import('../../app/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, {
        json: true,
        scope: 'project',
        language: 'en',
        installMode: 'copy',
      }),
    );

    expect(result).toMatchObject({
      status: 'complete',
      workflow: 'native',
      projectConfigCreated: true,
      selectedPlatforms: ['codex'],
      results: [expect.objectContaining({ platform: 'codex', comet: 'installed' })],
    });
    expect(platformSelectPrompt).not.toHaveBeenCalled();
  });

  it.each([{ workflow: 'native' as const }, { artifactRoot: 'docs' }])(
    'rejects project workflow options at global scope without writes',
    async (selection) => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

      const { initCommand } = await import('../../app/commands/init.js');
      await expect(
        initCommand(tmpDir, { yes: true, json: true, scope: 'global', ...selection }),
      ).rejects.toThrow(/only valid for project-scope initialization/u);

      await expect(fs.access(path.join(os.homedir(), '.comet'))).rejects.toThrow();
      await expect(fs.access(path.join(os.homedir(), '.claude'))).rejects.toThrow();
      await expect(fs.access(path.join(tmpDir, '.comet', 'config.yaml'))).rejects.toThrow();
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    },
  );

  it('leaves project workflow state untouched when every Comet asset copy fails', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills'), 'not a directory', 'utf8');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { initCommand } = await import('../../app/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, { yes: true, json: true, scope: 'project' }),
    );

    expect(result).toMatchObject({
      status: 'incomplete',
      workflow: 'native',
      projectConfigCreated: false,
      workingDirsCreated: false,
    });
    expect(result.failures).toEqual([
      expect.objectContaining({
        platform: 'claude',
        component: 'Comet',
        reason: expect.any(String),
      }),
    ]);
    expect(result.results).toEqual([
      expect.objectContaining({ platform: 'claude', comet: 'failed' }),
    ]);
    await expect(fs.access(path.join(tmpDir, '.comet', 'config.yaml'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, 'comet'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, '.comet'))).rejects.toThrow();
  });

  it('does not activate a project workflow when any selected platform copy fails', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills'), 'not a directory', 'utf8');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { initCommand } = await import('../../app/commands/init.js');
    const result = await captureJsonOutput(() =>
      initCommand(tmpDir, {
        yes: true,
        json: true,
        scope: 'project',
        workflow: 'native',
      }),
    );

    expect(result).toMatchObject({
      workflow: 'native',
      projectConfigCreated: false,
      workingDirsCreated: false,
      results: expect.arrayContaining([
        expect.objectContaining({ platform: 'claude', comet: 'failed' }),
        expect.objectContaining({ platform: 'codex', comet: 'installed' }),
      ]),
    });
    await expect(fs.access(path.join(tmpDir, '.comet', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(tmpDir, 'comet'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { label: 'create', existingWorkflow: null },
    { label: 'switch', existingWorkflow: 'classic' as const },
  ])(
    'does not $label Native activation when the second project instructions file is invalid',
    async ({ existingWorkflow }) => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'CLAUDE.md'),
        '# User rules\n\n<comet-ambient-resume>\nincomplete\n',
        'utf8',
      );

      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      if (existingWorkflow) {
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(
          configPath,
          [
            'schema: comet.project.v1',
            `default_workflow: ${existingWorkflow}`,
            'native:',
            '  artifact_root: .',
            '',
          ].join('\n'),
          'utf8',
        );
      }

      const { initCommand } = await import('../../app/commands/init.js');
      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, {
          yes: true,
          json: true,
          scope: 'project',
          workflow: 'native',
        }),
      );
      expect(result).toMatchObject({
        status: 'incomplete',
        failures: [
          expect.objectContaining({
            component: 'Finalization',
            reason: expect.stringMatching(/incomplete managed block/u),
          }),
        ],
      });

      if (existingWorkflow) {
        const config = await fs.readFile(configPath, 'utf8');
        expect(config).toContain(`default_workflow: ${existingWorkflow}`);
        expect(config).not.toContain('default_workflow: native');
      } else {
        await expect(fs.access(configPath)).rejects.toThrow();
      }
    },
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
      for (const skillPath of skillPathsForWorkflow(manifest, 'classic')) {
        const dest = path.join(fakeHome, '.claude', 'skills', skillPath);
        await expect(fs.access(dest)).resolves.toBeUndefined();
      }
      await expect(
        fs.access(path.join(fakeHome, '.claude', 'skills', 'comet-native', 'SKILL.md')),
      ).rejects.toMatchObject({ code: 'ENOENT' });

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
      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, workflow: 'classic' }),
      );

      expect(result.selectedPlatforms).toEqual(['codex']);
      await expect(
        fs.access(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(tmpDir, '.codex', 'skills', 'comet', 'SKILL.md')),
      ).rejects.toThrow();

      const ruleDest = path.join(tmpDir, '.codex', 'rules', 'comet-workflow-guard.md');
      await expect(fs.access(ruleDest)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(tmpDir, '.agents', 'rules', 'comet-workflow-guard.md')),
      ).rejects.toThrow();

      const hooks = JSON.parse(
        await fs.readFile(path.join(tmpDir, '.codex', 'hooks.json'), 'utf8'),
      );
      const hookCommand = hooks.hooks.PreToolUse[0].hooks[0].command as string;
      expect(hookCommand.replaceAll('\\', '/')).toContain(
        '/.agents/skills/comet/scripts/comet-hook-router.mjs',
      );
      await expect(
        fs.access(path.join(tmpDir, '.codex', 'settings.local.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'Skill failure skips dependent Rule and Hook installation and leaves init incomplete',
    async () => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
      const centralCometDir = path.join(tmpDir, '.comet', 'skills', 'skills', 'comet');
      await fs.mkdir(centralCometDir, { recursive: true });
      await fs.writeFile(path.join(centralCometDir, 'scripts'), 'blocking file');

      const { initCommand } = await import('../../app/commands/init.js');
      const output = await captureTextOutput(() =>
        initCommand(tmpDir, {
          yes: true,
          language: 'en',
          installMode: 'symlink',
          workflow: 'classic',
        }),
      );

      expect(output).toMatch(/Codex \(Comet failed\)/u);
      await expect(
        fs.access(path.join(tmpDir, '.codex', 'rules', 'comet-workflow-guard.md')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(
        fs.access(getProjectRegistryPath(path.join(tmpDir, 'fake-home'))),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'init --yes reuses an existing managed Skill and restores missing Codex Rule and Hook components',
    async () => {
      mockExternalSuccess();
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
      const { initCommand } = await import('../../app/commands/init.js');

      await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', workflow: 'classic' }),
      );
      await fs.rm(path.join(tmpDir, '.codex', 'rules'), { recursive: true, force: true });
      await fs.rm(path.join(tmpDir, '.codex', 'hooks.json'), { force: true });
      await fs.rm(getProjectRegistryPath(fakeHome), { force: true });

      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', workflow: 'classic' }),
      );
      const codex = (result.results as Array<{ platform: string; comet: string }>).find(
        (candidate) => candidate.platform === 'codex',
      );

      expect(codex?.comet).toBe('installed');
      await expect(
        fs.access(path.join(tmpDir, '.codex', 'rules', 'comet-workflow-guard.md')),
      ).resolves.toBeUndefined();
      await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).resolves.toBeUndefined();
      const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
        projects: Array<{ lastTargets: Array<{ platform: string }> }>;
      };
      expect(registry.projects[0].lastTargets).toContainEqual(
        expect.objectContaining({ platform: 'codex' }),
      );
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'init --yes project scope does not treat a global-only Skill as a complete local install',
    async () => {
      mockExternalSuccess();
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
      const { initCommand } = await import('../../app/commands/init.js');

      await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', scope: 'global' }),
      );
      await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, '.agents', 'skills'), 'blocking file', 'utf8');

      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', scope: 'project' }),
      );
      const codex = (result.results as Array<{ platform: string; comet: string }>).find(
        (candidate) => candidate.platform === 'codex',
      );

      expect(codex?.comet).toBe('failed');
      await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(fs.access(getProjectRegistryPath(fakeHome))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'init --yes repairs a partial local Skill before restoring dependent Rule and Hook components',
    async () => {
      mockExternalSuccess();
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
      const { initCommand } = await import('../../app/commands/init.js');
      const guardScript = path.join(
        tmpDir,
        '.agents',
        'skills',
        'comet',
        'scripts',
        'comet-hook-router.mjs',
      );

      await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', workflow: 'classic' }),
      );
      await fs.rm(guardScript, { force: true });
      await fs.rm(path.join(tmpDir, '.codex', 'rules'), { recursive: true, force: true });
      await fs.rm(path.join(tmpDir, '.codex', 'hooks.json'), { force: true });
      await fs.rm(getProjectRegistryPath(fakeHome), { force: true });

      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', workflow: 'classic' }),
      );
      const codex = (result.results as Array<{ platform: string; comet: string }>).find(
        (candidate) => candidate.platform === 'codex',
      );

      expect(codex?.comet).toBe('installed');
      await expect(fs.access(guardScript)).resolves.toBeUndefined();
      await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).resolves.toBeUndefined();
      const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
        projects: Array<{ lastTargets: Array<{ platform: string }> }>;
      };
      expect(registry.projects[0].lastTargets).toContainEqual(
        expect.objectContaining({ platform: 'codex' }),
      );
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'init --yes does not register reused Skills when canonical Hook validation fails',
    async () => {
      mockExternalSuccess();
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
      const { initCommand } = await import('../../app/commands/init.js');

      await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', workflow: 'classic' }),
      );
      await fs.writeFile(path.join(tmpDir, '.codex', 'hooks.json'), '[]\n', 'utf8');
      await fs.rm(getProjectRegistryPath(fakeHome), { force: true });

      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', workflow: 'classic' }),
      );
      const codex = (result.results as Array<{ platform: string; comet: string }>).find(
        (candidate) => candidate.platform === 'codex',
      );

      expect(codex?.comet).toBe('failed');
      let projects: unknown[] = [];
      try {
        projects = (
          JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
            projects: unknown[];
          }
        ).projects;
      } catch (error) {
        expect(error).toMatchObject({ code: 'ENOENT' });
      }
      expect(projects).toEqual([]);
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it(
    'an explicit skip of existing Comet Skills does not register an incomplete target',
    async () => {
      mockExternalSuccess();
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
      const { initCommand } = await import('../../app/commands/init.js');

      await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', workflow: 'classic' }),
      );
      await fs.rm(path.join(tmpDir, '.codex', 'rules'), { recursive: true, force: true });
      await fs.rm(path.join(tmpDir, '.codex', 'hooks.json'), { force: true });
      await fs.rm(getProjectRegistryPath(fakeHome), { force: true });

      await captureJsonOutput(() =>
        initCommand(tmpDir, {
          yes: true,
          json: true,
          language: 'en',
          workflow: 'classic',
          skipExisting: true,
        }),
      );

      let projects: unknown[] = [];
      try {
        projects = (
          JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
            projects: unknown[];
          }
        ).projects;
      } catch (error) {
        expect(error).toMatchObject({ code: 'ENOENT' });
      }
      expect(projects).toEqual([]);
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it.each([
    { component: 'Rule', outcome: 'returned' },
    { component: 'Rule', outcome: 'thrown' },
    { component: 'Hook', outcome: 'returned' },
    { component: 'Hook', outcome: 'thrown' },
  ] as const)(
    '$component $outcome failure makes init Comet failed and prevents registry success',
    async ({ component, outcome }) => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
      const platformInstall = await import('../../domains/skill/platform-install.js');

      if (component === 'Rule') {
        const ruleSpy = vi.spyOn(platformInstall, 'copyCometRulesForPlatform');
        if (outcome === 'returned') {
          ruleSpy.mockResolvedValueOnce({ copied: 0, skipped: 0, failed: 1 });
        } else {
          ruleSpy.mockRejectedValueOnce(new Error('rule install threw'));
        }
      } else {
        const hookSpy = vi.spyOn(platformInstall, 'installCometHooksForPlatform');
        if (outcome === 'returned') {
          hookSpy.mockResolvedValueOnce({
            status: 'failed',
            reason: 'hook install returned failed',
          });
        } else {
          hookSpy.mockRejectedValueOnce(new Error('hook install threw'));
        }
      }

      const { initCommand } = await import('../../app/commands/init.js');
      const result = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, language: 'en', workflow: 'classic' }),
      );
      const codexResult = (result.results as { platform: string; comet: string }[]).find(
        (candidate) => candidate.platform === 'codex',
      );

      expect(codexResult?.comet).toBe('failed');
      expect(result).toMatchObject({
        status: 'incomplete',
        failures: [
          expect.objectContaining({
            platform: 'codex',
            component,
            reason: expect.stringMatching(component === 'Rule' ? /rule/iu : /hook/iu),
          }),
        ],
      });
      await expect(
        fs.access(getProjectRegistryPath(path.join(tmpDir, 'fake-home'))),
      ).rejects.toMatchObject({ code: 'ENOENT' });
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
    'reuses already-installed Comet skills with --yes and validates lifecycle components',
    async () => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

      const { initCommand } = await import('../../app/commands/init.js');
      const result1 = await captureJsonOutput(() =>
        initCommand(tmpDir, { yes: true, json: true, workflow: 'classic' }),
      );
      const claude1 = (result1.results as { platform: string; comet: string }[]).find(
        (r) => r.platform === 'claude',
      );
      expect(claude1?.comet).toBe('installed');

      vi.resetModules();
      vi.resetAllMocks();
      vi.spyOn(os, 'homedir').mockReturnValue(path.join(tmpDir, 'fake-home'));
      mockExternalSuccess();

      const { initCommand: init2 } = await import('../../app/commands/init.js');
      const result2 = await captureJsonOutput(() =>
        init2(tmpDir, { yes: true, json: true, workflow: 'classic' }),
      );
      const claude2 = (result2.results as { platform: string; comet: string }[]).find(
        (r) => r.platform === 'claude',
      );
      expect(claude2?.comet).toBe('installed');
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
          for (const skillPath of skillPathsForWorkflow(manifest, 'native')) {
            const dest = path.join(tmpDir, platform, 'skills', skillPath);
            await expect(fs.access(dest)).resolves.toBeUndefined();
          }
        }

        await expect(
          fs.access(path.join(tmpDir, '.codex', 'skills', 'comet', 'SKILL.md')),
        ).rejects.toThrow();

        await expect(
          fs.access(path.join(tmpDir, '.opencode', 'commands', 'comet-any.md')),
        ).resolves.toBeUndefined();
        await expect(
          fs.access(path.join(tmpDir, '.mimocode', 'commands', 'comet-any.md')),
        ).resolves.toBeUndefined();
        await expect(
          fs.access(path.join(tmpDir, '.opencode', 'commands', 'comet-open.md')),
        ).rejects.toMatchObject({ code: 'ENOENT' });
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
        for (const skillPath of skillPathsForWorkflow(manifest, 'classic')) {
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
      for (const skillPath of skillPathsForWorkflow(manifest, 'classic')) {
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
      for (const skillPath of skillPathsForWorkflow(manifest, 'classic')) {
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
      for (const skillPath of skillPathsForWorkflow(manifest, 'classic')) {
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
      for (const skillPath of skillPathsForWorkflow(manifest, 'classic')) {
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
      for (const skillPath of skillPathsForWorkflow(manifest, 'classic')) {
        const dest = path.join(fakeHome, '.zcode', 'skills', skillPath);
        await expect(fs.access(dest)).resolves.toBeUndefined();
      }

      // Comet rules are distributed to the platform rules directory, but only
      // the selected language's variant (default init selects English here) —
      // not every language variant listed in the manifest.
      const ruleDest = path.join(fakeHome, '.zcode', 'rules', 'comet-workflow-guard.md');
      await expect(fs.access(ruleDest)).resolves.toBeUndefined();
      const ruleContent = await fs.readFile(ruleDest, 'utf-8');
      expect(ruleContent).toContain('Comet Current-Change Phase Rule');

      await expect(
        fs.access(path.join(fakeHome, '.zcode', 'rules', 'comet-workflow-guard.en.md')),
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
      const ruleDest = path.join(fakeHome, '.zcode', 'rules', 'comet-workflow-guard.md');
      await expect(fs.access(ruleDest)).resolves.toBeUndefined();
      const ruleContent = await fs.readFile(ruleDest, 'utf-8');
      expect(ruleContent).toContain('Comet 当前需求阶段规则');

      await expect(
        fs.access(path.join(fakeHome, '.zcode', 'rules', 'comet-workflow-guard.en.md')),
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
        initCommand(tmpDir, { yes: true, language: 'en', workflow: 'classic' }),
      );

      expect(output).not.toContain('Installed:\n    OpenCode -> .opencode/skills/');
      expect(output).toContain('Failed:');
      expect(output).toContain('OpenCode (OpenSpec failed)');
      expect(output).toContain('Comet setup incomplete.');
      expect(output).not.toContain('Comet setup complete!');
      expect(output).not.toContain('Get started:');
      expect(output.match(/OpenCode \(OpenSpec failed\)/g) ?? []).toHaveLength(1);
    },
    INIT_E2E_TIMEOUT_MS,
  );

  it('fails before installer writes when the project registry is corrupt', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    const registryPath = getProjectRegistryPath(path.join(tmpDir, 'fake-home'));
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, '{not-json', 'utf-8');

    const { initCommand } = await import('../../app/commands/init.js');
    await expect(initCommand(tmpDir, { yes: true, json: true, scope: 'project' })).rejects.toThrow(
      /registry is invalid JSON/iu,
    );
    await expect(fs.readFile(registryPath, 'utf-8')).resolves.toBe('{not-json');
    await expect(fs.access(path.join(tmpDir, '.agents', 'skills'))).rejects.toThrow();
  });

  it('uses platform selection prompt with selected summary labels in English', async () => {
    mockExternalSuccess();
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });

    const { checkbox } = await import('@inquirer/prompts');
    const { platformSelectPrompt } = await import('../../app/commands/platform-select-prompt.js');
    vi.mocked(platformSelectPrompt).mockResolvedValue(['codex']);
    vi.mocked(checkbox).mockResolvedValue([]);

    const { initCommand } = await import('../../app/commands/init.js');

    await captureTextOutput(() =>
      initCommand(tmpDir, {
        scope: 'project',
        language: 'en',
        workflow: 'classic',
      }),
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

    await captureTextOutput(() => initCommand(tmpDir, { scope: 'project', language: 'zh' }));

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
