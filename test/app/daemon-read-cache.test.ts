import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import { snapshotCometRuntimeMetrics } from '../../platform/process/runtime-metrics.js';

const createCometDaemonServer = vi.hoisted(() => vi.fn());
vi.mock('../../platform/process/comet-daemon.js', () => ({ createCometDaemonServer }));
import { runCometDaemonServer } from '../../app/commands/daemon-server.js';
let root: string;
afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('reuses only Git observations while Native documents remain fresh between daemon requests', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-daemon-read-'));
  const home = path.join(root, 'test-home');
  await fs.mkdir(home);
  for (const key of Object.keys(process.env).filter((key) => /^GIT_/iu.test(key)))
    vi.stubEnv(key, undefined);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('XDG_CONFIG_HOME', path.join(home, '.config'));
  execFileSync('git', ['init', '-b', 'master', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'user.email', 'cache@example.test']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Cache Test']);
  await fs.writeFile(path.join(root, 'README.md'), 'seed\n');
  execFileSync('git', ['-C', root, 'add', 'README.md']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'seed'], { stdio: 'ignore' });
  expect(
    (await runNativeCli(['init', '--project-root', root, '--language', 'en', '--json'])).exitCode,
  ).toBe(0);
  expect(
    (
      await runNativeCli([
        'new',
        'cache-test',
        '--project-root',
        root,
        '--isolation',
        'current',
        '--json',
      ])
    ).exitCode,
  ).toBe(0);
  let handler!: (request: {
    runtime: string;
    argv: string[];
    cwd: string;
    projectRoot: string;
  }) => Promise<{ stdout: string; exitCode: number }>;
  createCometDaemonServer.mockImplementation(async (options) => {
    handler = options.handler;
    throw new Error('capture handler');
  });
  await expect(runCometDaemonServer(['unused', 'cache-test', root])).rejects.toThrow(
    'capture handler',
  );
  const query = async (argv: string[]) => {
    const result = await handler({
      runtime: 'native',
      argv: [...argv, '--json'],
      cwd: root,
      projectRoot: root,
    });
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout).data;
  };
  const original = await query(['show', 'cache-test']);
  await fs.writeFile(
    path.join(root, 'docs', 'comet', 'changes', 'cache-test', 'brief.md'),
    '# Manually updated brief\n',
  );
  const before = snapshotCometRuntimeMetrics();
  const next = await query(['show', 'cache-test']);
  expect(next.brief).toBe('# Manually updated brief\n');
  expect(next.brief).not.toBe(original.brief);
  expect(snapshotCometRuntimeMetrics().gitCommands).toBe(before.gitCommands);
  expect((await query(['status'])).items[0].phase).toBe('shape');
});
