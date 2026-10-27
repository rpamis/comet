import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { acquireNativeLock, releaseNativeLock } from '../../../domains/comet-native/native-lock.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  nativeProjectPaths,
  ensureNativeDirectories,
} from '../../../domains/comet-native/native-paths.js';
import { runGitCommand } from '../../../platform/process/git.js';
import { withNativeCommandRecovery } from '../../../domains/comet-native/native-command-recovery.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-command-lock-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  return { root, paths };
}

it.each([
  ['unable to create ref.lock', true],
  ['WORKTREE /candidate is LOCKED', true],
  ['unable to create\nref.lock', false],
  ['worktree\nlocked', false],
  ['worktree'.repeat(20_000), false],
  ['unable to create'.repeat(20_000), false],
])('classifies Git lock diagnostics without crossing lines (%#)', async (message, locked) => {
  const { root } = await project();
  const result = await withNativeCommandRecovery(
    { command: 'archive', exitCode: 73, error: { code: 'conflict', message } },
    { projectRoot: root, onlyLocks: true },
  );
  expect((result.data as { recovery?: { code: string } } | undefined)?.recovery?.code).toBe(
    locked ? 'git-lock' : undefined,
  );
});

it('reports a directory occupying a project lock path without advertising deletion as lock repair', async () => {
  const { root, paths } = await project();
  const file = path.join(paths.locksDir, 'interrupted.lock');
  await fs.mkdir(file);
  const result = await runNativeCli(['doctor', '--project-root', root, '--json']);
  const data = JSON.parse(result.stdout!).data;
  expect(data.healthy).toBe(false);
  expect(data.recovery).toMatchObject({
    code: 'lock-owner-unknown',
    affectedPaths: [file],
    recoveryArgs: null,
  });
  expect((await fs.lstat(file)).isDirectory()).toBe(true);
});

