import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNodeCliCommandAvailable,
  resolveNodeCliCommand,
} from '../../../platform/process/node-cli-command.js';

describe('literal Node CLI launchers', () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0))
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node cli 中文 '));
    roots.push(root);
    await fs.writeFile(
      path.join(root, 'cli.cjs'),
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
    );
    return root;
  }
  it.each(['npm', 'pnpm'] as const)(
    'executes %s Node shims with literal argv and no shell expansion',
    async (manager) => {
      const root = await fixture();
      const source =
        manager === 'npm'
          ? [
              '@ECHO off',
              'GOTO start',
              ':find_dp0',
              'SET dp0=%~dp0',
              'EXIT /b',
              ':start',
              'SETLOCAL',
              'CALL :find_dp0',
              '',
              'IF EXIST "%dp0%\\node.exe" (',
              '  SET "_prog=%dp0%\\node.exe"',
              ') ELSE (',
              '  SET "_prog=node"',
              '  SET PATHEXT=%PATHEXT:;.JS;=;%',
              ')',
              '',
              'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\cli.cjs" %*',
            ]
          : [
              '@SETLOCAL',
              '@IF EXIST "%~dp0\\node.exe" (',
              '  "%~dp0\\node.exe"  "%~dp0\\cli.cjs" %*',
              ') ELSE (',
              '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
              '  node  "%~dp0\\cli.cjs" %*',
              ')',
            ];
      const shim = path.join(root, 'probe.cmd');
      await fs.writeFile(shim, source.join('\r\n') + '\r\n');
      const args = [
        '',
        'with space',
        '中文',
        '"quoted"',
        'trailing\\',
        '%COMET_LITERAL_PROBE%',
        '!value!',
        '& | < > ^ ( )',
      ];
      expect(() =>
        assertNodeCliCommandAvailable(shim, args, { cwd: root, platform: 'win32' }),
      ).not.toThrow();
      const launch = resolveNodeCliCommand(shim, args, { cwd: root, platform: 'win32' });
      const output = execFileSync(launch.command, launch.args, {
        cwd: root,
        shell: false,
        encoding: 'utf8',
        env: { ...process.env, COMET_LITERAL_PROBE: 'MUST_NOT_EXPAND' },
      });
      expect(JSON.parse(output)).toEqual(args);
    },
  );
  it('rejects custom shim bodies before execution', async () => {
    const root = await fixture();
    const shim = path.join(root, 'custom.cmd');
    await fs.writeFile(shim, '@echo injected\r\nnode "%~dp0\\cli.cjs" %*\r\n');
    expect(() =>
      resolveNodeCliCommand(shim, ['literal'], { cwd: root, platform: 'win32' }),
    ).toThrow('Unsupported Node CLI shim');
  });
  it('preserves pnpm NODE_PATH dependencies and inherited values without interpreting them', async () => {
    const root = await fixture();
    const dependency = path.join(root, 'outside-module-search');
    await fs.mkdir(path.join(dependency, 'probe-dependency'), { recursive: true });
    await fs.writeFile(
      path.join(dependency, 'probe-dependency/index.js'),
      'module.exports = "resolved through NODE_PATH"',
    );
    await fs.writeFile(
      path.join(root, 'cli.cjs'),
      'process.stdout.write(require("probe-dependency"))',
    );
    const shim = path.join(root, 'probe.cmd');
    await fs.writeFile(
      shim,
      [
        '@SETLOCAL',
        '@IF NOT DEFINED NODE_PATH (',
        `  @SET "NODE_PATH=${dependency}"`,
        ') ELSE (',
        `  @SET "NODE_PATH=${dependency};%NODE_PATH%"`,
        ')',
        '@IF EXIST "%~dp0\\node.exe" (',
        '  "%~dp0\\node.exe"  "%~dp0\\cli.cjs" %*',
        ') ELSE (',
        '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
        '  node  "%~dp0\\cli.cjs" %*',
        ')',
      ].join('\r\n') + '\r\n',
    );
    const env = { ...process.env };
    delete env.NODE_PATH;
    env.Node_Path = 'inherited-literal';
    const launch = resolveNodeCliCommand(shim, [], { cwd: root, env, platform: 'win32' });
    expect(launch.env?.NODE_PATH).toBe(`${dependency};inherited-literal`);
    expect(launch.env?.Node_Path).toBeUndefined();
    if (process.platform === 'win32')
      expect(
        execFileSync(launch.command, launch.args, {
          cwd: root,
          env: launch.env,
          encoding: 'utf8',
          shell: false,
        }),
      ).toBe('resolved through NODE_PATH');
    expect(env.Node_Path).toBe('inherited-literal');
  });
  it('keeps non-Windows direct argv unchanged', () => {
    expect(
      resolveNodeCliCommand('openspec', ['', 'a&b'], { cwd: '/tmp', platform: 'linux' }),
    ).toEqual({ command: 'openspec', args: ['', 'a&b'] });
  });

  it('rechecks missing PATH dependencies after repair without invoking them', async () => {
    const root = await fixture();
    const command = process.platform === 'win32' ? 'probe.exe' : 'probe';
    const options = { cwd: root, env: { PATH: root } };
    expect(() => assertNodeCliCommandAvailable(command, [], options)).toThrow('not found');
    const marker = path.join(root, 'should-not-run');
    await fs.writeFile(
      path.join(root, command),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`,
    );
    await fs.chmod(path.join(root, command), 0o755);
    expect(() => assertNodeCliCommandAvailable(command, [], options)).not.toThrow();
    await expect(fs.access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')(
    'continues PATH lookup after a non-executable match and honors relative PATH entries',
    async () => {
      const root = await fixture();
      await fs.mkdir(path.join(root, 'first'));
      await fs.mkdir(path.join(root, 'second'));
      await fs.writeFile(path.join(root, 'first', 'probe'), 'unusable');
      await fs.writeFile(path.join(root, 'second', 'probe'), 'usable');
      await fs.chmod(path.join(root, 'first', 'probe'), 0o644);
      await fs.chmod(path.join(root, 'second', 'probe'), 0o755);
      expect(() =>
        assertNodeCliCommandAvailable('probe', [], {
          cwd: root,
          env: { PATH: `first${path.delimiter}second` },
        }),
      ).not.toThrow();
      expect(() => assertNodeCliCommandAvailable('first/probe', [], { cwd: root })).toThrow(
        'not executable',
      );
    },
  );

  it('rejects missing Windows Node entries and directories before launch', async () => {
    const root = await fixture();
    expect(() =>
      assertNodeCliCommandAvailable(path.join(root, 'missing.mjs'), [], {
        cwd: root,
        platform: 'win32',
      }),
    ).toThrow();
    await fs.mkdir(path.join(root, 'directory.mjs'));
    expect(() =>
      assertNodeCliCommandAvailable(path.join(root, 'directory.mjs'), [], {
        cwd: root,
        platform: 'win32',
      }),
    ).toThrow('not a file');
    expect(() =>
      assertNodeCliCommandAvailable(path.join(root, 'cli.cjs'), [], {
        cwd: root,
        platform: 'win32',
      }),
    ).not.toThrow();
  });
});
