import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { doctorCommand } from '../../app/commands/doctor.js';
import {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
} from '../../domains/skill/platform-install.js';
import { PLATFORMS } from '../../platform/install/platforms.js';
import {
  readCometCurrentSelection,
  writeCometCurrentSelection,
} from '../../domains/comet-entry/current-selection.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { writeWorkflowProjectConfig } from '../../domains/workflow-contract/project-config-writer.js';
import { planClassicRootMove } from '../../domains/comet-classic/classic-root-move.js';
import {
  assertClassicLayoutInitializationSafe,
  beginClassicLayoutInitialization,
  checkpointClassicLayoutInitialization,
} from '../../domains/comet-classic/classic-layout-initialization.js';

const stateScript = path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-state.mjs');

async function installManagedCometSkills(baseDir: string, platformDir = '.claude'): Promise<void> {
  const manifest = JSON.parse(
    await fs.readFile(path.resolve('assets', 'manifest.json'), 'utf8'),
  ) as {
    skills: string[];
    internalSkills?: string[];
  };
  const managedPaths = [...new Set([...manifest.skills, ...(manifest.internalSkills ?? [])])];
  for (const relPath of managedPaths) {
    const target = path.join(baseDir, platformDir, 'skills', ...relPath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${relPath}\n`);
  }
}

interface DoctorPayload {
  scope: 'project' | 'global' | 'auto';
  status: 'passed' | 'failed';
  healthy: boolean;
  repaired: string[];
  codegraph?: {
    status: string;
    repairable: boolean;
    remediation: string | null;
  };
  runtime?: {
    isSecondaryWorktree: boolean;
    currentProjectInstall: string;
    primaryProjectInstall: string;
    globalFallbackReady: boolean;
    effectiveScope: string;
    remediation: string | null;
  };
  results: Array<{ check: string; status: string; message: string }>;
}

async function collectDoctorPayload(
  targetPath: string,
  scope: 'project' | 'global' | 'auto' = 'project',
  homeDir = targetPath,
): Promise<DoctorPayload> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await doctorCommand(targetPath, { json: true, scope, homeDir });
    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    return JSON.parse(output) as DoctorPayload;
  } finally {
    log.mockRestore();
  }
}

async function collectDoctorResults(
  targetPath: string,
  scope: 'project' | 'global' | 'auto' = 'project',
): Promise<DoctorPayload['results']> {
  return (await collectDoctorPayload(targetPath, scope)).results;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function writeReadyClassicRootMove(projectRoot: string): Promise<void> {
  const transactionId = '22222222-2222-4222-8222-222222222222';
  const config = defaultProjectConfig('docs', 'en');
  config.default_workflow = 'classic';
  config.workflows = ['classic'];
  config.classic = {
    artifact_layout: 'legacy',
    language: 'en',
    context_compression: 'off',
    review_mode: 'standard',
    auto_transition: true,
  };
  await writeProjectConfig(projectRoot, config);
  const source = path.join(projectRoot, 'openspec');
  await fs.mkdir(path.join(source, 'changes', 'archive'), { recursive: true });
  await fs.mkdir(path.join(source, 'specs'), { recursive: true });
  const directories = ['changes', 'changes/archive', 'specs'];
  const manifestSource = { directories, files: [], totalBytes: 0 };
  const manifest = { ...manifestSource, hash: sha256(JSON.stringify(manifestSource)) };
  const plan = await planClassicRootMove(projectRoot);
  const legacyPlanId = sha256(
    JSON.stringify({
      source: 'openspec',
      target: 'docs/openspec',
      staging: '.comet/transactions/classic-root-move/<transaction-id>/openspec',
      targetInitialState: 'missing',
      fileCount: manifest.files.length,
      directoryCount: manifest.directories.length,
      totalBytes: manifest.totalBytes,
      manifestHash: manifest.hash,
      configPath: plan.configPath,
      originalConfigHash: plan.originalConfigHash,
      expectedConfigHash: plan.expectedConfigHash,
    }),
  );
  const staging = path.join(
    projectRoot,
    '.comet',
    'transactions',
    'classic-root-move',
    transactionId,
    'openspec',
  );
  await fs.mkdir(path.dirname(staging), { recursive: true });
  await fs.cp(source, staging, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, '.comet', 'classic-root-move.json'),
    `${JSON.stringify(
      {
        schema: 'comet.classic-root-move.v1',
        id: transactionId,
        stage: 'ready',
        source: 'openspec',
        target: 'docs/openspec',
        staging: `.comet/transactions/classic-root-move/${transactionId}/openspec`,
        configPath: plan.configPath,
        originalConfigHash: plan.originalConfigHash,
        expectedConfigHash: plan.expectedConfigHash,
        planId: legacyPlanId,
        targetInitialState: 'missing',
        manifest,
      },
      null,
      2,
    )}\n`,
  );
}

async function writeHealthyDocsClassicProject(projectRoot: string): Promise<void> {
  const config = defaultProjectConfig('docs', 'en');
  config.default_workflow = 'classic';
  config.workflows = ['classic'];
  config.classic = {
    artifact_layout: 'docs',
    language: 'en',
    context_compression: 'off',
    review_mode: 'standard',
    auto_transition: true,
  };
  await writeProjectConfig(projectRoot, config);
  await Promise.all([
    fs.mkdir(path.join(projectRoot, 'docs', 'openspec', 'changes', 'archive'), {
      recursive: true,
    }),
    fs.mkdir(path.join(projectRoot, 'docs', 'openspec', 'specs'), { recursive: true }),
    fs.mkdir(path.join(projectRoot, 'docs', 'superpowers', 'specs'), { recursive: true }),
    fs.mkdir(path.join(projectRoot, 'docs', 'superpowers', 'plans'), { recursive: true }),
    fs.mkdir(path.join(projectRoot, 'docs', 'superpowers', 'reports'), { recursive: true }),
  ]);
  await fs.writeFile(
    path.join(projectRoot, 'docs', 'openspec', 'config.yaml'),
    'schema: spec-driven\n',
    'utf8',
  );
}

async function state(cwd: string, ...args: string[]) {
  const configPath = path.join(cwd, '.comet', 'config.yaml');
  try {
    await fs.access(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.mkdir(path.join(cwd, '.comet'), { recursive: true });
    await fs.writeFile(
      configPath,
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '  language: en',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(cwd, 'openspec'), { recursive: true });
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (args[0] === 'set' && args[2] === 'phase') {
    // Direct phase writes are normally blocked; the force hatch is the
    // documented way for tooling/tests to seed a change into a specific phase.
    env.COMET_FORCE_PHASE = '1';
  }
  return spawnSync(process.execPath, [stateScript, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
}

describe('doctor command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  it('reports a secondary worktree using a complete global fallback without calling it broken', async () => {
    const secondary = path.join(
      os.tmpdir(),
      `comet-doctor-secondary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const fakeHome = path.join(tmpDir, 'fake-home');
    const git = (...args: string[]) =>
      spawnSync('git', ['-C', tmpDir, ...args], { encoding: 'utf8', timeout: 20_000 });
    try {
      expect(git('init', '-b', 'master').status).toBe(0);
      expect(git('config', 'user.email', 'doctor@example.com').status).toBe(0);
      expect(git('config', 'user.name', 'Doctor Test').status).toBe(0);
      expect(git('config', 'commit.gpgsign', 'false').status).toBe(0);
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# test\n');
      expect(git('add', 'README.md').status).toBe(0);
      expect(git('commit', '-m', 'test').status).toBe(0);
      await installManagedCometSkills(tmpDir);
      await installManagedCometSkills(fakeHome);
      expect(git('worktree', 'add', secondary, '-b', 'feature/doctor-secondary').status).toBe(0);

      const payload = await collectDoctorPayload(secondary, 'project', fakeHome);

      expect(payload.runtime).toMatchObject({
        isSecondaryWorktree: true,
        currentProjectInstall: 'missing',
        primaryProjectInstall: 'ready',
        globalFallbackReady: true,
        effectiveScope: 'global',
        remediation: null,
      });
      expect(payload.results.find((result) => result.check === 'Worktree runtime')).toMatchObject({
        status: 'pass',
        message: expect.stringContaining('global fallback'),
      });
      expect(payload.results.find((result) => result.check === 'Comet skills')).toMatchObject({
        status: 'pass',
        message: expect.stringContaining('secondary worktree'),
      });
      expect(JSON.stringify(payload.results)).not.toContain(
        'not installed in project scope — run: comet init --scope project',
      );

      await fs.rm(fakeHome, { recursive: true, force: true });
      const unavailable = await collectDoctorPayload(secondary, 'project', fakeHome);
      expect(unavailable.runtime).toMatchObject({
        isSecondaryWorktree: true,
        primaryProjectInstall: 'ready',
        globalFallbackReady: false,
        effectiveScope: 'none',
        remediation: expect.stringContaining('this worktree'),
      });
      expect(
        unavailable.results.find((result) => result.check === 'Worktree runtime'),
      ).toMatchObject({
        status: 'fail',
        message: expect.stringContaining('not executed here'),
      });
      expect(unavailable).toMatchObject({ status: 'failed', healthy: false });

      const manifest = JSON.parse(
        await fs.readFile(path.resolve('assets', 'manifest.json'), 'utf8'),
      ) as { skills: string[] };
      await fs.rm(path.join(tmpDir, '.claude', 'skills', ...manifest.skills[0]!.split('/')));
      const stalePrimary = await collectDoctorPayload(secondary, 'project', fakeHome);
      expect(stalePrimary.runtime).toMatchObject({
        currentProjectInstall: 'missing',
        primaryProjectInstall: 'partial',
        effectiveScope: 'none',
      });

      await installManagedCometSkills(secondary);
      const projectReady = await collectDoctorPayload(secondary, 'project', fakeHome);
      expect(projectReady.runtime).toMatchObject({
        currentProjectInstall: 'ready',
        primaryProjectInstall: 'partial',
        effectiveScope: 'project',
        remediation: null,
      });
    } finally {
      git('worktree', 'remove', '--force', secondary);
      await fs.rm(secondary, { recursive: true, force: true });
    }
  });

  it('projects the primary worktree Router into a secondary worktree during project repair', async () => {
    const secondary = path.join(
      os.tmpdir(),
      `comet-doctor-hook-secondary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const fakeHome = path.join(tmpDir, 'fake-home');
    const git = (...args: string[]) =>
      spawnSync('git', ['-C', tmpDir, ...args], { encoding: 'utf8', timeout: 20_000 });
    try {
      expect(git('init', '-b', 'master').status).toBe(0);
      expect(git('config', 'user.email', 'doctor@example.com').status).toBe(0);
      expect(git('config', 'user.name', 'Doctor Test').status).toBe(0);
      expect(git('config', 'commit.gpgsign', 'false').status).toBe(0);
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# test\n');
      await writeProjectConfig(tmpDir, defaultProjectConfig('docs'));
      expect(git('add', 'README.md', '.comet/config.yaml').status).toBe(0);
      expect(git('commit', '-m', 'test').status).toBe(0);
      expect(git('worktree', 'add', secondary, '-b', 'feature/doctor-hook-secondary').status).toBe(
        0,
      );
      const primaryRouter = path.join(
        tmpDir,
        '.agents',
        'skills',
        'comet',
        'scripts',
        'comet-hook-router.mjs',
      );
      await fs.mkdir(path.dirname(primaryRouter), { recursive: true });
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
      await fs.writeFile(primaryRouter, '// primary Router\n', 'utf8');
      await fs.writeFile(
        path.join(tmpDir, '.comet', 'current-change.json'),
        '{"schema":"comet.selection.v2","workflow":"native","change":"primary"}',
        'utf8',
      );

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let payload: DoctorPayload;
      try {
        await doctorCommand(secondary, {
          json: true,
          repair: true,
          scope: 'project',
          homeDir: fakeHome,
        });
        payload = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      } finally {
        log.mockRestore();
      }

      const hooks = await fs.readFile(path.join(secondary, '.codex', 'hooks.json'), 'utf8');
      expect(hooks.replaceAll('\\', '/')).toContain(
        `${secondary.replaceAll('\\', '/')}/.agents/skills/comet/scripts/comet-hook-router.mjs`,
      );
      await expect(
        fs.access(
          path.join(secondary, '.agents', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs'),
        ),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(secondary, '.comet', 'current-change.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(payload!.results).toContainEqual(
        expect.objectContaining({ check: 'hooks: Codex (project)', status: 'pass' }),
      );
    } finally {
      git('worktree', 'remove', '--force', secondary);
      await fs.rm(secondary, { recursive: true, force: true });
    }
  });

  it('falls back to a global Router source when the primary worktree has none', async () => {
    const secondary = path.join(
      os.tmpdir(),
      `comet-doctor-global-hook-secondary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const fakeHome = path.join(tmpDir, 'global-hook-home');
    const git = (...args: string[]) =>
      spawnSync('git', ['-C', tmpDir, ...args], { encoding: 'utf8', timeout: 20_000 });
    try {
      expect(git('init', '-b', 'master').status).toBe(0);
      expect(git('config', 'user.email', 'doctor@example.com').status).toBe(0);
      expect(git('config', 'user.name', 'Doctor Test').status).toBe(0);
      expect(git('config', 'commit.gpgsign', 'false').status).toBe(0);
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# test\n');
      await writeProjectConfig(tmpDir, defaultProjectConfig('docs'));
      expect(git('add', 'README.md', '.comet/config.yaml').status).toBe(0);
      expect(git('commit', '-m', 'test').status).toBe(0);
      expect(git('worktree', 'add', secondary, '-b', 'feature/doctor-global-hook').status).toBe(0);
      const globalRouter = path.join(
        fakeHome,
        '.agents',
        'skills',
        'comet',
        'scripts',
        'comet-hook-router.mjs',
      );
      await fs.mkdir(path.dirname(globalRouter), { recursive: true });
      await fs.mkdir(path.join(fakeHome, '.codex'), { recursive: true });
      await fs.writeFile(globalRouter, '// global Router\n', 'utf8');

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await doctorCommand(secondary, {
          json: true,
          repair: true,
          scope: 'project',
          homeDir: fakeHome,
        });
      } finally {
        log.mockRestore();
      }

      const hooks = await fs.readFile(path.join(secondary, '.codex', 'hooks.json'), 'utf8');
      expect(hooks.replaceAll('\\', '/')).toContain(
        `${secondary.replaceAll('\\', '/')}/.agents/skills/comet/scripts/comet-hook-router.mjs`,
      );
    } finally {
      git('worktree', 'remove', '--force', secondary);
      await fs.rm(secondary, { recursive: true, force: true });
    }
  });

  it('repairs a missing CodeGraph index only with explicit --yes authorization', async () => {
    const binDir = path.join(tmpDir, 'bin');
    const logFile = path.join(tmpDir, 'codegraph.log');
    await fs.mkdir(binDir, { recursive: true });
    const executable =
      process.platform === 'win32'
        ? path.join(binDir, 'codegraph.cmd')
        : path.join(binDir, 'codegraph');
    const script =
      process.platform === 'win32'
        ? [
            '@echo off',
            `echo %1>>"${logFile}"`,
            'if "%1"=="init" (',
            '  if not exist ".codegraph" mkdir ".codegraph"',
            '  type nul > ".codegraph\\codegraph.db"',
            ')',
            'if "%1"=="status" echo {"initialized":true,"pendingChanges":{"added":0,"modified":0,"removed":0},"index":{"state":"complete","reindexRecommended":false,"pendingRefs":0}}',
            '',
          ].join('\r\n')
        : [
            '#!/bin/sh',
            `printf '%s\\n' "$1" >> '${logFile.replaceAll("'", "'\\''")}'`,
            'if [ "$1" = "init" ]; then mkdir -p .codegraph; : > .codegraph/codegraph.db; fi',
            'if [ "$1" = "status" ]; then printf \'%s\\n\' \'{"initialized":true,"pendingChanges":{"added":0,"modified":0,"removed":0},"index":{"state":"complete","reindexRecommended":false,"pendingRefs":0}}\'; fi',
            '',
          ].join('\n');
    await fs.writeFile(executable, script);
    if (process.platform !== 'win32') await fs.chmod(executable, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;
    try {
      const config = defaultProjectConfig('openspec');
      config.default_workflow = 'classic';
      config.workflows = ['classic'];
      config.classic = {
        artifact_layout: 'docs',
        language: 'en',
        context_compression: 'off',
        review_mode: 'standard',
        auto_transition: true,
      };
      await writeProjectConfig(tmpDir, config);

      const before = await collectDoctorPayload(tmpDir);
      expect(before.codegraph).toMatchObject({
        status: 'project_not_initialized',
        repairable: true,
      });
      await expect(fs.access(logFile)).rejects.toMatchObject({ code: 'ENOENT' });

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let repaired: DoctorPayload;
      try {
        await doctorCommand(tmpDir, {
          json: true,
          repair: true,
          yes: true,
          scope: 'project',
          homeDir: tmpDir,
        });
        repaired = JSON.parse(
          log.mock.calls.map((call) => call.join(' ')).join('\n'),
        ) as DoctorPayload;
      } finally {
        log.mockRestore();
      }

      expect(repaired!).toMatchObject({
        repaired: expect.arrayContaining(['CodeGraph project index']),
        codegraph: { status: 'index_ready', repairable: false },
      });
      await expect(fs.readFile(logFile, 'utf8')).resolves.toContain('init');
      await expect(
        fs.access(path.join(tmpDir, '.codegraph', 'codegraph.db')),
      ).resolves.toBeUndefined();
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('reports CodeGraph CLI, project index, and Codex MCP registration as separate layers', async () => {
    const homeDir = path.join(tmpDir, 'codegraph-home');
    const binDir = path.join(tmpDir, 'codegraph-bin');
    const executable =
      process.platform === 'win32'
        ? path.join(binDir, 'codegraph.cmd')
        : path.join(binDir, 'codegraph');
    await fs.mkdir(path.join(tmpDir, '.codegraph'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.codegraph', 'codegraph.db'), '');
    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, '.codex', 'config.toml'),
      '[mcp_servers.other]\ncommand = "other"\n',
    );
    await fs.mkdir(binDir, { recursive: true });
    const status =
      '{"initialized":true,"pendingChanges":{"added":0,"modified":0,"removed":0},"index":{"state":"complete","reindexRecommended":false,"pendingRefs":0}}';
    const script =
      process.platform === 'win32'
        ? `@echo off\r\nif "%1"=="status" echo ${status}\r\n`
        : `#!/bin/sh\nif [ "$1" = "status" ]; then printf '%s\\n' '${status}'; fi\n`;
    await fs.writeFile(executable, script);
    if (process.platform !== 'win32') await fs.chmod(executable, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;
    try {
      await writeProjectConfig(tmpDir, defaultProjectConfig('docs'));

      const payload = await collectDoctorPayload(tmpDir, 'project', homeDir);

      expect(payload.codegraph).toMatchObject({
        cliStatus: 'installed',
        indexStatus: 'current',
        mcpStatus: 'not_registered',
        effectiveForAgent: { codex: false },
      });
      expect(payload.results).toContainEqual(
        expect.objectContaining({
          check: 'CodeGraph MCP registration',
          status: 'warn',
          message: expect.stringContaining('Codex'),
        }),
      );
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('reports allowed Classic recovery strategies and never chooses one implicitly', async () => {
    await fs.mkdir(path.join(tmpDir, '.git'));
    await writeReadyClassicRootMove(tmpDir);

    const before = await collectDoctorPayload(tmpDir);
    expect(
      before.results.find((result) => result.check === 'Classic artifact layout'),
    ).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('allowed strategies: continue, rollback'),
    });
    expect(
      before.results.find((result) => result.check === 'Classic artifact layout')?.message,
    ).toContain(
      'staging .comet/transactions/classic-root-move/22222222-2222-4222-8222-222222222222/openspec',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, {
        json: true,
        repair: true,
        scope: 'project',
        homeDir: tmpDir,
      });
    } finally {
      log.mockRestore();
    }
    await expect(
      fs.stat(path.join(tmpDir, '.comet', 'classic-root-move.json')),
    ).resolves.toBeDefined();

    const repairLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, {
        json: true,
        repair: true,
        strategy: 'rollback',
        scope: 'project',
        homeDir: tmpDir,
      });
    } finally {
      repairLog.mockRestore();
    }
    await expect(
      fs.stat(path.join(tmpDir, '.comet', 'classic-root-move.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports and repairs a project config write interrupted after quarantine', async () => {
    await writeProjectConfig(tmpDir, defaultProjectConfig('before-crash'));
    const configPath = path.join(tmpDir, '.comet', 'config.yaml');
    const previous = await fs.readFile(configPath, 'utf8');
    const worker = path.resolve('test/helpers/project-config-crash-worker.mjs');

    const crashed = spawnSync(process.execPath, [worker, tmpDir], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(crashed.status, crashed.stderr).toBe(73);

    const before = await collectDoctorPayload(tmpDir);
    expect(
      before.results.find((result) => result.check === 'project config write transaction'),
    ).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('config-quarantined'),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let repaired: DoctorPayload;
    try {
      await doctorCommand(tmpDir, {
        json: true,
        repair: true,
        scope: 'project',
        homeDir: tmpDir,
      });
      repaired = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
    } finally {
      log.mockRestore();
    }
    expect(repaired!.repaired).toContain('project config write transaction');
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(previous);
    const after = await collectDoctorPayload(tmpDir);
    expect(
      after.results.find((result) => result.check === 'project config write transaction'),
    ).toBeUndefined();
  });

  it('does not repair a project config transaction while its writer is still active', async () => {
    await writeProjectConfig(tmpDir, defaultProjectConfig('before-live-write'));
    let enterPublish!: () => void;
    const publishEntered = new Promise<void>((resolve) => {
      enterPublish = resolve;
    });
    let releasePublish!: () => void;
    const publishRelease = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    const writer = writeWorkflowProjectConfig(tmpDir, defaultProjectConfig('after-live-write'), {
      beforePublish: async () => {
        enterPublish();
        await publishRelease;
      },
    });
    await publishEntered;

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        doctorCommand(tmpDir, {
          json: true,
          repair: true,
          scope: 'project',
          homeDir: tmpDir,
        }),
      ).rejects.toThrow(/transaction .* still active/iu);
    } finally {
      log.mockRestore();
      releasePublish();
    }
    await writer;

    await expect(
      fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8'),
    ).resolves.toContain('artifact_root: after-live-write');
    expect(
      (await fs.readdir(path.join(tmpDir, '.comet'))).filter(
        (entry) =>
          entry.includes('config-write-transaction') ||
          entry.endsWith('.next') ||
          entry.endsWith('.quarantine'),
      ),
    ).toEqual([]);
  });

  it('reports an owned Classic initialization and atomically quarantines it on rollback', async () => {
    const initialization = await assertClassicLayoutInitializationSafe(tmpDir, 'docs');
    const owned = await beginClassicLayoutInitialization(tmpDir, initialization);
    await fs.mkdir(path.join(owned.openSpecRoot, 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(owned.openSpecRoot, 'specs'), { recursive: true });
    await fs.writeFile(path.join(owned.openSpecRoot, 'config.yaml'), 'schema: spec-driven\n');
    await checkpointClassicLayoutInitialization(tmpDir, owned.initializationPermit);

    const before = await collectDoctorPayload(tmpDir);
    expect(
      before.results.find((result) => result.check === 'Classic initialization'),
    ).toMatchObject({
      status: 'warn',
      message: expect.stringMatching(/initializing.*continue, rollback/iu),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let repaired: DoctorPayload;
    try {
      await doctorCommand(tmpDir, {
        json: true,
        repair: true,
        strategy: 'rollback',
        scope: 'project',
        homeDir: tmpDir,
      });
      repaired = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
    } finally {
      log.mockRestore();
    }
    expect(repaired!.repaired).toContain('Classic initialization');
    await expect(fs.access(owned.openSpecRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    const journal = JSON.parse(
      await fs.readFile(path.join(tmpDir, '.comet', 'classic-init-ownership.json'), 'utf8'),
    ) as { stage: string; quarantine: string };
    expect(journal.stage).toBe('quarantined');
    await expect(
      fs.readFile(path.join(tmpDir, ...journal.quarantine.split('/'), 'config.yaml'), 'utf8'),
    ).resolves.toBe('schema: spec-driven\n');
  });

  it('reports an invalid project config without guessing Classic working directories', async () => {
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'schema: [broken\n');
    await fs.mkdir(path.join(tmpDir, 'openspec', 'changes', 'must-not-be-scanned'), {
      recursive: true,
    });

    const results = await collectDoctorResults(tmpDir);

    expect(results.find((result) => result.check === 'Classic artifact layout')).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('Invalid .comet/config.yaml'),
    });
    expect(results.find((result) => result.check === 'working directories')).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('Invalid .comet/config.yaml'),
    });
  });

  it('reports both Classic root states and a repair command when the configured root is missing', async () => {
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });

    const results = await collectDoctorResults(tmpDir);

    expect(results.find((result) => result.check === 'Classic artifact layout')).toMatchObject({
      status: 'fail',
      message: expect.stringMatching(
        /configured docs\/openspec\/ missing; alternate openspec\/ present.*comet classic root show/iu,
      ),
    });
  });

  it('reports an uninitialized or corrupt configured OpenSpec root as unhealthy', async () => {
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, 'docs', 'openspec', 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpDir, 'docs', 'openspec', 'specs'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'docs', 'superpowers', 'specs'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'docs', 'superpowers', 'plans'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'docs', 'superpowers', 'reports'), { recursive: true });

    let results = await collectDoctorResults(tmpDir);
    expect(results.find((result) => result.check === 'Classic OpenSpec root')).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('config.yaml is missing'),
    });

    await fs.writeFile(
      path.join(tmpDir, 'docs', 'openspec', 'config.yaml'),
      'schema: [broken\n',
      'utf8',
    );
    results = await collectDoctorResults(tmpDir);
    expect(results.find((result) => result.check === 'Classic OpenSpec root')).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('invalid YAML'),
    });
  });

  it('does not confuse normal docs artifacts or project-level OpenSpec tools with coupled assets', async () => {
    await writeHealthyDocsClassicProject(tmpDir);
    await fs.mkdir(path.join(tmpDir, 'docs', 'openspec', 'specs', 'openspec-notes'), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'openspec-propose'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md'),
      'project-level OpenSpec skill\n',
      'utf8',
    );

    const results = await collectDoctorResults(tmpDir);

    expect(results.find((result) => result.check === 'Classic platform tool assets')).toMatchObject(
      {
        status: 'pass',
        message: expect.stringContaining('no OpenSpec platform tool assets under docs/'),
      },
    );
  });

  it('does not run the docs coupling check for a legacy Classic layout', async () => {
    const config = defaultProjectConfig('docs', 'en');
    config.default_workflow = 'classic';
    config.workflows = ['classic'];
    config.classic = {
      artifact_layout: 'legacy',
      language: 'en',
      context_compression: 'off',
      review_mode: 'standard',
      auto_transition: true,
    };
    await writeProjectConfig(tmpDir, config);
    await fs.mkdir(path.join(tmpDir, 'openspec', 'changes', 'archive'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'openspec', 'specs'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
    const nestedSkill = path.join(
      tmpDir,
      'docs',
      '.claude',
      'skills',
      'openspec-propose',
      'SKILL.md',
    );
    await fs.mkdir(path.dirname(nestedSkill), { recursive: true });
    await fs.writeFile(nestedSkill, 'legacy layout leaves docs coupling out of scope\n');

    const results = await collectDoctorResults(tmpDir);

    expect(
      results.find((result) => result.check === 'Classic platform tool assets'),
    ).toBeUndefined();
  });

  it('reports OpenSpec skills and command files nested under docs for every registered platform root', async () => {
    await writeHealthyDocsClassicProject(tmpDir);
    const platformRoots = [
      ...new Set(
        PLATFORMS.flatMap((platform) => [platform.skillsDir, ...(platform.legacySkillsDirs ?? [])]),
      ),
    ];
    for (const platformRoot of platformRoots) {
      const skillDir = path.join(tmpDir, 'docs', platformRoot, 'skills', 'openspec-propose');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), `${platformRoot} misplaced skill\n`);
    }
    await fs.mkdir(path.join(tmpDir, 'docs', '.cursor', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'docs', '.cursor', 'commands', 'opsx-propose.md'),
      'misplaced Cursor command\n',
    );
    await fs.mkdir(path.join(tmpDir, 'docs', '.codex', 'prompts'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'docs', '.codex', 'prompts', 'opsx-propose.md'),
      'misplaced Codex command\n',
    );
    await fs.mkdir(path.join(tmpDir, 'docs', '.clinerules', 'workflows'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, 'docs', '.clinerules', 'workflows', 'opsx-propose.md'),
      'misplaced Cline command\n',
    );
    await fs.mkdir(path.join(tmpDir, 'docs', '.agent', 'workflows'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, 'docs', '.agent', 'workflows', 'opsx-propose.md'),
      'misplaced Antigravity command\n',
    );

    const results = await collectDoctorResults(tmpDir);
    const platformAssets = results.find(
      (result) => result.check === 'Classic platform tool assets',
    );

    expect(platformAssets).toMatchObject({
      status: 'fail',
      message: expect.stringMatching(
        /platform directories at the project root.*comet update.*Doctor did not move/iu,
      ),
    });
    for (const platformRoot of platformRoots) {
      expect(platformAssets?.message).toContain(
        path.posix.join('docs', platformRoot, 'skills', 'openspec-propose'),
      );
    }
    expect(platformAssets?.message).toContain('docs/.cursor/commands/opsx-propose.md');
    expect(platformAssets?.message).toContain('docs/.codex/prompts/opsx-propose.md');
    expect(platformAssets?.message).toContain('docs/.clinerules/workflows/opsx-propose.md');
    expect(platformAssets?.message).toContain('docs/.agent/workflows/opsx-propose.md');
    const repairLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, {
        json: true,
        repair: true,
        scope: 'project',
        homeDir: tmpDir,
      });
    } finally {
      repairLog.mockRestore();
    }
    await expect(
      fs.readFile(
        path.join(tmpDir, 'docs', '.claude', 'skills', 'openspec-propose', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toBe('.claude misplaced skill\n');
  });

  it('fails closed without following a linked platform directory under docs', async () => {
    await writeHealthyDocsClassicProject(tmpDir);
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-tools-link-'));
    const outsideMarker = path.join(outsideRoot, 'skills', 'openspec-propose', 'SKILL.md');
    try {
      await fs.mkdir(path.dirname(outsideMarker), { recursive: true });
      await fs.writeFile(outsideMarker, 'outside-platform-marker\n', 'utf8');
      try {
        await fs.symlink(
          outsideRoot,
          path.join(tmpDir, 'docs', '.claude'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const results = await collectDoctorResults(tmpDir);
      const platformAssets = results.find(
        (result) => result.check === 'Classic platform tool assets',
      );

      expect(platformAssets).toMatchObject({
        status: 'fail',
        message: expect.stringMatching(/symbolic link or junction.*comet update/iu),
      });
      expect(JSON.stringify(results)).not.toContain('outside-platform-marker');
      await expect(fs.readFile(outsideMarker, 'utf8')).resolves.toBe('outside-platform-marker\n');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it.each(['configured', 'alternate'] as const)(
    'handles the Classic layout check when the %s root is a directory link',
    async (kind) => {
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-root-link-'));
      try {
        await fs.mkdir(path.join(outsideRoot, 'changes', 'external-marker'), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(outsideRoot, 'changes', 'external-marker', '.comet.yaml'),
          'phase: open\n',
          'utf8',
        );
        await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
        await fs.writeFile(
          path.join(tmpDir, '.comet', 'config.yaml'),
          [
            'schema: comet.project.v1',
            'default_workflow: classic',
            'workflows: [classic]',
            'classic:',
            '  artifact_layout: docs',
            '',
          ].join('\n'),
          'utf8',
        );
        if (kind === 'configured') {
          await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });
          try {
            await fs.symlink(
              outsideRoot,
              path.join(tmpDir, 'docs', 'openspec'),
              process.platform === 'win32' ? 'junction' : 'dir',
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
            throw error;
          }
        } else {
          await fs.mkdir(path.join(tmpDir, 'docs', 'openspec'), { recursive: true });
          try {
            await fs.symlink(
              outsideRoot,
              path.join(tmpDir, 'openspec'),
              process.platform === 'win32' ? 'junction' : 'dir',
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
            throw error;
          }
        }

        const results = await collectDoctorResults(tmpDir);

        const layoutResult = results.find((result) => result.check === 'Classic artifact layout');
        if (kind === 'configured') {
          expect(layoutResult).toMatchObject({
            status: 'fail',
            message: expect.stringMatching(/symbolic link or junction/iu),
          });
        } else {
          expect(layoutResult).toMatchObject({
            status: 'pass',
            message: expect.stringMatching(/standalone OpenSpec root .* ignored by Comet/iu),
          });
        }
        expect(results.some((result) => result.check.includes('external-marker'))).toBe(false);
      } finally {
        await fs.rm(outsideRoot, { recursive: true, force: true });
      }
    },
  );

  it('fails working-directory health when the Superpowers root is a directory link', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-superpowers-link-'));
    try {
      await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: classic',
          'workflows: [classic]',
          'classic:',
          '  artifact_layout: legacy',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });
      try {
        await fs.symlink(
          outsideRoot,
          path.join(tmpDir, 'docs', 'superpowers'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const results = await collectDoctorResults(tmpDir);

      expect(results.find((result) => result.check === 'working directories')).toMatchObject({
        status: 'fail',
        message: expect.stringMatching(/symbolic link or junction/iu),
      });
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('fails a Classic change check without reading through its runtime directory link', async () => {
    const initialized = await state(tmpDir, 'init', 'runtime-link', 'full');
    expect(initialized.status, initialized.stderr).toBe(0);
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'runtime-link');
    const runtimeDir = path.join(changeDir, '.comet');
    await fs.rm(runtimeDir, { recursive: true, force: true });
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-runtime-link-'));
    const outsideState = path.join(outsideRoot, 'run-state.json');
    try {
      await fs.writeFile(outsideState, 'outside-runtime-marker\n', 'utf8');
      await fs.symlink(outsideRoot, runtimeDir, process.platform === 'win32' ? 'junction' : 'dir');

      const results = await collectDoctorResults(tmpDir);
      const changeCheck = results.find((result) => result.check === '.comet.yaml: runtime-link');

      expect(changeCheck).toMatchObject({
        status: 'fail',
        message: expect.stringMatching(/symbolic link or junction/iu),
      });
      expect(JSON.stringify(results)).not.toContain('outside-runtime-marker');
      await expect(fs.readFile(outsideState, 'utf8')).resolves.toBe('outside-runtime-marker\n');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('accepts current Comet state fields while a standalone OpenSpec root coexists', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'current-state');
    await state(tmpDir, 'init', 'current-state', 'full');
    await state(tmpDir, 'set', 'current-state', 'phase', 'verify');
    await fs.mkdir(path.join(tmpDir, 'docs', 'openspec'), { recursive: true });
    const before = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await doctorCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const results = JSON.parse(json).results as Array<{
      check: string;
      status: string;
      message: string;
    }>;
    const layoutResult = results.find((result) => result.check === 'Classic artifact layout');
    expect(layoutResult).toMatchObject({ status: 'pass' });
    expect(layoutResult?.message).toContain('openspec/');
    expect(layoutResult?.message).toContain('docs/openspec/');
    expect(layoutResult?.message).toContain('standalone OpenSpec root');
    expect(layoutResult?.message).toContain('ignored by Comet');
    const stateResult = results.find((result) => result.check === '.comet.yaml: current-state');
    expect(stateResult).toMatchObject({
      status: 'pass',
      message: expect.stringContaining('step: legacy:verify'),
    });
    expect(stateResult?.message).toContain('mode: legacy-state');
    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).toBe(before);
  });

  it('prints the current Comet version in text output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await doctorCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('Comet CLI: installed (');
  });

  it('explains auto scope and treats global installs as available when project scope is empty', async () => {
    const fakeHome = path.join(tmpDir, 'home');
    await installManagedCometSkills(fakeHome);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await doctorCommand(tmpDir, { homeDir: fakeHome });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain(
      'Scope: auto checks project scope first, then global scope when it is different',
    );
    expect(output).toContain('skills: Claude Code (global): complete');
    expect(output).toContain(
      'Project scope: no project-local Comet skills installed; global scope is available',
    );
    expect(output).toContain(
      'run: comet init --scope project only if this project needs its own copy',
    );
    expect(output).not.toContain('skills: Claude Code (project): missing');
  });

  it('does not report non-Comet skill directories as missing Comet installs in auto scope', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'using-superpowers'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'using-superpowers', 'SKILL.md'),
      '# using-superpowers\n',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await doctorCommand(tmpDir, { homeDir: path.join(tmpDir, 'isolated-home') });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).not.toContain('skills: Claude Code (project): missing');
    expect(output).toContain('Superpowers: detected');
    expect(output).toContain(
      'Comet skills: not installed in project or global scope — run: comet init',
    );
  });

  it('detects Claude plugin-managed Superpowers installs', async () => {
    const fakeHome = path.join(tmpDir, 'plugin-home');
    const pluginVersion = '999.0.0-test';
    const pluginSkillsDir = path.join(
      fakeHome,
      '.claude',
      'plugins',
      'cache',
      'claude-plugins-official',
      'superpowers',
      pluginVersion,
      'skills',
    );
    await fs.mkdir(path.join(pluginSkillsDir, 'using-superpowers'), { recursive: true });
    await fs.writeFile(
      path.join(pluginSkillsDir, 'using-superpowers', 'SKILL.md'),
      '# using-superpowers\n',
      'utf8',
    );

    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = path.join(fakeHome, '.claude');
    try {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let output: string;
      try {
        await doctorCommand(tmpDir, { homeDir: fakeHome });
        output = log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
      }

      expect(output).toContain('Superpowers: detected');
      expect(output).toContain('Claude Code global');
      expect(output).not.toContain('Claude Code project');
      expect(output).not.toContain('Superpowers: not detected');
    } finally {
      if (previousClaudeConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
      }
    }
  });

  it('reports partial Comet installs with an update command instead of a raw missing dump', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), {
      recursive: true,
    });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# comet\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await doctorCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('skills: Claude Code (project): partial');
    expect(output).toContain('run: comet update --scope project');
    expect(output).not.toContain('missing 31:');
  });

  it('treats a workflow-scoped Native Skill install as complete without Classic assets', async () => {
    const claude = PLATFORMS.find((platform) => platform.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claude, true, 'skills', 'project', 'copy', 'native');
    await writeProjectConfig(tmpDir, defaultProjectConfig('docs'));

    const payload = await collectDoctorPayload(tmpDir);
    const results = payload.results;
    expect(payload).toMatchObject({ status: 'passed', healthy: true });
    expect(results).toContainEqual(
      expect.objectContaining({
        check: 'skills: Claude Code (project)',
        status: 'pass',
        message: expect.stringContaining('complete'),
      }),
    );
    expect(results.map((result) => result.check)).not.toEqual(
      expect.arrayContaining(['openspec CLI', 'Superpowers', 'working directories']),
    );
    expect(results.some((result) => result.check.startsWith('CodeGraph'))).toBe(true);
    expect(payload.codegraph?.status).toMatch(/^(cli_missing|project_not_initialized)$/u);
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills', 'comet-any', 'SKILL.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills', 'comet-classic', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('marks JSON output unhealthy when a diagnostic fails', async () => {
    await writeProjectConfig(tmpDir, defaultProjectConfig('docs'));
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'current-change.json'), '{invalid', 'utf8');

    const payload = await collectDoctorPayload(tmpDir);

    expect(payload).toMatchObject({ status: 'failed', healthy: false });
    expect(payload.results).toContainEqual(
      expect.objectContaining({ check: 'current selection', status: 'fail' }),
    );
  });

  it('warns when a detected complete Skill install is missing its Rule and Hook', async () => {
    await installManagedCometSkills(tmpDir);

    const results = await collectDoctorResults(tmpDir);

    expect(results.find((result) => result.check === 'rules: Claude Code (project)')).toMatchObject(
      {
        status: 'warn',
        message: expect.stringContaining('comet update --scope project'),
      },
    );
    expect(results.find((result) => result.check === 'hooks: Claude Code (project)')).toMatchObject(
      {
        status: 'warn',
        message: expect.stringContaining('comet update --scope project'),
      },
    );
  });

  it('passes Rule and Hook checks when the managed components are installed', async () => {
    const claude = PLATFORMS.find((platform) => platform.id === 'claude');
    expect(claude).toBeDefined();
    await installManagedCometSkills(tmpDir);
    await copyCometRulesForPlatform(tmpDir, claude!, true, 'zh', 'project');
    await installCometHooksForPlatform(tmpDir, claude!, 'project');

    const results = await collectDoctorResults(tmpDir);

    expect(results.find((result) => result.check === 'rules: Claude Code (project)')).toMatchObject(
      {
        status: 'pass',
      },
    );
    expect(results.find((result) => result.check === 'hooks: Claude Code (project)')).toMatchObject(
      {
        status: 'pass',
      },
    );
  });

  it.each([
    'claude',
    'codex',
    'windsurf',
    'github-copilot',
    'gemini',
    'amazon-q',
    'qwen',
    'kiro',
    'codebuddy',
    'workbuddy',
    'qoder',
  ])('recognizes exactly one healthy Router for the %s platform', async (id) => {
    const target = PLATFORMS.find((platform) => platform.id === id)!;
    await installManagedCometSkills(tmpDir, target.skillsDir);
    await installCometHooksForPlatform(tmpDir, target, 'project');

    const results = await collectDoctorResults(tmpDir);

    expect(
      results.find((result) => result.check === `hooks: ${target.name} (project)`),
    ).toMatchObject({
      status: 'pass',
      message: 'exactly one managed Router Hook present',
    });
  });

  it('detects and repairs an outdated Hook Router runtime', async () => {
    const claude = PLATFORMS.find((platform) => platform.id === 'claude')!;
    await installManagedCometSkills(tmpDir);
    await installCometHooksForPlatform(tmpDir, claude, 'project');

    const before = await collectDoctorResults(tmpDir);
    expect(
      before.find((result) => result.check === 'hook runtime: Claude Code (project)'),
    ).toMatchObject({ status: 'warn', message: expect.stringContaining('outdated') });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, { json: true, repair: true, scope: 'project', homeDir: tmpDir });
    } finally {
      log.mockRestore();
    }

    const installed = path.join(
      tmpDir,
      '.claude',
      'skills',
      'comet',
      'scripts',
      'comet-hook-router.mjs',
    );
    await expect(fs.readFile(installed)).resolves.toEqual(
      await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs'),
      ),
    );
    const after = await collectDoctorResults(tmpDir);
    expect(
      after.find((result) => result.check === 'hook runtime: Claude Code (project)'),
    ).toMatchObject({ status: 'pass', message: 'current' });
  });

  it('uses the Classic-only project language when repairing managed Rules', async () => {
    await installManagedCometSkills(tmpDir);
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '  language: zh-CN',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, {
        json: true,
        repair: true,
        scope: 'project',
        homeDir: tmpDir,
      });
    } finally {
      log.mockRestore();
    }

    const installedRule = await fs.readFile(
      path.join(tmpDir, '.claude', 'rules', 'comet-workflow-guard.md'),
      'utf8',
    );
    expect(installedRule).toContain('# Comet 当前需求阶段规则');
    expect(installedRule).not.toContain('# Comet Current-Change Phase Rule');
  });

  it('repairs duplicate and legacy managed Hook and Rule state without touching user entries', async () => {
    const claude = PLATFORMS.find((platform) => platform.id === 'claude')!;
    await installManagedCometSkills(tmpDir);
    await copyCometRulesForPlatform(tmpDir, claude, true, 'zh', 'project');
    await installCometHooksForPlatform(tmpDir, claude, 'project');

    const hookPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(await fs.readFile(hookPath, 'utf8'));
    const router = settings.hooks.PreToolUse[0].hooks[0];
    settings.hooks.PreToolUse[0].hooks.push(
      { ...router },
      {
        type: 'command',
        command: router.command.replace('comet-hook-router.mjs', 'comet-hook-guard.mjs'),
      },
      { type: 'command', command: 'node user-hook.mjs' },
    );
    await fs.writeFile(hookPath, JSON.stringify(settings), 'utf8');
    const legacyRule = path.join(tmpDir, '.claude', 'rules', 'comet-phase-guard.md');
    await fs.writeFile(legacyRule, '# Legacy\n', 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, { json: true, repair: true, scope: 'project', homeDir: tmpDir });
    } finally {
      log.mockRestore();
    }

    const repaired = JSON.parse(await fs.readFile(hookPath, 'utf8'));
    const commands = repaired.hooks.PreToolUse.flatMap(
      (group: { hooks: Array<{ command?: string }> }) =>
        group.hooks.map((hook: { command?: string }) => hook.command),
    );
    expect(
      commands.filter((command: string) => command?.includes('comet-hook-router.mjs')),
    ).toHaveLength(1);
    expect(commands.some((command: string) => command?.includes('comet-hook-guard.mjs'))).toBe(
      false,
    );
    expect(commands).toContain('node user-hook.mjs');
    await expect(fs.access(legacyRule)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('migrates Classic v1 selection only after a project Router is ready', async () => {
    await installManagedCometSkills(tmpDir);
    const selectionPath = path.join(tmpDir, '.comet', 'current-change.json');
    await fs.mkdir(path.dirname(selectionPath), { recursive: true });
    await fs.writeFile(
      selectionPath,
      `${JSON.stringify({ version: 1, change: 'legacy-change', branch: null })}\n`,
    );
    await fs.mkdir(path.join(tmpDir, 'openspec', 'changes', 'legacy-change'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'legacy-change', '.comet.yaml'),
      [
        'workflow: full',
        'phase: open',
        'design_doc: null',
        'plan: null',
        'build_mode: null',
        'isolation: null',
        'verify_mode: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, { json: true, repair: true, scope: 'project', homeDir: tmpDir });
    } finally {
      log.mockRestore();
    }

    await expect(readCometCurrentSelection(tmpDir)).resolves.toMatchObject({
      status: 'selected',
      legacy: false,
      selection: { workflow: 'classic', change: 'legacy-change' },
    });
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'settings.local.json')),
    ).resolves.toBeUndefined();
  });

  it('keeps Classic v1 selection when doctor cannot establish a project Router', async () => {
    const selectionPath = path.join(tmpDir, '.comet', 'current-change.json');
    const legacy = `${JSON.stringify({ version: 1, change: 'legacy-change', branch: null })}\n`;
    await fs.mkdir(path.dirname(selectionPath), { recursive: true });
    await fs.writeFile(selectionPath, legacy);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, { json: true, repair: true, scope: 'project', homeDir: tmpDir });
    } finally {
      log.mockRestore();
    }

    await expect(fs.readFile(selectionPath, 'utf8')).resolves.toBe(legacy);
  });

  it('keeps Classic v1 selection when the repaired project is Native-only', async () => {
    await installManagedCometSkills(tmpDir);
    const config = defaultProjectConfig('.');
    config.workflows = ['native'];
    config.default_workflow = 'native';
    await writeProjectConfig(tmpDir, config);
    const selectionPath = path.join(tmpDir, '.comet', 'current-change.json');
    const legacy = `${JSON.stringify({ version: 1, change: 'legacy-change', branch: null })}\n`;
    await fs.writeFile(selectionPath, legacy);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, { json: true, repair: true, scope: 'project', homeDir: tmpDir });
    } finally {
      log.mockRestore();
    }

    await expect(fs.readFile(selectionPath, 'utf8')).resolves.toBe(legacy);
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'settings.local.json')),
    ).resolves.toBeUndefined();
  });

  it('clears a missing Native selection after the repaired Router is ready', async () => {
    await installManagedCometSkills(tmpDir);
    await writeProjectConfig(tmpDir, defaultProjectConfig('.'));
    await writeCometCurrentSelection(tmpDir, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'missing-change',
      branch: null,
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir, { json: true, repair: true, scope: 'project', homeDir: tmpDir });
    } finally {
      log.mockRestore();
    }

    await expect(readCometCurrentSelection(tmpDir)).resolves.toEqual({ status: 'missing' });
  });

  it('reports a Hook JSON parse failure without rewriting the canonical config', async () => {
    const hookPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const malformed = '{\r\n  "hooks": {\r\n';
    await installManagedCometSkills(tmpDir);
    await fs.writeFile(hookPath, malformed);

    const results = await collectDoctorResults(tmpDir);

    expect(results.find((result) => result.check === 'hooks: Claude Code (project)')).toMatchObject(
      {
        status: 'warn',
        message: expect.stringContaining('Invalid Hook JSON'),
      },
    );
    expect(await fs.readFile(hookPath, 'utf8')).toBe(malformed);
  });

  it('fails project repair when historical global Hook cleanup is unsafe', async () => {
    const fakeHome = path.join(tmpDir, 'unsafe-global-hook-home');
    const globalLegacyPath = path.join(fakeHome, '.codex', 'settings.local.json');
    await installManagedCometSkills(tmpDir, '.agents');
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    await fs.mkdir(path.dirname(globalLegacyPath), { recursive: true });
    await fs.writeFile(globalLegacyPath, '{not-json', 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        doctorCommand(tmpDir, {
          json: true,
          repair: true,
          scope: 'project',
          homeDir: fakeHome,
        }),
      ).rejects.toThrow('historical global Hook');
    } finally {
      log.mockRestore();
    }

    await expect(fs.readFile(globalLegacyPath, 'utf8')).resolves.toBe('{not-json');
    await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).resolves.toBeUndefined();
  });

  it('reports a Rule destination access failure as a component warning', async () => {
    await installManagedCometSkills(tmpDir);
    const rulePath = path.join(tmpDir, '.claude', 'rules', 'comet-workflow-guard.md');
    const access = fs.access.bind(fs);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const accessSpy = vi.spyOn(fs, 'access').mockImplementation(async (filePath, mode) => {
      if (path.resolve(String(filePath)) === path.resolve(rulePath)) throw permissionError;
      await access(filePath, mode);
    });

    try {
      const results = await collectDoctorResults(tmpDir);
      expect(
        results.find((result) => result.check === 'rules: Claude Code (project)'),
      ).toMatchObject({
        status: 'warn',
        message: expect.stringContaining('permission denied'),
      });
    } finally {
      accessSpy.mockRestore();
    }
  });

  it('does not emit false Rule or Hook warnings for unsupported components', async () => {
    const cursor = PLATFORMS.find((platform) => platform.id === 'cursor');
    const gemini = PLATFORMS.find((platform) => platform.id === 'gemini');
    expect(cursor).toBeDefined();
    expect(gemini).toBeDefined();
    await installManagedCometSkills(tmpDir, '.cursor');
    await copyCometRulesForPlatform(tmpDir, cursor!, true, 'zh', 'project');
    await installManagedCometSkills(tmpDir, '.gemini');
    await installCometHooksForPlatform(tmpDir, gemini!, 'project');

    const results = await collectDoctorResults(tmpDir);

    expect(results.some((result) => result.check === 'hooks: Cursor (project)')).toBe(false);
    expect(results.some((result) => result.check === 'rules: Gemini CLI (project)')).toBe(false);
    expect(results.find((result) => result.check === 'rules: Cursor (project)')).toMatchObject({
      status: 'pass',
    });
    expect(results.find((result) => result.check === 'hooks: Gemini CLI (project)')).toMatchObject({
      status: 'pass',
    });
  });

  it('reports an explicitly scoped canonical global Codex install without a detection path', async () => {
    const fakeHome = path.join(tmpDir, 'canonical-global-home');
    await installManagedCometSkills(fakeHome, '.agents');

    const results = await collectDoctorResults(fakeHome, 'global');

    expect(results.find((result) => result.check === 'skills: Codex (global)')).toMatchObject({
      status: 'pass',
    });
    expect(results.find((result) => result.check === 'rules: Codex (global)')).toMatchObject({
      status: 'warn',
    });
    expect(results.find((result) => result.check === 'hooks: Codex (global)')).toMatchObject({
      status: 'pass',
      message: 'no global blocking Hook present',
    });
  });

  it('reports and repairs a historical global Hook while preserving a user Hook', async () => {
    const fakeHome = path.join(tmpDir, 'global-hook-home');
    await installManagedCometSkills(fakeHome, '.agents');
    const hooksPath = path.join(fakeHome, '.codex', 'hooks.json');
    const userHook = { type: 'command', command: 'node user-hook.mjs' };
    await fs.mkdir(path.dirname(hooksPath), { recursive: true });
    await fs.writeFile(
      hooksPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                userHook,
                {
                  type: 'command',
                  command: `node "${path.join(fakeHome, '.legacy', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs').replaceAll('\\', '/')}" --platform "codex"`,
                },
              ],
            },
          ],
        },
      }),
      'utf8',
    );

    const before = await collectDoctorResults(fakeHome, 'global');
    expect(before.find((result) => result.check === 'hooks: Codex (global)')).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('global blocking Hook remains'),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(fakeHome, {
        json: true,
        repair: true,
        scope: 'global',
        homeDir: fakeHome,
      });
    } finally {
      log.mockRestore();
    }

    const repaired = JSON.parse(await fs.readFile(hooksPath, 'utf8'));
    expect(repaired.hooks.PreToolUse[0].hooks).toEqual([userHook]);
  });

  it('reports and repairs a global managed Hook even when its Skill root is missing', async () => {
    const fakeHome = path.join(tmpDir, 'orphan-global-hook-home');
    const hooksPath = path.join(fakeHome, '.codex', 'hooks.json');
    const userHook = { type: 'command', command: 'node user-hook.mjs' };
    await fs.mkdir(path.dirname(hooksPath), { recursive: true });
    await fs.writeFile(
      hooksPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                userHook,
                {
                  type: 'command',
                  command: `node "${path.join(fakeHome, '.legacy', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs').replaceAll('\\', '/')}" --platform "codex"`,
                },
              ],
            },
          ],
        },
      }),
      'utf8',
    );

    const before = await collectDoctorResults(fakeHome, 'global');
    expect(before.find((result) => result.check === 'hooks: Codex (global)')).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('global blocking Hook remains'),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(fakeHome, {
        json: true,
        repair: true,
        scope: 'global',
        homeDir: fakeHome,
      });
    } finally {
      log.mockRestore();
    }

    const repaired = JSON.parse(await fs.readFile(hooksPath, 'utf8'));
    expect(repaired.hooks.PreToolUse[0].hooks).toEqual([userHook]);
  });

  it('reports legacy-only Codex skills as requiring update and canonical Codex skills as healthy', async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.resolve('assets', 'manifest.json'), 'utf8'),
    ) as { skills: string[]; internalSkills?: string[] };
    const managedPaths = [...new Set([...manifest.skills, ...(manifest.internalSkills ?? [])])];
    for (const relPath of managedPaths) {
      const target = path.join(tmpDir, '.codex', 'skills', ...relPath.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `${relPath}\n`);
    }

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await doctorCommand(tmpDir);
      const legacyOutput = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(legacyOutput).toContain('skills: Codex (project): legacy');
      expect(legacyOutput).toContain('run: comet update --scope project');

      await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
      await fs.rename(
        path.join(tmpDir, '.codex', 'skills'),
        path.join(tmpDir, '.agents', 'skills'),
      );
      log.mockClear();
      await doctorCommand(tmpDir, { scope: 'project' });
      const canonicalOutput = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(canonicalOutput).toContain('skills: Codex (project): complete');
    } finally {
      log.mockRestore();
    }
  });

  it.each(['project', 'auto'] as const)(
    'assigns a shared project .agents Skill root once without Codex evidence in %s scope',
    async (scope) => {
      await installManagedCometSkills(tmpDir, '.agents');

      const results = await collectDoctorResults(tmpDir, scope);
      const sharedRootChecks = results.filter((result) =>
        /^skills: (?:Codex|Antigravity(?: 2\.0)?) \(project\)$/u.test(result.check),
      );

      expect(sharedRootChecks.map((result) => result.check)).toEqual([
        'skills: Antigravity (project)',
      ]);
      expect(results.some((result) => /^rules: Codex \(project\)$/u.test(result.check))).toBe(
        false,
      );
      expect(results.some((result) => /^hooks: Codex \(project\)$/u.test(result.check))).toBe(
        false,
      );
    },
  );

  it.each(['project', 'auto'] as const)(
    'assigns a shared project .agents Skill root to Codex once with .codex evidence in %s scope',
    async (scope) => {
      await installManagedCometSkills(tmpDir, '.agents');
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });

      const results = await collectDoctorResults(tmpDir, scope);
      const sharedRootChecks = results.filter((result) =>
        /^skills: (?:Codex|Antigravity(?: 2\.0)?) \(project\)$/u.test(result.check),
      );

      expect(sharedRootChecks.map((result) => result.check)).toEqual(['skills: Codex (project)']);
      expect(results.filter((result) => result.check === 'rules: Codex (project)')).toHaveLength(1);
      expect(results.filter((result) => result.check === 'hooks: Codex (project)')).toHaveLength(1);
      expect(results.some((result) => /^rules: Antigravity/u.test(result.check))).toBe(false);
      expect(results.some((result) => /^hooks: Antigravity/u.test(result.check))).toBe(false);
    },
  );

  it('uses the shared schema and leaves invalid state untouched', async () => {
    const invalidChangeDir = path.join(tmpDir, 'openspec', 'changes', 'top-level-invalid');
    await state(tmpDir, 'init', 'top-level-invalid', 'full');
    await fs.appendFile(path.join(invalidChangeDir, '.comet.yaml'), 'unknown_root_field: true\n');
    const before = await fs.readFile(path.join(invalidChangeDir, '.comet.yaml'), 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await doctorCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const results = JSON.parse(json).results as Array<{
      check: string;
      status: string;
      message: string;
    }>;

    expect(
      results.find((result) => result.check === '.comet.yaml: top-level-invalid'),
    ).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('unknown_root_field'),
    });
    expect(await fs.readFile(path.join(invalidChangeDir, '.comet.yaml'), 'utf8')).toBe(before);
  });

  it('uses Classic diagnostics for comet yaml validity messages', async () => {
    await state(tmpDir, 'init', 'demo', 'full');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await doctorCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }
    const payload = JSON.parse(json);
    const cometYaml = payload.results.find(
      (item: { check: string }) => item.check === '.comet.yaml: demo',
    );

    expect(cometYaml.message).toContain('step: legacy:open');
    expect(cometYaml.message).toContain('mode: legacy-state');
  });

  it('does not synthesize runtime evidence while inspecting a legacy change', async () => {
    await state(tmpDir, 'init', 'demo', 'full');
    const stateFile = path.join(tmpDir, 'openspec', 'changes', 'demo', '.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await doctorCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('.comet.yaml: demo: valid (step: legacy:open, mode: legacy-state)');
    expect(output).not.toContain('runtime_check: demo:');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  });

  it('prints invalid comet yaml errors together with a concrete next step', async () => {
    const invalidChangeDir = path.join(tmpDir, 'openspec', 'changes', 'top-level-invalid');
    await state(tmpDir, 'init', 'top-level-invalid', 'full');
    await fs.appendFile(path.join(invalidChangeDir, '.comet.yaml'), 'unknown_root_field: true\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await doctorCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain(
      '.comet.yaml: top-level-invalid: Invalid Classic state: unknown field(s): unknown_root_field',
    );
    expect(output).toContain('next: top-level-invalid: inspect .comet.yaml and rerun comet doctor');
  });
});
