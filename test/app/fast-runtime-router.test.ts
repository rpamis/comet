import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
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
      assetPath: 'assets/skills/comet-native/scripts/comet-native-next.mjs',
      args: ['change', '--summary', 'ready', '--confirmed'],
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
