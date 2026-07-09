import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { select } from '@inquirer/prompts';
import { PLATFORMS, type Platform } from '../../platform/install/platforms.js';
import {
  buildNpmUpdateArgs,
  detectCometPackageScope,
  detectInstalledCometLanguage,
  detectInstalledCometTargets,
  formatNpmUpdateCommand,
  formatSkillUpdateCommand,
  updateCommand,
} from '../../app/commands/update.js';
import {
  getProjectRegistryPath,
  upsertProjectInstallation,
} from '../../platform/install/project-registry.js';

// Mock the interactive select prompt so tests don't hang on CI (no TTY).
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn().mockResolvedValue(false),
}));

const mockedSelect = vi.mocked(select);

const claudePlatform: Platform = {
  id: 'claude',
  name: 'Claude Code',
  skillsDir: '.claude',
  openspecToolId: 'claude',
};

describe('update command helpers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    mockedSelect.mockClear();
    tmpDir = path.join(
      os.tmpdir(),
      `comet-update-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects Chinese installed comet skills from existing skill content', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\n当用户提出需求时，先澄清目标再执行。',
      'utf-8',
    );

    await expect(detectInstalledCometLanguage(tmpDir, claudePlatform)).resolves.toBe('zh');
  });

  it('detects English installed comet skills from existing skill content', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill when starting a new change.',
      'utf-8',
    );

    await expect(detectInstalledCometLanguage(tmpDir, claudePlatform)).resolves.toBe('en');
  });

  it('defaults installed comet language to English when the skills directory is missing', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    await expect(detectInstalledCometLanguage(tmpDir, claudePlatform)).resolves.toBe('en');
  });

  it('finds only scopes and platforms that already have comet skills installed', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const globalDir = path.join(tmpDir, 'home');

    await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );

    await fs.mkdir(path.join(projectDir, '.cursor'), { recursive: true });

    await fs.mkdir(path.join(globalDir, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(globalDir, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\n当用户提出需求时使用这个技能。',
      'utf-8',
    );

    const targets = await detectInstalledCometTargets(projectDir, {
      globalBaseDir: globalDir,
    });

    expect(targets.map((t) => `${t.scope}:${t.platform.id}:${t.language}`)).toEqual([
      'project:claude:en',
      'global:codex:zh',
    ]);
  });

  it('ignores platform directories that do not contain a skills directory', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(path.join(projectDir, '.claude'), { recursive: true });

    await expect(detectInstalledCometTargets(projectDir, { scopes: ['project'] })).resolves.toEqual(
      [],
    );
  });

  it('respects explicit scope filtering when detecting installed targets', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const globalDir = path.join(tmpDir, 'home');

    await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    await fs.mkdir(path.join(globalDir, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(globalDir, '.codex', 'skills', 'comet', 'SKILL.md'), '# Comet');

    const targets = await detectInstalledCometTargets(projectDir, {
      globalBaseDir: globalDir,
      scopes: ['global'],
    });

    expect(targets.map((t) => `${t.scope}:${t.platform.id}`)).toEqual(['global:codex']);
  });

  it('detects legacy global Pi skills so update can migrate them', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const globalDir = path.join(tmpDir, 'home');

    await fs.mkdir(path.join(globalDir, '.pi', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(globalDir, '.pi', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );

    const targets = await detectInstalledCometTargets(projectDir, {
      globalBaseDir: globalDir,
      scopes: ['global'],
    });

    expect(targets.map((t) => `${t.scope}:${t.platform.id}:${t.language}`)).toEqual([
      'global:pi:en',
    ]);
    expect(PLATFORMS.find((platform) => platform.id === 'pi')?.globalSkillsDir).toBe('.pi/agent');
  });

  it('detects project package scope from local node_modules install path', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const packageRoot = path.join(projectDir, 'node_modules', '@rpamis', 'comet');

    await expect(detectCometPackageScope(projectDir, packageRoot)).resolves.toBe('project');
  });

  it('detects project package scope from package.json dependencies', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ devDependencies: { '@rpamis/comet': '^0.2.4' } }),
      'utf-8',
    );

    await expect(detectCometPackageScope(projectDir, tmpDir)).resolves.toBe('project');
  });

  it('falls back to global package scope when no project install is found', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });

    await expect(detectCometPackageScope(projectDir, tmpDir)).resolves.toBe('global');
  });

  it('builds npm update args preserving package install scope with official registry', () => {
    expect(buildNpmUpdateArgs('global')).toEqual([
      'install',
      '-g',
      '@rpamis/comet@latest',
      '--registry',
      'https://registry.npmjs.org',
    ]);
    expect(buildNpmUpdateArgs('project')).toEqual([
      'install',
      '@rpamis/comet@latest',
      '--registry',
      'https://registry.npmjs.org',
    ]);
  });

  it('formats the npm update command for friendly console output', () => {
    expect(formatNpmUpdateCommand('global')).toBe(
      'npm install -g @rpamis/comet@latest --registry https://registry.npmjs.org',
    );
    expect(formatNpmUpdateCommand('project')).toBe(
      'npm install @rpamis/comet@latest --registry https://registry.npmjs.org',
    );
  });

  it('formats the skill update command with scope, platform, and language source', () => {
    expect(formatSkillUpdateCommand('project', claudePlatform, 'skills-zh')).toBe(
      'copy assets/skills-zh -> .claude/skills/ (project)',
    );
    expect(formatSkillUpdateCommand('global', claudePlatform, 'skills')).toBe(
      'copy assets/skills -> ~/.claude/skills/ (global)',
    );
    expect(formatSkillUpdateCommand('project', claudePlatform, 'skills', 'symlink')).toBe(
      'symlink via .comet/skills/ in .claude/skills/ (project)',
    );
  });

  it('prints the skill update command when updating installed skills', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\n当用户提出需求时使用这个技能。',
      'utf-8',
    );

    const fakeHome = path.join(tmpDir, 'fake-home-print-command');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      await updateCommand(tmpDir, { skipNpm: true });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(output).toContain('$ copy assets/skills-zh -> .claude/skills/ (project)');
  });

  it('prints structured JSON when requested', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );

    const fakeHome = path.join(tmpDir, 'fake-home-json');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await updateCommand(tmpDir, { json: true, skipNpm: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.npm.scope).toBe('skipped');
    expect(result.skills.totalCopied).toBeGreaterThan(0);
    expect(result.skills.targets[0]).toMatchObject({
      scope: 'project',
      platform: 'claude',
      language: 'en',
      source: 'skills',
    });
  });

  it('updates all indexed project-scope installs when --all-projects is explicit in JSON mode', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    const projectA = path.join(tmpDir, 'project-a');
    const projectB = path.join(tmpDir, 'project-b');
    await fs.mkdir(fakeHome, { recursive: true });

    for (const project of [projectA, projectB]) {
      await fs.mkdir(path.join(project, '.claude', 'skills', 'comet'), { recursive: true });
      await fs.writeFile(
        path.join(project, '.claude', 'skills', 'comet', 'SKILL.md'),
        '# Comet',
        'utf-8',
      );
      await upsertProjectInstallation(project, [{ platform: 'claude', language: 'en' }], 'init', {
        homeDir: fakeHome,
      });
    }

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await updateCommand(projectA, { json: true, skipNpm: true, allProjects: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.mode).toBe('all-projects');
    expect(result.registry.projectsFound).toBe(2);
    expect(
      result.projects.map((project: { projectPath: string }) => project.projectPath).sort(),
    ).toEqual([path.resolve(projectA), path.resolve(projectB)].sort());
    expect(
      result.projects.every((project: { status: string }) => project.status === 'updated'),
    ).toBe(true);

    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8')) as {
      projects: Array<{ lastSource: string }>;
    };
    expect(registry.projects.every((project) => project.lastSource === 'update')).toBe(true);
  });

  it('removes stale indexed projects that no longer have project-scope installs during all-projects update', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-stale');
    const staleProject = path.join(tmpDir, 'stale-project');
    await fs.mkdir(staleProject, { recursive: true });
    await upsertProjectInstallation(
      staleProject,
      [{ platform: 'claude', language: 'en' }],
      'init',
      {
        homeDir: fakeHome,
      },
    );

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await updateCommand(staleProject, { json: true, skipNpm: true, allProjects: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.mode).toBe('all-projects');
    expect(result.registry).toMatchObject({ projectsFound: 1, staleRemoved: 1 });
    expect(result.projects).toEqual([
      {
        projectPath: path.resolve(staleProject),
        status: 'skipped',
        reason: 'no project-scope Comet install detected',
        targets: [],
      },
    ]);

    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toHaveLength(0);
  });

  it('rejects --all-projects with --scope global during update', async () => {
    await expect(
      updateCommand(tmpDir, { json: true, skipNpm: true, allProjects: true, scope: 'global' }),
    ).rejects.toThrow('--all-projects cannot be combined with --scope global');
  });

  it('rejects --all-projects with --current-project during update', async () => {
    await expect(
      updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        allProjects: true,
        currentProject: true,
      }),
    ).rejects.toThrow('--all-projects cannot be combined with --current-project');
  });

  it('keeps JSON update current-project by default even when registry has projects', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-current');
    const projectA = path.join(tmpDir, 'project-current');
    await fs.mkdir(path.join(projectA, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectA, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet',
      'utf-8',
    );
    await upsertProjectInstallation(projectA, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await updateCommand(projectA, { json: true, skipNpm: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.mode).toBeUndefined();
    expect(result.skills.targets).toHaveLength(1);
  });

  it('refreshes the project registry after a successful current-project update', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-current-refresh');
    const projectA = path.join(tmpDir, 'project-current-refresh');
    await fs.mkdir(path.join(projectA, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectA, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet',
      'utf-8',
    );
    await upsertProjectInstallation(projectA, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(projectA, { json: true, skipNpm: true });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8')) as {
      projects: Array<{ lastSource: string }>;
    };
    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0].lastSource).toBe('update');
  });

  it('returns stable JSON summary when no installed targets are found', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-instructions');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await updateCommand(tmpDir, { json: true, skipNpm: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result).toMatchObject({
      npm: {
        scope: 'skipped',
        status: 'skipped',
      },
      skills: {
        totalCopied: 0,
        targets: [],
      },
      rules: {
        totalCopied: 0,
      },
      hooks: {
        totalInstalled: 0,
      },
      projectInstructions: {
        updated: 0,
      },
      codegraph: 'skipped',
    });
  });

  it('does not create or update root project instructions when only global targets are updated', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(path.join(fakeHome, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# User\nKeep this.\n', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# User\nAlso keep this.\n', 'utf-8');

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await updateCommand(tmpDir, { json: true, skipNpm: true, scope: 'global' });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.projectInstructions.updated).toBe(0);

    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
    const claude = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(agents).toBe('# User\nKeep this.\n');
    expect(claude).toBe('# User\nAlso keep this.\n');
    expect(agents).not.toContain('<comet-ambient-resume>');
    expect(claude).not.toContain('<comet-ambient-resume>');
  });

  it('installs ambient resume instructions and preserves existing user AGENTS/CLAUDE rules', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# User\n\nKeep this.\n', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# User\n\nAlso keep this.\n', 'utf-8');

    const fakeHome = path.join(tmpDir, 'fake-home-instructions');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await updateCommand(tmpDir, { json: true, skipNpm: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.projectInstructions.updated).toBe(2);

    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
    const claude = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(agents).toContain('# User\n\nKeep this.');
    expect(claude).toContain('# User\n\nAlso keep this.');
    expect(agents).toContain('<comet-ambient-resume>');
    expect(claude).toContain('<comet-ambient-resume>');
  });

  it('does not prompt to install CodeGraph when the project already has an index', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );
    await fs.mkdir(path.join(tmpDir, '.codegraph'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.codegraph', 'codegraph.db'), '');

    const fakeHome = path.join(tmpDir, 'fake-home-codegraph-index');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { skipNpm: true });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(mockedSelect).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('CodeGraph'),
      }),
    );
  });
});