it('executes the exact recovery command emitted by the standalone doctor bundle', async () => {
  const { root, paths } = await project();
  const file = path.join(paths.locksDir, 'interrupted.lock');
  await fs.writeFile(file, '{original-writer');
  const entry = path.resolve('assets/skills/comet-native/scripts/comet-native-doctor.mjs');
  const diagnosed = spawnSync(process.execPath, [entry, '--project-root', root, '--json'], {
    encoding: 'utf8',
  });
  const data = JSON.parse(diagnosed.stdout).data;
  expect(data.recovery).toMatchObject({ code: 'lock-owner-unknown', affectedPaths: [file] });
  const recovered = spawnSync(process.execPath, [entry, ...data.recovery.recoveryArgs.slice(3)], {
    encoding: 'utf8',
  });
  expect(recovered.status, recovered.stdout || recovered.stderr).toBe(0);
  await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['native', 'classic-full'])(
  'keeps failed %s command recovery diagnosis read-only before any Run exists',
  async (application) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-recovery-readonly-'));
    roots.push(root);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const result = await withNativeCommandRecovery(
      {
        command: 'runtime',
        exitCode: 73,
        error: { code: 'conflict', message: 'Run does not exist' },
      },
      { projectRoot: root, name: 'missing-change', application, onlyLocks: true },
    );
    expect(result.error?.message).toBe('Run does not exist');
    await expect(fs.lstat(resolveWorkspaceRuntimeRootSync(root))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.lstat(path.join(root, '.comet'))).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('recovers an unknown Native coordinator claim through the exact emitted command without acquiring the blocked coordinator', async () => {
  const { root, paths } = await project();
  const directory = path.join(paths.locksDir, '.coordinator');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, '00000000-0000-0000-0000-000000000000.claim');
  await fs.writeFile(
    file,
    JSON.stringify({
      id: 'old-coordinator',
      pid: 2_147_483_647,
      hostname: 'another-machine',
      operation: 'interrupted coordinator',
      createdAt: '2000-01-01T00:00:00.000Z',
    }),
  );
  const diagnostic = await runNativeCli(['doctor', '--repair', '--project-root', root, '--json']);
  const recovery = JSON.parse(diagnostic.stdout!).data.recovery;
  expect(recovery).toMatchObject({ code: 'lock-owner-unknown', affectedPaths: [file] });
  expect((await runNativeCli(recovery.recoveryArgs.slice(2))).exitCode).toBe(0);
  await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  const lock = await acquireNativeLock(paths, 'archive', 'after coordinator recovery');
  await releaseNativeLock(lock);
});

it('reports an actual Git index lock with its path and retry conditions without deleting the Git lock', async () => {
  const { root } = await project();
  await fs.writeFile(path.join(root, 'candidate.txt'), 'candidate');
  const lock = path.join(root, '.git', 'index.lock');
  await fs.writeFile(lock, 'Original Git writer has not been reconciled.');
  let message = '';
  try {
    runGitCommand(root, ['add', 'candidate.txt']);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toContain('index.lock');
  const result = await withNativeCommandRecovery(
    {
      command: 'archive',
      exitCode: 73,
      error: { code: 'conflict', message },
      data: {
        change: 'git-locked',
        workspaceFinishResult: {
          status: 'blocked',
          message,
          targetRoot: root,
          recoveryArgs: ['comet', 'native', 'archive', 'git-locked', '--confirmed'],
        },
      },
    },
    { projectRoot: root, name: 'git-locked' },
  );
  expect(result.data).toMatchObject({
    recovery: { code: 'git-lock', affectedPaths: [lock], owner: null },
  });
  expect(await fs.readFile(lock, 'utf8')).toBe('Original Git writer has not been reconciled.');
  await fs.unlink(lock);
  expect(runGitCommand(root, ['add', 'candidate.txt'])).toBe('');
});

it('preserves a live project lock even when its exact token is submitted with stopped-owner confirmation', async () => {
  const { root, paths } = await project();
  const lock = await acquireNativeLock(paths, 'archive', 'live archive');
  const before = await fs.readFile(lock.file, 'utf8');
  const diagnostic = await runNativeCli(['doctor', '--repair', '--project-root', root, '--json']);
  const data = JSON.parse(diagnostic.stdout!).data;
  expect(data.recovery).toMatchObject({
    code: 'lock-active',
    recoveryArgs: null,
    owner: { pid: process.pid },
  });
  const rejected = await runNativeCli([
    'doctor',
    '--repair',
    '--confirmed',
    '--lock-token',
    data.findings[0].token,
    '--project-root',
    root,
    '--json',
  ]);
  expect(rejected.exitCode).not.toBe(0);
  expect(await fs.readFile(lock.file, 'utf8')).toBe(before);
  await releaseNativeLock(lock);
  expect(
    JSON.parse((await runNativeCli(['doctor', '--project-root', root, '--json'])).stdout!).data,
  ).toMatchObject({ healthy: true });
});

it('rejects a replaced lock token and preserves malformed lock bytes when explicit recovery quarantines them', async () => {
  const { root, paths } = await project();
  const lock = await acquireNativeLock(paths, 'archive', 'interrupted archive');
  await fs.writeFile(lock.file, '{partial-first');
  const first = JSON.parse(
    (await runNativeCli(['doctor', '--project-root', root, '--json'])).stdout!,
  ).data.recovery;
  await fs.writeFile(lock.file, '{partial-replacement');
  expect((await runNativeCli(first.recoveryArgs.slice(2))).exitCode).not.toBe(0);
  expect(await fs.readFile(lock.file, 'utf8')).toBe('{partial-replacement');
  const current = JSON.parse(
    (await runNativeCli(['doctor', '--project-root', root, '--json'])).stdout!,
  ).data.recovery;
  expect((await runNativeCli(current.recoveryArgs.slice(2))).exitCode).toBe(0);
  await expect(fs.access(lock.file)).rejects.toMatchObject({ code: 'ENOENT' });
  const quarantined = (await fs.readdir(path.join(paths.locksDir, '.coordinator'))).filter((name) =>
    name.endsWith('.repaired'),
  );
  expect(quarantined).toHaveLength(1);
  expect(await fs.readFile(path.join(paths.locksDir, '.coordinator', quarantined[0]), 'utf8')).toBe(
    '{partial-replacement',
  );
});

it('requires the exact stopped-owner decision for an aged unknown project lock and executes its emitted recovery command', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-command-recovery-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const lock = await acquireNativeLock(paths, 'archive', 'archive on another machine');
  const content = JSON.stringify({
    ...lock.owner,
    hostname: 'another-machine',
    createdAt: '2000-01-01T00:00:00.000Z',
  });
  await fs.writeFile(lock.file, content);
  const ordinary = await runNativeCli(['doctor', '--repair', '--project-root', root, '--json']);
  expect(await fs.readFile(lock.file, 'utf8')).toBe(content);
  const recovery = JSON.parse(ordinary.stdout!).data.recovery as {
    code: string;
    recoveryArgs: string[];
    affectedPaths: string[];
    owner: { hostname: string };
  };
  expect(recovery).toMatchObject({
    code: 'lock-owner-unknown',
    affectedPaths: [lock.file],
    owner: { hostname: 'another-machine' },
  });
  expect(recovery.recoveryArgs).toContain('--lock-token');
  const repaired = await runNativeCli(recovery.recoveryArgs.slice(2));
  expect(repaired.exitCode, repaired.stdout ?? repaired.stderr).toBe(0);
  await expect(fs.access(lock.file)).rejects.toMatchObject({ code: 'ENOENT' });
});
