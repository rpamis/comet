import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { resolveFastRuntime } from '../../bin/fast-runtime-router.js';

describe('CLI fast runtime router', () => {
  it.each([[[]], [['classic']]])(
    'runs the selected Classic bundle through its facade with prefix %j',
    async (prefix) => {
      const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-fast-entry-'));
      try {
        await fs.mkdir(path.join(fixture, 'bin'), { recursive: true });
        await fs.copyFile(
          fileURLToPath(new URL('../../bin/fast-runtime-router.js', import.meta.url)),
          path.join(fixture, 'bin/fast-runtime-router.js'),
        );
        await fs.writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
        await fs.mkdir(path.join(fixture, 'dist/app/commands'), { recursive: true });
        await fs.writeFile(
          path.join(fixture, 'dist/app/commands/classic.js'),
          `
        export async function runClassicFacade(command, args, execute) {
          const result = await execute([command, ...args]);
          process.stdout.write(JSON.stringify({facade: command, result}) + '\\n');
          return result.exitCode;
        }
      `,
        );
        await fs.mkdir(path.join(fixture, 'assets/skills/comet/scripts'), { recursive: true });
        await fs.writeFile(
          path.join(fixture, 'assets/skills/comet/scripts/comet-check.mjs'),
          `
        export async function runClassicCli(argv) {
          return {exitCode: 0, data: {argv, selected: 'check'}};
        }
      `,
        );
        const args = ['check', 'run', 'demo', 'verify', '--', 'node', 'test.js', '--json'];
        const output = execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `
        import {tryRunFastRuntime} from './bin/fast-runtime-router.js';
        if (!await tryRunFastRuntime(${JSON.stringify([...prefix, ...args])})) throw new Error('unexpected fallback');
      `,
          ],
          { cwd: fixture, encoding: 'utf8' },
        );
        expect(JSON.parse(output)).toEqual({
          facade: 'check',
          result: { exitCode: 0, data: { argv: args, selected: 'check' } },
        });
      } finally {
        await fs.rm(fixture, { recursive: true, force: true });
      }
    },
  );
  it.each(['--comet-task', '--comet-path', '--comet-phase', '--comet-workflow'])(
    'routes Native integration option %s through the public facade',
    (option) => {
      const args = ['status', '--project-root', 'project', option, 'value', '--json'];
      expect(resolveFastRuntime(['native', ...args], {})).toEqual({
        assetPath: 'dist/app/commands/native.js',
        nativeFacade: true,
        args,
      });
    },
  );

  it('preserves implicit Native context without disabling ordinary read fast paths', () => {
    expect(resolveFastRuntime(['native', 'status'], { COMET_TASK: 'repair' })).toHaveProperty(
      'nativeFacade',
      true,
    );
    expect(resolveFastRuntime(['native', 'new', 'demo', '--summary', 'repair'], {})).toHaveProperty(
      'nativeFacade',
      true,
    );
    for (const command of ['status', 'show', 'root']) {
      expect(resolveFastRuntime(['native', command], { COMET_TASK: '  ' })).toHaveProperty(
        'assetPath',
        `assets/skills/comet-native/scripts/comet-native-${command}.mjs`,
      );
    }
  });

  it.each([
    ['next', 'demo'],
    ['archive', 'demo'],
    ['archive', 'demo', '--dry-run'],
    ['status', '--comet-task', 'repair', '--json'],
  ])('executes the Native facade from the real bin for %j', async (...args) => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-fast-entry-'));
    try {
      await fs.mkdir(path.join(fixture, 'bin'), { recursive: true });
      await fs.mkdir(path.join(fixture, 'dist/app/commands'), { recursive: true });
      await fs.writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
      for (const name of ['comet.js', 'comet-daemon-route.js', 'fast-runtime-router.js']) {
        await fs.copyFile(
          fileURLToPath(new URL(`../../bin/${name}`, import.meta.url)),
          path.join(fixture, 'bin', name),
        );
      }
      await fs.writeFile(
        path.join(fixture, 'dist/app/commands/native.js'),
        `
        export async function runNativeFacade(args) {
          process.stdout.write(JSON.stringify({facade: 'native', args}));
          process.stderr.write('facade diagnostic');
          return 73;
        }
      `,
      );
      const result = spawnSync(process.execPath, ['bin/comet.js', 'native', ...args], {
        cwd: fixture,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: fixture,
          USERPROFILE: fixture,
          COMET_DAEMON: 'off',
          COMET_TASK: '',
        },
      });
      expect(result.status, result.stderr).toBe(73);
      expect(JSON.parse(result.stdout)).toEqual({ facade: 'native', args });
      expect(result.stderr).toBe('facade diagnostic');
    } finally {
      await fs.rm(fixture, { recursive: true, force: true });
    }
  });

  it.each(['--task', '--path', '--phase', '--task=repair'])(
    'keeps contextual option %s on the full public CLI',
    (option) => {
      expect(
        resolveFastRuntime(['workflow', 'resolve', '.', option, 'value', '--json']),
      ).toBeNull();
    },
  );
  it('maps public high-frequency commands to their package-owned runtime bundles', () => {
    expect(resolveFastRuntime(['state', 'current', '--json'])).toEqual({
      assetPath: 'dist/app/commands/classic.js',
      classicCommand: 'state',
      args: ['current', '--json'],
    });
    expect(resolveFastRuntime(['classic', 'state', 'current', '--json'])).toEqual(
      resolveFastRuntime(['state', 'current', '--json']),
    );
    expect(resolveFastRuntime(['runtime', 'dispatch', '--request', 'request.json'])).toEqual({
      assetPath: 'dist/app/cli/runtime-command.js',
      runtimeDispatch: true,
      args: ['runtime', 'dispatch', '--request', 'request.json'],
    });
    expect(resolveFastRuntime(['workflow', 'resolve', '.', '--json'])).toEqual({
      assetPath: 'assets/skills/comet/scripts/comet-entry-runtime.mjs',
      args: ['.', '--json'],
    });
    expect(resolveFastRuntime(['workflow', 'resolve', '.', '--activate', '--json'])).toEqual({
      assetPath: 'dist/domains/comet-entry/entry-runtime.js',
      configuredEntry: true,
      args: ['.', '--activate', '--json'],
    });
    expect(resolveFastRuntime(['native', 'status', '--project-root', 'project', '--json'])).toEqual(
      {
        assetPath: 'assets/skills/comet-native/scripts/comet-native-status.mjs',
        args: ['--project-root', 'project', '--json'],
      },
    );
    expect(resolveFastRuntime(['task', '--task', 'repair the build', '--json'])).toEqual({
      assetPath: 'dist/app/commands/task-facade.js',
      taskFacade: true,
      args: ['--task', 'repair the build', '--json'],
    });
  });

  it.each([false, true])(
    'loads the Native facade once with bundle available=%s',
    async (bundled) => {
      const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-fast-facade-'));
      try {
        await fs.mkdir(path.join(fixture, 'bin'), { recursive: true });
        await fs.copyFile(
          fileURLToPath(new URL('../../bin/fast-runtime-router.js', import.meta.url)),
          path.join(fixture, 'bin/fast-runtime-router.js'),
        );
        await fs.writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
        const commands = path.join(fixture, 'dist/app/commands');
        await fs.mkdir(commands, { recursive: true });
        await fs.writeFile(
          path.join(commands, 'native.js'),
          `export async function runNativeFacade(args) { console.log(JSON.stringify({kind: 'source', args})); return 0; }`,
        );
        if (bundled)
          await fs.writeFile(
            path.join(commands, 'native.bundle.js'),
            `export async function runNativeFacade(args) { console.log(JSON.stringify({kind: 'bundle', args})); return 0; }`,
          );
        const stdout = execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `const {tryRunFastRuntime} = await import('./bin/fast-runtime-router.js'); if (!await tryRunFastRuntime(['native', 'next', 'change'])) throw new Error('not handled');`,
          ],
          { cwd: fixture, encoding: 'utf8' },
        );
        expect(JSON.parse(stdout)).toEqual({
          kind: bundled ? 'bundle' : 'source',
          args: ['next', 'change'],
        });
      } finally {
        await fs.rm(fixture, { recursive: true, force: true });
      }
    },
  );

  it('preserves the command tail without parsing it', () => {
    expect(
      resolveFastRuntime([
        'check',
        'run',
        'demo',
        'verify',
        '--',
        'node',
        'test.js',
        '--json',
        '--help',
      ]),
    ).toEqual({
      assetPath: 'dist/app/commands/classic.js',
      classicCommand: 'check',
      args: ['run', 'demo', 'verify', '--', 'node', 'test.js', '--json', '--help'],
    });
    expect(
      resolveFastRuntime(['native', 'next', 'change', '--summary', 'ready', '--confirmed']),
    ).toEqual({
      assetPath: 'dist/app/commands/native.js',
      nativeFacade: true,
      args: ['next', 'change', '--summary', 'ready', '--confirmed'],
    });
  });

  it('falls back to Commander for help, unsupported groups, and unknown subcommands', () => {
    expect(resolveFastRuntime(['state', '--help'])).toBeNull();
    expect(resolveFastRuntime(['classic', 'state', '--help'])).toBeNull();
    expect(resolveFastRuntime(['runtime', 'dispatch', '--help'])).toBeNull();
    expect(resolveFastRuntime(['runtime', 'dispatch', '--version'])).toBeNull();
    expect(resolveFastRuntime(['runtime', 'unknown'])).toBeNull();
    expect(resolveFastRuntime(['native', '--help'])).toBeNull();
    expect(resolveFastRuntime(['native', 'unknown'])).toBeNull();
    for (const retired of ['checkpoint', 'check', 'evidence', 'receipt']) {
      expect(resolveFastRuntime(['native', retired, 'change'])).toBeNull();
    }
    expect(resolveFastRuntime(['classic', 'root', 'show'])).toBeNull();
    expect(resolveFastRuntime(['resume-probe', '.', '--json'])).toBeNull();
  });
});
