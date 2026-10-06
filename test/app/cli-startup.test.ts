import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shouldTryCometDaemon } from '../../bin/comet-daemon-route.js';

const repositoryRoot = path.resolve('.');
let fixture: string;

beforeAll(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-startup-'));
  await fs.mkdir(path.join(fixture, 'bin'));
  await fs.mkdir(path.join(fixture, 'dist/app/cli'), { recursive: true });
  await fs.writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
  await Promise.all(
    ['comet.js', 'comet-daemon-route.js'].map((name) =>
      fs.copyFile(path.join(repositoryRoot, 'bin', name), path.join(fixture, 'bin', name)),
    ),
  );
  await fs.writeFile(
    path.join(fixture, 'bin/comet-daemon-router.js'),
    `console.log('loaded:daemon');
     export async function runCometDaemonCommand(argv) {
       if (argv[0] !== 'daemon') return false;
       console.log('handled:control');
       process.exitCode = 64;
       return true;
     }
     export async function tryRunCometDaemon() {
       return process.env.TEST_DAEMON_HANDLED === '1';
     }`,
  );
  await fs.writeFile(
    path.join(fixture, 'bin/fast-runtime-router.js'),
    `console.log('loaded:fast');
     export async function tryRunFastRuntime() {
       return process.env.TEST_FAST_HANDLED === '1';
     }`,
  );
  await fs.writeFile(
    path.join(fixture, 'dist/app/cli/index.js'),
    `console.log('loaded:cli'); console.log(JSON.stringify(process.argv.slice(2)));`,
  );
});

afterAll(async () => {
  if (fixture) await fs.rm(fixture, { recursive: true, force: true });
});

function run(args: string[], environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [path.join(fixture, 'bin/comet.js'), ...args], {
    cwd: fixture,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fixture,
      USERPROFILE: fixture,
      COMET_DAEMON: 'auto',
      COMET_DAEMON_SERVER: '',
      COMET_TASK: '',
      TEST_DAEMON_HANDLED: '',
      TEST_FAST_HANDLED: '',
      ...environment,
    },
  });
}

describe('CLI startup routing', () => {
  it.each([
    [],
    ['--help'],
    ['--version'],
    ['help', 'state'],
    ['status', '--json'],
    ['runtime', 'dispatch', '--request', 'request.json'],
    ['workflow', 'resolve', '--json'],
    ['task', '--task', 'repair'],
    ['memory', 'status'],
    ['state', 'current', '--help'],
    ['state', 'next', '--summary', 'repair'],
    ['classic', 'state', 'next', '--comet-task', 'repair'],
    ['native', 'root', 'set', 'docs'],
    ['--', 'state', 'current'],
  ])('does not import the daemon graph for %j', (...args) => {
    const result = run(args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`loaded:fast\nloaded:cli\n${JSON.stringify(args)}\n`);
  });

  it.each([
    ['state', 'current'],
    ['classic', 'state', 'next'],
    ['native', 'status'],
    ['native', 'show'],
    ['native', 'root'],
    ['native', 'root', 'show'],
  ])('preserves daemon precedence for %j', (...args) => {
    const result = run(args, { TEST_DAEMON_HANDLED: '1' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('loaded:daemon\n');
  });

  it.each([{ COMET_DAEMON: 'off' }, { COMET_DAEMON_SERVER: '1' }, { COMET_TASK: 'repair' }])(
    'skips automatic daemon loading for %j',
    (environment) => {
      const result = run(['state', 'current'], environment);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain('loaded:daemon');
    },
  );

  it('keeps daemon controls available when automatic routing is off', () => {
    const result = run(['daemon', 'status'], { COMET_DAEMON: 'off', COMET_DAEMON_SERVER: '1' });
    expect(result.status, result.stderr).toBe(64);
    expect(result.stdout).toBe('loaded:daemon\nhandled:control\n');
  });

  it('preserves fallback order and argv after a daemon miss', () => {
    const args = ['state', 'current', '--json'];
    const result = run(args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`loaded:daemon\nloaded:fast\nloaded:cli\n${JSON.stringify(args)}\n`);
  });

  it('does not import Commander after the fast route handles a command', () => {
    const result = run(['task', '--task', 'repair'], { TEST_FAST_HANDLED: '1' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('loaded:fast\n');
  });

  it('uses the same conservative context and option restrictions as the daemon route', () => {
    expect(shouldTryCometDaemon(['state', 'next'], { COMET_TASK: '  ' })).toBe(true);
    expect(shouldTryCometDaemon(['native', 'show'], { COMET_TASK: 'repair' })).toBe(true);
    expect(shouldTryCometDaemon(['state', 'current', '--comet-phase=build'], {})).toBe(false);
    expect(shouldTryCometDaemon(['classic', 'state', 'current', '-h'], {})).toBe(false);
  });
});
