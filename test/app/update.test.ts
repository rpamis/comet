import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { spawnSync } from 'node:child_process';
import { select } from '@inquirer/prompts';
import { parse } from 'yaml';
import { getLatestVersion } from '../../platform/version/version.js';
import { PLATFORMS, type Platform } from '../../platform/install/platforms.js';
import { installOpenSpec } from '../../domains/integrations/openspec.js';
import { installSuperpowersForPlatforms } from '../../domains/integrations/superpowers.js';
import {
  buildNpmUpdateArgs,
  detectCometPackageScope,
  detectInstalledCometLanguage,
  detectInstalledCometTargets,
  formatNpmUpdateCommand,
  formatSkillUpdateCommand,
  resolveNpmSelfUpdatePlan,
  updateCommand,
} from '../../app/commands/update.js';
import {
  getProjectRegistryPath,
  upsertProjectInstallation,
} from '../../platform/install/project-registry.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { assertClassicLayoutReadable } from '../../domains/comet-classic/classic-layout.js';

// Mock the interactive select prompt so tests don't hang on CI (no TTY).
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn().mockResolvedValue(false),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('exit', 0);
        child.emit('close', 0);
      });
      return child;
    }),
  };
});

vi.mock('../../platform/version/version.js', () => ({
  getCurrentVersion: vi.fn(() => '0.4.0-beta.7'),
  getLatestVersion: vi.fn(async () => '0.4.0-beta.8'),
  printVersionInfo: vi.fn(async () => ({
    currentVersion: '0.4.0-beta.7',
    latestVersion: '0.4.0-beta.8',
    hasUpdate: true,
    checked: true,
  })),
}));

vi.mock('../../domains/integrations/openspec.js', () => ({
  installOpenSpec: vi.fn(async () => 'installed'),
  isProjectMutationGuardError: vi.fn(
    (error: unknown) => (error as Error | undefined)?.name === 'ProjectMutationGuardError',
  ),
}));

vi.mock('../../domains/integrations/superpowers.js', () => ({
  installSuperpowersForPlatforms: vi.fn(async () => 'installed'),
}));

const mockedSelect = vi.mocked(select);
const mockedSpawn = vi.mocked(spawn);
const mockedGetLatestVersion = vi.mocked(getLatestVersion);
const mockedInstallOpenSpec = vi.mocked(installOpenSpec);
const mockedInstallSuperpowers = vi.mocked(installSuperpowersForPlatforms);

const claudePlatform: Platform = {
  id: 'claude',
  name: 'Claude Code',
  skillsDir: '.claude',
  openspecToolId: 'claude',
};

const manifestPath = path.resolve('assets', 'manifest.json');

const RETIRED_NATIVE_BUNDLES = [
  'comet-native/scripts/comet-native-checkpoint.mjs',
  'comet-native/scripts/comet-native-check.mjs',
  'comet-native/scripts/comet-native-evidence.mjs',
  'comet-native/scripts/comet-native-receipt.mjs',
] as const;

async function readManifest() {
  return JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as { skills: string[] };
}

type ComponentFailure = 'Skill' | 'Rule' | 'Hook';

