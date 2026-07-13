import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
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

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  }),
}));

const mockedSelect = vi.mocked(select);
const mockedSpawn = vi.mocked(spawn);

const claudePlatform: Platform = {
  id: 'claude',
  name: 'Claude Code',
  skillsDir: '.claude',
  openspecToolId: 'claude',
};

type ComponentFailure = 'Skill' | 'Rule' | 'Hook';

async function arrangeComponentFailure(
  projectPath: string,
  failure: ComponentFailure,
): Promise<{ installMode: 'copy' | 'symlink' }> {
  await fs.mkdir(path.join(projectPath, '.codex'), { recursive: true });

  if (failure === 'Skill') {
    await fs.mkdir(path.join(projectPath, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectPath, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Legacy Comet\n',
    );
    await fs.mkdir(path.join(projectPath, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectPath, '.agents', 'skills', 'comet', 'user-file.md'),
      '# Keep\n',
    );
    return { installMode: 'symlink' };
  }

  await fs.mkdir(path.join(projectPath, '.agents', 'skills', 'comet'), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, '.agents', 'skills', 'comet', 'SKILL.md'),
    '# Comet\n\nUse this skill.\n',
  );

  if (failure === 'Rule') {
    await fs.writeFile(path.join(projectPath, '.codex', 'rules'), 'blocking file');
  } else {
    await fs.mkdir(path.join(projectPath, '.codex', 'hooks.json'), { recursive: true });
  }

  return { installMode: 'copy' };
}

