import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import * as identity from '../../../platform/process/process-identity.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  nativeProjectPaths,
  ensureNativeDirectories,
} from '../../../domains/comet-native/native-paths.js';
import {
  acquireNativeLock,
  releaseNativeLock,
  diagnoseNativeLock,
  withNativeLockRecovery,
  inspectNativeProjectLocks,
  repairNativeProjectLock,
} from '../../../domains/comet-native/native-lock.js';

const roots: string[] = [];

it.each(['source', 'bundle'] as const)(
  'recovers the legacy meta-lock through public %s doctor before creating a change',
  async (mode) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-public-lock-'));
    roots.push(root);
    const cli = async (...args: string[]) => {
      const argv = [...args, '--project-root', root, '--json'];
      if (mode === 'source') return runNativeCli(argv);
      const result = spawnSync(
        process.execPath,
        [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...argv],
        { encoding: 'utf8', windowsHide: true },
      );
      return { exitCode: result.status, stdout: result.stdout };
    };
    expect((await cli('init')).exitCode).toBe(0);
    const paths = await nativeProjectPaths(root, 'docs');
    const file = path.join(paths.locksDir, '.recovery.lock');
    const source = JSON.stringify({ nonce: 'legacy-recovery', createdAt: Date.now() });
    await fs.writeFile(file, source);
    const diagnosis = await cli('doctor');
    expect(diagnosis.exitCode).not.toBe(0);
    expect(diagnosis.stdout).toContain('legacy-recovery');
    expect(
      (await cli('doctor', '--repair', '--confirmed', '--lock-token', 'wrong')).exitCode,
    ).not.toBe(0);
    expect(await fs.readFile(file, 'utf8')).toBe(source);
    expect(
      (await cli('doctor', '--repair', '--confirmed', '--lock-token', 'legacy-recovery')).exitCode,
    ).toBe(0);
    expect((await cli('new', 'after-recovery', '--runtime', 'compat')).exitCode).toBe(0);
  },
);
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('keeps Native mutation exclusion without binding a PID or probing a thread', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-lock-no-pid-'));
  roots.push(root);
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const probe = vi.spyOn(identity, 'readProcessIdentity');
  const lock = await acquireNativeLock(paths, 'mutation', 'Save actual workflow state');
  try {
    expect(lock.owner).not.toHaveProperty('pid');
    expect(lock.owner).not.toHaveProperty('processIdentity');
    expect((await diagnoseNativeLock(lock.file)).status).toBe('active');
    await expect(acquireNativeLock(paths, 'mutation', 'Another writer')).rejects.toThrow('busy');
  } finally {
    await releaseNativeLock(lock);
  }
  expect((await diagnoseNativeLock(lock.file)).status).toBe('missing');
  expect(probe).not.toHaveBeenCalled();
});

it('keeps ordinary lock acquisition outside a running Native recovery section', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-recovery-no-pid-'));
  roots.push(root);
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  let release!: () => void;
  let ready!: () => void;
  const entered = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const restoring = withNativeLockRecovery([paths], 'Restore the original Action', async () => {
    ready();
    await held;
  });
  await entered;
  let acquired = false;
  const writing = acquireNativeLock(paths, 'root-move', 'Another operation').then(async (lock) => {
    acquired = true;
    await releaseNativeLock(lock);
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(acquired).toBe(false);
  release();
  await Promise.all([restoring, writing]);
  expect(acquired).toBe(true);
});

it('diagnoses and explicitly retires an interrupted legacy recovery lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-legacy-recovery-'));
  roots.push(root);
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const file = path.join(paths.locksDir, '.recovery.lock');
  const source = JSON.stringify({ nonce: 'interrupted-recovery', createdAt: Date.now() });
  await fs.writeFile(file, source);
  await expect(acquireNativeLock(paths, 'mutation', 'Continue the original Run')).rejects.toThrow(
    'Legacy lock requires confirmation',
  );
  expect(await inspectNativeProjectLocks(paths)).toContainEqual(
    expect.objectContaining({ file, token: 'interrupted-recovery', status: 'unknown' }),
  );
  await expect(repairNativeProjectLock(paths, 'other', true)).rejects.toThrow('changed');
  await expect(repairNativeProjectLock(paths, 'interrupted-recovery', false)).rejects.toThrow(
    'confirm',
  );
  expect(await fs.readFile(file, 'utf8')).toBe(source);
  await repairNativeProjectLock(paths, 'interrupted-recovery', true);
  const lock = await acquireNativeLock(paths, 'mutation', 'Continue the original Run');
  await releaseNativeLock(lock);
});

it('does not retire a recovery lock while its original transaction is active', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-active-recovery-'));
  roots.push(root);
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  await withNativeLockRecovery([paths], 'Restore the original Run', async () => {
    const [record] = await inspectNativeProjectLocks(paths);
    expect(record).toMatchObject({ status: 'active', token: expect.any(String) });
    await expect(repairNativeProjectLock(paths, record.token!, true)).rejects.toThrow('still held');
    expect((await inspectNativeProjectLocks(paths))[0].token).toBe(record.token);
  });
});