async function writeFakeCometPackage(packageRoot: string, version: string): Promise<void> {
  await fs.mkdir(path.join(packageRoot, 'bin'), { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@rpamis/comet', version, bin: { comet: 'bin/comet.js' } }),
  );
  await fs.writeFile(path.join(packageRoot, 'bin', 'comet.js'), '#!/usr/bin/env node\n');
}

async function arrangeClassicDocsOpenSpecUpdate(projectPath: string): Promise<void> {
  await fs.mkdir(path.join(projectPath, '.comet'), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, '.comet', 'config.yaml'),
    [
      'schema: comet.project.v1',
      'default_workflow: classic',
      'workflows:',
      '  - classic',
      'ambient_resume: true',
      'classic:',
      '  artifact_layout: docs',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.mkdir(path.join(projectPath, 'docs', 'openspec'), { recursive: true });
  await fs.mkdir(path.join(projectPath, '.claude', 'skills', 'comet'), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, '.claude', 'skills', 'comet', 'SKILL.md'),
    '# Comet\n',
    'utf8',
  );
  await fs.mkdir(path.join(projectPath, '.claude', 'skills', 'openspec-propose'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectPath, '.claude', 'skills', 'openspec-propose', 'SKILL.md'),
    '# OpenSpec\n',
    'utf8',
  );
}

async function writeMockOpenSpecProject(
  projectPath: string,
  artifactLayout: 'legacy' | 'docs',
  config: 'healthy' | 'missing' | 'corrupt' = 'healthy',
): Promise<void> {
  const openSpecRoot =
    artifactLayout === 'docs'
      ? path.join(projectPath, 'docs', 'openspec')
      : path.join(projectPath, 'openspec');
  await fs.mkdir(path.join(openSpecRoot, 'changes', 'archive'), { recursive: true });
  if (config === 'healthy') {
    await fs.writeFile(path.join(openSpecRoot, 'config.yaml'), 'schema: spec-driven\n', 'utf8');
  } else if (config === 'corrupt') {
    await fs.writeFile(path.join(openSpecRoot, 'config.yaml'), 'schema: [broken\n', 'utf8');
  }
}

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
  let fakeGlobalNpmRoot: string;
  let candidateVersionOverride: string | null;
  let candidateCommandFailure: string | null;
  let candidateCommandHang: boolean;
  let candidateCommandOutputBytes: number | null;
  let candidateInstallHang: boolean;
  let candidateBinEscapesPackage: boolean;
  let targetInstallFailureVersion: string | null;
  let mutateProjectMetadataOnFailure: boolean;
  let delayGlobalRootClose: boolean;
  let releaseGlobalRootClose: (() => void) | null;
  let projectNpmRootOverride: string | null;
  let projectNpmPrefixOverride: string | null;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-update-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
    fakeGlobalNpmRoot = path.join(tmpDir, 'global node_modules & safe');
    await writeFakeCometPackage(path.join(fakeGlobalNpmRoot, '@rpamis', 'comet'), '0.4.0-beta.7');
    candidateVersionOverride = null;
    candidateCommandFailure = null;
    candidateCommandHang = false;
    candidateCommandOutputBytes = null;
    candidateInstallHang = false;
    candidateBinEscapesPackage = false;
    targetInstallFailureVersion = null;
    mutateProjectMetadataOnFailure = false;
    delayGlobalRootClose = false;
    releaseGlobalRootClose = null;
    projectNpmRootOverride = null;
    projectNpmPrefixOverride = null;
    mockedSelect.mockClear();
    mockedSpawn.mockClear();
    mockedGetLatestVersion.mockClear();
    mockedInstallOpenSpec.mockReset();
    mockedInstallOpenSpec.mockImplementation(async (projectPath, _toolIds, scope, options = {}) => {
      if (scope === 'project') {
        await writeMockOpenSpecProject(projectPath, options.artifactLayout ?? 'legacy');
      }
      return 'installed';
    });
    mockedInstallSuperpowers.mockReset();
    mockedInstallSuperpowers.mockResolvedValue('installed');
    mockedSpawn.mockImplementation((_command, args, options) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      let childClosed = false;
      child.kill = vi.fn(() => {
        queueMicrotask(() => {
          if (childClosed) return;
          childClosed = true;
          child.emit('close', null);
        });
        return true;
      });
      queueMicrotask(async () => {
        try {
          const commandArgs = (args ?? []) as string[];
          const firstArg = commandArgs[0] ?? '';
          const npmInvocation = path.basename(firstArg).toLowerCase() === 'npm-cli.js';
          const npmArgs = npmInvocation ? commandArgs.slice(1) : [];
          const cwd = String((options as { cwd?: string } | undefined)?.cwd ?? tmpDir);

          if (npmArgs[0] === 'root' && npmArgs[1] === '--global') {
            child.stdout.emit('data', Buffer.from(`${fakeGlobalNpmRoot}\n`));
            if (delayGlobalRootClose) {
              child.emit('exit', 0);
              await new Promise<void>((resolve) => {
                releaseGlobalRootClose = resolve;
              });
              child.emit('close', 0);
              return;
            }
          } else if (npmArgs[0] === 'root') {
            child.stdout.emit(
              'data',
              Buffer.from(`${projectNpmRootOverride ?? path.join(cwd, 'node_modules')}\n`),
            );
          } else if (npmArgs[0] === 'prefix') {
            child.stdout.emit('data', Buffer.from(`${projectNpmPrefixOverride ?? cwd}\n`));
          } else if (npmArgs[0] === 'install' && npmArgs.includes('--prefix')) {
            if (candidateInstallHang) return;
            const prefix = npmArgs[npmArgs.indexOf('--prefix') + 1];
            const packageSpec = npmArgs.find((arg) => arg.startsWith('@rpamis/comet@'))!;
            const requestedVersion = packageSpec.slice('@rpamis/comet@'.length);
            await writeFakeCometPackage(
              path.join(prefix, 'node_modules', '@rpamis', 'comet'),
              candidateVersionOverride ?? requestedVersion,
            );
            if (candidateBinEscapesPackage) {
              const packageRoot = path.join(prefix, 'node_modules', '@rpamis', 'comet');
              const outsideDir = path.join(tmpDir, 'candidate-bin-outside');
              await fs.mkdir(outsideDir, { recursive: true });
              await fs.writeFile(path.join(outsideDir, 'comet.js'), '#!/usr/bin/env node\n');
              await fs.writeFile(
                path.join(packageRoot, 'package.json'),
                JSON.stringify({
                  name: '@rpamis/comet',
                  version: candidateVersionOverride ?? requestedVersion,
                  bin: { comet: 'linked/comet.js' },
                }),
              );
              await fs.symlink(outsideDir, path.join(packageRoot, 'linked'), 'junction');
            }
          } else if (firstArg.endsWith(path.join('bin', 'comet.js'))) {
            const packageRoot = path.resolve(path.dirname(firstArg), '..');
            const pkg = JSON.parse(
              await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
            ) as { version: string };
            const cliArgs = commandArgs.slice(1);
            const label =
              cliArgs[0] === 'workflow'
                ? 'workflow'
                : cliArgs[0] === 'native'
                  ? 'native'
                  : 'version';
            if (candidateCommandFailure === label) {
              child.stderr.emit('data', Buffer.from(`candidate ${label} command failed\n`));
              child.emit('exit', 1);
              child.emit('close', 1);
              return;
            }
            if (candidateCommandHang && label === 'version') return;
            if (candidateCommandOutputBytes !== null && label === 'version') {
              child.stdout.emit('data', Buffer.alloc(candidateCommandOutputBytes, 120));
              return;
            }
            const output =
              label === 'version'
                ? `${pkg.version}\n`
                : label === 'workflow'
                  ? 'Usage: comet workflow resolve [options]\n'
                  : 'Usage: comet native <command> [options]\n';
            child.stdout.emit('data', Buffer.from(output));
          } else if (npmArgs[0] === 'install') {
            const packageSpec = npmArgs.find((arg) => arg.startsWith('@rpamis/comet@'))!;
            const requestedVersion = packageSpec.slice('@rpamis/comet@'.length);
            const packageRoot = npmArgs.includes('-g')
              ? path.join(fakeGlobalNpmRoot, '@rpamis', 'comet')
              : path.join(
                  projectNpmRootOverride ?? path.join(cwd, 'node_modules'),
                  '@rpamis',
                  'comet',
                );
            if (targetInstallFailureVersion === requestedVersion) {
              if (mutateProjectMetadataOnFailure && !npmArgs.includes('-g')) {
                await fs.writeFile(path.join(cwd, 'package.json'), '{"mutated":true}\n');
                await fs.writeFile(
                  path.join(projectNpmPrefixOverride ?? cwd, 'package-lock.json'),
                  '{"mutated":true}\n',
                );
              }
              child.stderr.emit('data', Buffer.from('npm ERR! EACCES permission denied\n'));
              child.emit('exit', 1);
              child.emit('close', 1);
              return;
            }
            await writeFakeCometPackage(packageRoot, requestedVersion);
          }

          child.emit('exit', 0);
          childClosed = true;
          child.emit('close', 0);
        } catch (error) {
          child.emit('error', error);
          child.emit('close', null);
        }
      });
      return child as ReturnType<typeof spawn>;
    });
    mockedGetLatestVersion.mockResolvedValue('0.4.0-beta.8');
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

  it('updates an explicitly scoped WorkBuddy project install and refreshes its project Hook', async () => {
    const projectDir = path.join(tmpDir, 'workbuddy-project');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(projectDir, {
        json: true,
        skipNpm: true,
        scope: 'project',
        platform: 'workbuddy',
      });
    } finally {
      log.mockRestore();
    }

    await expect(
      fs.access(path.join(projectDir, '.workbuddy', 'skills', 'comet', 'SKILL.md')),
    ).resolves.toBeUndefined();
    const settings = JSON.parse(
      await fs.readFile(path.join(projectDir, '.workbuddy', 'settings.json'), 'utf8'),
    );
    expect(settings.hooks.PreToolUse).toEqual([expect.objectContaining({ matcher: 'Write|Edit' })]);
  });

  it('updates Oh My Pi through the omp alias with native Skills, Rule, and Hook paths', async () => {
    const projectDir = path.join(tmpDir, 'oh-my-pi-project');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(projectDir, {
        json: true,
        skipNpm: true,
        scope: 'project',
        platform: 'omp',
      });
    } finally {
      log.mockRestore();
    }

    await expect(
      fs.access(path.join(projectDir, '.omp', 'skills', 'comet', 'SKILL.md')),
    ).resolves.toBeUndefined();
    const rule = await fs.readFile(
      path.join(projectDir, '.omp', 'rules', 'comet-workflow-guard.mdc'),
      'utf8',
    );
    expect(rule).toContain('alwaysApply: true');
    const hook = await fs.readFile(
      path.join(projectDir, '.omp', 'hooks', 'pre', 'comet-hook-router.ts'),
      'utf8',
    );
    expect(hook).toContain("'--platform', 'oh-my-pi'");
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
      '/.agents/skills/comet/scripts/comet-hook-router.mjs',
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

  it('removes the historical global Router when project update installs the replacement', async () => {
    const fakeHome = path.join(tmpDir, 'global-hook-migration-home');
    const globalHooksPath = path.join(fakeHome, '.codex', 'hooks.json');
    const userHook = { type: 'command', command: 'node user-hook.mjs' };
    const globalRouter = {
      type: 'command',
      command: `node "${path.join(
        fakeHome,
        '.agents',
        'skills',
        'comet',
        'scripts',
        'comet-hook-router.mjs',
      )}" --platform codex`,
    };
    await fs.mkdir(path.join(tmpDir, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md'), '# Comet\n');
    await fs.mkdir(path.dirname(globalHooksPath), { recursive: true });
    await fs.writeFile(
      globalHooksPath,
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [userHook, globalRouter] }] },
      }),
      'utf8',
    );
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { skipNpm: true, scope: 'project', platform: 'codex' });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const globalHooks = JSON.parse(await fs.readFile(globalHooksPath, 'utf8'));
    expect(globalHooks.hooks.PreToolUse[0].hooks).toEqual([userHook]);
    await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).resolves.toBeUndefined();
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

  it('blocks a prerelease downgrade before invoking npm', async () => {
    expect(resolveNpmSelfUpdatePlan('0.4.0-beta.7', '0.4.0-beta.6')).toEqual({
      action: 'skip',
      reason: 'registry version 0.4.0-beta.6 is older than current version 0.4.0-beta.7',
    });
  });

  it('covers self-update semver and package-scope decision branches', async () => {
    expect(resolveNpmSelfUpdatePlan('not-semver', '0.4.0')).toMatchObject({ action: 'fail' });
    expect(resolveNpmSelfUpdatePlan('0.4.0', 'not-semver')).toMatchObject({ action: 'fail' });
    expect(resolveNpmSelfUpdatePlan('0.4.0', '0.4.0')).toMatchObject({ action: 'skip' });
    expect(resolveNpmSelfUpdatePlan('0.4.0', '0.4.1')).toEqual({
      action: 'update',
      version: '0.4.1',
    });
    expect(resolveNpmSelfUpdatePlan('0.4.0-beta.10', '0.4.0-beta.2')).toMatchObject({
      action: 'skip',
    });
    expect(resolveNpmSelfUpdatePlan('0.4.0-alpha', '0.4.0-beta')).toMatchObject({
      action: 'update',
    });
    expect(resolveNpmSelfUpdatePlan('0.4.0-alpha.1', '0.4.0-alpha.beta')).toMatchObject({
      action: 'update',
    });

    const project = path.join(tmpDir, 'package-scope');
    await fs.mkdir(path.join(project, 'node_modules', '@rpamis', 'comet'), { recursive: true });
    await expect(
      detectCometPackageScope(project, path.join(project, 'node_modules', '@rpamis', 'comet')),
    ).resolves.toBe('project');
    await fs.rm(path.join(project, 'node_modules'), { recursive: true, force: true });
    await fs.writeFile(
      path.join(project, 'package.json'),
      JSON.stringify({ optionalDependencies: { '@rpamis/comet': '^0.4.0' } }),
    );
    await expect(detectCometPackageScope(project, path.join(tmpDir, 'other'))).resolves.toBe(
      'project',
    );
  });

  it('does not self-update the global package for an explicit current-project refresh', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');

    const fakeHome = path.join(tmpDir, 'fake-home-current-project-no-self-update');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        scope: 'skipped',
        status: 'skipped',
        command: null,
        reason: 'self-update disabled for current-project updates; pass --self-update to opt in',
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(mockedGetLatestVersion).not.toHaveBeenCalled();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('does not suppress the CodeGraph prompt when only package self-update is skipped', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    mockedSelect.mockResolvedValue(false as never);

    const fakeHome = path.join(tmpDir, 'fake-home-current-project-codegraph');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, installMode: 'copy' });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(mockedSelect).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('CodeGraph') }),
    );
    expect(mockedGetLatestVersion).not.toHaveBeenCalled();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('does not self-update for implicit JSON current-project mode even with global scope', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-implicit-current-global-scope');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { json: true, scope: 'global' });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        scope: 'skipped',
        status: 'skipped',
        reason: 'self-update disabled for current-project updates; pass --self-update to opt in',
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(mockedGetLatestVersion).not.toHaveBeenCalled();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('blocks registry prerelease downgrade when current-project explicitly opts into self-update', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    mockedGetLatestVersion.mockResolvedValue('0.4.0-beta.6');

    const fakeHome = path.join(tmpDir, 'fake-home-current-project-downgrade');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        scope: 'global',
        status: 'skipped',
        command: null,
        reason: 'registry version 0.4.0-beta.6 is older than current version 0.4.0-beta.7',
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(
      mockedSpawn.mock.calls.some((call) =>
        ((call[1] ?? []) as string[]).some((arg) => arg === 'install'),
      ),
    ).toBe(false);
  });

  it('compares against the actual installed global package instead of the running CLI version', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    await writeFakeCometPackage(path.join(fakeGlobalNpmRoot, '@rpamis', 'comet'), '0.4.0-beta.9');
    mockedGetLatestVersion.mockResolvedValue('0.4.0-beta.8');

    const fakeHome = path.join(tmpDir, 'fake-home-actual-global-version');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'skipped',
        reason: 'registry version 0.4.0-beta.8 is older than current version 0.4.0-beta.9',
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(mockedSpawn.mock.calls.some((call) => (call[1]?.slice(1) ?? [])[0] === 'install')).toBe(
      false,
    );
  });

  it('allows current-project to opt into a validated self-update explicitly', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');

    const fakeHome = path.join(tmpDir, 'fake-home-current-project-self-update');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        scope: 'global',
        status: 'updated',
        command: 'npm install -g @rpamis/comet@0.4.0-beta.8 --registry https://registry.npmjs.org',
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(mockedSpawn).toHaveBeenCalledTimes(6);
    expect(mockedSpawn.mock.calls.at(-1)?.[0]).toBe(process.execPath);
    expect(mockedSpawn.mock.calls.at(-1)?.[1]?.slice(1)).toEqual([
      'install',
      '-g',
      '@rpamis/comet@0.4.0-beta.8',
      '--registry',
      'https://registry.npmjs.org',
    ]);
    expect(mockedSpawn.mock.calls.every((call) => call[2]?.shell === false)).toBe(true);
    expect(mockedSpawn.mock.calls.every((call) => call[0] === process.execPath)).toBe(true);
    const candidateBinCalls = mockedSpawn.mock.calls.filter((call) =>
      String(call[1]?.[0]).endsWith(path.join('bin', 'comet.js')),
    );
    expect(candidateBinCalls).toHaveLength(3);
    expect(candidateBinCalls.every((call) => path.isAbsolute(String(call[1]?.[0])))).toBe(true);
  });

  it('does not mutate the installation when candidate command validation fails', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    candidateCommandFailure = 'native';

    const fakeHome = path.join(tmpDir, 'fake-home-invalid-candidate');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'failed',
        reason: expect.stringContaining('candidate native command failed'),
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const targetInstallCalls = mockedSpawn.mock.calls.filter((call) => {
      const npmArgs = call[1]?.slice(1) ?? [];
      return npmArgs[0] === 'install' && !npmArgs.includes('--prefix');
    });
    expect(targetInstallCalls).toHaveLength(0);
  });

  it('terminates candidate validation that exceeds the combined output budget', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    candidateCommandOutputBytes = 256 * 1024 + 1;

    const fakeHome = path.join(tmpDir, 'fake-home-candidate-output-limit');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'failed',
        reason: expect.stringContaining('process output exceeded 262144 bytes'),
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const targetInstallCalls = mockedSpawn.mock.calls.filter((call) => {
      const npmArgs = call[1]?.slice(1) ?? [];
      return npmArgs[0] === 'install' && !npmArgs.includes('--prefix');
    });
    expect(targetInstallCalls).toHaveLength(0);
  });

  it('terminates candidate validation after its dedicated timeout', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    candidateCommandHang = true;
    const realSetTimeout = globalThis.setTimeout;
    const timeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((
        callback: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => realSetTimeout(callback, delay === 15_000 ? 0 : delay, ...args)) as typeof setTimeout);

    const fakeHome = path.join(tmpDir, 'fake-home-candidate-timeout');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'failed',
        reason: expect.stringContaining('process timed out after 15000ms'),
      });
    } finally {
      timeoutSpy.mockRestore();
      log.mockRestore();
      homedirSpy.mockRestore();
    }
  });

  it('terminates a candidate npm install after its longer dedicated timeout', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    candidateInstallHang = true;
    const realSetTimeout = globalThis.setTimeout;
    const timeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((
        callback: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => realSetTimeout(callback, delay === 180_000 ? 0 : delay, ...args)) as typeof setTimeout);

    const fakeHome = path.join(tmpDir, 'fake-home-candidate-install-timeout');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'failed',
        reason: expect.stringContaining('process timed out after 180000ms'),
      });
    } finally {
      timeoutSpy.mockRestore();
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const targetInstallCalls = mockedSpawn.mock.calls.filter((call) => {
      const npmArgs = call[1]?.slice(1) ?? [];
      return npmArgs[0] === 'install' && !npmArgs.includes('--prefix');
    });
    expect(targetInstallCalls).toHaveLength(0);
  });

  it('rejects a candidate bin whose real path escapes the package root', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    candidateBinEscapesPackage = true;

    const fakeHome = path.join(tmpDir, 'fake-home-candidate-bin-escape');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'failed',
        reason: expect.stringContaining('Comet package bin is invalid: linked/comet.js'),
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    expect(
      mockedSpawn.mock.calls.some((call) => String(call[1]?.[0]).includes('candidate-bin-outside')),
    ).toBe(false);
  });

  it('waits for child close instead of resolving on exit', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    mockedGetLatestVersion.mockResolvedValue('0.4.0-beta.6');
    delayGlobalRootClose = true;

    const fakeHome = path.join(tmpDir, 'fake-home-close-wait');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let settled = false;
    try {
      const update = updateCommand(tmpDir, {
        currentProject: true,
        selfUpdate: true,
        json: true,
      }).then(() => {
        settled = true;
      });
      await vi.waitFor(() => expect(releaseGlobalRootClose).toBeTypeOf('function'));
      expect(settled).toBe(false);
      releaseGlobalRootClose?.();
      await update;
      expect(settled).toBe(true);
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }
  });

  it('retries candidate prefix cleanup without masking the validation error', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    candidateCommandFailure = 'native';
    const originalRm = fs.rm.bind(fs);
    let cleanupAttempts = 0;
    const rmSpy = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (String(target).includes('comet-self-update-')) {
        cleanupAttempts++;
        if (cleanupAttempts < 3) {
          throw Object.assign(new Error('temporary directory busy'), { code: 'EPERM' });
        }
      }
      return originalRm(target, options);
    });

    const fakeHome = path.join(tmpDir, 'fake-home-cleanup-retry');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm.reason).toContain('candidate native command failed');
      expect(result.npm.reason).not.toContain('temporary cleanup failed');
      expect(cleanupAttempts).toBe(3);
    } finally {
      rmSpy.mockRestore();
      log.mockRestore();
      homedirSpy.mockRestore();
    }
  });

  it('restores the exact current version when the npm install command fails', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    targetInstallFailureVersion = '0.4.0-beta.8';

    const fakeHome = path.join(tmpDir, 'fake-home-install-rollback');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'failed',
        reason: expect.stringContaining('restored 0.4.0-beta.7'),
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const installCalls = mockedSpawn.mock.calls.filter((call) => {
      const npmArgs = call[1]?.slice(1) ?? [];
      return npmArgs[0] === 'install' && !npmArgs.includes('--prefix');
    });
    expect(installCalls.map((call) => call[1]?.[3])).toEqual([
      '@rpamis/comet@0.4.0-beta.8',
      '@rpamis/comet@0.4.0-beta.7',
    ]);
  });

  it('restores project package metadata byte-for-byte after a failed project install', async () => {
    const projectDir = path.join(tmpDir, 'project with spaces & metadata');
    const packageJson = '{\n  "devDependencies": { "@rpamis/comet": "^0.4.0-beta.7" }\n}\n';
    const packageLock = '{"lockfileVersion":3,"name":"before"}\n';
    await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    await fs.writeFile(path.join(projectDir, 'package.json'), packageJson);
    await fs.writeFile(path.join(projectDir, 'package-lock.json'), packageLock);
    await writeFakeCometPackage(
      path.join(projectDir, 'node_modules', '@rpamis', 'comet'),
      '0.4.0-beta.7',
    );
    targetInstallFailureVersion = '0.4.0-beta.8';
    mutateProjectMetadataOnFailure = true;

    const fakeHome = path.join(tmpDir, 'fake-home-project-metadata');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(projectDir, {
        currentProject: true,
        selfUpdate: true,
        scope: 'project',
        json: true,
      });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'failed',
        reason: expect.stringContaining('restored 0.4.0-beta.7'),
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    await expect(fs.readFile(path.join(projectDir, 'package.json'), 'utf8')).resolves.toBe(
      packageJson,
    );
    await expect(fs.readFile(path.join(projectDir, 'package-lock.json'), 'utf8')).resolves.toBe(
      packageLock,
    );
    expect(mockedSpawn.mock.calls.every((call) => call[2]?.shell === false)).toBe(true);
  });

  it('reads a hoisted project package and restores workspace-root metadata after failure', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace with spaces');
    const projectDir = path.join(workspaceRoot, 'packages', 'app');
    const projectPackageJson = '{\n  "devDependencies": { "@rpamis/comet": "^0.4.0-beta.7" }\n}\n';
    const rootPackageJson = '{\n  "private": true, "workspaces": ["packages/*"]\n}\n';
    const rootPackageLock = '{"lockfileVersion":3,"name":"workspace-before"}\n';
    const config = defaultProjectConfig('.');
    config.workflows = ['classic'];
    config.default_workflow = 'classic';
    await fs.mkdir(projectDir, { recursive: true });
    await writeProjectConfig(projectDir, config);
    await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    await fs.writeFile(path.join(projectDir, 'package.json'), projectPackageJson);
    await fs.writeFile(path.join(workspaceRoot, 'package.json'), rootPackageJson);
    await fs.writeFile(path.join(workspaceRoot, 'package-lock.json'), rootPackageLock);
    projectNpmRootOverride = path.join(workspaceRoot, 'node_modules');
    projectNpmPrefixOverride = workspaceRoot;
    await writeFakeCometPackage(
      path.join(projectNpmRootOverride, '@rpamis', 'comet'),
      '0.4.0-beta.7',
    );
    targetInstallFailureVersion = '0.4.0-beta.8';
    mutateProjectMetadataOnFailure = true;

    const fakeHome = path.join(tmpDir, 'fake-home-workspace-metadata');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(projectDir, {
        currentProject: true,
        selfUpdate: true,
        scope: 'project',
        json: true,
      });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'failed',
        reason: expect.stringContaining('restored 0.4.0-beta.7'),
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    await expect(fs.readFile(path.join(projectDir, 'package.json'), 'utf8')).resolves.toBe(
      projectPackageJson,
    );
    await expect(fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf8')).resolves.toBe(
      rootPackageJson,
    );
    await expect(fs.readFile(path.join(workspaceRoot, 'package-lock.json'), 'utf8')).resolves.toBe(
      rootPackageLock,
    );
    expect(mockedSpawn.mock.calls.some((call) => call[1]?.slice(1).join(' ') === 'root')).toBe(
      true,
    );
    expect(mockedSpawn.mock.calls.some((call) => call[1]?.slice(1).join(' ') === 'prefix')).toBe(
      true,
    );
  });

  it('rejects a candidate whose installed package version does not exactly match the target', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    candidateVersionOverride = '0.4.0-beta.80';

    const fakeHome = path.join(tmpDir, 'fake-home-candidate-version-mismatch');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, selfUpdate: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.npm).toMatchObject({
        status: 'failed',
        reason: 'candidate package version mismatch: expected 0.4.0-beta.8, got 0.4.0-beta.80',
      });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const targetInstallCalls = mockedSpawn.mock.calls.filter((call) => {
      const npmArgs = call[1]?.slice(1) ?? [];
      return npmArgs[0] === 'install' && !npmArgs.includes('--prefix');
    });
    expect(targetInstallCalls).toHaveLength(0);
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

  it('reports npm stderr and an incomplete status when a JSON update fails', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    targetInstallFailureVersion = '0.4.0-beta.8';

    const fakeHome = path.join(tmpDir, 'fake-home-npm-json-failure');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { json: true, selfUpdate: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.status).toBe('incomplete');
      expect(result.npm).toMatchObject({
        status: 'failed',
        exitCode: 1,
        reason: expect.stringContaining('EACCES permission denied'),
      });
      expect(result.failures).toEqual([
        expect.objectContaining({ component: 'npm', reason: expect.stringContaining('EACCES') }),
      ]);
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }
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

    const installCalls = mockedSpawn.mock.calls.filter((call) => {
      const npmArgs = call[1]?.slice(1) ?? [];
      return npmArgs[0] === 'install' && !npmArgs.includes('--prefix');
    });
    expect(mockedSpawn).toHaveBeenCalledTimes(6);
    expect(installCalls).toHaveLength(1);
    expect(installCalls[0][1]?.slice(1)).toEqual([
      'install',
      '-g',
      '@rpamis/comet@0.4.0-beta.8',
      '--registry',
      'https://registry.npmjs.org',
    ]);
    expect(installCalls.some((call) => !(call[1]?.slice(1) ?? []).includes('-g'))).toBe(false);
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

    targetInstallFailureVersion = '0.4.0-beta.8';

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(projectA, { json: true, allProjects: true, selfUpdate: true });
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
      expect.objectContaining({
        projectPath: path.resolve(projectB),
        status: 'not_attempted',
        reason: expect.stringContaining('global npm package update failed'),
      }),
    ]);
    expect(result.status).toBe('incomplete');
    expect(mockedSpawn.mock.calls.some((call) => call[1]?.includes('-g'))).toBe(true);
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
        status: 'failed',
        reason: 'unable to inspect project: permission denied',
        targets: [],
      },
    ]);
    expect(result.status).toBe('incomplete');

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
      await updateCommand(projectA, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.mode).toBeUndefined();
    expect(result.skills.targets).toHaveLength(1);
    expect(result.npm).toMatchObject({
      scope: 'skipped',
      status: 'skipped',
      command: null,
      reason: 'self-update disabled for current-project updates; pass --self-update to opt in',
    });
    expect(mockedGetLatestVersion).not.toHaveBeenCalled();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('does not update global targets when the interactive scope selects current project', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-interactive-current-project');
    const projectSkill = path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md');
    const globalSkill = path.join(fakeHome, '.claude', 'skills', 'comet', 'SKILL.md');
    await fs.mkdir(path.dirname(projectSkill), { recursive: true });
    await fs.mkdir(path.dirname(globalSkill), { recursive: true });
    await fs.writeFile(projectSkill, '# Stale project Comet\n', 'utf8');
    await fs.writeFile(globalSkill, '# Stale global Comet\n', 'utf8');
    await upsertProjectInstallation(tmpDir, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockedSelect.mockResolvedValueOnce('current-project' as never);
    try {
      await updateCommand(tmpDir, { skipNpm: true, installMode: 'copy' });
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    await expect(fs.readFile(projectSkill, 'utf8')).resolves.toContain(
      'comet workflow resolve . --activate --json',
    );
    await expect(fs.readFile(globalSkill, 'utf8')).resolves.toBe('# Stale global Comet\n');
  });

  it('does not fall back to global targets when bare update has no indexed projects', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-no-indexed-projects');
    const globalSkill = path.join(fakeHome, '.claude', 'skills', 'comet', 'SKILL.md');
    await fs.mkdir(path.dirname(globalSkill), { recursive: true });
    await fs.writeFile(globalSkill, '# Stale global Comet\n', 'utf8');

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await updateCommand(tmpDir, { skipNpm: true, installMode: 'copy' });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    await expect(fs.readFile(globalSkill, 'utf8')).resolves.toBe('# Stale global Comet\n');
    expect(output!).toContain('No indexed Comet projects found');
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

  it('updates only the explicit native platform target', async () => {
    const fakeHome = path.join(tmpDir, 'explicit-native-home');
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Stale Claude Comet\n',
      'utf8',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        platform: 'codex',
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.skills.targets).toEqual([
      expect.objectContaining({ scope: 'project', platform: 'codex' }),
    ]);
    await expect(
      fs.readFile(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('comet workflow resolve . --activate --json');
    await expect(
      fs.readFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), 'utf8'),
    ).resolves.toBe('# Stale Claude Comet\n');
  });

  it('updates project-scoped custom platform workflow assets', async () => {
    const fakeHome = path.join(tmpDir, 'explicit-custom-home');
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        platform: 'test',
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.skills.targets).toEqual([
      expect.objectContaining({ scope: 'project', platform: 'test' }),
    ]);
    await expect(
      fs.access(path.join(tmpDir, '.test', 'skills', 'comet', 'SKILL.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmpDir, '.test', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmpDir, '.test', 'rules', 'comet-workflow-guard.md')),
    ).resolves.toBeUndefined();
    const settings = JSON.parse(
      await fs.readFile(path.join(tmpDir, '.test', 'settings.local.json'), 'utf8'),
    ) as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } };
    expect(JSON.stringify(settings.hooks)).toContain('comet-hook-router.mjs');
  });

  it('applies the project workflow selection to an explicit custom update target', async () => {
    const fakeHome = path.join(tmpDir, 'explicit-custom-both-home');
    const config = defaultProjectConfig('docs');
    config.workflows = ['native', 'classic'];
    config.default_workflow = 'native';
    await writeProjectConfig(tmpDir, config);

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        platform: 'test',
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.skills.targets).toEqual([
      expect.objectContaining({ scope: 'project', platform: 'test' }),
    ]);
    const manifest = await readManifest();
    for (const skillPath of manifest.skills) {
      await expect(
        fs.access(path.join(tmpDir, '.test', 'skills', skillPath)),
      ).resolves.toBeUndefined();
    }
  });

  it('updates installed OpenSpec platform assets against the configured docs artifact root', async () => {
    const fakeHome = path.join(tmpDir, 'classic-docs-update-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        selfUpdate: true,
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(mockedInstallOpenSpec).toHaveBeenCalledWith(
      tmpDir,
      ['claude'],
      'project',
      expect.objectContaining({
        shouldInstallCli: true,
        mirrorPlatformIds: [],
        artifactLayout: 'docs',
        projectMutationGuard: expect.any(Function),
        selectedPlatformIds: ['claude'],
      }),
    );
    await expect(fs.access(path.join(tmpDir, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not update Classic dependencies during a regular Comet update', async () => {
    const fakeHome = path.join(tmpDir, 'classic-dependencies-regular-update-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'brainstorming'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'brainstorming', 'SKILL.md'),
      '# Brainstorming\n',
      'utf8',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        skipNpm: true,
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(mockedInstallOpenSpec).not.toHaveBeenCalled();
    expect(mockedInstallSuperpowers).not.toHaveBeenCalled();
    expect(JSON.parse(json)).toMatchObject({
      status: 'complete',
      openspec: { status: 'skipped' },
      superpowers: { status: 'skipped' },
    });
  });

  it('updates installed Classic dependencies with explicit self-update', async () => {
    const fakeHome = path.join(tmpDir, 'classic-dependencies-self-update-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'brainstorming'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'brainstorming', 'SKILL.md'),
      '# Brainstorming\n',
      'utf8',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        selfUpdate: true,
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(mockedInstallOpenSpec).toHaveBeenCalledWith(
      tmpDir,
      ['claude'],
      'project',
      expect.objectContaining({
        shouldInstallCli: true,
        mirrorPlatformIds: [],
        artifactLayout: 'docs',
        projectMutationGuard: expect.any(Function),
        selectedPlatformIds: ['claude'],
      }),
    );
    expect(mockedInstallSuperpowers).toHaveBeenCalledWith(tmpDir, 'project', ['claude'], true);
  });

  it('updates dsh Classic dependencies through the Claude-shaped OpenSpec contract', async () => {
    const fakeHome = path.join(tmpDir, 'dsh-classic-dependencies-self-update-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    await fs.mkdir(path.join(tmpDir, '.dsh', 'skills', 'comet-classic'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.dsh', 'skills', 'comet-classic', 'SKILL.md'),
      '# Comet Classic\n',
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.dsh', 'skills', 'openspec-propose'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.dsh', 'skills', 'openspec-propose', 'SKILL.md'),
      '# OpenSpec\n',
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.dsh', 'skills', 'brainstorming'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.dsh', 'skills', 'brainstorming', 'SKILL.md'),
      '# Brainstorming\n',
      'utf8',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        platform: 'dsh',
        selfUpdate: true,
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(mockedInstallOpenSpec).toHaveBeenCalledWith(
      tmpDir,
      ['claude'],
      'project',
      expect.objectContaining({
        shouldInstallCli: true,
        mirrorPlatformIds: [],
        artifactLayout: 'docs',
        projectMutationGuard: expect.any(Function),
        selectedPlatformIds: ['dsh'],
      }),
    );
    expect(mockedInstallSuperpowers).toHaveBeenCalledWith(tmpDir, 'project', ['dsh'], true);
  });

  it.each(['missing', 'corrupt'] as const)(
    'leaves project config unchanged when OpenSpec reports installed with a %s config',
    async (openSpecConfig) => {
      const fakeHome = path.join(tmpDir, `classic-docs-${openSpecConfig}-home`);
      await arrangeClassicDocsOpenSpecUpdate(tmpDir);
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      const configBefore = await fs.readFile(configPath, 'utf8');
      mockedInstallOpenSpec.mockImplementationOnce(
        async (projectPath, _toolIds, scope, options = {}) => {
          if (scope === 'project') {
            await writeMockOpenSpecProject(
              projectPath,
              options.artifactLayout ?? 'legacy',
              openSpecConfig,
            );
          }
          return 'installed';
        },
      );

      const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let json: string;
      try {
        await updateCommand(tmpDir, {
          currentProject: true,
          installMode: 'copy',
          language: 'zh',
          json: true,
          selfUpdate: true,
        });
        json = log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
        homeSpy.mockRestore();
      }

      expect(JSON.parse(json)).toMatchObject({
        status: 'incomplete',
        openspec: {
          status: 'failed',
          reason: expect.stringMatching(/OpenSpec root is unhealthy/iu),
        },
      });
      await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(configBefore);
    },
  );

  it('upgrades a legacy partial Native and Classic project config without moving its root', async () => {
    const fakeHome = path.join(tmpDir, 'classic-legacy-partial-home');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        '  language: en',
        'language: zh-CN',
        'context_compression: beta',
        'review_mode: thorough',
        'auto_transition: false',
        'custom_top: keep',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n',
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'openspec-propose'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md'),
      '# OpenSpec\n',
      'utf8',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        language: 'zh',
        json: true,
        selfUpdate: true,
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(JSON.parse(json)).toMatchObject({ status: 'complete' });
    const config = parse(await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8'));
    expect(config).toMatchObject({
      schema: 'comet.project.v1',
      default_workflow: 'native',
      workflows: ['native', 'classic'],
      native: {
        artifact_root: 'docs',
        language: 'en',
      },
      classic: {
        artifact_layout: 'legacy',
        language: 'zh-CN',
        context_compression: 'beta',
        review_mode: 'thorough',
        auto_transition: false,
      },
      custom_top: 'keep',
    });
    await expect(assertClassicLayoutReadable(tmpDir)).resolves.toMatchObject({
      artifactLayout: 'legacy',
      openSpecRoot: path.join(tmpDir, 'openspec'),
    });
    expect(mockedInstallOpenSpec).toHaveBeenCalledWith(
      tmpDir,
      ['claude'],
      'project',
      expect.objectContaining({
        shouldInstallCli: true,
        mirrorPlatformIds: [],
        artifactLayout: 'legacy',
        projectMutationGuard: expect.any(Function),
        selectedPlatformIds: ['claude'],
      }),
    );
    await expect(fs.access(path.join(tmpDir, 'docs', 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('backfills every managed Native and Classic default with the docs layout', async () => {
    const fakeHome = path.join(tmpDir, 'partial-config-defaults-home');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      ['default_workflow: native', 'native:', '  custom_native: keep', 'custom_top: keep', ''].join(
        '\n',
      ),
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n',
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'openspec-propose'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md'),
      '# OpenSpec\n',
      'utf8',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        language: 'en',
        json: true,
        selfUpdate: true,
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(JSON.parse(json)).toMatchObject({ status: 'complete' });
    const config = parse(await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8'));
    expect(config).toMatchObject({
      schema: 'comet.project.v1',
      default_workflow: 'native',
      workflows: ['native', 'classic'],
      ambient_resume: true,
      native: {
        artifact_root: 'docs',
        language: 'en',
        clarification_mode: 'batch',
        archive_confirmation: 'automatic',
        max_verify_failures: 5,
      },
      classic: {
        artifact_layout: 'docs',
        language: 'en',
        context_compression: 'off',
        review_mode: 'standard',
        auto_transition: true,
      },
      custom_top: 'keep',
    });
    await expect(assertClassicLayoutReadable(tmpDir)).resolves.toMatchObject({
      artifactLayout: 'docs',
      openSpecRoot: path.join(tmpDir, 'docs', 'openspec'),
    });
    expect(mockedInstallOpenSpec).toHaveBeenCalledWith(
      tmpDir,
      ['claude'],
      'project',
      expect.objectContaining({
        shouldInstallCli: true,
        mirrorPlatformIds: [],
        artifactLayout: 'docs',
        projectMutationGuard: expect.any(Function),
        selectedPlatformIds: ['claude'],
      }),
    );
  });

  it('updates the configured Classic root when both roots exist', async () => {
    const fakeHome = path.join(tmpDir, 'classic-dual-root-update-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'openspec', 'legacy-marker.txt'), 'legacy\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'docs', 'openspec', 'docs-marker.txt'), 'docs\n', 'utf8');
    const configPath = path.join(tmpDir, '.comet', 'config.yaml');
    const managedSkillPath = path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md');
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        selfUpdate: true,
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(JSON.parse(json)).toMatchObject({
      status: 'complete',
      openspec: { status: 'installed' },
      failures: [],
    });
    expect(mockedInstallOpenSpec).toHaveBeenCalledWith(
      tmpDir,
      ['claude'],
      'project',
      expect.objectContaining({
        shouldInstallCli: true,
        mirrorPlatformIds: [],
        artifactLayout: 'docs',
        projectMutationGuard: expect.any(Function),
        selectedPlatformIds: ['claude'],
      }),
    );
    await expect(
      fs.readFile(path.join(tmpDir, 'openspec', 'legacy-marker.txt'), 'utf8'),
    ).resolves.toBe('legacy\n');
    await expect(
      fs.readFile(path.join(tmpDir, 'docs', 'openspec', 'docs-marker.txt'), 'utf8'),
    ).resolves.toBe('docs\n');
    expect(parse(await fs.readFile(configPath, 'utf8'))).toMatchObject({
      classic: { artifact_layout: 'docs' },
    });
    await expect(fs.readFile(managedSkillPath, 'utf8')).resolves.toContain('# Comet');
  });

  it('rejects a project .comet junction without touching the external config or OpenSpec', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-update-config-outside-'));
    const source = [
      'schema: comet.project.v1',
      'default_workflow: classic',
      'workflows: [classic]',
      'classic:',
      '  artifact_layout: docs',
      '',
    ].join('\n');
    try {
      await fs.writeFile(path.join(outsideRoot, 'config.yaml'), source, 'utf8');
      await fs.writeFile(path.join(outsideRoot, 'marker.txt'), 'keep\n', 'utf8');
      try {
        await fs.symlink(
          outsideRoot,
          path.join(tmpDir, '.comet'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(
        updateCommand(tmpDir, {
          currentProject: true,
          installMode: 'copy',
          json: true,
          skipNpm: true,
        }),
      ).rejects.toThrow(/symbolic link or junction/iu);
      expect(mockedInstallOpenSpec).not.toHaveBeenCalled();
      await expect(fs.readFile(path.join(outsideRoot, 'config.yaml'), 'utf8')).resolves.toBe(
        source,
      );
      await expect(fs.readFile(path.join(outsideRoot, 'marker.txt'), 'utf8')).resolves.toBe(
        'keep\n',
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a project config symlink without touching its external target or OpenSpec', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-update-file-outside-'));
    const outsideConfig = path.join(outsideRoot, 'config.yaml');
    const source = [
      'schema: comet.project.v1',
      'default_workflow: classic',
      'workflows: [classic]',
      'classic:',
      '  artifact_layout: docs',
      '',
    ].join('\n');
    try {
      await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
      await fs.writeFile(outsideConfig, source, 'utf8');
      try {
        await fs.symlink(outsideConfig, path.join(tmpDir, '.comet', 'config.yaml'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(
        updateCommand(tmpDir, {
          currentProject: true,
          installMode: 'copy',
          json: true,
          skipNpm: true,
        }),
      ).rejects.toThrow(/symbolic link or junction/iu);
      expect(mockedInstallOpenSpec).not.toHaveBeenCalled();
      await expect(fs.readFile(outsideConfig, 'utf8')).resolves.toBe(source);
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('refreshes only the Classic artifact root when no OpenSpec tool assets are installed', async () => {
    const fakeHome = path.join(tmpDir, 'classic-docs-no-openspec-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    await fs.rm(path.join(tmpDir, '.claude', 'skills', 'openspec-propose'), {
      recursive: true,
      force: true,
    });

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        selfUpdate: true,
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(mockedInstallOpenSpec).toHaveBeenCalledWith(
      tmpDir,
      [],
      'project',
      expect.objectContaining({
        shouldInstallCli: true,
        mirrorPlatformIds: [],
        artifactLayout: 'docs',
        projectMutationGuard: expect.any(Function),
        selectedPlatformIds: [],
      }),
    );
  });

  it('keeps config unchanged when an artifact-only OpenSpec refresh cannot run', async () => {
    const fakeHome = path.join(tmpDir, 'classic-docs-artifact-only-missing-cli-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    await fs.rm(path.join(tmpDir, '.claude', 'skills', 'openspec-propose'), {
      recursive: true,
      force: true,
    });
    const configPath = path.join(tmpDir, '.comet', 'config.yaml');
    const configBefore = await fs.readFile(configPath);
    mockedInstallOpenSpec.mockResolvedValue('skipped');

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        language: 'zh',
        json: true,
        selfUpdate: true,
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(JSON.parse(json)).toMatchObject({
      status: 'incomplete',
      openspec: {
        status: 'failed',
        reason: expect.stringContaining('CLI'),
      },
    });
    expect(mockedInstallOpenSpec).toHaveBeenCalledWith(
      tmpDir,
      [],
      'project',
      expect.objectContaining({
        shouldInstallCli: true,
        mirrorPlatformIds: [],
        artifactLayout: 'docs',
        projectMutationGuard: expect.any(Function),
        selectedPlatformIds: [],
      }),
    );
    await expect(fs.readFile(configPath)).resolves.toEqual(configBefore);
  });

  it('fails closed when installed OpenSpec assets cannot be refreshed because the CLI is missing', async () => {
    const fakeHome = path.join(tmpDir, 'classic-docs-missing-openspec-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    mockedInstallOpenSpec.mockResolvedValue('skipped');

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        selfUpdate: true,
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(JSON.parse(json)).toMatchObject({
      status: 'incomplete',
      openspec: {
        status: 'failed',
        reason: expect.stringContaining('CLI'),
      },
      failures: [expect.objectContaining({ component: 'OpenSpec' })],
    });
  });

  it('reports an OpenSpec integration failure as an incomplete update', async () => {
    const fakeHome = path.join(tmpDir, 'classic-docs-failed-openspec-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    mockedInstallOpenSpec.mockResolvedValue('failed');

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        selfUpdate: true,
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(JSON.parse(json)).toMatchObject({
      status: 'incomplete',
      openspec: { status: 'failed' },
      failures: [expect.objectContaining({ component: 'OpenSpec' })],
    });
  });

  it('reports a thrown OpenSpec adapter error without falling back to the legacy root', async () => {
    const fakeHome = path.join(tmpDir, 'classic-docs-throwing-openspec-home');
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    mockedInstallOpenSpec.mockRejectedValue(new Error('adapter exploded'));

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        selfUpdate: true,
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(JSON.parse(json)).toMatchObject({
      status: 'incomplete',
      openspec: {
        status: 'failed',
        reason: expect.stringContaining('adapter exploded'),
      },
      failures: [expect.objectContaining({ component: 'OpenSpec' })],
    });
    await expect(fs.access(path.join(tmpDir, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('updates installed OpenSpec assets at global scope without initializing a project root', async () => {
    const fakeHome = path.join(tmpDir, 'classic-global-openspec-home');
    await fs.mkdir(path.join(fakeHome, '.claude', 'skills', 'openspec-propose'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(fakeHome, '.claude', 'skills', 'openspec-propose', 'SKILL.md'),
      '# OpenSpec\n',
      'utf8',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, {
        scope: 'global',
        platform: 'claude',
        json: true,
        selfUpdate: true,
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(mockedInstallOpenSpec).toHaveBeenCalledWith(
      tmpDir,
      ['claude'],
      'global',
      expect.objectContaining({
        shouldInstallCli: true,
        mirrorPlatformIds: [],
        artifactLayout: 'legacy',
        projectMutationGuard: undefined,
        selectedPlatformIds: ['claude'],
      }),
    );
    await expect(fs.access(path.join(tmpDir, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects custom platform targets for global update', async () => {
    await expect(
      updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        scope: 'global',
        platform: 'test',
      }),
    ).rejects.toThrow('custom --platform targets are only supported with project scope');
  });

  it('reports no indexed projects in JSON when no project installation is found', async () => {
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
      mode: 'all-projects',
      status: 'complete',
      registry: {
        projectsFound: 0,
        staleRemoved: 0,
      },
      projects: [],
      reason: 'no indexed Comet projects found',
    });
  });

  it('does not backfill an unindexed project config through a global-only installation', async () => {
    const fakeHome = path.join(tmpDir, 'global-config-refresh-home');
    await fs.mkdir(path.join(fakeHome, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n',
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    const originalConfig = [
      'default_workflow: classic',
      'language: zh-CN',
      'context_compression: beta',
      '',
    ].join('\n');
    await fs.writeFile(path.join(tmpDir, '.comet', 'config.yaml'), originalConfig, 'utf8');
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'docs', 'openspec'), { recursive: true });

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { installMode: 'copy', skipNpm: true });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(mockedSelect).not.toHaveBeenCalled();
    await expect(fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8')).resolves.toBe(
      originalConfig,
    );
    await expect(
      fs.readFile(path.join(fakeHome, '.claude', 'skills', 'comet', 'SKILL.md'), 'utf8'),
    ).resolves.toBe('# Comet\n');
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

  it('updates Native project Skills and shared config comments without rewriting Classic state', async () => {
    const fakeHome = path.join(tmpDir, 'native-update-home');
    const nativeConfig = [
      'schema: comet.project.v1',
      'default_workflow: native',
      'native:',
      '  artifact_root: docs',
      'language: legacy',
      'keep: true',
      '',
    ].join('\n');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'config.yaml'), nativeConfig, 'utf8');
    const selectionPath = path.join(tmpDir, '.comet', 'current-change.json');
    const legacySelection = `${JSON.stringify({ version: 1, change: 'legacy-change', branch: null })}\n`;
    await fs.writeFile(selectionPath, legacySelection, 'utf8');

    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Stale Comet\n',
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet-classic'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet-classic', 'keep.md'),
      'keep classic history\n',
      'utf8',
    );

    await fs.mkdir(path.join(tmpDir, 'docs', 'superpowers'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'keep.md'),
      'keep classic working files\n',
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.claude', 'rules'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'rules', 'comet-phase-guard.md'),
      'keep classic rule\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      '{"keep":"classic hook"}\n',
      'utf8',
    );
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# User\nKeep this.\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# User\nAlso keep this.\n', 'utf8');

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'symlink',
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    await expect(
      fs.readFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('comet workflow resolve . --activate --json');
    await expect(
      fs.readFile(path.join(tmpDir, '.claude', 'skills', 'comet-native', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('name: comet-native');
    await expect(
      fs.readFile(path.join(tmpDir, '.claude', 'skills', 'comet-any', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('name: comet-any');
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills', 'comet-classic', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.readFile(path.join(tmpDir, '.claude', 'skills', 'comet-classic', 'keep.md'), 'utf8'),
    ).resolves.toBe('keep classic history\n');
    await expect(fs.access(path.join(tmpDir, '.comet', 'skills'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const updatedConfig = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8');
    expect(updatedConfig).toContain(
      '# Enables automatic recovery through the read-only Ambient Resume probe',
    );
    expect(updatedConfig).toContain('ambient_resume: true');
    expect(updatedConfig).toContain('keep: true');
    expect(updatedConfig).toContain('artifact_root: docs');
    expect(updatedConfig).toContain('clarification_mode: batch');
    expect(updatedConfig).not.toContain('classic:');
    expect(updatedConfig).toContain('language: legacy');
    await expect(
      fs.readFile(path.join(tmpDir, 'docs', 'superpowers', 'keep.md'), 'utf8'),
    ).resolves.toBe('keep classic working files\n');
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'rules', 'comet-phase-guard.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'rules', 'comet-native-phase-guard.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'rules', 'comet-workflow-guard.md')),
    ).resolves.toBeUndefined();
    const settings = JSON.parse(
      await fs.readFile(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf8'),
    ) as { keep: string; hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } };
    expect(settings.keep).toBe('classic hook');
    expect(JSON.stringify(settings.hooks)).toContain('comet-hook-router.mjs');
    expect(JSON.stringify(settings.hooks)).not.toContain('comet-native-hook-guard.mjs');
    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    const claude = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    for (const content of [agents, claude]) {
      expect(content).toContain('<comet-ambient-resume>');
      expect(content).toContain('comet resume-probe . --stdin --json');
      expect(content).toContain('Trust only the returned `workflow`, `skill`');
      expect(content).toContain('permanent entry in `nextCommand`');
      expect(content).not.toContain('`.comet.yaml`');
    }
    expect(agents).toContain('# User\nKeep this.');
    expect(claude).toContain('# User\nAlso keep this.');
    expect(mockedSelect).not.toHaveBeenCalled();
    await expect(fs.readFile(selectionPath, 'utf8')).resolves.toBe(legacySelection);
  });

  it('upgrades a beta17 Native project without leaving retired bundles or hiding config', async () => {
    expect(spawnSync('git', ['init'], { cwd: tmpDir }).status).toBe(0);
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: .',
        '  snapshot:',
        '    include: ["**/*"]',
        '    exclude: ["custom/generated/**"]',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet\n');
    const installedSkillsRoot = path.join(tmpDir, '.claude', 'skills');
    const userBundle = path.join(installedSkillsRoot, 'comet-native', 'scripts', 'user-helper.mjs');
    await fs.mkdir(path.dirname(userBundle), { recursive: true });
    for (const relativePath of RETIRED_NATIVE_BUNDLES) {
      await fs.writeFile(
        path.join(installedSkillsRoot, ...relativePath.split('/')),
        'legacy bundle\n',
        'utf8',
      );
    }
    await fs.writeFile(userBundle, 'keep user content\n', 'utf8');
    await fs.writeFile(
      path.join(tmpDir, '.gitignore'),
      ['node_modules/', '.comet/', 'dist/', ''].join('\n'),
      'utf8',
    );
    for (const relativePath of [
      '.comet/runtime/native/locks/demo.lock',
      '.comet/runtime/native/logs/demo.log',
    ]) {
      const target = path.join(tmpDir, ...relativePath.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `${relativePath}\n`, 'utf8');
    }

    const fakeHome = path.join(tmpDir, 'native-snapshot-update-home');
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'symlink',
        skipNpm: true,
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    const updated = parse(
      await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8'),
    ) as {
      native: { snapshot?: unknown };
    };
    expect(updated.native.snapshot).toBeUndefined();
    for (const relativePath of RETIRED_NATIVE_BUNDLES) {
      await expect(
        fs.access(path.join(installedSkillsRoot, ...relativePath.split('/'))),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(fs.readFile(userBundle, 'utf8')).resolves.toBe('keep user content\n');

    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/\n');
    expect(gitignore).toContain('dist/\n');
    expect(gitignore).toContain('!/.comet/config.yaml\n');
    expect(
      spawnSync('git', ['check-ignore', '--quiet', '.comet/config.yaml'], { cwd: tmpDir }).status,
    ).toBe(1);
    for (const relativePath of [
      '.comet/runtime/native/locks/demo.lock',
      '.comet/runtime/native/logs/demo.log',
    ]) {
      expect(
        spawnSync('git', ['check-ignore', '--quiet', relativePath], { cwd: tmpDir }).status,
        relativePath,
      ).toBe(0);
    }
  });

  it('migrates Classic v1 selection after update installs the project Router', async () => {
    const fakeHome = path.join(tmpDir, 'classic-update-home');
    const config = defaultProjectConfig('.');
    config.workflows = ['classic'];
    config.default_workflow = 'classic';
    await writeProjectConfig(tmpDir, config);
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Stale Comet\n',
    );
    const selectionPath = path.join(tmpDir, '.comet', 'current-change.json');
    await fs.writeFile(
      selectionPath,
      `${JSON.stringify({ version: 1, change: 'legacy-change', branch: null })}\n`,
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, { currentProject: true, installMode: 'copy', skipNpm: true });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(JSON.parse(await fs.readFile(selectionPath, 'utf8'))).toEqual({
      schema: 'comet.selection.v2',
      workflow: 'classic',
      change: 'legacy-change',
      branch: null,
    });
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'settings.local.json')),
    ).resolves.toBeUndefined();
  });

  it('keeps Classic v1 selection when historical global Hook cleanup fails', async () => {
    const fakeHome = path.join(tmpDir, 'classic-hook-cleanup-failure-home');
    const config = defaultProjectConfig('.');
    config.workflows = ['classic'];
    config.default_workflow = 'classic';
    await writeProjectConfig(tmpDir, config);
    await fs.mkdir(path.join(tmpDir, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md'),
      '# Stale Comet\n',
    );
    const selectionPath = path.join(tmpDir, '.comet', 'current-change.json');
    const legacySelection = `${JSON.stringify({ version: 1, change: 'legacy-change', branch: null })}\n`;
    await fs.writeFile(selectionPath, legacySelection, 'utf8');
    const globalLegacyPath = path.join(fakeHome, '.codex', 'settings.local.json');
    await fs.mkdir(path.dirname(globalLegacyPath), { recursive: true });
    await fs.writeFile(globalLegacyPath, '{not-json', 'utf8');

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let result;
    try {
      result = await updateCommand(tmpDir, {
        skipNpm: true,
        scope: 'project',
        platform: 'codex',
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(result!.status).toBe('incomplete');
    await expect(fs.readFile(selectionPath, 'utf8')).resolves.toBe(legacySelection);
    await expect(fs.readFile(globalLegacyPath, 'utf8')).resolves.toBe('{not-json');
    await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).resolves.toBeUndefined();
  });

  it('migrates manifest-managed legacy Codex Skills for Native without touching unrelated state', async () => {
    const fakeHome = path.join(tmpDir, 'native-codex-migration-home');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        'keep: classic',
        '',
      ].join('\n'),
      'utf8',
    );
    const legacyComet = path.join(tmpDir, '.codex', 'skills', 'comet');
    const legacyPersonal = path.join(tmpDir, '.codex', 'skills', 'personal');
    const legacyOpenSpec = path.join(tmpDir, '.codex', 'skills', 'openspec');
    await fs.mkdir(legacyComet, { recursive: true });
    await fs.mkdir(legacyPersonal, { recursive: true });
    await fs.mkdir(legacyOpenSpec, { recursive: true });
    await fs.writeFile(path.join(legacyComet, 'SKILL.md'), '# Legacy thick Comet\n', 'utf8');
    await fs.writeFile(path.join(legacyPersonal, 'SKILL.md'), '# Personal\n', 'utf8');
    await fs.writeFile(path.join(legacyOpenSpec, 'SKILL.md'), '# OpenSpec\n', 'utf8');
    await fs.mkdir(path.join(tmpDir, 'docs', 'superpowers'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'keep.md'),
      'keep classic state\n',
      'utf8',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await updateCommand(tmpDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        skipNpm: true,
      });
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    await expect(
      fs.readFile(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('comet workflow resolve . --activate --json');
    await expect(fs.access(legacyComet)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(legacyPersonal, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# Personal\n',
    );
    await expect(fs.readFile(path.join(legacyOpenSpec, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# OpenSpec\n',
    );
    await expect(
      fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8'),
    ).resolves.toContain('keep: classic');
    await expect(
      fs.readFile(path.join(tmpDir, 'docs', 'superpowers', 'keep.md'), 'utf8'),
    ).resolves.toBe('keep classic state\n');
  });

  it.each(['skills-root', 'managed-entry'] as const)(
    'converts an old %s symlink installation to Native copies without writing through it',
    async (layout) => {
      const fakeHome = path.join(tmpDir, `native-symlink-${layout}-home`);
      await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          'native:',
          '  artifact_root: docs',
          '',
        ].join('\n'),
        'utf8',
      );
      const centralSkills = path.join(tmpDir, '.comet', 'skills', 'skills');
      const centralComet = path.join(centralSkills, 'comet');
      const platformSkills = path.join(tmpDir, '.claude', 'skills');
      await fs.mkdir(centralComet, { recursive: true });
      await fs.writeFile(path.join(centralComet, 'SKILL.md'), '# Central stale Comet\n', 'utf8');
      await fs.mkdir(path.dirname(platformSkills), { recursive: true });
      if (layout === 'skills-root') {
        await fs.symlink(
          centralSkills,
          platformSkills,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } else {
        await fs.mkdir(platformSkills, { recursive: true });
        await fs.symlink(
          centralComet,
          path.join(platformSkills, 'comet'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        await fs.mkdir(path.join(platformSkills, 'personal'), { recursive: true });
        await fs.writeFile(
          path.join(platformSkills, 'personal', 'SKILL.md'),
          '# Personal\n',
          'utf8',
        );
      }

      const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let json: string;
      try {
        await updateCommand(tmpDir, {
          currentProject: true,
          installMode: 'symlink',
          json: true,
          skipNpm: true,
        });
        json = log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
        homeSpy.mockRestore();
      }

      expect(JSON.parse(json).skills.installMode).toBe('copy');
      expect((await fs.lstat(platformSkills)).isSymbolicLink()).toBe(false);
      expect((await fs.lstat(path.join(platformSkills, 'comet'))).isSymbolicLink()).toBe(false);
      await expect(
        fs.readFile(path.join(platformSkills, 'comet', 'SKILL.md'), 'utf8'),
      ).resolves.toContain('comet workflow resolve . --activate --json');
      await expect(fs.readFile(path.join(centralComet, 'SKILL.md'), 'utf8')).resolves.toBe(
        '# Central stale Comet\n',
      );
      await expect(
        fs.access(path.join(centralSkills, 'comet-native', 'SKILL.md')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      if (layout === 'managed-entry') {
        await expect(
          fs.readFile(path.join(platformSkills, 'personal', 'SKILL.md'), 'utf8'),
        ).resolves.toBe('# Personal\n');
      }
    },
  );

  it('refuses to detach a shared Skill-root symlink that contains unmanaged Skills', async () => {
    const fakeHome = path.join(tmpDir, 'native-shared-symlink-home');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    const centralSkills = path.join(tmpDir, '.comet', 'skills', 'skills');
    const platformSkills = path.join(tmpDir, '.claude', 'skills');
    await fs.mkdir(path.join(centralSkills, 'comet'), { recursive: true });
    await fs.mkdir(path.join(centralSkills, 'openspec'), { recursive: true });
    await fs.writeFile(
      path.join(centralSkills, 'comet', 'SKILL.md'),
      '# Central stale Comet\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(centralSkills, 'openspec', 'SKILL.md'),
      '# Keep OpenSpec\n',
      'utf8',
    );
    await fs.mkdir(path.dirname(platformSkills), { recursive: true });
    await fs.symlink(
      centralSkills,
      platformSkills,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        updateCommand(tmpDir, {
          currentProject: true,
          installMode: 'symlink',
          json: true,
          skipNpm: true,
        }),
      ).rejects.toThrow(/unmanaged entries: openspec/iu);
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect((await fs.lstat(platformSkills)).isSymbolicLink()).toBe(true);
    await expect(
      fs.readFile(path.join(centralSkills, 'openspec', 'SKILL.md'), 'utf8'),
    ).resolves.toBe('# Keep OpenSpec\n');
    await expect(fs.readFile(path.join(centralSkills, 'comet', 'SKILL.md'), 'utf8')).resolves.toBe(
      '# Central stale Comet\n',
    );
  });

  it('updates a Native project at its root when invoked from a nested directory', async () => {
    const fakeHome = path.join(tmpDir, 'nested-native-update-home');
    const nestedDir = path.join(tmpDir, 'src', 'features', 'nested');
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Stale Comet\n',
      'utf8',
    );

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await updateCommand(nestedDir, {
        currentProject: true,
        installMode: 'copy',
        json: true,
        skipNpm: true,
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.skills.targets).toHaveLength(1);
    await expect(
      fs.readFile(path.join(tmpDir, '.claude', 'skills', 'comet-native', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('name: comet-native');
    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toContain(
      '<comet-ambient-resume>',
    );
    await expect(fs.access(path.join(nestedDir, '.claude'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(nestedDir, 'AGENTS.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: Array<{ path: string }>;
    };
    expect(registry.projects.map((entry) => entry.path)).toEqual([tmpDir]);
  });

  it('fails a project update before npm or file writes when entry resolution fails', async () => {
    const fakeHome = path.join(tmpDir, 'invalid-native-update-home');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'schema: [', 'utf8');
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    const staleSkill = path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md');
    await fs.writeFile(staleSkill, '# Stale Comet\n', 'utf8');

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        updateCommand(tmpDir, {
          currentProject: true,
          installMode: 'copy',
        }),
      ).rejects.toThrow(/\.comet\/config\.yaml/iu);
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    expect(mockedSpawn).not.toHaveBeenCalled();
    await expect(fs.readFile(staleSkill, 'utf8')).resolves.toBe('# Stale Comet\n');
  });

  it('installs ambient resume instructions and preserves existing user AGENTS/CLAUDE rules', async () => {
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'ambient_resume: true',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );
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

  it('installs ambient resume instructions for Classic-only projects', async () => {
    await arrangeClassicDocsOpenSpecUpdate(tmpDir);
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# User\n\nKeep this.\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# User\n\nAlso keep this.\n', 'utf8');

    const fakeHome = path.join(tmpDir, 'fake-home-classic-instructions');
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

    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    const claude = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    for (const content of [agents, claude]) {
      expect(content).toContain('<comet-ambient-resume>');
      expect(content).toContain('comet resume-probe . --stdin --json');
    }
    expect(agents).toContain('# User\n\nKeep this.');
    expect(claude).toContain('# User\n\nAlso keep this.');
  });

  it('removes ambient resume instructions when the project disables the probe', async () => {
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows:',
        '  - native',
        'ambient_resume: false',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf8',
    );
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# User\n\nKeep this.\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# User\n\nKeep this too.\n', 'utf8');
    const instructions = await import('../../domains/skill/project-instructions.js');
    await instructions.installCometProjectInstructions(tmpDir, 'en');

    const fakeHome = path.join(tmpDir, 'fake-home-disabled-instructions');
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
    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toBe(
      '# User\n\nKeep this.\n',
    );
    await expect(fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf8')).resolves.toBe(
      '# User\n\nKeep this too.\n',
    );
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

  it('syncs Native Skills during a global update of a Native+Classic install', async () => {
    // Regression for #262: global scope used to hardcode the Skill
    // workflowSelection to 'classic', which filtered out comet-native/* and
    // left global Native installs frozen at their first-install version. With
    // both comet-native and comet-classic on disk the selection is 'both', so
    // Native Skills stay current.
    const fakeHome = path.join(tmpDir, 'fake-home-global-native-sync');
    await fs.mkdir(path.join(fakeHome, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n',
      'utf-8',
    );
    // Seed a both-workflow install: stale comet-native plus comet-classic so
    // the derived selection is 'both', and prove the stale Native Skill is
    // overwritten rather than merely created.
    await fs.mkdir(path.join(fakeHome, '.agents', 'skills', 'comet-native'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(fakeHome, '.agents', 'skills', 'comet-native', 'SKILL.md'),
      '---\nname: comet-native\n---\n# STALE\n',
      'utf-8',
    );
    await fs.mkdir(path.join(fakeHome, '.agents', 'skills', 'comet-classic'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(fakeHome, '.agents', 'skills', 'comet-classic', 'SKILL.md'),
      '# stale classic\n',
      'utf-8',
    );
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    // Silence update progress logging; this test only asserts file contents.
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string | undefined;

    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        scope: 'global',
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    // Native Skills must be copied alongside Classic ones for global installs.
    // Codex installs land in the canonical `.agents/skills/` directory, and a
    // previously stale Native Skill must be replaced with the current asset.
    const nativeSkill = await fs.readFile(
      path.join(fakeHome, '.agents', 'skills', 'comet-native', 'SKILL.md'),
      'utf8',
    );
    expect(nativeSkill).toContain('name: comet-native');
    expect(nativeSkill).not.toContain('# STALE');
    await expect(
      fs.readFile(path.join(fakeHome, '.agents', 'skills', 'comet', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('comet workflow resolve');

    // With 'both' selected, no manifest entries are filtered out, so the
    // Codex target reports zero skipped Skills.
    const result = json ? JSON.parse(json) : {};
    const codexSkills = (result.skills?.targets ?? []).find(
      (t: { platform: string }) => t.platform === 'codex',
    );
    expect(codexSkills?.skipped).toBe(0);
  });

  it('does not add Native Skills to a Classic-only global install during update', async () => {
    // A global install created with `comet init --scope global --workflow
    // classic` must not gain comet-native after `comet update --scope global`.
    const fakeHome = path.join(tmpDir, 'fake-home-global-classic-only');
    await fs.mkdir(path.join(fakeHome, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n',
      'utf-8',
    );
    // No comet-native directory: this is a Classic-only install.
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string | undefined;

    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        scope: 'global',
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    // Classic Skills update, but comet-native must NOT be introduced.
    await expect(
      fs.readFile(path.join(fakeHome, '.agents', 'skills', 'comet', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('comet workflow resolve');
    await expect(
      fs.access(path.join(fakeHome, '.agents', 'skills', 'comet-native', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    // The Native manifest entries filtered out by the Classic selection are
    // reported as skipped rather than hidden.
    const result = json ? JSON.parse(json) : {};
    const codexSkills = (result.skills?.targets ?? []).find(
      (t: { platform: string }) => t.platform === 'codex',
    );
    expect(codexSkills?.skipped).toBeGreaterThan(0);
  });

  it('does not add Classic Skills to a Native-only global install during update', async () => {
    // A global install created with `comet init --scope global --workflow
    // native` must not gain comet-classic after `comet update --scope global`.
    const fakeHome = path.join(tmpDir, 'fake-home-global-native-only');
    await fs.mkdir(path.join(fakeHome, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n',
      'utf-8',
    );
    // Native-only install: comet-native present, comet-classic absent.
    await fs.mkdir(path.join(fakeHome, '.agents', 'skills', 'comet-native'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(fakeHome, '.agents', 'skills', 'comet-native', 'SKILL.md'),
      '---\nname: comet-native\n---\n# STALE\n',
      'utf-8',
    );
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string | undefined;

    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        scope: 'global',
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    // Native Skills update, but comet-classic must NOT be introduced.
    const nativeSkill = await fs.readFile(
      path.join(fakeHome, '.agents', 'skills', 'comet-native', 'SKILL.md'),
      'utf8',
    );
    expect(nativeSkill).toContain('name: comet-native');
    expect(nativeSkill).not.toContain('# STALE');
    await expect(
      fs.access(path.join(fakeHome, '.agents', 'skills', 'comet-classic', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    // The Classic manifest entries filtered out by the Native selection are
    // reported as skipped rather than hidden.
    const result = json ? JSON.parse(json) : {};
    const codexSkills = (result.skills?.targets ?? []).find(
      (t: { platform: string }) => t.platform === 'codex',
    );
    expect(codexSkills?.skipped).toBeGreaterThan(0);
  });

  it('preserves installed language for an explicit global platform update', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-explicit-global-language');
    await fs.mkdir(path.join(fakeHome, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\n当用户提出需求时使用这个技能。',
      'utf-8',
    );
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;

    try {
      await updateCommand(tmpDir, {
        json: true,
        skipNpm: true,
        scope: 'global',
        platform: 'codex',
      });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homeSpy.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.skills.targets).toEqual([
      expect.objectContaining({ scope: 'global', platform: 'codex', language: 'zh' }),
    ]);
    const config = await fs.readFile(path.join(fakeHome, '.comet', 'config.yaml'), 'utf-8');
    expect(config).toContain('language: zh-CN');
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
    await fs.writeFile(
      path.join(fakeHome, '.comet', 'config.yaml'),
      'classic:\n  language: en\n',
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
    expect(config).not.toMatch(/^language:/mu);
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
    await fs.writeFile(
      path.join(fakeHome, '.comet', 'config.yaml'),
      'classic:\n  language: en\n',
      'utf-8',
    );

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
    expect(config).not.toMatch(/^language:/mu);
  });
});