describe('update command helpers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    mockedSelect.mockClear();
    mockedSpawn.mockClear();
    mockedSpawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child as ReturnType<typeof spawn>;
    });
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

    await fs.mkdir(path.join(globalDir, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.mkdir(path.join(globalDir, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(globalDir, '.agents', 'skills', 'comet', 'SKILL.md'),
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
    await fs.mkdir(path.join(globalDir, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.mkdir(path.join(globalDir, '.codex'), { recursive: true });
    await fs.writeFile(path.join(globalDir, '.agents', 'skills', 'comet', 'SKILL.md'), '# Comet');

    const targets = await detectInstalledCometTargets(projectDir, {
      globalBaseDir: globalDir,
      scopes: ['global'],
    });

    expect(targets.map((t) => `${t.scope}:${t.platform.id}`)).toEqual(['global:codex']);
  });

  it('does not infer Codex from a shared canonical Skill directory without Codex detection paths', async () => {
    const projectDir = path.join(tmpDir, 'shared-agents-only');
    await fs.mkdir(path.join(projectDir, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.agents', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n',
    );

    const targets = await detectInstalledCometTargets(projectDir, { scopes: ['project'] });

    expect(targets.map((target) => target.platform.id)).toEqual(['antigravity']);
  });

  it('assigns a shared project .agents Skill root only to Codex when .codex evidence exists', async () => {
    const projectDir = path.join(tmpDir, 'shared-agents-with-codex');
    await fs.mkdir(path.join(projectDir, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.mkdir(path.join(projectDir, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.agents', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n',
    );

    const targets = await detectInstalledCometTargets(projectDir, { scopes: ['project'] });

    expect(targets.map((target) => target.platform.id)).toEqual(['codex']);
  });

  it('updates an explicitly scoped canonical global Codex install without a detection path', async () => {
    const projectDir = path.join(tmpDir, 'explicit-global-project');
    const fakeHome = path.join(tmpDir, 'explicit-global-home');
    await fs.mkdir(path.join(fakeHome, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(fakeHome, '.agents', 'skills', 'comet', 'SKILL.md'), '# Comet\n');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(projectDir, { json: true, skipNpm: true, scope: 'global' });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(JSON.parse(json).skills.targets).toEqual([
      expect.objectContaining({ scope: 'global', platform: 'codex' }),
    ]);
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

  it('migrates legacy Codex skills after canonical installation and preserves unrelated skills', async () => {
    const fakeHome = path.join(tmpDir, 'home');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const legacyComet = path.join(tmpDir, '.codex', 'skills', 'comet');
    const legacyPersonal = path.join(tmpDir, '.codex', 'skills', 'personal');
    await fs.mkdir(legacyComet, { recursive: true });
    await fs.mkdir(legacyPersonal, { recursive: true });
    await fs.writeFile(path.join(legacyComet, 'SKILL.md'), '# Comet\n\nUse this skill.');
    await fs.writeFile(path.join(legacyPersonal, 'SKILL.md'), '# Personal\n');
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

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { skipNpm: true, scope: 'project' });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    await expect(
      fs.access(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md')),
    ).resolves.toBeUndefined();
    await expect(fs.access(legacyComet)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(legacyPersonal, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# Personal\n',
    );
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
    await expect(
      fs.access(path.join(tmpDir, '.agents', 'settings.local.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not update Codex hooks when the managed Hook script cannot be copied', async () => {
    const fakeHome = path.join(tmpDir, 'hook-copy-failure-home');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const skillDir = path.join(tmpDir, '.agents', 'skills', 'comet');
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Comet\n\nUse this skill.');
    await fs.writeFile(path.join(skillDir, 'scripts'), 'blocking file');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { skipNpm: true, scope: 'project' });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each<ComponentFailure>(['Skill', 'Rule', 'Hook'])(
    '%s failure is reported as incomplete in JSON and does not refresh the registry',
    async (failure) => {
      const fakeHome = path.join(tmpDir, `component-failure-json-${failure}`);
      const options = await arrangeComponentFailure(tmpDir, failure);
      await upsertProjectInstallation(tmpDir, [{ platform: 'codex', language: 'en' }], 'init', {
        homeDir: fakeHome,
      });
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await updateCommand(tmpDir, {
          json: true,
          skipNpm: true,
          scope: 'project',
          installMode: options.installMode,
        });
        const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
        expect(result.status).toBe('incomplete');
        expect(result.skills.totalFailed > 0).toBe(failure === 'Skill');
        expect(result.rules.totalFailed > 0).toBe(failure === 'Rule');
        expect(result.hooks.totalFailed > 0).toBe(failure === 'Hook');

        const component = `${failure.toLowerCase()}s` as 'skills' | 'rules' | 'hooks';
        expect(result[component].targets[0].failed).toBeGreaterThan(0);
        expect(result[component].targets[0].reason).toEqual(expect.any(String));
      } finally {
        log.mockRestore();
        homedirSpy.mockRestore();
      }

      const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8')) as {
        projects: Array<{ lastSource: string }>;
      };
      expect(registry.projects[0].lastSource).toBe('init');

      if (failure === 'Skill') {
        await expect(
          fs.access(path.join(tmpDir, '.codex', 'rules', 'comet-phase-guard.md')),
        ).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
    },
  );

  it.each<ComponentFailure>(['Skill', 'Rule', 'Hook'])(
    '%s failure is reported as incomplete in text output',
    async (failure) => {
      const fakeHome = path.join(tmpDir, `component-failure-text-${failure}`);
      const options = await arrangeComponentFailure(tmpDir, failure);
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await updateCommand(tmpDir, {
          skipNpm: true,
          scope: 'project',
          installMode: options.installMode,
        });
        const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(output).toMatch(/incomplete/iu);
        if (failure === 'Skill') {
          expect(output).toContain(
            'Codex (project) Skill: failed (1) - 1 Skill file(s) failed to install',
          );
          expect(output).not.toMatch(/Antigravity.*Skill: failed/u);
        } else if (failure === 'Rule') {
          expect(output).toContain(
            'Codex (project) Rule: failed (1) - 1 Rule file(s) failed to install',
          );
        } else {
          expect(output).toMatch(
            /Codex \(project\) Hook: failed \(1\) - Invalid Codex settings at .*hooks\.json: EISDIR/iu,
          );
        }
      } finally {
        log.mockRestore();
        homedirSpy.mockRestore();
      }
    },
  );

  it.each<ComponentFailure>(['Skill', 'Rule', 'Hook'])(
    '%s failure marks all-projects status failed',
    async (failure) => {
      const fakeHome = path.join(tmpDir, `component-failure-all-projects-${failure}`);
      const project = path.join(tmpDir, `component-failure-project-${failure}`);
      const options = await arrangeComponentFailure(project, failure);
      await upsertProjectInstallation(project, [{ platform: 'codex', language: 'en' }], 'init', {
        homeDir: fakeHome,
      });
      const registryBefore = await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8');
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await updateCommand(project, {
          allProjects: true,
          json: true,
          skipNpm: true,
          installMode: options.installMode,
        });
        const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
        expect(result.projects[0].status).toBe('failed');
        expect(result.projects[0].reason).toMatch(new RegExp(failure, 'iu'));
        const failures = result.projects[0].failures as Array<Record<string, unknown>>;
        if (failure === 'Skill') {
          expect(failures).toEqual([
            expect.objectContaining({
              platformName: 'Codex',
              scope: 'project',
              component: 'Skill',
              status: 'failed',
              failed: 1,
              reason: '1 Skill file(s) failed to install',
            }),
          ]);
        } else if (failure === 'Rule') {
          expect(failures).toContainEqual(
            expect.objectContaining({
              platform: 'codex',
              platformName: 'Codex',
              scope: 'project',
              component: 'Rule',
              status: 'failed',
              failed: 1,
              reason: '1 Rule file(s) failed to install',
            }),
          );
        } else {
          expect(failures).toContainEqual(
            expect.objectContaining({
              platform: 'codex',
              platformName: 'Codex',
              scope: 'project',
              component: 'Hook',
              status: 'failed',
              failed: 1,
              reason: expect.stringMatching(/Invalid Codex settings at .*hooks\.json: EISDIR/iu),
            }),
          );
        }
      } finally {
        log.mockRestore();
        homedirSpy.mockRestore();
      }

      await expect(fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8')).resolves.toBe(
        registryBefore,
      );
    },
  );

  it.each([true, false])(
    'reports legacy Codex cleanup refusal as incomplete in %s output',
    async (json) => {
      const fakeHome = path.join(tmpDir, `cleanup-failure-home-${json}`);
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
      const legacyTarget = path.join(tmpDir, 'legacy-shared-skills');
      const legacySkills = path.join(tmpDir, '.codex', 'skills');
      await fs.mkdir(path.join(legacyTarget, 'comet'), { recursive: true });
      await fs.writeFile(path.join(legacyTarget, 'comet', 'SKILL.md'), '# Legacy Comet\n');
      await fs.mkdir(path.dirname(legacySkills), { recursive: true });
      await fs.symlink(
        legacyTarget,
        legacySkills,
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await updateCommand(tmpDir, { skipNpm: true, scope: 'project', json });
        const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
        if (json) {
          const result = JSON.parse(output);
          expect(result.skills.cleanupFailed).toBeGreaterThan(0);
          expect(result.skills.targets[0].cleanupFailed).toBeGreaterThan(0);
          expect(result.skills.targets[0].reason).toMatch(/cleanup/iu);
        } else {
          expect(output).toMatch(/incomplete|failed/iu);
        }
      } finally {
        log.mockRestore();
        homedirSpy.mockRestore();
      }

      await expect(
        fs.access(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md')),
      ).resolves.toBeUndefined();
      await expect(fs.lstat(legacySkills)).resolves.toMatchObject({});
    },
  );

  it('marks all-projects update failed when legacy Codex cleanup is refused', async () => {
    const fakeHome = path.join(tmpDir, 'all-projects-home-cleanup-failure');
    const project = path.join(tmpDir, 'all-projects-cleanup-failure');
    const legacyTarget = path.join(tmpDir, 'all-projects-legacy-target');
    await fs.mkdir(path.join(project, '.codex'), { recursive: true });
    await fs.mkdir(path.join(legacyTarget, 'comet'), { recursive: true });
    await fs.writeFile(path.join(legacyTarget, 'comet', 'SKILL.md'), '# Legacy Comet\n');
    await fs.symlink(
      legacyTarget,
      path.join(project, '.codex', 'skills'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await upsertProjectInstallation(project, [{ platform: 'codex', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(project, { allProjects: true, json: true, skipNpm: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.projects[0].status).toBe('failed');
      expect(result.projects[0].reason).toMatch(/cleanup/iu);
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }
  });

  it('preserves legacy Codex skills when the canonical installation is incomplete', async () => {
    const fakeHome = path.join(tmpDir, 'home-incomplete');
    const legacySkill = path.join(tmpDir, '.codex', 'skills', 'comet', 'SKILL.md');
    const canonicalConflict = path.join(tmpDir, '.agents', 'skills', 'comet', 'user-file.md');
    await fs.mkdir(path.dirname(legacySkill), { recursive: true });
    await fs.writeFile(legacySkill, '# Legacy Comet\n');
    await fs.mkdir(path.dirname(canonicalConflict), { recursive: true });
    await fs.writeFile(canonicalConflict, '# Keep\n');

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, {
        skipNpm: true,
        scope: 'project',
        installMode: 'symlink',
      });
    } finally {
      error.mockRestore();
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    await expect(fs.readFile(legacySkill, 'utf8')).resolves.toBe('# Legacy Comet\n');
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
    let output: string;
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
    let json: string;
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
    let json: string;
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

  it('does not run local npm installs for all-projects entries without project package dependencies', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-global-npm-once');
    const projectA = path.join(tmpDir, 'project-a-global-package');
    const projectB = path.join(tmpDir, 'project-b-global-package');

    for (const project of [projectA, projectB]) {
      await fs.mkdir(path.join(project, '.claude', 'skills', 'comet'), { recursive: true });
      await fs.writeFile(path.join(project, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
      await upsertProjectInstallation(project, [{ platform: 'claude', language: 'en' }], 'init', {
        homeDir: fakeHome,
      });
    }

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(projectA, { json: true, allProjects: true });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockedSpawn.mock.calls[0][1]).toEqual([
      'install',
      '-g',
      '@rpamis/comet@latest',
      '--registry',
      'https://registry.npmjs.org',
    ]);
    expect(mockedSpawn.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        expect.anything(),
        ['install', '@rpamis/comet@latest', '--registry', 'https://registry.npmjs.org'],
        expect.anything(),
      ]),
    );
  });

  it('reports global npm update failure before updating all indexed projects', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-global-npm-failure');
    const projectA = path.join(tmpDir, 'project-a-global-failure');
    const projectB = path.join(tmpDir, 'project-b-global-failure');

    for (const project of [projectA, projectB]) {
      await fs.mkdir(path.join(project, '.claude', 'skills', 'comet'), { recursive: true });
      await fs.writeFile(path.join(project, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
      await upsertProjectInstallation(project, [{ platform: 'claude', language: 'en' }], 'init', {
        homeDir: fakeHome,
      });
    }

    mockedSpawn.mockImplementationOnce(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 1));
      return child as ReturnType<typeof spawn>;
    });

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(projectA, { json: true, allProjects: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.projects).toEqual([
      expect.objectContaining({
        projectPath: path.resolve(projectA),
        status: 'failed',
        reason: expect.stringContaining('npm package update failed'),
      }),
    ]);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
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
    let json: string;
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

  it('keeps indexed projects when all-projects update cannot inspect installed targets', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-inspection-error');
    const project = path.join(tmpDir, 'project-inspection-error');
    const skillsDir = path.join(project, '.claude', 'skills');
    await fs.mkdir(path.join(skillsDir, 'comet'), { recursive: true });
    await fs.writeFile(path.join(skillsDir, 'comet', 'SKILL.md'), '# Comet', 'utf-8');
    await upsertProjectInstallation(project, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });

    const originalAccess = fs.access.bind(fs);
    const accessSpy = vi.spyOn(fs, 'access').mockImplementation(async (target) => {
      if (path.resolve(String(target)) === path.resolve(skillsDir)) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
      return originalAccess(target);
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(project, { json: true, skipNpm: true, allProjects: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
      accessSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.registry).toMatchObject({ projectsFound: 1, staleRemoved: 0 });
    expect(result.projects).toEqual([
      {
        projectPath: path.resolve(project),
        status: 'skipped',
        reason: 'unable to inspect project: permission denied',
        targets: [],
      },
    ]);

    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8')) as {
      projects: Array<{ path: string }>;
    };
    expect(registry.projects.map((entry) => entry.path)).toEqual([path.resolve(project)]);
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
    let json: string;
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
    let json: string;
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
    await fs.mkdir(path.join(fakeHome, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.agents', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# User\nKeep this.\n', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# User\nAlso keep this.\n', 'utf-8');

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
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
    let json: string;
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

  it('persists the installed language when updating global Comet skills', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(path.join(fakeHome, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\n当用户提出需求时使用这个技能。',
      'utf-8',
    );
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        scope: 'global',
        language: 'zh',
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    const config = await fs.readFile(path.join(fakeHome, '.comet', 'config.yaml'), 'utf-8');
    expect(config).toContain('language: zh-CN');
    await expect(fs.stat(path.join(fakeHome, 'docs', 'superpowers'))).rejects.toThrow();
  });

  it('re-persists an explicitly requested language even when the config already has a different one', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(path.join(fakeHome, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );
    await fs.mkdir(path.join(fakeHome, '.comet'), { recursive: true });
    await fs.writeFile(path.join(fakeHome, '.comet', 'config.yaml'), 'language: en\n', 'utf-8');

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        scope: 'global',
        language: 'zh',
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    const config = await fs.readFile(path.join(fakeHome, '.comet', 'config.yaml'), 'utf-8');
    expect(config).toContain('language: zh-CN');
  });

  it('does not guess a language when installed platforms in the same scope disagree and none is requested', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(path.join(fakeHome, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );
    await fs.mkdir(path.join(fakeHome, '.cursor', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.cursor', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\n当用户提出需求时使用这个技能。',
      'utf-8',
    );
    await fs.mkdir(path.join(fakeHome, '.comet'), { recursive: true });
    await fs.writeFile(path.join(fakeHome, '.comet', 'config.yaml'), 'language: en\n', 'utf-8');

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        scope: 'global',
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    const config = await fs.readFile(path.join(fakeHome, '.comet', 'config.yaml'), 'utf-8');
    expect(config).toContain('language: en');
  });
});
