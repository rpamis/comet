import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { writeLegacyZcodeUserHook } from '../helpers/zcode-hook-config.js';

it('installs, repairs, updates and uninstalls a ZCode project Router through the public CLI', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-zcode-project-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project with spaces');
  const configFile = path.join(project, '.zcode', 'config.json');
  const userHook = { type: 'process', command: 'node', args: ['team-hook.mjs'] };
  const userSettings = {
    hooks: { enabled: false, events: { PostToolUse: [{ matcher: '*', hooks: [userHook] }] } },
  };
  const cli = (...args: string[]) => {
    const result = spawnSync(process.execPath, [path.resolve('bin/comet.js'), ...args, '--json'], {
      cwd: project,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        COMET_DATA_DIR: path.join(home, 'data'),
      },
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    return JSON.parse(result.stdout);
  };
  const readConfig = async () => JSON.parse(await fs.readFile(configFile, 'utf8'));
  const doctor = (...args: string[]) =>
    cli('doctor', '--scope', 'project', ...args).results.find(
      (item: { check: string }) => item.check === 'hooks: ZCode (project)',
    );

  try {
    await fs.mkdir(home);
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, JSON.stringify(userSettings));

    const init = cli(
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
    );
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
        message: expect.stringContaining('/reload'),
      });
      expect(await fs.readFile(configFile, 'utf8')).toBe(original);
      cli(
        'update',
        '--current-project',
        '--platform',
        'zcode',
        '--scope',
        'project',
        '--skip-self-update',
        '--yes',
      );
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
