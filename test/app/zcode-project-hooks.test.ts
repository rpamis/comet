import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { isolatedBenchmarkEnvironment } from '../../scripts/benchmark/runtime-coldstart-benchmark.mjs';
import { writeLegacyZcodeUserHook } from '../helpers/zcode-hook-config.js';

function runZcodeProjectCli(project: string, home: string, dataDir: string, ...args: string[]) {
  return spawnSync(process.execPath, [path.resolve('bin/comet.js'), ...args, '--json'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...isolatedBenchmarkEnvironment(home), COMET_DATA_DIR: dataDir },
  });
}

function zcodeProjectCli(project: string, home: string, dataDir: string, ...args: string[]) {
  const result = runZcodeProjectCli(project, home, dataDir, ...args);
  expect(result.status, result.stderr + result.stdout).toBe(0);
  return JSON.parse(result.stdout);
}

const projectInit = [
  'init',
  '--platform',
  'zcode',
  '--scope',
  'project',
  '--workflow',
  'native',
  '--codegraph',
  'skip',
  '--yes',
];
const projectUpdate = [
  'update',
  '--current-project',
  '--platform',
  'zcode',
  '--scope',
  'project',
  '--skip-self-update',
  '--yes',
];

it.for(['configuration file', 'configuration directory'])(
  'keeps external ZCode files unchanged when the project %s is linked',
  async (target, context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-linked-config-'));
    const project = path.join(root, 'project');
    const home = path.join(root, 'home');
    const data = path.join(root, 'data');
    const platformDirectory = path.join(project, '.zcode');
    const externalDirectory = path.join(root, 'external');
    const externalConfig = path.join(externalDirectory, 'config.json');
    const settings = '{ "hooks": { "enabled": false }, "external": true }\n';
    const cli = (...args: string[]) => runZcodeProjectCli(project, home, data, ...args);

    try {
      await Promise.all([fs.mkdir(project), fs.mkdir(home), fs.mkdir(externalDirectory)]);
      zcodeProjectCli(project, home, data, ...projectInit);
      await fs.writeFile(externalConfig, settings);
      const directoryLink = target === 'configuration directory';
      const link = directoryLink ? platformDirectory : path.join(platformDirectory, 'config.json');
      const original = `${link}.original`;
      await fs.rename(link, original);
      if (directoryLink) {
        await fs.cp(path.join(original, 'skills'), path.join(externalDirectory, 'skills'), {
          recursive: true,
        });
      }
      const externalEntries = await fs.readdir(externalDirectory);
      try {
        await fs.symlink(
          directoryLink ? externalDirectory : externalConfig,
          link,
          directoryLink ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file',
        );
      } catch (error) {
        if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
          context.skip(true, `Unable to create a ZCode ${target} link on this machine`);
          return;
        }
        throw error;
      }
      const externalRouter = path.join(
        externalDirectory,
        'skills/comet/scripts/comet-hook-router.mjs',
      );
      const marker = 'external Router content\n';
      if (directoryLink) await fs.writeFile(externalRouter, marker);
      for (const args of [
        projectInit,
        projectUpdate,
        ['doctor', '--scope', 'project', '--repair'],
        ['uninstall', '--current-project', '--scope', 'project', '--force'],
      ]) {
        const result = cli(...args);
        expect.soft(result.status, result.stdout + result.stderr).toBe(1);
        expect.soft(result.stdout).toContain('ZCode project Hook configuration');
        expect.soft(result.stdout).toContain('symbolic link or junction');
        expect.soft(await fs.readFile(externalConfig, 'utf8')).toBe(settings);
        expect.soft(await fs.readdir(externalDirectory)).toEqual(externalEntries);
        if (directoryLink) expect.soft(await fs.readFile(externalRouter, 'utf8')).toBe(marker);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it('keeps the ZCode project Router disabled when legacy user Hook cleanup fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-cleanup-failure-'));
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  const projectConfig = path.join(project, '.zcode/config.json');
  const userHook = { type: 'process', command: 'node', args: ['team-hook.mjs'] };
  const cli = (...args: string[]) => zcodeProjectCli(project, home, data, ...args);
  const readProjectConfig = async () => JSON.parse(await fs.readFile(projectConfig, 'utf8'));

  try {
    await Promise.all([fs.mkdir(project), fs.mkdir(home)]);
    cli(...projectInit);
    const settings = await readProjectConfig();
    settings.hooks.enabled = true;
    const projectHooks = settings.hooks.events.PreToolUse[0].hooks;
    projectHooks[0].enabled = true;
    projectHooks.push(userHook);
    await fs.writeFile(projectConfig, JSON.stringify(settings));
    const { configPath, legacySettings, userSettings } = await writeLegacyZcodeUserHook(home);
    const legacyBytes = await fs.readFile(configPath, 'utf8');
    await fs.writeFile(configPath, '{invalid');

    const verifyCleanupFailure = async (expectedUserConfig: string) => {
      const failed = runZcodeProjectCli(project, home, data, ...projectUpdate);
      expect.soft(failed.status, failed.stdout + failed.stderr).toBe(1);
      expect.soft(failed.stdout).toContain('Legacy ZCode user Hook cleanup failed');
      expect.soft(failed.stdout).toContain(path.basename(configPath));
      projectHooks[0].enabled = false;
      expect.soft(await readProjectConfig()).toEqual(settings);
      await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(expectedUserConfig);
    };
    await verifyCleanupFailure('{invalid');
    await fs.writeFile(configPath, legacyBytes);

    if (process.platform === 'win32' || process.getuid?.() !== 0) {
      projectHooks[0].enabled = true;
      await fs.writeFile(projectConfig, JSON.stringify(settings));
      await fs.chmod(configPath, 0o444);
      try {
        await verifyCleanupFailure(legacyBytes);
        expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual(legacySettings);
      } finally {
        await fs.chmod(configPath, 0o644);
      }
    }

    cli(...projectUpdate);
    expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual(userSettings);
    expect(await readProjectConfig()).toEqual(settings);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('warns against enabling the project Router while legacy user Hook cleanup is pending', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-doctor-cleanup-pending-'));
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  const projectConfig = path.join(project, '.zcode/config.json');
  const cli = (...args: string[]) => zcodeProjectCli(project, home, data, ...args);

  try {
    await Promise.all([fs.mkdir(project, { recursive: true }), fs.mkdir(home)]);
    cli(...projectInit);
    const settings = JSON.parse(await fs.readFile(projectConfig, 'utf8'));
    settings.hooks.enabled = true;
    settings.hooks.events.PreToolUse[0].hooks[0].enabled = true;
    await fs.writeFile(projectConfig, JSON.stringify(settings, null, 2));
    const { configPath, legacySettings } = await writeLegacyZcodeUserHook(home);
    const userRouter = path.join(home, '.zcode/skills/comet/scripts/comet-hook-router.mjs');
    await fs.mkdir(path.dirname(userRouter), { recursive: true });
    await fs.copyFile(
      path.join(project, '.zcode/skills/comet/scripts/comet-hook-router.mjs'),
      userRouter,
    );
    const legacyBytes = await fs.readFile(configPath, 'utf8');
    expect(JSON.parse(legacyBytes)).toEqual(legacySettings);

    await fs.chmod(configPath, 0o444);
    try {
      // A privileged process may still write a read-only file. In that case the
      // existing cleanup test covers the failure path with invalid JSON, and
      // this test still verifies the warning for a configured legacy Router.
      const writable = await fs.access(configPath, fs.constants.W_OK).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'EACCES' || error.code === 'EPERM') return false;
          throw error;
        },
      );
      if (!writable) {
        const update = runZcodeProjectCli(project, home, data, ...projectUpdate);
        expect(update.status, update.stdout + update.stderr).toBe(1);
        const disabledProjectSettings = JSON.parse(await fs.readFile(projectConfig, 'utf8'));
        expect(disabledProjectSettings.hooks.events.PreToolUse[0].hooks[0].enabled).toBe(false);
        expect(disabledProjectSettings.hooks.enabled).toBe(true);
      }
      const projectBytes = await fs.readFile(projectConfig, 'utf8');
      const doctorResult = runZcodeProjectCli(project, home, data, 'doctor', '--scope', 'project');
      expect(doctorResult.status, doctorResult.stdout + doctorResult.stderr).toBe(0);
      const hookCheck = JSON.parse(doctorResult.stdout).results.find(
        (item: { check: string }) => item.check === 'hooks: ZCode (project)',
      );
      expect(hookCheck).toMatchObject({ status: 'warn' });
      expect(hookCheck.message).toContain('legacy ZCode user Hook remains configured');
      expect(hookCheck.message).toContain("rerun 'comet update");
      expect(hookCheck.message).toContain('before enabling the project Router');
      expect(hookCheck.message).not.toContain('Manually enable the Router');
      expect(await fs.readFile(configPath, 'utf8')).toBe(legacyBytes);
      await expect(fs.readFile(projectConfig, 'utf8')).resolves.toBe(projectBytes);
    } finally {
      await fs.chmod(configPath, 0o644);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('installs, repairs, updates and uninstalls a ZCode project Router through the public CLI', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-project-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project with spaces');
  const configFile = path.join(project, '.zcode', 'config.json');
  const userHook = { type: 'process', command: 'node', args: ['team-hook.mjs'] };
  const userSettings = {
    hooks: { enabled: false, events: { PostToolUse: [{ matcher: '*', hooks: [userHook] }] } },
  };
  const cli = (...args: string[]) =>
    zcodeProjectCli(project, home, path.join(home, 'data'), ...args);
  const readConfig = async () => JSON.parse(await fs.readFile(configFile, 'utf8'));
  const doctor = (...args: string[]) =>
    cli('doctor', '--scope', 'project', ...args).results.find(
      (item: { check: string }) => item.check === 'hooks: ZCode (project)',
    );

  try {
    await fs.mkdir(home);
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, JSON.stringify(userSettings));

    const init = cli(...projectInit);
    expect(init.results).toContainEqual(
      expect.objectContaining({
        platform: 'zcode',
        hook: { status: 'installed', reason: expect.stringContaining('Hooks → Workspace') },
      }),
    );
    const config = await readConfig();
    expect.soft(config.hooks.enabled).toBe(false);
    const groups = config.hooks.events.PreToolUse;
    expect.soft(groups).toEqual([
      {
        matcher: 'Write|Edit',
        hooks: [
          {
            type: 'process',
            command: 'node',
            args: [
              path.join(project, '.zcode/skills/comet/scripts/comet-hook-router.mjs'),
              '--platform',
              'zcode',
              '--project-root',
              project,
            ],
            timeoutMs: 60_000,
            enabled: false,
          },
        ],
      },
    ]);
    await expect(fs.access(groups[0].hooks[0].args[0])).resolves.toBeUndefined();
    expect(config.hooks.events.PostToolUse).toEqual(userSettings.hooks.events.PostToolUse);
    expect(doctor()).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('Manually enable'),
    });
    for (const [workspaceEnabled, routerEnabled] of [
      [true, false],
      [true, true],
      [false, true],
      [false, false],
    ]) {
      const edited = await readConfig();
      edited.hooks.enabled = workspaceEnabled;
      edited.hooks.events.PreToolUse[0].hooks[0].enabled = routerEnabled;
      await fs.writeFile(configFile, JSON.stringify(edited, null, 2) + '\n');
      const original = await fs.readFile(configFile, 'utf8');
      expect(doctor('--repair')).toMatchObject({
        status: workspaceEnabled && routerEnabled ? 'pass' : 'warn',
        message: expect.stringContaining(
          workspaceEnabled && routerEnabled
            ? 'enabled in the ZCode workspace configuration'
            : 'Manually enable the Router',
        ),
      });
      expect(await fs.readFile(configFile, 'utf8')).toBe(original);
      cli(...projectUpdate);
      expect(await fs.readFile(configFile, 'utf8')).toBe(original);
    }
    const projectBeforeGlobal = await fs.readFile(configFile, 'utf8');
    const globalInit = cli(
      'init',
      '--platform',
      'zcode',
      '--scope',
      'global',
      '--workflow',
      'native',
      '--codegraph',
      'skip',
      '--yes',
    );
    expect(globalInit.results).toContainEqual(
      expect.objectContaining({
        platform: 'zcode',
        hook: { status: 'skipped', reason: expect.stringContaining('project-scoped') },
      }),
    );
    await expect(
      fs.access(path.join(home, '.zcode/skills/comet/SKILL.md')),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(home, '.zcode/cli/config.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.readFile(configFile, 'utf8')).resolves.toBe(projectBeforeGlobal);

    const { configPath: legacyConfig, userSettings: userHookSettings } =
      await writeLegacyZcodeUserHook(home);
    cli(
      'update',
      '--current-project',
      '--platform',
      'zcode',
      '--scope',
      'global',
      '--skip-self-update',
      '--yes',
    );
    expect(JSON.parse(await fs.readFile(legacyConfig, 'utf8'))).toEqual(userHookSettings);
    await expect(fs.readFile(configFile, 'utf8')).resolves.toBe(projectBeforeGlobal);

    cli('uninstall', '--current-project', '--scope', 'project', '--force');
    expect(await readConfig()).toEqual(userSettings);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('migrates the ZCode user Router when the project is HOME', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-home-project-'));
  const home = path.join(root, 'home');
  try {
    const { configPath, userSettings } = await writeLegacyZcodeUserHook(home);
    const init = zcodeProjectCli(home, home, path.join(root, 'data'), ...projectInit);
    expect(init.results).toContainEqual(
      expect.objectContaining({
        platform: 'zcode',
        hook: { status: 'installed', reason: expect.stringContaining('Hooks → Workspace') },
      }),
    );
    const project = JSON.parse(await fs.readFile(path.join(home, '.zcode/config.json'), 'utf8'));
    expect(project.hooks.events.PreToolUse[0].hooks).toEqual([
      expect.objectContaining({
        enabled: false,
        args: expect.arrayContaining(['--project-root', home]),
      }),
    ]);
    expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual(userSettings);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('clears a missing selection on public ZCode Doctor repair before Hook trust', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-stale-selection-'));
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const cli = (...args: string[]) =>
    zcodeProjectCli(project, home, path.join(root, 'data'), ...args);
  const selectionPath = path.join(project, '.comet/current-change.json');
  const configPath = path.join(project, '.zcode/config.json');
  const doctor = (...args: string[]) => cli('doctor', '--scope', 'project', ...args);
  try {
    await fs.mkdir(project);
    await fs.mkdir(home);
    cli(...projectInit);
    const stale = JSON.stringify({
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'missing-change',
      branch: null,
    });
    await fs.writeFile(selectionPath, stale);
    expect(doctor().results).toContainEqual(
      expect.objectContaining({
        check: 'current selection',
        status: 'warn',
        message: expect.stringContaining('missing-change'),
      }),
    );
    await expect(fs.readFile(selectionPath, 'utf8')).resolves.toBe(stale);
    expect(cli('doctor', '--scope', 'global', '--repair').repaired).not.toContain(
      'stale current selection',
    );
    await expect(fs.readFile(selectionPath, 'utf8')).resolves.toBe(stale);
    const config = await fs.readFile(configPath, 'utf8');
    expect(JSON.parse(config).hooks.events.PreToolUse[0].hooks[0].enabled).toBe(false);

    expect.soft(doctor('--repair').repaired).toContain('stale current selection');
    await expect.soft(fs.access(selectionPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(config);
    expect(doctor('--repair').repaired).not.toContain('stale current selection');

    const none = JSON.stringify({
      schema: 'comet.selection.v2',
      workflow: 'none',
      change: null,
      branch: null,
    });
    await fs.writeFile(selectionPath, none);
    expect(doctor('--repair').repaired).not.toContain('stale current selection');
    await expect(fs.readFile(selectionPath, 'utf8')).resolves.toBe(none);

    execFileSync('git', ['init', '-q'], { cwd: project, env: isolatedBenchmarkEnvironment(home) });
    cli('native', 'new', 'active-change');
    const active = await fs.readFile(selectionPath, 'utf8');
    const repaired = doctor('--repair');
    expect(repaired.repaired).not.toContain('stale current selection');
    expect(repaired.results).toContainEqual(
      expect.objectContaining({
        check: 'current selection',
        status: 'pass',
        message: expect.stringContaining('native:active-change'),
      }),
    );
    await expect(fs.readFile(selectionPath, 'utf8')).resolves.toBe(active);
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(config);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('preserves the enabled state of an existing ZCode Router with no enabled field on update and repair', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-omitted-enabled-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const configPath = path.join(project, '.zcode/config.json');
  const cli = (...args: string[]) =>
    zcodeProjectCli(project, home, path.join(root, 'data'), ...args);
  try {
    await fs.mkdir(home);
    await fs.mkdir(project);
    cli(...projectInit);
    const legacy = JSON.parse(await fs.readFile(configPath, 'utf8'));
    legacy.hooks.enabled = true;
    const router = legacy.hooks.events.PreToolUse[0].hooks[0];
    delete router.enabled;
    const settings = JSON.stringify(legacy, null, 2) + '\n';
    const check = (result: { results: Array<{ check: string }> }) =>
      result.results.find(({ check }) => check === 'hooks: ZCode (project)');

    for (const action of [projectUpdate, ['doctor', '--scope', 'project', '--repair']]) {
      await fs.writeFile(configPath, settings);
      expect(check(cli('doctor', '--scope', 'project'))).toMatchObject({ status: 'pass' });
      cli(...action);
      expect.soft(await fs.readFile(configPath, 'utf8')).toBe(settings);
      expect.soft(check(cli('doctor', '--scope', 'project'))).toMatchObject({ status: 'pass' });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('preserves ZCode Router and user Hook positions through public update', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-router-position-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const configPath = path.join(project, '.zcode/config.json');
  const cli = (...args: string[]) =>
    zcodeProjectCli(project, home, path.join(root, 'data'), ...args);
  try {
    await fs.mkdir(home);
    await fs.mkdir(project);
    cli(...projectInit);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const [routerGroup] = config.hooks.events.PreToolUse;
    const userHook = (script: string) => ({ type: 'process', command: 'node', args: [script] });
    const userGroup = { matcher: 'Write|Edit', hooks: [userHook('team.mjs')] };
    for (const group of [
      routerGroup,
      {
        ...routerGroup,
        hooks: [userHook('before.mjs'), ...routerGroup.hooks, userHook('after.mjs')],
      },
    ]) {
      config.hooks.events.PreToolUse = [group, userGroup];
      const source = JSON.stringify(config);
      await fs.writeFile(configPath, source, 'utf8');
      cli(...projectUpdate);
      const updated = await fs.readFile(configPath, 'utf8');
      expect.soft(JSON.parse(updated).hooks.events.PreToolUse).toEqual([group, userGroup]);
      expect.soft(updated).toBe(source);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('repairs and uninstalls a ZCode Router after moving its project through the public CLI', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-move-'));
  const home = path.join(root, 'home');
  const original = path.join(root, 'original project');
  const project = path.join(root, 'moved project');
  const dataDir = path.join(root, 'data');
  const cli = (...args: string[]) => zcodeProjectCli(project, home, dataDir, ...args);
  const configPath = path.join(project, '.zcode/config.json');
  const readConfig = async () => JSON.parse(await fs.readFile(configPath, 'utf8'));
  try {
    await fs.mkdir(home);
    await fs.mkdir(original);
    zcodeProjectCli(original, home, dataDir, ...projectInit);
    await fs.rename(original, project);
    const moved = await readConfig();
    moved.hooks.enabled = true;
    const group = moved.hooks.events.PreToolUse[0];
    const originalRouter = group.hooks[0];
    originalRouter.enabled = true;
    const sharedProject = path.join(root, 'shared project');
    const sharedRouter = path.join(
      sharedProject,
      'tools/skills/comet/scripts/comet-hook-router.mjs',
    );
    await fs.mkdir(path.dirname(sharedRouter), { recursive: true });
    await fs.copyFile(
      path.join(project, '.zcode/skills/comet/scripts/comet-hook-router.mjs'),
      sharedRouter,
    );
    const userHooks = [
      {
        ...originalRouter,
        args: [sharedRouter, '--platform', 'zcode', '--project-root', sharedProject],
      },
      { ...originalRouter, args: [...originalRouter.args, '--team-option'] },
      {
        ...originalRouter,
        args: [originalRouter.args[0], '--platform', 'zcode', '--project-root', project],
      },
      {
        ...originalRouter,
        args: [
          path.join(original, 'tools/skills/comet/scripts/comet-hook-router.mjs'),
          ...originalRouter.args.slice(1),
        ],
      },
    ];
    group.hooks.push(...userHooks);
    const installed = {
      ...originalRouter,
      args: [
        path.join(project, '.zcode/skills/comet/scripts/comet-hook-router.mjs'),
        '--platform',
        'zcode',
        '--project-root',
        project,
      ],
    };
    const expected = structuredClone(moved);
    expected.cometRouterProjectRoot = project;
    expected.hooks.events.PreToolUse[0].hooks[0] = installed;
    for (const action of [projectUpdate, ['doctor', '--scope', 'project', '--repair']]) {
      await fs.writeFile(configPath, JSON.stringify(moved));
      cli(...action);
      expect.soft(await readConfig()).toEqual(expected);
    }
    const launch = spawnSync(process.execPath, installed.args, {
      cwd: project,
      env: { ...isolatedBenchmarkEnvironment(home), COMET_DATA_DIR: dataDir },
      input: JSON.stringify({
        cwd: project,
        tool_name: 'Write',
        tool_input: { file_path: 'README.md' },
      }),
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(launch.status, launch.stderr).toBe(0);

    const current = await readConfig();
    // Model a partial migration where the new declaration exists but the
    // workspace still records ownership of the old declaration.
    current.cometRouterProjectRoot = original;
    const disabled = { ...installed, enabled: false };
    current.hooks.events.PreToolUse[0].hooks[0] = disabled;
    current.hooks.events.PreToolUse.push({
      matcher: 'Write|Edit|ApplyPatch',
      hooks: [installed, originalRouter],
    });
    const duplicateConfig = JSON.stringify(current);
    await fs.writeFile(configPath, duplicateConfig);
    const report = cli('doctor', '--scope', 'project');
    expect.soft(report.results).toContainEqual(
      expect.objectContaining({
        check: 'hooks: ZCode (project)',
        status: 'warn',
        message: expect.stringContaining('duplicate managed Router Hooks'),
      }),
    );
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(duplicateConfig);
    cli('doctor', '--scope', 'project', '--repair');
    const expectedDisabled = structuredClone(expected);
    expectedDisabled.hooks.events.PreToolUse[0].hooks[0] = disabled;
    expect.soft(await readConfig()).toEqual(expectedDisabled);

    await fs.symlink(project, original, process.platform === 'win32' ? 'junction' : 'dir');
    await fs.writeFile(configPath, JSON.stringify(moved));
    cli(...projectUpdate);
    expect.soft(await readConfig()).toEqual(expected);

    await fs.writeFile(configPath, JSON.stringify(moved));
    cli('uninstall', '--current-project', '--scope', 'project', '--force');
    expect(await readConfig()).toEqual({
      hooks: {
        enabled: true,
        events: { PreToolUse: [{ matcher: group.matcher, hooks: userHooks }] },
      },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('rebinds a ZCode project Router when another install occupies the old root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-reused-root-'));
  const home = path.join(root, 'home');
  const original = path.join(root, 'original project');
  const project = path.join(root, 'moved project');
  const dataDir = path.join(root, 'data');
  const cli = (...args: string[]) => zcodeProjectCli(project, home, dataDir, ...args);
  const configPath = path.join(project, '.zcode/config.json');
  const originalConfigPath = path.join(original, '.zcode/config.json');
  const routerPath = '.zcode/skills/comet/scripts/comet-hook-router.mjs';
  const readConfig = async () => JSON.parse(await fs.readFile(configPath, 'utf8'));
  try {
    await fs.mkdir(home);
    await fs.mkdir(original);
    zcodeProjectCli(original, home, dataDir, ...projectInit);
    await fs.rename(original, project);
    await fs.mkdir(original);
    zcodeProjectCli(original, home, dataDir, ...projectInit);
    const otherRouterPath = path.join(original, routerPath);
    const otherConfig = await fs.readFile(originalConfigPath, 'utf8');
    const otherRouter = await fs.readFile(otherRouterPath, 'utf8');
    const expectOtherInstallUnchanged = async () => {
      await expect(fs.readFile(originalConfigPath, 'utf8')).resolves.toBe(otherConfig);
      await expect(fs.readFile(otherRouterPath, 'utf8')).resolves.toBe(otherRouter);
    };

    const stale = await readConfig();
    stale.hooks.enabled = true;
    const group = stale.hooks.events.PreToolUse[0];
    const previous = group.hooks[0];
    previous.enabled = true;
    const userHook = { ...previous, args: [...previous.args, '--team-option'] };
    group.hooks.push(userHook);
    const staleConfig = JSON.stringify(stale);
    const installed = {
      ...previous,
      args: [path.join(project, routerPath), '--platform', 'zcode', '--project-root', project],
    };
    const keptGroup = { matcher: group.matcher, hooks: [userHook] };
    const expected = structuredClone(stale);
    expected.cometRouterProjectRoot = project;
    expected.hooks.events.PreToolUse[0].hooks[0] = installed;
    for (const action of [projectUpdate, ['doctor', '--scope', 'project', '--repair']]) {
      await fs.writeFile(configPath, staleConfig);
      cli(...action);
      expect.soft(await readConfig()).toEqual(expected);
      await expectOtherInstallUnchanged();
    }

    await fs.writeFile(configPath, staleConfig);
    cli('uninstall', '--current-project', '--scope', 'project', '--force');
    expect.soft(await readConfig()).toEqual({
      hooks: { enabled: true, events: { PreToolUse: [keptGroup] } },
    });
    await expectOtherInstallUnchanged();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('preserves a live foreign ZCode project Router through public update, repair, and uninstall', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-foreign-router-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const other = path.join(root, 'other');
  const data = path.join(root, 'data');
  const configPath = path.join(project, '.zcode/config.json');
  const otherConfigPath = path.join(other, '.zcode/config.json');
  const cli = (...args: string[]) => zcodeProjectCli(project, home, data, ...args);
  try {
    await Promise.all([fs.mkdir(home), fs.mkdir(project), fs.mkdir(other)]);
    cli(...projectInit);
    zcodeProjectCli(other, home, data, ...projectInit);
    const otherBytes = await fs.readFile(otherConfigPath, 'utf8');
    const otherGroup = JSON.parse(otherBytes).hooks.events.PreToolUse[0];
    otherGroup.hooks[0].enabled = true;
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.hooks.events.PreToolUse.unshift(otherGroup);
    const before = JSON.stringify(config);
    await fs.writeFile(configPath, before);
    cli(...projectUpdate);
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(before);
    cli('doctor', '--scope', 'project', '--repair');
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(before);
    const report = cli('doctor', '--scope', 'project');
    const hookCheck = report.results.find(
      (item: { check: string }) => item.check === 'hooks: ZCode (project)',
    );
    expect(hookCheck.message).not.toContain('duplicate');
    cli('uninstall', '--current-project', '--scope', 'project', '--force');
    const after = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(after.hooks.events.PreToolUse).toEqual([otherGroup]);
    await expect(fs.readFile(otherConfigPath, 'utf8')).resolves.toBe(otherBytes);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('preserves ZCode project settings and POSIX mode when rewriting Hook configuration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-config-mode-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const configPath = path.join(project, '.zcode/config.json');
  const cli = (...args: string[]) =>
    zcodeProjectCli(project, home, path.join(root, 'data'), ...args);
  const hasPosixMode = process.platform !== 'win32';
  try {
    await Promise.all([fs.mkdir(home), fs.mkdir(path.dirname(configPath), { recursive: true })]);
    await fs.writeFile(configPath, JSON.stringify({ projectSetting: true }));
    if (hasPosixMode) await fs.chmod(configPath, 0o600);
    cli(...projectInit);
    const installed = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(installed.hooks.events.PreToolUse).toHaveLength(1);
    expect(installed.projectSetting).toBe(true);
    if (hasPosixMode) {
      expect.soft((await fs.stat(configPath)).mode & 0o777).toBe(0o600);
      await fs.chmod(configPath, 0o600);
    }
    cli('uninstall', '--current-project', '--scope', 'project', '--force');
    expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual({ projectSetting: true });
    if (hasPosixMode) expect.soft((await fs.stat(configPath)).mode & 0o777).toBe(0o600);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('preserves ZCode Router activation when restoring the default matcher through update and repair', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-matcher-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const configPath = path.join(project, '.zcode/config.json');
  const cli = (...args: string[]) =>
    zcodeProjectCli(project, home, path.join(root, 'data'), ...args);
  try {
    await fs.mkdir(home);
    await fs.mkdir(project);
    cli(...projectInit);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.hooks.enabled = true;
    const group = config.hooks.events.PreToolUse[0];
    const defaultMatcher = group.matcher;
    const router = group.hooks[0];
    group.matcher = 'Write|Edit|ApplyPatch';
    const userHook = { type: 'process', command: 'node', args: ['team-hook.mjs'] };
    const laterGroup = { matcher: 'Write|Edit', hooks: [userHook] };
    config.hooks.events.PreToolUse.push(laterGroup);
    for (const [enabled, action] of [
      [true, projectUpdate],
      [undefined, ['doctor', '--scope', 'project', '--repair']],
      [false, projectUpdate],
    ] as const) {
      router.enabled = enabled;
      await fs.writeFile(configPath, JSON.stringify(config));
      cli(...action);
      const updated = JSON.parse(await fs.readFile(configPath, 'utf8'));
      expect.soft(updated.hooks.enabled).toBe(true);
      expect
        .soft(updated.hooks.events.PreToolUse)
        .toEqual([
          { matcher: defaultMatcher, hooks: [JSON.parse(JSON.stringify(router))] },
          laterGroup,
        ]);
    }

    group.hooks.push(userHook);
    router.enabled = true;
    const shared = JSON.stringify(config);
    await fs.writeFile(configPath, shared);
    for (const action of [projectUpdate, ['doctor', '--scope', 'project', '--repair']]) {
      cli(...action);
      await expect.soft(fs.readFile(configPath, 'utf8')).resolves.toBe(shared);
    }
    const report = cli('doctor', '--scope', 'project');
    expect(report.results).toContainEqual(
      expect.objectContaining({
        check: 'hooks: ZCode (project)',
        status: 'pass',
      }),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('preserves user-owned ZCode Hooks with a Comet Router path suffix during project migration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-user-hook-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  try {
    const { configPath, legacySettings, userSettings } = await writeLegacyZcodeUserHook(home);
    const legacy = legacySettings.hooks.events.PreToolUse[0]!.hooks[1]!;
    const custom = {
      ...legacy,
      args: [
        path.join(root, 'team-tools', 'skills/comet/scripts/comet-hook-router.mjs'),
        ...legacy.args.slice(1),
      ],
    };
    const customArgs = { ...legacy, args: [...legacy.args, '--team-option'] };
    userSettings.hooks.events.PreToolUse[0]!.hooks.push(custom, customArgs);
    legacySettings.hooks.events.PreToolUse[0]!.hooks.push(custom, customArgs);
    await fs.writeFile(configPath, JSON.stringify(legacySettings));
    await fs.mkdir(project);
    zcodeProjectCli(project, home, path.join(root, 'data'), ...projectInit);
    expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual(userSettings);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
