import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { isolatedBenchmarkEnvironment } from '../../scripts/benchmark/runtime-coldstart-benchmark.mjs';
import { writeLegacyZcodeUserHook } from '../helpers/zcode-hook-config.js';

function zcodeProjectCli(project: string, home: string, dataDir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [path.resolve('bin/comet.js'), ...args, '--json'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...isolatedBenchmarkEnvironment(home), COMET_DATA_DIR: dataDir },
  });
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
    for (const action of [projectUpdate, ['doctor', '--scope', 'project', '--repair']]) {
      await fs.writeFile(configPath, JSON.stringify(moved));
      cli(...action);
      const config = await readConfig();
      expect.soft(config.hooks.enabled).toBe(true);
      expect
        .soft(config.hooks.events.PreToolUse.flatMap(({ hooks }: { hooks: unknown[] }) => hooks))
        .toEqual([...userHooks, installed]);
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
    const disabled = { ...installed, enabled: false };
    current.hooks.events.PreToolUse[1] = {
      matcher: 'Write|Edit|ApplyPatch',
      hooks: [disabled, originalRouter],
    };
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
    expect.soft((await readConfig()).hooks.events.PreToolUse).toEqual([
      { matcher: group.matcher, hooks: userHooks },
      { matcher: group.matcher, hooks: [disabled] },
    ]);

    await fs.symlink(project, original, process.platform === 'win32' ? 'junction' : 'dir');
    await fs.writeFile(configPath, JSON.stringify(moved));
    cli(...projectUpdate);
    expect.soft((await readConfig()).hooks.events.PreToolUse).toEqual([
      { matcher: group.matcher, hooks: userHooks },
      { matcher: group.matcher, hooks: [installed] },
    ]);

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
    for (const action of [projectUpdate, ['doctor', '--scope', 'project', '--repair']]) {
      await fs.writeFile(configPath, staleConfig);
      cli(...action);
      const repaired = await readConfig();
      expect.soft(repaired.hooks.enabled).toBe(true);
      expect
        .soft(repaired.hooks.events.PreToolUse)
        .toEqual([keptGroup, { matcher: group.matcher, hooks: [installed] }]);
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
    group.hooks.push(userHook);
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
      expect.soft(updated.hooks.events.PreToolUse).toEqual([
        { matcher: group.matcher, hooks: [userHook] },
        { matcher: defaultMatcher, hooks: [JSON.parse(JSON.stringify(router))] },
      ]);
    }
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
